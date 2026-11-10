# A/B: the same native feature in Swift and in TypeScript

Four agents on Opus 5.5 added the same feature to identical Exact apps on the iOS Simulator: a synchronous brightness
call, a native `UIDatePicker` view, and an asynchronous haptic with a count kept in the module. All four passed an
independent drive afterwards. Two runs per condition, so read these as a direction, not a precise effect size.

| Run | Reported tokens | Cache writes | Cache reads | Output | Tool calls | Seconds | Native builds | Final module tokens |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TypeScript 1 | 78,276 | 57,644 | 684,211 | 13,348 | 14 | 158 | 1 | 1,060 |
| TypeScript 2 | 85,016 | 64,504 | 733,296 | 14,785 | 15 | 161 | 1 | 1,126 |
| Swift 1 | 95,635 | 94,012 | 692,535 | 15,220 | 17 | 215 | 4 | 1,256 |
| Swift 2 | 92,362 | 72,246 | 971,431 | 15,695 | 19 | 203 | 3 | 1,258 |

Limits of the comparison:

- The TypeScript recipe (`docs/native-in-typescript.md`) was written for this work and is shorter than Exact's two
  Swift recipes together, which favours TypeScript.
- The feature added a new view tag, which forces one native build in TypeScript. A feature with no new tag needs none.
- Neither condition exercised a user changing the date; the driver cannot operate the picker's popover.

## Three ways to reach a platform API: TypeScript, Swift, Rust (2026-11-09)

Three agents on Opus 5.5, one per condition, each in its own copy of the same Exact app and its own iOS Simulator,
did the same task: answer `native.call({ op: 'read', text })` with `{ language, score }` from Apple's
NaturalLanguage (`NLLanguageRecognizer`, `NLTagger`'s sentiment score), shown on screen; then round the score to one
decimal. Each had its own condition's recipe: `docs/native-in-typescript.md`, Exact's `recipes/native-module.md`, and
Exact's Rust native-module section with `packages/fixtures/vault`. All three finished both steps.

| | TypeScript (NativeScript) | Swift | Rust (Exact's native shim) |
|---|---:|---:|---:|
| Tokens | 68,783 | 80,507 | 94,520 |
| Tool calls | 35 | 36 | 38 |
| Wall time (the three ran at once) | 408 s | 435 s | 537 s |
| Native builds (one failed in each, below) | 3 | 3 | 7 |
| A native build for the second step | no | yes (10 s) | yes |
| Refusals of its code | 1 (the checker) | 0 | 0 |
| The module | 18 lines | 27 lines | 158 lines, and a package manifest |
| Checked against the SDK's declarations | yes (`nsx.mjs check`) | yes (`swiftc`) | no: `objc_msgSend` through `dlsym`, untyped |

- TypeScript used 15% fewer tokens than Swift and 27% fewer than Rust.
- Exact's Rust shim may name only `exact_js` and `std`, so the Rust agent reached NaturalLanguage through the
  Objective-C runtime by hand; the alternative is a native library built separately and pinned by SHA-256.
- Every condition hit the same setup error once: the copies' generated `exact.mjs` named the app after the folder it
  was copied from, and `bun exact.mjs update` fixed it. It cost each condition one failed build.
- One run per condition, run concurrently on one Mac, so wall times are inflated alike and the token gap is a
  direction, not an effect size.
