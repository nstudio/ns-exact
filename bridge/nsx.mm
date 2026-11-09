#import <Foundation/Foundation.h>
#include <CoreFoundation/CoreFoundation.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>
#include <jsi/instrumentation.h>
#include <sys/stat.h>

#include <fstream>
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
extern const char nsx_dev_path[];
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

// Hermes needs 16-byte alignment for bytecode it keeps pointers into.
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

}  // namespace

namespace nativescript {
// The lean VM takes no source, so the bridge's global installer ships as bytecode.
void NSXEvalGlobals(jsi::Runtime &rt) {
  rt.evaluateJavaScript(std::make_shared<StaticBytes>(nsx_globals_hbc, nsx_globals_hbc_end),
                        "NativeApiGlobals.hbc");
}
}  // namespace nativescript

struct NSXRuntime {
  std::unique_ptr<facebook::hermes::HermesRuntime> rt;
  NSXHost host;
  CFRunLoopObserverRef observer = nullptr;
  std::shared_ptr<jsi::Buffer> live;
  timespec devStamp{};
  bool microtasksDue = false;
};

namespace {

char *dupString(const std::string &text) {
  char *out = static_cast<char *>(malloc(text.size() + 1));
  memcpy(out, text.c_str(), text.size() + 1);
  return out;
}

template <typename Fn>
bool guarded(NSXRuntime *x, char **error, Fn &&fn) {
  try {
    fn();
    x->microtasksDue = true;
    return true;
  } catch (const jsi::JSError &e) {
    std::string message = e.getMessage() + "\n" + e.getStack();
    if (error) *error = dupString(message); else x->host.log(x->host.ctx, message.c_str());
  } catch (const std::exception &e) {
    if (error) *error = dupString(e.what()); else x->host.log(x->host.ctx, e.what());
  }
  return false;
}

void drain(NSXRuntime *x) {
  guarded(x, nullptr, [&] { x->rt->drainMicrotasks(); });
  x->microtasksDue = false;
}

jsi::Object bridgeObject(NSXRuntime *x) { return x->rt->global().getPropertyAsObject(*x->rt, "__nsx"); }

jsi::Value str(jsi::Runtime &rt, const char *text) { return jsi::String::createFromUtf8(rt, text ? text : ""); }

template <typename Fn>
void hostFn(jsi::Runtime &rt, jsi::Object &target, const char *name, Fn fn) {
  target.setProperty(rt, name,
                     jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forAscii(rt, name), 0, std::move(fn)));
}

