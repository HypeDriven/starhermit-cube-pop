// The look per graphics level: the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS, each tuned to hold 60 FPS on the weakest GPU
// its Auto gave it) keyed by the runtime's quality tier (frame().quality),
// with the dust motes and the burst cap scaled within the tier by the level
// (frame().levelIndex), as the browser build scaled them by its hardware
// level (at most 4×, never below the tier's floor). The runtime owns the rest
// of what the old Graphics panel did: Auto and the level choice, render scale
// and the pixel-ratio cap, adaptive resolution, the frame-rate limit and
// readout, and the shadow-map size and MSAA samples it holds to the level.
// The per-category overrides of the old panel are not offered (the runtime's
// Options choose a level).
import type { QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit materials: Lambert, standard PBR, or clear-coated physical toys. */
  material: "lambert" | "standard" | "physical";
  /** Rounded-corner curve and bevel segments of every cube. */
  cubeCurve: number;
  cubeBevel: number;
  /** Procedural floor / wallpaper canvas size in px. */
  texture: number;
  /** Ambient dust motes; particles per pop burst (cap). */
  motes: number;
  burst: number;
  bloomRes: number;
  aoRes: number;
}
export interface Look {
  preset: Preset;
  /** Key-light shadow map (0 = off). */
  shadows: 0 | 1024 | 2048 | 4096;
  ao: "off" | "on" | "high";
  bloom: boolean;
  grade: boolean;
  antialias: AntialiasMode;
  /** Image-based lighting from the studio room. */
  reflections: boolean;
  /** Soft round confetti (and sparkles) instead of small squares. */
  particlesHigh: boolean;
  /** Drifting dust motes, the bobbing specials and the breathing key light. */
  animated: boolean;
  /** Wallpaper, floorboards, skirting, the shelf of toys, clear-coat cubes, the rim light. */
  detailed: boolean;
  budget: Budget;
}

const TABLE: Record<Preset, Omit<Look, "preset" | "budget">> = {
  low: { shadows: 0, ao: "off", bloom: false, grade: false, antialias: "msaa", reflections: false, particlesHigh: false, animated: false, detailed: false },
  balanced: { shadows: 1024, ao: "off", bloom: true, grade: true, antialias: "fxaa", reflections: true, particlesHigh: true, animated: true, detailed: true },
  high: { shadows: 2048, ao: "on", bloom: true, grade: true, antialias: "smaa", reflections: true, particlesHigh: true, animated: true, detailed: true },
  ultra: { shadows: 4096, ao: "high", bloom: true, grade: true, antialias: "msaa", reflections: true, particlesHigh: true, animated: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", cubeCurve: 3, cubeBevel: 1, texture: 128, motes: 24, burst: 30, bloomRes: 0.5, aoRes: 0.5 },
  balanced: { material: "standard", cubeCurve: 5, cubeBevel: 2, texture: 256, motes: 40, burst: 100, bloomRes: 0.5, aoRes: 0.5 },
  high: { material: "physical", cubeCurve: 8, cubeBevel: 4, texture: 256, motes: 70, burst: 160, bloomRes: 0.5, aoRes: 0.5 },
  ultra: { material: "physical", cubeCurve: 12, cubeBevel: 5, texture: 512, motes: 120, burst: 240, bloomRes: 1, aoRes: 1 },
};
export const MOTE_MAX = 480;
/** Low's burst size (js/gfx.js PARTICLES.low). */
export const LOW_BURST = 30;
/** The first level index of each tier (quantum, molecular, terrestrial, galactic). */
const TIER_FLOOR: Record<Preset, number> = { low: 0, balanced: 2, high: 4, ultra: 7 };

/** The look for a quality tier at a level index (0 quantum … 9 infinite). */
export function lookFor(preset: Preset, levelIndex: number): Look {
  const b = { ...BUDGETS[preset] };
  // Levels are about 1.64× apart in GPU throughput: motes and bursts grow
  // with the level above the tier's first, at most 4× the tier's budget.
  const k = Math.min(4, Math.pow(1.64, Math.max(0, levelIndex - TIER_FLOOR[preset])));
  b.motes = Math.min(MOTE_MAX, Math.round(b.motes * k));
  b.burst = Math.round(b.burst * k);
  return { preset, ...TABLE[preset], budget: b };
}
