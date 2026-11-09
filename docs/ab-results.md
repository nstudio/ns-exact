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
