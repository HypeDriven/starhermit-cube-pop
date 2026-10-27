// The browser build's DOM shell (index.html + js/ui.js + css/style.css) as
// starhermit:ui, built every frame: the top bar (title, the platform clock
// and the account / sync line), the title (key art over the cube mosaic,
// Play, Resume saved round, the nine mode buttons, sign-in / invite, the
// progress line), the list screens (Journey, Practice, Challenge, Learn as
// card grids; the Daily Challenge with this device's board; Score Chase with
// the best runs; Achievements; Settings; Help with the controls table), the
// round (Goals rail with the lesson box, the playfield the studio is framed
// into, the round-status rail, the action tray), the 3-2-1-Pop! countdown,
// the pause and results dialogs, the toast and the captions. The browser's
// media queries are layouts picked by the window's logical size: wide
// (≥ 1024 px: rails beside the wall), compact (narrower: the goals above the
// wall, the stats under it), short landscape (≤ 500 px tall: a narrow goals
// rail, the stats floating over the wall's corner); the left-handed setting
// reverses the tray.
import { frame, openMenu } from "starhermit:engine";
import { bindingLabel, requestRebind } from "starhermit:input";
import * as draw from "starhermit:draw";
import * as ui from "starhermit:ui";
import { TextureLoader, type Texture } from "starhermit:scene";
import { Content, RNG, Rules, Sess, type DailyEntry } from "./classic.ts";
import { T, currentLocale } from "./i18n.ts";
import { icon } from "./glyphs.ts";
import * as platform from "./platform.ts";
import * as render from "./render.ts";
import {
  app, back, cellLabel, click, colorHex, colorLabel, copyInvite, copyReplay, countdownText, dailyCfg, doHint, doUndo, goHome,
  hasNext, highContrast, leaderboardLine, leaveRound, openPage, pauseRound, play, progress, replayTutorial, resetCamera, resetProgress,
  restartRound, resultReason, resultsMenu, resultsNext, resumeRound, resumeSnapshot, settings, show, signIn, startDaily, startJourney,
  startLesson, startList, startScore, submitDailyScore, themeUnlocked, timeLeft, type Screen,
} from "./main.ts";
import { ink } from "./style.ts";

// ------------------------------------------------------------------ layout
interface Layout { lw: number; lh: number; sc: number; ox: number; oy: number; wide: boolean; phone: boolean; shortLand: boolean }
function layoutNow(): Layout {
  const f = frame();
  const sc = ui.preferences().scale;
  const sa = f.safeArea;
  const lw = Math.max(1, (f.width - sa.left - sa.right) / sc), lh = Math.max(1, (f.height - sa.top - sa.bottom) / sc);
  const shortLand = lw > lh && lh <= 500;
  return { lw, lh, sc, ox: sa.left / sc, oy: sa.top / sc, wide: !shortLand && lw >= 1024, phone: lw < 600, shortLand };
}
const lastHeight = new Map<string, number>();
const pr = (): ui.UiPreferences => ui.preferences();
function textWidth(text: string, style: string | readonly string[], kind?: "button" | "heading"): number {
  return ui.measureText(text, { ...(kind ? { kind } : {}), style: typeof style === "string" ? style : [...style] }).width / pr().scale;
}
const buttonWidth = (text: string, style: readonly string[]): number => textWidth(text, style, "button") + 4;

interface Btn { id: string; text: string; style?: string[]; disabled?: boolean; act: () => void; width?: number }
const PLAIN = ["btn"];
/** A button `width` wide (null: its text's); a label too long for it wraps inside. */
function button(b: Btn, width: number | null = null): void {
  const style = b.style ?? PLAIN;
  const opts: ui.ButtonOptions = {};
  if (b.disabled) opts.disabled = true;
  const s: ui.Style = width != null ? { width } : {};
  if (width != null && buttonWidth(b.text, style) > width) {
    const inner = Math.max(20, width - 40);
    opts.content = () => { ui.style({ text: { align: "center" } }).paragraph(b.text, inner); };
  }
  if (ui.style(...style, s).id(b.id).button(b.text, opts)) b.act();
}
/** Buttons at their own widths in rows that wrap at `width` (CSS flex-wrap). */
function flow(label: string, list: Btn[], width: number, align: "start" | "center" | "end" = "center", gap = 8): void {
  const rows: Btn[][] = [[]];
  let used = 0;
  for (const b of list) {
    const bw = Math.min(width, b.width ?? buttonWidth(b.text, b.style ?? PLAIN));
    if (rows[rows.length - 1]!.length && used + gap + bw > width) { rows.push([]); used = 0; }
    used += (rows[rows.length - 1]!.length ? gap : 0) + bw;
    rows[rows.length - 1]!.push(b);
  }
  ui.column(label, () => {
    rows.forEach((row, ri) => ui.row(`${label}-r${ri}`, () => {
      for (const b of row) button(b, b.width ?? (buttonWidth(b.text, b.style ?? PLAIN) > width ? width : null));
    }, { spacing: gap, align: "center" }));
  }, { spacing: gap, align, width });
}
/** Text up to `width` wide: one label when it fits, else a paragraph. */
function para(text: string, width: number, cls = "body", id?: string, center = false): void {
  if (!text) return;
  const styles: (string | ui.Style)[] = [cls];
  if (center) styles.push({ text: { align: "center" } });
  let u = ui.style(...styles);
  if (id) u = u.id(id);
  if (ui.measureText(text, { style: styles }).width / pr().scale <= width) u.label(text);
  else u.paragraph(text, width);
}
function heading(cls: string, text: string, width: number, id?: string): void {
  if (ui.measureText(text, { kind: "heading", style: [cls] }).width / pr().scale <= width) (id ? ui.id(id) : ui).style(cls).heading(text);
  else ui.style(cls).paragraph(text, width);
}
const ARROWS: Record<string, string> = { "Arrow Left": "←", "Arrow Right": "→", "Arrow Up": "↑", "Arrow Down": "↓" };
function kbd(action: string): string { const l = bindingLabel(action, "keyboard"); return ARROWS[l] ?? l; }
const hexCss = (n: number): string => "#" + n.toString(16).padStart(6, "0");
const starsText = (n: number): string => "★".repeat(n) + "☆".repeat(Math.max(0, 3 - n));

