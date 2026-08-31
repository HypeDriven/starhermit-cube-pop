/* Cube Pop — rules engine unit + property + fuzz tests (node tests/rules.test.js) */
'use strict';
const assert = require('assert');
const Rules = require('../js/rules.js');
const Content = require('../js/content.js');
const RNG = require('../js/rng.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok  - ' + name); }
  catch (e) { console.error('FAIL - ' + name); console.error(e); process.exitCode = 1; }
}

function baseCfg(over) {
  return Object.assign({
    id: 'test', version: 1, kind: 'practice', seed: 1234,
    board: { rows: 6, cols: 6 }, colors: 4,
    goals: { 0: 10, 1: 10 }, minGroup: 2,
    rocketAt: 5, bombAt: 8,
    moveLimit: 0, timeLimitSec: 0,
    par: { moves: 12, timeSec: 120 },
    mechanics: { undo: true, hint: true },
    endless: null
  }, over || {});
}

// Force a controlled board for deterministic rule tests.
// gridSpec: rows of color ints; specials: [{r,c,s}]
function controlledState(gridSpec, specials, cfgOver) {
  const s = Rules.createGame(baseCfg(cfgOver));
  s.grid = gridSpec.map(row => row.map(c => ({ c, s: 0 })));
  (specials || []).forEach(sp => { s.grid[sp.r][sp.c] = { c: sp.color != null ? sp.color : 0, s: sp.s }; });
  return s;
}

function legalOn(state, r, c) { return Rules.checkPop(state, r, c) === null; }

// Greedy policy used by several tests: pop the biggest available group.
function greedyAction(state) {
  const acts = Rules.legalActions(state);
  if (!acts.length) return null;
  let best = acts[0];
  for (const a of acts) if (a.size > best.size) best = a;
  return best;
}

function playToEnd(cfg, maxMoves) {
  let state = Rules.createGame(cfg);
  const log = [];
  for (let i = 0; i < (maxMoves || 400) && !state.terminal; i++) {
    const a = greedyAction(state);
    if (!a) break;
    const cmd = { type: 'pop', id: 't-' + i, r: a.r, c: a.c, atMs: i * 1200 };
    const res = Rules.applyCommand(state, cmd);
    assert.ok(res.ok, 'greedy action must be legal at move ' + i);
    log.push(cmd);
    state = res.state;
  }
  return { state, log };
}

// ---------- creation & determinism ----------

test('creation is deterministic for same seed', () => {
  const a = Rules.createGame(baseCfg({ seed: 42 }));
  const b = Rules.createGame(baseCfg({ seed: 42 }));
  assert.strictEqual(Rules.hashState(a), Rules.hashState(b));
  const c = Rules.createGame(baseCfg({ seed: 43 }));
  assert.notStrictEqual(Rules.hashState(a), Rules.hashState(c));
});

test('fresh board is full and offers a legal action (no soft lock at start)', () => {
  for (let seed = 0; seed < 200; seed++) {
    const s = Rules.createGame(baseCfg({ seed }));
    let filled = 0;
    for (const row of s.grid) for (const cell of row) { assert.ok(cell && cell.s === 0); filled++; }
    assert.strictEqual(filled, 36);
    assert.ok(Rules.legalActions(s).length > 0, 'no legal action at seed ' + seed);
  }
});

test('goals counters start at zero', () => {
  const s = Rules.createGame(baseCfg());
  assert.deepStrictEqual(s.goals, { 0: 0, 1: 0 });
  assert.strictEqual(s.tick, 0);
  assert.strictEqual(s.terminal, null);
});

// ---------- legality ----------

test('groupAt finds the 4-way connected cluster', () => {
  const s = controlledState([
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [0, 1, 1, 0]
  ]);
  const grp = Rules.groupAt(s, 0, 0);
  assert.strictEqual(grp.length, 3); // (0,0),(0,1),(1,1)
  assert.strictEqual(Rules.groupAt(s, 0, 2).length, 3); // (0,2),(0,3),(1,2)
  assert.strictEqual(Rules.groupAt(s, 3, 0).length, 1);
});

