/* Cube Pop — graphics quality model tests (node --test tests/gfx.test.js) */
'use strict';
const test = require('node:test');
const assert = require('assert');
const G = require('../js/gfx.js');

test('detectPreset maps GPU strings to tiers', () => {
  assert.strictEqual(G.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)'), 'low');
  assert.strictEqual(G.detectPreset('llvmpipe (LLVM 15.0.7, 256 bits)'), 'low');
  assert.strictEqual(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Direct3D11 vs_5_0 ps_5_0)'), 'high');
  assert.strictEqual(G.detectPreset('Apple M2 Pro'), 'high');
  assert.strictEqual(G.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)'), 'balanced');
  assert.strictEqual(G.detectPreset('Adreno (TM) 640'), 'balanced');
  assert.strictEqual(G.detectPreset(''), 'balanced');
  assert.strictEqual(G.detectPreset('Apple M1', true), 'balanced', 'touch devices cap Auto at balanced');
  assert.strictEqual(G.detectPreset('SwiftShader', true), 'low');
});

test('resolve: auto uses detected preset, explicit preset wins', () => {
  const a = G.resolve({}, 'low');
  assert.strictEqual(a.auto, true);
  assert.strictEqual(a.preset, 'low');
  assert.strictEqual(a.shadows, 'off');
  assert.strictEqual(a.post, false, 'Low renders without the composer');
  const h = G.resolve({ preset: 'high' }, 'low');
  assert.strictEqual(h.auto, false);
  assert.strictEqual(h.shadows, 'medium');
  assert.strictEqual(h.antialias, 'smaa');
  assert.strictEqual(h.post, true);
  assert.strictEqual(G.resolve({ preset: 'bogus' }, 'nope').preset, 'balanced');
});

test('resolve: overrides apply per category, invalid tiers fall back to the preset', () => {
  const r = G.resolve({ preset: 'low', bloom: 'on', shadows: 'preset', particles: 'huge' }, 'high');
  assert.strictEqual(r.bloom, 'on');
  assert.strictEqual(r.shadows, 'off');
  assert.strictEqual(r.particles, 'low');
  assert.strictEqual(r.post, true, 'a bloom override needs the composer');
  assert.strictEqual(G.presetTier('ultra', 'ao'), 'high');
  assert.strictEqual(G.presetTier('nope', 'ao'), undefined);
});

test('resolve: render scale clamps to 50–200% and multiplies the preset scale', () => {
  assert.strictEqual(G.resolve({ preset: 'high', render_scale: 5 }).scale, 2);
  assert.strictEqual(G.resolve({ preset: 'high', render_scale: 0.1 }).scale, 0.5);
  assert.strictEqual(G.resolve({ preset: 'ultra', render_scale: 1 }).scale, 1.25);
  assert.strictEqual(G.resolve({ preset: 'high' }).adaptive, true);
  assert.strictEqual(G.resolve({ preset: 'high', adaptive: false, show_fps: true }).showFps, true);
});

test('choosePreset clears overrides but keeps scale, adaptive and fps', () => {
  const s = G.choosePreset({ preset: 'low', bloom: 'on', ao: 'high', render_scale: 1.5, adaptive: false, show_fps: true }, 'high');
  assert.deepStrictEqual(s, { preset: 'high', render_scale: 1.5, adaptive: false, show_fps: true });
  assert.strictEqual(G.choosePreset({}, 'weird').preset, 'auto');
});

test('describe summarises cost', () => {
  const d = G.describe(G.resolve({ preset: 'high' }), [1280, 800]);
  assert.match(d, /2048² shadows/);
  assert.match(d, /SMAA/);
  assert.match(d, /1280×800 px/);
  assert.match(G.describe(G.resolve({ preset: 'low' })), /no shadows/);
});
