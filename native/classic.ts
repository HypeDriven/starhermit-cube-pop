// The browser build's pure game scripts, shared unchanged with the node tests:
// the string tables (js/locales/*.js, js/i18n.js), the seeded streams
// (js/rng.js), the deterministic rules engine (js/rules.js), the content
// (js/content.js: colours, themes, Journey, challenges, practice, Score
// Chase, the daily, lessons, achievements) and the session (js/session.js:
// the round over the rules, undo, replay envelope, stars, the progress and
// achievement documents, the saved round, the device's daily board),
// evaluated as classic scripts so their globals are this module's exports.
// js/session.js keeps its documents in `localStorage`: platform.ts puts a
// shim there (nothing reads it while the scripts load).
import { loadClassic } from "starhermit:script";

for (const f of [
  "js/locales/en-GB.js", "js/locales/es.js", "js/locales/de.js", "js/locales/fr.js", "js/locales/pt.js", "js/locales/it.js",
  "js/i18n.js", "js/rng.js", "js/rules.js", "js/content.js", "js/session.js",
]) loadClassic(f);

// -- The shapes this client reads -------------------------------------------------
export interface Cell { c: number; s: number }
export interface Cfg {
  id: string; version: number; kind: string; name: string; seed: number; date?: string;
  board: { rows: number; cols: number }; colors: number; goals: Record<string, number>; minGroup?: number;
  rocketAt: number; bombAt: number; moveLimit: number; timeLimitSec: number;
  par: { moves: number; timeSec: number } | null; mechanics: { undo: boolean; hint: boolean };
  endless: { moveBank: number; movesPerWave: number } | null; theme?: string; intro?: string; mastery?: boolean;
}
export interface Score {
  pops: number; cubes: number; popPoints: number; groupBonus: number; specialBonus: number; chainBonus: number;
  moveBonus: number; timeBonus: number; waveBonus: number; bestGroup: number; specialsMade: number; chainsBest: number;
  waves: number; total: number;
}
export interface State {
  v: number; cfg: Cfg; seed: number; tick: number; grid: (Cell | null)[][]; goals: Record<string, number>; score: Score;
  moves: number; elapsedMs: number; wave: number; moveBank: number | null;
  terminal: { reason: string; won: boolean } | null;
}
export interface RC { r: number; c: number }
export interface RulesEvent {
  type: string; r?: number; c?: number; color?: number; size?: number; special?: number; count?: number; wave?: number; moveBank?: number;
  cells?: (RC & { color?: number })[]; moves?: { fromR: number; fromC: number; toR: number; toC: number }[]; reason?: string;
}
export interface Result { ok: boolean; reason?: string; state: State; events: RulesEvent[]; duplicate?: boolean }
export interface Lesson {
  id: string; title: string; text: string; goal: { event: string; count: number }; cfg: Cfg;
  force: { grid: number[][]; specials?: { r: number; c: number; s: number }[] };
}
export interface Theme { id: string; name: string; unlockStars: number; palette: Record<"wall" | "floor" | "table" | "frame" | "light" | "accent" | "metal" | "fog", number> }
export interface ColorDef { label: string; icon: string; color: number; colorHC: number; charm: string }
export interface Progress { v: number; stars: Record<string, number>; completed: Record<string, boolean>; dailiesDone: Record<string, boolean>; totalCubes: number; sum?: number }
export interface SessionOpts { lesson?: Lesson; forcedGrid?: number[][]; forcedSpecials?: { r: number; c: number; s: number }[] }
export interface RoundSession {
  cfg: Cfg; kind: string; lesson: Lesson | null; state: State; startPerf: number; commands: unknown[];
  elapsed(): number; command(cmd: Record<string, unknown>): Result; pop(r: number, c: number, id: string): Result; tickClock(): Result | null;
  canUndo(): boolean; undo(): boolean; hint(): { r: number; c: number; size: number; why: string } | null;
  lessonGoalMet(): boolean; envelope(): Record<string, unknown>; stars(): number; saveSnapshot(): void; clearSnapshot(): void;
}
export interface DailyEntry { name: string; score: number; moves: number; won: boolean; elapsedMs: number; invalidCount: number; at: number }

interface RulesApi {
  S_NONE: 0; S_ROCKET_H: 1; S_ROCKET_V: 2; S_BOMB: 3;
  groupAt(s: State, r: number, c: number): RC[];
  blastCells(s: State, r: number, c: number, special: number): RC[];
  legalActions(s: State): { r: number; c: number; kind: string; size: number }[];
  currentScore(s: State): number;
}
interface ContentApi {
  CONTENT_VERSION: number; COLORS: ColorDef[]; THEMES: Theme[]; JOURNEY: Cfg[]; CHALLENGES: Cfg[]; PRACTICE: Cfg[]; SCORE_CHASE: Cfg;
  ACHIEVEMENTS: { key: string; name: string; desc: string }[];
  dailyConfig(date: string): Cfg;
  utcDateString(nowMs?: number): string;
  tutorialLessons(): Lesson[];
}
interface SessionApi {
  Session: { new (cfg: Cfg, opts?: SessionOpts): RoundSession; clock: (() => number) | null; now(): number; loadSnapshot(): RoundSession | null; clearSnapshot(): void };
  loadProgress(): Progress; loadProgressRaw(json: unknown): Progress | null; saveProgress(p: Progress): void;
  totalStars(p: Progress): number; mergeProgress(remote: Progress | null, local: Progress | null): Progress;
  loadAchievements(): Record<string, number>; unlockAchievement(key: string): boolean;
  submitDaily(name: string, date: string, envelope: unknown): Promise<{ ok: boolean; score: number; rank: number }>;
  dailyBoard(date: string): Promise<{ date: string; entries: DailyEntry[] }>;
  readLS<T>(k: string, fallback: T): T; writeLS(k: string, v: unknown): void;
  LS: Record<"settings" | "progress" | "achievements" | "savedRound" | "dailyBest" | "dailyBoards", string>;
}
interface RngApi {
  derive(seed: number, stream: number): { next(): number; int(n: number): number };
  hashString(s: string): number;
  STREAM_DECOR: number;
}
interface I18nApi {
  T(key: string, vars?: Record<string, string | number> | null): string;
  setLocale(tag: string): void;
  readonly lang: string;
  LOCALES: string[];
  DICTS: Record<string, Record<string, string>>;
}

const g = globalThis as unknown as { CPRules: RulesApi; CPContent: ContentApi; CPSession: SessionApi; CPRNG: RngApi; CPI18n: I18nApi };
export const Rules = g.CPRules;
export const Content = g.CPContent;
export const Sess = g.CPSession;
export const RNG = g.CPRNG;
export const I18n = g.CPI18n;
