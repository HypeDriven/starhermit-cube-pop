// The game's data and the StarHermit platform, on the runtime's modules:
// - progress (journey stars and completions, finished lessons and dailies,
//   the lifetime cube count) is js/session.js's checksummed document
//   {v, stars, completed, dailiesDone, totalCubes, sum}, unchanged: it is
//   the game's save (starhermit:storage `saves`) on the device and in the
//   player's cloud slot, two devices' copies merged on a conflict
//   (CPSession.mergeProgress: the better stars, every completion, the larger
//   cube count). The slot the browser build wrote (the JS SDK's saveJSON of
//   the same document) shows as foreign and is merged in and replaced once;
// - js/session.js keeps reading and writing `localStorage`: here a shim
//   whose progress key is that save and whose other keys (achievements, the
//   saved round, today's best, the device's daily board, the Score Chase
//   runs, the board name) are the device's starhermit:storage, as the
//   browser build kept them on the device;
// - the game's own options (sound captions, left-handed tray, studio theme)
//   are `settings` (game.<key>, synced with the account); the browser
//   build's account settings (its settings document's keys and ui.language)
//   are migrated, then the old keys removed. Volumes, mute, graphics,
//   language, reduced motion, high contrast and text size are the runtime's
//   Options;
// - the player (signed in or a guest), the invite link, the platform's clock
//   for the daily, and posting a finished round through score-script.js (a
//   practice session whose socket carries { type: 'result', scores }, as the
//   JS SDK's submitScores did) with the rank on the high-score board.
import type { JsonValue } from "starhermit:engine";
import {
  connectGame, inviteLink as fetchInviteLink, leaderboards, onPlayerChange, player, serverNow, serverTime, sessions,
  type Leaderboard,
} from "starhermit:platform";
import { saves, settings as store, storage } from "starhermit:storage";
import { RNG, Sess, type Progress } from "./classic.ts";

// --- the save and the localStorage shim ----------------------------------------------
const PROGRESS_KEY = Sess.LS.progress;
let current: Progress | null = null;
let live: Progress | null = null;
let lastSavedAt = 0;
const mergedListeners = new Set<() => void>();
/** fn() after progress from the account (another device, the browser build) was merged in. */
export function onProgressMerged(fn: () => void): void { mergedListeners.add(fn); }
function merged(): void { for (const fn of mergedListeners) fn(); }

function persist(): void {
  if (!current) return;
  try { saves.save(current as unknown as JsonValue, { schema: 1 }); }
  catch (e) { console.warn(`save: ${String(e)}`); }
}
const shim = {
  getItem(key: string): string | null {
    if (key === PROGRESS_KEY) return current ? JSON.stringify(current) : null;
    try { return storage.getText(key); } catch { return null; }
  },
  setItem(key: string, value: string): void {
    if (key === PROGRESS_KEY) {
      try { current = JSON.parse(value) as Progress; } catch { return; }
      persist();
      return;
    }
    try { storage.set(key, String(value)); } catch (e) { console.warn(`storage ${key}: ${String(e)}`); }
  },
  removeItem(key: string): void {
    if (key === PROGRESS_KEY) { current = null; return; }
    try { storage.remove(key); } catch { /* gone */ }
  },
};
(globalThis as unknown as { localStorage: typeof shim }).localStorage = shim;

/** js/session.js's checksum of a progress document. */
function sealed(p: Progress): Progress {
  const R = (globalThis as unknown as { CPRules: { stableStringify(v: unknown): string } }).CPRules;
  const out: Progress = { v: 1, stars: p.stars, completed: p.completed, dailiesDone: p.dailiesDone, totalCubes: p.totalCubes };
  out.sum = RNG.hashString(R.stableStringify({ v: out.v, stars: out.stars, completed: out.completed, dailiesDone: out.dailiesDone, totalCubes: out.totalCubes })) >>> 0;
  return out;
}

