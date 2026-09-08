/* Cube Pop — end-to-end smoke test: boots the server, plays a real daily
 * round through the rules engine, submits the replay envelope, and checks
 * the leaderboard. Run: node tools/smoke-server.js
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const testData = fs.mkdtempSync(require('path').join(require('os').tmpdir(), 'cube-pop-test-'));
process.env.CUBE_POP_DATA_DIR = testData;
process.env.PORT = '0';
process.on('exit', () => fs.rmSync(testData, { recursive: true, force: true }));
const server = require('../server.js');
const Rules = require('../js/rules.js');
const Content = require('../js/content.js');

let BASE;

async function get(path) {
  const r = await fetch(BASE + path);
  return { status: r.status, body: await r.text() };
}
async function postJSON(path, obj) {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj)
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}

(async () => {
  await new Promise(res => { if (server.listening) res(); else server.on('listening', res); });

  BASE = 'http://127.0.0.1:' + server.address().port;
  // static: launch file + resources
  for (const p of ['/', '/index.html', '/css/style.css', '/js/rules.js', '/js/render.js',
                   '/js/ui.js', '/js/main.js', '/vendor/three.module.min.js', '/starhermit.txt']) {
    const r = await get(p);
    assert.strictEqual(r.status, 200, p + ' serves 200, got ' + r.status);
  }
  console.log('ok  - static launch + resources');

  // path traversal blocked
  const trav = await get('/../etc/passwd');
  assert.ok(trav.status === 403 || trav.status === 404, 'traversal blocked');
  console.log('ok  - path traversal blocked');

  // time endpoint
  const t = JSON.parse((await get('/api/v1/time')).body);
  assert.ok(Math.abs(t.now - Date.now()) < 5000, 'server time sane');
  console.log('ok  - /api/v1/time');

  // play the daily deterministically and submit
  const date = Content.utcDateString(Date.now());
  const cfg = Content.dailyConfig(date);
  let state = Rules.createGame(cfg);
  const initHash = Rules.hashState(state);
  const commands = [];
  for (let i = 0; i < 200 && !state.terminal; i++) {
    const acts = Rules.legalActions(state);
    let best = acts[0];
    for (const a of acts) if (a.size > best.size) best = a;
    const cmd = { type: 'pop', id: 'smoke-' + i, r: best.r, c: best.c, atMs: 500 + i * 1200 };
    const res = Rules.applyCommand(state, cmd);
    assert.ok(res.ok, 'move ' + i + ' legal');
    commands.push(cmd);
    state = res.state;
  }
  assert.ok(state.terminal, 'daily round terminates');
  const envelope = {
    schema: 1, build: '1.0.0', contentVersion: cfg.version, cfgId: cfg.id, seed: state.seed,
    initHash: initHash, startedOffsetMs: 0, commands: commands,
    hashes: [initHash, Rules.hashState(state)],
    invalidCount: 0, assists: { undo: true, hint: true },
    result: { reason: state.terminal.reason, won: state.terminal.won, score: state.score,
              moves: state.moves, elapsedMs: state.elapsedMs },
    finalHash: Rules.hashState(state)
  };
  const sub = await postJSON('/api/v1/daily/submit', { name: 'SmokeBot', date: date, envelope: envelope });
  assert.strictEqual(sub.status, 200, 'submit accepted: ' + JSON.stringify(sub.body));
  assert.strictEqual(sub.body.score, state.score.total, 'server score equals replayed score');
  assert.ok(sub.body.rank >= 1, 'has a rank');
  console.log('ok  - daily submit validated + ranked (score ' + sub.body.score + ', rank ' + sub.body.rank + ')');

  // tampered envelope must be rejected
  const bad = JSON.parse(JSON.stringify(envelope));
  bad.result.score.total += 1000;
  const rej = await postJSON('/api/v1/daily/submit', { name: 'CheatBot', date: date, envelope: bad });
  assert.strictEqual(rej.status, 422, 'tampered score rejected');
  console.log('ok  - tampered score rejected: ' + rej.body.error);

  // illegal move rejected
  const bad2 = JSON.parse(JSON.stringify(envelope));
  bad2.commands[0] = { type: 'pop', id: 'x', r: -5, c: 0 };
  const rej2 = await postJSON('/api/v1/daily/submit', { name: 'BadBot', date: date, envelope: bad2 });
  assert.strictEqual(rej2.status, 422, 'illegal command rejected');
  console.log('ok  - illegal command rejected');

  // board reflects the accepted entry
  const board = JSON.parse((await get('/api/v1/daily/board?date=' + date)).body);
  assert.ok(board.entries.some(e => e.name === 'SmokeBot' && e.score === state.score.total), 'board lists entry');
  console.log('ok  - leaderboard reflects validated entry');

  console.log('\nserver smoke test passed');
  server.close();
  process.exit(0);
})().catch(e => { console.error('SMOKE FAIL:', e); process.exit(1); });
