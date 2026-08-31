/* Cube Pop — versioned content: cube colors, themes, journey, challenges,
 * tutorial lessons, practice presets, score-chase ruleset, daily generator.
 * Shared browser (window.CPContent) / Node. Content is data-only; all
 * randomness enters through the config seed.
 */
(function (root, factory) {
  var RNG = (typeof module === 'object' && module.exports) ? require('./rng.js') : root.CPRNG;
  var api = factory(RNG);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CPContent = api;
})(typeof self !== 'undefined' ? self : this, function (RNG) {
  'use strict';

  var CONTENT_VERSION = 1;

  // ---------- cube colors ----------
  // Icon + label + charm shape reinforce color (color is never the only cue).
  var COLORS = [
    { label: 'Cherry',    icon: '\u2665', color: 0xe4574f, colorHC: 0xd62828, charm: 'heart' },
    { label: 'Lemon',     icon: '\u2605', color: 0xf2c14e, colorHC: 0xf5d90a, charm: 'star' },
    { label: 'Leaf',      icon: '\u25b2', color: 0x5da85f, colorHC: 0x17a398, charm: 'cone' },
    { label: 'Sky',       icon: '\u25c6', color: 0x5b8fd4, colorHC: 0x2e6fe4, charm: 'diamond' },
    { label: 'Grape',     icon: '\u263e', color: 0x9a6fc8, colorHC: 0x8e24aa, charm: 'ring' },
    { label: 'Tangerine', icon: '\u273f', color: 0xef8b4a, colorHC: 0xef6c00, charm: 'gem' }
  ];

  // ---------- themes (cosmetic only: materials, light, ambience) ----------
  var THEMES = [
    { id: 'daybreak', name: 'Sunny Studio',  unlockStars: 0,
      palette: { wall: 0xf6e3c8, floor: 0xe8c9a0, table: 0xc98d5f, frame: 0xa8713f,
                 light: 0xfff1d6, accent: 0xff9d5c, metal: 0xb08a5a, fog: 0xf6e3c8 } },
    { id: 'mint',     name: 'Mint Workshop', unlockStars: 12,
      palette: { wall: 0xd8efe0, floor: 0xb8dcc4, table: 0x7fae8e, frame: 0x578a6c,
                 light: 0xf4fff6, accent: 0x6fce9a, metal: 0x7a9a86, fog: 0xd8efe0 } },
    { id: 'twilight', name: 'Twilight Loft', unlockStars: 30,
      palette: { wall: 0x2c3350, floor: 0x232842, table: 0x4a4f78, frame: 0x353a5e,
                 light: 0xaac4ff, accent: 0x8fa8ff, metal: 0x6a70a0, fog: 0x2c3350 } },
    { id: 'candy',    name: 'Candy Corner',  unlockStars: 55,
      palette: { wall: 0xfbe0ea, floor: 0xf3c4d8, table: 0xd887ac, frame: 0xb26088,
                 light: 0xfff0f6, accent: 0xff8fb8, metal: 0xc09aaa, fog: 0xfbe0ea } },
    { id: 'ivory',    name: 'Ivory Attic',   unlockStars: 85,
      palette: { wall: 0xf2eee6, floor: 0xe0d8ca, table: 0xb8a88e, frame: 0x93856c,
                 light: 0xfffaf0, accent: 0xe8c07a, metal: 0xa89a80, fog: 0xf2eee6 } }
  ];

  // ---------- journey ----------
  // Compact authored rows:
  // [id, name, seed, rows, cols, colors, goals[], moveLimit, timeLimitSec,
  //  rocketAt, bombAt, parMoves, parTimeSec, themeIdx, intro]
  // goals[i] is the quota for color i (0 = not required). 99 = mechanic off.
  var J = [
    ['j01','First Pops',        201,6,6,4,[10,10,0,0],        0,  0,99,99, 9, 90,0,'Tap any group of 2+ matching cubes to pop them. Fill the goals on the left.'],
    ['j02','Bigger is Better',  202,6,6,4,[12,12,0,0],        0,  0,99,99,10, 95,0,'Bigger groups score more. Hunt for the largest cluster.'],
    ['j03','Rockets',           203,6,6,4,[14,0,14,0],        0,  0, 5,99,12,105,0,'New: pop 5+ cubes at once to forge a rocket. Tap a rocket to clear its whole line.'],
    ['j04','Move Budget',       204,6,6,4,[10,10,10,0],      18,  0, 5,99,12,110,0,'New: a move limit. Every tap must count.'],
    ['j05','Tall Orders',       205,6,6,4,[12,12,0,0],       18,  0, 5,99,11,110,0,''],
    ['j06','Bombs Away',        206,6,6,4,[20,0,0,20],       16,  0, 5, 8,13,120,0,'New: pop 8+ cubes for a bomb that clears everything around it.'],
    ['j07','Chain Reaction',    207,6,6,4,[18,18,0,0],       15,  0, 5, 8,12,120,0,'Blasts trigger other specials. Set up chains for huge scores.'],
    ['j08','Corner Pocket',     208,6,6,4,[14,14,14,0],      16,  0, 5, 8,12,120,0,''],
    ['j09','Grape Arrives',     209,6,6,5,[12,12,12,12,0],   18,  0, 5, 8,14,130,0,'A new color joins the wall: grape.'],
    ['j10','Toy Chest',         210,7,7,5,[16,16,16,0,0],    18,  0, 5, 8,14,130,1,'MASTERY: everything so far, on a bigger wall.'],
    ['j11','Wide Wall',         211,7,7,5,[14,14,14,14,0],   20,  0, 5, 8,16,140,1,''],
    ['j12','Rocket Rally',      212,7,7,5,[0,20,0,20,0],     16,  0, 5, 8,12,120,1,'Rockets are the fastest way to fill two colors at once.'],
    ['j13','Thin Ice',          213,7,7,5,[18,18,18,0,0],    15,  0, 5, 8,12,120,1,''],
    ['j14','Bomb Squad',        214,7,7,5,[24,0,24,0,0],     16,  0, 5, 8,12,130,1,''],
    ['j15','Beat the Clock',    215,7,7,5,[16,16,16,0,0],     0,150, 5, 8,15,135,1,'New: a time limit instead of a move limit. Pop briskly.'],
    ['j16','Tangerine Twist',   216,7,7,6,[12,12,12,12,0,12],20,  0, 5, 8,16,150,2,'The sixth color: tangerine. The wall gets busier.'],
    ['j17','Full Spectrum',     217,7,7,6,[12,12,12,12,12,0],22,  0, 5, 8,18,160,2,''],
    ['j18','Pressure Play',     218,7,7,6,[16,16,0,16,0,0],  15,  0, 5, 8,12,130,2,''],
    ['j19','Double Trouble',    219,7,7,6,[20,0,20,0,0,0],   14,  0, 5, 8,11,120,2,''],
    ['j20','Studio Floor',      220,7,7,6,[16,16,16,16,0,0], 20,  0, 5, 8,15,150,2,'MASTERY: six colors, tight budget.'],
    ['j21','Grand Wall',        221,8,8,6,[14,14,14,14,0,0], 24,  0, 5, 8,18,170,3,'The big wall: eight columns wide.'],
    ['j22','Sky Harvest',       222,8,8,6,[0,0,10,30,0,0],    16,  0, 5, 8,12,140,3,'One huge sky quota, with a leaf side order.'],
    ['j23','Clockwork Pop',     223,8,8,6,[16,16,16,0,0,0],   0,160, 5, 8,16,150,3,''],
    ['j24','Rocket Science',    224,8,8,6,[18,0,18,0,18,0],  18,  0, 5, 8,14,150,3,''],
    ['j25','Deep Reserve',      225,8,8,6,[20,20,0,0,20,0],  20,  0, 5, 8,15,160,3,''],
    ['j26','Blast Furnace',     226,8,8,6,[26,0,0,26,0,0],   17,  0, 5, 8,13,150,3,''],
    ['j27','Narrow Margin',     227,8,8,6,[14,14,14,14,14,0],20,  0, 5, 8,16,160,3,''],
    ['j28','Speed Shelf',       228,8,8,6,[18,18,18,0,0,0],   0,140, 5, 8,16,140,3,''],
    ['j29','Heavy Mix',         229,8,8,6,[16,16,16,16,0,16],24,  0, 5, 8,18,180,3,''],
    ['j30','Grand Parade',      230,8,8,6,[20,20,20,20,0,0], 22,  0, 5, 8,17,170,4,'MASTERY: the full toy studio at once.'],
    ['j31','Chain Gang',        231,8,8,6,[24,0,24,0,0,0],   16,  0, 5, 8,12,150,4,''],
    ['j32','Six-Color Squeeze', 232,8,8,6,[14,14,14,14,14,14],26, 0, 5, 8,20,190,4,''],
    ['j33','Blitz Wall',        233,8,8,6,[20,20,0,20,0,0],   0,130, 5, 8,16,130,4,''],
    ['j34','Rocket Rain',       234,8,8,6,[0,26,0,26,0,0],   16,  0, 5, 8,12,150,4,''],
    ['j35','Bomb Voyage',       235,8,8,6,[30,0,0,0,0,30],   18,  0, 5, 8,14,160,4,''],
    ['j36','Tight Squeeze',     236,8,8,6,[18,18,18,18,0,0], 17,  0, 5, 8,13,150,4,''],
    ['j37','Long Haul',         237,8,8,6,[22,22,22,0,0,0],  24,  0, 5, 8,18,180,4,''],
    ['j38','Time Crunch',       238,8,8,6,[18,18,18,18,0,0],  0,120, 5, 8,16,120,4,''],
    ['j39','Master Budget',     239,8,8,6,[16,16,16,16,16,16],24, 0, 5, 8,19,180,4,''],
    ['j40','Cube Carnival',     240,8,8,6,[24,24,24,24,0,0], 24,  0, 5, 8,18,170,0,'MASTERY: the definitive wall. Good luck.']
  ];

  function expandLevel(row, idx) {
    var goals = {};
    row[6].forEach(function (n, i) { if (n > 0) goals[i] = n; });
    return {
      id: row[0], version: CONTENT_VERSION, kind: 'journey', index: idx,
      name: row[1], seed: row[2],
      board: { rows: row[3], cols: row[4] }, colors: row[5],
      goals: goals, minGroup: 2,
      rocketAt: row[9], bombAt: row[10],
      moveLimit: row[7] || 0, timeLimitSec: row[8] || 0,
      par: { moves: row[11], timeSec: row[12] },
      mechanics: { undo: true, hint: true },
      endless: null,
      theme: THEMES[row[13]].id,
      intro: row[14] || '',
      mastery: /MASTERY/.test(row[14] || '')
    };
  }

  var JOURNEY = J.map(expandLevel);

  // ---------- challenges ----------
  function challenge(o) {
    o.version = CONTENT_VERSION; o.kind = 'challenge';
    o.minGroup = 2; o.endless = null;
    return o;
  }
  var CHALLENGES = [
    challenge({ id: 'c1', name: 'Two-Tone Tangle', seed: 501,
      board: { rows: 7, cols: 7 }, colors: 3, goals: { 0: 25, 1: 25, 2: 25 },
      rocketAt: 5, bombAt: 8, moveLimit: 14, timeLimitSec: 0,
      par: { moves: 11, timeSec: 120 }, mechanics: { undo: false, hint: true }, theme: 'mint',
      intro: 'Only three colors — giant groups and bombs everywhere. 14 moves, no undo.' }),
    challenge({ id: 'c2', name: 'Speed Pop', seed: 502,
      board: { rows: 7, cols: 7 }, colors: 5, goals: { 0: 14, 1: 14, 2: 14, 3: 14 },
      rocketAt: 5, bombAt: 8, moveLimit: 0, timeLimitSec: 90,
      par: { moves: 16, timeSec: 80 }, mechanics: { undo: false, hint: true }, theme: 'candy',
      intro: 'Four colors in 90 seconds. No undo.' }),
    challenge({ id: 'c3', name: 'Frugal Fingers', seed: 503,
      board: { rows: 6, cols: 6 }, colors: 4, goals: { 0: 14, 1: 14, 2: 14 },
      rocketAt: 5, bombAt: 8, moveLimit: 9, timeLimitSec: 0,
      par: { moves: 8, timeSec: 100 }, mechanics: { undo: false, hint: false }, theme: 'twilight',
      intro: 'Nine moves, no assists. Plan every pop.' }),
    challenge({ id: 'c4', name: 'Bomb Brigade', seed: 504,
      board: { rows: 8, cols: 8 }, colors: 5, goals: { 0: 30, 3: 30 },
      rocketAt: 5, bombAt: 7, moveLimit: 14, timeLimitSec: 0,
      par: { moves: 11, timeSec: 150 }, mechanics: { undo: true, hint: true }, theme: 'daybreak',
      intro: 'Bombs come easier (7+). Two big quotas.' }),
    challenge({ id: 'c5', name: 'Rocket Season', seed: 505,
      board: { rows: 8, cols: 8 }, colors: 6, goals: { 2: 24, 3: 24 },
      rocketAt: 4, bombAt: 99, moveLimit: 15, timeLimitSec: 0,
      par: { moves: 12, timeSec: 150 }, mechanics: { undo: true, hint: true }, theme: 'ivory',
      intro: 'Rockets come easier (4+), bombs are off the menu.' }),
    challenge({ id: 'c6', name: 'Grand Constraint', seed: 506,
      board: { rows: 8, cols: 8 }, colors: 6, goals: { 0: 18, 1: 18, 2: 18, 3: 18 },
      rocketAt: 5, bombAt: 8, moveLimit: 18, timeLimitSec: 150,
      par: { moves: 15, timeSec: 140 }, mechanics: { undo: false, hint: false }, theme: 'twilight',
      intro: 'Move limit, time limit, no assists. The full test.' })
  ];

  // ---------- practice presets ----------
  function practice(o) {
    o.version = CONTENT_VERSION; o.kind = 'practice';
    o.minGroup = 2; o.endless = null;
    return o;
  }
  var PRACTICE = [
    practice({ id: 'casual', name: 'Casual',
      board: { rows: 6, cols: 6 }, colors: 4, goals: { 0: 10, 1: 10, 2: 10 },
      rocketAt: 5, bombAt: 8, moveLimit: 0, timeLimitSec: 0,
      par: { moves: 12, timeSec: 150 }, mechanics: { undo: true, hint: true } }),
    practice({ id: 'apprentice', name: 'Apprentice',
      board: { rows: 7, cols: 7 }, colors: 5, goals: { 0: 14, 1: 14, 2: 14, 3: 14 },
      rocketAt: 5, bombAt: 8, moveLimit: 20, timeLimitSec: 0,
      par: { moves: 16, timeSec: 180 }, mechanics: { undo: true, hint: true } }),
    practice({ id: 'expert', name: 'Expert',
      board: { rows: 8, cols: 8 }, colors: 6, goals: { 0: 18, 1: 18, 2: 18, 3: 18 },
      rocketAt: 5, bombAt: 8, moveLimit: 20, timeLimitSec: 0,
      par: { moves: 16, timeSec: 210 }, mechanics: { undo: true, hint: true } })
  ];

  // ---------- score chase ruleset (endless waves) ----------
  var SCORE_CHASE = {
    id: 'score-std', version: CONTENT_VERSION, kind: 'score', name: 'Endless Wall',
    board: { rows: 8, cols: 8 }, colors: 5, goals: { 0: 10, 1: 10 }, minGroup: 2,
    rocketAt: 5, bombAt: 8, moveLimit: 0, timeLimitSec: 0,
    par: null, mechanics: { undo: false, hint: false },
    endless: { moveBank: 20, movesPerWave: 12 }, theme: 'daybreak',
    intro: 'Goals keep coming in waves. Each wave banked adds moves — play until the bank runs dry.'
  };

  // ---------- daily ----------
  // One immutable ruleset per UTC day, derived purely from the date string.
  function dailyConfig(dateStr) {
    var seed = RNG.hashString('cubepop-daily-v' + CONTENT_VERSION + '-' + dateStr);
    var day = Math.floor(Date.parse(dateStr + 'T00:00:00Z') / 86400000);
    var rot = ((day % 7) + 7) % 7;
    var colors = 4 + (rot % 3); // 4..6
    var goals = {};
    var nGoals = 2 + (rot % 2); // 2..3 colors
    for (var i = 0; i < nGoals; i++) goals[(rot + i) % colors] = 12 + rot * 2;
    return {
      id: 'daily-' + dateStr, version: CONTENT_VERSION, kind: 'daily',
      name: 'Daily ' + dateStr, seed: seed, date: dateStr,
      board: { rows: rot >= 4 ? 8 : 7, cols: rot >= 4 ? 8 : 7 },
      colors: colors, goals: goals, minGroup: 2,
      rocketAt: rot === 5 ? 4 : 5, bombAt: rot === 3 ? 7 : 8,
      moveLimit: 16 + rot, timeLimitSec: rot === 6 ? 150 : 0,
      par: { moves: 13 + rot, timeSec: 140 },
      mechanics: { undo: true, hint: true }, endless: null,
      theme: THEMES[rot % THEMES.length].id,
      intro: 'One shared seed for everyone, today only.'
    };
  }

  function utcDateString(nowMs) {
    var d = new Date(nowMs == null ? Date.now() : nowMs);
    return d.getUTCFullYear() + '-' +
      String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
      String(d.getUTCDate()).padStart(2, '0');
  }

  // ---------- tutorial (Learn) ----------
  // Fixture grids: arrays of color indices, row 0 at the top.
  // Lessons use the same rules engine and legal-action API as real play.
  function tutorialLessons() {
    function tutCfg(id, seed, over) {
      return Object.assign({
        id: id, version: CONTENT_VERSION, kind: 'tutorial', seed: seed,
        board: { rows: 5, cols: 5 }, colors: 2, goals: { 0: 99 }, minGroup: 2,
        rocketAt: 5, bombAt: 8, moveLimit: 0, timeLimitSec: 0,
        par: null, mechanics: { undo: false, hint: false }, endless: null
      }, over || {});
    }
    return [
      { id: 't1', title: 'Pop a group',
        text: 'Cubes of the same color stick together. Tap any group of 2 or more matching cubes to pop them. Try it now — any group works.',
        goal: { event: 'pop', count: 1 },
        cfg: tutCfg('t1', 9001),
        force: { grid: [
          [0, 0, 1, 1, 0],
          [1, 0, 1, 0, 0],
          [1, 1, 0, 0, 1],
          [0, 1, 1, 0, 1],
          [0, 0, 1, 1, 0]
        ] } },
      { id: 't2', title: 'Forge a rocket',
        text: 'Groups of 5 or more leave a rocket behind. Pop the big cherry cluster in the middle — the cube you tap becomes the rocket.',
        goal: { event: 'special-create', count: 1 },
        cfg: tutCfg('t2', 9002),
        force: { grid: [
          [1, 1, 0, 1, 1],
          [1, 0, 0, 0, 1],
          [1, 1, 0, 1, 1],
          [0, 0, 1, 0, 0],
          [0, 1, 1, 1, 0]
        ] } },
      { id: 't3', title: 'Fire a rocket',
        text: 'A rocket sits on the wall. Tap it to clear its whole row or column in one blast.',
        goal: { event: 'fire', count: 1 },
        cfg: tutCfg('t3', 9003),
        force: { grid: [
          [1, 0, 1, 0, 1],
          [0, 1, 0, 1, 0],
          [1, 0, 1, 0, 1],
          [0, 1, 0, 1, 0],
          [1, 0, 1, 0, 1]
        ], specials: [{ r: 2, c: 2, s: 1 }] } },
      { id: 't4', title: 'Chain reaction',
        text: 'Two rockets share a row. Fire one — its blast sets off the other. Chained specials earn big bonus points.',
        goal: { event: 'chain', count: 1 },
        cfg: tutCfg('t4', 9004),
        force: { grid: [
          [1, 0, 1, 0, 1],
          [0, 1, 0, 1, 0],
          [1, 0, 1, 0, 1],
          [0, 1, 0, 1, 0],
          [1, 0, 1, 0, 1]
        ], specials: [{ r: 2, c: 1, s: 1 }, { r: 2, c: 3, s: 1 }] } },
      { id: 't5', title: 'Make a bomb',
        text: 'Groups of 8 or more leave a bomb that clears everything around it. Pop the huge cherry cluster to forge one.',
        goal: { event: 'special-create', count: 1 },
        cfg: tutCfg('t5', 9005),
        force: { grid: [
          [0, 0, 0, 1, 1],
          [1, 0, 0, 1, 1],
          [1, 1, 0, 0, 1],
          [1, 1, 1, 0, 1],
          [1, 1, 1, 1, 1]
        ] } },
      { id: 't6', title: 'Finish the stage',
        text: 'The goal rail (left) asks for 2 cherry cubes. Pop the cherry pair to complete the stage — that is a win.',
        goal: { event: 'win', count: 1 },
        cfg: tutCfg('t6', 9006, { goals: { 0: 2 }, moveLimit: 6 }),
        force: { grid: [
          [1, 1, 0, 1, 1],
          [1, 0, 1, 1, 0],
          [0, 0, 1, 0, 1],
          [1, 1, 0, 1, 1],
          [1, 0, 1, 1, 0]
        ] } },
      { id: 't7', title: 'Second chances',
        text: 'In relaxed modes you can undo a pop (U) or ask for a hint (H). Pop any group, then undo it to finish the lesson.',
        goal: { event: 'undo', count: 1 },
        cfg: tutCfg('t7', 9007, { goals: { 0: 99 }, mechanics: { undo: true, hint: true } }),
        force: { grid: [
          [0, 0, 1, 1, 0],
          [1, 0, 1, 0, 0],
          [1, 1, 0, 0, 1],
          [0, 1, 1, 0, 1],
          [0, 0, 1, 1, 0]
        ] } }
    ];
  }

  // ---------- achievements (stable lowercase keys, idempotent) ----------
  var ACHIEVEMENTS = [
    { key: 'first-pop',     name: 'First Pop',      desc: 'Pop your first group of cubes.' },
    { key: 'first-win',     name: 'Goal Getter',    desc: 'Complete all goals in a stage.' },
    { key: 'first-rocket',  name: 'Rocketeer',      desc: 'Forge your first rocket.' },
    { key: 'first-bomb',    name: 'Demolitionist',  desc: 'Forge your first bomb.' },
    { key: 'chain-3',       name: 'Chain Artist',   desc: 'Fire 3+ specials in a single move.' },
    { key: 'big-group',     name: 'Crowd Pleaser',  desc: 'Pop a group of 12 or more cubes.' },
    { key: 'cubes-1000',    name: 'Cube Veteran',   desc: 'Clear 1000 cubes in total.' },
    { key: 'journey-half',  name: 'Half the Journey', desc: 'Finish 20 journey stages.' },
    { key: 'journey-done',  name: 'Studio Master',  desc: 'Finish all 40 journey stages.' },
    { key: 'daily-7',       name: 'Regular',        desc: 'Finish 7 daily challenges.' },
    { key: 'score-3000',    name: 'High Shelf',     desc: 'Score 3000+ in a single round.' }
  ];

  return {
    CONTENT_VERSION: CONTENT_VERSION,
    COLORS: COLORS,
    THEMES: THEMES,
    JOURNEY: JOURNEY,
    CHALLENGES: CHALLENGES,
    PRACTICE: PRACTICE,
    SCORE_CHASE: SCORE_CHASE,
    ACHIEVEMENTS: ACHIEVEMENTS,
    dailyConfig: dailyConfig,
    utcDateString: utcDateString,
    tutorialLessons: tutorialLessons
  };
});
