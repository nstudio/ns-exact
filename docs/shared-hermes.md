# One Hermes per process

The module linked its own copy of the pinned Hermes (`libnsxhermes.a`, 1.83 MB of the phone's modules dylib),
beside the identical copy Exact's host already links for `app.ts`. It no longer does: the module keeps its own
runtime, on the main thread, under its own 100 ms watchdog, made by the host's Hermes. Only the library is
shared, never Exact's hardened `app.ts` runtime.

## Where it stands

- `hostRuntime` in `bridge/nsx.mm` finds `makeHermesRootAPI` with `dlsym` and makes the runtime through
  `IHermesRootAPI`, with the config built as before. A host that exports no Hermes refuses by name.
- The config's default crash manager names two Hermes symbols (`NopCrashManager`'s destructor and vtable).
  `nsx.mjs` leaves them undefined, resolved at launch from Exact's executable (`-U` in `app.json` `host.ios.link`,
  which `nsx.mjs build` writes), and marks them weak imports in the objects (`N_WEAK_REF`), so a process without
  them still loads the dylib: the production build's roster probe does.
- JSI stays the module's own (0.05 MB). A release executable keeps only the JSI functions Exact itself calls:
  four the bridge calls were missing (`Value::asString`, `Object::asFunction`, `Value::strictEquals`,
  `~HostObject`), and a weak import of them was null, a crash at the first call.
- Verified on the iOS Simulator, development and release builds: nslab's call, later, view, hatch, diagnostics and
  haptic package; `scripts/sessions-ios.mjs`; the watchdog stopping an infinite loop with a `TimeoutError`; a
  `throw` in `native.ts` reaching Swift with its message and stack. The link map of the phone's dylib lost 1.91 MB
  of Hermes and JSI symbols (9.97 to 8.06 MB); with JSI back, about 1.86 MB.
- On the iPhone 16 Pro (iOS 26.6.2), development build: the haptic pattern played (4 taps over 270 ms), and an edit
  to the package's `native.ts` under `js --serve` played 5 taps without a relaunch (rebuilt in 384 ms; the drive saw
  the reload 4.1 s after the edit, most of it the agent reading the phone's logs). Startup: `vm +0.6 MB 1.7 ms,
  bridge +54.7 MB 82.9 ms`.
- What two JSI copies cost: Hermes and the bridge each catch `jsi::JSError` by their own `type_info`. An error
  Hermes throws reaches the seam as a `std::exception`, whose `what()` keeps the message and stack. An error the
  bridge throws reaches JavaScript as a plain `Error` with the prefix "Exception in HostFunction:", its message
  kept. With the host's JSI alone (tried with all 22 symbols from the host) both kept their types.
- The ask, if the prefix matters: Exact's executable exporting JSI whole (`-export_dynamic`, or an exported-symbols
  list for `facebook::jsi::*`), which also saves the module's 0.05 MB.
- One Hermes version by construction: `nsx.mjs` reads `RELEASE_TAG` and the pin table from hermes-lean-sys'
  `build_support.rs` in `vendor/exact` (a path dependency, so no `Cargo.lock` entry pins it), honours the same
  `HERMES_LEAN_SYS_DIR[_<triple>]` and `CARGO_HOME`, and takes the headers, `libjsi.a` and `hermesc` from that bundle.
  It refuses a missing bundle by tag, triple and path, and a compiler and target bundle whose receipts differ in
  Hermes commit or bytecode version.
- macOS: `apps/nsmac` runs a call, a later and an `NSSlider` view on Exact's Hermes, in development and release
  builds. The Mac's executable exports the same three symbols in both. Release startup: `vm +0.6 MB 1.3 ms, bridge
  +1.8 MB 2.6 ms, modules +2.0 MB 4.3 ms`.
- Windows and Linux: Exact's Hermes bundles carry no Node-API (no `napi_*` or `jsr_*` symbol in `libhermesvm*.a`,
  no `js_native_api.h`), which NativeScript's Windows backend binds through. Those hosts need Exact's Hermes built
  with Node-API, or a JSI build of that backend.
- Android, where it stands: Exact's Hermes for `aarch64-linux-android` is published in the pinned release
  (`hermes-vanilla-aarch64-linux-android.tar.gz`, matching the pin; `exact setup` still says no release ships one),
  and `bun scripts/hermes-android.mjs install <archive>` installs it. With it an Exact app builds an APK. Hermes is
  linked statically into the one library, `libexactcanvas.so`, whose 137 dynamic symbols are Exact's C ABI and
  JNI entries, none of Hermes or JSI: rustc's cdylib version script keeps C++ symbols local. App modules on
  Android are Kotlin (`modules/android`, `ExactExtension`, `NativeModules`), and the APK packs only the app's Rust
  library. So NativeScript cannot reach Exact's Hermes on Android without two asks of Exact:
  - Hand modules Hermes: a `#[no_mangle]` accessor beside the code that links it, returning `makeHermesRootAPI()`
    (the two `NopCrashManager` symbols with it), as Exact already hands modules frames and timers. A
    `--export-dynamic-symbol` link argument through `CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS` left the
    exports unchanged.
  - Pack a module's native library: `modules/android/jniLibs` (or a package's `sources.jniLibs`) into the APK.
  - On NativeScript's side: build its JNI backend (`NativeScript/runtime/android/jsi`, entry
    `tns::Runtime::Attach(env, obj, runtimeId, jsi::Runtime*, metadataDir, …)`) with the NDK against Exact's
    headers, its `com.tns` Java classes and metadata generator jars, a Kotlin adapter in the place of
    `NSExactModule.swift`, and bytecode for the five places that backend evaluates source (`EngineHost.cpp:280,365`,
    `ffi/jni/jsi/Engine.cpp:24`, `GlobalHelpers.cpp:53`, `JSONObjectHelper.cpp:61`), since the lean VM compiles none.
