#import <Foundation/Foundation.h>
#include <CommonCrypto/CommonHMAC.h>
#include <CoreFoundation/CoreFoundation.h>
#include <dlfcn.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>
#include <jsi/instrumentation.h>
#include <mach/mach.h>
#include <malloc/malloc.h>
#include <sys/stat.h>

#include <fstream>
#include <map>
#include <memory>
#include <string>
#include <vector>

#include "jsi/hermes/NativeApiJsi.h"
#include "nsx.h"

using namespace facebook;

// Emitted per app by scripts/nsx.mjs, aligned to 16 bytes so Hermes reads them in place.
extern "C" {
extern const uint8_t nsx_metadata[];
extern const uint8_t nsx_globals_hbc[];
extern const uint8_t nsx_globals_hbc_end[];
extern const uint8_t nsx_module_hbc[];
extern const uint8_t nsx_module_hbc_end[];
// A file path, or on a phone the URL `nsx.mjs js --serve` serves; empty in a release build.
extern const char nsx_dev_path[];
// The key served bytecode is signed with, so nothing else on the network can run code in the app.
extern const uint8_t nsx_dev_key[32];
}

namespace {

class StaticBytes : public jsi::Buffer {
 public:
  StaticBytes(const uint8_t *begin, const uint8_t *end) : begin_(begin), size_(end - begin) {}
  size_t size() const override { return size_; }
  const uint8_t *data() const override { return begin_; }

 private:
  const uint8_t *begin_;
  size_t size_;
};

class OwnedBytes : public jsi::Buffer {
 public:
  explicit OwnedBytes(std::vector<uint8_t> bytes) : bytes_(std::move(bytes)) {}
  size_t size() const override { return bytes_.size(); }
  const uint8_t *data() const override { return bytes_.data(); }

 private:
  std::vector<uint8_t> bytes_;
};

std::shared_ptr<jsi::Buffer> readFile(const char *path) {
  std::ifstream file(path, std::ios::binary);
  std::vector<uint8_t> bytes((std::istreambuf_iterator<char>(file)), {});
  if (bytes.empty()) return nullptr;
  return std::make_shared<OwnedBytes>(std::move(bytes));
}

struct MainScheduler : nativescript::NativeApiJsiScheduler {
  void invokeOnJS(std::function<void()> task) override { post(std::move(task)); }
  void invokeOnUI(std::function<void()> task) override { post(std::move(task)); }
  static void post(std::function<void()> task) {
    auto *held = new std::function<void()>(std::move(task));
    dispatch_async_f(dispatch_get_main_queue(), held, [](void *raw) {
      auto *fn = static_cast<std::function<void()> *>(raw);
      (*fn)();
      delete fn;
    });
  }
};

struct VM {
  std::unique_ptr<facebook::hermes::HermesRuntime> rt;
  std::map<uint64_t, NSXHost> clients;
  uint64_t nextClient = 1;
  // Whose call is running: console output from JS goes to its log.
  uint64_t current = 0;
  std::shared_ptr<jsi::Buffer> live;
  timespec devStamp{};
  // Served bytecode that arrived and awaits nsx_reload_if_changed, and the signature of what runs.
  std::shared_ptr<jsi::Buffer> served;
  std::string servedVersion;
  std::string startError;
  // What each startup step added to the process footprint, logged once to the first client.
  std::string startCost;
};

// The bridge caches JSI values it never releases, so the VM lives for the process.
VM *vm = nullptr;

char *dupString(const std::string &text) {
  char *out = static_cast<char *>(malloc(text.size() + 1));
  memcpy(out, text.c_str(), text.size() + 1);
  return out;
}

const NSXHost *hostFor(uint64_t client) {
  auto found = vm->clients.find(client);
  if (found != vm->clients.end()) return &found->second;
  return vm->clients.empty() ? nullptr : &vm->clients.begin()->second;
}

void report(const std::string &message) {
  if (auto *host = hostFor(vm->current)) host->log(host->ctx, message.c_str());
  else NSLog(@"[ns] %s", message.c_str());
}

constexpr uint32_t kTurnBudgetMs = 100;

// Hermes raises its timeout as an error no JavaScript can catch; say what stopped it.
std::string explained(const std::string &message) {
  if (message.find("timed out") == std::string::npos) return message;
  return "TimeoutError: native.ts ran longer than " + std::to_string(kTurnBudgetMs) +
         " ms on the main thread and was stopped; move long work into a Promise that native code settles";
}

template <typename Fn>
bool guarded(uint64_t client, char **error, Fn &&fn) {
  uint64_t outer = vm->current;
  vm->current = client;
  bool ok = false;
  if (!outer) vm->rt->watchTimeLimit(kTurnBudgetMs);
  try {
    fn();
    ok = true;
  } catch (const jsi::JSError &e) {
    std::string message = explained(e.getMessage() + "\n" + e.getStack());
    if (error) *error = dupString(message); else report(message);
  } catch (const std::exception &e) {
    std::string message = explained(e.what());
    if (error) *error = dupString(message); else report(message);
  }
  if (!outer) vm->rt->unwatchTimeLimit();
  try {
    vm->rt->drainMicrotasks();
  } catch (const std::exception &e) {
    report(e.what());
  }
  vm->current = outer;
  return ok;
}

jsi::Object seam() { return vm->rt->global().getPropertyAsObject(*vm->rt, "__nsx"); }

jsi::Value str(jsi::Runtime &rt, const char *text) { return jsi::String::createFromUtf8(rt, text ? text : ""); }

std::string text(jsi::Runtime &rt, const jsi::Value &v) { return v.isString() ? v.getString(rt).utf8(rt) : std::string(); }

uint64_t number(const jsi::Value &v) { return v.isNumber() ? static_cast<uint64_t>(v.getNumber()) : 0; }

// Every host function takes the client first.
template <typename Fn>
void hostFn(jsi::Runtime &rt, jsi::Object &target, const char *name, Fn fn) {
  target.setProperty(rt, name, jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, name), 0,
      [fn](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t count) -> jsi::Value {
        const NSXHost *host = count ? hostFor(number(a[0])) : nullptr;
        if (!host) return jsi::Value::undefined();
        return fn(r, *host, a);
      }));
}