// ------------------------------------------------------------------ art
let keyart: Texture | null = null;
let banner: Texture | null = null;
let artAsked = false;
function loadArt(): void {
  if (artAsked) return;
  artAsked = true;
  const loader = new TextureLoader();
  // Decorative: a missing file just leaves the art out (the mosaic shows through).
  loader.loadAsync("assets/title-keyart.webp").then((t) => { keyart = t; }, () => undefined);
  loader.loadAsync("assets/results-banner.webp").then((t) => { banner = t; }, () => undefined);
}
/** Draws a texture cover-fitted into a window rect (CSS object-fit: cover). */
function cover(tex: Texture, x: number, y: number, w: number, h: number, radius: number, mask = ink(highContrast()).bg): void {
  const tw = tex.width || 1280, th = tex.height || 720;
  const k = Math.max(w / tw, h / th);
  const sw = w / k, sh = h / k;
  draw.image(tex, x, y, w, h, { source: { x: (tw - sw) / 2, y: (th - sh) / 2, width: sw, height: sh } });
  if (radius > 0) roundCorners(x, y, w, h, radius, mask);
}

/** The title hero: the soft cube mosaic of js/ui.js drawTitleHero (in the theme's wall colour), the key art over it. */
function hero(w: number, h: number): void {
  ui.widget("", {
    role: "none", size: { width: w, height: h },
    draw: (r, s) => {
      const k = s.scale;
      const theme = Content.THEMES.find((t) => t.id === settings.theme) ?? Content.THEMES[0]!;
      draw.roundRect(r.x, r.y, r.width, r.height, 12 * k, hexCss(theme.palette.wall));
      if (!keyart) {
        const rng = RNG.derive(0xcbf29ce4, RNG.STREAM_DECOR);
        const size = 44 * k, gap = 12 * k, step = size + gap;
        const cols = Math.ceil(r.width / step) + 1, rows = Math.ceil(r.height / step) + 1;
        const clip = { x: r.x, y: r.y, width: r.width, height: r.height };
        for (let row = 0; row < rows; row++) for (let c = 0; c < cols; c++) {
          const ci = rng.int(Content.COLORS.length);
          const def = Content.COLORS[ci]!;
          const x = r.x + c * step + (row % 2 ? step / 2 : 0) - step / 2, y = r.y + row * step - step / 2;
          if (x > r.x + r.width || y > r.y + r.height || x + size < r.x || y + size < r.y) continue;
          if (x < r.x || y < r.y || x + size > r.x + r.width || y + size > r.y + r.height) continue;
          draw.roundRect(x, y, size, size, size * 0.22, hexCss(def.color) + "d9", { clip });
          icon(ci, x + size / 2, y + size / 2 + k, size * 0.2, "#fff6e8e6", hexCss(def.color));
        }
      } else cover(keyart, r.x, r.y, r.width, r.height, 12 * k);
    },
  });
}

// ------------------------------------------------------------------ the frame
export function drawScreens(): void {
  loadArt();
  const L = layoutNow();
  const f = frame();
  const P = ink(highContrast());
  if (app.screen !== "game") draw.rect(0, 0, f.width, f.height, P.bg);
  const top = topbar(L);
  switch (app.screen) {
    case "title": titleScreen(L, top); break;
    case "game": gameScreen(L, top); break;
    default: listScreen(app.screen, L, top);
  }
  overlays(L);
  toasts(L);
  if (app.focusNext) {
    const age = f.frame - app.openedFrame;
    if (age >= 1) ui.setFocus(app.focusNext);
    if (age >= 3) app.focusNext = null;
  }
}

function topbar(L: Layout): number {
  const st = platform.syncState();
  const net = st === "offline" ? T("offline-capable")
    : T("Playing as {name}", { name: platform.displayName() || "…" }) + " · " + (st === "synced" ? T("progress synced") : st === "saving" ? T("saving…") : T("cloud sync unavailable"));
  const d = new Date(platform.nowMs());
  const clock = "UTC " + d.toISOString().slice(0, 16).replace("T", " ");
  const r = ui.place("topbar", { anchor: "top-start", x: 0, y: 0 }, () => ui.row("topbar-row", () => {
    ui.style("game-title").id("game-title").label("Cube Pop");
    ui.spacer();
    const room = L.lw - 24 - textWidth("Cube Pop", "game-title") - 16;
    const both = textWidth(clock, "status") + 12 + textWidth("● " + net, "status") + 8;
    if (both <= room) ui.style("status").id("status-clock").label(clock);
    ui.row("net", () => {
      ui.style(st === "offline" ? "net-off" : "net-on").label("●");
      para(net, Math.max(60, Math.min(room - 20, textWidth(net, "status") + 2)), "status", "status-net");
    }, { spacing: 4, align: "center" });
  }, { width: L.lw - 24, align: "center", spacing: 12 }), { style: "topbar", width: L.lw });
  return r.height / L.sc;
}

/** A page under the top bar: a centred column `maxW` wide, scrolling when taller than the window. */
function page(key: string, L: Layout, top: number, maxW: number, build: (w: number) => void): void {
  const avail = Math.max(80, L.lh - top);
  const pad = 16;
  const pw = Math.min(maxW, L.lw - 2 * pad);
  const h = lastHeight.get(key) ?? 0;
  const scroll = h > avail;
  ui.place(`page-${key}`, { anchor: "top-start", x: 0, y: top }, () => {
    const body = (): void => {
      const r = ui.column(`${key}-col`, () => build(pw - (scroll ? 12 : 0)), { width: pw, spacing: 10, padding: { top: pad, bottom: pad } });
      lastHeight.set(key, r.height / L.sc);
    };
    const fresh = frame().frame - app.openedFrame <= 5;
    if (scroll) ui.scrollArea(`${key}-scroll`, { width: L.lw, height: avail }, () => ui.column(`${key}-sc`, body, { width: L.lw - 12, align: "center" }), fresh ? { scrollTo: { top: 0 } } : undefined);
    else ui.column(`${key}-center`, body, { width: L.lw, align: "center", ...(key === "title" ? { height: avail, justify: "start" as const } : {}) });
  }, { width: L.lw });
}

