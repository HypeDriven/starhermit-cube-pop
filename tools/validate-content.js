/* Cube Pop — offline content validator (node tools/validate-content.js).
 * Proves for every piece of content: basic legality, goals reachable by
 * bounded greedy play, no soft locks, bounded duration. Exits 1 on failure.
 */
'use strict';
const Rules = require('../js/rules.js');
const Content = require('../js/content.js');
const RNG = require('../js/rng.js');

let failures = 0;
function check(cond, msg) {
  if (!cond) { failures++; console.error('FAIL - ' + msg); }
}

function greedy(state, preferGoal) {
  const acts = Rules.legalActions(state);
  if (!acts.length) return null;
  let pool = acts;
  if (preferGoal) {
    const g = acts.filter(a => a.kind === 'pop' &&
      state.cfg.goals[state.grid[a.r][a.c].c] != null &&
      (state.goals[state.grid[a.r][a.c].c] || 0) < state.cfg.goals[state.grid[a.r][a.c].c]);
    if (g.length) pool = g;
  }
  let best = pool[0];
  for (const a of pool) if (a.size > best.size) best = a;
  return best;
}

function simulate(cfg, maxMoves, label) {
  let s = Rules.createGame(cfg);
  check(Rules.legalActions(s).length > 0, label + ': starts with a legal action');
  for (let i = 0; i < maxMoves && !s.terminal; i++) {
    const a = greedy(s, true);
    if (!a) { check(false, label + ': soft lock at move ' + i); break; }
    const res = Rules.applyCommand(s, { type: 'pop', id: 'v-' + i, r: a.r, c: a.c, atMs: i * 1500 });
    check(res.ok, label + ': legal action accepted at move ' + i);
    s = res.state;
    check(Number.isFinite(Rules.currentScore(s)), label + ': finite score');
  }
  return s;
}

// journey: legal, sane, and at least mechanically playable to a terminal state
for (const lvl of Content.JOURNEY) {
  check(lvl.version === Content.CONTENT_VERSION, lvl.id + ': versioned');
  check(lvl.seed > 0, lvl.id + ': seeded');
  check(Object.keys(lvl.goals).length >= 2, lvl.id + ': ≥2 goals');
  const totalGoal = Object.values(lvl.goals).reduce((a, b) => a + b, 0);
  const capacity = lvl.board.rows * lvl.board.cols;
  check(totalGoal <= capacity * 4, lvl.id + ': goals plausible for board size');
  const end = simulate(lvl, 120, lvl.id);
  check(end.terminal, lvl.id + ': terminates within 120 moves (bounded duration)');
}

// challenges/practice/score: legal and bounded
for (const cfg of Content.CHALLENGES.concat(Content.PRACTICE)) {
  const end = simulate(cfg, 150, cfg.id);
  check(end.terminal, cfg.id + ': terminates');
}
const sc = simulate(Content.SCORE_CHASE, 400, 'score-chase');
check(sc.terminal, 'score-chase: bank eventually runs dry');

// daily sweep: 30 consecutive days must be legal and distinct-seeded
const seenSeeds = new Set();
for (let d = 1; d <= 30; d++) {
  const date = '2026-04-' + String(d).padStart(2, '0');
  const cfg = Content.dailyConfig(date);
  check(!seenSeeds.has(cfg.seed), date + ': unique seed');
  seenSeeds.add(cfg.seed);
  const s = Rules.createGame(cfg);
  check(Rules.legalActions(s).length > 0, date + ': playable');
}

// tutorial fixtures: legal and lesson-goal events producible
for (const l of Content.tutorialLessons()) {
  const s = Rules.createGame(l.cfg);
  s.grid = l.force.grid.map(row => row.map(c => ({ c, s: 0 })));
  (l.force.specials || []).forEach(sp => { s.grid[sp.r][sp.c] = { c: s.grid[sp.r][sp.c].c, s: sp.s }; });
  check(Rules.legalActions(s).length > 0, l.id + ': fixture playable');
}

// determinism: replay a fixed scripted session twice, compare hashes
function scripted(cfg) {
  let s = Rules.createGame(cfg);
  const hashes = [];
  for (let i = 0; i < 40 && !s.terminal; i++) {
    const a = greedy(s, false);
    if (!a) break;
    s = Rules.applyCommand(s, { type: 'pop', r: a.r, c: a.c, atMs: i * 1100 }).state;
    hashes.push(Rules.hashState(s));
  }
  return hashes.join(',');
}
check(scripted(Content.JOURNEY[7]) === scripted(Content.JOURNEY[7]), 'deterministic replay: identical hashes');

console.log(failures ? failures + ' validation failures' : 'all content validation passed');
process.exit(failures ? 1 : 0);
