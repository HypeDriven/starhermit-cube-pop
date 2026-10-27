// The session and save logic the engine client relies on (node --test): the
// Session.clock hook (the fixed-step round clock), the checksum native/
// platform.ts seals merged progress with (it must be js/session.js's), the
// browser build's cloud save (the JS SDK's saveJSON of the progress document,
// what saves.foreign() shows) validating and merging, and the snapshot round
// trip through the localStorage shim's interface. Signed-in paths cannot run
// here; this covers their logic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ROOT = new URL('..', import.meta.url).pathname;
function load() {
  const store = new Map();
  const ctx = vm.createContext({
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    performance: { now: () => 0 },
  });
  for (const f of ['rng', 'rules', 'content', 'session']) vm.runInContext(readFileSync(`${ROOT}js/${f}.js`, 'utf8'), ctx);
  return { ctx, store, S: ctx.CPSession, R: ctx.CPRules, C: ctx.CPContent, RNG: ctx.CPRNG };
}
const plain = (v) => JSON.parse(JSON.stringify(v));
// native/platform.ts sealed(): the same checksum as js/session.js progressChecksum.
function sealed({ R, RNG }, p) {
  const out = { v: 1, stars: p.stars, completed: p.completed, dailiesDone: p.dailiesDone, totalCubes: p.totalCubes };
  out.sum = RNG.hashString(R.stableStringify({ v: 1, stars: out.stars, completed: out.completed, dailiesDone: out.dailiesDone, totalCubes: out.totalCubes })) >>> 0;
  return out;
}

test('the round clock follows Session.clock', () => {
  const { S, C } = load();
  let t = 1;
  S.Session.clock = () => t;
  const s = new S.Session(C.JOURNEY[0]);
  s.startPerf = S.Session.now();
  t += 2500;
  assert.equal(s.elapsed(), 2500);
});

test('platform.ts seals progress with js/session.js checksum', () => {
  const env = load();
  const p = env.S.loadProgress();
  p.stars.j01 = 3; p.completed.j01 = true; p.totalCubes = 42;
  env.S.saveProgress(p);
  const saved = JSON.parse(env.store.get(env.S.LS.progress));
  assert.equal(sealed(env, p).sum, saved.sum);
  assert.ok(env.S.loadProgressRaw(sealed(env, p)));
});

test('the browser build cloud save (foreign) validates and merges without losing either side', () => {
  const env = load();
  const local = env.S.loadProgress();
  local.stars.j01 = 2; local.completed.j01 = true; local.totalCubes = 100;
  env.S.saveProgress(local);
  const oldDoc = { v: 1, stars: { j01: 3, j02: 1 }, completed: { j01: true, j02: true }, dailiesDone: { '2026-10-01': true }, totalCubes: 70 };
  const foreignText = JSON.stringify(sealed(env, oldDoc));
  const remote = env.S.loadProgressRaw(JSON.parse(foreignText));
  assert.ok(remote, 'the old cloud document passes its checksum');
  const merged = plain(env.S.mergeProgress(remote, env.S.loadProgress()));
  assert.deepEqual(merged.stars, { j01: 3, j02: 1 });
  assert.deepEqual(merged.completed, { j01: true, j02: true });
  assert.deepEqual(merged.dailiesDone, { '2026-10-01': true });
  assert.equal(merged.totalCubes, 100);
  assert.ok(env.S.loadProgressRaw(sealed(env, merged)));
  assert.equal(env.S.loadProgressRaw({ ...oldDoc, sum: 1 }), null, 'a tampered document is refused');
});

test('a paused round snapshot resumes with its state and commands', () => {
  const { S, C, R } = load();
  const s = new S.Session(C.JOURNEY[0]);
  const a = R.legalActions(s.state).find((x) => x.kind === 'pop');
  assert.ok(s.pop(a.r, a.c, 'c1').ok);
  s.saveSnapshot();
  const back = S.Session.loadSnapshot();
  assert.equal(R.hashState(back.state), R.hashState(s.state));
  assert.equal(back.commands.length, 1);
  assert.equal(back.pop(a.r, a.c, 'c1').duplicate, true, 'command ids stay deduplicated');
});

test('the daily board on this device keeps one best entry per name', async () => {
  const { S, C } = load();
  const cfg = C.dailyConfig('2026-10-27');
  const env = (total, won) => ({ result: { score: { total }, moves: 10, won, elapsedMs: 1000 }, invalidCount: 0 });
  await S.submitDaily('Ann', cfg.date, env(500, false));
  await S.submitDaily('Ann', cfg.date, env(300, false));
  const r = await S.submitDaily('Bo', cfg.date, env(900, true));
  assert.equal(r.rank, 1);
  const board = await S.dailyBoard(cfg.date);
  assert.deepEqual(plain(board.entries.map((e) => [e.name, e.score])), [['Bo', 900], ['Ann', 500]]);
});
