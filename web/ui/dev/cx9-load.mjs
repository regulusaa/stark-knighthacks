// Measures actual network navigation; throttling, if requested, is labelled separately.
import { chromium } from 'playwright';
const base = process.argv[2] || 'https://64-177-50-154.sslip.io';
const room = process.env.STARK_ROOM || 'STRK7';
const browser = await chromium.launch();
try {
  for (let run = 1; run <= 3; run++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript(() => {
      let ready = false;
      Object.defineProperty(window, '__starkReady', { configurable: true, get: () => ready, set: value => { ready = value; if (value && !window.__cx9InteractiveAt) window.__cx9InteractiveAt = performance.now(); } });
    });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/controller?room=${room}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__starkReady === true, null, { timeout: 20000 });
    const timing = await page.evaluate(() => ({
      interactiveMs: window.__cx9InteractiveAt,
      state: document.getElementById('app').dataset.state,
      resources: performance.getEntriesByType('resource').map(r => ({ path: new URL(r.name).pathname, bytes: r.transferSize, decodedBytes: r.decodedBodySize, durationMs: Math.round(r.duration), endMs: Math.round(r.responseEnd), initiator: r.initiatorType })),
    }));
    console.log(JSON.stringify({ run, network: 'unthrottled actual network', ...timing, errors }));
    await context.close();
  }
} finally { await browser.close(); }
