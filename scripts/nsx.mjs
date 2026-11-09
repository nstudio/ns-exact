#!/usr/bin/env bun
// Builds an app's NativeScript modules into what Exact links: its own modules/apple/native.ts, if
// it has one, and the apple/native.ts of each NativeScript package it uses.
//   bun scripts/nsx.mjs check <app dir> [--json]   type-check them against the SDK; build and js run it first
//   bun scripts/nsx.mjs build <app dir>            everything, including NSExact.xcframework
//   bun scripts/nsx.mjs js <app dir>               only the bytecode a running development app reloads
//   bun scripts/nsx.mjs package <package dir>      write the package's Swift adapter, apple/NSExactPackage.swift
// Each app verb takes --target ios-sim|ios|macos (default ios-sim; ios is a device); build and js take --no-check.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, relative, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const [verb, appArg, ...rest] = process.argv.slice(2);
if (!['build', 'js', 'check', 'package'].includes(verb) || !appArg) { console.error('usage: nsx.mjs check|build|js <app dir> [--target ios-sim|ios|macos] [--json] [--no-check] | package <package dir>'); process.exit(2); }
const app = resolve(appArg);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

if (verb === 'package') {
  const impl = readJson(resolve(app, 'apple/exact.json')), name = readJson(resolve(app, 'exact.json')).name;
  if (!impl.sources?.swift?.includes('NSExactPackage.swift')) throw new Error('apple/exact.json must list NSExactPackage.swift in sources.swift');
  if (!/^[A-Za-z_]\w*$/.test(impl.class ?? '')) throw new Error('apple/exact.json must name a Swift class in `class`');
  if (!existsSync(resolve(app, 'apple/native.ts'))) throw new Error('the package has no apple/native.ts');
  const template = readFileSync(resolve(root, 'bridge/NSExactPackage.swift'), 'utf8');
  writeFileSync(resolve(app, 'apple/NSExactPackage.swift'), template.replaceAll('__CLASS__', impl.class).replaceAll('__PACKAGE__', name));
  console.log(`apple/NSExactPackage.swift: ${impl.class} serves ${name}`);
  process.exit(0);
}
const targetName = rest[rest.indexOf('--target') + 1] && rest.includes('--target') ? rest[rest.indexOf('--target') + 1] : 'ios-sim';
const dev = !rest.includes('--release');

