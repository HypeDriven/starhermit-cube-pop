// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only): picks a preset in Settings → Graphics,
// starts the next Journey stage and keeps popping the largest group through the board's accessible
// cell buttons (pops, falls, bursts, specials, motes and the post chain all run), replaying on results.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

export async function setPreset(page, preset) {
  await page.waitForSelector('#screen-title:not([hidden])', { timeout: 20000 });
  await page.click('#screen-title [data-goto="settings"]');
  await page.waitForSelector('#screen-settings:not([hidden])');
  await page.locator('#set-quality').scrollIntoViewIfNeeded();
  await page.selectOption('#set-quality', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('#screen-settings [data-goto="title"]').first().click();
  await page.waitForSelector('#screen-title:not([hidden])');
}

async function pop(page) {
  if (await page.locator('#overlay-results:not([hidden])').count()) {
    await page.click('#btn-results-menu');
    await page.waitForSelector('#screen-title:not([hidden])');
    await page.click('#btn-play');
    return;
  }
  await page.evaluate(() => {
    if (document.body.dataset.gameState !== 'active') return;
    let best = null, bestSize = 1;
    for (const b of document.querySelectorAll('#board-mirror button:not([disabled])')) {
      const label = b.getAttribute('aria-label') || '';
      const m = label.match(/group of (\d+)$/);
      const size = /rocket|bomb/.test(label) ? 99 : m ? +m[1] : 0;
      if (size > bestSize) { best = b; bestSize = size; }
    }
    if (best) best.click();
  });
}

export async function start(page) {
  await page.click('#btn-play');
  await page.waitForSelector('#screen-game:not([hidden])');
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    while (open) {
      try { await pop(page); } catch { if (!open) return; }
      await new Promise((r) => setTimeout(r, 350));
    }
  })();
  await page.waitForTimeout(500);
}