// ------------------------------------------------------------------ title
function titleScreen(L: Layout, top: number): void {
  const p = progress();
  page("title", L, top, 900, (w) => {
    const stacked = w < 600;
    const gap = 24;
    const heroW = stacked ? w : Math.floor((w - gap) * 0.4);
    const menuW = stacked ? w : w - gap - heroW;
    const menu = (): void => {
      ui.column("title-menu", () => {
        const next = Content.JOURNEY.find((l, i) => !p.completed[l.id] && (i === 0 || p.completed[Content.JOURNEY[i - 1]!.id]));
        const label = next ? T("Play: {name}", { name: T(next.name) }) : T("Play: Journey");
        flow("title-play", [{ id: "btn-play", text: label, style: ["btn", "btn-primary", "btn-big"], act: play }], menuW, "start");
        if (Sess.Session.loadSnapshot()) flow("title-resume", [{ id: "btn-resume", text: T("Resume saved round"), act: resumeSnapshot }], menuW, "start");
        const modes: [Screen, string][] = [
          ["journey", T("Journey")], ["daily", T("Daily Challenge")], ["practice", T("Practice")], ["challenge", T("Challenge")],
          ["score", T("Score Chase")], ["learn", T("Learn")], ["achievements", T("Achievements")], ["settings", T("Settings")], ["help", T("Help")],
        ];
        const g = 8;
        const cols = Math.max(1, Math.min(3, Math.floor((menuW + g) / (140 + g))));
        const bw = (menuW - g * (cols - 1)) / cols;
        ui.column("title-grid", () => {
          for (let i = 0; i < modes.length; i += cols) {
            ui.row(`tg-${i}`, () => {
              for (const [scr, text] of modes.slice(i, i + cols)) {
                button({
                  id: `go-${scr}`, text, style: ["btn", "btn-grid"],
                  act: () => { if (scr === "settings" || scr === "help") openPage(scr); else { click(); show(scr, null); } },
                }, bw);
              }
            }, { spacing: g, align: "stretch" });
          }
        }, { spacing: g, width: menuW });
        const plat: Btn[] = [];
        if (!platform.signedIn()) plat.push({ id: "btn-signin", text: T("Sign in with StarHermit"), act: signIn });
        if (platform.inviteLink()) plat.push({ id: "btn-invite", text: T("Invite a friend"), act: copyInvite });
        if (plat.length) flow("title-platform", plat, menuW, "center");
        const journeyDone = Content.JOURNEY.filter((l) => p.completed[l.id]).length;
        para(T("Journey {done}/{total} · {stars} stars · {ach}/{achTotal} achievements", {
          done: journeyDone, total: Content.JOURNEY.length, stars: Sess.totalStars(p),
          ach: Object.keys(Sess.loadAchievements()).length, achTotal: Content.ACHIEVEMENTS.length,
        }), menuW, "muted", "title-progress");
      }, { spacing: 10, width: menuW });
    };
    if (stacked) ui.column("title-stack", () => { hero(w, Math.min(220, w * 0.56)); menu(); }, { spacing: 16, width: w });
    else ui.row("title-row", () => { hero(heroW, 260); menu(); }, { spacing: gap, align: "start", width: w });
  });
}

