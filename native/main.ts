// Cube Pop on the StarHermit engine: the entry module (starhermit.txt
// engine.entry), played natively by the StarHermit client and in browsers by
// the engine's web runtime. The rules (js/rules.js), content (js/content.js)
// and session with its replay envelope (js/session.js) are the browser
// build's, unchanged in what they decide; this module is what js/ui.js did
// around them — the state machine (title → mode lists → the round with its
// 3-2-1-Pop! countdown ⇄ pause → results → next stage / retry / menu), the
// round lifecycle with its saved snapshot (Resume saved round on the title),
// the event presentation (a sound, a caption, an announcement and the wall's
// animation per rules event), mid-round achievements, the lessons, the focus
// cell moved by keys and pads, taps on the wall and the drag orbit, the
// clock of time-limited rounds with its 15-second warning, Undo, Hint and
// Camera, the results with stars, the local daily board and posting to the
// high-score board, and the lifecycle (a hidden window pauses the round, as
// the browser build's visibilitychange did). The screens and HUD are drawn
// by screens.ts (starhermit:ui), the studio by render.ts (starhermit:scene).
//
// Time is the runtime's fixed steps (60 a second): the session's clock
// (Session.clock) counts the steps of the active round only, so pauses, a
// hidden window and slow frames never cost time and play scripts replay
// exactly; the countdown and the pop animations wait on the same steps.
import { clipboard, frame, onFixedUpdate, onPreferencesChange, onRender, onResume, onStart, onSuspend, onUpdate, preferences, setFixedRate } from "starhermit:engine";
import { onAction, onPointerButton, onPointerMove, onTouch } from "starhermit:input";
import * as ui from "starhermit:ui";
import { onSessionEnded, requestSignIn } from "starhermit:platform";
import { Content, RNG, Rules, Sess, type Cfg, type Lesson, type RoundSession, type RulesEvent, type State, type Theme } from "./classic.ts";
import * as audio from "./audio.ts";
import { N, T, onLocaleChange } from "./i18n.ts";
import * as platform from "./platform.ts";
import { lookFor } from "./quality.ts";
import * as render from "./render.ts";
import { drawScreens } from "./screens.ts";
import { applyContrast, initStyles } from "./style.ts";

export type Screen = "title" | "journey" | "daily" | "practice" | "challenge" | "score" | "learn" | "achievements" | "settings" | "help" | "game";
export type Phase = "title" | "mode-select" | "preparing" | "countdown" | "active" | "paused" | "resolving" | "results";
type ListName = "journey" | "practice" | "challenge" | "learn" | "daily" | "score";

const STEP_MS = 1000 / 60;
let steps = 0;
/** The active round's clock, ms (never 0: the session reads 0 as "not started"). */
Sess.Session.clock = () => 1 + steps * STEP_MS;

export const app = {
  screen: "title" as Screen,
  phase: "title" as Phase,
  /** Where Settings and Help go back to: the title, or the pause menu of the round. */
  returnTo: "title" as "title" | "pause",
  overlay: null as "pause" | "results" | null,
  /** Frame the screen or overlay opened on (the press that opened it must not also act on it). */
  openedFrame: 0,
  focusNext: null as string | null,
  session: null as RoundSession | null,
  focus: { r: 0, c: 0 },
  inputLocked: false,
  cmdSeq: 0,
  timeWarned: false,
  currentList: null as ListName | null,
  currentIdx: 0,
  countdown: null as { i: number; left: number } | null,
  /** ms of the pop animation left (fixed steps), then its completion. */
  resolve: null as { left: number; done: () => void } | null,
  lesson: null as { firstRun: boolean; lesson: Lesson | null } | null,
  resultsLesson: null as Lesson | null,
  lb: null as { posted: boolean; rank: number | null } | "posting" | null,
  daily: { name: "", status: "", busy: false },
  confirmReset: false,
  toast: null as { text: string; until: number; selectable?: string } | null,
  caption: null as { text: string; until: number } | null,
  hoverCell: null as { r: number; c: number } | null,
};
export const settings = platform.settings;
const now = (): number => frame().time;

