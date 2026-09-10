/* Cube Pop — UI module: responsive DOM shell, screens, HUD, settings,
 * accessibility mirror, keyboard input, results, persistence.
 * Depends on window.CPRules / CPContent / CPSession / CPAudio.
 * Exposes window.CPUI.init({ createRenderer }) called by main.js.
 */
(function (root) {
  'use strict';
  var Rules, Content, Sess, Audio;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function esc(s) { return String(s); }

  function announce(msg) { $('live-status').textContent = ''; $('live-status').textContent = msg; }
  function announceAlert(msg) { $('live-alert').textContent = ''; $('live-alert').textContent = msg; }
  function toast(msg, ms) {
    var t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.hidden = true; }, ms || 2600);
  }

  // ------------------------------------------------------------------ app
  var app = {
    state: 'boot',           // boot|title|mode-select|preparing|countdown|active|paused|resolving|results
    session: null,
    renderer: null,
    createRenderer: null,
    settings: null,
    progress: null,
    focus: { r: 0, c: 0 },
    inputLocked: false,
    pausedAt: 0,
    cmdSeq: 0,
    clockTimer: null,
    timeWarned: false,       // one 15-second warning per round
    lastFocusEl: null,
    currentList: null,       // which list screen a round was launched from
    currentIdx: 0,
    webglFailed: false
  };

  function setState(next, reason) {
    app.state = next;
    document.body.dataset.gameState = next;
  }

  function showScreen(name) {
    document.querySelectorAll('.screen').forEach(function (s) { s.hidden = s.dataset.screen !== name; });
    var scr = document.querySelector('[data-screen="' + name + '"]');
    if (scr) {
      var h = scr.querySelector('h2, h3, button');
      if (h) h.focus && h.focus();
    }
    if (name !== 'game') setState(name === 'title' ? 'title' : 'mode-select', 'show-screen');
  }

  // ------------------------------------------------------------- settings
  function applySettings() {
    var s = app.settings;
    document.body.classList.toggle('reduced-motion', !!s.reducedMotion);
    document.body.classList.toggle('high-contrast', !!s.highContrast);
    document.body.classList.toggle('large-text', !!s.largeText);
    document.body.classList.toggle('left-handed', !!s.leftHanded);
    Audio.setVolume('music', s.volMusic);
    Audio.setVolume('effects', s.volEffects);
    Audio.setVolume('ambience', s.volAmbience);
    Audio.setMuted(!!s.muted);
    if (app.renderer) {
      app.renderer.setReducedMotion(!!s.reducedMotion);
      app.renderer.setQuality(resolveTier(s.quality));
      var theme = themeById(s.theme);
      if (!themeUnlocked(theme)) theme = Content.THEMES[0]; // e.g. after a progress reset
      app.renderer.setTheme(theme.palette, Content.COLORS, !!s.highContrast);
      if (app.session) app.renderer.syncToState(app.session.state);
    }
    $('captions').style.display = s.captions ? '' : 'none';
  }
  function resolveTier(q) {
    if (q && q !== 'auto') return q;
    var cores = navigator.hardwareConcurrency || 4;
    var mem = navigator.deviceMemory || 4;
    var mobile = /Mobi|Android/i.test(navigator.userAgent);
    if (mobile && (cores <= 4 || mem <= 3)) return 'low';
    if (mobile || cores <= 4) return 'medium';
    return 'high';
  }
  function themeById(id) {
    var t = Content.THEMES.filter(function (x) { return x.id === id; })[0];
    return t || Content.THEMES[0];
  }
  function themeUnlocked(t) {
    return Sess.totalStars(app.progress) >= t.unlockStars;
  }

  function bindSettings() {
    var s = app.settings;
    $('set-vol-music').value = s.volMusic;
    $('set-vol-effects').value = s.volEffects;
    $('set-vol-ambience').value = s.volAmbience;
    $('set-muted').checked = !!s.muted;
    $('set-captions').checked = !!s.captions;
    $('set-quality').value = s.quality;
    $('set-reduced-motion').checked = !!s.reducedMotion;
    $('set-high-contrast').checked = !!s.highContrast;
    $('set-large-text').checked = !!s.largeText;
    $('set-left-handed').checked = !!s.leftHanded;
    var themeSel = $('set-theme');
    themeSel.innerHTML = '';
    Content.THEMES.forEach(function (t) {
      var o = el('option', '', t.name + (themeUnlocked(t) ? '' : ' (unlock at ' + t.unlockStars + '★)'));
      o.value = t.id;
      o.disabled = !themeUnlocked(t);
      themeSel.appendChild(o);
    });
    themeSel.value = themeUnlocked(themeById(s.theme)) ? s.theme : Content.THEMES[0].id;

    function save() { Sess.saveSettings(app.settings); applySettings(); }
    $('set-vol-music').oninput = function () { s.volMusic = +this.value; save(); };
    $('set-vol-effects').oninput = function () { s.volEffects = +this.value; save(); Audio.pop(3); };
    $('set-vol-ambience').oninput = function () { s.volAmbience = +this.value; save(); };
    $('set-muted').onchange = function () { s.muted = this.checked; save(); };
    $('set-captions').onchange = function () { s.captions = this.checked; save(); };
    $('set-quality').onchange = function () { s.quality = this.value; save(); toast('Quality tier: ' + this.value); };
    $('set-theme').onchange = function () { s.theme = this.value; save(); };
    $('set-reduced-motion').onchange = function () { s.reducedMotion = this.checked; save(); };
    $('set-high-contrast').onchange = function () { s.highContrast = this.checked; save(); };
    $('set-large-text').onchange = function () { s.largeText = this.checked; save(); };
    $('set-left-handed').onchange = function () { s.leftHanded = this.checked; save(); };
    $('btn-replay-tutorial').onclick = function () {
      app.progress.completed = app.progress.completed || {};
      Content.tutorialLessons().forEach(function (l) { delete app.progress.completed[l.id]; });
      Sess.saveProgress(app.progress);
      showLearn();
      showScreen('learn');
      toast('Tutorial reset. Lesson 1 is ready.');
    };
    $('btn-reset-progress').onclick = function () {
      if (!confirm('Reset journey stars, achievements, and saved rounds?')) return;
      Sess.Session.clearSnapshot();
      localStorage.removeItem(Sess.LS.progress);
      localStorage.removeItem(Sess.LS.achievements);
      localStorage.removeItem(Sess.LS.dailyBest);
      app.progress = Sess.loadProgress();
      refreshTitle();
      toast('Progress reset.');
    };
  }

  // ------------------------------------------------------------- lists
  function levelCard(cfg, opts) {
    var b = el('button', 'level-card' + (opts.mastery ? ' mastery' : '') + (opts.locked ? ' locked' : ''));
    b.disabled = !!opts.locked;
    var name = el('span', 'card-name', esc(cfg.name));
    b.appendChild(name);
    var meta = [];
    if (cfg.moveLimit) meta.push(cfg.moveLimit + ' moves');
    if (cfg.timeLimitSec) meta.push(cfg.timeLimitSec + 's');
    if (cfg.endless) meta.push('endless');
    meta.push(cfg.board.rows + '×' + cfg.board.cols);
    meta.push(cfg.colors + ' colors');
    b.appendChild(el('span', 'card-meta', meta.join(' · ')));
    if (opts.stars) b.appendChild(el('span', 'stars', '★'.repeat(opts.stars) + '☆'.repeat(3 - opts.stars)));
    if (opts.locked) b.appendChild(el('span', 'card-meta', 'Finish the previous stage to unlock.'));
    if (cfg.intro) b.appendChild(el('span', 'card-meta', esc(cfg.intro)));
    b.setAttribute('role', 'listitem');
    b.onclick = function () { opts.onPick(); };
    return b;
  }

  function showJourney() {
    var list = $('journey-list');
    list.innerHTML = '';
    Content.JOURNEY.forEach(function (lvl, i) {
      var locked = i > 0 && !app.progress.completed[Content.JOURNEY[i - 1].id];
      list.appendChild(levelCard(lvl, {
        locked: locked, mastery: lvl.mastery,
        stars: app.progress.stars[lvl.id] || 0,
        onPick: function () { app.currentList = 'journey'; app.currentIdx = i; startRound(lvl); }
      }));
    });
  }

  function showPractice() {
    var list = $('practice-list');
    list.innerHTML = '';
    Content.PRACTICE.forEach(function (cfg, i) {
      list.appendChild(levelCard(cfg, {
        onPick: function () { app.currentList = 'practice'; app.currentIdx = i; startRound(cfg); }
      }));
    });
  }

  function showChallenge() {
    var list = $('challenge-list');
    list.innerHTML = '';
    Content.CHALLENGES.forEach(function (cfg, i) {
      list.appendChild(levelCard(cfg, {
        stars: app.progress.stars[cfg.id] || 0,
        onPick: function () { app.currentList = 'challenge'; app.currentIdx = i; startRound(cfg); }
      }));
    });
  }

  function showLearn() {
    var list = $('learn-list');
    list.innerHTML = '';
    Content.tutorialLessons().forEach(function (lesson, i) {
      var locked = i > 0 && !app.progress.completed[Content.tutorialLessons()[i - 1].id];
      var b = levelCard({
        name: (i + 1) + '. ' + lesson.title, intro: lesson.text,
        moveLimit: 0, timeLimitSec: 0, endless: null, board: lesson.cfg.board, colors: lesson.cfg.colors
      }, {
        locked: locked,
        onPick: function () {
          app.currentList = 'learn'; app.currentIdx = i;
          startRound(lesson.cfg, { lesson: lesson, forcedGrid: lesson.force.grid, forcedSpecials: lesson.force.specials });
        }
      });
      if (app.progress.completed[lesson.id]) b.appendChild(el('span', 'stars', '✓ done'));
      list.appendChild(b);
    });
  }

  function showAchievements() {
    var have = Sess.loadAchievements();
    var list = $('ach-list');
    list.innerHTML = '';
    Content.ACHIEVEMENTS.forEach(function (a) {
      var li = el('li', have[a.key] ? 'done' : 'locked');
      li.appendChild(el('span', 'ach-name', (have[a.key] ? '✓ ' : '') + a.name + ' — '));
      li.appendChild(el('span', '', a.desc));
      list.appendChild(li);
    });
  }

  function dailyCfg() { return Content.dailyConfig(Sess.todayUtc()); }

  function showDaily() {
    var cfg = dailyCfg();
    var info = $('daily-info');
    info.innerHTML = '';
    info.appendChild(el('p', '', 'Seed ' + cfg.seed + ' · ' + cfg.board.rows + '×' + cfg.board.cols +
      ' · ' + cfg.colors + ' colors · ' + (cfg.moveLimit ? cfg.moveLimit + ' moves' : 'no move limit') +
      (cfg.timeLimitSec ? ' · ' + cfg.timeLimitSec + 's' : '')));
    var best = Sess.readLS(Sess.LS.dailyBest, {});
    if (best[cfg.date]) info.appendChild(el('p', '', 'Your best today: ' + best[cfg.date] + ' points'));
    var msLeft = (function () {
      var d = new Date(Sess.now());
      var next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      return next - Sess.now();
    })();
    var hh = Math.floor(msLeft / 3600000), mm = Math.floor(msLeft % 3600000 / 60000);
    info.appendChild(el('p', 'muted', 'New challenge in ' + hh + 'h ' + mm + 'm (server-synced).'));
    $('daily-note').textContent = '';
    refreshDailyBoard(cfg.date);
    $('btn-daily-play').onclick = function () { app.currentList = 'daily'; app.currentIdx = 0; startRound(cfg); };
  }

  function refreshDailyBoard(date) {
    var ol = $('daily-board');
    ol.innerHTML = '';
    Sess.dailyBoard(date).then(function (body) {
      $('status-net').className = 'net-ok';
      $('status-net').textContent = 'online';
      (body.entries || []).forEach(function (e2) {
        ol.appendChild(el('li', '', esc(e2.name) + ' — ' + e2.score + ' pts (' + e2.moves + ' moves' +
          (e2.won ? ', goals complete' : '') + ')'));
      });
      if (!ol.children.length) ol.appendChild(el('li', '', 'No validated scores yet today.'));
    }).catch(function () {
      $('status-net').className = 'net-off';
      $('status-net').textContent = 'offline';
      $('daily-note').textContent = 'Offline: today\'s board is unavailable; your run is still recorded locally.';
    });
  }

  function showScore() {
    var info = $('score-info');
    info.textContent = Content.SCORE_CHASE.intro;
    var best = Sess.readLS('cubepop:score-best:v1', []);
    var ol = $('score-best');
    ol.innerHTML = '';
    best.slice(0, 10).forEach(function (r) {
      ol.appendChild(el('li', '', r.score + ' pts · wave ' + r.waves + ' · ' + new Date(r.at).toLocaleDateString()));
    });
    if (!best.length) ol.appendChild(el('li', '', 'No runs yet.'));
    $('btn-score-play').onclick = function () {
      app.currentList = 'score'; app.currentIdx = 0;
      var cfg = Object.assign({}, Content.SCORE_CHASE, { seed: (Math.random() * 0xffffffff) >>> 0 });
      startRound(cfg);
    };
  }

  // ------------------------------------------------------------- help
  function showHelp() {
    var cards = $('help-cards');
    cards.innerHTML = '';
    [
      ['Pop groups', 'Tap a connected group of 2 or more matching cubes to pop them. Popped cubes count toward the goals on the left.'],
      ['Rockets', 'A group of 5+ leaves a rocket on the tapped cube. Tap the rocket to clear its whole row or column. Taller groups make column rockets; wider groups make row rockets.'],
      ['Bombs', 'A group of 8+ leaves a bomb. Tap it to clear a 3×3 area around it.'],
      ['Chains', 'Blasts that touch other specials set them off too. Each extra special in one move earns a chain bonus.'],
      ['Goals and limits', 'Fill every color quota to win. Some stages limit your moves or time — unused moves and fast finishes earn bonus points.'],
      ['No dead ends', 'If no legal move remains, the wall reshuffles itself for free.'],
      ['Assists', 'Where allowed: H shows a hint, U undoes your last pop. Challenges may disable them.']
    ].forEach(function (c) {
      var d = el('div', 'help-card');
      d.appendChild(el('h4', '', c[0]));
      d.appendChild(el('p', '', c[1]));
      cards.appendChild(d);
    });
  }

  // ------------------------------------------------------------- HUD
  function colorLabel(i) { return Content.COLORS[i % Content.COLORS.length]; }
  function colorHex(i, css) {
    var n = app.settings && app.settings.highContrast ? colorLabel(i).colorHC : colorLabel(i).color;
    return css ? '#' + n.toString(16).padStart(6, '0') : n;
  }

  function updateHUD() {
    var st = app.session && app.session.state;
    if (!st) return;
    $('hud-score').textContent = Rules.currentScore(st);
    if (st.cfg.endless) {
      $('hud-moves-wrap').hidden = true;
      $('hud-wave-wrap').hidden = false;
      $('hud-bank-wrap').hidden = false;
      $('hud-wave').textContent = st.wave;
      var left = st.moveBank - st.moves;
      $('hud-bank').textContent = left;
      $('hud-bank-wrap').classList.toggle('danger', left <= 3);
    } else if (st.cfg.moveLimit) {
      $('hud-moves-wrap').hidden = false;
      $('hud-wave-wrap').hidden = true;
      $('hud-bank-wrap').hidden = true;
      var mLeft = st.cfg.moveLimit - st.moves;
      $('hud-moves').textContent = mLeft;
      $('hud-moves-wrap').classList.toggle('danger', mLeft <= 3);
    } else {
      $('hud-moves-wrap').hidden = false;
      $('hud-moves').textContent = st.moves;
      $('hud-moves-wrap').classList.remove('danger');
      $('hud-wave-wrap').hidden = true;
      $('hud-bank-wrap').hidden = true;
    }
    var goals = $('goal-list');
    goals.innerHTML = '';
    Object.keys(st.cfg.goals).forEach(function (g) {
      var need = st.cfg.goals[g], haveN = st.goals[g] || 0;
      var li = el('li', haveN >= need ? 'done' : '');
      var sw = el('span', 'goal-swatch', colorLabel(+g).icon);
      sw.style.background = colorHex(+g, true);
      sw.setAttribute('aria-hidden', 'true');
      li.appendChild(sw);
      li.appendChild(el('span', 'goal-progress', colorLabel(+g).label + ' ' + Math.min(haveN, need) + ' / ' + need));
      goals.appendChild(li);
    });
    $('btn-undo').disabled = !app.session.canUndo();
    $('btn-hint').disabled = !(st.cfg.mechanics && st.cfg.mechanics.hint) || !!st.terminal;
    updateMirror();
  }

  function updateClock() {
    var st = app.session && app.session.state;
    if (!st) return;
    var cfg = st.cfg;
    if (cfg.timeLimitSec && (app.state === 'active' || app.state === 'resolving')) {
      var remain = Math.max(0, cfg.timeLimitSec * 1000 - app.session.elapsed());
      $('hud-time-wrap').hidden = false;
      $('hud-time').textContent = Math.ceil(remain / 1000) + 's';
      $('hud-time-wrap').classList.toggle('danger', remain < 15000);
      if (remain < 15000 && remain > 0 && !st.terminal && !app.timeWarned && app.state === 'active') {
        app.timeWarned = true;
        Audio.timeWarning();
        announce('15 seconds left.');
      }
      if (remain <= 0 && !st.terminal) {
        var res = app.session.tickClock();
        if (res && res.ok && res.state.terminal) endRound(res.events);
      }
    } else if (!st.terminal && !cfg.timeLimitSec) {
      $('hud-time-wrap').hidden = true;
    }
  }

  // ------------------------------------------------------- board mirror
  // DOM equivalent of the canvas board: fully keyboard/screen-reader usable.
  function updateMirror() {
    var st = app.session && app.session.state;
    var table = $('board-mirror');
    table.innerHTML = '';
    if (!st) return;
    for (var r = 0; r < st.grid.length; r++) {
      var tr = document.createElement('tr');
      for (var c = 0; c < st.grid[r].length; c++) {
        var td = document.createElement('td');
        var cell = st.grid[r][c];
        var b = el('button', 'mirror-cell');
        if (cell) {
          var desc = colorLabel(cell.c).label;
          if (cell.s === 1) desc += ' row rocket';
          else if (cell.s === 2) desc += ' column rocket';
          else if (cell.s === 3) desc += ' bomb';
          else {
            var size = Rules.groupAt(st, r, c).length;
            desc += ', group of ' + size;
          }
          b.textContent = colorLabel(cell.c).icon;
          b.setAttribute('aria-label', 'Row ' + (r + 1) + ' column ' + (c + 1) + ': ' + desc);
          b.dataset.r = r; b.dataset.c = c;
          (function (rr, cc) {
            b.onclick = function () { tryPop(rr, cc); };
            b.onfocus = function () { setFocus(rr, cc); };
          })(r, c);
        } else {
          b.textContent = '·';
          b.setAttribute('aria-label', 'Row ' + (r + 1) + ' column ' + (c + 1) + ': empty');
          b.disabled = true;
        }
        td.appendChild(b);
        tr.appendChild(td);
      }
      table.appendChild(tr);
    }
  }

  function setFocus(r, c) {
    app.focus = { r: r, c: c };
    if (app.renderer) {
      app.renderer.setFocusCell(r, c);
      previewAt(r, c);
    }
  }

  function previewAt(r, c) {
    var st = app.session && app.session.state;
    if (!st || !app.renderer) return;
    var cell = st.grid[r] && st.grid[r][c];
    if (!cell) { app.renderer.setHoverGroup([]); return; }
    if (cell.s !== 0) {
      app.renderer.setHoverGroup(Rules.blastCells(st, r, c, cell.s), false);
      return;
    }
    var grp = Rules.groupAt(st, r, c);
    var legal = grp.length >= (st.cfg.minGroup || 2);
    app.renderer.setHoverGroup(grp, !legal);
  }

  // ------------------------------------------------------------- rounds
  function ensureRenderer() {
    if (app.renderer || app.webglFailed) return;
    try {
      app.renderer = app.createRenderer($('gl-container'), {
        onPick: function (cell) { tryPop(cell.r, cell.c); },
        onHover: function (cell) {
          if (!app.session || app.state !== 'active' || !app.renderer) return;
          if (cell) previewAt(cell.r, cell.c);
          else app.renderer.setHoverGroup([]);
        },
        onSettled: function () { /* animations landed */ },
        onContextLost: function () {
          announceAlert('Graphics context lost — switching to grid mode. Your round is safe.');
          app.webglFailed = true;
          $('board-mirror-wrap').classList.remove('sr-only');
        }
      });
      app.renderer.setReducedMotion(!!app.settings.reducedMotion);
      app.renderer.setQuality(resolveTier(app.settings.quality));
    } catch (e) {
      app.webglFailed = true;
      $('webgl-fail').hidden = false;
    }
  }

  function startRound(cfg, opts) {
    opts = opts || {};
    setState('preparing', 'start-round');
    Audio.unlock();
    showScreen('game');
    app.session = new Sess.Session(cfg, opts);
    app.cmdSeq = 0;
    app.timeWarned = false;
    app.inputLocked = true;

    ensureRenderer();
    if (app.renderer) {
      var themeId = cfg.theme || app.settings.theme;
      app.renderer.setTheme(themeById(themeUnlocked(themeById(themeId)) ? themeId : app.settings.theme).palette,
        Content.COLORS, !!app.settings.highContrast);
      app.renderer.syncToState(app.session.state);
      app.renderer.setFocusCell(0, 0);
      app.renderer.setHintCell(null);
    }
    $('board-mirror-wrap').classList.toggle('sr-only', !app.webglFailed);

    // lesson box
    var lb = $('lesson-box');
    if (opts.lesson) {
      lb.hidden = false;
      $('lesson-title').textContent = opts.lesson.title;
      $('lesson-text').textContent = opts.lesson.text;
    } else lb.hidden = true;

    updateHUD();
    updateClock();
    var themeIdx = Content.THEMES.indexOf(themeById(cfg.theme || app.settings.theme));
    Audio.startAmbience();
    Audio.startMusic(Math.max(0, themeIdx));
    runCountdown(function () {
      app.session.startPerf = performance.now();
      setState('active', 'countdown-done');
      app.inputLocked = false;
      announce(cfg.name + '. ' + (opts.lesson ? opts.lesson.text :
        'Fill the goals to win. ' + legalSummary()));
      setFocus(0, 0);
      var first = document.querySelector('#board-mirror button');
      if (first && !app.webglFailed) { /* keep focus in menus */ }
    });
    clearInterval(app.clockTimer);
    app.clockTimer = setInterval(updateClock, 250);
  }

  // Number of colour quotas already met (used for the goal-fill cue).
  function goalsFilled(st) {
    var n = 0;
    Object.keys(st.cfg.goals).forEach(function (g) { if ((st.goals[g] || 0) >= st.cfg.goals[g]) n++; });
    return n;
  }

  function legalSummary() {
    var acts = Rules.legalActions(app.session.state);
    var groups = acts.filter(function (a) { return a.kind === 'pop'; });
    return groups.length ? groups.length + ' cubes in poppable groups.' : 'Fire a special to continue.';
  }

  function runCountdown(done) {
    var ov = $('overlay-countdown'), num = $('countdown-num');
    if (app.settings.reducedMotion) { done(); return; }
    setState('countdown', 'preparing');
    ov.hidden = false;
    var seq = ['3', '2', '1', 'Pop!'];
    var i = 0;
    (function step() {
      if (i < seq.length) {
        num.textContent = seq[i];
        announce(seq[i]);
        if (i === seq.length - 1) Audio.countdownGo(); else Audio.countdownTick();
        i++;
        setTimeout(step, i === seq.length ? 400 : 550);
      } else {
        ov.hidden = true;
        done();
      }
    })();
  }

  function tryPop(r, c) {
    if (!app.session || app.inputLocked || app.state !== 'active') return;
    if (app.session.state.terminal) return;
    Audio.unlock();
    var id = 'c' + (++app.cmdSeq) + '-' + Date.now().toString(36);
    var goalsBefore = goalsFilled(app.session.state);
    var res = app.session.pop(r, c, id);
    if (!res.ok) {
      if (res.duplicate) return;
      Audio.invalid();
      var why = {
        'group-too-small': 'That cube is not in a group of ' + (app.session.state.cfg.minGroup || 2) + ' or more.',
        'empty-cell': 'That cell is empty.',
        'bad-location': 'That cell is outside the wall.',
        'game-ended': 'The round is over.'
      }[res.reason] || 'That move is not allowed.';
      announceAlert(why);
      toast(why);
      if (app.renderer) app.renderer.setHoverGroup([], true);
      return;
    }
    setState('resolving', 'pop');
    app.inputLocked = true;
    if (!res.state.terminal && goalsFilled(res.state) > goalsBefore) Audio.goalFill();
    if (app.renderer) app.renderer.setHintCell(null);
    var round = app.session;
    handleEvents(res.events, round.state, function finishPop() {
      // The player may have paused and restarted/left while the animation
      // played out; never apply a stale round's completion to the new one.
      if (app.session !== round) return;
      if (app.state === 'paused') { app.pendingResolution = finishPop; return; }
      updateHUD();
      if (app.session.state.terminal) { endRound(res.events); return; }
      if (app.session.lesson && app.session.lessonGoalMet()) { lessonComplete(); return; }
      setState('active', 'resolved');
      app.inputLocked = false;
      var popEv = res.events.filter(function (e) { return e.type === 'pop'; })[0];
      if (popEv) announce('Popped ' + popEv.size + ' ' + colorLabel(popEv.color).label + ' cubes. Score ' +
        Rules.currentScore(app.session.state) + '.');
      setFocus(app.focus.r, app.focus.c);
    });
  }

  function handleEvents(events, newState, done) {
    var sawRocket = false, sawBomb = false;
    events.forEach(function (e) {
      switch (e.type) {
        case 'pop': Audio.pop(e.size); break;
        case 'special-create':
          if (e.special === 3) { Audio.bombCreate(); sawBomb = true; } else { Audio.rocketCreate(); sawRocket = true; }
          break;
        case 'fire': (e.special === 3) ? Audio.bombFire() : Audio.rocketFire(); break;
        case 'chain': Audio.chain(e.count); break;
        case 'shuffle': Audio.shuffle(); announce('No moves left — the wall reshuffled.'); break;
        case 'wave': Audio.wave(e.wave); announce('Wave ' + e.wave + ' complete. New goals, +' + e.moveBank + ' moves in the bank.'); break;
      }
    });
    // achievements that fire mid-round
    if (sawRocket) award('first-rocket');
    if (sawBomb) award('first-bomb');
    var chainEv = events.filter(function (e) { return e.type === 'chain'; })[0];
    if (chainEv && chainEv.count >= 3) award('chain-3');
    if (events.some(function (e) { return e.type === 'pop'; })) award('first-pop');
    if (app.session.state.score.bestGroup >= 12) award('big-group');

    if (app.renderer) {
      var dur = app.renderer.playEvents(events, newState);
      setTimeout(done, dur);
    } else done();
  }

  function endRound(events) {
    setState('results', 'terminal');
    app.inputLocked = true;
    clearInterval(app.clockTimer);
    var st = app.session.state;
    var won = st.terminal.won;
    if (won) Audio.win(); else Audio.lose();
    app.session.clearSnapshot();

    // achievements / progress
    var unlocked = [];
    if (won) {
      award('first-win');
      if (app.session.kind === 'journey') {
        app.progress.completed[st.cfg.id] = true;
        var stars = app.session.stars();
        app.progress.stars[st.cfg.id] = Math.max(app.progress.stars[st.cfg.id] || 0, stars);
        var doneCount = Content.JOURNEY.filter(function (l) { return app.progress.completed[l.id]; }).length;
        if (doneCount >= 20) award('journey-half');
        if (doneCount >= Content.JOURNEY.length) award('journey-done');
      }
      if (app.session.kind === 'challenge') {
        app.progress.stars[st.cfg.id] = Math.max(app.progress.stars[st.cfg.id] || 0, app.session.stars());
      }
      if (app.session.kind === 'daily') {
        app.progress.dailiesDone[st.cfg.date] = true;
        var n = Object.keys(app.progress.dailiesDone).length;
        if (n >= 7) award('daily-7');
      }
    }
    app.progress.totalCubes += st.score.cubes;
    if (app.progress.totalCubes >= 1000) award('cubes-1000');
    if (st.score.total >= 3000) award('score-3000');
    Sess.saveProgress(app.progress);

    if (app.session.kind === 'score') {
      var best = Sess.readLS('cubepop:score-best:v1', []);
      best.push({ score: st.score.total, waves: st.score.waves, at: Date.now() });
      best.sort(function (a, b) { return b.score - a.score; });
      Sess.writeLS('cubepop:score-best:v1', best.slice(0, 10));
    }
    if (app.session.kind === 'daily' && st.cfg.date) {
      var db = Sess.readLS(Sess.LS.dailyBest, {});
      db[st.cfg.date] = Math.max(db[st.cfg.date] || 0, st.score.total);
      Sess.writeLS(Sess.LS.dailyBest, db);
    }
    showResults(won, unlocked);
  }

  function award(key) {
    if (Sess.unlockAchievement(key)) {
      var def = Content.ACHIEVEMENTS.filter(function (a) { return a.key === key; })[0];
      Audio.achievement();
      toast('Achievement: ' + (def ? def.name : key));
      announce('Achievement unlocked: ' + (def ? def.name : key));
      return true;
    }
    return false;
  }

  function showResults(won) {
    var st = app.session.state;
    var ov = $('overlay-results');
    app.lastFocusEl = document.activeElement;
    ov.hidden = false;
    var reasonText = {
      'goals-complete': 'All goals complete!',
      'move-limit': 'Out of moves',
      'time-up': 'Time is up',
      'resigned': 'Round resigned'
    }[st.terminal.reason] || 'Round over';
    $('results-headline').textContent = (won ? 'You win — ' : '') + reasonText;
    var banner = $('results-banner');
    banner.hidden = !won || banner.dataset.failed === '1';
    announce('Round over. ' + reasonText + ' Score ' + st.score.total + '.');

    var tb = $('results-breakdown').querySelector('tbody');
    tb.innerHTML = '';
    var sc = st.score;
    var rows = [
      ['Cubes cleared (' + sc.cubes + ')', sc.popPoints],
      ['Group size bonus', sc.groupBonus],
      ['Specials forged (' + sc.specialsMade + ')', sc.specialBonus],
      ['Chain bonus (best ×' + sc.chainsBest + ')', sc.chainBonus],
      ['Unused moves', sc.moveBonus],
      ['Time under par', sc.timeBonus],
      ['Wave bonus (' + sc.waves + ')', sc.waveBonus]
    ];
    rows.forEach(function (r) {
      if (!r[1]) return;
      var tr = document.createElement('tr');
      tr.appendChild(el('td', '', r[0]));
      tr.appendChild(el('td', '', String(r[1])));
      tb.appendChild(tr);
    });
    var tr = document.createElement('tr');
    tr.className = 'total';
    tr.appendChild(el('td', '', 'Total'));
    tr.appendChild(el('td', '', String(sc.total)));
    tb.appendChild(tr);

    var stars = app.session.stars();
    $('results-stars').textContent = won && stars ? '★'.repeat(stars) + '☆'.repeat(3 - stars) : '';
    $('results-ach').textContent = '';

    // daily submission
    var dailyBox = $('results-daily');
    if (app.session.kind === 'daily' && st.cfg.date) {
      dailyBox.hidden = false;
      $('daily-submit-status').textContent = '';
      $('daily-name').value = Sess.readLS('cubepop:name', '');
      $('btn-daily-submit').onclick = submitDailyScore;
    } else dailyBox.hidden = true;

    $('replay-json').textContent = JSON.stringify(app.session.envelope());
    $('btn-results-next').hidden = !(app.currentList === 'journey' && app.currentIdx < Content.JOURNEY.length - 1);
    $('btn-results-retry').focus();
  }

  function submitDailyScore() {
    var name = $('daily-name').value.trim() || 'Guest';
    Sess.writeLS('cubepop:name', name);
    var st = app.session.state;
    $('daily-submit-status').textContent = 'Validating with server…';
    $('btn-daily-submit').disabled = true;
    Sess.submitDaily(name, st.cfg.date, app.session.envelope())
      .then(function (body) {
        $('daily-submit-status').textContent = 'Accepted — rank #' + body.rank + ' (' + body.score + ' pts, server-validated).';
        refreshDailyBoard(st.cfg.date);
      })
      .catch(function (e) {
        $('daily-submit-status').textContent = 'Could not submit (' + e.message + '). Score saved locally only.';
      })
      .finally(function () { $('btn-daily-submit').disabled = false; });
  }

  function lessonComplete() {
    setState('results', 'lesson-goal');
    app.inputLocked = true;
    clearInterval(app.clockTimer);
    var lesson = app.session.lesson;
    app.progress.completed[lesson.id] = true;
    Sess.saveProgress(app.progress);
    Audio.win();
    app.session.clearSnapshot();
    var ov = $('overlay-results');
    ov.hidden = false;
    $('results-headline').textContent = 'Lesson complete: ' + lesson.title;
    $('results-banner').hidden = $('results-banner').dataset.failed === '1';
    announce('Lesson complete: ' + lesson.title);
    $('results-breakdown').querySelector('tbody').innerHTML = '';
    $('results-stars').textContent = '';
    $('results-ach').textContent = '';
    $('results-daily').hidden = true;
    $('replay-json').textContent = JSON.stringify(app.session.envelope());
    var lessons = Content.tutorialLessons();
    $('btn-results-next').hidden = app.currentIdx >= lessons.length - 1;
    $('btn-results-retry').focus();
  }

  // ------------------------------------------------------------- pause
  function pauseRound() {
    if (app.state !== 'active' && app.state !== 'resolving') return;
    setState('paused', 'user');
    app.pausedAt = performance.now();
    app.lastFocusEl = document.activeElement;
    $('overlay-pause').hidden = false;
    $('btn-resume-round').focus();
    // Tutorial lessons are short and restartable; leaving them never saves a
    // snapshot (see leaveRound), so pausing shouldn't either — a resumed
    // session would lack its lesson object and could never complete.
    if (app.session.kind !== 'tutorial') {
      app.session.saveSnapshot();
      announce('Paused. Round saved locally.');
    } else {
      announce('Paused.');
    }
    Audio.suspendAll();
  }

  function resumeRound() {
    if (app.state !== 'paused') return;
    $('overlay-pause').hidden = true;
    if (app.pausedAt && app.session.startPerf) app.session.startPerf += performance.now() - app.pausedAt;
    app.pausedAt = 0;
    setState('active', 'resume');
    Audio.resumeAll();
    if (app.pendingResolution) { var finish = app.pendingResolution; app.pendingResolution = null; finish(); }
    if (app.lastFocusEl && app.lastFocusEl.focus) app.lastFocusEl.focus();
    announce('Resumed.');
  }

  function leaveRound() {
    $('overlay-pause').hidden = true;
    $('overlay-results').hidden = true;
    clearInterval(app.clockTimer);
    if (app.session && !app.session.state.terminal && app.session.kind !== 'tutorial') {
      app.session.saveSnapshot();
    } else if (app.session) {
      app.session.clearSnapshot();
    }
    app.session = null;
    Audio.stopMusic();
    Audio.stopAmbience();
    goHome();
  }

  function goHome() {
    refreshTitle();
    showScreen('title');
  }

  function refreshTitle() {
    var p = app.progress;
    var journeyDone = Content.JOURNEY.filter(function (l) { return p.completed[l.id]; }).length;
    $('title-progress').textContent =
      'Journey ' + journeyDone + '/' + Content.JOURNEY.length + ' · ' + Sess.totalStars(p) + ' stars · ' +
      Object.keys(Sess.loadAchievements()).length + '/' + Content.ACHIEVEMENTS.length + ' achievements';
    $('btn-resume').hidden = !Sess.Session.loadSnapshot();
    // Play = next uncompleted journey stage (two deliberate actions to play)
    var next = Content.JOURNEY.filter(function (l, i) {
      return !p.completed[l.id] && (i === 0 || p.completed[Content.JOURNEY[i - 1].id]);
    })[0];
    $('btn-play').textContent = next ? 'Play: ' + next.name : 'Play: Journey';
  }

  // ------------------------------------------------------------- input
  function bindGameInput() {
    document.addEventListener('keydown', function (ev) {
      if (app.state !== 'active') {
        if (ev.key === 'Escape' && app.state === 'paused') resumeRound();
        return;
      }
      if ($('overlay-pause').hidden === false || $('overlay-results').hidden === false) return;
      var st = app.session && app.session.state;
      if (!st) return;
      var rows = st.grid.length, cols = st.grid[0] ? st.grid[0].length : 0;
      var k = ev.key;
      if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
        ev.preventDefault();
        var dr = k === 'ArrowUp' ? -1 : k === 'ArrowDown' ? 1 : 0;
        var dc = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : 0;
        setFocus(Math.min(rows - 1, Math.max(0, app.focus.r + dr)),
                 Math.min(cols - 1, Math.max(0, app.focus.c + dc)));
        Audio.select();
        var cell = st.grid[app.focus.r][app.focus.c];
        if (cell) announce('Row ' + (app.focus.r + 1) + ' column ' + (app.focus.c + 1) + ', ' + colorLabel(cell.c).label +
          (cell.s ? ' special' : ', group of ' + Rules.groupAt(st, app.focus.r, app.focus.c).length));
      } else if (k === 'Enter' || k === ' ') {
        ev.preventDefault();
        tryPop(app.focus.r, app.focus.c);
      } else if (k === 'h' || k === 'H') {
        ev.preventDefault(); doHint();
      } else if (k === 'u' || k === 'U') {
        ev.preventDefault(); doUndo();
      } else if (k === 'p' || k === 'P' || k === 'Escape') {
        ev.preventDefault(); pauseRound();
      } else if (k === 'c' || k === 'C') {
        if (app.renderer) { app.renderer.resetCamera(); announce('Camera reset.'); }
      }
    });

    // basic gamepad: d-pad/left stick moves focus, A pops, B cancels/pause, Y hint, X undo
    var padPrev = {};
    setInterval(function () {
      if (app.state !== 'active' || !navigator.getGamepads) return;
      var gp = navigator.getGamepads()[0];
      if (!gp) return;
      var st = app.session && app.session.state;
      if (!st) return;
      var rows = st.grid.length, cols = st.grid[0].length;
      function pressed(i) { return gp.buttons[i] && gp.buttons[i].pressed; }
      function edge(name, down, fn) {
        if (down && !padPrev[name]) fn();
        padPrev[name] = down;
      }
      var ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      edge('l', pressed(14) || ax < -0.5, function () { setFocus(app.focus.r, Math.max(0, app.focus.c - 1)); });
      edge('r', pressed(15) || ax > 0.5, function () { setFocus(app.focus.r, Math.min(cols - 1, app.focus.c + 1)); });
      edge('u', pressed(12) || ay < -0.5, function () { setFocus(Math.max(0, app.focus.r - 1), app.focus.c); });
      edge('d', pressed(13) || ay > 0.5, function () { setFocus(Math.min(rows - 1, app.focus.r + 1), app.focus.c); });
      edge('a', pressed(0), function () { tryPop(app.focus.r, app.focus.c); });
      edge('b', pressed(1), function () { pauseRound(); });
      edge('x', pressed(2), function () { doUndo(); });
      edge('y', pressed(3), function () { doHint(); });
      edge('start', pressed(9), function () { pauseRound(); });
    }, 120);

    $('btn-hint').onclick = doHint;
    $('btn-undo').onclick = doUndo;
    $('btn-pause').onclick = pauseRound;
    $('btn-camera').onclick = function () { if (app.renderer) app.renderer.resetCamera(); };
    $('btn-resume-round').onclick = resumeRound;
    $('btn-restart-round').onclick = function () {
      $('overlay-pause').hidden = true;
      var cfg = app.session.cfg, lesson = app.session.lesson;
      startRound(cfg, lesson ? { lesson: lesson, forcedGrid: lesson.force.grid, forcedSpecials: lesson.force.specials } : {});
    };
    $('btn-leave-round').onclick = leaveRound;
    $('btn-pause-settings').onclick = function () {
      $('overlay-pause').hidden = true;
      bindSettings();
      showScreen('settings');
      // return path: game state stays paused; Back goes to title, round stays saved
    };
    $('btn-pause-help').onclick = function () {
      $('overlay-pause').hidden = true;
      showHelp();
      showScreen('help');
    };
    $('btn-results-retry').onclick = function () {
      $('overlay-results').hidden = true;
      var cfg = app.session.cfg, lesson = app.session.lesson;
      startRound(cfg, lesson ? { lesson: lesson, forcedGrid: lesson.force.grid, forcedSpecials: lesson.force.specials } : {});
    };
    $('btn-results-next').onclick = function () {
      $('overlay-results').hidden = true;
      if (app.currentList === 'journey') {
        app.currentIdx++;
        startRound(Content.JOURNEY[app.currentIdx]);
      } else if (app.currentList === 'learn') {
        app.currentIdx++;
        var lesson = Content.tutorialLessons()[app.currentIdx];
        startRound(lesson.cfg, { lesson: lesson, forcedGrid: lesson.force.grid, forcedSpecials: lesson.force.specials });
      }
    };
    $('btn-results-menu').onclick = function () {
      $('overlay-results').hidden = true;
      app.session = null;
      Audio.stopMusic();
      Audio.stopAmbience();
      goHome();
    };
    $('btn-copy-replay').onclick = function () {
      var txt = $('replay-json').textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(function () { toast('Replay copied.'); });
      else toast('Select the replay text to copy.');
    };
    $('btn-webgl-continue').onclick = function () {
      $('webgl-fail').hidden = true;
      $('board-mirror-wrap').classList.remove('sr-only');
      announce('Grid mode active. Use the grid buttons to play.');
    };

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && app.state === 'active') pauseRound();
    });
  }

  function doHint() {
    if (!app.session || app.state !== 'active') return;
    var st = app.session.state;
    if (!(st.cfg.mechanics && st.cfg.mechanics.hint)) { toast('Hints are disabled in this mode.'); return; }
    var h = app.session.hint();
    if (!h) return;
    Audio.hint();
    setFocus(h.r, h.c);
    if (app.renderer) app.renderer.setHintCell(h.r, h.c);
    var why = {
      'make-bomb': 'This group forges a bomb.', 'make-rocket': 'This group forges a rocket.',
      chain: 'Firing this special starts a chain.', goal: 'This group fills a goal color.',
      biggest: 'This is the biggest group.', fire: 'Fire this special.'
    }[h.why] || 'Try here.';
    announce('Hint: row ' + (h.r + 1) + ' column ' + (h.c + 1) + '. ' + why);
    toast('Hint: ' + why);
  }

  function doUndo() {
    if (!app.session || app.state !== 'active') return;
    if (!app.session.canUndo()) { toast('Nothing to undo.'); return; }
    app.session.undo();
    Audio.undo();
    if (app.renderer) { app.renderer.syncToState(app.session.state); app.renderer.setHintCell(null); }
    updateHUD();
    announce('Move undone. Score ' + Rules.currentScore(app.session.state) + '.');
    // Lesson goals can be met by undoing (e.g. the "Second chances" lesson).
    if (app.session.lesson && app.session.lessonGoalMet()) lessonComplete();
  }

  // ------------------------------------------------------------- title nav
  // The hero canvas is decorative (aria-hidden): a soft cube mosaic in the
  // game's own palette, drawn once in 2D so the title screen never shows a
  // blank frame even before (or without) the WebGL studio.
  function drawTitleHero() {
    var cv = $('title-canvas');
    if (!cv || !cv.getContext) return;
    var g = cv.getContext('2d');
    if (!g) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = cv.clientWidth || 600, h = cv.clientHeight || 260;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    g.scale(dpr, dpr);
    var theme = themeById(app.settings.theme);
    var hex = function (n) { return '#' + n.toString(16).padStart(6, '0'); };
    g.fillStyle = hex(theme.palette.wall);
    g.fillRect(0, 0, w, h);
    var rng = root.CPRNG.derive(0xcbf29ce4, root.CPRNG.STREAM_DECOR);
    var size = 44, gap = 12, step = size + gap;
    var cols = Math.ceil(w / step) + 1, rows = Math.ceil(h / step) + 1;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var def = Content.COLORS[rng.int(Content.COLORS.length)];
        var x = c * step + (r % 2 ? step / 2 : 0) - step / 2;
        var y = r * step - step / 2;
        var rad = size * 0.22, rr = size / 2;
        g.save();
        g.translate(x + rr, y + rr);
        g.globalAlpha = 0.85;
        g.fillStyle = hex(def.color);
        g.beginPath();
        if (g.roundRect) g.roundRect(-rr, -rr, size, size, rad);
        else g.rect(-rr, -rr, size, size);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = 'rgba(255,246,232,0.9)';
        g.font = 'bold ' + Math.round(size * 0.42) + 'px sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(def.icon, 0, 1);
        g.restore();
      }
    }
  }

  function bindNav() {
    document.querySelectorAll('[data-goto]').forEach(function (b) {
      b.addEventListener('click', function () {
        Audio.unlock(); Audio.click();
        var to = b.dataset.goto;
        if (to === 'journey') showJourney();
        else if (to === 'daily') showDaily();
        else if (to === 'practice') showPractice();
        else if (to === 'challenge') showChallenge();
        else if (to === 'score') showScore();
        else if (to === 'learn') showLearn();
        else if (to === 'achievements') showAchievements();
        else if (to === 'settings') bindSettings();
        else if (to === 'help') showHelp();
        showScreen(to);
      });
    });
    $('btn-play').onclick = function () {
      Audio.unlock(); Audio.click();
      var p = app.progress;
      var idx = Content.JOURNEY.findIndex(function (l, i) {
        return !p.completed[l.id] && (i === 0 || p.completed[Content.JOURNEY[i - 1].id]);
      });
      if (idx < 0) idx = 0;
      app.currentList = 'journey'; app.currentIdx = idx;
      startRound(Content.JOURNEY[idx]);
    };
    $('btn-resume').onclick = function () {
      Audio.unlock(); Audio.click();
      var s = Sess.Session.loadSnapshot();
      if (!s) { toast('No saved round.'); return; }
      app.session = s;
      setState('preparing', 'resume-snapshot');
      showScreen('game');
      ensureRenderer();
      if (app.renderer) {
        var themeId = s.cfg.theme || app.settings.theme;
        app.renderer.setTheme(themeById(themeId).palette, Content.COLORS, !!app.settings.highContrast);
        app.renderer.syncToState(s.state);
      }
      $('lesson-box').hidden = true;
      updateHUD();
      app.timeWarned = false;
      Audio.startAmbience();
      Audio.startMusic(0);
      runCountdown(function () {
        s.startPerf = performance.now() - s.state.elapsedMs;
        setState('active', 'resumed');
        app.inputLocked = false;
        announce('Round resumed. ' + legalSummary());
      });
      clearInterval(app.clockTimer);
      app.clockTimer = setInterval(updateClock, 250);
    };
  }

  // ------------------------------------------------------------- init
  function init(deps) {
    Rules = root.CPRules; Content = root.CPContent; Sess = root.CPSession; Audio = root.CPAudio;
    app.createRenderer = deps.createRenderer;
    app.settings = Sess.loadSettings();
    app.progress = Sess.loadProgress();
    Audio.setCaptionCallback(function (text) {
      if (!app.settings.captions) return;
      var c = $('captions');
      c.textContent = text;
      clearTimeout(c._t);
      c._t = setTimeout(function () { c.textContent = ''; }, 1800);
    });
    applySettings();
    drawTitleHero();
    window.addEventListener('resize', drawTitleHero);
    bindNav();
    bindGameInput();
    bindSettings();
    refreshTitle();
    Sess.syncTime().then(function () {
      var d = new Date(Sess.now());
      $('status-clock').textContent = 'UTC ' + d.toISOString().slice(0, 16).replace('T', ' ');
    });
    setInterval(function () {
      var d = new Date(Sess.now());
      $('status-clock').textContent = 'UTC ' + d.toISOString().slice(0, 16).replace('T', ' ');
    }, 30000);
    showScreen('title');
    setState('title', 'boot-done');
  }

  root.CPUI = { init: init };
})(typeof self !== 'undefined' ? self : this);
