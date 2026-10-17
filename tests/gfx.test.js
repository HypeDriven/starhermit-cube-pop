/* Cube Pop — graphics quality model tests (node --test tests/gfx.test.js) */
'use strict';
const test = require('node:test');
const assert = require('assert');
globalThis.StarHermitGpu = require('../gpu-level.js');
const G = require('../js/gfx.js');

const desk = { webgl: true, webgl2: true, cores: 8, memoryGb: 8 };
const phone = { webgl: true, webgl2: true, mobile: true, cores: 8, memoryGb: 8 };

test('hardware level → preset: Low 0, Balanced 4, High 10, Ultra 17', () => {
  assert.strictEqual(G.detectPreset('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)', desk), 'low');
  assert.strictEqual(G.detectLevel('llvmpipe (LLVM 15.0.7, 256 bits)', desk), 0);
  assert.strictEqual(G.detectPreset('ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0)', desk), 'low');
  assert.strictEqual(G.detectPreset('ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11)', desk), 'low');
  assert.strictEqual(G.detectPreset('ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11)', desk), 'balanced');
  assert.strictEqual(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce GTX 1070 Direct3D11 vs_5_0 ps_5_0)', desk), 'high');
  assert.strictEqual(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 4080 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.strictEqual(G.detectLevel('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 20);
  assert.strictEqual(G.detectPreset('ANGLE (NVIDIA, NVIDIA GeForce RTX 5090 Direct3D11 vs_5_0 ps_5_0)', desk), 'ultra');
  assert.strictEqual(G.detectPreset('', desk), 'balanced');
  assert.strictEqual(G.presetForLevel(3), 'low');
  assert.strictEqual(G.presetForLevel(16), 'high');
});

test('phones and tablets are capped at Balanced; software GPUs stay Low', () => {
  assert.strictEqual(G.detectPreset('Adreno (TM) 740', phone), 'balanced');
  assert.ok(G.detectLevel('Adreno (TM) 740', phone) <= 9);
  assert.strictEqual(G.detectPreset('NVIDIA GeForce RTX 5090', phone), 'balanced');
  assert.strictEqual(G.detectPreset('Mali-G77', phone), 'low');
  assert.strictEqual(G.detectPreset('SwiftShader', phone), 'low');
});

test('every preset has an explicit budget that grows from Low to Ultra and scales with the level', () => {
  const order = ['low', 'balanced', 'high', 'ultra'];
  const keys = ['material', 'cubeCurve', 'cubeBevel', 'texture', 'motes', 'burst', 'bloomRes', 'aoRes'];
  const mats = ['lambert', 'standard', 'physical'];
  order.forEach(p => keys.forEach(k => assert.ok(G.BUDGETS[p][k] != null, p + '.' + k)));
  for (let i = 1; i < order.length; i++) {
    keys.forEach(k => { if (typeof G.BUDGETS.low[k] === 'number') assert.ok(G.BUDGETS[order[i]][k] >= G.BUDGETS[order[i - 1]][k], order[i] + '.' + k); });
    assert.ok(mats.indexOf(G.BUDGETS[order[i]].material) >= mats.indexOf(G.BUDGETS[order[i - 1]].material));
  }
  assert.deepStrictEqual(G.resolve({ preset: 'ultra' }, 'low', 0).budget, G.resolve({ preset: 'ultra' }, 'ultra', 17).budget);
  assert.ok(G.budgetFor('low', 3).motes > G.budgetFor('low', 0).motes, 'counts scale up with the level');
  assert.ok(G.budgetFor('low', 20).motes <= 4 * G.BUDGETS.low.motes, 'never more than 4×');
  assert.strictEqual(G.resolve({ preset: 'balanced' }, 'low').scale, 0.9);
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
