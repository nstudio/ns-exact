# Next steps

Where to pick up the NativeScript-in-Exact work. The pitch to keep in mind: this is not a Swift replacement. It is the
fastest way to reach the long tail of platform APIs that Exact's roughly 60 packages do not cover.

## Where it stands

- An app's module (`modules/apple/native.ts`, or `native.ios.ts` and `native.macos.ts` with shared files) implements
  Exact's native module in TypeScript: `native.call`, `native.later`, native views and element hatches. It runs on
  the main thread, on a Hermes runtime made by the Hermes in Exact's executable (`docs/shared-hermes.md`).
- It links through Exact's `modules/apple/*.xcframework` support, so Exact needs no patches. NativeScript takes two
  small patches, and its metadata generator a third (`patches/`).
- It runs on the iOS Simulator, an iPhone 16 Pro and macOS, development and release builds. `apps/atlas` is the
  demo (`docs/demo.md`); `docs/the-case.md` sets out what it changes, measured against Swift.
- A saved edit runs on the device in 0.24 to 0.47 s with no native build. A new view tag, hatch word or framework
  still needs one.
- Agents spent fewer tokens in TypeScript than in Swift or Rust (`docs/ab-results.md`), in runs too few to give an
  effect size.

## Picking it back up

- `scripts/setup.sh` fetches the pinned Exact and NativeScript sources into `vendor/`.
- `scripts/setup.sh` builds NativeScript's metadata tools into `.gen/metadata-tools` from the pinned sources.
- Trim with the `build-v1` generator (NativeScript/runtimes at `3549e19`, with
  `patches/ns-runtimes-metadata-filter.patch`). The newer generator's whitelist drops categories such as
  `UIColorSystemColors`. Whitelists also need the analyzer's default `Foundation:*` and `Runtime:*`, or the generator
  crashes.
- Each app's `target/` is 4 to 5 GB. Build copies one at a time and watch the disk.
- The generator's typings need two fixes before TypeScript parses them, which `nsx.mjs` applies: parameters named
  with reserved words (`in`), and nameless struct fields.

## Done

- **1. The checker:** `nsx.mjs check` type-checks every NativeScript module an app uses against typings for the
  whole SDK, in about 0.2 s, and `js` and `build` run it first. It reports in `contract build --json`'s shape and
  refuses a `declare` that would hide an SDK type. What it cannot see: values the SDK leaves untyped (`NSArray`
  elements, `id` returns), until they are cast. NativeScript's `.extend()` typing is patched to keep the added
  methods (`patches/ns-objc-extend-types.patch`).
- **5. Packages:** one VM per process now serves the app's own module and any number of NativeScript packages,
  each attached as a client. `packages/local-search` is a package implemented in TypeScript, and `apps/mixed` uses
  it beside a Swift app module; both ran on the iOS Simulator.