test('singleton pop is rejected with group-too-small', () => {
  const s = controlledState([
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1],
    [1, 0, 1, 0]
  ]);
  assert.strictEqual(Rules.checkPop(s, 0, 0), 'group-too-small');
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0 });
  assert.ok(!res.ok);
  assert.strictEqual(res.reason, 'group-too-small');
  assert.strictEqual(res.state.tick, s.tick, 'failed command must not advance the tick');
});

test('out-of-bounds and empty cells are rejected', () => {
  const s = controlledState([[0, 0], [1, 1]]);
  assert.strictEqual(Rules.checkPop(s, -1, 0), 'bad-location');
  assert.strictEqual(Rules.checkPop(s, 0, 9), 'bad-location');
  s.grid[0][0] = null;
  assert.strictEqual(Rules.checkPop(s, 0, 0), 'empty-cell');
});

test('commands after a terminal state are rejected', () => {
  const s = controlledState([[0, 0], [1, 1]]);
  const res = Rules.applyCommand(s, { type: 'resign' });
  assert.ok(res.ok && res.state.terminal);
  const again = Rules.applyCommand(res.state, { type: 'pop', r: 0, c: 0 });
  assert.ok(!again.ok && again.reason === 'game-ended');
});

// ---------- popping, gravity, refill ----------

test('pop clears the group, counts goals, refills the board', () => {
  const s = controlledState([
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [0, 1, 1, 0]
  ]);
  const res = Rules.applyCommand(s, { type: 'pop', id: 'p1', r: 0, c: 0, atMs: 500 });
  assert.ok(res.ok);
  assert.strictEqual(res.state.tick, s.tick + 1);
  assert.strictEqual(res.state.moves, 1);
  assert.strictEqual(res.state.goals[0], 3);
  assert.strictEqual(res.state.score.cubes, 3);
  assert.strictEqual(res.state.score.popPoints, 30);
  assert.strictEqual(res.state.score.groupBonus, 15); // (3-2) × 15
  for (const row of res.state.grid) for (const cell of row) assert.ok(cell, 'board must stay full');
  assert.ok(res.events.some(e => e.type === 'pop'));
  assert.ok(res.events.some(e => e.type === 'refill'));
});

test('tick increases monotonically across commands', () => {
  let s = controlledState([
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [0, 1, 1, 0]
  ]);
  for (let i = 0; i < 5; i++) {
    const a = greedyAction(s);
    const res = Rules.applyCommand(s, { type: 'pop', r: a.r, c: a.c });
    assert.ok(res.ok);
    assert.strictEqual(res.state.tick, s.tick + 1);
    s = res.state;
  }
});

test('popped cubes fall down and new cubes arrive on top', () => {
  const s = controlledState([
    [1, 1],
    [0, 1],
    [0, 0]
  ]);
  // pop the 1s group: (0,0),(0,1),(1,1) → column 0 keeps one 0 at bottom
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0 });
  assert.ok(res.ok);
  const col0 = res.state.grid.map(row => row[0]);
  assert.strictEqual(col0.length, 3);
  assert.ok(col0.every(cell => cell));
});

// ---------- specials ----------

test('group of 5+ forges a rocket at the tapped cell', () => {
  const s = controlledState([
    [1, 1, 0, 1],
    [1, 0, 0, 0],
    [1, 1, 0, 1],
    [0, 1, 1, 0]
  ]);
  // zeros: (0,2),(1,1),(1,2),(1,3),(2,2) = 5, wider than tall → row rocket
  const res = Rules.applyCommand(s, { type: 'pop', r: 1, c: 2 });
  assert.ok(res.ok);
  const ev = res.events.find(e => e.type === 'special-create');
  assert.ok(ev, 'rocket created');
  assert.strictEqual(ev.special, Rules.S_ROCKET_H);
  assert.strictEqual(res.state.score.specialBonus, 150);
  // the special survives on the board (it may have fallen)
  let found = false;
  for (const row of res.state.grid) for (const cell of row) if (cell.s === Rules.S_ROCKET_H) found = true;
  assert.ok(found, 'rocket remains on the board');
});

