# NativeScript in Exact: what it changes

Exact writes the web and ships the platform: an app is Contract and TypeScript, and each host draws its own
controls. Its ~60 packages cover the common platform APIs (camera, maps, health, payments, speech). What they do
not cover is the long tail, and today the long tail is a native module in Swift, Kotlin or Rust. This work makes
that module TypeScript on iOS and macOS: NativeScript calls every Objective-C API directly, typed against the SDK,
on the Hermes Exact already links. Everything below was measured on an iPhone 16 Pro, an iPhone 17 Pro simulator
and an M-series Mac, on 2026-11-09, with Exact at `94b8671`.

## The dynamics

- **Where it runs.** The module is a TypeScript file in `modules/apple`, built by `scripts/nsx.mjs` into the
  `NSExact.xcframework` Exact already links for Swift modules. It runs on its own Hermes runtime, made by the Hermes
  in Exact's executable (no second copy), on the main thread, with each entry stopped after 100 ms.
- **What it answers.** The same seam a Swift module has: `native.call` and `native.later` from `app.ts`, native
  views by tag, access hatches on Exact's own views, the session's clock and diagnostics. `app.ts` cannot tell the
  difference.
- **What stays Exact's.** No JavaScript before first pixel; `app.ts` keeps its hardened VM; the module has a Swift
  module's trust and reach, no more; a release build runs only the bytecode built into it. Exact needed no
  patches.

## The gains, measured

### The loop: no native rebuild

The same kind of edit (change what the native code returns), from the save to the new behaviour on screen:

| | Swift module (`apps/mixed`) | TypeScript module (`apps/atlas`) |
|---|---:|---:|
| iOS Simulator | 12.6 to 13.4 s (10.8 to 11.7 s of it the build and install) | 0.24 to 0.39 s |
| iPhone 16 Pro, over Wi-Fi | a build, a signed install and a relaunch (not timed here) | 0.43 to 0.47 s |
| Mac | a native build and a relaunch (not timed here) | 0.26 s |
| The app relaunched, its state lost | yes | no: the screen stays where it was |
| Build output an agent reads, per edit | 1.9 KB, 19 lines | one line |

Three runs each. The Swift module is nine lines; a larger one compiles longer, and Exact's own guide puts a first
native build at about 13 minutes and later ones at a minute or two. Exact's live reload reaches plans, assets,
`app.ts` and Rust modules on a running native app, but not Swift: a Swift module is the one part of an Exact app
that needs a native build for every change.

### Mistakes, refused early and with the answer

A misremembered selector, `CHHapticEngine`'s start method written as `startWithCompletion`:

| | Swift | TypeScript |
|---|---|---|
| Found after | 8.9 s (a native build) | 0.5 s (`nsx.mjs check`, which `js` and `build` run first) |
| What it says | `value of type 'CHHapticEngine' has no member 'startWithCompletion'` | the same, then `The SDK's nearest: startWithCompletionHandler(completionHandler: ((p1: NSError) => void) \| null): void` |
| What runs meanwhile | nothing: the build failed | the last good code; the app keeps running |

The checker type-checks every module against typings for the whole SDK and reports in `contract build --json`'s
shape, with ids an agent can act on (`ns-unknown-member`, `ns-unknown-name`, `ns-shadowed`). The typings
themselves are far too large to read (`AppKit.d.ts` alone is about 190k tokens), so the checker reads them for
the agent and hands back the one signature it needs.

### Tokens

- **Per iteration**, measured above: a Swift edit returns 1.9 KB of build output (about 475 tokens) after 11 s; a
  TypeScript edit returns one line after a quarter of a second. A mistake costs a Swift agent a build and a guess;
  the checker answers with the right signature.