- **10. The README** leads with the boundaries.
- **6. A real iPhone:** the A/B's feature runs on an iPhone 16 Pro (iOS 26.6.2) through TypeScript, every part of
  it. Against the same feature in Swift, development builds, medians of five interleaved cold launches:

  | | Swift | TypeScript |
  |---|---:|---:|
  | First pixel (Exact's `present` mark) | 232 ms | 192 ms |
  | Native module ready, after first pixel | 17.6 ms | 61.8 ms |
  | `libexact_modules.dylib`, stripped | 0.41 MB | 6.0 MB |
  | The same, compressed | 0.14 MB | 1.8 MB |
  | Memory 8 s after launch (iOS Simulator, `footprint`) | 20 MB | 39 MB |

  First pixel is unchanged within its noise, as designed. Release builds now define a global only for each name the
  bundle reads, keep only the metadata it names (415 KB, from 919 KB), and collect garbage between startup steps:
  together 53 MB to 39 MB, and the module ready 11 ms sooner on the phone. The bridge logs what each startup step
  cost (`NativeScript start: vm … bridge … modules …`).
- **7. Partly:** every entry into JavaScript is stopped after 100 ms, verified on an infinite loop: the call failed
  with a `TimeoutError` and the app went on answering. Native views take the driver's agent input
  (`agentInput`), but Exact's iOS driver sends `type` only to its own fields, so it is untested there. The
  xcframework keeps a slice per target, so phone and simulator builds alternate without rebuilding.
  `exact.diagnostics` (`count`, `measure`, `begin`/`end`, `publish`) reaches the module's
  `context.diagnostics` through one host callback, `diag`; in `apps/nslab` a dragged slider's counter and snapshot
  showed in `agent ios state` and the geocode's span and measure in `perf hatches`. Packages get none, as Exact
  gives them none.
- **7. Several sessions:** Exact's sample host builds for an app outside its repo
  (`EXACT_APP_DIR=../../apps/nslab bun host/apple/build.mjs --ios --host nslab-apple`, about 10 s), and
  `scripts/sessions-ios.mjs` drives its two sessions of `apps/nslab` on one VM: each keeps its own slider and
  counters, and after one is destroyed the other still answers, with no late callback. Destroying a session freed
  about 3 MB (135 to 132 MB); the VM stays. A native callback (a target-action, a completion handler) runs outside
  any call, so the global `exact` cannot tell its session there: `defineModule` and `definePackage` now take a
  function of the session, made once per session as a Swift module is, and the global `exact` throws when two
  sessions make it ambiguous.
- **2. The demo, ready to record:** `packages/haptic-pattern` plays a custom CoreHaptics pattern, which no Exact
  package does (`playHaptic` plays the system's feedback generators). On the iPhone it answered "4 taps over 270 ms",
  and on the simulator, which has no haptic engine, `NotSupportedError` by name. `NSError **` takes both `null` and
  an `interop.Reference`, which the error fills (CoreHaptics -4815 on the simulator). Live tuning reaches the phone:
  `nsx.mjs js . --target ios --serve` serves the bytecode the phone's development build long-polls, signed with an
  HMAC key the build embedded; an edit to the package's source played on the phone 435 ms after the save, the VM
  not restarted. To record: one prompt to an agent with `docs/native-in-typescript.md`, the package played on the
  phone, then a live edit to the pattern.

- **Platform files, the demo and the case:** `native.ios.ts` and `native.macos.ts` with shared imports, each checked
  against its own SDK; `js --watch` for the simulator and the Mac; `apps/atlas` on iPhone and Mac, `verify ios`
  clean; the checker names the SDK's nearest member; a release build refuses a metadata filter turned off by
  dynamic global access; a 64 s video (its plan, `docs/video-plan.md`); `scripts/setup.sh` builds the metadata
  tools from the pinned sources.

## Suggested order

Next: record the demo (above), then 6's two questions, now measured:

- **The remaining ~19 MB is not the installer.** The startup log now splits each step's footprint into live
  JavaScript heap (after collection) and malloc. With release modules on the iOS Simulator, NativeScript's whole
  start adds about 5.6 MB: the VM 0.7 MB, the bridge 4.9 MB (live heap +0.1 MB, malloc +2.3 MB), the modules
  0.1 MB. A development build's bridge step adds 46 MB (malloc +22.8 MB), the cost of the full SDK metadata. The
  modules dylib's own dirty `__DATA` and `__DATA_CONST` are under 0.3 MB. So most of the gap appears after
  startup, as the module runs. Next: rebuild `apps/ab-swift-1` (4 to 5 GB) and diff `footprint`'s categories
  against `apps/ab-ns-1`; nslab's 35 MB is mostly MALLOC_SMALL (15 MB) and untagged VM_ALLOCATE (6.3 MB, the
  Hermes heaps: Exact's and this one).
- **The second Hermes was about 1.9 MB, now gone** (`docs/shared-hermes.md`). A link map of the phone's `libexact_modules.dylib` (development build,
  `-Xlinker -map` in `host.ios.link`): the lean VM 1.83 MB and JSI 0.05 MB, against the NativeScript bridge's
  2.95 MB and the development blob's 4.63 MB (full metadata and bytecode). Sharing Exact's Hermes would save about a
  third of the stripped 6 MB; trimming the bridge's code is the larger lever, and one that needs nothing from Exact.

## Ready to start

Each step below ends with something to drive and check. Before any device or new-app build, check free disk
(`df -h`): each app's `target/` grows by 4 to 5 GB per platform.

- **A stronger A/B:** five runs per condition of a tuning task with no new view tag (Atlas's haptic signature to a
  description, a wrong sentiment threshold), with equal-length recipes, in TypeScript, Swift and Rust. About 1 to
  1.5M tokens of agent work.
- **Android:** waits on two changes in Exact (Hermes handed to modules, a module's native library packed into the
  APK), then NativeScript's JNI backend built for Exact; `docs/shared-hermes.md`, "Android, where it stands".
- **Windows and Linux:** Node-API on the Hermes that runs `@nativescript/windows-napi` and linux-runtime's
  `linux-napi`; the README's "Every platform Exact targets" gives the three ways, in order.
- **Lower deployment targets:** the bundled libffi is built for iOS 26.4 and macOS 26.0; build it for the oldest
  targets Exact supports.
- **Where the memory goes:** rebuild `apps/ab-swift-1` and `apps/ab-ns-1` for the simulator, launch each, and diff
  `footprint <pid>`'s categories 8 s after launch. Done when each MB of the gap has a category.
- **A smaller bridge:** `NativeApiJsi.mm` compiles to 2.95 MB at `-Os`. Try `-Oz`, `-ffunction-sections` with
  dead stripping, and `NS_GSD_BACKEND_HERMES` on or off, measuring the stripped dylib and a call's speed each time.
- **Callback errors:** propose the reporting policy (item 9) upstream, with the abort a completion handler's error
  caused in `apps/nslab` as the case.
- **Swift-only APIs:** a generated Swift shim per API that exposes it to Objective-C, so a module reaches StoreKit 2
  or FoundationModels too.

## More compelling

### 1. Add a native-API checker

Having no compiler is the weakest point. A wrong name is `undefined` at run time, where Swift would fail the build.

- Add `nsx check`, validating every native class and member in `native.ts` against SDK metadata.
- Report in the shape of `contract build --json`: stable ids and source ranges. This fits Exact's "mistakes are
  refusals that say what to do."
- Starting points: `ns-metadata-symbols` already finds the top-level names, the generator can emit `.d.ts` files, and
  the `sdk-run` index shows the checks wanted. The full typings are too large for agents to read (`AppKit.d.ts` alone
  is about 190k tokens), so the checker should do this work for them.

### 2. Record a demo Swift cannot match for speed

One prompt, an API no package covers (CoreHaptics, or a third-party Objective-C SDK), running on a real iPhone, with
live tuning from TypeScript.

### 3. Run a stronger A/B

The current one is two runs each of a single feature, and its recipe favoured TypeScript.

- Five or more runs per condition, across several feature types.
- Equal-length recipes for both conditions.
- Include debugging and tuning work with no new view tags. That is where TypeScript should gain most, but it is
  unmeasured.

### 4. Try Android

Exact has about 12,600 lines of Kotlin across its packages, and its Android support is early, so the benefit could be
larger there.

- NativeScript has a Hermes JSI backend in `NativeScript/ffi/jni/jsi`. It evaluates source in three places
  (`Engine.cpp`, `global/GlobalHelpers.cpp`, `jsonhelper/JSONObjectHelper.cpp`), which a lean VM cannot do, so those
  need precompiling.
- Android hatches in Exact are Rust and hand over no platform object, so modules and views are the target.

## More practical

### 5. Package it to work alongside Swift

Today it takes over the app's one native module (`let exactModule`), so adoption is all-or-nothing. Exact already
composes packages into that module: see `composedModule` in `host/apple/build.mjs`, `host/apple/modules/ExactPackage.swift`
and `packages/*/exact.json`. Make this a package, so TypeScript and Swift can coexist.

### 6. Measure against Exact's budgets on a real iPhone

Exact tracks its budgets on every commit (`rules/RULES.md`), so these numbers will carry the most weight.

- Report cold start, memory and binary size with and without the module.
- Known so far, on the simulator: the module is ready about 43 ms after first pixel with trimmed metadata and about
  165 ms with full metadata. On macOS, the bridge installs in about 10 ms and adds about 9 MB when trimmed.
- The second copy of Hermes (`libnsxhermes.a`, about 1.9 MB) is gone: `docs/shared-hermes.md`.
- Turn on generated signature dispatch (`NS_GSD_BACKEND_HERMES`, off for now) and measure call speed.
- The current libffi prebuilts force iOS 26.4. Rebuild them for Exact's iOS 17 floor.

### 7. Close the agent-tooling and lifecycle gaps

- `agentInput` is bridged; exercise it on the Mac, whose driver sends `type` to native views.
- Bridge `context.diagnostics` (`count`, `measure`, `publish`) and a hatch's `owns` and `parts`, so TypeScript is as
  visible to the agent as Swift.
- Bridge the remaining hatches: app, window, route, navigation and tabs.
- Test several sessions in one process (ExactKit embeds them), and implement clean teardown. `nsx_destroy` deliberately
  leaves the VM alive for now.
- Run the macOS target in a real app.

## More welcome

### 8. Ask Exact for nothing

Its rules resist added apparatus and speculative specs. Stay zero-patch, and arrive with a working package and numbers.

### 9. Fix the NativeScript side first

- `class X extends NSObject` with `NativeClass` fails, while `.extend` works.
- Add an installer option for lean VMs, replacing `patches/ns-lean-globals.patch`.
- Fix the metadata generator's dropped categories, its whitelist crashes, and its typings' reserved-word parameters
  and nameless fields.
- Upstream `patches/ns-objc-extend-types.patch`, and type `NSArray` element classes so completion handlers are
  checked.
- Ship libffi at a lower deployment target.
- An error thrown in a native callback outside any call from JavaScript (a target-action, a completion handler)
  is rethrown as an `NSException` and aborts the app (`nativeApiEngineCallbackTrampoline` in
  `ffi/objc/shared/bridge/Callbacks.mm`). Offer a policy that reports it instead, as `uncaughtErrorPolicy: 'report'`
  does in `@nativescript/core` 9.1.

### 10. State the boundaries up front

The README should lead with these:

- No JavaScript runs before first pixel.
- The `app.ts` VM stays hardened and untouched.
- TypeScript modules sit at the same trust level as Swift modules and enforce their own grants.
- TypeScript modules stay out of over-the-air updates. This is a promise that still needs enforcing.
