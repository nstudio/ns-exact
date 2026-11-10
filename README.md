# NativeScript in Exact

**Write an [Exact](https://github.com/expo/exact) app's native code in TypeScript, calling UIKit, MapKit and
every other Objective-C API directly, with no Swift and no native rebuild per edit.**

Exact's ~60 packages cover the common platform APIs. This reaches the rest: an app's own native module, or a
package, is a TypeScript file run by [NativeScript](https://nativescript.org) on a Hermes VM of its own.

> Experimental. Run on the iOS Simulator and an iPhone 16 Pro; not yet on macOS or Android. Not an official Exact
> or NativeScript release.

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

## Why

- **Reach:** any Objective-C API, including ones no Exact package wraps, such as MapKit's local search in
  `packages/local-search`.
- **The loop:** a TypeScript edit is checked and running in about 20 ms, with app state kept. A Swift edit
  is a native build.
- **Mistakes are refused:** `nsx.mjs check` type-checks against the whole SDK in under a second and reports in
  `contract build --json`'s shape, so a hallucinated selector is a refusal, not `undefined` at run time.
- **The cost, on an iPhone:** first pixel unchanged; the module ready about 45 ms later than a Swift one; +1.7 MB
  compressed download; about +19 MB of memory (`docs/next-steps.md`, item 6).
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
| `apps/nslab` | An app module in TypeScript: a call, a later, a native view, a hatch, diagnostics |
| `apps/mixed` | A Swift app module beside the TypeScript package |
| `apps/ab-*` | The A/B's four apps, as the agents left them except the `declare` lines the checker now refuses; `ab-ns-1` and `ab-swift-1` are the device comparison |
| `spike/` | The bridge on macOS outside any app, in its own VM and under Exact's hardening |
| `patches/` | NativeScript patches |

## License

[MIT](LICENSE), except `patches/`, which modify Apache-2.0 [NativeScript runtimes](https://github.com/NativeScript/runtimes)
sources and are [Apache-2.0](LICENSE-APACHE).