// ------------------------------------------------------------------ helpers
export function announce(text: string, assertive = false): void {
  if (text) ui.announce(text.slice(0, 500), { politeness: assertive ? "assertive" : "polite" });
}
/** js/ui.js toast(): 2.6 s by default; `selectable` (an invite link) stays readable in it. */
export function toast(text: string, seconds = 2.6, selectable?: string): void {
  app.toast = { text, until: now() + seconds, ...(selectable ? { selectable } : {}) };
}
export function click(): void { audio.cue("click"); }
export function highContrast(): boolean { return ui.preferences().highContrast; }
export function progress(): ReturnType<typeof platform.progress> { return platform.progress(); }
export function themeById(id: string | undefined): Theme { return Content.THEMES.find((t) => t.id === id) ?? Content.THEMES[0]!; }
export function themeUnlocked(t: Theme): boolean { return Sess.totalStars(progress()) >= t.unlockStars; }
export function colorLabel(i: number): { label: string; color: number; colorHC: number } { return Content.COLORS[i % Content.COLORS.length]!; }
export function colorHex(i: number): number { return highContrast() ? colorLabel(i).colorHC : colorLabel(i).color; }
export function todayUtc(): string { return Content.utcDateString(platform.nowMs()); }
export function dailyCfg(): Cfg { return Content.dailyConfig(todayUtc()); }
export function cfgName(cfg: Cfg): string { return cfg.date ? T("Daily {date}", { date: cfg.date }) : T(cfg.name); }

// ------------------------------------------------------------------ navigation
export function show(screen: Screen, focus: string | null = null): void {
  app.screen = screen;
  app.openedFrame = frame().frame;
  app.focusNext = focus;
  app.confirmReset = false;
  ui.setFocus(null);
  if (screen !== "game") app.phase = screen === "title" ? "title" : "mode-select";
  render.setActive(screen === "game" && !!app.session);
}
export function goHome(): void { show("title", "btn-play"); }
/** Settings or Help: from the pause menu they go back to it. */
export function openPage(screen: "settings" | "help"): void {
  click();
  app.returnTo = app.session && app.phase === "paused" ? "pause" : "title";
  if (app.returnTo === "pause") app.overlay = null;
  show(screen, screen === "settings" ? "set-captions" : "btn-back");
  app.phase = app.returnTo === "pause" ? "paused" : "mode-select";
}
export function back(): void {
  click();
  if (app.returnTo === "pause" && app.session) {
    app.returnTo = "title";
    app.screen = "game";
    app.openedFrame = frame().frame;
    render.setActive(true);
    openPause(false);
    return;
  }
  goHome();
}

// ------------------------------------------------------------------ rounds
export function startJourney(i: number): void {
  app.currentList = "journey"; app.currentIdx = i;
  startRound(Content.JOURNEY[i]!);
}
/** Title › Play: the next uncompleted journey stage. */
export function play(): void {
  click();
  const p = progress();
  let idx = Content.JOURNEY.findIndex((l, i) => !p.completed[l.id] && (i === 0 || p.completed[Content.JOURNEY[i - 1]!.id]));
  if (idx < 0) idx = 0;
  startJourney(idx);
}
export function startLesson(i: number): void {
  const lesson = Content.tutorialLessons()[i]!;
  app.currentList = "learn"; app.currentIdx = i;
  startRound(lesson.cfg, lesson);
}
export function startList(list: "practice" | "challenge", i: number): void {
  app.currentList = list; app.currentIdx = i;
  startRound((list === "practice" ? Content.PRACTICE : Content.CHALLENGES)[i]!);
}
export function startDaily(): void { app.currentList = "daily"; app.currentIdx = 0; startRound(dailyCfg()); }
export function startScore(): void {
  app.currentList = "score"; app.currentIdx = 0;
  // A fresh seed per run (the browser build's Math.random seed), from the platform's clock.
  const seed = RNG.hashString("cubepop-score-" + platform.nowMs() + "-" + steps) >>> 0;
  startRound({ ...Content.SCORE_CHASE, seed });
}

function applyTheme(cfg: Cfg | null): void {
  const themeId = cfg?.theme || settings.theme;
  let theme = themeById(themeId);
  if (!themeUnlocked(theme)) theme = themeById(settings.theme);
  if (!themeUnlocked(theme)) theme = Content.THEMES[0]!; // e.g. after a progress reset
  render.setTheme(theme.palette, Content.COLORS.map((c) => (highContrast() ? c.colorHC : c.color)));
}

