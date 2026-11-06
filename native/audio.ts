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
// into each sound's gain. The music's notes are rendered once into clips by
// the engine (OfflineAudioContext) with the old oscillator envelope; the
// procedural stand-ins the browser build played while a clip decoded are not
// ported, so a clip still loading is silent. The
// clips all load at once in onStart (every loaded clip reaches the mixer,
// natively and on the web); the room tone and the music start once the mixer
// runs (in a browser after the first press).
import { context, createClip, loadClip, OfflineAudioContext, play as playClip, type AudioClip, type Bus, type Sound } from "starhermit:audio";

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
let onCaption: ((key: string, vars: Record<string, string | number>) => void) | null = null;

/** Loads every clip at once (onStart); a cue whose clip is still loading is skipped. */
export function loadSfx(): void {
  for (const name of new Set([...Object.values(SAMPLES), AMBIENCE])) {
    loadClip(`sfx/${name}.opus`).then((c) => { clips.set(name, c); }, (e: unknown) => console.warn(`sfx ${name}: ${String(e)}`));
  }
}
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
  catch { /* the mixer is full this frame: skip it */ }
}

// -- the music ---------------------------------------------------------------------------
const RATE = 22050;
/** js/audio.js's blip: a sine at full level at once, exponential to 0.001 over `dur`. */
async function renderNote(freq: number, dur: number): Promise<AudioClip> {
  const off = new OfflineAudioContext(1, Math.round((dur + 0.02) * RATE), RATE);
  const osc = off.createOscillator();
  osc.frequency.value = freq;
  const gain = off.createGain();
  gain.gain.setValueAtTime(1, 0);
  gain.gain.exponentialRampToValueAtTime(0.001, dur);
  gain.gain.setValueAtTime(0, dur);
  osc.connect(gain).connect(off.destination);
  osc.start();
  return createClip(await off.startRendering());
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
let ambienceOn = false;
let ambienceSound: Sound | null = null;
let suspended = false;
const rendering = new Set<string>();
/** Renders a scale's notes and bass notes once (at most 12 contexts at a time); steps wait on the clips. */
function renderScale(list: readonly number[]): void {
  for (const f of list) {
    for (const [k, freq, dur] of [[`${f}`, f, 0.5], [`${f}/2`, f / 2, 0.9]] as [string, number, number][]) {
      if (rendering.has(k)) continue;
      rendering.add(k);
      renderNote(freq, dur).then((c) => { notes.set(k, c); }, (e: unknown) => console.warn(`music: ${String(e)}`));
    }
  }
}

/** The round's music, in the theme's scale (js/audio.js startMusic). */
export function startMusic(themeIdx: number): void {
  if (musicOn) return;
  musicOn = true;
  scale = SCALES[Math.max(0, themeIdx) % SCALES.length]!;
  renderScale(scale);
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

/** Each frame once the mixer runs: the room tone, then the music's steps by mixer time. */
export function update(): void {
  if (context.state !== "running") return; // starting the room tone and music still waits for the mixer
  try {
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
