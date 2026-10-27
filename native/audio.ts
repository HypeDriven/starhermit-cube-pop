// Sound, as the browser build's js/audio.js: the authored one-shots
// (sfx/<name>.opus, sfx/manifest.txt) per game event, the studio room tone
// looping under a round (studio-ambience.opus), and the gentle seeded
// pentatonic music (a sine note every 420 ms walking the theme's scale, a
// bass note an octave down every fourth step). Each captioned cue also
// reports its caption key (main.ts shows it when Sound captions is on).
//
// The browser build's three buses become the runtime's (Options › Audio owns
// the volumes, the mute and the voice limit): music → "music", the effects
// and the room tone → "effects", the menu click → "interface"; the old
// default bus levels (music 50 %, effects 80 %, ambience 40 %) are folded
// into each sound's gain. The music's notes are rendered once into clips
// (createClip) with the old oscillator envelope; the procedural stand-ins
// the browser build played while a clip decoded are not ported (a live
// synthesis graph makes clip loads fail on the engine's web runtime; the
// arrow-exodus port's finding), so a clip still loading is silent. Clips
// load once the mixer runs (natively at once, in a browser after the first
// press), one at a time.
import { context, createClip, loadClip, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";

/** Marks an English caption key (translated where it is shown). */
const N = (s: string): string => s;
const LEVEL = { music: 0.5, effects: 0.8, ambience: 0.4 };
export type Cue =
  | "click" | "invalid" | "select" | "pop" | "rocketCreate" | "rocketFire" | "bombCreate" | "bombFire" | "chain" | "shuffle"
  | "undo" | "hint" | "win" | "lose" | "wave" | "achievement" | "countdownTick" | "countdownGo" | "goalFill" | "timeWarning";
const SAMPLES: Record<Cue, string> = {
  click: "ui-click", invalid: "invalid-buzz", select: "cube-select", pop: "cube-pop", rocketCreate: "rocket-forge",
  rocketFire: "rocket-launch", bombCreate: "bomb-forge", bombFire: "bomb-blast", chain: "chain-surge", shuffle: "board-shuffle",
  undo: "move-undo", hint: "hint-chime", win: "stage-win", lose: "round-lose", wave: "wave-clear", achievement: "achievement-unlock",
  countdownTick: "countdown-tick", countdownGo: "countdown-go", goalFill: "goal-fill", timeWarning: "time-warning",
};
const AMBIENCE = "studio-ambience";
/** js/audio.js's captions (n: the cube count, the chain size, the wave). */
const CAPTIONS: Partial<Record<Cue, string>> = {
  invalid: N("That move is not allowed."), pop: N("Popped {n} cubes."), rocketCreate: N("Rocket forged."), rocketFire: N("Rocket fired."),
  bombCreate: N("Bomb forged."), bombFire: N("Bomb exploded."), chain: N("Chain of {n} specials."), shuffle: N("Board reshuffled."),
  undo: N("Move undone."), hint: N("Hint shown."), win: N("Stage complete."), lose: N("Round over."), wave: N("Wave {n} complete."),
  achievement: N("Achievement unlocked."), goalFill: N("Goal filled."), timeWarning: N("15 seconds left."),
};
const INTERFACE = new Set<Cue>(["click"]);

const clips = new Map<string, AudioClip>();
const queue: string[] = [];
let loading = false;
let wantClips = false;
let onCaption: ((key: string, vars: Record<string, string | number>) => void) | null = null;

function load(name: string): void { if (!queue.includes(name) && !clips.has(name)) queue.push(name); }
function pump(): void {
  if (loading || !queue.length) return;
  const name = queue.shift()!;
  loading = true;
  loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); loading = false; }, (e: unknown) => { console.warn(`sfx ${name}: ${String(e)}`); loading = false; });
}
/** Asks for the clips; they load once the mixer runs (see update). */
export function loadSfx(): void { wantClips = true; }
/** cb(captionKey, vars) for each captioned cue (an English key). */
export function setOnCaption(cb: (key: string, vars: Record<string, string | number>) => void): void { onCaption = cb; }