void installHost() {
  jsi::Runtime &rt = *vm->rt;
  jsi::Object host(rt);
  hostFn(rt, host, "log", [](jsi::Runtime &r, const NSXHost &h, const jsi::Value *a) {
    h.log(h.ctx, text(r, a[1]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "changed", [](jsi::Runtime &r, const NSXHost &h, const jsi::Value *a) {
    h.changed(h.ctx, text(r, a[1]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "now", [](jsi::Runtime &, const NSXHost &h, const jsi::Value *) { return jsi::Value(h.now(h.ctx)); });
  hostFn(rt, host, "frames", [](jsi::Runtime &, const NSXHost &h, const jsi::Value *a) {
    h.frames(h.ctx, number(a[1]), a[2].getBool() ? 1 : 0);
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "after", [](jsi::Runtime &, const NSXHost &h, const jsi::Value *a) {
    h.after(h.ctx, number(a[1]), a[2].getNumber());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "cancelAfter", [](jsi::Runtime &, const NSXHost &h, const jsi::Value *a) {
    h.cancel_after(h.ctx, number(a[1]));
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "reply", [](jsi::Runtime &r, const NSXHost &h, const jsi::Value *a) {
    h.reply(h.ctx, number(a[1]), static_cast<int>(a[2].getNumber()), text(r, a[3]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "event", [](jsi::Runtime &r, const NSXHost &h, const jsi::Value *a) {
    h.event(h.ctx, number(a[1]), static_cast<uint32_t>(a[2].getNumber()), text(r, a[3]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "act", [](jsi::Runtime &r, const NSXHost &h, const jsi::Value *a) {
    h.act(h.ctx, number(a[1]), text(r, a[2]).c_str(), text(r, a[3]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "diag", [](jsi::Runtime &r, const NSXHost &h, const jsi::Value *a) {
    if (!h.diag) return jsi::Value(0);
    uint64_t token = h.diag(h.ctx, static_cast<uint32_t>(a[1].getNumber()), text(r, a[2]).c_str(),
                            a[3].isNumber() ? a[3].getNumber() : 0, text(r, a[4]).c_str());
    return jsi::Value(static_cast<double>(token));
  });
  rt.global().setProperty(rt, "__nsxHost", host);
}

// The host's Hermes, which Exact's executable exports: the module links none of its own, so the VM
// runs on the very build of Hermes app.ts does. The root API is looked up; everything else is
// reached through JSI's virtual interfaces, or is one of the few symbols a RuntimeConfig names
// (its default crash manager), which nsx.mjs leaves to the host as weak imports. JSI is the
// module's own, so an error Hermes throws reaches the seam as a std::exception, its what() the
// message and stack.
std::unique_ptr<facebook::hermes::HermesRuntime> hostRuntime(std::string &error) {
  using RootFn = facebook::jsi::ICast *(*)();
  auto root = reinterpret_cast<RootFn>(dlsym(RTLD_DEFAULT, "_ZN8facebook6hermes17makeHermesRootAPIEv"));
  auto *api = root ? facebook::jsi::castInterface<facebook::hermes::IHermesRootAPI>(root()) : nullptr;
  if (!api || !dlsym(RTLD_DEFAULT, "_ZTVN6hermes2vm15NopCrashManagerE") || !dlsym(RTLD_DEFAULT, "_ZN6hermes2vm15NopCrashManagerD1Ev")) {
    error = "this Exact host exports no Hermes (makeHermesRootAPI, NopCrashManager); the module links none of its own";
    return nullptr;
  }
  auto gc = ::hermes::vm::GCConfig::Builder().withMaxHeapSize(64 << 20).build();
  auto config = ::hermes::vm::RuntimeConfig::Builder().withEnableEval(false).withMicrotaskQueue(true).withGCConfig(gc).build();
  return api->makeHermesRuntime(config);
}

bool devIsURL() { return strncmp(nsx_dev_path, "http://", 7) == 0; }

std::string signature(const uint8_t *bytes, size_t size) {
  uint8_t mac[CC_SHA256_DIGEST_LENGTH];
  CCHmac(kCCHmacAlgSHA256, nsx_dev_key, sizeof nsx_dev_key, bytes, size, mac);
  static const char digits[] = "0123456789abcdef";
  std::string hex;
  for (uint8_t b : mac) { hex += digits[b >> 4]; hex += digits[b & 15]; }
  return hex;
}

bool sameText(const std::string &a, const std::string &b) {
  if (a.size() != b.size()) return false;
  unsigned char diff = 0;
  for (size_t i = 0; i < a.size(); i++) diff |= a[i] ^ b[i];
  return diff == 0;
}

// Long-polls the development server: it answers at once with bytecode newer than `after`, or
// after a while with 204. Only bytecode signed with this build's key is kept.
void pollServed() {
  NSString *url = [NSString stringWithFormat:@"%s?after=%s", nsx_dev_path, vm->servedVersion.c_str()];
  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:url]];
  request.timeoutInterval = 60;
  NSURLSessionDataTask *task = [[NSURLSession sharedSession] dataTaskWithRequest:request
      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSHTTPURLResponse *http = [response isKindOfClass:[NSHTTPURLResponse class]] ? (NSHTTPURLResponse *)response : nil;
        std::shared_ptr<jsi::Buffer> bytes;
        std::string version;
        if (!error && http.statusCode == 200 && data.length) {
          NSString *claimed = [http valueForHTTPHeaderField:@"X-NSX-Signature"];
          version = signature(static_cast<const uint8_t *>(data.bytes), data.length);
          if (claimed && sameText(version, claimed.UTF8String)) {
            const uint8_t *begin = static_cast<const uint8_t *>(data.bytes);
            bytes = std::make_shared<OwnedBytes>(std::vector<uint8_t>(begin, begin + data.length));
          } else {
            NSLog(@"[ns] refused development bytecode from %s: its signature is not this build's", nsx_dev_path);
          }
        }
        double wait = error || (http && http.statusCode >= 400) ? 1.0 : 0;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(wait * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
          if (bytes) {
            vm->served = bytes;
            vm->servedVersion = version;
          }
          pollServed();
        });
      }];
  [task resume];
}

double footprintMB() {
  task_vm_info_data_t info;
  mach_msg_type_number_t count = TASK_VM_INFO_COUNT;
  if (task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&info, &count) != KERN_SUCCESS) return 0;
  return info.phys_footprint / 1048576.0;
}

bool start() {
  if (vm) return vm->rt != nullptr;
  vm = new VM();
  // Of each step's footprint, what the Hermes heap holds and what malloc does (the bridge's caches).
  auto heapMB = [] {
    if (!vm->rt) return 0.0;
    auto info = vm->rt->instrumentation().getHeapInfo(false);
    return info["hermes_allocatedBytes"] / 1048576.0;
  };
  auto mallocMB = [] {
    malloc_statistics_t stats;
    malloc_zone_statistics(nullptr, &stats);
    return stats.size_in_use / 1048576.0;
  };
  double mark = footprintMB(), heap = 0, held = mallocMB(), began = CFAbsoluteTimeGetCurrent();
  auto step = [&](const char *name) {
    double now = footprintMB(), heapNow = heapMB(), heldNow = mallocMB(), at = CFAbsoluteTimeGetCurrent();
    char line[160];
    snprintf(line, sizeof line, "%s%s +%.1f MB (js heap %+.1f, malloc %+.1f) %.1f ms", vm->startCost.empty() ? "NativeScript start: " : ", ",
             name, now - mark, heapNow - heap, heldNow - held, (at - began) * 1000);
    vm->startCost += line;
    mark = now;
    heap = heapNow;
    held = heldNow;
    began = at;
  };
  try {
    vm->rt = hostRuntime(vm->startError);
    if (!vm->rt) return false;
    step("vm");
    nativescript::NativeApiJsiConfig bridge;
    bridge.metadataPtr = nsx_metadata;
    bridge.installGlobalSymbols = true;
    bridge.scheduler = std::make_shared<MainScheduler>();
    nativescript::InstallNativeApiJSI(*vm->rt, bridge);
    // Hermes keeps every young-generation page it has touched; collecting after each
    // startup step lets the next reuse them, as Exact's own executor does at bootstrap.
    vm->rt->instrumentation().collectGarbage("nsx bridge");
    step("bridge");
    installHost();
    std::shared_ptr<jsi::Buffer> bytes;
    struct stat st;
    if (nsx_dev_path[0] && !devIsURL() && stat(nsx_dev_path, &st) == 0) {
      vm->devStamp = st.st_mtimespec;
      bytes = readFile(nsx_dev_path);
    }
    if (!bytes) bytes = std::make_shared<StaticBytes>(nsx_module_hbc, nsx_module_hbc_end);
    vm->live = bytes;
    vm->rt->evaluateJavaScript(bytes, "native.hbc");
    vm->rt->drainMicrotasks();
    vm->rt->instrumentation().collectGarbage("nsx modules");
    step("modules");
  } catch (const jsi::JSError &e) {
    vm->startError = e.getMessage() + "\n" + e.getStack();
    vm->rt.reset();
    return false;
  } catch (const std::exception &e) {
    vm->startError = e.what();
    vm->rt.reset();
    return false;
  }
  // Native completion handlers enter JS outside any call this seam made, so
  // their promise continuations settle when the run loop next goes idle.
  CFRunLoopObserverRef observer = CFRunLoopObserverCreateWithHandler(
      nullptr, kCFRunLoopBeforeWaiting, true, 0, ^(CFRunLoopObserverRef, CFRunLoopActivity) {
        try {
          vm->rt->drainMicrotasks();
        } catch (const std::exception &e) {
          report(e.what());
        }
      });
  CFRunLoopAddObserver(CFRunLoopGetMain(), observer, kCFRunLoopCommonModes);
  if (devIsURL()) {
    vm->servedVersion = signature(vm->live->data(), vm->live->size());
    pollServed();
  }
  return true;
}

}  // namespace

namespace nativescript {
// The lean VM takes no source, so the bridge's global installer ships as bytecode.
void NSXEvalGlobals(jsi::Runtime &rt) {
  rt.evaluateJavaScript(std::make_shared<StaticBytes>(nsx_globals_hbc, nsx_globals_hbc_end), "NativeApiGlobals.hbc");
}
}  // namespace nativescript

extern "C" {

const char *nsx_dev_bytecode_path(void) { return nsx_dev_path; }

uint64_t nsx_attach(const char *module, const NSXHost *host, char **error) {
  if (!start()) {
    if (error) *error = dupString("NativeScript did not start: " + vm->startError);
    return 0;
  }
  uint64_t client = vm->nextClient++;
  vm->clients[client] = *host;
  bool ok = guarded(client, error, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "attach").call(rt, static_cast<double>(client), str(rt, module));
  });
  if (!ok) {
    vm->clients.erase(client);
    return 0;
  }
  if (!vm->startCost.empty()) {
    host->log(host->ctx, vm->startCost.c_str());
    vm->startCost.clear();
  }
  return client;
}

uint64_t nsx_attach_flat(const char *module, void *ctx, NSXLogFn log, NSXTopicFn changed, NSXNowFn now,
                         NSXFramesFn frames, NSXAfterFn after, NSXCancelFn cancel_after, NSXReplyFn reply,
                         NSXEventFn event, NSXActFn act, char **error) {
  NSXHost host{ctx, log, changed, now, frames, after, cancel_after, reply, event, act, nullptr};
  return nsx_attach(module, &host, error);
}

void nsx_detach(uint64_t client) {
  if (!vm || !vm->rt || !vm->clients.count(client)) return;
  guarded(client, nullptr, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "detach").call(rt, static_cast<double>(client));
  });
  vm->clients.erase(client);
}

void nsx_free(char *text) { free(text); }

char *nsx_call(uint64_t client, const char *request, char **error) {
  char *out = nullptr;
  guarded(client, error, [&] {
    jsi::Runtime &rt = *vm->rt;
    auto result = seam().getPropertyAsFunction(rt, "call").call(rt, static_cast<double>(client), str(rt, request));
    out = dupString(result.isString() ? result.getString(rt).utf8(rt) : "{}");
  });
  return out;
}

void nsx_later(uint64_t client, const char *request, uint64_t token) {
  char *error = nullptr;
  bool ok = guarded(client, &error, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "later").call(rt, static_cast<double>(client), str(rt, request), static_cast<double>(token));
  });
  // The runtime's own catch answers ordinary errors; this is the turn stopped outside it.
  if (!ok) {
    report(error ? error : "native.later failed");
    if (auto *host = hostFor(client)) host->reply(host->ctx, token, 500, error ? error : "native.later failed");
    free(error);
  }
}

void *nsx_view_create(uint64_t client, uint64_t view, const char *tag, const char *props, char **error) {
  void *native = nullptr;
  guarded(client, error, [&] {
    jsi::Runtime &rt = *vm->rt;
    auto made = seam().getPropertyAsFunction(rt, "viewCreate")
                    .call(rt, static_cast<double>(client), static_cast<double>(view), str(rt, tag), str(rt, props));
    native = nativescript::NativeScriptUnwrapNativeObject(rt, made);
    if (!native) throw std::runtime_error(std::string("view factory for ") + tag + " returned no native view");
  });
  return native;
}

void nsx_view_set_props(uint64_t client, uint64_t view, const char *props) {
  guarded(client, nullptr, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "viewSetProps").call(rt, static_cast<double>(client), static_cast<double>(view), str(rt, props));
  });
}

void nsx_view_destroy(uint64_t client, uint64_t view) {
  guarded(client, nullptr, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "viewDestroy").call(rt, static_cast<double>(client), static_cast<double>(view));
  });
}

int nsx_view_input(uint64_t client, uint64_t view, const char *kind, const char *text, const char *phase, char **error) {
  return guarded(client, error, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "viewInput")
        .call(rt, static_cast<double>(client), static_cast<double>(view), str(rt, kind), str(rt, text), str(rt, phase));
  }) ? 1 : 0;
}

void nsx_element(uint64_t client, const char *phase, uint64_t element, const char *info, void *view, void *platform) {
  guarded(client, nullptr, [&] {
    jsi::Runtime &rt = *vm->rt;
    auto wrap = [&](void *p) { return p ? nativescript::NativeScriptWrapNativeObject(rt, p) : jsi::Value::null(); };
    seam().getPropertyAsFunction(rt, "element")
        .call(rt, static_cast<double>(client), str(rt, phase), static_cast<double>(element), str(rt, info), wrap(view), wrap(platform));
  });
}

void nsx_tick(uint64_t client, uint64_t token, double now, double seq) {
  guarded(client, nullptr, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "tick").call(rt, static_cast<double>(client), static_cast<double>(token), now, seq);
  });
}

