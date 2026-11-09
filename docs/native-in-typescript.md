# Recipe: a native module in TypeScript

The app's native module is one file, `modules/apple/native.ts`. It calls UIKit and every other
Objective-C API directly through NativeScript. Do not write Swift: `NSExactModule.swift`,
`NSExactTags.swift` and `NSExact.xcframework` are generated.

```ts
import { defineModule, exact } from 'nativescript-exact';

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
  string. Every SDK class, function and constant is already declared, with its types: never `declare` one.
- **The checker:** `bun ../../scripts/nsx.mjs check .` type-checks `native.ts` against the whole SDK in under a
  second, and `js` and `build` run it first and stop on an error. Each line is `file:line:col [id] message`
  (`--json`: `contract build --json`'s shape). `ns-unknown-member` and `ns-unknown-name` are a misspelled or
  hallucinated API. Swift-only APIs (`AppStore`, StoreKit 2, FoundationModels) do not exist here.
- **Cast what the SDK leaves untyped:** an `NSArray` element, an `id` return or a completion handler's array is
  `any`, and nothing read from it is checked. Name its class: `items.objectAtIndex(0) as MKMapItem`.
- **Subclasses, targets and delegates:** `NSObject.extend({ fire(sender) {} }, { name: 'UniqueName', exposedMethods:
  { fire: { returns: interop.types.void, params: [interop.types.id] } } })`. Keep a reference in JS, as UIKit holds
  targets weakly. `class X extends NSObject` does not work. Blocks are plain functions.
- **The 100 ms budget:** every entry into `native.ts` runs on the main thread and is stopped after 100 ms. A
  `call` then refuses and a `later` fails, with `TimeoutError: native.ts ran longer than 100 ms…` in `logs`. Long
  work goes into a Promise that a native completion handler settles.
- **Agent input:** a view's `agentInput(input)` takes the driver's `type`: `{text}` replaces its value, `{key,
  phase}` presses a key; throw before changing anything to refuse. Exact's iOS driver does not send `type` to
  native views yet (the Mac's does), so on iOS drive a native view with `--touch platform`: for a slider,
  `agent ios --touch platform "tap slider drag 80 0 over 300"` (a tap on its track moves nothing).
- **Events:** `events.message(text)` runs the node's `message=`; also `press()`, `change(v)`, `load()`, and
  `intrinsicSize(w, h)`, the natural size.
- **Time:** `exact.after(ms, fn)` and `exact.frames(fn)`, never `NSTimer` or `CADisplayLink`, so `clock +N` moves
  it. `exact.changed(topic)` re-asks answers that called `native.watch(topic)`.
- **Hatches:** Exact owns the node's frame and paint, including `layer` borders and backgrounds. Add subviews,
  sublayers and gesture recognizers.
- **Logs:** `console.log` shows in `bun exact.mjs agent ios logs`, and a thrown error names its line in
  `.nsx/ios-sim/native.bundle.js`.
- **Diagnostics:** `exact.diagnostics.count(name, by?)`, `measure(name, ms)`, `begin(name).end()` and
  `publish(name, value)`, as Swift's `context.diagnostics`. Counters and snapshots show in `agent ios state` under
  `hatches.scopes.module`, timings in `agent ios perf hatches`. Names are lowercase letters, digits, `-` and `.`.

## The loop

- Edit `native.ts`, then `bun ../../scripts/nsx.mjs js .` (the check and bytecode, well under a second). The next
  `bun exact.mjs agent ios` drive runs it. No native rebuild.
- A new view tag in `app.json`, a new hatch word or a new framework needs
  `bun ../../scripts/nsx.mjs build . && bun exact.mjs ios` (about 20 s). A framework the app did not link goes in
  `app.json` `host.ios.link`, as `"-framework", "Name"`.

## A package in TypeScript

A package keeps working beside an app's own Swift module. Contract calls its names directly, with
`use … from "@scope/name"`, as it calls any Exact package; `packages/local-search` is a whole one,
and `apps/mixed` uses it beside a Swift module.

- `exact.json` is an ordinary Exact interface: its shapes, its `names` (a `source` or a `send`, with
  `options` and `answers`) and its `views`.
- `apple/exact.json` is the implementation: `"sources": {"swift": ["NSExactPackage.swift"]}`, a `class` name
  unique in the app, and the system `frameworks` it needs.
- `apple/native.ts` answers each name:

  ```ts
  import { definePackage } from 'nativescript-exact';
  export default definePackage({
    names: {
      searchNearby: ({ query }) => new Promise((resolve, reject) => { /* … */ }),  // a send's or a source's answer
    },
    views: { 'ns-spinner': (props, events) => ({ view, setProps(next) {} }) },
  });
  ```

  A handler returns the answer or a Promise of it. One that throws or rejects answers `{error}` with the
  error's `name`, a DOMException name such as `NotSupportedError` or `TypeError`, else `OperationError`.
- `bun scripts/nsx.mjs package <package dir>` writes `apple/NSExactPackage.swift`, the package's adapter. Run it
  again after a change to `class` or the package's name.
- The app installs it like any package (`"@scope/name": "file:<path>"` in `package.json`, then `bun install`).
  `nsx.mjs check`, `js` and `build` find every NativeScript package the app uses, with Exact's own resolver, and
  check and bundle them with the app's `native.ts`, if it has one, into one VM.
- A package has `exact.after`, but not `exact.frames`, hatches or diagnostics: Exact gives packages none of them.
