// The look per graphics level. The engine-owned effects (shadows and their
// map size, ambient occlusion, bloom, the grade, anti-aliasing) are the
// level's own (levelSettings(): the same table every StarHermit game reads).
// The game's art (materials, cube segments, textures, reflections, particles,
// motion, the detailed room) is the browser build's four presets and budgets
// (js/gfx.js TABLE / BUDGETS) keyed by the level's quality tier, with the
// dust motes and the burst cap scaled within the tier by the level's particle
// budget against the tier's anchor level (quantum, molecular, terrestrial,
// galactic), at most 4×. The runtime owns the rest of what the old Graphics
// panel did: Auto and the level choice, render scale and the pixel-ratio cap,
// adaptive resolution and the frame-rate limit and readout. The per-category
// overrides of the old panel are not offered (the runtime's Options choose a
// level).
import { levelSettings, type GraphicsLevel, type LevelSettings, type QualityTier } from "starhermit:engine";
import type { AntialiasMode } from "starhermit:scene";

export type Preset = QualityTier;
export interface Budget {
  /** Lit materials: Lambert, standard PBR, or clear-coated physical toys. */
  material: "lambert" | "standard" | "physical";
  /** Rounded-corner curve and bevel segments of every cube. */
  cubeCurve: number;
  cubeBevel: number;
  /** Procedural floor / wallpaper canvas size in px, within the level's largest texture. */
  texture: number;
  /** Ambient dust motes; particles per pop burst (cap). */
  motes: number;
  burst: number;
}
export interface Look {
  preset: Preset;
  /** The level's key-light shadow map size, 0 when the level draws no shadows. */
  shadows: number;
  /** The level's ambient occlusion (null: off). */
  ao: { resolution: number; samples: number; denoiseSamples: number } | null;
  /** The level's bloom resolution (null: off). */
  bloom: number | null;
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

type Art = Pick<Look, "reflections" | "particlesHigh" | "animated" | "detailed">;
const ART: Record<Preset, Art> = {
  low: { reflections: false, particlesHigh: false, animated: false, detailed: false },
  balanced: { reflections: true, particlesHigh: true, animated: true, detailed: true },
  high: { reflections: true, particlesHigh: true, animated: true, detailed: true },
  ultra: { reflections: true, particlesHigh: true, animated: true, detailed: true },
};
const BUDGETS: Record<Preset, Budget> = {
  low: { material: "lambert", cubeCurve: 3, cubeBevel: 1, texture: 128, motes: 24, burst: 30 },
  balanced: { material: "standard", cubeCurve: 5, cubeBevel: 2, texture: 256, motes: 40, burst: 100 },
  high: { material: "physical", cubeCurve: 8, cubeBevel: 4, texture: 256, motes: 70, burst: 160 },
  ultra: { material: "physical", cubeCurve: 12, cubeBevel: 5, texture: 512, motes: 120, burst: 240 },
};
export const MOTE_MAX = 480;
/** Low's burst size (js/gfx.js PARTICLES.low). */
export const LOW_BURST = 30;
/** The level whose settings are each tier's preset. */
const ANCHOR: Record<Preset, GraphicsLevel> = { low: "quantum", balanced: "molecular", high: "terrestrial", ultra: "galactic" };

/** The look for a graphics level (the frame's by default). */
export function lookFor(s: LevelSettings = levelSettings()): Look {
  const preset = s.quality;
  const b = BUDGETS[preset];
  // Motes and bursts grow with the level's particle budget above the tier's anchor, at most 4× the tier's budget.
  const k = Math.min(4, s.particles / levelSettings(ANCHOR[preset]).particles);
  return {
    preset, ...ART[preset],
    shadows: s.shadows ? s.shadowMapSize : 0,
    ao: s.ao && { resolution: s.ao.resolution, samples: s.ao.samples, denoiseSamples: s.ao.denoiseSamples },
    bloom: s.bloom ? s.bloom.resolution : null,
    grade: s.grade,
    antialias: s.antialias,
    budget: {
      ...b, texture: Math.min(b.texture, s.maxTextureSize),
      motes: Math.min(MOTE_MAX, Math.round(b.motes * k)),
      burst: Math.round(b.burst * k),
    },
  };
}