/** The live progress document (the one rounds update and save). */
export function progress(): Progress {
  if (!live) live = Sess.loadProgress();
  return live;
}
/** Saves the live progress (device at once, the account debounced). */
export function saveProgress(): void { Sess.saveProgress(progress()); }
/** Starts from an empty document (Settings › Reset all progress). */
export function resetProgress(): void {
  shim.removeItem(PROGRESS_KEY);
  live = Sess.loadProgress();
  saveProgress();
}

/** Merges another copy of the document into the live one (and saves); whether anything changed. */
function adopt(other: unknown): boolean {
  const remote = Sess.loadProgressRaw(other);
  if (!remote) return false;
  const next = sealed(Sess.mergeProgress(remote, progress()));
  if (JSON.stringify(next) === JSON.stringify(sealed(progress()))) return false;
  live = next;
  saveProgress();
  return true;
}

saves.onConflict((local, remote) => {
  const a = Sess.loadProgressRaw(remote.data), b = Sess.loadProgressRaw(local?.data ?? null);
  return { merged: sealed(Sess.mergeProgress(a, b)) as unknown as JsonValue };
});
saves.onStatus((_status, state) => {
  if (state === "foreign") { migrateForeign(); return; }
  // The account's save replaced the device's (another device saved last): merge it in.
  const cur = saves.load();
  if (cur && cur.savedAt !== lastSavedAt) {
    lastSavedAt = cur.savedAt;
    if (adopt(cur.data)) merged();
  }
});

/** The browser build's cloud save: merged with this device's progress, saved over it once. */
function migrateForeign(): void {
  const old = saves.foreign();
  if (!old) return;
  let doc: unknown = null;
  try { doc = old.text ? JSON.parse(old.text) : null; } catch { doc = null; }
  const changed = adopt(doc);
  if (!current) current = sealed(progress());
  try { saves.save(current as unknown as JsonValue, { schema: 1, replaceForeign: true }); }
  catch (e) { console.warn(`save migration: ${String(e)}`); }
  if (changed) merged();
}

/** For the top bar: offline (a guest) | saving | synced | error. */
export function syncState(): "offline" | "saving" | "synced" | "error" {
  if (!player()) return "offline";
  const st = saves.state();
  if (st === "error" || st === "read-blocked") return "error";
  if (st === "loading" || st === "uploading" || st === "foreign" || saves.status() === "pending") return "saving";
  return "synced";
}
export function flush(): void { void saves.flush().catch(() => undefined); }

// --- the game's options ---------------------------------------------------------------
export interface Settings { captions: boolean; leftHanded: boolean; theme: string }
export const settings: Settings = { captions: true, leftHanded: false, theme: "daybreak" };
type Key = keyof Settings;
const KEYS: Key[] = ["captions", "leftHanded", "theme"];
const settingsListeners = new Set<() => void>();
export function onSettingsChange(fn: () => void): void { settingsListeners.add(fn); }
function settingsChanged(): void { for (const fn of settingsListeners) fn(); }
function check(key: Key, v: unknown): boolean | string | undefined {
  if (key === "theme") return typeof v === "string" && /^[a-z]{1,24}$/.test(v) ? v : undefined;
  return typeof v === "boolean" ? v : undefined;
}
function readSetting(key: Key): void {
  let v: JsonValue | undefined;
  try { v = store.get(key); } catch { return; }
  const ok = check(key, v);
  if (ok !== undefined) (settings as unknown as Record<string, unknown>)[key] = ok;
}
/** A migrated value, kept unless this game set the key since. */
function adoptSetting(key: Key, value: unknown): void {
  const v = check(key, value);
  if (v === undefined) return;
  try {
    if (store.get(key) !== undefined) return;
    store.set(key, v);
    (settings as unknown as Record<string, unknown>)[key] = v;
    settingsChanged();
  } catch { /* keep the device's */ }
}
/** Changes one of the game's options (device and account). */
export function setSetting<K extends Key>(key: K, value: Settings[K]): void {
  if (settings[key] === value) return;
  settings[key] = value;
  try { store.set(key, value as JsonValue); } catch (e) { console.warn(`setting ${key}: ${String(e)}`); }
  settingsChanged();
}
// The browser build's account settings (its settings document, patched key by
// key, and the language helper's ui.language): the game's options among them
// carry over (unless this game set them since), then all are removed.
export const BROWSER_KEYS = [
  "volMusic", "volEffects", "volAmbience", "muted", "graphics", "quality", "reducedMotion", "highContrast", "largeText",
  "leftHanded", "captions", "confirmPop", "theme", "ui.language",
];
function importLegacy(): void {
  const keys = store.legacyKeys();
  if (!keys) return;
  for (const key of keys) if ((KEYS as string[]).includes(key)) adoptSetting(key as Key, store.legacy(key));
  for (const key of keys) if (BROWSER_KEYS.includes(key)) store.removeLegacy(key);
}