void installHost(NSXRuntime *x) {
  jsi::Runtime &rt = *x->rt;
  jsi::Object host(rt);
  const auto text = [](jsi::Runtime &r, const jsi::Value &v) { return v.isString() ? v.getString(r).utf8(r) : std::string(); };
  hostFn(rt, host, "log", [x, text](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.log(x->host.ctx, text(r, a[0]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "changed", [x, text](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.changed(x->host.ctx, text(r, a[0]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "now", [x](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value {
    return jsi::Value(x->host.now(x->host.ctx));
  });
  hostFn(rt, host, "frames", [x](jsi::Runtime &, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.frames(x->host.ctx, static_cast<uint64_t>(a[0].getNumber()), a[1].getBool() ? 1 : 0);
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "after", [x](jsi::Runtime &, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.after(x->host.ctx, static_cast<uint64_t>(a[0].getNumber()), a[1].getNumber());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "cancelAfter", [x](jsi::Runtime &, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.cancel_after(x->host.ctx, static_cast<uint64_t>(a[0].getNumber()));
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "reply", [x, text](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.reply(x->host.ctx, static_cast<uint64_t>(a[0].getNumber()), static_cast<int>(a[1].getNumber()), text(r, a[2]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "event", [x, text](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.event(x->host.ctx, static_cast<uint64_t>(a[0].getNumber()), static_cast<uint32_t>(a[1].getNumber()), text(r, a[2]).c_str());
    return jsi::Value::undefined();
  });
  hostFn(rt, host, "act", [x, text](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t) -> jsi::Value {
    x->host.act(x->host.ctx, static_cast<uint64_t>(a[0].getNumber()), text(r, a[1]).c_str(), text(r, a[2]).c_str());
    return jsi::Value::undefined();
  });
  rt.global().setProperty(rt, "__nsxHost", host);
}

void evalModule(NSXRuntime *x, std::shared_ptr<jsi::Buffer> bytes) {
  x->live = bytes;
  x->rt->evaluateJavaScript(bytes, "module.hbc");
}

}  // namespace

extern "C" {

const char *nsx_dev_bytecode_path(void) { return nsx_dev_path; }

NSXRuntime *nsx_create(const NSXHost *host, char **error) {
  auto x = std::make_unique<NSXRuntime>();
  x->host = *host;
  try {
    auto gc = ::hermes::vm::GCConfig::Builder().withMaxHeapSize(64 << 20).build();
    auto config = ::hermes::vm::RuntimeConfig::Builder().withEnableEval(false).withMicrotaskQueue(true).withGCConfig(gc).build();
    x->rt = facebook::hermes::makeHermesRuntime(config);
    nativescript::NativeApiJsiConfig bridge;
    bridge.metadataPtr = nsx_metadata;
    bridge.installGlobalSymbols = true;
    bridge.scheduler = std::make_shared<MainScheduler>();
    nativescript::InstallNativeApiJSI(*x->rt, bridge);
    installHost(x.get());
    std::shared_ptr<jsi::Buffer> bytes;
    if (nsx_dev_path[0]) {
      struct stat st;
      if (stat(nsx_dev_path, &st) == 0) {
        x->devStamp = st.st_mtimespec;
        bytes = readFile(nsx_dev_path);
      }
    }
    if (!bytes) bytes = std::make_shared<StaticBytes>(nsx_module_hbc, nsx_module_hbc_end);
    evalModule(x.get(), bytes);
    x->rt->drainMicrotasks();
  } catch (const jsi::JSError &e) {
    if (error) *error = dupString(e.getMessage() + "\n" + e.getStack());
    return nullptr;
  } catch (const std::exception &e) {
    if (error) *error = dupString(e.what());
    return nullptr;
  }
  NSXRuntime *raw = x.release();
  // Native completion handlers enter JS outside any call this seam made, so
  // their promise continuations settle when the run loop next goes idle.
  CFRunLoopObserverContext context{0, raw, nullptr, nullptr, nullptr};
  raw->observer = CFRunLoopObserverCreate(
      nullptr, kCFRunLoopBeforeWaiting, true, 0,
      [](CFRunLoopObserverRef, CFRunLoopActivity, void *info) { drain(static_cast<NSXRuntime *>(info)); }, &context);
  CFRunLoopAddObserver(CFRunLoopGetMain(), raw->observer, kCFRunLoopCommonModes);
  return raw;
}

void nsx_destroy(NSXRuntime *x) {
  if (!x) return;
  // The bridge caches JSI values it does not release on teardown, so the VM
  // stays alive for the process; only its run-loop hook is removed.
  if (x->observer) {
    CFRunLoopRemoveObserver(CFRunLoopGetMain(), x->observer, kCFRunLoopCommonModes);
    CFRelease(x->observer);
    x->observer = nullptr;
  }
}

void nsx_free(char *text) { free(text); }

char *nsx_call(NSXRuntime *x, const char *request, char **error) {
  char *out = nullptr;
  guarded(x, error, [&] {
    jsi::Runtime &rt = *x->rt;
    auto result = bridgeObject(x).getPropertyAsFunction(rt, "call").call(rt, str(rt, request));
    out = dupString(result.isString() ? result.getString(rt).utf8(rt) : "{}");
  });
  drain(x);
  return out;
}

void nsx_later(NSXRuntime *x, const char *request, uint64_t token) {
  guarded(x, nullptr, [&] {
    jsi::Runtime &rt = *x->rt;
    bridgeObject(x).getPropertyAsFunction(rt, "later").call(rt, str(rt, request), static_cast<double>(token));
  });
  drain(x);
}

void *nsx_view_create(NSXRuntime *x, uint64_t view, const char *tag, const char *props, char **error) {
  void *native = nullptr;
  guarded(x, error, [&] {
    jsi::Runtime &rt = *x->rt;
    auto made = bridgeObject(x).getPropertyAsFunction(rt, "viewCreate").call(rt, static_cast<double>(view), str(rt, tag), str(rt, props));
    native = nativescript::NativeScriptUnwrapNativeObject(rt, made);
    if (!native) throw std::runtime_error(std::string("view factory for ") + tag + " returned no native view");
  });
  drain(x);
  return native;
}

void nsx_view_set_props(NSXRuntime *x, uint64_t view, const char *props) {
  guarded(x, nullptr, [&] {
    jsi::Runtime &rt = *x->rt;
    bridgeObject(x).getPropertyAsFunction(rt, "viewSetProps").call(rt, static_cast<double>(view), str(rt, props));
  });
  drain(x);
}

void nsx_view_destroy(NSXRuntime *x, uint64_t view) {
  guarded(x, nullptr, [&] {
    jsi::Runtime &rt = *x->rt;
    bridgeObject(x).getPropertyAsFunction(rt, "viewDestroy").call(rt, static_cast<double>(view));
  });
  drain(x);
}

void nsx_element(NSXRuntime *x, const char *phase, uint64_t element, const char *info, void *view, void *platform) {
  guarded(x, nullptr, [&] {
    jsi::Runtime &rt = *x->rt;
    auto wrap = [&](void *p) { return p ? nativescript::NativeScriptWrapNativeObject(rt, p) : jsi::Value::null(); };
    bridgeObject(x).getPropertyAsFunction(rt, "element").call(rt, str(rt, phase), static_cast<double>(element), str(rt, info), wrap(view), wrap(platform));
  });
  drain(x);
}

void nsx_tick(NSXRuntime *x, uint64_t token, double now, double seq) {
  guarded(x, nullptr, [&] {
    jsi::Runtime &rt = *x->rt;
    bridgeObject(x).getPropertyAsFunction(rt, "tick").call(rt, static_cast<double>(token), now, seq);
  });
  drain(x);
}

void nsx_fire_after(NSXRuntime *x, uint64_t token) {
  guarded(x, nullptr, [&] {
    jsi::Runtime &rt = *x->rt;
    bridgeObject(x).getPropertyAsFunction(rt, "fireAfter").call(rt, static_cast<double>(token));
  });
  drain(x);
}

int nsx_reload_if_changed(NSXRuntime *x) {
  if (!nsx_dev_path[0]) return 0;
  struct stat st;
  if (stat(nsx_dev_path, &st) != 0) return 0;
  if (st.st_mtimespec.tv_sec == x->devStamp.tv_sec && st.st_mtimespec.tv_nsec == x->devStamp.tv_nsec) return 0;
  auto bytes = readFile(nsx_dev_path);
  if (!bytes) return 0;
  x->devStamp = st.st_mtimespec;
  bool ok = guarded(x, nullptr, [&] { evalModule(x, bytes); });
  drain(x);
  return ok ? 1 : 0;
}

}  // extern "C"
