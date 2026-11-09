#!/usr/bin/env bun
// Builds an app's modules/apple/native.ts into what Exact links.
//   bun scripts/nsx.mjs build <app dir> [--target ios-sim|macos]   everything, including NSExact.xcframework
//   bun scripts/nsx.mjs js <app dir> [--target ios-sim|macos]      only the bytecode a running development app reloads
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const [verb, appArg, ...rest] = process.argv.slice(2);
if (!['build', 'js'].includes(verb) || !appArg) { console.error('usage: nsx.mjs build|js <app dir> [--target ios-sim|macos]'); process.exit(2); }
const app = resolve(appArg);
const targetName = rest[rest.indexOf('--target') + 1] && rest.includes('--target') ? rest[rest.indexOf('--target') + 1] : 'ios-sim';
const dev = !rest.includes('--release');

const targets = {
  'ios-sim': { sdk: 'iphonesimulator', triple: 'arm64-apple-ios17.0-simulator', hermes: 'universal-apple-ios-simulator', libffi: 'iphonesimulator-universal', id: 'ios-arm64-simulator', platform: 'ios', variant: 'simulator' },
  macos: { sdk: 'macosx', triple: 'arm64-apple-macos14.0', hermes: 'aarch64-apple-darwin', libffi: 'macosx-universal', id: 'macos-arm64', platform: 'macos' },
};
const target = targets[targetName];
if (!target) throw new Error(`unknown target ${targetName}`);

const run = (cmd, args, options = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...options });
  if (r.status !== 0) { console.error([r.stdout, r.stderr].filter(Boolean).join('\n')); throw new Error(`${basename(cmd)} failed`); }
  return r.stdout.trim();
};
const newest = (files) => Math.max(...files.map((f) => statSync(f).mtimeMs));

const hermesRoot = resolve(homedir(), '.cargo/hermes-lean-sys/hermes-vanilla-d412d3bd8512-v5');
// Bundles are installed under the SHA-256 Exact pins for each target (hermes-lean-sys/build_support.rs).
const hermesPins = {
  'aarch64-apple-darwin': 'bc71c7b398f1d41a5390761b75ce72e7be234aa48cb1ddec947224188ed6a4f2',
  'universal-apple-ios-simulator': 'bd15b09b7e448d4eaec268309cee653dd4b880bcfe17d277d886daae5db0696e',
};
const hermesFor = (name) => {
  const dir = resolve(hermesRoot, hermesPins[name]);
  if (!existsSync(dir)) throw new Error(`no Hermes bundle for ${name} at ${dir}; run bun scripts/exact.mjs setup in vendor/exact`);
  return dir;
};
const hermesHost = hermesFor('aarch64-apple-darwin');
const hermes = hermesFor(target.hermes);
const hermesc = resolve(hermesHost, 'bin/hermesc');

const gen = resolve(app, '.nsx', targetName);
mkdirSync(gen, { recursive: true });
const entry = resolve(app, 'modules/apple/native.ts');
if (!existsSync(entry)) throw new Error(`${entry} does not exist`);

function compileBytecode(source, out) {
  run(hermesc, ['-O', '-emit-async-break-check', '-Xes6-block-scoping', '-emit-binary', '-out', out, source, '-w']);
}

async function buildJs() {
  const built = await Bun.build({
    entrypoints: [entry],
    target: 'browser',
    format: 'iife',
    minify: false,
    plugins: [{ name: 'nsx', setup(b) { b.onResolve({ filter: /^nativescript-exact$/ }, () => ({ path: resolve(root, 'bridge/runtime.ts') })); } }],
  });
  if (!built.success) { for (const log of built.logs) console.error(String(log)); throw new Error('bundle failed'); }
  const js = resolve(gen, 'native.bundle.js');
  writeFileSync(js, await built.outputs[0].text());
  const hbc = resolve(gen, 'native.hbc');
  const staging = `${hbc}.tmp`;
  compileBytecode(js, staging);
  run('mv', ['-f', staging, hbc]);
  return { js, hbc };
}