- No own-Hermes fallback: every Exact host links Hermes for `app.ts`, and one that stops exporting it is refused at
  start by name. Linking a second copy back would be apparatus kept for a host that does not exist.

## How it was planned

## Why it can work without changing Exact

`@nativescript/react-native` already runs this way. On iOS, macOS and Android it installs into a `jsi::Runtime`
React Native's Hermes made (the Worklets UI runtime), through the same `nativescript::InstallNativeApiJSI` call
`bridge/nsx.mm` makes, and links no Hermes of its own. On Windows, where no runtime is reachable, it creates one
through the `jsr_*` API of the `hermes.dll` react-native-windows already loaded (NativeScript/runtimes#105, #112).
Exact's host is in the same position as that `hermes.dll`:

- The bridge needs no Hermes symbol at all. `nm -u` of `bridge.o` lists none: it is written against JSI.
- The seam needs three: `facebook::hermes::makeHermesRuntime(RuntimeConfig const&)`, and
  `hermes::vm::NopCrashManager`'s destructor and vtable, which `RuntimeConfig`'s default crash manager names.
- Exact's executable exports all three (`nm -gU` on `Nslab.app/Nslab`, a development build), with
  `makeHermesRootAPI()` and 157 JSI symbols. Hermes declares them `HERMES_EXPORT`, and hermes-lean-sys keeps them.
- This Hermes reaches everything else through interfaces: `jsi::ICast` → `IHermesRootAPI` makes runtimes, and
  `IHermes` has `watchTimeLimit`; `drainMicrotasks` and `instrumentation()` are `jsi::Runtime` virtuals. Virtual calls
  need no symbols.

## Steps

### 1. Link without Hermes (the spike)

- In `scripts/nsx.mjs`, stop linking `libnsxhermes.a` and `libnsxboost.a`, and mark the seam's three Hermes symbols
  as resolved at run time (`-Wl,-U,<symbol>` in `host.ios.link`, or `nsx.mjs` writing them; the main executable is
  searched first). Then try dropping `libnsxjsi.a` the same way, so the module uses the host's JSI and a
  `jsi::JSError` thrown in Hermes has one `type_info` on both sides.
- Or, with no link-time reference: `dlsym(RTLD_DEFAULT, "_ZN8facebook6hermes17makeHermesRootAPIEv")`, then
  `castInterface<IHermesRootAPI>()->makeHermesRuntime(config)`, with a crash manager the seam defines.
- Check, on the simulator, then the phone:
  - The link map shows no Hermes object in `libexact_modules.dylib`, and the stripped dylib shrinks by about 1.9 MB.
  - `apps/nslab` answers its call, later, view, hatch, diagnostics and haptic pattern; `scripts/sessions-ios.mjs`
    passes.
  - The watchdog still stops an infinite loop at about 100 ms with a `TimeoutError`.
  - A `throw` in `native.ts` still reaches Swift with its message and stack, so exceptions cross images.
  - Startup (`NativeScript start: …`) and the 8 s footprint are unchanged or better.
- Risks to test first: exception and RTTI identity across images (keep `libnsxjsi.a` if it fails), and a Hermes
  setting Exact's shim makes process-wide (read `vendor/exact/js/src/shim.cc`).

### 2. Release and distribution builds

- Check that Exact's release and distribution builds (`stripForDistribution` in `host/apple/build.mjs`) keep those
  symbols in the executable's export trie: `dyld_info -exports`, or `nm -gU` on the archived executable.
- If they are stripped, the ask to Exact is small and rests on a number: keep `makeHermesRootAPI` exported, or hand
  modules its result through `ExactModuleContext`, as the host already hands frames, timers and diagnostics. Saved:
  about 1.9 MB per app, about 0.6 MB compressed.

### 3. One Hermes version, by construction (done)

- Sharing the library makes the module's headers and the host's binary one ABI. `nsx.mjs` copies Exact's Hermes pins
  today (`hermesPins`); read them from `vendor/exact` (hermes-lean-sys' `build_support.rs`, `Cargo.lock`) and refuse
  to build when they differ.
- At start, refuse by name when the host exports no `makeHermesRootAPI`: "this Exact host exports no Hermes; build
  with a host that does, or ask nsx.mjs to link its own".
- Decide then whether to keep an own-Hermes build as a fallback, or remove it as apparatus.

### 4. The other platforms (macOS done)

- **macOS:** the same as iOS. Check the macOS host's exports; take the macOS metadata fixes from NativeScript/runtimes#104
  and #105 when the pin moves.
- **Android:** NativeScript's JNI backend is JSI too (`NativeScript/ffi/jni/jsi`), as `@nativescript/react-native`
  uses it. Find Exact's Hermes in its Android library with `dlsym`, and precompile the three places that backend
  evaluates source (item 4 in `next-steps.md`).
- **Windows and Linux:** NativeScript binds there through Node-API (`@nativescript/windows-napi`), which needs a
  `napi_env` from Hermes, as NativeScript/runtimes#112 takes from `hermes.dll`. Check whether Exact's lean Hermes has
  Node-API; if not, that is the question for Exact on those hosts.
