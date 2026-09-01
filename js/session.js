/* Cube Pop — session module: round lifecycle on top of the rules engine,
 * undo stack, replay envelope, local persistence, server-time sync, and
 * daily score submission. No rendering here. Exposes window.CPSession.
 */
(function (root) {
  'use strict';
  var Rules = root.CPRules, Content = root.CPContent, RNG = root.CPRNG;

  var BUILD = '1.0.0';
  var LS = {
    settings: 'cubepop:settings:v1',
    progress: 'cubepop:progress:v1',
    achievements: 'cubepop:achievements:v1',
    savedRound: 'cubepop:saved-round:v1',
    dailyBest: 'cubepop:daily-best:v1'
  };

  // ---------- storage helpers ----------
  function readLS(k, fallback) {
    try {
      var raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function writeLS(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full/blocked */ }
  }
  function checksum(obj) {
    return RNG.hashString(Rules.stableStringify(obj)) >>> 0;
  }

  // ---------- settings ----------
  var DEFAULT_SETTINGS = {
    volMusic: 0.5, volEffects: 0.8, volAmbience: 0.4, muted: false,
    quality: 'auto',          // auto | high | medium | low
    reducedMotion: false, highContrast: false, largeText: false,
    leftHanded: false, captions: true, confirmPop: false,
    theme: 'daybreak'
  };
  function loadSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, readLS(LS.settings, {}));
  }
  function saveSettings(s) { writeLS(LS.settings, s); }

  // ---------- progress (versioned, checksummed cloud-save-shaped doc) ----------
  function loadProgress() {
    var doc = readLS(LS.progress, null);
    if (!doc || doc.v !== 1) doc = { v: 1, stars: {}, completed: {}, dailiesDone: {}, totalCubes: 0 };
    if (doc.sum !== checksum({ v: doc.v, stars: doc.stars, completed: doc.completed, dailiesDone: doc.dailiesDone, totalCubes: doc.totalCubes })) {
      doc = { v: 1, stars: {}, completed: {}, dailiesDone: {}, totalCubes: 0 }; // corrupt → reset safely
    }
    return doc;
  }
  function saveProgress(p) {
    p.sum = checksum({ v: p.v, stars: p.stars, completed: p.completed, dailiesDone: p.dailiesDone, totalCubes: p.totalCubes });
    writeLS(LS.progress, p);
  }
  function totalStars(p) {
    var n = 0; for (var k in p.stars) n += p.stars[k];
    return n;
  }

  // ---------- achievements (idempotent) ----------
  function loadAchievements() { return readLS(LS.achievements, {}); }
  function unlockAchievement(key) {
    var have = loadAchievements();
    if (have[key]) return false; // idempotent
    have[key] = Date.now();
    writeLS(LS.achievements, have);
    return true;
  }

  // ---------- server time sync ----------
  var timeOffset = 0; // serverNow - clientNow
  function syncTime() {
    var t0 = Date.now();
    return fetch('/api/v1/time').then(function (r) {
      if (!r.ok) throw new Error('time ' + r.status);
      return r.json();
    }).then(function (body) {
      var t1 = Date.now();
      var serverNow = typeof body.now === 'number' ? body.now : body.serverTime;
      if (typeof serverNow !== 'number') throw new Error('invalid time response');
      timeOffset = serverNow - Math.round((t0 + t1) / 2);
      return timeOffset;
    }).catch(function () { timeOffset = 0; return 0; });
  }
  function now() { return Date.now() + timeOffset; }
  function todayUtc() { return Content.utcDateString(now()); }

  // ---------- session ----------
  function Session(cfg, opts) {
    opts = opts || {};
    this.cfg = cfg;
    this.kind = cfg.kind;
    this.lesson = opts.lesson || null;
    this.state = Rules.createGame(cfg);
    if (opts.forcedGrid) {
      this.state.grid = opts.forcedGrid.map(function (row) {
        return row.map(function (c) { return { c: c, s: 0 }; });
      });
      (opts.forcedSpecials || []).forEach(function (sp) {
        this.state.grid[sp.r][sp.c] = { c: this.state.grid[sp.r][sp.c].c, s: sp.s };
      }, this);
    }
    this.initHash = Rules.hashState(this.state);
    this.commands = [];
    this.seenIds = {};
    this.hashes = [this.initHash];
    this.undoStack = [];      // serialized prior states (rules-permitting)
    this.startPerf = 0;       // performance.now at activation
    this.lessonEvents = {};   // lesson goal counters
    this.invalidCount = 0;
  }

  Session.prototype.elapsed = function () {
    return this.startPerf ? Math.max(0, performance.now() - this.startPerf) : this.state.elapsedMs;
  };

  Session.prototype._record = function (cmd, state) {
    this.commands.push(cmd);
    if (this.commands.length % 5 === 0 || state.terminal) this.hashes.push(Rules.hashState(state));
  };

  // Command entry point. Returns rules result plus dedupe handling.
  Session.prototype.command = function (cmd) {
    var shapeErr = Rules.validateCommandShape(cmd);
    if (shapeErr) return { ok: false, reason: shapeErr, state: this.state, events: [] };
    if (cmd.id) {
      if (this.seenIds[cmd.id]) return { ok: false, reason: 'duplicate', state: this.state, events: [], duplicate: true };
      this.seenIds[cmd.id] = true;
    }
    if (cmd.type === 'pop' && this.cfg.mechanics && this.cfg.mechanics.undo) {
      this.undoStack.push(Rules.serialize(this.state));
      if (this.undoStack.length > 30) this.undoStack.shift();
    }
    var res = Rules.applyCommand(this.state, cmd);
    if (!res.ok) { this.invalidCount++; return res; }
    this.state = res.state;
    this._record(cmd, this.state);
    var self = this;
    res.events.forEach(function (e) {
      self.lessonEvents[e.type] = (self.lessonEvents[e.type] || 0) + 1;
    });
    return res;
  };

  Session.prototype.pop = function (r, c, id) {
    return this.command({ type: 'pop', id: id, r: r, c: c, atMs: Math.round(this.elapsed()) });
  };

  Session.prototype.tickClock = function () {
    if (this.state.terminal) return null;
    var res = this.command({ type: 'tick', atMs: Math.round(this.elapsed()) });
    return res;
  };

  Session.prototype.canUndo = function () {
    return !!(this.cfg.mechanics && this.cfg.mechanics.undo && this.undoStack.length && !this.state.terminal);
  };

  Session.prototype.undo = function () {
    if (!this.canUndo()) return false;
    var prev = this.undoStack.pop();
    this.state = Rules.deserialize(prev);
    // Undo removes the last pop command from the replay log.
    for (var i = this.commands.length - 1; i >= 0; i--) {
      if (this.commands[i].type === 'pop') { this.commands.splice(i, 1); break; }
    }
    this.lessonEvents.undo = (this.lessonEvents.undo || 0) + 1;
    this.hashes.push(Rules.hashState(this.state));
    return true;
  };

  Session.prototype.hint = function () { return Rules.hint(this.state); };
  Session.prototype.resign = function () { return this.command({ type: 'resign' }); };

  Session.prototype.lessonGoalMet = function () {
    if (!this.lesson) return false;
    var g = this.lesson.goal;
    if (g.event === 'win') return !!(this.state.terminal && this.state.terminal.won);
    return (this.lessonEvents[g.event] || 0) >= g.count;
  };

  // Replay envelope per spec §5.
  Session.prototype.envelope = function () {
    return {
      schema: 1, build: BUILD, contentVersion: this.cfg.version,
      cfgId: this.cfg.id, seed: this.state.seed,
      initHash: this.initHash,
      startedOffsetMs: 0,
      commands: this.commands.slice(),
      hashes: this.hashes.slice(),
      invalidCount: this.invalidCount,
      assists: {
        undo: !!(this.cfg.mechanics && this.cfg.mechanics.undo),
        hint: !!(this.cfg.mechanics && this.cfg.mechanics.hint)
      },
      result: this.state.terminal ? {
        reason: this.state.terminal.reason, won: this.state.terminal.won,
        score: this.state.score, moves: this.state.moves, elapsedMs: this.state.elapsedMs
      } : null,
      finalHash: Rules.hashState(this.state)
    };
  };

  // Star rating: 1 = finished, +1 within par moves, +1 within par time.
  Session.prototype.stars = function () {
    if (!this.state.terminal || !this.state.terminal.won) return 0;
    var par = this.cfg.par, n = 1;
    if (par) {
      if (par.moves && this.state.moves <= par.moves) n++;
      if (par.timeSec && this.state.elapsedMs <= par.timeSec * 1000) n++;
    }
    return n;
  };

  // ---------- saved round (pause-safe resume) ----------
  Session.prototype.saveSnapshot = function () {
    if (this.state.terminal) { this.clearSnapshot(); return; }
    writeLS(LS.savedRound, {
      cfgId: this.cfg.id, cfg: this.cfg, lessonId: this.lesson ? this.lesson.id : null,
      state: Rules.serialize(this.state), commands: this.commands,
      initHash: this.initHash, savedAt: Date.now()
    });
  };
  Session.clearSnapshot = function () { try { localStorage.removeItem(LS.savedRound); } catch (e) {} };
  Session.prototype.clearSnapshot = Session.clearSnapshot;

  Session.loadSnapshot = function () {
    var doc = readLS(LS.savedRound, null);
    if (!doc) return null;
    try {
      var s = new Session(doc.cfg, {});
      s.state = Rules.deserialize(doc.state);
      s.commands = doc.commands || [];
      s.commands.forEach(function (c) { if (c.id) s.seenIds[c.id] = true; });
      s.initHash = doc.initHash;
      return s;
    } catch (e) { return null; }
  };

  // ---------- daily leaderboard ----------
  function submitDaily(name, date, envelope) {
    return fetch('/api/v1/daily/submit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, date: date, envelope: envelope })
    }).then(function (r) {
      return r.json().then(function (body) {
        if (!r.ok) throw new Error(body.error || ('http ' + r.status));
        return body;
      });
    });
  }
  function dailyBoard(date) {
    return fetch('/api/v1/daily/board?date=' + encodeURIComponent(date))
      .then(function (r) { return r.json(); });
  }

  root.CPSession = {
    BUILD: BUILD,
    Session: Session,
    loadSettings: loadSettings, saveSettings: saveSettings,
    loadProgress: loadProgress, saveProgress: saveProgress, totalStars: totalStars,
    loadAchievements: loadAchievements, unlockAchievement: unlockAchievement,
    syncTime: syncTime, now: now, todayUtc: todayUtc,
    submitDaily: submitDaily, dailyBoard: dailyBoard,
    readLS: readLS, writeLS: writeLS, LS: LS
  };
})(typeof self !== 'undefined' ? self : this);