const started = performance.now();
const { js, hbc } = await buildJs();
if (verb === 'js') {
  console.log(`native.ts -> ${basename(hbc)} in ${Math.round(performance.now() - started)} ms (a running development app reloads it)`);
  process.exit(0);
}

const ns = resolve(root, 'vendor/ns-runtimes');
const lib = resolve(root, '.gen/bridge', targetName);
mkdirSync(lib, { recursive: true });
const sdkPath = run('xcrun', ['--sdk', target.sdk, '--show-sdk-path']);
const common = ['-target', target.triple, '-isysroot', sdkPath, '-Os', '-g0', '-w'];
const cxx = [...common, '-std=c++20', '-stdlib=libc++', '-fno-objc-arc', '-fexceptions', '-frtti',
  '-DTARGET_ENGINE_HERMES=1', '-DNS_GSD_BACKEND_HERMES=0', '-DNATIVESCRIPT_REACT_NATIVE=1', '-DNDEBUG',
  `-I${resolve(hermes, 'include')}`, `-I${resolve(ns, 'NativeScript')}`, `-I${resolve(ns, 'metadata-generator/include')}`,
  `-I${resolve(ns, 'NativeScript/libffi', target.libffi, 'include')}`, `-I${ns}`, `-I${resolve(root, 'bridge')}`];

const bridgeInputs = [resolve(ns, 'NativeScript/ffi/objc/hermes/NativeApiJsi.mm'), resolve(ns, 'NativeScript/ffi/objc/shared/bridge/Install.mm')];
const bridgeObj = resolve(lib, 'bridge.o');
if (!existsSync(bridgeObj) || newest(bridgeInputs) > statSync(bridgeObj).mtimeMs) {
  console.log('compiling the NativeScript bridge (about 30 s)...');
  run('xcrun', ['--sdk', target.sdk, 'clang++', ...cxx, '-c', bridgeInputs[0], '-o', bridgeObj]);
}
const seamObj = resolve(lib, 'nsx.o');
const seamInputs = [resolve(root, 'bridge/nsx.mm'), resolve(root, 'bridge/nsx.h')];
if (!existsSync(seamObj) || newest(seamInputs) > statSync(seamObj).mtimeMs) {
  run('xcrun', ['--sdk', target.sdk, 'clang++', ...cxx, '-c', seamInputs[0], '-o', seamObj]);
}

// The global installer is extracted from the bridge so its bytecode always matches the source being linked.
const install = readFileSync(bridgeInputs[1], 'utf8');
const match = install.match(/R"Engine_GLOBALS\(([\s\S]*?)\)Engine_GLOBALS"/);
if (!match) throw new Error('could not find the global installer in Install.mm');
const globalsJs = resolve(gen, 'globals.js');
writeFileSync(globalsJs, `${match[1]}("__nativeScriptNativeApi");\n`);
const globalsHbc = resolve(gen, 'globals.hbc');
compileBytecode(globalsJs, globalsHbc);

// A development build carries the whole SDK so a bytecode-only reload can name any API.
// A release build keeps what the bundle names, plus Foundation and the runtime.
const tools = process.env.NSX_METADATA_TOOLS ?? resolve(root, '../ns-bevy/rt/metadata-tools');
const metadata = resolve(gen, dev ? 'metadata.full.nsmd' : 'metadata.nsmd');
const filter = [];
if (!dev) {
  const whitelist = resolve(gen, 'whitelist.mdg');
  run(resolve(tools, 'analyzer/release/ns-metadata-symbols'), ['--output', whitelist, js]);
  filter.push('-whitelist-modules', whitelist);
}
// build-v1 keeps the categories of retained classes; the newer generator's whitelist drops them.
if (!existsSync(metadata) || !dev) {
  run(resolve(tools, 'build-v1/bin/objc-metadata-generator'), [...filter, '-output-bin', metadata, '-output-umbrella', resolve(gen, 'umbrella.h'),
    'Xclang', '-isysroot', sdkPath, '-std=gnu99', '-target', target.triple.replace('ios17.0', 'ios26.0')]);
}