function startRound(cfg: Cfg, lesson: Lesson | null = null): void {
  audio.setSuspended(false);
  app.overlay = null;
  app.resultsLesson = null;
  app.lb = null;
  app.resolve = null;
  app.session = new Sess.Session(cfg, lesson ? { lesson, forcedGrid: lesson.force.grid, forcedSpecials: lesson.force.specials ?? [] } : {});
  app.cmdSeq = 0;
  app.timeWarned = false;
  app.inputLocked = true;
  app.focus = { r: 0, c: 0 };
  show("game");
  app.phase = "preparing";
  applyTheme(cfg);
  render.syncToState(app.session.state);
  render.setFocusCell(0, 0);
  render.setHintCell(null);
  render.setHoverGroup([]);
  // Lesson guidance, or the first-run rule card until the first successful pop.
  if (lesson) app.lesson = { firstRun: false, lesson };
  else if (!Sess.loadAchievements()["first-pop"]) app.lesson = { firstRun: true, lesson: null };
  else app.lesson = null;
  const themeIdx = Content.THEMES.indexOf(themeById(cfg.theme || settings.theme));
  audio.startAmbience();
  audio.startMusic(Math.max(0, themeIdx));
  runCountdown(() => {
    const s = app.session!;
    s.startPerf = Sess.Session.now();
    app.phase = "active";
    app.inputLocked = false;
    announce(cfgName(cfg) + ". " + (lesson ? T(lesson.text) : T("Fill the goals to win.") + " " + legalSummary()));
    setFocus(0, 0);
  });
}
export function restartRound(): void {
  if (!app.session) return;
  click();
  const { cfg, lesson } = app.session;
  startRound(cfg, lesson);
}

export function legalSummary(): string {
  const groups = Rules.legalActions(app.session!.state).filter((a) => a.kind === "pop");
  return groups.length ? T("{n} cubes in poppable groups.", { n: groups.length }) : T("Fire a special to continue.");
}

let countdownDone: (() => void) | null = null;
const COUNT = ["3", "2", "1", N("Pop!")];
function runCountdown(done: () => void): void {
  if (preferences().reducedMotion) { done(); return; }
  app.phase = "countdown";
  countdownDone = done;
  app.countdown = { i: 0, left: 0 };
  countdownStep();
}
function countdownStep(): void {
  const c = app.countdown!;
  const last = c.i === COUNT.length - 1;
  announce(last ? T(COUNT[c.i]!) : COUNT[c.i]!);
  audio.cue(last ? "countdownGo" : "countdownTick");
  c.left = last ? 400 : 550;
}
/** The countdown's text now ("3", "2", "1", "Pop!"), or null. */
export function countdownText(): string | null {
  const c = app.countdown;
  if (!c) return null;
  return c.i === COUNT.length - 1 ? T(COUNT[c.i]!) : COUNT[c.i]!;
}

/** Number of colour quotas already met (the goal-fill cue). */
function goalsFilled(st: State): number {
  let n = 0;
  for (const g of Object.keys(st.cfg.goals)) if ((st.goals[g] ?? 0) >= st.cfg.goals[g]!) n++;
  return n;
}

export function canAct(): boolean { return !!app.session && app.screen === "game" && app.phase === "active" && !app.inputLocked && !app.overlay; }

export function setFocus(r: number, c: number): void {
  app.focus = { r, c };
  render.setFocusCell(r, c);
  previewAt(r, c);
}
export function previewAt(r: number, c: number): void {
  const st = app.session?.state;
  if (!st) return;
  const cell = st.grid[r]?.[c];
  if (!cell) { render.setHoverGroup([]); return; }
  if (cell.s !== 0) { render.setHoverGroup(Rules.blastCells(st, r, c, cell.s), false); return; }
  const grp = Rules.groupAt(st, r, c);
  render.setHoverGroup(grp, grp.length < (st.cfg.minGroup || 2));
}
/** A cell's spoken description (js/ui.js board mirror). */
export function cellLabel(r: number, c: number): string {
  const st = app.session!.state;
  const cell = st.grid[r]?.[c];
  let desc: string;
  if (!cell) desc = T("empty");
  else {
    const colorName = T(colorLabel(cell.c).label);
    if (cell.s === 1) desc = T("{color} row rocket", { color: colorName });
    else if (cell.s === 2) desc = T("{color} column rocket", { color: colorName });
    else if (cell.s === 3) desc = T("{color} bomb", { color: colorName });
    else desc = T("{color}, group of {n}", { color: colorName, n: Rules.groupAt(st, r, c).length });
  }
  return T("Row {r} column {c}: {desc}", { r: r + 1, c: c + 1, desc });
}

