# Plan: one Hermes per process

The module links its own copy of the pinned Hermes (`libnsxhermes.a`, 1.83 MB of the phone's modules dylib, and
`libnsxjsi.a`, 0.05 MB), beside the identical copy Exact's host already links for `app.ts`. This plan removes it.
The module keeps its own runtime, on the main thread, under its own 100 ms watchdog: only the library is shared,
never Exact's hardened `app.ts` runtime.

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

### 3. One Hermes version, by construction

- Sharing the library makes the module's headers and the host's binary one ABI. `nsx.mjs` copies Exact's Hermes pins
  today (`hermesPins`); read them from `vendor/exact` (hermes-lean-sys' `build_support.rs`, `Cargo.lock`) and refuse
  to build when they differ.
- At start, refuse by name when the host exports no `makeHermesRootAPI`: "this Exact host exports no Hermes; build
  with a host that does, or ask nsx.mjs to link its own".
- Decide then whether to keep an own-Hermes build as a fallback, or remove it as apparatus.

### 4. The other platforms

- **macOS:** the same as iOS. Check the macOS host's exports; take the macOS metadata fixes from NativeScript/runtimes#104
  and #105 when the pin moves.
- **Android:** NativeScript's JNI backend is JSI too (`NativeScript/ffi/jni/jsi`), as `@nativescript/react-native`
  uses it. Find Exact's Hermes in its Android library with `dlsym`, and precompile the three places that backend
  evaluates source (item 4 in `next-steps.md`).
- **Windows and Linux:** NativeScript binds there through Node-API (`@nativescript/windows-napi`), which needs a
  `napi_env` from Hermes, as NativeScript/runtimes#112 takes from `hermes.dll`. Check whether Exact's lean Hermes has
  Node-API; if not, that is the question for Exact on those hosts.