test('taller groups forge column rockets', () => {
  const s = controlledState([
    [0, 1, 1, 0],
    [0, 1, 0, 1],
    [0, 1, 1, 0],
    [0, 0, 1, 1]
  ]);
  // zeros in column 0: (0,0),(1,0),(2,0),(3,0),(3,1) = 5, taller → column rocket
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0 });
  const ev = res.events.find(e => e.type === 'special-create');
  assert.ok(ev && ev.special === Rules.S_ROCKET_V);
});

test('group of 8+ forges a bomb', () => {
  const s = controlledState([
    [0, 0, 0, 1],
    [1, 0, 0, 1],
    [1, 1, 0, 0],
    [1, 1, 1, 0]
  ]);
  // 8 zeros connected
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0 });
  const ev = res.events.find(e => e.type === 'special-create');
  assert.ok(ev && ev.special === Rules.S_BOMB);
  assert.strictEqual(res.state.score.specialBonus, 400);
});

test('firing a row rocket clears the whole row', () => {
  const s = controlledState([
    [1, 1, 1, 1],
    [0, 1, 0, 1],
    [1, 0, 1, 0],
    [0, 1, 0, 1]
  ], [{ r: 2, c: 1, s: Rules.S_ROCKET_H }]);
  const res = Rules.applyCommand(s, { type: 'pop', r: 2, c: 1 });
  assert.ok(res.ok);
  assert.ok(res.events.some(e => e.type === 'fire'));
  const blast = res.events.find(e => e.type === 'blast');
  assert.strictEqual(blast.cells.length, 4);
  // 4 row cubes + the rocket itself = 5 cubes cleared
  assert.strictEqual(res.state.score.cubes, 5);
});

test('firing a bomb clears a 3×3 area', () => {
  const s = controlledState([
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0]
  ], [{ r: 2, c: 2, s: Rules.S_BOMB }]);
  const res = Rules.applyCommand(s, { type: 'pop', r: 2, c: 2 });
  assert.ok(res.ok);
  const blast = res.events.find(e => e.type === 'blast');
  assert.strictEqual(blast.cells.length, 9);
});

test('blasts chain into other specials', () => {
  const s = controlledState([
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0]
  ], [{ r: 2, c: 0, s: Rules.S_ROCKET_H }, { r: 2, c: 4, s: Rules.S_ROCKET_V }]);
  const res = Rules.applyCommand(s, { type: 'pop', r: 2, c: 0 });
  assert.ok(res.ok);
  const chain = res.events.find(e => e.type === 'chain');
  assert.ok(chain && chain.count === 2, 'two specials fired in one move');
  assert.strictEqual(res.state.score.chainBonus, 75);
  assert.strictEqual(res.state.score.chainsBest, 2);
});

test('specials do not join color groups', () => {
  const s = controlledState([
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1]
  ], [{ r: 1, c: 1, s: Rules.S_BOMB, color: 0 }]);
  // the bomb sits among 0s but is not part of the group
  const grp = Rules.groupAt(s, 0, 0);
  assert.strictEqual(grp.length, 2); // (0,0),(0,1) only
});

// ---------- terminal states ----------

test('completing all goals wins with remaining-move and time bonuses', () => {
  const s = controlledState([
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [0, 1, 1, 0]
  ], null, { goals: { 0: 3 }, moveLimit: 10, par: { moves: 5, timeSec: 120 } });
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0, atMs: 30 * 1000 });
  assert.ok(res.ok && res.state.terminal);
  assert.strictEqual(res.state.terminal.reason, 'goals-complete');
  assert.ok(res.state.terminal.won);
  assert.strictEqual(res.state.score.moveBonus, 9 * 25); // 10 − 1 move used
  assert.strictEqual(res.state.score.timeBonus, 90 * 5); // 90 s under par
  assert.strictEqual(res.state.score.total,
    res.state.score.popPoints + res.state.score.groupBonus + res.state.score.specialBonus +
    res.state.score.chainBonus + res.state.score.moveBonus + res.state.score.timeBonus);
});

test('running out of moves loses the round', () => {
  const s = controlledState([
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [0, 1, 1, 0]
  ], null, { goals: { 0: 99, 1: 99 }, moveLimit: 1 });
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0 });
  assert.ok(res.ok && res.state.terminal);
  assert.strictEqual(res.state.terminal.reason, 'move-limit');
  assert.ok(!res.state.terminal.won);
});