/** Reads the device's save and the game's options (from onStart). */
export function initPlatform(): void {
  const cur = saves.load();
  lastSavedAt = cur?.savedAt ?? 0;
  current = Sess.loadProgressRaw(cur?.data ?? null);
  live = Sess.loadProgress();
  for (const k of KEYS) readSetting(k);
  store.onChange((key) => {
    if (!(KEYS as string[]).includes(key)) return;
    readSetting(key as Key);
    settingsChanged();
  });
  store.onLegacy(importLegacy);
  importLegacy();
  if (saves.state() === "foreign") migrateForeign();
  settingsChanged();
  refreshPlayer();
  void serverTime().catch(() => undefined);
}

// --- the player and the clock ----------------------------------------------------------
export function signedIn(): boolean { return !!player(); }
export function displayName(): string { return player()?.displayName ?? ""; }
let invite: string | null = null;
/** The invite link, fetched ahead so a button press can copy it at once. */
export function inviteLink(): string | null { return player() ? invite : null; }
function refreshPlayer(): void {
  invite = null;
  board = null;
  if (!player()) return;
  fetchInviteLink().then((u) => { invite = u; }, () => { invite = null; });
}
onPlayerChange(() => refreshPlayer());

/** Now in ms by the platform's clock when it has answered, else the device's. */
export function nowMs(): number {
  try { return serverNow() ?? Date.now(); } catch { return Date.now(); }
}
/** Whether nowMs() follows the platform's clock. */
export function timeTrusted(): boolean { try { return serverNow() !== null; } catch { return false; } }

// --- the StarHermit high-score board ---------------------------------------------------
let board: Leaderboard | null = null;
async function highScoreBoard(): Promise<Leaderboard | null> {
  if (board) return board;
  const list = await leaderboards.list();
  board = list.find((b) => b.key === "high-score") ?? list[0] ?? null;
  return board;
}

/** Signed in only: post a finished round's total through score-script.js; { posted, rank }. Never rejects. */
export async function postLeaderboard(total: number): Promise<{ posted: boolean; rank: number | null }> {
  const me = player();
  if (!me) return { posted: false, rank: null };
  const score = Math.max(0, Math.round(total));
  let accepted: string[] = [];
  try {
    const sessionId = await sessions.practice();
    accepted = await new Promise<string[]>((resolve) => {
      const socket = connectGame(sessionId);
      let done = false;
      const finish = (list: string[]): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.close();
        resolve(list);
      };
      const timer = setTimeout(() => finish([]), 15000);
      socket.on("open", () => { socket.sendCommand({ type: "result", scores: { "high-score": score } }); });
      socket.on("game", (data) => {
        const d = data as { type?: string; accepted?: string[] } | null;
        if (d && d.type === "result-ack") finish(Array.isArray(d.accepted) ? d.accepted : []);
      });
      socket.on("error", () => finish([]));
      socket.on("stopped", () => finish([]));
      socket.on("abandoned", () => finish([]));
    });
  } catch { return { posted: false, rank: null }; }
  if (!accepted.includes("high-score")) return { posted: false, rank: null };
  try {
    const b = await highScoreBoard();
    if (!b) return { posted: true, rank: null };
    const r = await leaderboards.entries(b.id, { pageSize: 100 });
    const mine = r.items.find((e) => e.userId === me.userId);
    return { posted: true, rank: mine ? mine.rank : null };
  } catch { return { posted: true, rank: null }; }
}