// ------------------------------------------------------------------ list screens
interface CardSpec { id: string; name: string; meta: string; stars?: number; locked?: boolean; mastery?: boolean; done?: boolean; intro?: string; act: () => void }
function cfgMeta(cfg: { moveLimit: number; timeLimitSec: number; endless: unknown; board: { rows: number; cols: number }; colors: number }): string {
  const meta: string[] = [];
  if (cfg.moveLimit) meta.push(T("{n} moves", { n: cfg.moveLimit }));
  if (cfg.timeLimitSec) meta.push(cfg.timeLimitSec + "s");
  if (cfg.endless) meta.push(T("endless"));
  meta.push(cfg.board.rows + "×" + cfg.board.cols);
  meta.push(T("{n} colors", { n: cfg.colors }));
  return meta.join(" · ");
}
/** The level cards in rows (CSS grid auto-fill minmax(220px, 1fr)), each row as tall as its tallest card. */
function cardGrid(id: string, cards: CardSpec[], w: number): void {
  const gap = 10;
  const cols = Math.max(1, Math.floor((w + gap) / (220 + gap)));
  const cw = (w - gap * (cols - 1)) / cols;
  const inner = cw - 30;
  ui.column(id, () => {
    for (let i = 0; i < cards.length; i += cols) {
      ui.row(`${id}-r${i}`, () => {
        for (const c of cards.slice(i, i + cols)) {
          const label = [c.name, c.meta, c.stars ? starsText(c.stars) : "", c.locked ? T("Finish the previous stage to unlock.") : "", c.intro ?? ""].filter(Boolean).join(". ");
          if (ui.style(c.mastery ? "level-mastery" : "level-card", { width: cw }).id(c.id).button(label, {
            disabled: !!c.locked,
            content: () => ui.column(`${c.id}-face`, () => {
              para(c.name, inner, "card-name");
              para(c.meta, inner, "card-meta");
              if (c.stars) ui.style("stars").label(starsText(c.stars));
              if (c.done) ui.style("stars").label("✓ " + T("done"));
              if (c.locked) para(T("Finish the previous stage to unlock."), inner, "card-meta");
              if (c.intro) para(c.intro, inner, "card-meta");
            }, { spacing: 4, align: "start", width: inner }),
          })) c.act();
        }
      }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
}
function backButton(w: number): void { flow("back-row", [{ id: "btn-back", text: T("Back"), act: back }], w, "start"); }

function listScreen(screen: Screen, L: Layout, top: number): void {
  const p = progress();
  page(screen, L, top, screen === "help" ? 760 : 640, (w) => {
    switch (screen) {
      case "journey":
        heading("h2", T("Journey"), w, "journey-h");
        para(T("Forty authored stages. Finish a stage to unlock the next; mastery stages test combined mechanics."), w, "muted");
        cardGrid("journey-list", Content.JOURNEY.map((lvl, i) => ({
          id: `stage-${i + 1}`, name: T(lvl.name), meta: cfgMeta(lvl), stars: p.stars[lvl.id] ?? 0, mastery: !!lvl.mastery,
          locked: i > 0 && !p.completed[Content.JOURNEY[i - 1]!.id], intro: lvl.intro ? T(lvl.intro) : "",
          act: () => { click(); startJourney(i); },
        })), w);
        break;
      case "practice":
        heading("h2", T("Practice"), w, "practice-h");
        para(T("Unranked. Undo and hints allowed. No effect on ratings."), w, "muted");
        cardGrid("practice-list", Content.PRACTICE.map((cfg, i) => ({ id: `practice-${i}`, name: T(cfg.name), meta: cfgMeta(cfg), intro: cfg.intro ? T(cfg.intro) : "", act: () => { click(); startList("practice", i); } })), w);
        break;
      case "challenge":
        heading("h2", T("Challenges"), w, "challenge-h");
        para(T("Constrained goals: move limits, speed targets, restricted tools."), w, "muted");
        cardGrid("challenge-list", Content.CHALLENGES.map((cfg, i) => ({
          id: `challenge-${i}`, name: T(cfg.name), meta: cfgMeta(cfg), stars: p.stars[cfg.id] ?? 0, intro: cfg.intro ? T(cfg.intro) : "",
          act: () => { click(); startList("challenge", i); },
        })), w);
        break;
      case "learn": {
        heading("h2", T("Learn"), w, "learn-h");
        para(T("Interactive lessons. Each one asks you to perform the rule yourself."), w, "muted");
        const lessons = Content.tutorialLessons();
        cardGrid("learn-list", lessons.map((l, i) => ({
          id: `lesson-${i}`, name: `${i + 1}. ${T(l.title)}`, meta: cfgMeta({ moveLimit: 0, timeLimitSec: 0, endless: null, board: l.cfg.board, colors: l.cfg.colors }),
          locked: i > 0 && !p.completed[lessons[i - 1]!.id], done: !!p.completed[l.id], intro: T(l.text),
          act: () => { click(); startLesson(i); },
        })), w);
        break;
      }
      case "daily": dailyScreen(w); break;
      case "score": scoreScreen(w); break;
      case "achievements": achievementsScreen(w); break;
      case "settings": settingsScreen(w); break;
      case "help": helpScreen(w); break;
      default: break;
    }
    backButton(w);
  });
}

function dailyScreen(w: number): void {
  const cfg = dailyCfg();
  heading("h2", T("Daily Challenge"), w, "daily-h");
  ui.column("daily-info", () => {
    const iw = w - 28;
    para(T("Seed {seed}", { seed: cfg.seed }) + " · " + cfg.board.rows + "×" + cfg.board.cols + " · " + T("{n} colors", { n: cfg.colors }) + " · " +
      (cfg.moveLimit ? T("{n} moves", { n: cfg.moveLimit }) : T("no move limit")) + (cfg.timeLimitSec ? " · " + cfg.timeLimitSec + "s" : ""), iw, "body", "daily-facts");
    const best = Sess.readLS<Record<string, number>>(Sess.LS.dailyBest, {});
    if (best[cfg.date!]) para(T("Your best today: {n} points", { n: best[cfg.date!]! }), iw);
    const nowMs = platform.nowMs();
    const d = new Date(nowMs);
    const msLeft = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - nowMs;
    para(T("New challenge in {h}h {m}m (server-synced).", { h: Math.floor(msLeft / 3600000), m: Math.floor((msLeft % 3600000) / 60000) }), iw, "muted");
  }, { style: "panel", width: w, spacing: 6 });
  flow("daily-play", [{ id: "btn-daily-play", text: T("Play today's challenge"), style: ["btn", "btn-primary"], act: () => { click(); startDaily(); } }], w, "start");
  heading("h3", T("Today's board (this device)"), w);
  const entries = Sess.readLS<Record<string, DailyEntry[]>>(Sess.LS.dailyBoards, {})[cfg.date!] ?? [];
  boardList("daily-board", entries.map((e) => `${e.name} — ` + (e.won ? T("{score} pts ({moves} moves, goals complete)", { score: e.score, moves: e.moves }) : T("{score} pts ({moves} moves)", { score: e.score, moves: e.moves }))),
    T("No scores on this device yet today."), w);
}
function boardList(id: string, lines: string[], empty: string, w: number): void {
  ui.column(id, () => {
    if (!lines.length) para(empty, w - 30, "board-line");
    lines.forEach((l, i) => para(`${i + 1}. ${l}`, w - 30, "board-line", `${id}-${i}`));
  }, { spacing: 6, width: w, padding: { start: 24 } });
}
function scoreScreen(w: number): void {
  heading("h2", T("Score Chase — Endless Wall"), w, "score-h");
  ui.column("score-info", () => para(T(Content.SCORE_CHASE.intro!), w - 28), { style: "panel", width: w });
  flow("score-play", [{ id: "btn-score-play", text: T("Start run"), style: ["btn", "btn-primary"], act: () => { click(); startScore(); } }], w, "start");
  heading("h3", T("Your best runs (local)"), w);
  const best = Sess.readLS<{ score: number; waves: number; at: number }[]>("cubepop:score-best:v1", []);
  let fmt: (ms: number) => string;
  try { const df = new Intl.DateTimeFormat(currentLocale()); fmt = (ms) => df.format(new Date(ms)); } catch { fmt = (ms) => new Date(ms).toISOString().slice(0, 10); }
  boardList("score-best", best.slice(0, 10).map((r) => T("{score} pts · wave {wave}", { score: r.score, wave: r.waves }) + " · " + fmt(r.at)), T("No runs yet."), w);
}
function achievementsScreen(w: number): void {
  heading("h2", T("Achievements"), w, "ach-h");
  const have = Sess.loadAchievements();
  ui.column("ach-list", () => {
    for (const a of Content.ACHIEVEMENTS) {
      const done = !!have[a.key];
      ui.column(`ach-${a.key}`, () => {
        para((done ? "✓ " : "") + T(a.name) + " — " + T(a.desc), w - 10, done ? "ach-desc-done" : "ach-desc");
      }, { style: done ? "ach-done" : "ach-locked", width: w });
    }
  }, { spacing: 0, width: w });
}
function fieldset(id: string, legend: string, w: number, build: (inner: number) => void): void {
  ui.column(id, () => { ui.style("legend").label(legend); build(w - 28); }, { style: "fieldset", width: w, spacing: 8 });
}
function check(key: "captions" | "leftHanded", label: string): void {
  const cur = settings[key];
  const next = ui.id(`set-${key}`).checkbox(label, cur);
  if (next !== cur) platform.setSetting(key, next);
}
function settingsScreen(w: number): void {
  heading("h2", T("Settings"), w, "set-h");
  fieldset("fs-audio", T("Audio"), w, (inner) => {
    para(T("Music, effects and voice volumes and mute are in the StarHermit Options."), inner, "muted");
    flow("audio-opts", [{ id: "btn-options-audio", text: T("Open Options"), act: () => openMenu() }], inner, "start");
    check("captions", T("Show text captions for sounds"));
  });
  fieldset("fs-gfx", T("Graphics"), w, (inner) => {
    para(T("Graphics quality, render scale and frame rate are in the StarHermit Options."), inner, "muted");
    const themes = Content.THEMES;
    const opts: ui.SelectOption[] = themes.map((t) => ({
      text: T(t.name) + (themeUnlocked(t) ? "" : " " + T("(unlock at {n}★)", { n: t.unlockStars })), disabled: !themeUnlocked(t),
    }));
    const cur = Math.max(0, themes.findIndex((t) => t.id === settings.theme && themeUnlocked(t)));
    ui.row("theme-row", () => {
      para(T("Studio theme"), Math.max(80, inner * 0.35), "body");
      ui.spacer();
      const next = ui.style({ width: Math.min(260, inner * 0.6) }).id("set-theme").select(T("Studio theme"), cur, opts);
      if (next !== cur && themeUnlocked(themes[next]!)) platform.setSetting("theme", themes[next]!.id);
    }, { width: inner, align: "center", spacing: 10 });
  });
  fieldset("fs-a11y", T("Accessibility"), w, (inner) => {
    para(T("Reduced motion, high contrast (with the high-contrast cube palette) and text size are in the StarHermit Options."), inner, "muted");
    check("leftHanded", T("Left-handed action tray"));
    flow("a11y-btns", [{ id: "btn-rebind", text: T("Change keys and buttons"), act: () => requestRebind() }], inner, "start");
  });
  fieldset("fs-progress", T("Progress"), w, (inner) => {
    if (!app.confirmReset) {
      flow("progress-btns", [
        { id: "btn-replay-tutorial", text: T("Replay tutorial"), act: replayTutorial },
        { id: "btn-reset-progress", text: T("Reset all progress"), style: ["btn", "btn-danger"], act: () => { click(); app.confirmReset = true; } },
      ], inner, "start");
    } else {
      para(T("Reset journey stars, achievements, and saved rounds?"), inner, "body", "reset-q");
      flow("reset-confirm", [
        { id: "btn-reset-yes", text: T("Reset"), style: ["btn", "btn-danger"], act: resetProgress },
        { id: "btn-reset-no", text: T("Cancel"), act: () => { click(); app.confirmReset = false; } },
      ], inner, "start");
    }
  });
}
function helpScreen(w: number): void {
  heading("h2", T("How to play"), w, "help-h");
  const cards: [string, string][] = [
    [T("Pop groups"), T("Tap a connected group of 2 or more matching cubes to pop them. Popped cubes count toward the goals on the left.")],
    [T("Rockets"), T("A group of 5+ leaves a rocket on the tapped cube. Tap the rocket to clear its whole row or column. Taller groups make column rockets; wider groups make row rockets.")],
    [T("Bombs"), T("A group of 8+ leaves a bomb. Tap it to clear a 3×3 area around it.")],
    [T("Chains"), T("Blasts that touch other specials set them off too. Each extra special in one move earns a chain bonus.")],
    [T("Goals and limits"), T("Fill every color quota to win. Some stages limit your moves or time — unused moves and fast finishes earn bonus points.")],
    [T("No dead ends"), T("If no legal move remains, the wall reshuffles itself for free.")],
    [T("Assists"), T("Where allowed: H shows a hint, U undoes your last pop. Challenges may disable them.")],
  ];
  const gap = 10;
  const cols = Math.max(1, Math.floor((w + gap) / (240 + gap)));
  const cw = (w - gap * (cols - 1)) / cols;
  ui.column("help-cards", () => {
    for (let i = 0; i < cards.length; i += cols) {
      ui.row(`help-r${i}`, () => {
        cards.slice(i, i + cols).forEach(([h, t], j) => ui.column(`help-${i + j}`, () => {
          para(h, cw - 28, "h4");
          para(t, cw - 28, "body");
        }, { style: "help-card", width: cw, spacing: 6 }));
      }, { spacing: gap, align: "stretch" });
    }
  }, { spacing: gap, width: w });
  heading("h3", T("Controls"), w);
  const pad = bindingLabel("pop", "gamepad");
  const rows: [string, string, string][] = [
    [T("Move selection"), ["up", "down", "left", "right"].map(kbd).join(", "), "—"],
    [T("Pop / fire"), kbd("pop") + (pad ? " · " + pad : ""), T("Tap a group")],
    [T("Hint"), kbd("hint"), T("Hint button")],
    [T("Undo"), kbd("undo"), T("Undo button")],
    [T("Pause"), kbd("pause"), T("Pause button")],
    [T("Orbit camera"), T("{keys} (reset)", { keys: kbd("camera") }), T("Drag the board")],
  ];
  const c0 = w * 0.36, c1 = w * 0.32, c2 = w - c0 - c1;
  const row = (id: string, cells: string[], cls: string): void => {
    ui.row(id, () => cells.forEach((c, i) => ui.column(`${id}-${i}`, () => para(c, [c0, c1, c2][i]! - 26, cls), { style: "ctl-cell", width: [c0, c1, c2][i]! })), { spacing: 0, align: "stretch", width: w });
  };
  ui.column("controls-table", () => {
    row("ctl-head", [T("Action"), T("Keyboard"), T("Pointer / touch")], "ctl-head");
    rows.forEach((r, i) => row(`ctl-${i}`, r, "body"));
  }, { spacing: 0, width: w });
}

// ------------------------------------------------------------------ the round
function goalsRail(w: number, inline: boolean): void {
  const st = app.session!.state;
  const goals = (keys: string[]): void => {
    for (const g of keys) {
      const ci = +g, need = st.cfg.goals[g]!, have = st.goals[g] ?? 0;
      const text = T(colorLabel(ci).label) + " " + Math.min(have, need) + " / " + need;
      ui.row(`goal-${g}`, () => {
        ui.widget("", {
          role: "none", size: { width: 22, height: 22 },
          draw: (r, s) => {
            const col = hexCss(colorHex(ci));
            draw.roundRect(r.x, r.y, r.width, r.height, 6 * s.scale, col);
            icon(ci, r.x + r.width / 2, r.y + r.height / 2, 6.5 * s.scale, "#ffffff", col);
          },
        });
        ui.style("goal-text").id(`goal-${g}-text`).label(text);
      }, { style: have >= need ? "goal-done" : "goal-row", spacing: 8, align: "center" });
    }
  };
  if (inline) {
    // Compact layouts: the goals in a wrapping row after the heading (CSS flex-wrap).
    const items = Object.keys(st.cfg.goals).map((g) => 22 + 8 + 8 + textWidth(T(colorLabel(+g).label) + " 00 / 00", "goal-text"));
    const rows: string[][] = [[]];
    let used = textWidth(T("Goals"), "h3") + 14;
    Object.keys(st.cfg.goals).forEach((g, i) => {
      if (used + items[i]! > w && rows[rows.length - 1]!.length) { rows.push([]); used = 0; }
      rows[rows.length - 1]!.push(g);
      used += items[i]! + 4;
    });
    ui.column("goals-inline", () => {
      rows.forEach((row, ri) => ui.row(`goals-r${ri}`, () => {
        if (ri === 0) ui.style("h3").label(T("Goals"));
        goals(row);
      }, { spacing: 10, align: "center" }));
    }, { spacing: 4, width: w });
  } else {
    ui.style("h3").label(T("Goals"));
    ui.column("goal-list", () => goals(Object.keys(st.cfg.goals)), { spacing: 2, width: w });
  }
  lessonBox(w);
}
function lessonBox(w: number): void {
  const lb = app.lesson;
  const s = app.session!;
  if (!lb) return;
  let title: string, text: string;
  if (lb.lesson) { title = T(lb.lesson.title); text = T(lb.lesson.text); }
  else {
    const cfg = s.cfg;
    title = T("How to play");
    text = cfg.intro && /pop/i.test(cfg.intro) ? T(cfg.intro) + " " + T("Bigger groups score more.")
      : T("Tap a group of two or more touching cubes of the same color to pop it. Bigger groups score more.") + " " + (cfg.intro ? T(cfg.intro) : T("Fill every goal to clear the stage."));
  }
  ui.column("lesson-box", () => {
    para(title, w - 24, "h4", "lesson-title");
    para(text, w - 24, "body", "lesson-text");
  }, { style: "lesson-box", width: w, spacing: 4 });
}
function statsRail(w: number, row: boolean): void {
  const st = app.session!.state;
  const stats: [string, string, string, boolean][] = [["score", T("Score"), String(Rules.currentScore(st)), false]];
  if (st.cfg.endless) {
    const left = (st.moveBank ?? 0) - st.moves;
    stats.push(["wave", T("Wave"), String(st.wave), false], ["bank", T("Move bank"), String(left), left <= 3]);
  } else if (st.cfg.moveLimit) {
    const left = st.cfg.moveLimit - st.moves;
    stats.push(["moves", T("Moves"), String(left), left <= 3]);
  } else stats.push(["moves", T("Moves"), String(st.moves), false]);
  const tl = timeLeft();
  if (tl != null) stats.push(["time", T("Time"), Math.ceil(tl) + "s", tl < 15]);
  if (row) {
    ui.row("stats-row", () => {
      for (const [id, k, v, danger] of stats) ui.row(`hud-${id}`, () => { ui.style("stat-dt").label(k); ui.style(danger ? "stat-danger" : "stat-dd").id(`hud-${id}-v`).label(v); }, { spacing: 8, align: "center" });
    }, { spacing: 18, align: "center" });
  } else {
    for (const [id, k, v, danger] of stats) {
      ui.row(`hud-${id}`, () => { ui.style("stat-dt").label(k); ui.spacer(); ui.style(danger ? "stat-danger" : "stat-dd").id(`hud-${id}-v`).label(v); }, { style: "stat-row", width: w, align: "center" });
    }
  }
}
function tray(L: Layout): number {
  const s = app.session!;
  const st = s.state;
  const list: Btn[] = [
    { id: "btn-hint", text: T("Hint"), disabled: !st.cfg.mechanics?.hint || !!st.terminal, act: () => { ui.setFocus(null); doHint(); } },
    { id: "btn-undo", text: T("Undo"), disabled: !s.canUndo(), act: () => { ui.setFocus(null); doUndo(); } },
    { id: "btn-pause", text: T("Pause"), act: () => { ui.setFocus(null); pauseRound(); } },
    { id: "btn-camera", text: T("Camera"), act: () => { ui.setFocus(null); resetCamera(); } },
  ];
  if (settings.leftHanded) list.reverse();
  const r = ui.place("action-tray", { anchor: "bottom-start", x: 0, y: 0 }, () => {
    ui.column("tray-col", () => flow("tray", list, L.lw - 12, "center"), { width: L.lw, align: "center", padding: { top: 6, bottom: 6 } });
  }, { width: L.lw });
  lastHeight.set("tray-h", r.height / L.sc);
  return r.height / L.sc;
}

function gameScreen(L: Layout, top: number): void {
  if (!app.session) { goHome(); return; }
  const f = frame();
  const sc = L.sc;
  const P = ink(highContrast());
  const trayH = tray(L);
  let x0 = 8, x1 = L.lw - 8, y0 = top + 8, y1 = L.lh - trayH;
  const railH = y1 - y0;
  if (L.wide) {
    const lw = 240, rw = 200;
    railPlace("rail-left", x0, y0, lw, railH, true, (w) => goalsRail(w, false));
    ui.place("rail-right", { anchor: "top-start", x: x1 - rw, y: y0 }, () => ui.column("rail-right-col", () => statsRail(rw - 20, false), { style: "rail", width: rw }), { width: rw });
    x0 += lw + 8; x1 -= rw + 8; y1 -= 8;
  } else if (L.shortLand) {
    const lw = Math.max(110, Math.min(140, L.lw * 0.17));
    railPlace("rail-left", x0 - 2, top + 6, lw, L.lh - top - 12, true, (w) => goalsRail(w, false), true);
    x0 += lw + 6;
    y0 = top + 6;
    y1 -= 2;
    const stats = ui.place("rail-right", { anchor: "top-start", x: x1 - (lastHeight.get("stats-w") ?? 200) - 4, y: y0 + 6 }, () =>
      ui.column("rail-right-col", () => statsRail(0, true), { style: "rail-float" }));
    lastHeight.set("stats-w", stats.width / sc);
  } else {
    const w = L.lw - 12;
    const g = ui.place("rail-left", { anchor: "top-start", x: 6, y: top + 6 }, () => ui.column("rail-left-col", () => goalsRail(w - 20, true), { style: "rail", width: w, spacing: 6 }), { width: w });
    y0 = top + 6 + g.height / sc + 6;
    const s = ui.place("rail-right", { anchor: "bottom-start", x: 6, y: trayH + 2 }, () => ui.column("rail-right-col", () => statsRail(w - 20, true), { style: "rail", width: w }), { width: w });
    y1 -= s.height / sc + 8;
    x0 = 0; x1 = L.lw;
  }
  const pw = Math.max(40, x1 - x0), ph = Math.max(40, y1 - y0);
  // The toast and captions sit just above whatever is under the wall, never on its buttons.
  lastHeight.set("toast-bottom", L.lh - y1);
  const X = (L.ox + x0) * sc, Y = (L.oy + y0) * sc, Wd = pw * sc, Hd = ph * sc;
  render.setPlayfield(X, Y, Wd, Hd, f.width, f.height);
  // The page around the playfield (the studio fills the window behind the UI).
  draw.rect(0, 0, f.width, Y, P.bg);
  draw.rect(0, Y + Hd, f.width, f.height - Y - Hd, P.bg);
  draw.rect(0, Y, X, Hd, P.bg);
  draw.rect(X + Wd, Y, f.width - X - Wd, Hd, P.bg);
  // High and Ultra round the view's corners (the browser build's gfx-rounded-view).
  if (f.quality === "high" || f.quality === "ultra") roundCorners(X, Y, Wd, Hd, 12 * sc, P.bg);
  cellTargets();
}
/** A rail panel of fixed height whose content scrolls when taller. */
function railPlace(id: string, x: number, y: number, w: number, h: number, styled: boolean, build: (w: number) => void, tight = false): void {
  const ch = lastHeight.get(id) ?? 0;
  ui.place(id, { anchor: "top-start", x, y }, () => {
    const inner = (): void => {
      const r = ui.column(`${id}-in`, () => build(w - (tight ? 16 : 20) - (ch > h ? 12 : 0)), { spacing: 6 });
      lastHeight.set(id, r.height / ui.preferences().scale + (tight ? 16 : 20));
    };
    ui.column(`${id}-col`, () => {
      if (ch > h) ui.scrollArea(`${id}-scroll`, { width: w - (tight ? 16 : 20), height: h - (tight ? 16 : 20) }, inner);
      else inner();
    }, { style: styled ? "rail" : [], width: w, height: h, ...(tight ? { padding: 8 } : {}) });
  }, { width: w });
}
/** Masks the playfield's square corners into rounded ones (the browser build's border-radius). */
function roundCorners(x: number, y: number, w: number, h: number, r: number, color: string): void {
  const corner = (cx: number, cy: number, px: number, py: number, a0: number): void => {
    const pts: [number, number][] = [[px, py]];
    for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
    draw.polygon(pts, color);
  };
  corner(x + r, y + r, x, y, Math.PI);
  corner(x + w - r, y + r, x + w, y, -Math.PI / 2);
  corner(x + w - r, y + h - r, x + w, y + h, 0);
  corner(x + r, y + h - r, x, y + h, Math.PI / 2);
}
/** Each cube as a named area for screen readers and play scripts (the browser build's board mirror). */
function cellTargets(): void {
  const s = app.session;
  if (!s || app.overlay || app.phase === "countdown") return;
  const st = s.state;
  for (let r = 0; r < st.grid.length; r++) for (let c = 0; c < (st.grid[0]?.length ?? 0); c++) {
    const p = render.cellScreen(r, c);
    if (!p) continue;
    const half = p.size / 2;
    ui.id(`cell-${r}-${c}`).target(cellLabel(r, c), { x: p.x - half, y: p.y - half, width: p.size, height: p.size });
  }
}

// ------------------------------------------------------------------ dialogs
/** A modal card: a scrolling body when taller than the window, a pinned footer (its buttons stay clickable). */
function dialogFrame(label: string, L: Layout, maxW: number, build: (w: number) => void, footer: ((w: number) => void) | null, onClose: () => void): void {
  const w = Math.min(maxW, L.lw - 32) - 40;
  const fh = footer ? (lastHeight.get(`dlg-${label}-foot`) ?? 56) + 12 : 0;
  const avail = Math.max(80, L.lh * 0.9 - 40 - fh);
  const h = lastHeight.get(`dlg-${label}`) ?? 0;
  const body = (): void => {
    const r = ui.column(`${label}-body`, () => build(w), { spacing: 10, width: w });
    lastHeight.set(`dlg-${label}`, r.height / L.sc);
  };
  // A dialog opens at its top (heading visible), whatever it focuses.
  const fresh = frame().frame - app.openedFrame <= 4;
  const open = ui.dialog(label, "", true, () => {
    if (h > avail) ui.scrollArea(`${label}-scroll`, { width: w + 14, height: avail }, body, fresh ? { scrollTo: { top: 0 } } : undefined);
    else body();
    if (footer) {
      const r = ui.column(`${label}-foot`, () => footer(w), { width: w, spacing: 8, padding: { top: 12 } });
      lastHeight.set(`dlg-${label}-foot`, r.height / L.sc - 12);
    }
  });
  // The Escape (or East) that opened it must not close it the same frame.
  if (!open && frame().frame !== app.openedFrame) onClose();
}
function overlays(L: Layout): void {
  if (app.screen !== "game" || !app.session) return;
  const cd = countdownText();
  if (cd) {
    const f = frame();
    draw.rect(0, 0, f.width, f.height, "#3d2f23aa");
    ui.place("countdown", "center", () => ui.style("countdown").id("countdown-num").label(cd));
    return;
  }
  if (app.overlay === "pause") pauseDialog(L);
  else if (app.overlay === "results") resultsDialog(L);
}
function pauseDialog(L: Layout): void {
  dialogFrame(T("Paused"), L, 460, (w) => {
    heading("h3", T("Paused"), w, "pause-h");
    ui.column("pause-col", () => {
      button({ id: "btn-resume-round", text: T("Resume"), style: ["btn", "btn-primary"], act: () => { click(); resumeRound(); } }, w);
      button({ id: "btn-pause-settings", text: T("Settings"), act: () => openPage("settings") }, w);
      button({ id: "btn-pause-help", text: T("Help"), act: () => openPage("help") }, w);
      button({ id: "btn-restart-round", text: T("Restart round"), act: restartRound }, w);
      button({ id: "btn-leave-round", text: T("Leave round"), style: ["btn", "btn-danger"], act: leaveRound }, w);
    }, { spacing: 8, width: w });
  }, null, resumeRound);
}
function resultsDialog(L: Layout): void {
  const s = app.session!;
  const st = s.state;
  const lesson = app.resultsLesson;
  const won = lesson ? true : !!st.terminal?.won;
  dialogFrame(T("Results"), L, 560, (w) => {
    heading("h3", T("Results"), w, "results-h");
    if (won && banner && L.lh > 420) {
      const bh = Math.min(L.phone ? 96 : 150, w * 5 / 16);
      ui.widget("", { role: "none", size: { width: w, height: bh }, draw: (r, sx) => cover(banner!, r.x, r.y, r.width, r.height, 10 * sx.scale, ink(highContrast()).panel) });
    }
    if (lesson) {
      para(T("Lesson complete: {title}", { title: T(lesson.title) }), w, "results-headline", "results-headline");
      return;
    }
    const reason = resultReason(st);
    para(won ? T("You win — {reason}", { reason }) : reason, w, "results-headline", "results-headline");
    const sc = st.score;
    const rows: [string, number][] = [
      [T("Cubes cleared ({n})", { n: sc.cubes }), sc.popPoints],
      [T("Group size bonus"), sc.groupBonus],
      [T("Specials forged ({n})", { n: sc.specialsMade }), sc.specialBonus],
      [T("Chain bonus (best ×{n})", { n: sc.chainsBest }), sc.chainBonus],
      [T("Unused moves"), sc.moveBonus],
      [T("Time under par"), sc.timeBonus],
      [T("Wave bonus ({n})", { n: sc.waves }), sc.waveBonus],
    ];
    ui.column("results-breakdown", () => {
      rows.filter((r) => r[1]).forEach(([k, v], i) => ui.row(`res-${i}`, () => {
        para(k, w - 90, "score-cell");
        ui.spacer();
        ui.style("score-num").label(String(v));
      }, { style: "score-row", width: w, align: "center" }));
      ui.row("res-total", () => {
        ui.style("score-total").label(T("Total"));
        ui.spacer();
        ui.style("score-total").id("results-total").label(String(sc.total));
      }, { style: "score-total-row", width: w, align: "center" });
    }, { spacing: 0, width: w });
    const stars = s.stars();
    if (won && stars) ui.style("stars-big").id("results-stars").label(starsText(stars));
    const lb = leaderboardLine();
    if (lb) para(lb, w, "ach-line", "results-lb");
    if (s.kind === "daily" && st.cfg.date) {
      ui.row("daily-name-row", () => {
        para(T("Display name"), Math.max(80, w * 0.3), "body");
        if (platform.signedIn()) ui.style("body").label(platform.displayName());
        else app.daily.name = ui.textField("daily-name", app.daily.name, { maxChars: 24, width: Math.min(220, w * 0.6) });
      }, { width: w, spacing: 10, align: "center" });
      flow("daily-save", [{ id: "btn-daily-submit", text: T("Save to today's board"), disabled: app.daily.busy, act: submitDailyScore }], w, "start");
      if (app.daily.status) para(app.daily.status, w, "muted", "daily-submit-status");
    }
  }, (w) => {
    const btns: Btn[] = [{ id: "btn-results-retry", text: T("Retry"), act: restartRound }];
    if (hasNext()) btns.push({ id: "btn-results-next", text: T("Next"), style: ["btn", "btn-primary"], act: resultsNext });
    btns.push({ id: "btn-results-menu", text: T("Menu"), act: resultsMenu });
    btns.push({ id: "btn-copy-replay", text: T("Copy replay envelope"), act: copyReplay });
    flow("results-buttons", btns, w, "start");
  }, () => { app.openedFrame = frame().frame; /* the results stay until a choice is made */ });
}

// ------------------------------------------------------------------ toasts and captions
function toasts(L: Layout): void {
  const bottom = app.screen === "game" && app.session ? (lastHeight.get("toast-bottom") ?? 60) : 16;
  let y = bottom + 8;
  if (app.toast) {
    const text = app.toast.text;
    const w = Math.min(L.lw * 0.8, 520);
    const r = ui.place("toast", { anchor: "bottom", y }, () => {
      if (textWidth(text, "toast") + 40 <= w) ui.style("toast").id("toast").label(text);
      else ui.style("toast").id("toast").paragraph(text, w - 36);
    });
    y += r.height / L.sc + 6;
  }
  if (app.caption) {
    const text = app.caption.text;
    ui.place("captions", { anchor: "bottom", y: Math.max(y, bottom + 54) }, () => para(text, Math.min(L.lw - 40, 520), "captions", "caption-text", true));
  }
}