const targets = {
  'ios-sim': { sdk: 'iphonesimulator', triple: 'arm64-apple-ios17.0-simulator', hermes: 'universal-apple-ios-simulator', libffi: 'iphonesimulator-universal', id: 'ios-arm64-simulator', platform: 'ios', variant: 'simulator' },
  ios: { sdk: 'iphoneos', triple: 'arm64-apple-ios17.0', hermes: 'aarch64-apple-ios', libffi: 'iphoneos-arm64', id: 'ios-arm64', platform: 'ios' },
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
  'aarch64-apple-ios': '6a2ecef87fd552c90284aca0d9a58898b63c8c77e6f6d04ea3192c420654039f',
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
// The app's own module, then each NativeScript package the app uses: Exact's own reading of
// which package implementations an app links, narrowed to those served by NSExactPackage.swift.
const ownModule = resolve(app, 'modules/apple/native.ts');
const { appleImplementations } = await import(resolve(root, 'vendor/exact/js/bake/src/typescript.mjs'));
const packages = appleImplementations(app, target.platform)
  .filter((p) => p.sources.some((f) => basename(f) === 'NSExactPackage.swift'))
  .map((p) => {
    const dir = dirname(p.sources.find((f) => basename(f) === 'NSExactPackage.swift'));
    return { name: readJson(resolve(dir, '../exact.json')).name, file: resolve(dir, 'native.ts') };
  });
const modules = [...(existsSync(ownModule) ? [{ name: 'app', file: ownModule }] : []), ...packages];
if (!modules.length) throw new Error(`${app} has no modules/apple/native.ts and uses no NativeScript package`);
for (const m of modules) if (!existsSync(m.file)) throw new Error(`${m.name}: ${m.file} does not exist`);

// Typings for the whole SDK, made once per SDK version. The generator writes parameters named
// with reserved words (`in`) and nameless struct fields, which TypeScript cannot parse.
function sdkTypings() {
  const version = run('xcrun', ['--sdk', target.sdk, '--show-sdk-version']);
  const dir = resolve(root, '.gen/types', `${targetName}-${version}`);
  if (existsSync(resolve(dir, 'index.d.ts'))) return dir;
  const tools = process.env.NSX_METADATA_TOOLS ?? resolve(root, '../ns-bevy/rt/metadata-tools');
  const staging = `${dir}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  run(resolve(tools, 'build/bin/objc-metadata-generator'), [`types=${staging}`, 'ts-index-mode=all', '-output-bin', resolve(staging, '.nsmd'),
    '-output-umbrella', resolve(staging, '.h'), 'Xclang', '-isysroot', run('xcrun', ['--sdk', target.sdk, '--show-sdk-path']), '-std=gnu99',
    '-target', target.triple.replace('ios17.0', 'ios26.0')]);
  const reserved = 'break|case|catch|class|const|continue|debugger|default|delete|do|else|enum|export|extends|false|finally|for|function|if|import|in|instanceof|new|null|return|super|switch|throw|true|try|typeof|var|void|while|with';
  const param = new RegExp(`([(,] ?)(${reserved})(\\??: )`, 'g');
  for (const f of readdirSync(staging).filter((f) => f.endsWith('.d.ts'))) {
    const text = readFileSync(resolve(staging, f), 'utf8');
    const fixed = text.replace(param, '$1$2_$3').replace(/^\s*: [^;\n]+;\n/gm, '');
    if (fixed !== text) writeFileSync(resolve(staging, f), fixed);
  }
  rmSync(dir, { recursive: true, force: true });
  run('mv', [staging, dir]);
  return dir;
}

// What TypeScript says, in the shape of `contract build --json`, with ids an agent can act on.
const diagnosticIds = {
  2304: ['ns-unknown-name', 'no such class, function or constant in the SDK'],
  2552: ['ns-unknown-name', 'no such class, function or constant in the SDK'],
  2339: ['ns-unknown-member', 'no such property or method; selector parts are joined in camelCase'],
  2551: ['ns-unknown-member', 'no such property or method; selector parts are joined in camelCase'],
  2554: ['ns-arity', 'each selector part takes one argument'],
  2322: ['ns-type', ''],
  2345: ['ns-type', ''],
  2300: ['ns-redeclared', 'remove the `declare`: the SDK typings declare it'],
  2451: ['ns-redeclared', 'remove the `declare`: the SDK typings declare it'],
};

function check() {
  const out = resolve(gen, 'tsconfig.json');
  writeFileSync(out, JSON.stringify({
    compilerOptions: {
      target: 'es2022', module: 'esnext', moduleResolution: 'bundler', strict: false, noEmit: true, skipLibCheck: true,
      lib: ['es2022'], types: [], paths: { 'nativescript-exact': [resolve(root, 'bridge/runtime.ts')] },
    },
    files: [resolve(root, 'vendor/ns-runtimes/packages/objc-node-api/index.d.ts'), resolve(sdkTypings(), 'index.d.ts'), ...modules.map((m) => m.file)],
  }, null, 2));
  const tsc = spawnSync(resolve(root, 'vendor/exact/node_modules/.bin/tsc'), ['-p', out, '--pretty', 'false'], { encoding: 'utf8' });
  const found = [];
  for (const line of `${tsc.stdout}${tsc.stderr}`.split('\n')) {
    const m = line.match(/^(.+?)\((\d+),(\d+)\): (error|warning) TS(\d+): (.*)$/);
    if (m) {
      const [id, hint] = diagnosticIds[m[5]] ?? [`ns-ts${m[5]}`, ''];
      const file = resolve(m[1]);
      const source = existsSync(file) ? readFileSync(file, 'utf8').split('\n')[Number(m[2]) - 1] ?? '' : '';
      const col = Number(m[3]);
      const word = source.slice(col - 1).match(/^[\w$]+/)?.[0] ?? ' ';
      found.push({ col, end_col: col + word.length, file: relative(process.cwd(), file), id, line: Number(m[2]),
        message: hint ? `${m[6]} (${hint})` : m[6], related: [], severity: m[4] });
    } else if (line.startsWith('  ') && found.length) {
      found.at(-1).message += ` ${line.trim()}`;
    }
  }
  if (tsc.status !== 0 && !found.length) throw new Error(`tsc failed: ${tsc.stderr || tsc.stdout}`);
  // In a module a `declare const X: any` shadows the SDK's X without an error, and nothing it names is checked.
  for (const { file } of modules) readFileSync(file, 'utf8').split('\n').forEach((source, i) => {
    const m = source.match(/^(\s*declare\s+(?:const|let|var)\s+)([\w$]+)/);
    if (m) found.push({ col: m[1].length + 1, end_col: m[1].length + 1 + m[2].length, file: relative(process.cwd(), file), id: 'ns-shadowed',
      line: i + 1, message: `\`declare\` hides the SDK's types for ${m[2]}, so nothing it names is checked; remove it`, related: [], severity: 'error' });
  });
  return found;
}

