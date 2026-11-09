#import <Foundation/Foundation.h>
#include <hermes/hermes.h>
#include <jsi/jsi.h>
#include <jsi/instrumentation.h>
#include "jsi/hermes/NativeApiJsi.h"
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <fstream>
#include <vector>
#include <cstdio>

using namespace facebook;

static std::shared_ptr<jsi::Buffer> slurp(const char *path) {
  struct B : jsi::Buffer { std::vector<uint8_t> v; size_t size() const override { return v.size(); } const uint8_t *data() const override { return v.data(); } };
  auto b = std::make_shared<B>();
  std::ifstream f(path, std::ios::binary);
  b->v.assign(std::istreambuf_iterator<char>(f), {});
  if (b->v.empty()) { fprintf(stderr, "empty %s\n", path); exit(3); }
  return b;
}
static double ms() { static mach_timebase_info_data_t tb; if (!tb.denom) mach_timebase_info(&tb); return (double)mach_absolute_time() * tb.numer / tb.denom / 1e6; }
static double mb() { task_vm_info_data_t i; mach_msg_type_number_t c = TASK_VM_INFO_COUNT; task_info(mach_task_self(), TASK_VM_INFO, (task_info_t)&i, &c); return i.phys_footprint / 1048576.0; }

namespace nativescript { void NSXEvalGlobals(jsi::Runtime &rt) { rt.evaluateJavaScript(slurp(getenv("SPIKE_GLOBALS_HBC")), "NativeApiGlobals.hbc"); } }

struct MainScheduler : nativescript::NativeApiJsiScheduler {
  void invokeOnJS(std::function<void()> t) override { dispatch_async(dispatch_get_main_queue(), ^{ t(); }); }
  void invokeOnUI(std::function<void()> t) override { dispatch_async(dispatch_get_main_queue(), ^{ t(); }); }
};

int main(int argc, char **argv) {
  @autoreleasepool {
  const char *metadata = argv[1], *test = argv[2], *mode = argc > 3 ? argv[3] : "plain";
  bool harden = strstr(mode, "harden"), globals = !strstr(mode, "noglobals");
  double m0 = mb(), t0 = ms();
  auto gc = ::hermes::vm::GCConfig::Builder().withMaxHeapSize(64 << 20).build();
  auto cfg = ::hermes::vm::RuntimeConfig::Builder().withEnableEval(false).withMicrotaskQueue(true).withGCConfig(gc).build();
  auto rt = facebook::hermes::makeHermesRuntime(cfg);
  double m1 = mb(), t1 = ms();
  rt->global().setProperty(*rt, "print", jsi::Function::createFromHostFunction(*rt, jsi::PropNameID::forAscii(*rt, "print"), 1,
    [](jsi::Runtime &r, const jsi::Value &, const jsi::Value *a, size_t n) -> jsi::Value { std::string l; for (size_t i = 0; i < n; i++) { if (i) l += ' '; l += a[i].toString(r).utf8(r); } puts(l.c_str()); fflush(stdout); return jsi::Value::undefined(); }));
  rt->global().setProperty(*rt, "__now", jsi::Function::createFromHostFunction(*rt, jsi::PropNameID::forAscii(*rt, "__now"), 0,
    [](jsi::Runtime &, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value { return jsi::Value(ms()); }));
  rt->global().setProperty(*rt, "__gc", jsi::Function::createFromHostFunction(*rt, jsi::PropNameID::forAscii(*rt, "__gc"), 0,
    [](jsi::Runtime &r, const jsi::Value &, const jsi::Value *, size_t) -> jsi::Value { r.instrumentation().collectGarbage("spike"); return jsi::Value::undefined(); }));
  nativescript::NativeApiJsiConfig c;
  c.metadataPath = metadata;
  c.installGlobalSymbols = globals;
  c.scheduler = std::make_shared<MainScheduler>();
  if (getenv("SPIKE_NOINDEX")) c.indexRuntimePointers = false;
  try {
    nativescript::InstallNativeApiJSI(*rt, c);
    double m2 = mb(), t2 = ms();
    if (harden) rt->evaluateJavaScript(slurp(getenv("SPIKE_HARDEN_HBC")), "harden.hbc");
    double m3 = mb(), t3 = ms();
    printf("{\"mode\":\"%s\",\"vm_ms\":%.2f,\"vm_mb\":%.2f,\"install_ms\":%.2f,\"install_mb\":%.2f,\"harden_ms\":%.2f,\"harden_mb\":%.2f}\n", mode, t1 - t0, m1 - m0, t2 - t1, m2 - m1, t3 - t2, m3 - m2);
    fflush(stdout);
    rt->evaluateJavaScript(slurp(test), "test.hbc");
    rt->drainMicrotasks();
    for (int i = 0; i < 40; i++) { [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:0.01]]; rt->drainMicrotasks(); }
    jsi::Value after = rt->global().getProperty(*rt, "__after");
    if (after.isObject() && after.getObject(*rt).isFunction(*rt)) after.getObject(*rt).getFunction(*rt).call(*rt);
    printf("{\"end_mb\":%.2f}\n", mb());
  } catch (const jsi::JSError &e) { printf("JSError: %s\nstack: %s\n", e.getMessage().c_str(), e.getStack().c_str()); return 2;
  } catch (const std::exception &e) { printf("exception: %s\n", e.what()); return 2; }
  }
  return 0;
}