export function tryPop(r: number, c: number): void {
  if (!canAct()) return;
  const s = app.session!;
  if (s.state.terminal) return;
  const id = "c" + ++app.cmdSeq + "-" + steps.toString(36);
  const goalsBefore = goalsFilled(s.state);
  const res = s.pop(r, c, id);
  if (!res.ok) {
    if (res.duplicate) return;
    audio.cue("invalid");
    const why = ({
      "group-too-small": T("That cube is not in a group of {n} or more.", { n: s.state.cfg.minGroup || 2 }),
      "empty-cell": T("That cell is empty."),
      "bad-location": T("That cell is outside the wall."),
      "game-ended": T("The round is over."),
    } as Record<string, string>)[res.reason ?? ""] ?? T("That move is not allowed.");
    announce(why, true);
    toast(why);
    render.setHoverGroup([], true);
    return;
  }
  app.phase = "resolving";
  app.inputLocked = true;
  if (!res.state.terminal && goalsFilled(res.state) > goalsBefore) audio.cue("goalFill");
  render.setHintCell(null);
  const round = s;
  handleEvents(res.events, round.state, () => {
    // The player may have restarted or left while the animation played out.
    if (app.session !== round) return;
    // A lesson whose goal is the win ("Finish the stage") completes as a lesson (the browser build
    // ended it as a round, so the lesson never counted and the last one stayed locked).
    if (round.lesson && round.lessonGoalMet()) { lessonComplete(); return; }
    if (round.state.terminal) { endRound(); return; }
    app.phase = "active";
    app.inputLocked = false;
    const popEv = res.events.find((e) => e.type === "pop");
    if (popEv) announce(T("Popped {n} {color} cubes. Score {score}.", { n: popEv.size!, color: T(colorLabel(popEv.color!).label), score: Rules.currentScore(round.state) }));
    setFocus(app.focus.r, app.focus.c);
  });
}

function handleEvents(events: RulesEvent[], next: State, done: () => void): void {
  let sawRocket = false, sawBomb = false;
  for (const e of events) {
    switch (e.type) {
      case "pop": audio.cue("pop", e.size ?? 0); break;
      case "special-create":
        if (e.special === 3) { audio.cue("bombCreate"); sawBomb = true; } else { audio.cue("rocketCreate"); sawRocket = true; }
        break;
      case "fire": audio.cue(e.special === 3 ? "bombFire" : "rocketFire"); break;
      case "chain": audio.cue("chain", e.count ?? 0); break;
      case "shuffle": audio.cue("shuffle"); announce(T("No moves left — the wall reshuffled.")); break;
      case "wave": audio.cue("wave", e.wave ?? 0); announce(T("Wave {n} complete. New goals, +{moves} moves in the bank.", { n: e.wave!, moves: e.moveBank! })); break;
    }
  }
  // Achievements that fire mid-round.
  if (sawRocket) award("first-rocket");
  if (sawBomb) award("first-bomb");
  const chainEv = events.find((e) => e.type === "chain");
  if (chainEv && (chainEv.count ?? 0) >= 3) award("chain-3");
  if (events.some((e) => e.type === "pop")) {
    award("first-pop");
    if (app.lesson?.firstRun) app.lesson = null;
  }
  if (app.session!.state.score.bestGroup >= 12) award("big-group");
  const dur = render.playEvents(events, next);
  if (dur <= 0) done();
  else app.resolve = { left: dur, done };
}

