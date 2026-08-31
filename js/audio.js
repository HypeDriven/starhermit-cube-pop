/* Cube Pop — WebAudio: buses, event-mapped one-shots, ambience, and adaptive
 * music. Authored samples (sfx/<name>.opus, see sfx/manifest.json) are
 * lazy-fetched/decoded after the user-gesture unlock; until a sample is
 * cached — or if it fails to load — the procedural synthesis runs as fallback.
 * Exposes window.CPAudio. All event sounds also emit caption cues.
 */
(function (root) {
  'use strict';

  var ctx = null;
  var buses = {};          // name -> GainNode
  var volumes = { music: 0.5, effects: 0.8, ambience: 0.4 };
  var muted = false;
  var captionCb = null;
  var musicTimer = null, ambienceNodes = [];
  var musicStep = 0, musicTheme = 0;
  var avRng = null;        // seeded AV stream for replay-consistent variants

  // Authored one-shot samples: event name -> clip basename (sfx/manifest.json).
  var EVENT_SAMPLES = {
    click: 'ui-click', invalid: 'invalid-buzz', select: 'cube-select',
    pop: 'cube-pop', rocketCreate: 'rocket-forge', rocketFire: 'rocket-launch',
    bombCreate: 'bomb-forge', bombFire: 'bomb-blast', chain: 'chain-surge',
    shuffle: 'board-shuffle', undo: 'move-undo', hint: 'hint-chime',
    win: 'stage-win', lose: 'round-lose', wave: 'wave-clear',
    achievement: 'achievement-unlock'
  };
  var sampleCache = {};    // basename -> { buffer, loading, failed }

  // Lazy-fetch/decode/cache a clip. Only runs once a context exists (post
  // user-gesture unlock); failures are cached so synthesis stays the fallback.
  function loadSample(name) {
    if (!ctx || typeof root.fetch !== 'function') return;
    var entry = sampleCache[name];
    if (entry && (entry.buffer || entry.loading || entry.failed)) return;
    entry = sampleCache[name] = { buffer: null, loading: true, failed: false };
    root.fetch('sfx/' + name + '.opus')
      .then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.arrayBuffer();
      })
      .then(function (ab) { return ctx.decodeAudioData(ab); })
      .then(function (buf) { entry.buffer = buf; entry.loading = false; })
      .catch(function () { entry.loading = false; entry.failed = true; });
  }

  // Play the cached clip through the effects bus; returns false (after
  // kicking off a lazy load) when no decoded buffer is available yet.
  function playSample(name) {
    if (!ctx) return false;
    var entry = sampleCache[name];
    if (!entry || !entry.buffer) { loadSample(name); return false; }
    var src = ctx.createBufferSource();
    src.buffer = entry.buffer;
    src.connect(buses.effects);
    src.start();
    return true;
  }

  function ensureCtx() {
    if (ctx) return true;
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    buses._master = master;
    ['music', 'effects', 'ambience'].forEach(function (b) {
      var g = ctx.createGain();
      g.gain.value = muted ? 0 : volumes[b];
      g.connect(master);
      buses[b] = g;
    });
    return true;
  }

  function resume() { if (ensureCtx() && ctx.state === 'suspended') ctx.resume(); }

  function caption(text) { if (captionCb) captionCb(text); }

  function setAvStream(rng) { avRng = rng; }
  function variant(base, spread) {
    var r = avRng ? avRng.next() : Math.random();
    return base * (1 - spread + 2 * spread * r);
  }

  // Short synthesized transient.
  function blip(bus, freq, dur, type, gain, slideTo) {
    if (!ensureCtx()) return;
    var t = ctx.currentTime;
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(gain || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(buses[bus]);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function noiseBurst(bus, dur, gain, filterFreq) {
    if (!ensureCtx()) return;
    var t = ctx.currentTime;
    var len = Math.floor(ctx.sampleRate * dur);
    var buf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    var src = ctx.createBufferSource(); src.buffer = buf;
    var f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterFreq || 1200;
    var g = ctx.createGain(); g.gain.value = gain || 0.3;
    src.connect(f); f.connect(g); g.connect(buses[bus]);
    src.start(t);
  }

  var api = {
    unlock: resume,
    setCaptionCallback: function (cb) { captionCb = cb; },
    setAvStream: setAvStream,
    setVolume: function (bus, v) {
      volumes[bus] = v;
      if (buses[bus]) buses[bus].gain.value = muted ? 0 : v;
    },
    getVolume: function (bus) { return volumes[bus]; },
    setMuted: function (m) {
      muted = m;
      Object.keys(volumes).forEach(function (b) {
        if (buses[b]) buses[b].gain.value = m ? 0 : volumes[b];
      });
    },
    isMuted: function () { return muted; },

    // ---- event-mapped sounds (input ack < move < combo/goal < round end) ----
    // Each event prefers its authored sample (EVENT_SAMPLES) and runs the
    // synthesis below only while the clip is loading or failed to load.
    click:   function () {
      if (playSample(EVENT_SAMPLES.click)) return;
      blip('effects', 660, 0.06, 'triangle', 0.12);
    },
    invalid: function () {
      caption('That move is not allowed.');
      if (playSample(EVENT_SAMPLES.invalid)) return;
      blip('effects', 180, 0.15, 'square', 0.12, 120);
    },
    select:  function () {
      if (playSample(EVENT_SAMPLES.select)) return;
      blip('effects', variant(520, 0.05), 0.05, 'sine', 0.08);
    },
    pop: function (size) {
      caption('Popped ' + size + ' cubes.');
      if (playSample(EVENT_SAMPLES.pop)) return;
      var base = 300 + Math.min(size, 12) * 30;
      blip('effects', variant(base, 0.06), 0.12, 'triangle', 0.25, base * 1.8);
      noiseBurst('effects', 0.08, 0.12, 2400);
    },
    rocketCreate: function () {
      caption('Rocket forged.');
      if (playSample(EVENT_SAMPLES.rocketCreate)) return;
      blip('effects', 500, 0.25, 'sawtooth', 0.18, 1000);
    },
    rocketFire: function () {
      caption('Rocket fired.');
      if (playSample(EVENT_SAMPLES.rocketFire)) return;
      noiseBurst('effects', 0.35, 0.3, 3000);
      blip('effects', 800, 0.3, 'sawtooth', 0.15, 200);
    },
    bombCreate: function () {
      caption('Bomb forged.');
      if (playSample(EVENT_SAMPLES.bombCreate)) return;
      blip('effects', 220, 0.35, 'sine', 0.28, 440);
    },
    bombFire: function () {
      caption('Bomb exploded.');
      if (playSample(EVENT_SAMPLES.bombFire)) return;
      noiseBurst('effects', 0.5, 0.45, 900);
      blip('effects', 120, 0.45, 'sine', 0.35, 40);
    },
    chain: function (n) {
      caption('Chain of ' + n + ' specials.');
      if (playSample(EVENT_SAMPLES.chain)) return;
      for (var i = 0; i < Math.min(n, 4); i++)
        (function (k) { setTimeout(function () { blip('effects', 700 + k * 200, 0.1, 'triangle', 0.18); }, k * 70); })(i);
    },
    shuffle: function () {
      caption('Board reshuffled.');
      if (playSample(EVENT_SAMPLES.shuffle)) return;
      noiseBurst('effects', 0.25, 0.2, 1800);
    },
    undo: function () {
      caption('Move undone.');
      if (playSample(EVENT_SAMPLES.undo)) return;
      blip('effects', 400, 0.1, 'sine', 0.15, 300);
    },
    hint: function () {
      caption('Hint shown.');
      if (playSample(EVENT_SAMPLES.hint)) return;
      blip('effects', 880, 0.12, 'sine', 0.14, 990);
    },
    win: function () {
      caption('Stage complete.');
      if (playSample(EVENT_SAMPLES.win)) return;
      [523, 659, 784, 1047].forEach(function (f, i) {
        setTimeout(function () { blip('effects', f, 0.3, 'triangle', 0.22); }, i * 130);
      });
    },
    lose: function () {
      caption('Round over.');
      if (playSample(EVENT_SAMPLES.lose)) return;
      [392, 330, 262].forEach(function (f, i) {
        setTimeout(function () { blip('effects', f, 0.3, 'sine', 0.2); }, i * 160);
      });
    },
    wave: function (n) {
      caption('Wave ' + n + ' complete.');
      if (playSample(EVENT_SAMPLES.wave)) return;
      blip('effects', 600, 0.2, 'triangle', 0.2, 900);
    },
    achievement: function () {
      caption('Achievement unlocked.');
      if (playSample(EVENT_SAMPLES.achievement)) return;
      blip('effects', 990, 0.25, 'sine', 0.2, 1320);
    },

    // ---- ambience: soft filtered hum + slow random ticks ----
    startAmbience: function () {
      if (!ensureCtx() || ambienceNodes.length) return;
      var o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 88;
      var o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 132.5;
      var g = ctx.createGain(); g.gain.value = 0.05;
      o.connect(g); o2.connect(g); g.connect(buses.ambience);
      o.start(); o2.start();
      ambienceNodes = [o, o2, g];
    },
    stopAmbience: function () {
      ambienceNodes.forEach(function (n) { try { if (n.stop) n.stop(); n.disconnect(); } catch (e) {} });
      ambienceNodes = [];
    },

    // ---- adaptive music: gentle seeded pentatonic loop; theme shifts scale ----
    startMusic: function (themeIdx) {
      if (!ensureCtx() || musicTimer) return;
      musicTheme = themeIdx || 0;
      var scales = [
        [262, 294, 330, 392, 440, 523],   // C pentatonic
        [247, 277, 311, 370, 415, 494],   // B
        [233, 262, 294, 349, 392, 466],   // Bb
        [220, 247, 277, 330, 370, 440],   // A
        [196, 220, 247, 294, 330, 392]    // G
      ];
      var scale = scales[musicTheme % scales.length];
      musicTimer = setInterval(function () {
        if (muted || document.hidden) return;
        var f = scale[(musicStep * 3 + ((musicStep / 4) | 0)) % scale.length];
        blip('music', f, 0.5, 'sine', 0.07);
        if (musicStep % 4 === 0) blip('music', f / 2, 0.9, 'sine', 0.05);
        musicStep++;
      }, 420);
    },
    stopMusic: function () { if (musicTimer) { clearInterval(musicTimer); musicTimer = null; } },

    suspendAll: function () { if (ctx && ctx.state === 'running') ctx.suspend(); },
    resumeAll: function () { if (ctx && ctx.state === 'suspended' && !muted) ctx.resume(); }
  };

  root.CPAudio = api;
})(typeof self !== 'undefined' ? self : this);
