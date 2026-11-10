# The video: NativeScript in Exact

**For:** anyone weighing Exact who worries about the platform APIs its packages do not cover, and how much native
code (and how many agent tokens) that long tail will cost.

**One sentence:** Exact covers the common platform; with NativeScript, the rest of Apple's SDK is a TypeScript file
in the app, checked against the SDK and running on the device half a second after you save it.

**Length:** a 3 minute 30 main cut, and a 45 second cut of scenes 1, 3 and 7 for sharing.

## Setup

- **Devices:** the iPhone 16 Pro, shown with iPhone Mirroring (or QuickTime's movie recording from the phone over
  USB, which shows touches less well but never drops frames), and the Mac running Atlas in its own window.
- **Screen:** 2560 x 1440, three columns: the editor (`apps/atlas/modules/apple`, font at 18 pt), the phone, the
  Mac window. One terminal under the editor, 6 lines tall, font at 16 pt.
- **Capture:** ScreenFlow or OBS at 60 fps, the system audio off (haptics have no sound; say them), a lavalier
  microphone. Record each scene separately; nothing needs to be one take.
- **Before recording:** `docs/demo.md`, "Setting up", then open each city once so the map tiles are cached; Auto-Lock
  off; Focus mode on, so no notification lands in a shot; the phone's Text Size at default; Light appearance for the
  editor and the apps (the maps read better), or dark for both.
- **A timer overlay** for scenes 2 and 3: a stopwatch drawn in post from the recorded frames, not a live clock.

## Storyboard

| # | Time | On screen | Narration | What it proves | Source |
|---|---|---|---|---|---|
| 1 | 0:00 to 0:12 | Atlas on the phone and the Mac, orbiting Tokyo Tower in 3D; the Live badge | "Every native capability on these two screens, the 3D map, the language reading, the haptics, is TypeScript. Not a line of Swift." | The hook | `apps/atlas` |
| 2 | 0:12 to 0:45 | Exact's package list scrolling; then `apps/mixed`'s nine-line Swift module, an edit, the terminal building, the simulator relaunching; a stopwatch stops at 13 s | "Exact's sixty packages cover the platform's common ground. Past it, you write a native module, in Swift. Each change is a native build and a relaunch: thirteen seconds for nine lines, and the screen you were on is gone." | The cost today | `docs/the-case.md`, "The loop" |
| 3 | 0:45 to 1:40 | The editor: `atlas.ts`'s `look`. Change `style` to `'standard'`, save. Both devices turn to Apple's 3D map within half a second; the Live strip reads "saved to running in 429 ms". Then `pitch` to 75 and `distance` to 900, save: the camera drops to the rooftops | "Here is the same kind of change in TypeScript. Save. That is the phone, over Wi-Fi, and the Mac. No build, no relaunch, the app exactly where it was. The strip is the device's own measurement: four hundred milliseconds from the save." | No native rebuild; live on real hardware | `docs/demo.md`, "Measured" |
| 4 | 1:40 to 2:05 | The three files side by side: `atlas.ts`, `native.ios.ts`, `native.macos.ts` | "One shared file for what both platforms name alike, MapKit and NaturalLanguage. A small file each for what differs: CoreHaptics on the iPhone, the trackpad on the Mac. Each is checked against its own SDK." | One language, two platforms, typed | `docs/native-in-typescript.md`, "Platform files" |
| 5 | 2:05 to 2:40 | Type `engine.startWithCompletion(null)` and save. The terminal: the error and "The SDK's nearest: startWithCompletionHandler(…)" in half a second; the app still orbiting. Fix it, save, it runs | "The mistakes an agent makes most, a misremembered selector, are refused before anything runs, with the real one named. In Swift that is a nine second build to the same error, and no suggestion. Meanwhile the app keeps running the last good code." | Mistakes are cheap | `docs/the-case.md`, "Mistakes" |
| 6 | 2:40 to 3:10 | Claude Code in the terminal: "Make Feel it play a heartbeat: two beats, the second softer, twice." It edits `native.ios.ts`, the check passes, the phone is tapped: the subtitle reads the new pattern | "And it is a loop an agent can run on its own. Each turn is a one-line answer, not a build log: in our A/B, agents writing the native module in TypeScript used 13% fewer tokens and a quarter less time, with one native build instead of three or four." | Agents, tokens | `docs/ab-results.md`; per-edit output in `docs/the-case.md` |
| 7 | 3:10 to 3:30 | Back to the two devices orbiting; then a card: "Today: iOS and macOS, Objective-C APIs. Next: Android. Swift-only APIs stay Swift." | "Exact writes the web and ships the platform. NativeScript makes the rest of the platform one TypeScript file away. Swift-only APIs stay in Swift, beside it; Android is next." | The honest boundary | `docs/the-case.md`, "What NativeScript does not do" |

## Scene notes

- **Scene 2** needs `apps/mixed` built for the simulator (`bun exact.mjs ios` there); edit the string in
  `modules/apple/Greeter.swift`, run `bun exact.mjs ios`, then `bun exact.mjs agent ios tree`. Record the real
  wait; cut nothing out of it, but speed the middle up 4x with the stopwatch still counting real seconds.
- **Scene 3**: run `nsx.mjs js . --target ios --serve` for the phone and `nsx.mjs js . --target macos --watch` for
  the Mac, side by side: one save reaches both in the same take.
- **Scene 5**: type the mistake rather than paste it, so it reads as one; the checker's line wraps, so the
  terminal must be wide enough to show "The SDK's nearest".
- **Scene 6**: rehearse the prompt twice; keep the run whose diff is shortest on screen. If the agent adds a view
  tag or a framework, that needs a native build: choose a prompt that does not (a new pattern, a new mood word).
- **Captions** state every number with its condition ("iPhone 16 Pro, development build, Wi-Fi").

## Claims to avoid

- "No native code": the bridge and the adapters are native; the app's author writes none.
- "Faster than Swift" at run time: a call through NativeScript costs more than a Swift one; the module is ready
  about 45 ms later after first pixel, and a development build uses more memory.
- "Agents use 13% fewer tokens" without "in a small A/B": two runs each, for one feature.
- "Any API": Objective-C APIs. Swift-only APIs (SwiftUI, StoreKit 2, FoundationModels) are not reachable.
- "Over the air": release builds run only the bytecode built into them; the live loop is development only.
