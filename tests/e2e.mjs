/**
 * Cube Pop — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome), on two viewport passes: desktop 1280x800 and mobile 390x844
 * (touch). Flow per pass:
 *   title → settings (enable reduced motion) → daily screen (offline
 *   fallback note) → Play (journey stage 1 "First Pops") → play the round
 *   for real via arrow keys + Enter (same controls a player uses; the
 *   screen-reader mirror grid and live-region announcements are read only
 *   for targeting/synchronization) → exercise Hint/Undo buttons and
 *   pause/resume overlay → play until the results screen (stage 1 cannot
 *   be lost: no move/time limit, free reshuffles) → back to title with
 *   persisted progress.
 *
 * The game talks to the StarHermit backend only for the daily leaderboard
 * and server clock; this test serves the repo with a minimal embedded
 * static server (no API), which exercises the game's offline-capable path.
 * server.js is the StarHermit authoritative script and is intentionally
 * not used here.
 *
 * Run: npm run test:e2e
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.glb': 'model/gltf-binary',
  '.woff2': 'font/woff2', '.ts': 'video/mp2t', '.txt': 'text/plain'
};

// benign GPU/swiftshader console noise (from tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions|GroupMarkerNotSet|WebGL context lost/i;

function serveStatic() {
  const server = http.createServer((req, res) => {
    let p;
    try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT) || file.includes(path.join(ROOT, 'data')) ||
        !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const shot = (stage, pass) => `/tmp/cube-pop-e2e-${stage}-${pass}.png`;

async function runPass(browser, passName, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    // The game is offline-capable by design: without the StarHermit backend
    // it probes /api/v1/*, gets 404 from our static server, and degrades
    // gracefully. Only resource-load 404s for those probes are benign.
    if (/Failed to load resource/.test(m.text()) && (m.location()?.url || '').includes('/api/v1/')) return;
    errors.push(`console: ${m.text()}`);
  });

  const step = async (name, fn) => {
    await fn();
    console.log(`ok - [${passName}] ${name}`);
  };
  const gameState = () => page.evaluate(() => document.body.dataset.gameState);
  const waitState = (s, timeout = 15000) =>
    page.waitForFunction((want) => document.body.dataset.gameState === want, s, { timeout });
  // Focus tracking: startRound sets focus to (0,0) on activation; we keep
  // it in sync ourselves (hint moves focus, parsed from the live region).
  let focus = { r: 0, c: 0 };
  async function moveFocusTo(r, c) {
    while (focus.r > r) { await page.keyboard.press('ArrowUp'); focus.r--; }
    while (focus.r < r) { await page.keyboard.press('ArrowDown'); focus.r++; }
    while (focus.c > c) { await page.keyboard.press('ArrowLeft'); focus.c--; }
    while (focus.c < c) { await page.keyboard.press('ArrowRight'); focus.c++; }
  }
  // Read the screen-reader mirror grid (DOM state, read-only) to choose moves.
  const readBoard = () => page.$$eval('#board-mirror button', (btns) =>
    btns.map((b) => ({
      r: +b.dataset.r, c: +b.dataset.c,
      disabled: b.disabled, label: b.getAttribute('aria-label') || ''
    })));
  const readGoals = () => page.$$eval('#goal-list li', (lis) =>
    lis.map((li) => ({ text: li.textContent, done: li.classList.contains('done') })));

  try {
    await step('load + title visible', async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
      await page.waitForSelector('#screen-title:not([hidden])', { timeout: 10000 });
      await page.waitForSelector('#btn-play');
      const modules = await page.evaluate(() =>
        !!(window.CPRules && window.CPContent && window.CPSession && window.CPAudio && window.CPUI));
      if (!modules) throw new Error('game modules did not load');
      await page.screenshot({ path: shot('title', passName) });
    });

    await step('settings open/apply/close (reduced motion on)', async () => {
      await page.click('#screen-title [data-goto="settings"]');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.check('#set-reduced-motion');
      const applied = await page.evaluate(() => document.body.classList.contains('reduced-motion'));
      if (!applied) throw new Error('reduced-motion class not applied');
      await page.screenshot({ path: shot('settings', passName) });
      await page.click('#screen-settings [data-goto="title"]');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step('daily screen shows offline fallback (no backend)', async () => {
      await page.click('#screen-title [data-goto="daily"]');
      await page.waitForSelector('#screen-daily:not([hidden])');
      await page.waitForFunction(() =>
        document.getElementById('status-net').textContent === 'offline' ||
        document.getElementById('status-net').textContent === 'online', null, { timeout: 8000 });
      const net = await page.textContent('#status-net');
      if (net !== 'offline') throw new Error(`expected offline status without API, got "${net}"`);
      const note = await page.textContent('#daily-note');
      if (!/offline/i.test(note)) throw new Error('offline note missing: ' + note);
      await page.click('#screen-daily [data-goto="title"]');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step('Play starts journey stage 1, game screen active', async () => {
      const label = await page.textContent('#btn-play');
      if (!/Play: First Pops/.test(label)) throw new Error('unexpected Play label: ' + label);
      await page.click('#btn-play');
      await page.waitForSelector('#screen-game:not([hidden])');
      await waitState('active'); // countdown (skipped under reduced motion)
      focus = { r: 0, c: 0 };
      const board = await readBoard();
      if (board.length !== 36) throw new Error(`expected 6x6 mirror, got ${board.length} cells`);
      await page.screenshot({ path: shot('game', passName) });
    });

    // Pop one group chosen from a fresh mirror read. Returns true if the
    // round ended.
    async function popBestGroup(preferGoals) {
      const board = await readBoard();
      const goals = preferGoals ? await readGoals() : [];
      const needed = new Set(goals.filter((g) => !g.done)
        .map((g) => g.text.replace(/\s*\d+\s*\/\s*\d+\s*$/, '').trim()));
      let best = null;
      for (const cell of board) {
        if (cell.disabled) continue;
        const m = cell.label.match(/^Row \d+ column \d+: ([^,]+), group of (\d+)$/);
        let size, color, special = false;
        if (m) { color = m[1]; size = +m[2]; if (size < 2) continue; }
        else if (/rocket|bomb/.test(cell.label)) { special = true; size = 99; color = ''; }
        else continue;
        const score = (needed.has(color) ? 1000 : 0) + size + (special ? 500 : 0);
        if (!best || score > best.score) best = { r: cell.r, c: cell.c, score };
      }
      if (!best) throw new Error('no legal move found on mirror (expected auto-reshuffle)');
      await moveFocusTo(best.r, best.c);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() =>
        document.body.dataset.gameState === 'active' ||
        !document.getElementById('overlay-results').hidden, null, { timeout: 10000 });
      return page.evaluate(() => !document.getElementById('overlay-results').hidden);
    }

    let pops = 0;
    await step('first pop scores, Undo button restores it', async () => {
      const ended = await popBestGroup(true);
      if (ended) throw new Error('round ended after a single pop');
      pops++;
      const score = await page.textContent('#hud-score');
      if (+score <= 0) throw new Error('score did not increase after pop: ' + score);
      await page.click('#btn-undo');
      await waitState('active');
      const undone = await page.textContent('#hud-score');
      if (undone !== '0') throw new Error(`undo did not restore score 0 (got ${undone})`);
      await popBestGroup(true); // redo a scoring pop so the round progresses
      pops++;
    });

    await step('Hint button announces a target', async () => {
      await page.click('#btn-hint');
      await page.waitForFunction(() =>
        /Hint: row \d+ column \d+/.test(document.getElementById('live-status').textContent),
        null, { timeout: 5000 });
      const text = await page.textContent('#live-status');
      const m = text.match(/Hint: row (\d+) column (\d+)/);
      focus = { r: +m[1] - 1, c: +m[2] - 1 }; // doHint moved the focus
      console.log(`  [${passName}] hint:`, text.trim());
    });

    await step('pause overlay + resume', async () => {
      await page.click('#btn-pause');
      await page.waitForSelector('#overlay-pause:not([hidden])');
      await page.screenshot({ path: shot('pause', passName) });
      await page.click('#btn-resume-round');
      await page.waitForSelector('#overlay-pause', { state: 'hidden' });
      await waitState('active');
    });

    await step('play until the results screen (real pops via keyboard)', async () => {
      let ended = false;
      while (!ended && pops < 150) {
        ended = await popBestGroup(true);
        pops++;
      }
      if (!ended) throw new Error(`round did not terminate after ${pops} pops`);
      console.log(`  [${passName}] finished after ${pops} pops`);
      await page.screenshot({ path: shot('results', passName) });
    });

    await step('results screen shows a win + breakdown', async () => {
      const headline = await page.textContent('#results-headline');
      console.log(`  [${passName}] headline:`, headline);
      if (!/You win/.test(headline)) throw new Error('stage 1 should be unwinnable-proof, got: ' + headline);
      const rows = await page.locator('#results-breakdown tbody tr').count();
      if (rows < 2) throw new Error('breakdown table empty');
      const replay = await page.textContent('#replay-json');
      if (!replay || replay.length < 100) throw new Error('replay envelope missing');
    });

    await step('back to title, progress persisted', async () => {
      await page.click('#btn-results-menu');
      await page.waitForSelector('#screen-title:not([hidden])');
      const progress = await page.textContent('#title-progress');
      if (!/Journey 1\/40/.test(progress)) throw new Error('progress not persisted: ' + progress);
      const nextLabel = await page.textContent('#btn-play');
      if (!/Play: Bigger is Better/.test(nextLabel)) throw new Error('stage 2 not unlocked: ' + nextLabel);
      await page.screenshot({ path: shot('title-after', passName) });
    });
  } finally {
    await context.close();
  }
  return errors;
}

const server = await serveStatic();
let browser = null;
let failed = false;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader']
  });
  const allErrors = [];
  for (const [name, opts] of [
    ['desktop', { viewport: { width: 1280, height: 800 } }],
    ['mobile', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]
  ]) {
    try {
      const errs = await runPass(browser, name, opts);
      allErrors.push(...errs.map((e) => `[${name}] ${e}`));
    } catch (e) {
      console.error(`FAIL - [${name}] ${e.message}`);
      allErrors.push(`[${name}] step failure: ${e.message}`);
    }
  }
  if (allErrors.length) {
    console.error('\nPAGE/STEP ERRORS:\n' + allErrors.join('\n'));
    failed = true;
  } else {
    console.log('\nE2E PASS — cube-pop playable end-to-end on desktop + mobile, no page errors');
  }
} catch (e) {
  console.error('FATAL: ' + (e.stack || e));
  failed = true;
} finally {
  if (browser) await browser.close();
  await new Promise((r) => server.close(r));
}
process.exit(failed ? 1 : 0);