/** Plays a cue's sample (once loaded) and reports its caption; `n` fills the caption. */
export function cue(name: Cue, n = 0): void {
  if (onCaption && CAPTIONS[name]) onCaption(CAPTIONS[name]!, { n });
  const file = SAMPLES[name];
  const clip = clips.get(file);
  if (!clip || suspended) return;
  const bus: Bus = INTERFACE.has(name) ? "interface" : "effects";
  try { playClip(clip, { bus, gain: LEVEL.effects }); }
  catch { clips.delete(file); load(file); } // a clip the mixer lost: load it again
}

// -- the music ---------------------------------------------------------------------------
const RATE = 22050;
/** js/audio.js's blip: a sine at full level at once, exponential to 0.001 over `dur`. */
function noteClip(freq: number, dur: number): AudioClip {
  const n = Math.round((dur + 0.02) * RATE);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    out[i] = t < dur ? Math.sin(2 * Math.PI * freq * t) * Math.pow(0.001, t / dur) : 0;
  }
  return createClip([out], RATE);
}
const SCALES = [
  [262, 294, 330, 392, 440, 523], // C pentatonic
  [247, 277, 311, 370, 415, 494], // B
  [233, 262, 294, 349, 392, 466], // Bb
  [220, 247, 277, 330, 370, 440], // A
  [196, 220, 247, 294, 330, 392], // G
];
const notes = new Map<string, AudioClip>();
let musicOn = false;
let scale = SCALES[0]!;
let step = 0;
let nextStep = 0;
let nextRender = 0;
let ambienceOn = false;
let ambienceSound: Sound | null = null;
let suspended = false;

/** The round's music, in the theme's scale (js/audio.js startMusic). */
export function startMusic(themeIdx: number): void {
  if (musicOn) return;
  musicOn = true;
  scale = SCALES[Math.max(0, themeIdx) % SCALES.length]!;
  nextStep = 0;
}
export function stopMusic(): void { musicOn = false; }
export function startAmbience(): void { ambienceOn = true; }
export function stopAmbience(): void {
  ambienceOn = false;
  if (ambienceSound) { try { ambienceSound.stop(); } catch { /* gone */ } }
  ambienceSound = null;
}
/** Pause and a hidden window: everything holds (js/audio.js suspendAll / resumeAll). */
export function setSuspended(on: boolean): void { suspended = on; }

/** Each frame: the clips once the mixer runs (one at a time), the scale's
 * notes rendered one each 0.3 s after them, the room tone, then the music's
 * steps by mixer time. */
export function update(): void {
  if (context.state !== "running") return;
  if (wantClips) {
    wantClips = false;
    for (const name of Object.values(SAMPLES)) load(name);
    load(AMBIENCE);
    return;
  }
  pump();
  if (loading || queue.length) return;
  try {
    if (context.currentTime >= nextRender) {
      for (const f of scale) {
        for (const [k, freq, dur] of [[`${f}`, f, 0.5], [`${f}/2`, f / 2, 0.9]] as [string, number, number][]) {
          if (!notes.has(k)) { notes.set(k, noteClip(freq, dur)); nextRender = context.currentTime + 0.3; return; }
        }
      }
    }
    const bed = clips.get(AMBIENCE);
    const want = ambienceOn && !suspended;
    if (want && bed && !ambienceSound) ambienceSound = playClip(bed, { bus: "effects", gain: 0.35 * LEVEL.ambience, loop: true });
    else if (!want && ambienceSound) { try { ambienceSound.stop(); } catch { /* gone */ } ambienceSound = null; }
  } catch (e) { console.warn(`audio: ${String(e)}`); return; }
  if (!musicOn || suspended) return;
  const now = context.currentTime;
  if (now < nextStep) return;
  nextStep = Math.max(now, nextStep) + 0.42;
  const s = step++;
  const f = scale[(s * 3 + ((s / 4) | 0)) % scale.length]!;
  try {
    const note = notes.get(`${f}`);
    if (note) playClip(note, { bus: "music", gain: 0.07 * LEVEL.music });
    const bass = notes.get(`${f}/2`);
    if (s % 4 === 0 && bass) playClip(bass, { bus: "music", gain: 0.05 * LEVEL.music });
  } catch { /* the mixer is full */ }
}