void nsx_fire_after(uint64_t client, uint64_t token) {
  guarded(client, nullptr, [&] {
    jsi::Runtime &rt = *vm->rt;
    seam().getPropertyAsFunction(rt, "fireAfter").call(rt, static_cast<double>(client), static_cast<double>(token));
  });
}

int nsx_reload_if_changed(void) {
  if (!vm || !vm->rt || !nsx_dev_path[0]) return 0;
  if (devIsURL()) {
    if (!vm->served) return 0;
    auto bytes = std::move(vm->served);
    vm->live = bytes;
    return guarded(vm->current, nullptr, [&] { vm->rt->evaluateJavaScript(bytes, "native.hbc"); }) ? 1 : 0;
  }
  struct stat st;
  if (stat(nsx_dev_path, &st) != 0) return 0;
  if (st.st_mtimespec.tv_sec == vm->devStamp.tv_sec && st.st_mtimespec.tv_nsec == vm->devStamp.tv_nsec) return 0;
  auto bytes = readFile(nsx_dev_path);
  if (!bytes) return 0;
  vm->devStamp = st.st_mtimespec;
  vm->live = bytes;
  return guarded(vm->current, nullptr, [&] { vm->rt->evaluateJavaScript(bytes, "native.hbc"); }) ? 1 : 0;
}

}  // extern "C"
