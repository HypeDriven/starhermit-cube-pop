/* Cube Pop — pure deterministic rules engine.
 * No rendering, no DOM, no Date.now(): every transition derives from
 * (state, command) only. Usable from browser (window.CPRules) and Node.
 *
 * Core loop: tap a connected group (4-way) of matching cubes to pop it.
 * Groups of 5+ leave a directional rocket behind; groups of 8+ leave a
 * radial bomb. Tapping a special fires it; blasts trigger further
 * specials (chains). Cleared cubes fall, columns refill from the top,
 * and popped colors fill the level goals. You lose by running out of
 * moves or time; the board reshuffles itself before it can deadlock.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.CPRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CPRules = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var STATE_VERSION = 1;

  var S_NONE = 0, S_ROCKET_H = 1, S_ROCKET_V = 2, S_BOMB = 3;

  var POP_PT = 10;          // per cube cleared, by group or blast
  var GROUP_PT = 15;        // per cube beyond the minimum group size
  var ROCKET_PT = 150;      // creating a rocket
  var BOMB_PT = 400;        // creating a bomb
  var CHAIN_PT = 75;        // per extra special fired in one move
  var MOVE_PT = 25;         // win bonus per unused move (move-limited levels)
  var TIME_PT_PER_SEC = 5;  // win bonus per second under par
  var WAVE_PT = 100;        // endless: per completed wave, scaled by wave no.

  var TERMINAL = {
    GOALS: 'goals-complete',
    MOVES: 'move-limit',
    TIME: 'time-up',
    RESIGN: 'resigned'
  };

  var INVALID = {
    ENDED: 'game-ended',
    BAD_CMD: 'unknown-command',
    BAD_SHAPE: 'malformed-command',
    BAD_LOC: 'bad-location',
    EMPTY: 'empty-cell',
    TOO_SMALL: 'group-too-small'
  };

  // ---------- helpers ----------

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // Stable stringify: object keys sorted recursively → canonical hashing.
  function stableStringify(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) {
      var out = '[';
      for (var i = 0; i < v.length; i++) out += (i ? ',' : '') + stableStringify(v[i]);
      return out + ']';
    }
    var keys = Object.keys(v).sort(), s = '{';
    for (var k = 0; k < keys.length; k++) {
      s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
    }
    return s + '}';
  }

  function hashState(state) {
    var copy = clone(state);
    delete copy.events;
    return RNG.hashString(stableStringify(copy));
  }

  function inBounds(state, r, c) {
    return Number.isInteger(r) && Number.isInteger(c) &&
      r >= 0 && r < state.cfg.board.rows && c >= 0 && c < state.cfg.board.cols;
  }

  // Actual grid extent (fixture grids may be smaller than cfg.board).
  function gridRows(state) { return state.grid.length; }
  function gridCols(state) { return state.grid[0] ? state.grid[0].length : 0; }
  function cellAt(state, r, c) {
    var row = state.grid[r];
    return row ? (row[c] === undefined ? null : row[c]) : null;
  }

  function key(r, c) { return r + ':' + c; }

  // Flood fill: 4-way connected cells of the same color. Specials never
  // join groups — they are fired by tapping them directly.
  function groupAt(state, r, c) {
    if (!inBounds(state, r, c)) return [];
    var cell = cellAt(state, r, c);
    if (!cell || cell.s !== S_NONE) return [];
    var color = cell.c;
    var seen = {}, out = [], stack = [[r, c]];
    seen[key(r, c)] = true;
    while (stack.length) {
      var p = stack.pop(), pr = p[0], pc = p[1];
      out.push({ r: pr, c: pc });
      var nb = [[pr - 1, pc], [pr + 1, pc], [pr, pc - 1], [pr, pc + 1]];
      for (var i = 0; i < nb.length; i++) {
        var nr = nb[i][0], nc = nb[i][1], k = key(nr, nc);
        if (seen[k] || !inBounds(state, nr, nc)) continue;
        var n = cellAt(state, nr, nc);
        if (n && n.s === S_NONE && n.c === color) {
          seen[k] = true;
          stack.push([nr, nc]);
        }
      }
    }
    return out;
  }

  // ---------- game creation ----------

  // cfg: { id, version, kind, seed, board:{rows,cols}, colors,
  //        goals:{colorIdx:count}, minGroup, rocketAt, bombAt,
  //        moveLimit, timeLimitSec, par:{moves,timeSec}|null,
  //        mechanics:{undo,hint}, endless:null|{moveBank,movesPerWave} }
  function createGame(cfg) {
    var seed = cfg.seed >>> 0;
    var rng = RNG.derive(seed, RNG.STREAM_RULES);
    var rows = cfg.board.rows, cols = cfg.board.cols;

    var state = {
      v: STATE_VERSION,
      cfg: clone(cfg),
      seed: seed,
      rngState: 0,
      tick: 0,
      grid: [],
      goals: {},
      score: { pops: 0, cubes: 0, popPoints: 0, groupBonus: 0, specialBonus: 0,
               chainBonus: 0, moveBonus: 0, timeBonus: 0, waveBonus: 0,
               bestGroup: 0, specialsMade: 0, chainsBest: 0, waves: 0, total: 0 },
      moves: 0,
      elapsedMs: 0,
      wave: 1,
      moveBank: cfg.endless ? cfg.endless.moveBank : null,
      terminal: null,
      events: []
    };
    for (var g in cfg.goals) state.goals[g] = 0;

    var r, c, row;
    for (r = 0; r < rows; r++) {
      row = [];
      for (c = 0; c < cols; c++) row.push({ c: rng.int(cfg.colors), s: S_NONE });
      state.grid.push(row);
    }
    state.rngState = rng.state;
    guaranteeMove(state); // a fresh board must offer at least one action
    return state;
  }

  // ---------- legality ----------

  function checkPop(state, r, c) {
    if (state.terminal) return INVALID.ENDED;
    if (!inBounds(state, r, c)) return INVALID.BAD_LOC;
    var cell = state.grid[r][c];
    if (!cell) return INVALID.EMPTY;
    if (cell.s !== S_NONE) return null; // firing a special is always legal
    var min = state.cfg.minGroup || 2;
    if (groupAt(state, r, c).length < min) return INVALID.TOO_SMALL;
    return null;
  }

  // Every poppable cell: specials plus members of legal groups.
  function legalActions(state) {
    if (state.terminal) return [];
    var out = [];
    var rows = gridRows(state), cols = gridCols(state);
    var counted = {};
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var cell = cellAt(state, r, c);
        if (!cell) continue;
        if (cell.s !== S_NONE) {
          out.push({ r: r, c: c, kind: 'fire', special: cell.s, size: 1 });
        } else if (!counted[key(r, c)]) {
          var grp = groupAt(state, r, c);
          for (var i = 0; i < grp.length; i++) counted[key(grp[i].r, grp[i].c)] = true;
          if (grp.length >= (state.cfg.minGroup || 2)) {
            for (var j = 0; j < grp.length; j++)
              out.push({ r: grp[j].r, c: grp[j].c, kind: 'pop', size: grp.length });
          }
        }
      }
    }
    return out;
  }

  function hasLegalAction(state) {
    var rows = gridRows(state), cols = gridCols(state);
    for (var r = 0; r < rows; r++)
      for (var c = 0; c < cols; c++) {
        var cell = cellAt(state, r, c);
        if (!cell) continue;
        if (cell.s !== S_NONE) return true;
        if (groupAt(state, r, c).length >= (state.cfg.minGroup || 2)) return true;
      }
    return false;
  }

  // ---------- resolution ----------

  function blastCells(state, r, c, special) {
    var rows = gridRows(state), cols = gridCols(state);
    var out = [], i, rr, cc;
    if (special === S_ROCKET_H) {
      for (i = 0; i < cols; i++) out.push({ r: r, c: i });
    } else if (special === S_ROCKET_V) {
      for (i = 0; i < rows; i++) out.push({ r: i, c: c });
    } else { // S_BOMB: radial 3×3
      for (rr = r - 1; rr <= r + 1; rr++)
        for (cc = c - 1; cc <= c + 1; cc++)
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) out.push({ r: rr, c: cc });
    }
    return out;
  }

  function countGoal(s, color) {
    if (s.cfg.goals[color] != null) s.goals[color] = (s.goals[color] || 0) + 1;
  }

  function goalsComplete(s) {
    for (var g in s.cfg.goals) if ((s.goals[g] || 0) < s.cfg.goals[g]) return false;
    return true;
  }

  function applyCommand(state, cmd) {
    if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') {
      return { ok: false, reason: INVALID.BAD_SHAPE, state: state, events: [] };
    }
    if (cmd.type === 'resign') {
      if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };
      var ns = clone(state);
      ns.tick++;
      ns.terminal = { reason: TERMINAL.RESIGN, won: false };
      ns.events = [{ type: 'lose', reason: TERMINAL.RESIGN }];
      finalizeScore(ns);
      return { ok: true, state: ns, events: ns.events };
    }
    if (cmd.type !== 'pop' && cmd.type !== 'tick') {
      return { ok: false, reason: INVALID.BAD_CMD, state: state, events: [] };
    }
    if (cmd.type === 'tick') {
      // Clock advance: lets a time limit expire without a pop. No board change.
      if (state.terminal) return { ok: false, reason: INVALID.ENDED, state: state, events: [] };
      var ts = clone(state);
      ts.events = [];
      ts.tick++;
      if (typeof cmd.atMs === 'number' && isFinite(cmd.atMs) && cmd.atMs >= 0)
        ts.elapsedMs = Math.floor(cmd.atMs / 100) * 100;
      if (ts.cfg.timeLimitSec && ts.elapsedMs >= ts.cfg.timeLimitSec * 1000) {
        ts.terminal = { reason: TERMINAL.TIME, won: false };
        ts.events.push({ type: 'lose', reason: TERMINAL.TIME });
        finalizeScore(ts);
      }
      return { ok: true, state: ts, events: ts.events };
    }
    var reason = checkPop(state, cmd.r, cmd.c);
    if (reason) return { ok: false, reason: reason, state: state, events: [] };

    var s = clone(state);
    s.events = [];
    s.tick++;
    s.moves++;
    if (typeof cmd.atMs === 'number' && isFinite(cmd.atMs) && cmd.atMs >= 0) {
      s.elapsedMs = Math.floor(cmd.atMs / 100) * 100; // quantized, replay-safe
    }
    var rng = RNG.create(s.rngState);
    var cfg = s.cfg;
    var cleared = {}; // key -> {r,c,color}
    var fired = {};   // specials already detonated this move
    var chain = 0;

    var cell = cellAt(s, cmd.r, cmd.c);

    if (cell.s !== S_NONE) {
      // Tapped a special: it fires. Its own cube counts toward goals.
      fired[key(cmd.r, cmd.c)] = true;
      detonate(s, cmd.r, cmd.c, cell.s, cleared, fired, function () { chain++; });
      countGoal(s, cell.c);
      s.score.cubes++;
      s.score.popPoints += POP_PT;
      s.events.push({ type: 'fire', special: cell.s, r: cmd.r, c: cmd.c, color: cell.c });
    } else {
      // Tapped a group.
      var grp = groupAt(s, cmd.r, cmd.c);
      var n = grp.length;
      var makeS = S_NONE;
      if (n >= (cfg.bombAt || 99)) makeS = S_BOMB;
      else if (n >= (cfg.rocketAt || 99)) {
        // Orientation from the group's silhouette: taller → column rocket.
        var minR = 99, maxR = -1, minC = 99, maxC = -1;
        for (var gi = 0; gi < n; gi++) {
          minR = Math.min(minR, grp[gi].r); maxR = Math.max(maxR, grp[gi].r);
          minC = Math.min(minC, grp[gi].c); maxC = Math.max(maxC, grp[gi].c);
        }
        var tall = (maxR - minR) - (maxC - minC);
        makeS = tall > 0 ? S_ROCKET_V : S_ROCKET_H; // symmetric silhouettes fire row rockets
      }
      for (var i = 0; i < n; i++) {
        if (makeS !== S_NONE && grp[i].r === cmd.r && grp[i].c === cmd.c) continue; // stays as the special
        cleared[key(grp[i].r, grp[i].c)] = { r: grp[i].r, c: grp[i].c, color: cell.c };
        countGoal(s, cell.c);
      }
      var popped = makeS !== S_NONE ? n - 1 : n;
      s.score.pops++;
      s.score.cubes += popped;
      s.score.bestGroup = Math.max(s.score.bestGroup, n);
      s.score.popPoints += popped * POP_PT;
      s.score.groupBonus += Math.max(0, n - (cfg.minGroup || 2)) * GROUP_PT;
      if (makeS !== S_NONE) {
        s.grid[cmd.r][cmd.c] = { c: cell.c, s: makeS };
        s.score.specialsMade++;
        s.score.specialBonus += makeS === S_BOMB ? BOMB_PT : ROCKET_PT;
        s.events.push({ type: 'special-create', special: makeS, r: cmd.r, c: cmd.c, color: cell.c, size: n });
      }
      s.events.push({ type: 'pop', r: cmd.r, c: cmd.c, color: cell.c, size: n,
        cells: grp.filter(function (p) { return cleared[key(p.r, p.c)]; }) });
    }
    if (chain > 0) {
      s.score.chainBonus += chain * CHAIN_PT;
      s.score.chainsBest = Math.max(s.score.chainsBest, chain + 1);
      s.events.push({ type: 'chain', count: chain + 1 });
    }

    // Remove cleared cubes.
    var clearedList = [];
    for (var k in cleared) clearedList.push(cleared[k]);
    for (var ci = 0; ci < clearedList.length; ci++) {
      var p = clearedList[ci];
      if (s.grid[p.r]) s.grid[p.r][p.c] = null;
    }
    if (cell.s !== S_NONE) s.grid[cmd.r][cmd.c] = null; // the fired special consumed itself

    // Gravity: compact each column downward (row index grows downward,
    // row 0 is the top), then refill the gaps from above.
    var falls = [], refills = [];
    var rows = gridRows(s), cols = gridCols(s);
    for (var c = 0; c < cols; c++) {
      var write = rows - 1;
      for (var r = rows - 1; r >= 0; r--) {
        if (s.grid[r][c]) {
          if (write !== r) {
            s.grid[write][c] = s.grid[r][c];
            s.grid[r][c] = null;
            falls.push({ fromR: r, fromC: c, toR: write, toC: c });
          }
          write--;
        }
      }
      for (var f = write; f >= 0; f--) {
        var nc = { c: rng.int(cfg.colors), s: S_NONE };
        s.grid[f][c] = nc;
        refills.push({ r: f, c: c, color: nc.c });
      }
    }
    if (falls.length) s.events.push({ type: 'fall', moves: falls });
    if (refills.length) s.events.push({ type: 'refill', cells: refills });

    s.rngState = rng.state;

    // Terminal: goals first, then limits.
    if (goalsComplete(s)) {
      if (cfg.endless) {
        s.wave++;
        s.score.waves++;
        s.score.waveBonus += WAVE_PT * s.wave;
        s.moveBank += cfg.endless.movesPerWave;
        var types = [];
        for (var t = 0; t < cfg.colors; t++) types.push(t);
        rng.shuffle(types);
        var nGoals = Math.min(cfg.colors, 2 + Math.floor(s.wave / 3));
        s.goals = {}; cfg.goals = {};
        for (var w = 0; w < nGoals; w++) {
          cfg.goals[types[w]] = 4 + s.wave * 2;
          s.goals[types[w]] = 0;
        }
        s.rngState = rng.state;
        s.events.push({ type: 'wave', wave: s.wave, goals: clone(cfg.goals), moveBank: s.moveBank });
      } else {
        s.terminal = { reason: TERMINAL.GOALS, won: true };
        if (cfg.moveLimit && s.moves < cfg.moveLimit)
          s.score.moveBonus = (cfg.moveLimit - s.moves) * MOVE_PT;
        if (cfg.par && cfg.par.timeSec && s.elapsedMs > 0 && s.elapsedMs < cfg.par.timeSec * 1000)
          s.score.timeBonus = Math.floor((cfg.par.timeSec * 1000 - s.elapsedMs) / 1000) * TIME_PT_PER_SEC;
        s.events.push({ type: 'win', reason: TERMINAL.GOALS });
      }
    }
    if (!s.terminal) {
      var outOfMoves = cfg.endless
        ? (s.moveBank - s.moves) <= 0
        : (cfg.moveLimit && s.moves >= cfg.moveLimit);
      if (outOfMoves) {
        s.terminal = { reason: TERMINAL.MOVES, won: false };
        s.events.push({ type: 'lose', reason: TERMINAL.MOVES });
      }
    }
    if (!s.terminal && cfg.timeLimitSec && s.elapsedMs >= cfg.timeLimitSec * 1000) {
      s.terminal = { reason: TERMINAL.TIME, won: false };
      s.events.push({ type: 'lose', reason: TERMINAL.TIME });
    }

    // Deadlock guard: no legal action → reshuffle the whole board until
    // one exists. This proves the absence of soft locks.
    if (!s.terminal && !hasLegalAction(s)) {
      guaranteeMove(s);
      s.events.push({ type: 'shuffle' });
    }

    if (s.terminal) finalizeScore(s);
    return { ok: true, state: s, events: s.events };
  }

  // Fire one special; queue any specials caught in its blast (chains).
  function detonate(s, r, c, special, cleared, fired, onChain) {
    var blast = blastCells(s, r, c, special);
    s.events.push({ type: 'blast', special: special, r: r, c: c, cells: clone(blast) });
    for (var i = 0; i < blast.length; i++) {
      var br = blast[i].r, bc = blast[i].c, k = key(br, bc);
      if (br === r && bc === c) {
        // The special's own cell is part of the blast line: it counts as a
        // cleared cube (the special itself was already counted by the caller).
        if (!cleared[k]) {
          var self = cellAt(s, br, bc);
          cleared[k] = { r: br, c: bc, color: self ? self.c : 0 };
          countGoal(s, cleared[k].color);
          s.score.cubes++;
          s.score.popPoints += POP_PT;
        }
        continue;
      }
      var target = cellAt(s, br, bc);
      if (!target || cleared[k]) continue;
      if (target.s !== S_NONE) {
        if (!fired[k]) {
          fired[k] = true;
          onChain();
          detonate(s, br, bc, target.s, cleared, fired, onChain);
        }
      } else {
        cleared[k] = { r: br, c: bc, color: target.c };
        countGoal(s, target.c);
        s.score.cubes++;
        s.score.popPoints += POP_PT;
      }
    }
  }

  // Ensure at least one legal action exists: shuffle until true, with a
  // deterministic forced-pair fallback so the loop is provably bounded.
  function guaranteeMove(s) {
    if (hasLegalAction(s)) return;
    var rng = RNG.create(s.rngState);
    var rows = gridRows(s), cols = gridCols(s);
    var attempts = 0;
    while (!hasLegalAction(s) && attempts < 32) {
      attempts++;
      var cells = [];
      var r, c;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) if (s.grid[r][c]) cells.push(s.grid[r][c]);
      rng.shuffle(cells);
      var i = 0;
      for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) s.grid[r][c] = cells[i++] || null;
    }
    if (!hasLegalAction(s)) {
      // Force a pair in the bottom-left corner.
      var col = s.grid[rows - 1][0] ? s.grid[rows - 1][0].c : 0;
      s.grid[rows - 1][0] = { c: col, s: S_NONE };
      s.grid[rows - 1][1] = { c: col, s: S_NONE };
    }
    s.rngState = rng.state;
  }

  function finalizeScore(s) {
    var sc = s.score;
    sc.total = sc.popPoints + sc.groupBonus + sc.specialBonus + sc.chainBonus +
      sc.moveBonus + sc.timeBonus + sc.waveBonus;
  }

  function currentScore(s) {
    var sc = s.score;
    return sc.popPoints + sc.groupBonus + sc.specialBonus + sc.chainBonus +
      sc.moveBonus + sc.timeBonus + sc.waveBonus;
  }

  // ---------- hints (same legality surface as play) ----------

  function hint(state) {
    var acts = legalActions(state);
    if (!acts.length) return null;
    var cfg = state.cfg;
    var i, a;
    // 1) a group that creates a bomb.
    for (i = 0; i < acts.length; i++) {
      a = acts[i];
      if (a.kind === 'pop' && a.size >= (cfg.bombAt || 99))
        return { r: a.r, c: a.c, size: a.size, why: 'make-bomb' };
    }
    // 2) a group that creates a rocket.
    for (i = 0; i < acts.length; i++) {
      a = acts[i];
      if (a.kind === 'pop' && a.size >= (cfg.rocketAt || 99))
        return { r: a.r, c: a.c, size: a.size, why: 'make-rocket' };
    }
    // 3) a special whose blast hits another special (chain).
    for (i = 0; i < acts.length; i++) {
      a = acts[i];
      if (a.kind === 'fire') {
        var blast = blastCells(state, a.r, a.c, a.special);
        for (var b = 0; b < blast.length; b++) {
          var t = state.grid[blast[b].r][blast[b].c];
          if (t && t.s !== S_NONE && !(blast[b].r === a.r && blast[b].c === a.c))
            return { r: a.r, c: a.c, size: 1, why: 'chain' };
        }
      }
    }
    // 4) a group containing a goal color.
    var best = null;
    for (i = 0; i < acts.length; i++) {
      a = acts[i];
      if (a.kind === 'pop') {
        var color = state.grid[a.r][a.c].c;
        var needed = cfg.goals[color] != null && (state.goals[color] || 0) < cfg.goals[color];
        if (needed && (!best || a.size > best.size)) best = { r: a.r, c: a.c, size: a.size, why: 'goal' };
      }
    }
    if (best) return best;
    // 5) the biggest group available.
    best = null;
    for (i = 0; i < acts.length; i++)
      if (acts[i].kind === 'pop' && (!best || acts[i].size > best.size))
        best = { r: acts[i].r, c: acts[i].c, size: acts[i].size, why: 'biggest' };
    if (best) return best;
    // 6) fire any special.
    a = acts[0];
    return { r: a.r, c: a.c, size: 1, why: 'fire' };
  }

  // ---------- validation (network / replay boundary) ----------

  function validateCommandShape(cmd, maxLen) {
    if (!cmd || typeof cmd !== 'object') return INVALID.BAD_SHAPE;
    if (JSON.stringify(cmd).length > (maxLen || 512)) return INVALID.BAD_SHAPE;
    if (cmd.type !== 'pop' && cmd.type !== 'resign' && cmd.type !== 'tick') return INVALID.BAD_CMD;
    if (cmd.id != null && (typeof cmd.id !== 'string' || cmd.id.length > 64)) return INVALID.BAD_SHAPE;
    if (cmd.type === 'pop') {
      if (!Number.isInteger(cmd.r) || !Number.isInteger(cmd.c)) return INVALID.BAD_SHAPE;
      if (cmd.r < -1 || cmd.r > 99 || cmd.c < -1 || cmd.c > 99) return INVALID.BAD_SHAPE;
    }
    return null;
  }

  // ---------- serialization ----------

  function serialize(state) { return JSON.stringify(state); }
  function deserialize(json) {
    var s = JSON.parse(json);
    if (s.v !== STATE_VERSION) throw new Error('unsupported state version ' + s.v);
    return s;
  }

  return {
    STATE_VERSION: STATE_VERSION,
    TERMINAL: TERMINAL,
    INVALID: INVALID,
    S_NONE: S_NONE, S_ROCKET_H: S_ROCKET_H, S_ROCKET_V: S_ROCKET_V, S_BOMB: S_BOMB,
    createGame: createGame,
    applyCommand: applyCommand,
    checkPop: checkPop,
    groupAt: groupAt,
    legalActions: legalActions,
    blastCells: blastCells,
    goalsComplete: goalsComplete,
    hint: hint,
    hashState: hashState,
    stableStringify: stableStringify,
    currentScore: currentScore,
    serialize: serialize,
    deserialize: deserialize,
    clone: clone,
    validateCommandShape: validateCommandShape
  };
});
