var results = {};
function check(name, fn) { try { var v = fn(); results[name] = v; print("PASS", name, String(v)); } catch (e) { results[name] = "FAIL"; print("FAIL", name, String(e && e.message || e)); } }
function loop(n, f) { var best = 1e12; for (var r = 0; r < 7; r++) { var t = __now(); for (var i = 0; i < n; i++) f(i); var d = (__now() - t) / n * 1e6; if (d < best) best = d; } return best.toFixed(0) + " ns"; }

check("global NSProcessInfo", function () { return NSProcessInfo.processInfo.processorCount > 0; });
check("NSString roundtrip", function () { return NSString.stringWithString("héllo ✓").length; });
check("NSMutableArray", function () { var a = NSMutableArray.new(); a.addObject("x"); a.addObject("y"); return a.count; });
check("block callback", function () { var a = NSMutableArray.new(); a.addObject("p"); a.addObject("q"); var seen = []; a.enumerateObjectsUsingBlock(function (o, i, s) { seen.push(String(o)); }); return seen.join(","); });
check("struct by value", function () { var r = NSMakeRect(1, 2, 30, 40); var v = NSValue.valueWithRect(r); return v.rectValue.size.width; });
check("enum + constant", function () { return [NSWindowStyleMask.Titled, typeof NSFontAttributeName].join("/"); });
check("appkit object", function () { var c = NSColor.colorWithSRGBRedGreenBlueAlpha(0.1, 0.2, 0.3, 1); return c.alphaComponent; });
var Target;
check("subclass extend + selector", function () {
  var hits = { n: 0 };
  Target = NSObject.extend({ fire: function (sender) { hits.n++; } }, { name: "ExactSpikeTarget", exposedMethods: { fire: { returns: interop.types.void, params: [interop.types.id] } } });
  var t = Target.new();
  t.performSelectorWithObject("fire", t);
  return hits.n;
});
check("class syntax NativeClass", function () {
  var n = 0;
  var C = (function(){ class Tk extends NSObject { tick() { n++; } static ObjCExposedMethods = { tick: { returns: interop.types.void, params: [] } }; static { NativeClass(this); } } return Tk; })();
  var o = new C(); o.performSelector("tick"); return n;
});
check("js timer via NSTimer", function () {
  globalThis.__timerHits = 0;
  globalThis.__t = NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(0.01, true, function (t) { globalThis.__timerHits++; });
  return "scheduled";
});
check("background callback routed", function () {
  globalThis.__bgHits = 0; globalThis.__bgMain = null;
  var q = dispatch_get_global_queue(0, 0);
  dispatch_async(q, function () { globalThis.__bgHits++; globalThis.__bgMain = NSThread.isMainThread; });
  return "dispatched";
});
__gc();
print("--- timings (best of 7) ---");
function empty() {}
print("empty js call", loop(1000000, empty));
var pi = NSProcessInfo.processInfo;
print("prop get (processorCount)", loop(100000, function () { return pi.processorCount; }));
print("class getter + prop (NSProcessInfo.processInfo.activeProcessorCount)", loop(50000, function () { return NSProcessInfo.processInfo.activeProcessorCount; }));
var d = NSDate.date();
print("method double return (timeIntervalSince1970)", loop(100000, function () { return d.timeIntervalSince1970; }));
print("alloc/init NSObject", loop(20000, function () { return NSObject.new(); }));
print("string in (stringWithString)", loop(20000, function () { return NSString.stringWithString("abc"); }));
print("struct return (NSMakeRect)", loop(20000, function () { return NSMakeRect(1, 2, 3, 4); }));
globalThis.__after = function () {
  print("timerHits>0", globalThis.__timerHits > 0, globalThis.__timerHits);
  print("bgHits", globalThis.__bgHits, "ranOnMain", globalThis.__bgMain);
  try { globalThis.__t.invalidate(); } catch (e) {}
};