test('time limit loses the round', () => {
  const s = controlledState([
    [0, 0, 1, 1],
    [1, 0, 1, 0],
    [1, 1, 0, 0],
    [0, 1, 1, 0]
  ], null, { goals: { 0: 99 }, timeLimitSec: 60 });
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0, atMs: 61 * 1000 });
  assert.ok(res.ok && res.state.terminal && res.state.terminal.reason === 'time-up');
});

test('resign ends the round as a loss', () => {
  const s = Rules.createGame(baseCfg());
  const res = Rules.applyCommand(s, { type: 'resign' });
  assert.ok(res.ok);
  assert.strictEqual(res.state.terminal.reason, 'resigned');
  assert.ok(!res.state.terminal.won);
});

// ---------- deadlock / shuffle ----------

test('deadlocked board reshuffles and always keeps a legal action', () => {
  // checkerboard: no groups; a single rocket is the only action
  const s = controlledState([
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0]
  ], [{ r: 2, c: 2, s: Rules.S_ROCKET_H }], { goals: { 0: 99, 1: 99 } });
  assert.strictEqual(Rules.legalActions(s).length, 1, 'only the rocket is legal');
  const res = Rules.applyCommand(s, { type: 'pop', r: 2, c: 2 });
  assert.ok(res.ok && !res.state.terminal);
  assert.ok(Rules.legalActions(res.state).length > 0, 'post-resolution board must be playable');
});

// ---------- endless (score chase) ----------

test('endless mode banks moves per wave and ends when the bank runs dry', () => {
  const cfg = baseCfg({
    goals: { 0: 4 }, endless: { moveBank: 3, movesPerWave: 2 }, seed: 77
  });
  let s = Rules.createGame(cfg);
  let waves = 0;
  for (let i = 0; i < 60 && !s.terminal; i++) {
    // greedily pop groups containing color 0 to finish waves fast
    let acts = Rules.legalActions(s).filter(a => a.kind === 'pop' && s.grid[a.r][a.c].c === 0);
    if (!acts.length) acts = Rules.legalActions(s);
    const a = acts[0];
    const res = Rules.applyCommand(s, { type: 'pop', r: a.r, c: a.c });
    assert.ok(res.ok);
    if (res.events.some(e => e.type === 'wave')) waves++;
    s = res.state;
  }
  assert.ok(s.terminal, 'endless must terminate when the bank empties');
  assert.strictEqual(s.terminal.reason, 'move-limit');
  assert.ok(waves >= 1, 'at least one wave completed');
  assert.ok(s.score.waveBonus > 0);
});

// ---------- hints ----------

test('hint returns a legal action and prefers special-making groups', () => {
  const s = controlledState([
    [1, 1, 0, 1],
    [1, 0, 0, 0],
    [1, 1, 0, 1],
    [0, 1, 1, 0]
  ]);
  const h = Rules.hint(s);
  assert.ok(h);
  assert.ok(legalOn(s, h.r, h.c), 'hint must be legal');
  assert.strictEqual(h.why, 'make-rocket');
});

test('hint spots chain opportunities', () => {
  const s = controlledState([
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0],
    [1, 0, 1, 0, 1],
    [0, 1, 0, 1, 0]
  ], [{ r: 2, c: 0, s: Rules.S_ROCKET_H }, { r: 2, c: 4, s: Rules.S_ROCKET_V }]);
  const h = Rules.hint(s);
  assert.ok(h && h.why === 'chain');
});

// ---------- serialization & replay ----------

test('serialize/deserialize round-trips', () => {
  const s = Rules.createGame(baseCfg({ seed: 9 }));
  const back = Rules.deserialize(Rules.serialize(s));
  assert.strictEqual(Rules.hashState(back), Rules.hashState(s));
  assert.throws(() => Rules.deserialize(JSON.stringify({ v: 99 })), /version/);
});

test('replay property: same cfg + commands → identical hashes', () => {
  const cfg = baseCfg({ seed: 2024, moveLimit: 30 });
  const run = () => {
    let st = Rules.createGame(cfg);
    const hashes = [Rules.hashState(st)];
    for (let i = 0; i < 25 && !st.terminal; i++) {
      const a = greedyAction(st);
      const res = Rules.applyCommand(st, { type: 'pop', id: 'r-' + i, r: a.r, c: a.c, atMs: i * 1500 });
      assert.ok(res.ok);
      st = res.state;
      hashes.push(Rules.hashState(st));
    }
    return hashes;
  };
  assert.deepStrictEqual(run(), run());
});

