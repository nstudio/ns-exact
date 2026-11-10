# NativeScript in Exact

**Write an [Exact](https://github.com/expo/exact) app's native code in TypeScript, calling UIKit, MapKit and
every other Objective-C API directly, with no Swift and no native rebuild per edit.**

Exact's ~60 packages cover the common platform APIs. This reaches the rest: an app's own native module, or a
package, is a TypeScript file run by [NativeScript](https://nativescript.org) on a Hermes runtime of its own, made
by the Hermes Exact already links (`docs/shared-hermes.md`).

> Experimental. Runs on the iOS Simulator, an iPhone 16 Pro and macOS; Android, Windows and Linux have a path
> (below), not yet a build. Not an official Exact or NativeScript release.

## The boundaries

What this does not change, so Exact's guarantees hold:

- **No JavaScript runs before first pixel.** The VM starts when Exact loads native modules, after first pixel.
- **`app.ts` is untouched.** Its VM stays hardened and deterministic. NativeScript has a VM of its own, because
  Exact's hardening breaks NativeScript (`spike/build.sh` shows both).
- **The same trust as Swift.** A TypeScript module sits where a Swift module sits and has the same reach. It
  enforces its own grants, as a Swift module does.
- **No code over the air.** Exact's signed updates carry plans and assets, not modules. TypeScript modules must
  stay out of them; this is a rule to enforce, not yet enforced.
- **No patches to Exact.** It links through Exact's existing `modules/apple/*.xcframework` support. NativeScript
  takes two small patches (`patches/`).

## What it looks like

An app's whole native module, `modules/apple/native.ts`:

```ts
import { defineModule } from 'nativescript-exact';

defineModule({
  call(request) {                        // app.ts: native.call({ op: 'device' })
    return { name: UIDevice.currentDevice.name };
  },
  views: {
    'ns-slider': (props, events) => {    // Contract: ns-slider level=level message=moved
      const slider = UISlider.new();
      // …target-action into events.message(String(slider.value))
      return { view: slider };
    },
  },
});
```

Or a package Contract calls directly, beside a Swift module (`apps/mixed`):

```contract
use searchNearby, PlaceResult from "@ns-exact/local-search"
```

## Every platform Exact targets

NativeScript's model is the same on every platform: generated metadata describes the platform's own APIs, the
runtime binds JavaScript to them directly, and generated typings let a checker refuse a wrong name before anything
runs. What differs is the API family and how the runtime attaches to a JavaScript engine. For Exact the question on
each platform is the one iOS answered: can NativeScript run on the Hermes Exact already links, and can Exact load
it where it loads a native module?

| Platform | NativeScript runtime | What TypeScript reaches | How it binds | What Exact needs | Status |
|---|---|---|---|---|---|
| iOS, macOS | [`NativeScript/runtimes`](https://github.com/NativeScript/runtimes) (`ffi/objc`) | Every Objective-C API: UIKit, AppKit, MapKit, CoreHaptics, a vendor's SDK | JSI, on a runtime made by Exact's own Hermes (`docs/shared-hermes.md`) | Nothing: it links through `modules/apple/*.xcframework` | Done: `apps/atlas`, `apps/nslab`, `apps/nsmac` |
| Android | [`NativeScript/runtimes`](https://github.com/NativeScript/runtimes) (`runtime/android/jsi`, `ffi/jni/jsi`), the backend `@nativescript/react-native` runs on Android | Every Java and Kotlin API, through JNI, from the app's metadata | JSI, as on Apple: `tns::Runtime::Attach` takes an existing `jsi::Runtime` | Two changes: hand modules its Hermes (`makeHermesRootAPI`; `libexactcanvas.so` keeps it local today), and pack a module's native library into the APK (`modules/android` is Kotlin only) | A path, measured: `docs/shared-hermes.md`, "Android, where it stands" |
| Windows | [`@nativescript/windows-napi`](https://www.npmjs.com/package/@nativescript/windows-napi) ([`NativeScript/windows`](https://github.com/NativeScript/windows)) | The Windows Runtime, .NET, and any DLL's exports (`win32.bind('kernel32.dll')`) | Node-API: a native addon for any Node-API host (Node, Bun, Deno, and the `hermes.dll` React Native for Windows loads, in NativeScript/runtimes#112) | Node-API on the Hermes that runs it (below) | A path |
| Linux | [`@nativescript/linux`](https://www.npmjs.com/package/@nativescript/linux) and `@nativescript/linux-napi` ([`triniwiz/linux-runtime`](https://github.com/triniwiz/linux-runtime)) | C libraries, from their headers: GTK 3 and 4, GLib, D-Bus, cairo, Pango, EGL, X11, libc | A V8 runtime, and the same runtime over Node-API (its `napi/`), on QuickJS, V8, JavaScriptCore or Hermes | Node-API on the Hermes that runs it (below); Exact's Linux host does not run TypeScript yet (`reference.md`, "Limits") | A path |

Windows and Linux meet at one requirement. Both runtimes bind through Node-API, and Exact's Hermes carries none
(no `napi_*` symbol and no `js_native_api.h` in its pinned bundle, checked on macOS). Any of three ways gives it to them, in order of preference:

- **Exact builds its Hermes with Node-API**, as `microsoft/hermes-windows` is built, which linux-runtime's Hermes
  engine already runs on. One Hermes per process stays true, and both runtimes attach as they are.
- **A Node-API shim over JSI**, carried by the module, in the style of the shims linux-runtime's `engines/` puts over
  QuickJS, V8 and JavaScriptCore. It needs nothing from Exact beyond the Hermes it already hands out on Apple; it
  does not exist yet.
- **The module brings a Hermes with Node-API**, as NativeScript/runtimes#112 does on React Native for Windows: it
  works today, at the cost of a second engine in the process (about 1.9 MB on iOS, before it was removed there).

On Android, Windows and Linux, Exact paints its own pixels, so a module there reaches the platform's APIs (calls,
laters, data, devices) rather than placing the platform's views in Exact's layout, as `modules/apple` views do. Exact
already admits a native library per target for a package (`exact.json` `native.library`, pinned by SHA-256), which
is where a NativeScript runtime for those hosts would ship. One TypeScript module per platform
(`native.android.ts`, `native.windows.ts`, `native.linux.ts`, beside `native.ios.ts` and `native.macos.ts`) then
gives an app the same reach on every target Exact builds, with the checker, the live loop and the session's clock
as `docs/native-in-typescript.md` describes them for Apple.

## Why

- **Reach:** any Objective-C API, including ones no Exact package wraps, such as MapKit's local search in
  `packages/local-search`.
- **The loop:** a saved edit runs on the device 0.26 s later on the Mac, 0.24 to 0.39 s on the iOS Simulator and
  0.43 to 0.47 s on an iPhone over Wi-Fi, with the app's state kept. The same edit in a Swift module took 12.6 to
  13.4 s to reach the simulator's screen, relaunched (`docs/the-case.md`).
- **Mistakes are refused:** `nsx.mjs check` type-checks against the whole SDK in under a second, reports in
  `contract build --json`'s shape, and names the SDK's nearest member for a misremembered one, so a hallucinated
  selector is a refusal with its fix, not `undefined` at run time.
- **The cost:** first pixel unchanged on an iPhone, the module ready about 45 ms later than a Swift one. A release
  build keeps only the SDK metadata its bundle names (Atlas: 432 KB of iOS's 4.5 MB), and on the Mac NativeScript
  then starts in 3.5 to 4.6 ms and adds 2.4 to 2.6 MB; its modules library is 3.9 MB stripped, 1.0 MB compressed.
  A call costs more than Swift's: about 1.3 µs for an Objective-C property where Swift takes 0.27 µs
  (`docs/the-case.md`).
- **Tokens:** in a small A/B, agents writing TypeScript used 13% fewer tokens and 24% less time than agents
  writing Swift (`docs/ab-results.md`). Two runs each, so treat it as a direction.

## Run it

You need macOS, Xcode, Rust and Bun 1.4.2, plus NativeScript's metadata generator and symbol analyzer:
a sibling `ns-bevy` checkout ([native-shell-with-ns](https://github.com/nstudio/native-shell-with-ns)) built with
its `scripts/build-metadata-tools.sh`, or `NSX_METADATA_TOOLS` pointing at those tools.

```sh
scripts/setup.sh                          # pinned Exact and NativeScript, patched
cd apps/nslab
bun ../../scripts/nsx.mjs build .         # the bridge, the module's bytecode, NSExact.xcframework
bun exact.mjs ios --run                   # Exact's own build, on a simulator
bun ../../scripts/nsx.mjs js .            # after an edit to native.ts: checked and reloaded
```

`docs/native-in-typescript.md` is the recipe an agent reads. `docs/next-steps.md` is what is left.

## Layout

| Path | What |
|---|---|
| `bridge/` | The C seam (`nsx.mm`), the JavaScript runtime (`runtime.ts`), and the Swift adapters for an app module and a package |
| `scripts/nsx.mjs` | `check`, `js`, `build`, `package` |
| `scripts/sessions-ios.mjs` | Two sessions of `apps/nslab` in Exact's sample host: apart, then one destroyed under the other |
| `packages/local-search` | A package implemented in TypeScript |
| `packages/haptic-pattern` | A custom CoreHaptics pattern, which no Exact package plays; `apps/nslab` uses it |
| `apps/atlas` | The demo, on iPhone and Mac: a 3D MapKit flyover, NaturalLanguage, haptics; shared and platform files (`docs/demo.md`) |
| `apps/nsmac` | A macOS module in TypeScript: a call, a later, an `NSSlider` view |
| `apps/nslab` | An app module in TypeScript: a call, a later, a native view, a hatch, diagnostics |
| `apps/mixed` | A Swift app module beside the TypeScript package |
| `apps/ab-*` | The A/B's four apps, as the agents left them except the `declare` lines the checker now refuses; `ab-ns-1` and `ab-swift-1` are the device comparison |
| `spike/` | The bridge on macOS outside any app, in its own VM and under Exact's hardening |
| `patches/` | NativeScript patches |

## License

[MIT](LICENSE), except `patches/`, which modify Apache-2.0 [NativeScript runtimes](https://github.com/NativeScript/runtimes)
sources and are [Apache-2.0](LICENSE-APACHE).
