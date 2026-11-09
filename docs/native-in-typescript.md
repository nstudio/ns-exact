# Recipe: a native module in TypeScript

The app's native module is one file, `modules/apple/native.ts`. It calls UIKit and every other
Objective-C API directly through NativeScript. Do not write Swift: `NSExactModule.swift`,
`NSExactTags.swift` and `NSExact.xcframework` are generated.

```ts
import { defineModule, exact } from 'nativescript-exact';
declare const UIDevice: any;

defineModule({
  call(request) {                     // native.call: cheap, synchronous, on main, inside the answer's 100 ms
    if (request.op === 'device') return { name: UIDevice.currentDevice.name };
    throw new Error('no such op');    // a refusal
  },
  later(request, reply) {             // native.later: reply once with reply.send(json) or reply.fail(message)
    reply.send({ ok: true });         // or return a Promise of the JSON
  },
  views: {                            // tags listed in app.json "modules"
    'my-view': (props, events) => ({  // props are strings; `value` and `src` are the box's, so name yours otherwise
      view: someUIView,
      setProps(next) {},              // all props, on every change
      destroy() {},
    }),
  },
  hatches: {                          // words in app.json "hatches"; node marked hatch="word"
    word: { element(el) { el.view.addSubview(x); }, ended(el) {} },
  },
});
```

`app.ts` asks the module as in the Swift recipe: `native.call({op})` and `await native.later({op})`, guarded by
`native?.available`.

- **Names:** Objective-C names, with selector parts joined: `addTarget:action:forControlEvents:` is
  `addTargetActionForControlEvents`, `initWithFrame:` is `initWithFrame`. Properties are properties,
  `Foo.alloc().init()` and `Foo.new()` work. Enums are `UIControlEvents.ValueChanged`. A selector argument is its
  string. Declare each global you use: `declare const UISlider: any`.
- **Check names before using them:** the `mcp__sdk-run__check_symbols` tool (load it with ToolSearch) verifies
  a class and member and gives the signature, in one call for up to 50. There is no compiler; a wrong name is
  `undefined` at run time. Swift-only APIs (`AppStore`, StoreKit 2, FoundationModels) do not exist here.
- **Subclasses, targets and delegates:** `NSObject.extend({ fire(sender) {} }, { name: 'UniqueName', exposedMethods:
  { fire: { returns: interop.types.void, params: [interop.types.id] } } })`. Keep a reference in JS, as UIKit holds
  targets weakly. `class X extends NSObject` does not work. Blocks are plain functions.
- **Events:** `events.message(text)` runs the node's `message=`; also `press()`, `change(v)`, `load()`, and
  `intrinsicSize(w, h)`, the natural size.
- **Time:** `exact.after(ms, fn)` and `exact.frames(fn)`, never `NSTimer` or `CADisplayLink`, so `clock +N` moves
  it. `exact.changed(topic)` re-asks answers that called `native.watch(topic)`.
- **Hatches:** Exact owns the node's frame and paint, including `layer` borders and backgrounds. Add subviews,
  sublayers and gesture recognizers.
- **Logs:** `console.log` shows in `bun exact.mjs agent ios logs`, and a thrown error names its line in
  `.nsx/ios-sim/native.bundle.js`.

## The loop

- Edit `native.ts`, then `bun ../../scripts/nsx.mjs js .` (about 20 ms). The next `bun exact.mjs agent ios` drive
  runs it. No native rebuild.
- A new view tag in `app.json`, a new hatch word or a new framework needs
  `bun ../../scripts/nsx.mjs build . && bun exact.mjs ios` (about 20 s). A framework the app did not link goes in
  `app.json` `host.ios.link`, as `"-framework", "Name"`.