test('failed commands never mutate state (pure transitions)', () => {
  const s = controlledState([
    [0, 1, 0],
    [1, 0, 1],
    [0, 1, 0]
  ]);
  const before = Rules.hashState(s);
  const res = Rules.applyCommand(s, { type: 'pop', r: 0, c: 0 });
  assert.ok(!res.ok);
  assert.strictEqual(Rules.hashState(s), before);
  assert.strictEqual(Rules.hashState(res.state), before);
});

// ---------- fuzz ----------

test('fuzz: malformed commands never throw or hang', () => {
  const s = Rules.createGame(baseCfg({ seed: 5 }));
  const junk = [
    null, undefined, 42, 'pop', {}, [], { type: 1 }, { type: 'pop' },
    { type: 'pop', r: 'a', c: 0 }, { type: 'pop', r: 0.5, c: 0 },
    { type: 'pop', r: 1e9, c: -1e9 }, { type: 'warp', r: 0, c: 0 },
    { type: 'pop', r: 0, c: 0, id: { bad: true } },
    { type: 'pop', r: 0, c: 0, payload: 'x'.repeat(2000) }
  ];
  for (const cmd of junk) {
    let out = null;
    assert.doesNotThrow(() => { out = Rules.applyCommand(s, cmd); });
    if (out.ok) assert.ok(Rules.validateCommandShape(cmd) === null || cmd.type === 'resign');
  }
  // shape validator itself
  for (const cmd of junk) assert.doesNotThrow(() => Rules.validateCommandShape(cmd));
});

test('fuzz: random legal play never produces NaN scores or dead states', () => {
  for (let seed = 0; seed < 30; seed++) {
    const cfg = baseCfg({ seed, moveLimit: 25, goals: { 0: 12, 1: 12, 2: 12 } });
    const rng = RNG.derive(seed, 0xabcdef);
    let s = Rules.createGame(cfg);
    for (let i = 0; i < 60 && !s.terminal; i++) {
      const acts = Rules.legalActions(s);
      assert.ok(acts.length > 0, 'live state must have a legal action');
      const a = acts[rng.int(acts.length)];
      const res = Rules.applyCommand(s, { type: 'pop', r: a.r, c: a.c, atMs: i * 1000 });
      assert.ok(res.ok);
      s = res.state;
      assert.ok(Number.isFinite(Rules.currentScore(s)));
      for (const row of s.grid) for (const cell of row) {
        assert.ok(cell && cell.c >= 0 && cell.c < cfg.colors && cell.s >= 0 && cell.s <= 3);
      }
    }
    if (s.terminal) assert.ok(Number.isFinite(s.score.total));
  }
});

// ---------- content validation ----------

test('all journey stages are legal, winnable-shaped, and solvable by greedy play of early ones', () => {
  assert.strictEqual(Content.JOURNEY.length, 40);
  for (const lvl of Content.JOURNEY) {
    assert.ok(lvl.seed > 0 && lvl.board.rows >= 5 && lvl.board.cols >= 5, lvl.id + ' sane board');
    for (const g in lvl.goals) assert.ok(+g < lvl.colors, lvl.id + ' goal color in range');
    assert.ok(Object.keys(lvl.goals).length >= 2, lvl.id + ' has goals');
    const s = Rules.createGame(lvl);
    assert.ok(Rules.legalActions(s).length > 0, lvl.id + ' starts playable');
    assert.ok(lvl.par && lvl.par.moves > 0 && lvl.par.timeSec > 0, lvl.id + ' has par values');
  }
  // the first five stages must be beatable by a naive greedy player
  for (const lvl of Content.JOURNEY.slice(0, 5)) {
    const { state } = playToEnd(lvl, 300);
    assert.ok(state.terminal && state.terminal.won, lvl.id + ' greedy-winnable, got ' +
      (state.terminal && state.terminal.reason));
  }
});

