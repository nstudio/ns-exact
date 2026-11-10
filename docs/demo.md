# The demo: Atlas on iPhone and Mac

`apps/atlas` is one Exact app whose whole native layer is TypeScript, run by NativeScript. On both platforms:

- **A 3D flyover** of five landmarks: MapKit's camera, pitched and orbiting, over satellite imagery with realistic
  elevation. Exact's `@exact/maps` shows a 2D map with markers; the camera, the pitch and the imagery are the long
  tail that one more property reaches.
- **Read the room:** NaturalLanguage reads what you type as you type it: its language, its mood, and the people and
  places it names. No Exact package covers NaturalLanguage.
- **Feel it:** a haptic signature. On the iPhone a CoreHaptics pattern (three rising taps and a swell), which no
  Exact package plays; on the Mac, three beats on the trackpad.
- **The live strip** says which file runs (`native.ios.ts` or `native.macos.ts`), and after each saved edit, how
  long the edit took from the save to running on that device.

The native code is three files in `apps/atlas/modules/apple`: `atlas.ts` (what both platforms share, about 180
lines), `native.ios.ts` (CoreHaptics, 43 lines) and `native.macos.ts` (AppKit haptics, 22 lines). No Swift was
written. `bun exact.mjs verify ios` is clean: its three tests pass against the TypeScript module, and its screens
read in light, dark and at the largest text size.

## Measured

| | iPhone 16 Pro | iOS Simulator | Mac |
|---|---:|---:|---:|
| A saved edit of the native code, to running on the device | 429 to 465 ms | 240 to 392 ms | 256 to 257 ms |
| Native builds for that edit | 0 | 0 | 0 |
| App relaunched | no | no | no |
| A misremembered selector, refused with the real one named | 0.2 to 0.5 s | | |

The edit times are the app's own reading (`bundleStamp()`: the newest source's save time against the moment the
new code ran), confirmed by the agent's drive (`418 ms` on the phone, `263 ms` on the Mac). The phone's figure
includes Wi-Fi: it long-polls `js --serve` on the Mac and runs only what is signed with the key its build embedded.

The same change in a Swift module is a native build, an install and a relaunch, losing the screen's state: see
`docs/the-case.md`, "The loop", for that measurement.

## Setting up

Once, on the Mac that presents (after `scripts/setup.sh` and the metadata tools in the README):

```sh
cd apps/atlas
bun ../../scripts/nsx.mjs build . --target ios        # the phone's slice; embeds this Mac's address
bun ../../scripts/nsx.mjs build . --target ios-sim
bun ../../scripts/nsx.mjs build . --target macos
bun exact.mjs ios --device --phone <UDID> --run        # installs on the iPhone (USB or the same Wi-Fi)
bun exact.mjs mac                                      # builds the Mac app
```

- On the phone, accept "Atlas would like to find devices on your local network" at the first launch: it is how
  the phone reaches `js --serve`. Turn on Developer Mode once (Settings, Privacy & Security).
- The phone and the Mac on the same network, and the phone kept awake (Settings, Display, Auto-Lock: Never).
- The address is the Mac's at build time. On another network (a venue's Wi-Fi), build the phone's slice again:
  `nsx.mjs build . --target ios`, then `bun exact.mjs ios --device --phone <UDID>`, about two minutes. A personal
  hotspot from a second phone is the dependable choice: the address stays the same.
- Maps need the network. Open each city once before presenting, so its tiles are cached.

## Presenting

Two terminals and the editor, side by side with the phone (mirrored with iPhone Mirroring or QuickTime) and the Mac
window:

```sh
bun ../../scripts/nsx.mjs js . --target ios --serve    # the phone takes each save
bun ../../scripts/nsx.mjs js . --target macos --watch  # the Mac takes each save
```

Run one of them at a time: both rebuild on a save, and the Mac's and the phone's builds write different bundles.
To show both devices at once, run the phone's server, and start the Mac app with `bun exact.mjs mac --run` after
the edit.

The edits that read best on screen, each in `atlas.ts`'s `look` (save, and watch the map):

| Edit | What the audience sees |
|---|---|
| `style: 'satellite'` to `'standard'` | The city turns into Apple's 3D map, landmarks modelled and labelled |
| `pitch: 62` to `75`, `distance: 1500` to `900` | The camera drops to the rooftops |
| `orbit: 5` to `20` | The flyover speeds up |

And one that adds a capability, live: in `read()`, a new `kinds` entry, or a change to `mood()`'s words; the card
changes as you save. Every one of these is checked against the SDK before it runs: misspell a selector and the
terminal names the real one, and the app keeps running the last good code.

## What it proves, and what it does not

- It proves the loop: native code on a real iPhone and a Mac, changed and running within half a second, with no
  Xcode, no native build and no relaunch.
- It proves reach: four Apple frameworks, two of them beyond any Exact package, from one TypeScript file per
  platform and one shared.
- It does not prove a team ships faster over months, or that agents always spend fewer tokens: `docs/the-case.md`
  says what is measured and what is not.
- The sentiment model covers English on these devices; for French or German it answers no score, and the card says
  so.