- **Three ways, one task** (`docs/ab-results.md`): three agents added Apple's NaturalLanguage to the same Exact app,
  then changed it once. TypeScript used 68.8k tokens, Swift 80.5k, Rust 94.5k (Exact's Rust shim reaches Objective-C
  only by hand, through `objc_msgSend`: 158 untyped lines against TypeScript's 18). TypeScript's change needed no
  native build; Swift's and Rust's did. One run each.
- **Per task**, in an earlier small A/B (`docs/ab-results.md`): four agents added the same feature (a synchronous call, a
  native date picker view, an asynchronous haptic) to identical apps. TypeScript used 13% fewer tokens (78 to 85k
  against 92 to 96k), 24% less time (158 to 161 s against 203 to 215 s) and one native build against three or four.
- **What that does not show.** Two runs each; the TypeScript recipe was shorter, which favours it; and the task
  added a view tag, which forces one native build in TypeScript too. The finished modules were about the same size
  (1,060 to 1,126 tokens against 1,256): the saving is the loop, not the code. Tuning and debugging, where the loop
  repeats most, is where the gain should be largest, and it is not yet measured (below, "To make the case").

### Reach, typed, on two platforms from one file

`apps/atlas` uses MapKit's 3D camera and imagery, NaturalLanguage, CoreHaptics and AppKit's haptics, two of them
covered by no Exact package and one beyond what `@exact/maps` exposes. The shared code (`atlas.ts`) is checked
against the iOS SDK and the macOS SDK; `native.ios.ts` and `native.macos.ts` hold only what differs (haptics, the
map's chrome). In Swift that split is `#if os(iOS)` inside one file, compiled twice; here each platform's file is
checked against its own SDK, so `UIView` in code the Mac runs is an error before anything builds.

### Agents can drive it

Native views take the agent's input (`type slider 80` on the Mac), `session.diagnostics` reaches `agent state` and
`perf`, `session.agent` tells the module when Exact's virtual clock is in charge, and `verify ios` runs Atlas's
tests against the TypeScript module and reads its screens in light, dark and at the largest text size: clean.

## The costs, measured

| | Swift module | TypeScript module |
|---|---:|---:|
| First pixel (iPhone, medians of five cold launches) | 232 ms | 192 ms (unchanged within noise) |
| Native module ready after first pixel (iPhone, development build) | 17.6 ms | 61.8 ms |
| NativeScript's start, release build (Mac, `apps/nsmac`) | | 8.2 ms, +4.4 MB |
| Memory, development build (simulator, 8 s after launch) | 20 MB | 39 MB |
| An Objective-C property, per call (simulator, development) | 0.27 µs | 1.35 µs |
| Creating an `NSMutableArray`, per call | 0.04 µs | 7.4 µs |
| Atlas, release, Mac: NativeScript's start | | 3.5 to 4.6 ms, +2.4 to 2.6 MB |
| Atlas, release: SDK metadata kept | | 432 KB of 4.5 MB (iOS), 533 KB of 6.0 MB (Mac) |
| `libexact_modules.dylib`, stripped (compressed) | 0.41 MB (0.14 MB), development | release 3.9 MB (1.0 MB), Mac; development 7.9 MB (2.1 MB), iOS |

A development build carries the whole SDK's metadata so any API can be reached without a rebuild: that is most of
its memory (the bridge's start adds 46 MB on the simulator, 88 MB on the Mac). A release build keeps only the
metadata the bundle names.

## Native modules in Exact today, and what NativeScript does about each

| Where a native module costs today | What NativeScript changes |
|---|---|
| Every Swift edit is a native build, an install and a relaunch: 11 to 13 s warm for a nine-line module, minutes cold | Edits run in under half a second, on a phone too, with the app's state kept. A new view tag, hatch word or framework still needs one native build |
| Exact's live reload stops at Swift | The module reloads like the rest of the app: Contract and `app.ts` through Exact's dev loop, the native module through `nsx.mjs js --watch` or `--serve` |
| A wrong API name is found by the compiler after a build, with no suggestion | Found in half a second, with the SDK's nearest signature |
| Glue: an `ExactModule` subclass, `[String: Any]` casts, an `ExactNativeInstance` subclass per view, `#if os()` per platform | Plain functions returning JSON-shaped objects; a view is a function returning `{ view, setProps }`; platform files |
| `app.ts` and the module are two languages; an agent switches between them | One language from Contract's data module to UIKit, with the same types and tools |
| The long tail (NaturalLanguage, custom haptics, MapKit's camera, a vendor's Objective-C SDK) waits for a package | Any Objective-C API, typed, from the app: a package can follow once the use is proven (`packages/haptic-pattern` is one, written the same way) |
| A package in Swift is a Swift module per platform | A package's `apple/native.ts` (or its platform files) serves iOS and macOS, beside Swift ones (`apps/mixed`) |

## What NativeScript does not do, or not yet

- **Swift-only APIs are out of reach.** NativeScript calls Objective-C: SwiftUI, StoreKit 2, FoundationModels,
  WeatherKit's Swift API, App Intents and WidgetKit's Swift surface are not callable. For those a Swift module
  remains the answer, and the two sit side by side.
- **Android, Windows and Linux are not done.** Android waits on two changes in Exact (handing modules its Hermes,
  packing a module's native library into the APK), then NativeScript's JNI backend built for Exact. Windows and
  Linux bind through Node-API, which Exact's Hermes does not include (`docs/shared-hermes.md`).
- **The main thread and its budget.** Every entry runs on the main thread and is stopped after 100 ms; a native
  call that blocks cannot be stopped, only reported. Long work belongs in a Promise a completion handler settles.
- **An error in a native callback aborts the app.** One thrown in a target-action or a completion handler, outside
  any call from Exact, becomes an Objective-C exception. The recipe says to catch there; a reporting policy is
  proposed, not built.
- **Some values are untyped.** An `NSArray` element or an `id` return is `any` until it is cast.
- **Deployment targets.** The bundled libffi is built for iOS 26.4 and macOS 26.0, so the apps target those.
- **Development memory and size**, above: a development build carries the whole SDK's metadata.
- **Experimental.** Not an Exact or NativeScript release. Release builds carry no reload path and run only what was
  built in, as React Native's do; code over the air would break Exact's signed-update model and is not allowed, by
  rule rather than yet by check.

## To make the case

1. **A stronger A/B, on tuning rather than creation.** Five runs per condition of a task with no new view tag (tune
   Atlas's haptic signature to a description, fix a wrong sentiment threshold), with equal-length recipes. That is
   where the loop repeats, and where tokens and minutes should diverge most. About 1 to 1.5M tokens of agent work.
2. **Android**, after Exact's two changes.
3. **Memory**: diff the categories of a Swift and a TypeScript app's footprint, and trim the bridge (2.95 MB of
   code at `-Os`).
4. **Swift-only APIs**: a small, generated Swift shim per API that exposes it to Objective-C, so the TypeScript
   module reaches it too.