test('challenges, practice presets, and score chase are well-formed', () => {
  const all = Content.CHALLENGES.concat(Content.PRACTICE, [Content.SCORE_CHASE]);
  for (const cfg of all) {
    const s = Rules.createGame(cfg);
    assert.ok(Rules.legalActions(s).length > 0, cfg.id + ' starts playable');
    for (const g in cfg.goals) assert.ok(+g < cfg.colors, cfg.id + ' goal color in range');
  }
});

test('daily config is deterministic per UTC date and varies by day', () => {
  const a = Content.dailyConfig('2026-03-14');
  const b = Content.dailyConfig('2026-03-14');
  const c = Content.dailyConfig('2026-03-15');
  assert.deepStrictEqual(a, b);
  assert.notStrictEqual(a.seed, c.seed);
  assert.ok(a.id === 'daily-2026-03-14');
  const s = Rules.createGame(a);
  assert.ok(Rules.legalActions(s).length > 0);
});

test('tutorial lessons: fixtures are legal and lesson goals reachable', () => {
  const lessons = Content.tutorialLessons();
  assert.ok(lessons.length >= 5);
  for (const l of lessons) {
    const s = Rules.createGame(l.cfg);
    if (l.force && l.force.grid)
      s.grid = l.force.grid.map(row => row.map(c => ({ c, s: 0 })));
    if (l.force && l.force.specials)
      l.force.specials.forEach(sp => { s.grid[sp.r][sp.c] = { c: s.grid[sp.r][sp.c].c, s: sp.s }; });
    assert.ok(Rules.legalActions(s).length > 0, l.id + ' fixture has a legal action');
  }
  // lesson 1: any pop satisfies the goal
  const l1 = lessons[0];
  let st = Rules.createGame(l1.cfg);
  st.grid = l1.force.grid.map(row => row.map(c => ({ c, s: 0 })));
  const a = greedyAction(st);
  const res = Rules.applyCommand(st, { type: 'pop', r: a.r, c: a.c });
  assert.ok(res.ok && res.events.some(e => e.type === l1.goal.event));
});

// ---------- golden sessions ----------

test('golden: scripted journey stage has a stable outcome hash', () => {
  const lvl = Content.JOURNEY[0];
  const { state, log } = playToEnd(lvl, 300);
  assert.ok(state.terminal && state.terminal.won);
  assert.ok(log.length > 0 && log.length <= lvl.par.moves + 6);
  // replay the log and compare
  let st = Rules.createGame(lvl);
  for (const cmd of log) {
    const res = Rules.applyCommand(st, cmd);
    assert.ok(res.ok);
    st = res.state;
  }
  assert.strictEqual(Rules.hashState(st), Rules.hashState(state));
  assert.strictEqual(st.score.total, state.score.total);
});

test('golden: interrupted + resumed session matches continuous play', () => {
  const cfg = baseCfg({ seed: 31415, moveLimit: 20, goals: { 0: 15, 1: 15 } });
  // continuous
  const full = playToEnd(cfg, 100);
  // interrupted: play half, serialize, restore, continue
  let st = Rules.createGame(cfg);
  const half = Math.floor(full.log.length / 2);
  for (let i = 0; i < half; i++) st = Rules.applyCommand(st, full.log[i]).state;
  const restored = Rules.deserialize(Rules.serialize(st));
  for (let i = half; i < full.log.length; i++) {
    const res = Rules.applyCommand(restored, full.log[i]);
    assert.ok(res.ok);
    Object.assign(restored, res.state);
  }
  assert.strictEqual(Rules.hashState(restored), Rules.hashState(full.state));
});

test('tick command expires a time limit without a pop', () => {
  const s = Rules.createGame(baseCfg({ timeLimitSec: 10, goals: { 0: 99, 1: 99 } }));
  const res = Rules.applyCommand(s, { type: 'tick', atMs: 10500 });
  assert.ok(res.ok && res.state.terminal && res.state.terminal.reason === 'time-up');
  assert.strictEqual(res.state.moves, 0, 'tick is not a move');
  const early = Rules.applyCommand(s, { type: 'tick', atMs: 5000 });
  assert.ok(early.ok && !early.state.terminal);
});

console.log('\n' + passed + ' tests passed' + (process.exitCode ? ' (with failures)' : ''));