const blob = resolve(gen, 'app_blob.S');
const embed = (name, file) => `.globl _${name}\n.balign 16\n_${name}:\n.incbin "${file}"\n.globl _${name}_end\n_${name}_end:\n.byte 0\n`;
const devPath = dev ? hbc : '';
writeFileSync(blob, `.section __TEXT,__const\n${embed('nsx_metadata', metadata)}${embed('nsx_globals_hbc', globalsHbc)}${embed('nsx_module_hbc', hbc)}.globl _nsx_dev_path\n_nsx_dev_path:\n.asciz "${devPath}"\n`);
const blobObj = resolve(gen, 'app_blob.o');
run('xcrun', ['--sdk', target.sdk, 'clang', ...common, '-c', blob, '-o', blobObj]);

// The xcframework Exact links: one static slice, its archives named by Info.plist.
const xc = resolve(app, 'modules/apple/NSExact.xcframework');
rmSync(xc, { recursive: true, force: true });
const slice = resolve(xc, target.id);
const headers = resolve(slice, 'Headers');
mkdirSync(headers, { recursive: true });
copyFileSync(resolve(root, 'bridge/nsx.h'), resolve(headers, 'nsx.h'));
writeFileSync(resolve(headers, 'module.modulemap'), 'module CNSExact {\n  header "nsx.h"\n  export *\n}\n');
run('xcrun', ['libtool', '-static', '-o', resolve(slice, 'libNSExact.a'), bridgeObj, seamObj, blobObj]);
const thin = (from, name) => {
  const out = resolve(slice, name);
  const archs = run('xcrun', ['lipo', '-archs', from]);
  if (archs.includes(' ')) run('xcrun', ['lipo', from, '-thin', 'arm64', '-output', out]); else copyFileSync(from, out);
};
thin(resolve(ns, 'NativeScript/libffi', target.libffi, 'libffi.a'), 'libnsxffi.a');
thin(resolve(hermes, 'lib/libhermesvmlean_a.a'), 'libnsxhermes.a');
thin(resolve(hermes, 'lib/libjsi.a'), 'libnsxjsi.a');
thin(resolve(hermes, 'lib/libboost_context.a'), 'libnsxboost.a');
writeFileSync(resolve(xc, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>AvailableLibraries</key><array><dict>
<key>HeadersPath</key><string>Headers</string>
<key>LibraryIdentifier</key><string>${target.id}</string>
<key>LibraryPath</key><string>libNSExact.a</string>
<key>SupportedArchitectures</key><array><string>arm64</string></array>
<key>SupportedPlatform</key><string>${target.platform}</string>
${target.variant ? `<key>SupportedPlatformVariant</key><string>${target.variant}</string>` : ''}
</dict></array>
<key>CFBundlePackageType</key><string>XFWK</string>
<key>XCFrameworkFormatVersion</key><string>1.0</string>
</dict></plist>
`);

copyFileSync(resolve(root, 'bridge/NSExactModule.swift'), resolve(app, 'modules/apple/NSExactModule.swift'));
const manifest = JSON.parse(readFileSync(resolve(app, 'app.json'), 'utf8'));
writeFileSync(resolve(app, 'modules/apple/NSExactTags.swift'), `let nsxViewTags: [String] = ${JSON.stringify(manifest.modules ?? [])}\n`);

const sizes = { metadata: statSync(metadata).size, bytecode: statSync(hbc).size, bridgeCode: statSync(bridgeObj).size };
console.log(`NSExact.xcframework for ${targetName} in ${Math.round(performance.now() - started)} ms`, sizes);
