// Two sessions of apps/nslab embedded in Exact's sample host, on one NativeScript VM: each keeps its own
// views and diagnostics, and one destroyed leaves the other answering. Build the host first:
//   cd vendor/exact && EXACT_APP_DIR=../../apps/nslab bun host/apple/build.mjs --ios --host nslab-apple
// then: bun scripts/sessions-ios.mjs (EXACT_SIM picks the simulator).
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dir, '..');
process.env.EXACT_APP_DIR ??= resolve(root, 'apps/nslab');
process.chdir(resolve(root, 'vendor/exact'));
const { open } = await import(resolve(root, 'vendor/exact/scripts/agent.mjs'));

const dir = mkdtempSync(resolve(tmpdir(), 'nsx-host-'));
const control = resolve(dir, 'control');
writeFileSync(control, '');
// The sample host reads one command per appended line (host/apple/Sources/ExactHostIOS/main.swift).
const say = (line) => writeFileSync(control, readFileSync(control, 'utf8') + line + '\n');
const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const text = (tree, id) => tree.nodes.find((n) => n.props?.testId === id)?.props?.text;
const changes = async (s) => (await s.state()).hatches?.scopes?.module?.counters?.['slider.change'] ?? 0;
const footprint = () => {
  const pid = spawnSync('pgrep', ['-n', 'ExactHostIOS'], { encoding: 'utf8' }).stdout.trim();
  const m = spawnSync('footprint', [pid], { encoding: 'utf8' }).stdout.match(/Footprint: ([\d.]+) (KB|MB|GB)/);
  return m ? Number((Number(m[1]) * { KB: 1 / 1024, MB: 1, GB: 1024 }[m[2]]).toFixed(1)) : null;
};

const s = await open({ host: 'host-ios', session: 'a', touch: 'platform', env: { EXACT_HOST_CONTROL: control } });
try {
  check(s.sessions?.join(',') === 'a,b', `the host has sessions a and b: ${JSON.stringify(s.sessions)}`);
  await s.clock('settle');

  s.session = 'b';
  await s.tap('slider', { drag: { dx: 80, dy: 0, over: 300 } });
  await s.clock('settle');
  const level = text(await s.tree(), 'level'), countB = await changes(s);
  s.session = 'a';
  check(level !== 'Slider: 50', `b's slider moved: ${level}`);
  check(text(await s.tree(), 'level') === 'Slider: 50', 'a\'s slider stayed at 50');
  check(countB > 0 && (await changes(s)) === 0, `only b counted its slider's changes (b ${countB})`);

  await Bun.sleep(3000);
  const before = footprint();
  say('destroy a');
  await Bun.sleep(3000);
  console.log(`footprint: ${before} MB with two sessions, ${footprint()} MB 3 s after a was destroyed`);
  let refused = null;
  try { await s.tree(); } catch (e) { refused = e.message; }
  check(refused != null, `a is refused after destroy: ${refused}`);

  s.session = 'b';
  // From the thumb, which the first drag left right of the middle.
  await s.tap('slider', { drag: { from: [178, 22], dx: -120, dy: 0, over: 300 } });
  await s.clock('settle');
  const tree = await s.tree();
  check((await changes(s)) > countB, `b's slider still answers after a ended: ${text(tree, 'level')}`);
  check(text(tree, 'device-name')?.length > 0, `b kept its native.call answer: ${text(tree, 'device-name')}`);
  const logs = await s.logs();
  const bad = [...(logs.host ?? []), ...(logs.lines ?? []).map((l) => l.text ?? String(l))].filter((l) => /no NativeScript client|TimeoutError|failed|exact: /.test(l));
  check(bad.length === 0, `no late callback or error: ${bad.join(' | ')}`);
} finally {
  await s.close();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failures.length ? `${failures.length} failure(s)` : 'two sessions: ok');
process.exit(failures.length ? 1 : 0);