function endRound(): void {
  const s = app.session!;
  app.phase = "results";
  app.inputLocked = true;
  const st = s.state;
  const won = !!st.terminal?.won;
  audio.cue(won ? "win" : "lose");
  s.clearSnapshot();
  const p = progress();
  if (won) {
    award("first-win");
    if (s.kind === "journey") {
      p.completed[st.cfg.id] = true;
      p.stars[st.cfg.id] = Math.max(p.stars[st.cfg.id] ?? 0, s.stars());
      const doneCount = Content.JOURNEY.filter((l) => p.completed[l.id]).length;
      if (doneCount >= 20) award("journey-half");
      if (doneCount >= Content.JOURNEY.length) award("journey-done");
    }
    if (s.kind === "challenge") p.stars[st.cfg.id] = Math.max(p.stars[st.cfg.id] ?? 0, s.stars());
    if (s.kind === "daily" && st.cfg.date) {
      p.dailiesDone[st.cfg.date] = true;
      if (Object.keys(p.dailiesDone).length >= 7) award("daily-7");
    }
  }
  p.totalCubes += st.score.cubes;
  if (p.totalCubes >= 1000) award("cubes-1000");
  if (st.score.total >= 3000) award("score-3000");
  platform.saveProgress();
  if (s.kind === "score") {
    const best = Sess.readLS<{ score: number; waves: number; at: number }[]>("cubepop:score-best:v1", []);
    best.push({ score: st.score.total, waves: st.score.waves, at: platform.nowMs() });
    best.sort((a, b) => b.score - a.score);
    Sess.writeLS("cubepop:score-best:v1", best.slice(0, 10));
  }
  if (s.kind === "daily" && st.cfg.date) {
    const db = Sess.readLS<Record<string, number>>(Sess.LS.dailyBest, {});
    db[st.cfg.date] = Math.max(db[st.cfg.date] ?? 0, st.score.total);
    Sess.writeLS(Sess.LS.dailyBest, db);
  }
  announce(T("Round over. {reason} Score {score}.", { reason: resultReason(st), score: st.score.total }));
  postToLeaderboard(st.score.total);
  app.daily = { name: platform.signedIn() ? platform.displayName() : Sess.readLS<string>("cubepop:name", ""), status: "", busy: false };
  openResults();
}
function openResults(): void {
  app.overlay = "results";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-results-retry";
  ui.setFocus(null);
}
export function resultReason(st: State): string {
  return ({
    "goals-complete": T("All goals complete!"), "move-limit": T("Out of moves"), "time-up": T("Time is up"), resigned: T("Round resigned"),
  } as Record<string, string>)[st.terminal?.reason ?? ""] ?? T("Round over");
}
export function award(key: string): boolean {
  if (!Sess.unlockAchievement(key)) return false;
  const def = Content.ACHIEVEMENTS.find((a) => a.key === key);
  const name = def ? T(def.name) : key;
  audio.cue("achievement");
  toast(T("Achievement: {name}", { name }));
  announce(T("Achievement unlocked: {name}", { name }));
  return true;
}
/** Signed in only: post the round total and show the player's board rank (js/ui.js postToLeaderboard). */
function postToLeaderboard(total: number): void {
  app.lb = null;
  if (!platform.signedIn()) return;
  app.lb = "posting";
  const round = app.session;
  void platform.postLeaderboard(total).then((r) => { if (app.session === round) app.lb = r; });
}
export function leaderboardLine(): string | null {
  const r = app.lb;
  if (!r) return null;
  if (r === "posting") return T("Posting score to the leaderboard…");
  if (!r.posted) return T("Score not posted to the leaderboard.");
  return r.rank ? T("Leaderboard rank: #{rank}", { rank: r.rank }) : T("Score posted to the leaderboard.");
}
export function submitDailyScore(): void {
  const s = app.session;
  if (!s || !s.state.cfg.date || app.daily.busy) return;
  click();
  const name = platform.signedIn() ? platform.displayName() : (app.daily.name.trim() || "Guest");
  if (!platform.signedIn()) Sess.writeLS("cubepop:name", name);
  app.daily.busy = true;
  Sess.submitDaily(name, s.state.cfg.date, s.envelope()).then((body) => {
    app.daily.status = T("Saved — rank #{rank} on this device ({score} pts).", { rank: body.rank, score: body.score });
    announce(app.daily.status);
  }, (e: unknown) => {
    app.daily.status = T("Could not save ({error}).", { error: e instanceof Error ? e.message : String(e) });
  }).finally(() => { app.daily.busy = false; });
}
export function copyReplay(): void {
  if (!app.session) return;
  click();
  try { clipboard.writeText(JSON.stringify(app.session.envelope())); toast(T("Replay copied.")); }
  catch { toast(T("Select the replay text to copy.")); }
}

function lessonComplete(): void {
  const s = app.session!;
  app.phase = "results";
  app.inputLocked = true;
  const lesson = s.lesson!;
  progress().completed[lesson.id] = true;
  platform.saveProgress();
  audio.cue("win");
  s.clearSnapshot();
  app.resultsLesson = lesson;
  app.lb = null;
  announce(T("Lesson complete: {title}", { title: T(lesson.title) }));
  openResults();
}
export function hasNext(): boolean {
  if (app.currentList === "journey") return app.currentIdx < Content.JOURNEY.length - 1;
  if (app.currentList === "learn" && app.resultsLesson) return app.currentIdx < Content.tutorialLessons().length - 1;
  return false;
}
export function resultsNext(): void {
  click();
  if (app.currentList === "journey") startJourney(app.currentIdx + 1);
  else if (app.currentList === "learn") startLesson(app.currentIdx + 1);
}
export function resultsMenu(): void {
  click();
  app.overlay = null;
  app.session = null;
  audio.stopMusic();
  audio.stopAmbience();
  render.clear();
  goHome();
}

