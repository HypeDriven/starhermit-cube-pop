/**
 * Cube Pop — end-to-end QA playthrough (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome (playwright-core + system
 * Chrome), on two viewport passes: desktop 1280x800 and mobile 390x844
 * (touch). Flow per pass:
 *   title → settings (enable reduced motion) → daily screen (local
 *   board) → Play (journey stage 1 "First Pops") → play the round
 *   for real via arrow keys + Enter (same controls a player uses; the
 *   screen-reader mirror grid and live-region announcements are read only
 *   for targeting/synchronization) → exercise Hint/Undo buttons and
 *   pause/resume overlay → play until the results screen (stage 1 cannot
 *   be lost: no move/time limit, free reshuffles) → back to title with
 *   persisted progress.
 *
 * This test serves the repo with a minimal embedded static server (no
 * API). Standalone (no launch token) the game must make zero same-origin
 * /api or /ws requests; the signed-in pass stubs the platform API and
 * GET /api/v1/time (the only own-server route, allowed with a token).
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
  '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
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

// StarHermit routes (the game's own /api/v1/time is separate).
const PLATFORM_API = /^\/api\/v1\/(games|users|me|leaderboards|chat)\//;
// Any own-server route: forbidden in a standalone load.
const OWN_SERVER = /^\/(api|ws)(\/|$)/;

// Signed-in pass: launch token in the fragment, platform API stubbed.
async function platformPass(browser, passName, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [], seen = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() !== 'error' && m.type() !== 'warning') || browserNoise.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = `${b64u({ alg: 'none' })}.${b64u({ sub: 'u-e2e-0001', game_scope: 'cube-pop', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
  await page.route((url) => PLATFORM_API.test(url.pathname), (route) => {
    const req = route.request(), u = new URL(req.url());
    seen.push(req.method() + ' ' + u.pathname);
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (u.pathname.endsWith('/profile')) return json({ nickname: 'Pip Tester' });
    if (u.pathname.endsWith('/settings') && req.method() === 'GET') return json({ settings: { highContrast: true } });
    if (u.pathname.endsWith('/controls')) return json({ actions: [{ action: 'hint', codes: ['KeyJ'] }] });
    return route.fulfill({ status: 204 });
  });
  await page.route((url) => url.pathname === '/api/v1/time', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ now: Date.now() }) }));
  const click = (sel) => (contextOpts.hasTouch ? page.tap(sel) : page.click(sel));
  const step = async (name, fn) => { await fn(); console.log(`ok - [${passName}] ${name}`); };
  try {
    await step('signed in: nickname, save load, fragment stripped', async () => {
      await page.goto(`http://127.0.0.1:${server.address().port}/#game_token=${jwt}`);
      await page.waitForFunction(() => /Pip Tester/.test(document.getElementById('status-net').textContent), null, { timeout: 8000 });
      if (await page.evaluate(() => location.hash)) throw new Error('launch fragment not stripped');
      if (await page.locator('#btn-signin:visible').count()) throw new Error('sign-in shown while signed in');
      if (!seen.includes('GET /api/v1/me/cloud-saves/' + encodeURIComponent('game:cube-pop'))) throw new Error('no cloud load: ' + seen.join(', '));
    });
    await step('platform settings applied (high contrast)', async () => {
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('cubepop:settings:v1') || '{}').highContrast === true, null, { timeout: 5000 });
    });
    await step('invite a friend shows a confirmation toast', async () => {
      await page.locator('#btn-invite').scrollIntoViewIfNeeded();
      await click('#btn-invite');
      await page.waitForSelector('#toast:not([hidden])', { timeout: 3000 });
      const box = await page.locator('#toast').boundingBox();
      if (!box || box.x < 0 || box.x + box.width > page.viewportSize().width + 1) throw new Error('toast off-screen ' + JSON.stringify(box));
      await page.screenshot({ path: shot('platform', passName) });
    });
    await step('help lists the platform key binding', async () => {
      await page.locator('[data-goto="help"]').first().scrollIntoViewIfNeeded();
      await click('[data-goto="help"]');
      await page.waitForFunction(() => document.getElementById('key-hint').textContent === 'J', null, { timeout: 3000 });
    });
  } finally {
    await context.close();
  }
  return errors;
}

async function runPass(browser, passName, contextOpts) {
  const context = await browser.newContext(contextOpts);
  const page = await context.newPage();
  const errors = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.hostname === '127.0.0.1' && OWN_SERVER.test(u.pathname)) errors.push('standalone made an own-server call: ' + r.url());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if ((m.type() !== 'error' && m.type() !== 'warning') || browserNoise.test(m.text())) return;
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

    await step('Settings → Graphics: presets, override, persistence across reload', async () => {
      await page.click('#screen-title [data-goto="settings"]');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.locator('#gfx-settings').scrollIntoViewIfNeeded();
      const autoLabel = await page.textContent('#set-quality option[value="auto"]');
      if (!/Auto \(detected: Low\)/.test(autoLabel)) throw new Error('software GPU should detect Low: ' + autoLabel);
      const bodyPreset = () => page.evaluate(() => document.body.dataset.gfxPreset);
      await page.selectOption('#set-quality', 'low');
      if (await bodyPreset() !== 'low') throw new Error('Low preset not applied');
      await page.selectOption('#set-quality', 'high');
      if (await bodyPreset() !== 'high') throw new Error('High preset not applied');
      const fromLabel = await page.textContent('#set-gfx-bloom option[value="preset"]');
      if (!/From preset \(On\)/.test(fromLabel)) throw new Error('bloom preset label wrong: ' + fromLabel);
      await page.selectOption('#set-gfx-bloom', 'off');
      await page.check('#set-gfx-fps');
      const summary = await page.textContent('#gfx-summary');
      if (/Bloom/.test(summary) || !/SMAA/.test(summary)) throw new Error('summary does not reflect override: ' + summary);
      await page.screenshot({ path: shot('graphics', passName) });
      await page.reload({ waitUntil: 'load' });
      await page.waitForSelector('#screen-title:not([hidden])');
      if (await bodyPreset() !== 'high') throw new Error('preset did not survive reload');
      await page.click('#screen-title [data-goto="settings"]');
      await page.waitForSelector('#screen-settings:not([hidden])');
      if (await page.inputValue('#set-quality') !== 'high') throw new Error('quality select lost High');
      if (await page.inputValue('#set-gfx-bloom') !== 'off') throw new Error('bloom override lost on reload');
      if (!(await page.isChecked('#set-gfx-fps'))) throw new Error('show fps lost on reload');
      if (!(await page.isChecked('#set-reduced-motion'))) throw new Error('reduced motion lost on reload');
      // Choosing a preset clears overrides; back to Auto (Low here) keeps the playthrough fast.
      await page.selectOption('#set-quality', 'auto');
      if (await page.inputValue('#set-gfx-bloom') !== 'preset') throw new Error('preset did not clear the override');
      if (await bodyPreset() !== 'low') throw new Error('Auto should resolve to Low on a software GPU');
      await page.uncheck('#set-gfx-fps');
      await page.click('#screen-settings [data-goto="title"]');
      await page.waitForSelector('#screen-title:not([hidden])');
    });

    await step('daily screen shows the local board (no backend)', async () => {
      await page.click('#screen-title [data-goto="daily"]');
      await page.waitForSelector('#screen-daily:not([hidden])');
      await page.waitForFunction(() => /No scores on this device/.test(document.getElementById('daily-board').textContent), null, { timeout: 8000 });
      const net = await page.textContent('#status-net');
      if (net !== 'offline-capable') throw new Error(`expected offline-capable status, got "${net}"`);
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
      const canvasPreset = await page.evaluate(() => document.querySelector('#gl-container canvas')?.dataset.gfxPreset);
      if (canvasPreset !== 'low') throw new Error('studio canvas should render at Low (Auto), got ' + canvasPreset);
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

    await step('Ultra preset renders a round without console errors', async () => {
      await page.click('#screen-title [data-goto="settings"]');
      await page.waitForSelector('#screen-settings:not([hidden])');
      await page.selectOption('#set-quality', 'ultra');
      await page.click('#screen-settings [data-goto="title"]');
      await page.click('#btn-play');
      await waitState('active');
      await page.waitForTimeout(1500);
      const p = await page.evaluate(() => document.querySelector('#gl-container canvas').dataset.gfxPreset);
      if (p !== 'ultra') throw new Error('canvas not at Ultra: ' + p);
      await page.screenshot({ path: shot('ultra', passName) });
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
      const errs = [...await runPass(browser, name, opts), ...await platformPass(browser, 'platform-' + name, opts)];
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
