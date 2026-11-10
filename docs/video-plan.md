# The video: NativeScript in Exact

A 64 s cut, 1920 x 1080, 30 fps, H.264 with a silent AAC track (X autoplays muted, so every claim is on
screen). For anyone weighing Exact who worries about the platform APIs its packages do not cover.

## The cut

| Time | Scene | What it shows | Source of every number |
|---|---|---|---|
| 0:00 to 0:16 | The hook | `atlas.ts` on the left, large; Atlas on the Mac and the iOS Simulator on the right, recorded. Two saves (`style` to `'standard'`; `pitch` and `distance`) change both maps; chips give each device's own reading, save to running. Then what makes it possible: NativeScript inside Exact, every Objective-C API typed against the SDK, on Exact's own Hermes | The footage's Live strips: 466 and 332 ms (Mac), 428 and 293 ms (iOS) |
| 0:16 to 0:22 | Edit to running | TypeScript 0.26 s (Mac), 0.24 to 0.39 s (simulator), 0.43 to 0.47 s (iPhone 16 Pro); Swift 12.6 to 13.4 s, relaunched | `docs/the-case.md`, "The loop" |
| 0:22 to 0:29 | Tokens | One task three ways: TypeScript 68.8k, Swift 80.5k, Rust 94.5k | `docs/ab-results.md`, "Three ways"; the modules in `docs/ab-three-way` |
| 0:29 to 0:36 | A call | 1.35 µs (TypeScript) against 0.27 µs (Swift) per Objective-C property; room for about 12,000 in a 60 fps frame | `docs/the-case.md`, "The costs" |
| 0:36 to 0:49 | Type checking | The same mistake: `nsx.mjs check` refuses it in 0.5 s and names `startWithCompletionHandler`; swiftc, inside Exact's build, in 8.9 s with no suggestion | `docs/the-case.md`, "Mistakes" |
| 0:49 to 0:58 | Footprint | Release metadata 4.5 MB to 432 KB; NativeScript starts in 4 ms, +2.5 MB; 1.0 MB compressed library | Atlas's release builds, `docs/the-case.md` |
| 0:58 to 1:04 | Close | "Exact ships the platform. NativeScript reaches the rest of it." iOS and macOS today; Android, Windows and Linux next | README, "Every platform Exact targets" |

Design: a black ground, SF Pro Display and SF Mono, Xcode's syntax colours, one accent (the system blue) for what
TypeScript does and grey for the alternatives; bars drawn to scale from zero; footnotes state each condition.

## Claims to avoid

- "No native code": the bridge and the adapters are native; the app's author writes none.
- "Faster than Swift" at run time: an Objective-C call through NativeScript costs five to seven times a Swift one, and a development
  build uses more memory.
- "Agents use 15% fewer tokens" without "one run each": the three-way comparison is one run per condition.
- "Any API": Objective-C APIs. Swift-only APIs (SwiftUI, StoreKit 2, FoundationModels) are not reachable.
- "Over the air": release builds run only the bytecode built into them; the live loop is development only.