// ------------------------------------------------------------------ pause
function openPause(announceIt: boolean): void {
  app.overlay = "pause";
  app.openedFrame = frame().frame;
  app.focusNext = "btn-resume-round";
  ui.setFocus(null);
  audio.setSuspended(true);
  if (announceIt) announce(app.session && app.session.kind !== "tutorial" ? T("Paused. Round saved locally.") : T("Paused."));
}
export function pauseRound(): void {
  if (!app.session || app.screen !== "game" || app.overlay) return;
  if (app.phase !== "active" && app.phase !== "resolving") return;
  app.phase = "paused";
  // Lessons are short and restartable: pausing them saves no snapshot (it would lack its lesson).
  if (app.session.kind !== "tutorial") app.session.saveSnapshot();
  openPause(true);
}
export function resumeRound(): void {
  if (app.phase !== "paused") return;
  app.overlay = null;
  app.openedFrame = frame().frame;
  ui.setFocus(null);
  app.phase = app.resolve ? "resolving" : "active";
  audio.setSuspended(false);
  announce(T("Resumed."));
}
export function leaveRound(): void {
  click();
  app.overlay = null;
  const s = app.session;
  if (s && !s.state.terminal && s.kind !== "tutorial") s.saveSnapshot();
  else if (s) s.clearSnapshot();
  app.session = null;
  app.resolve = null;
  audio.stopMusic();
  audio.stopAmbience();
  render.clear();
  goHome();
}
export function resumeSnapshot(): void {
  click();
  const s = Sess.Session.loadSnapshot();
  if (!s) { toast(T("No saved round.")); return; }
  audio.setSuspended(false);
  app.session = s;
  app.overlay = null;
  app.resolve = null;
  app.resultsLesson = null;
  app.lb = null;
  app.currentList = (["journey", "practice", "challenge", "daily", "score"].includes(s.kind) ? s.kind : null) as ListName | null;
  app.currentIdx = s.kind === "journey" ? Math.max(0, Content.JOURNEY.findIndex((l) => l.id === s.cfg.id)) : 0;
  show("game");
  app.phase = "preparing";
  applyTheme(s.cfg);
  render.syncToState(s.state);
  app.focus = { r: 0, c: 0 };
  app.lesson = null;
  app.timeWarned = false;
  app.inputLocked = true;
  audio.startAmbience();
  audio.startMusic(0);
  runCountdown(() => {
    s.startPerf = Sess.Session.now() - s.state.elapsedMs;
    app.phase = "active";
    app.inputLocked = false;
    announce(T("Round resumed.") + " " + legalSummary());
    setFocus(0, 0);
  });
}

// ------------------------------------------------------------------ commands
export function doHint(): void {
  if (!app.session || app.phase !== "active" || app.overlay) return;
  const st = app.session.state;
  if (!st.cfg.mechanics?.hint) { toast(T("Hints are disabled in this mode.")); return; }
  const h = app.session.hint();
  if (!h) return;
  audio.cue("hint");
  setFocus(h.r, h.c);
  render.setHintCell(h.r, h.c);
  const why = ({
    "make-bomb": T("This group forges a bomb."), "make-rocket": T("This group forges a rocket."), chain: T("Firing this special starts a chain."),
    goal: T("This group fills a goal color."), biggest: T("This is the biggest group."), fire: T("Fire this special."),
  } as Record<string, string>)[h.why] ?? T("Try here.");
  announce(T("Hint: row {r} column {c}. {why}", { r: h.r + 1, c: h.c + 1, why }));
  toast(T("Hint: {why}", { why }));
}
export function doUndo(): void {
  if (!app.session || app.phase !== "active" || app.overlay) return;
  if (!app.session.canUndo()) { toast(T("Nothing to undo.")); return; }
  app.session.undo();
  audio.cue("undo");
  render.syncToState(app.session.state);
  render.setHintCell(null);
  previewAt(app.focus.r, app.focus.c);
  announce(T("Move undone. Score {score}.", { score: Rules.currentScore(app.session.state) }));
  // Lesson goals can be met by undoing (the "Second chances" lesson).
  if (app.session.lesson && app.session.lessonGoalMet()) lessonComplete();
}
export function resetCamera(): void { render.resetCamera(); announce(T("Camera reset.")); }

