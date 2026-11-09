# Next steps

Where to pick up the NativeScript-in-Exact work. The pitch to keep in mind: this is not a Swift replacement. It is the
fastest way to reach the long tail of platform APIs that Exact's roughly 60 packages do not cover.

## Where it stands

- An app's `modules/apple/native.ts` implements Exact's native module in TypeScript: `native.call`, `native.later`,
  native views and element hatches. It runs on a separate lean Hermes VM on the main thread.
- It links through Exact's `modules/apple/*.xcframework` support, so Exact needs no patches. NativeScript needs one
  small patch (`patches/ns-lean-globals.patch`).
- It runs on the iOS Simulator and an iPhone 16 Pro. The macOS spike (`spike/build.sh`) tests the bridge outside any
  app, and shows why a separate VM is needed: under Exact's hardening the bridge breaks.
- A TypeScript edit rebuilds in about 20 ms. A new view tag, hatch word or framework needs a native build (about 20 s).
- In a two-run A/B, TypeScript used 13% fewer tokens and 24% less time than Swift (`docs/ab-results.md`).

## Picking it back up

- `scripts/setup.sh` fetches the pinned Exact and NativeScript sources into `vendor/`.
- `scripts/nsx.mjs` needs ns-bevy's metadata tools in a sibling checkout, or `NSX_METADATA_TOOLS` pointing at them.
- Trim with ns-bevy's `build-v1` generator. The newer generator's whitelist drops categories such as
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

## Suggested order

Next: the rest of 7 (diagnostics, teardown, several sessions), then 2, the demo, now that a phone runs it. 6 leaves
two questions:

- **The remaining ~19 MB.** After the fixes above, the bridge step still adds 5 to 12 MB (the figures are noisy:
  freed pages leave the footprint late), most of it Hermes heap the 69 KB global installer touches. Next: a lazier
  installer upstream, or the installer's bytecode evaluated in a smaller heap configuration.
- **The second Hermes.** The host links the same pinned Hermes but exports none of its symbols, so the module carries
  its own lean VM (most of its 6 MB). Sharing it needs an Exact link flag, which goes against 8: ask only with
  numbers that make the case.

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
- Try to drop the second copy of Hermes (`libnsxhermes.a`), which the module links beside the host's.
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

### 10. State the boundaries up front

The README should lead with these:

- No JavaScript runs before first pixel.
- The `app.ts` VM stays hardened and untouched.
- TypeScript modules sit at the same trust level as Swift modules and enforce their own grants.
- TypeScript modules stay out of over-the-air updates. This is a promise that still needs enforcing.
