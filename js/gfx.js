/* Cube Pop — graphics quality model: presets, per-category overrides, GPU
 * detection and a cost summary. Pure (no DOM, no three.js), so the settings
 * panel and the renderer agree on what a setting means. Usable from the
 * browser (window.CPGfx) and Node (require).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CPGfx = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRESETS = ['low', 'balanced', 'high', 'ultra'];

  // Category → allowed tiers, cheapest first.
  var CATEGORIES = {
    shadows: ['off', 'low', 'medium', 'high'],
    ao: ['off', 'on', 'high'],
    bloom: ['off', 'on'],
    grade: ['off', 'on'],
    antialias: ['off', 'fxaa', 'smaa', 'msaa'],
    reflections: ['off', 'on'],
    particles: ['low', 'high'],
    background: ['static', 'animated'],
    detail: ['plain', 'detailed']
  };

  // Each preset is a row of tiers, a render scale and a device-pixel-ratio cap.
  var TABLE = {
    low:      { scale: 1,    dprCap: 1,   shadows: 'off',    ao: 'off',  bloom: 'off', grade: 'off', antialias: 'msaa', reflections: 'off', particles: 'low',  background: 'static',   detail: 'plain' },
    balanced: { scale: 0.9,  dprCap: 1.5, shadows: 'low',    ao: 'off',  bloom: 'on',  grade: 'on',  antialias: 'fxaa', reflections: 'on',  particles: 'high', background: 'animated', detail: 'detailed' },
    high:     { scale: 1,    dprCap: 2,   shadows: 'medium', ao: 'on',   bloom: 'on',  grade: 'on',  antialias: 'smaa', reflections: 'on',  particles: 'high', background: 'animated', detail: 'detailed' },
    ultra:    { scale: 1.25, dprCap: 2,   shadows: 'high',   ao: 'high', bloom: 'on',  grade: 'on',  antialias: 'msaa', reflections: 'on',  particles: 'high', background: 'animated', detail: 'detailed' }
  };

  var SHADOW_MAP = { off: 0, low: 1024, medium: 2048, high: 4096 };
  var PARTICLES = { low: 30, high: 160 };

  // Auto picks the preset from the StarHermit hardware level (gpu-level.js → StarHermitGpu, loaded first):
  // 0 = Galaxy S20 / Intel UHD or weaker and every software renderer, 20 = RTX 5090, each level ≈ 1.23×.
  // Low from 0, Balanced from 4, High from 10, Ultra from 17; phones, tablets and ≤ 4 GB machines are
  // capped at level 9 (Balanced) by the shared module.
  var PRESET_LEVELS = { low: 0, balanced: 4, high: 10, ultra: 17 };
  function gpuApi() { return (typeof self !== 'undefined' ? self : globalThis).StarHermitGpu || globalThis.StarHermitGpu; }

  /** Hardware level (0–20) for an unmasked renderer string plus StarHermitGpu.detectSystem() facts. */
  function detectLevel(gpu, system) {
    var G = gpuApi();
    if (!G) return PRESET_LEVELS.balanced;
    return G.detectLevel(Object.assign({ webgl: true, webgl2: true }, system || {}, { gpu: String(gpu || '') }));
  }

  /** The preset Auto starts from for a hardware level. */
  function presetForLevel(level) {
    var G = gpuApi();
    if (G) return G.presetForLevel(level, PRESET_LEVELS);
    return level >= 17 ? 'ultra' : level >= 10 ? 'high' : level >= 4 ? 'balanced' : 'low';
  }

  /** Best preset for this GPU (the level already caps phones and tablets at Balanced). */
  function detectPreset(gpu, system) {
    return presetForLevel(detectLevel(gpu, system));
  }

  /*
   * Per-preset asset and effect budget. Each preset holds 60 FPS on the weakest GPU Auto gives it
   * (Low → level 0, Balanced → 4, High → 10, Ultra → 17; measured with tests/gfx-bench.mjs). Counts are
   * tuned at the floor level and scale up within the preset on faster GPUs (StarHermitGpu.scaleBudget, ≤ 4×).
   *   material   'lambert' | 'standard' | 'physical' (room, table, cubes, charms, toys; clearcoat when detailed);
   *   cubeCurve / cubeBevel  rounded-corner curve and bevel segments of every cube;
   *   texture    procedural floor / wallpaper / wood canvas size in px;
   *   motes      ambient dust motes (Scenery motion); burst  particles per pop burst cap;
   *   bloomRes / aoRes  bloom and GTAO resolution as a fraction of the frame;
   *   roundedView  rounded corners on the 3D view (a mask layer re-composited every frame).
   */
  var BUDGETS = {
    low:      { material: 'lambert',  cubeCurve: 3, cubeBevel: 1, texture: 128, motes: 24,  burst: 30,  bloomRes: 0.5, aoRes: 0.5, roundedView: false },
    balanced: { material: 'standard', cubeCurve: 5, cubeBevel: 2, texture: 256, motes: 40,  burst: 100, bloomRes: 0.5, aoRes: 0.5, roundedView: false },
    high:     { material: 'physical', cubeCurve: 8, cubeBevel: 4, texture: 256, motes: 70,  burst: 160, bloomRes: 0.5, aoRes: 0.5, roundedView: true },
    ultra:    { material: 'physical', cubeCurve: 12, cubeBevel: 5, texture: 512, motes: 120, burst: 240, bloomRes: 1, aoRes: 1, roundedView: true }
  };
  var SCALED = ['motes', 'burst'];

  /** A preset's concrete budget for a hardware level (counts scale up within the preset, never down). */
  function budgetFor(preset, level) {
    var b = Object.assign({}, BUDGETS[preset] || BUDGETS.balanced);
    var floor = PRESET_LEVELS[preset] || 0, G = gpuApi();
    SCALED.forEach(function (k) {
      b[k] = Math.round(G ? G.scaleBudget(b[k], Math.max(Number(level) || 0, floor), floor) : b[k]);
    });
    return b;
  }

  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  /**
   * Resolve saved settings into concrete tiers.
   * saved: { preset: 'auto'|preset, render_scale, adaptive, show_fps, <category>: 'preset'|tier }
   */
  function resolve(saved, detected, level) {
    var s = saved || {};
    var auto = PRESETS.indexOf(s.preset) < 0;
    var preset = auto ? (PRESETS.indexOf(detected) >= 0 ? detected : 'balanced') : s.preset;
    var row = TABLE[preset];
    var out = {
      preset: preset, auto: auto, dprCap: row.dprCap,
      renderScale: clamp(Number(s.render_scale) || 1, 0.5, 2)
    };
    out.scale = row.scale * out.renderScale;
    Object.keys(CATEGORIES).forEach(function (cat) {
      out[cat] = CATEGORIES[cat].indexOf(s[cat]) >= 0 ? s[cat] : row[cat];
    });
    out.budget = budgetFor(preset, level);
    out.adaptive = s.adaptive !== false;
    out.showFps = !!s.show_fps;
    // The composer runs only when an effect needs it; otherwise the canvas renders directly.
    out.post = out.ao !== 'off' || out.bloom === 'on' || out.grade === 'on' ||
      out.antialias === 'fxaa' || out.antialias === 'smaa';
    return out;
  }

  /** The preset's own tier for a category (for "From preset (…)" labels). */
  function presetTier(preset, cat) {
    return TABLE[preset] ? TABLE[preset][cat] : undefined;
  }

  /** Choosing a preset clears every per-category override (keeps scale/adaptive/fps). */
  function choosePreset(saved, preset) {
    var s = saved || {};
    var out = { preset: preset === 'auto' || PRESETS.indexOf(preset) >= 0 ? preset : 'auto' };
    ['render_scale', 'adaptive', 'show_fps'].forEach(function (k) { if (k in s) out[k] = s[k]; });
    return out;
  }

  /** Short cost summary (English tokens; the panel localises the frame around it). */
  function describe(r, pixels) {
    var parts = [
      r.shadows === 'off' ? 'no shadows' : SHADOW_MAP[r.shadows] + '² shadows',
      r.ao === 'off' ? null : (r.ao === 'high' ? 'full AO' : 'AO'),
      r.bloom === 'on' ? 'bloom' : null,
      r.reflections === 'on' ? 'reflections' : null,
      r.antialias === 'off' ? 'no AA' : r.antialias.toUpperCase(),
      pixels ? pixels[0] + '×' + pixels[1] + ' px' : null
    ];
    return parts.filter(Boolean).join(' · ');
  }

  return {
    PRESETS: PRESETS, CATEGORIES: CATEGORIES, SHADOW_MAP: SHADOW_MAP, PARTICLES: PARTICLES,
    PRESET_LEVELS: PRESET_LEVELS, BUDGETS: BUDGETS, detectLevel: detectLevel, presetForLevel: presetForLevel, budgetFor: budgetFor,
    detectPreset: detectPreset, resolve: resolve, presetTier: presetTier,
    choosePreset: choosePreset, describe: describe
  };
});