// ------------------------------------------------------------------ settings and progress
export function replayTutorial(): void {
  click();
  const p = progress();
  for (const l of Content.tutorialLessons()) delete p.completed[l.id];
  platform.saveProgress();
  app.returnTo = "title";
  show("learn", "lesson-0");
  toast(T("Tutorial reset. Lesson 1 is ready."));
}
export function resetProgress(): void {
  click();
  Sess.Session.clearSnapshot();
  for (const k of [Sess.LS.achievements, Sess.LS.dailyBest]) { try { (globalThis as unknown as { localStorage: { removeItem(k: string): void } }).localStorage.removeItem(k); } catch { /* gone */ } }
  platform.resetProgress();
  app.confirmReset = false;
  toast(T("Progress reset."));
}
export function copyInvite(): void {
  click();
  const link = platform.inviteLink();
  if (!link) return;
  try { clipboard.writeText(link); toast(T("Invite link copied to the clipboard.")); }
  catch { toast(T("Could not copy — invite link: {link}", { link }), 6, link); }
}
export function signIn(): void { void requestSignIn().catch(() => undefined); }

/** High contrast or the theme changed: the studio and the cubes take the new colours. */
function refreshTheme(): void { if (app.session) applyTheme(app.session.cfg); }
platform.onSettingsChange(refreshTheme);
platform.onProgressMerged(() => toast(T("progress synced")));
onLocaleChange(() => undefined);

// ------------------------------------------------------------------ input
function moveFocus(dr: number, dc: number): void {
  const st = app.session!.state;
  const rows = st.grid.length, cols = st.grid[0] ? st.grid[0].length : 0;
  setFocus(Math.min(rows - 1, Math.max(0, app.focus.r + dr)), Math.min(cols - 1, Math.max(0, app.focus.c + dc)));
  audio.cue("select");
  const cell = st.grid[app.focus.r]![app.focus.c];
  if (cell) {
    const color = T(colorLabel(cell.c).label);
    announce(cell.s
      ? T("Row {r} column {c}, {color} special", { r: app.focus.r + 1, c: app.focus.c + 1, color })
      : T("Row {r} column {c}, {color}, group of {n}", { r: app.focus.r + 1, c: app.focus.c + 1, color, n: Rules.groupAt(st, app.focus.r, app.focus.c).length }));
  }
}
onAction((e) => {
  if (!e.pressed) return;
  const fresh = frame().frame !== app.openedFrame;
  if (app.screen !== "game") {
    // Escape on a list screen goes back, as its Back button (dialog-less pages).
    if (e.action === "pause" && fresh && app.screen !== "title" && !ui.capturingKeys()) back();
    return;
  }
  if (app.overlay) return; // the pause and results dialogs take their own keys
  if (!app.session) return;
  if (e.action === "pause") { if (fresh) pauseRound(); return; }
  if (app.phase !== "active") return;
  switch (e.action) {
    case "up": ui.setFocus(null); moveFocus(-1, 0); break;
    case "down": ui.setFocus(null); moveFocus(1, 0); break;
    case "left": ui.setFocus(null); moveFocus(0, -1); break;
    case "right": ui.setFocus(null); moveFocus(0, 1); break;
    case "pop":
      if (ui.focused()) break; // a focused tray button acts by itself
      tryPop(app.focus.r, app.focus.c);
      break;
    case "hint": doHint(); break;
    case "undo": doUndo(); break;
    case "camera": resetCamera(); break;
  }
});

// Wall taps pop a group (short and stationary: within 12 px and 600 ms); a longer drag orbits the camera.
let down: { x: number; y: number; at: number; lastX: number; lastY: number; dragging: boolean } | null = null;
let lastTouch = -1e9;
function boardDown(x: number, y: number): void {
  down = inPlayfield(x, y) && !app.overlay && !ui.pointerOver() ? { x, y, at: now(), lastX: x, lastY: y, dragging: false } : null;
}
function inPlayfield(x: number, y: number): boolean {
  const v = render.playfield();
  return app.screen === "game" && !!app.session && x >= v.x && y >= v.y && x <= v.x + v.w && y <= v.y + v.h;
}
function boardMove(x: number, y: number): void {
  if (down) {
    if (!down.dragging && Math.hypot(x - down.x, y - down.y) > 12 * frame().scale) down.dragging = true;
    if (down.dragging) { render.orbitBy(x - down.lastX, y - down.lastY, frame().scale); down.lastX = x; down.lastY = y; return; }
  }
  if (!canAct() || ui.pointerOver()) { if (app.hoverCell) { app.hoverCell = null; previewAt(app.focus.r, app.focus.c); } return; }
  const cell = render.pick(x, y);
  const same = cell && app.hoverCell && cell.r === app.hoverCell.r && cell.c === app.hoverCell.c;
  if (same) return;
  app.hoverCell = cell;
  if (cell) previewAt(cell.r, cell.c);
  else render.setHoverGroup([]);
}
function boardUp(x: number, y: number): void {
  const d = down;
  down = null;
  if (!d || d.dragging || now() - d.at > 0.6 || !canAct()) return;
  const cell = render.pick(x, y);
  if (cell) { ui.setFocus(null); app.focus = cell; render.setFocusCell(cell.r, cell.c); tryPop(cell.r, cell.c); }
}
onPointerButton((e) => {
  if (e.button !== 0 || now() - lastTouch < 0.6) return;
  if (e.pressed) boardDown(e.x, e.y); else boardUp(e.x, e.y);
});
onPointerMove((x, y) => { if (now() - lastTouch >= 0.6) boardMove(x, y); });
onTouch((e) => {
  if (!e.primary || e.control) return;
  lastTouch = now();
  if (e.phase === "start") boardDown(e.x, e.y);
  else if (e.phase === "move") boardMove(e.x, e.y);
  else if (e.phase === "end") boardUp(e.x, e.y);
  else down = null;
});