if (verb === 'check' || !rest.includes('--no-check')) {
  const found = check();
  if (rest.includes('--json')) console.log(JSON.stringify(found));
  else for (const d of found) console.error(`${d.file}:${d.line}:${d.col} [${d.id}] ${d.message}`);
  if (found.some((d) => d.severity === 'error')) process.exit(1);
  if (verb === 'check') process.exit(0);
}

function compileBytecode(source, out) {
  run(hermesc, ['-O', '-emit-async-break-check', '-Xes6-block-scoping', '-emit-binary', '-out', out, source, '-w']);
}

async function buildJs() {
  const entry = resolve(gen, 'entry.ts');
  writeFileSync(entry, [
    "import { __register } from 'nativescript-exact';",
    ...modules.map((m, i) => m.name === 'app' ? `import ${JSON.stringify(m.file)};` : `import p${i} from ${JSON.stringify(m.file)};\n__register(${JSON.stringify(m.name)}, p${i});`),
  ].join('\n') + '\n');
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
  console.log(`${modules.map((m) => m.name).join(', ')} -> ${basename(hbc)} in ${Math.round(performance.now() - started)} ms (a running development app reloads it)`);
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

const tools = process.env.NSX_METADATA_TOOLS ?? resolve(root, '../ns-bevy/rt/metadata-tools');
// The global installer is extracted from the bridge so its bytecode always matches the source being linked.
const install = readFileSync(bridgeInputs[1], 'utf8');
const match = install.match(/R"Engine_GLOBALS\(([\s\S]*?)\)Engine_GLOBALS"/);
if (!match) throw new Error('could not find the global installer in Install.mm');
// A release build defines a global only for each name the bundle reads; the installer
// otherwise defines one for every name in the metadata, which costs memory at launch.
let installer = match[1];
if (!dev) {
  const named = run(resolve(tools, 'analyzer/release/ns-metadata-symbols'), ['--no-default-modules', js])
    .split('\n').filter((l) => l.startsWith('*:')).map((l) => l.slice(2));
  const head = 'function defineLazyGlobal(name, resolve, force, nativeKind) {';
  if (!installer.includes(head)) throw new Error('the global installer has no defineLazyGlobal to filter');
  installer = installer.replace(head, `var nsxNamed = ${JSON.stringify(Object.fromEntries(named.map((n) => [n, 1])))};\n  ${head}\n    if (!nsxNamed[name]) return;`);
}
const globalsJs = resolve(gen, 'globals.js');
writeFileSync(globalsJs, `${installer}("__nativeScriptNativeApi");\n`);
const globalsHbc = resolve(gen, 'globals.hbc');
compileBytecode(globalsJs, globalsHbc);

// A development build carries the whole SDK so a bytecode-only reload can name any API.
// A release build keeps what the bundle names and the classes JavaScript values convert to;
// the generator adds what those depend on. The bridge indexes every symbol it is given at
// launch, so all of Foundation and the C runtime would cost memory the app never uses.
const metadata = resolve(gen, dev ? 'metadata.full.nsmd' : 'metadata.nsmd');
const filter = [];
if (!dev) {
  const whitelist = resolve(gen, 'whitelist.mdg');
  const converted = ['NSObject', 'NSString', 'NSNumber', 'NSArray', 'NSMutableArray', 'NSDictionary', 'NSMutableDictionary', 'NSNull', 'NSData', 'NSDate', 'NSError'];
  run(resolve(tools, 'analyzer/release/ns-metadata-symbols'), ['--no-default-modules', '--output', whitelist, js]);
  writeFileSync(whitelist, `${readFileSync(whitelist, 'utf8')}${converted.map((n) => `*:${n}`).join('\n')}\n`);
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

// The xcframework Exact links: a static slice per target built, its archives named by Info.plist.
// Building one target keeps the others' slices, so a phone and a simulator build can alternate.
const xc = resolve(app, 'modules/apple/NSExact.xcframework');
const slice = resolve(xc, target.id);
rmSync(slice, { recursive: true, force: true });
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
writeFileSync(resolve(slice, 'slice.json'), JSON.stringify({ id: target.id, platform: target.platform, variant: target.variant }));
const slices = readdirSync(xc).filter((d) => existsSync(resolve(xc, d, 'slice.json'))).map((d) => readJson(resolve(xc, d, 'slice.json')));
writeFileSync(resolve(xc, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>AvailableLibraries</key><array>
${slices.map((t) => `<dict>
<key>HeadersPath</key><string>Headers</string>
<key>LibraryIdentifier</key><string>${t.id}</string>
<key>LibraryPath</key><string>libNSExact.a</string>
<key>SupportedArchitectures</key><array><string>arm64</string></array>
<key>SupportedPlatform</key><string>${t.platform}</string>
${t.variant ? `<key>SupportedPlatformVariant</key><string>${t.variant}</string>` : ''}
</dict>`).join('\n')}
</array>
<key>CFBundlePackageType</key><string>XFWK</string>
<key>XCFrameworkFormatVersion</key><string>1.0</string>
</dict></plist>
`);

const manifest = readJson(resolve(app, 'app.json'));
const generated = ['NSExactModule.swift', 'NSExactTags.swift'].map((f) => resolve(app, 'modules/apple', f));
if (existsSync(ownModule)) {
  copyFileSync(resolve(root, 'bridge/NSExactModule.swift'), generated[0]);
  // Tags the app's own module makes; a package's tags are its exact.json's.
  writeFileSync(generated[1], `let nsxViewTags: [String] = ${JSON.stringify(manifest.modules ?? [])}\n`);
} else {
  for (const f of generated) rmSync(f, { force: true });
}
const link = manifest.host?.[target.platform]?.link ?? [];
const needed = ['-lc++', '-licucore'].filter((a) => !link.includes(a));
if (needed.length) console.error(`app.json host.${target.platform}.link lacks ${needed.join(' ')}, which the bridge needs: add ${JSON.stringify(needed)}`);

const sizes = { metadata: statSync(metadata).size, bytecode: statSync(hbc).size, bridgeCode: statSync(bridgeObj).size };
console.log(`NSExact.xcframework for ${targetName} in ${Math.round(performance.now() - started)} ms`, sizes);