// ------------------------------------------------------------------ boot and lifecycle
let lookKey = "";
function applyLook(): void {
  const f = frame();
  const k = `${f.quality}:${f.levelIndex}`;
  if (k === lookKey) return;
  lookKey = k;
  render.applyLook(lookFor(f.quality, f.levelIndex));
}
let hcWas: boolean | null = null;

onStart(() => {
  setFixedRate(60);
  initStyles();
  platform.initPlatform();
  audio.loadSfx();
  audio.setOnCaption((key, vars) => {
    if (!settings.captions) return;
    app.caption = { text: T(key, vars), until: now() + 1.8 };
  });
  render.setReducedMotion(preferences().reducedMotion);
  applyLook();
  render.setActive(false);
  goHome();
});
onPreferencesChange((p) => render.setReducedMotion(p.reducedMotion));
onSessionEnded(() => toast(T("cloud sync unavailable")));
let hidden = false;
onSuspend(() => { hidden = true; if (app.phase === "active" || app.phase === "resolving") pauseRound(); audio.setSuspended(true); platform.flush(); });
onResume(() => { hidden = false; if (app.phase !== "paused") audio.setSuspended(false); });

onFixedUpdate(() => {
  if (hidden || app.phase === "paused") return;
  if (app.countdown) {
    app.countdown.left -= STEP_MS;
    if (app.countdown.left <= 0) {
      app.countdown.i++;
      if (app.countdown.i < COUNT.length) countdownStep();
      else { app.countdown = null; const d = countdownDone; countdownDone = null; d?.(); }
    }
    return;
  }
  if (!app.session || app.screen !== "game") return;
  render.tick(STEP_MS);
  if (app.phase === "active" || app.phase === "resolving") steps++;
  if (app.resolve) {
    app.resolve.left -= STEP_MS;
    if (app.resolve.left <= 0) { const r = app.resolve; app.resolve = null; r.done(); }
  }
  updateClock();
});
/** Time-limited rounds: the 15-second warning, and the end when time is up (js/ui.js updateClock). */
function updateClock(): void {
  const s = app.session!;
  const st = s.state;
  if (!st.cfg.timeLimitSec || st.terminal || (app.phase !== "active" && app.phase !== "resolving")) return;
  const remain = Math.max(0, st.cfg.timeLimitSec * 1000 - s.elapsed());
  if (remain < 15000 && remain > 0 && !app.timeWarned && app.phase === "active") {
    app.timeWarned = true;
    audio.cue("timeWarning");
    announce(T("15 seconds left."));
  }
  if (remain <= 0 && app.phase === "active") {
    const res = s.tickClock();
    if (res && res.ok && res.state.terminal) endRound();
  }
}
/** Seconds left in a time-limited round (null without a limit). */
export function timeLeft(): number | null {
  const s = app.session;
  if (!s || !s.state.cfg.timeLimitSec) return null;
  if (app.phase === "preparing" || app.phase === "countdown") return s.state.cfg.timeLimitSec - s.state.elapsedMs / 1000;
  return Math.max(0, s.state.cfg.timeLimitSec * 1000 - s.elapsed()) / 1000;
}

let frameDt = 0;
onUpdate((dt) => {
  frameDt = dt;
  applyLook();
  audio.update();
  const hc = highContrast();
  applyContrast(hc);
  if (hcWas !== null && hcWas !== hc) refreshTheme();
  hcWas = hc;
  const t = now();
  if (app.toast && app.toast.until < t) app.toast = null;
  if (app.caption && app.caption.until < t) app.caption = null;
});
onRender(() => {
  drawScreens();
  render.update(frameDt);
});
