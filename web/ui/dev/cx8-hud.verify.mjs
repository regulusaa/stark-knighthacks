import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:3002';
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
watch(page);
const open = async (scene, layout = 'full') => { await page.goto(`${base}/ui/dev/hud.html?scene=${scene}&layout=${layout}`); await page.waitForFunction(() => window.__starkReady); };
try {
  for (const size of [[1920, 1080], [2560, 1440]]) {
    await page.setViewportSize({ width: size[0], height: size[1] });
    for (const scene of ['idle', 'stability-playing', 'stability-summary', 'adversarial', 'adversarial-noise', 'medical', 'steering', 'steer-moment', 'outsideBrain']) {
      await open(scene);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
      const sizes = await page.locator('.hud-label:visible,.hud-answer:visible').evaluateAll(es => es.map(e => parseFloat(getComputedStyle(e).fontSize)));
      assert.ok(sizes.every(s => s >= 28));
    }
  }
  await open('stability-playing');
  assert.match(await page.locator('.hud-context-title').innerText(), /run 12 \/ 30/);
  assert.equal(await page.locator('.hud-progress span').evaluate(e => e.style.width), '40%');
  assert.equal(await page.locator('.hud-result').isVisible(), false);
  await open('stability-summary');
  assert.match(await page.locator('.hud-context-title').innerText(), /won 21 of 30 runs/);
  assert.equal(await page.locator('.hud-winners .hud-data-row').count(), 3);
  await page.evaluate(() => { const s = structuredClone(window.__hudLab.current); s.stability.winners = [{ classId: 208, label: 'Labrador retriever', count: 30 }]; s.stability.distinctWinners = 1; window.__hudLab.inject(s); });
  assert.match(await page.locator('.hud-context-title').innerText(), /won 0 of 30 runs/);
  assert.equal(await page.locator('.hud-winners .hud-data-row').count(), 0);
  await open('adversarial-noise');
  assert.match(await page.locator('[data-field="original"]').innerText(), /Original answer: golden retriever \(62.0%\)/);
  assert.equal(await page.locator('[data-field="noise"]').innerText(), 'The change, amplified 50×');
  await open('medical');
  assert.equal(await page.locator('.hud-findings .hud-data-row').count(), 3);
  assert.match(await page.locator('.hud-medical').innerText(), /Findings \(independent scores\)/);
  assert.match(await page.locator('.hud-medical').innerText(), /not a diagnosis/);
  assert.equal(await page.locator('.hud-result').isVisible(), false);
  await open('steering'); assert.equal(await page.locator('[data-field="steeringBadge"]').innerText(), 'Steering · 3 channels changed');
  await open('outsideBrain'); assert.match(await page.locator('[data-field="outside"]').innerText(), /Top answer isn't drawn in the Brain/);
  // Stability membership uses all tree leaves, not just the answer-list cutoff.
  await open('stability-playing');
  await page.evaluate(() => { const s = structuredClone(window.__hudLab.current); s.stability.current = { classId: 999, label: 'toilet tissue', score: .44 }; window.__hudLab.inject(s); });
  await page.waitForFunction(() => document.querySelector('[data-field="outside"]').textContent.includes('toilet tissue'));
  console.log('ok nine scenes at both monitor sizes, ≥28px labels, real membership notices and feature wording');
  await open('focused');
  for (const [source, expected] of [['precomputed', 'Grad-CAM (precomputed)'], ['live', 'Grad-CAM, computed live from the last layer'], [null, 'No heatmap for this class']]) {
    await page.evaluate(source => { for (const cb of window.__hudLab.listeners.focus) cb({ label: 'Labrador retriever', score: .11, rank: 2, hasHeatmap: source !== null, heatmapSource: source }); }, source);
    assert.equal(await page.locator('[data-field="heatmap"]').innerText(), expected);
  }
  await page.evaluate(() => window.__hudLab.inject({ image: { name: 'Missing fields' } }));
  assert.equal(await page.locator('[data-field="image"]').innerText(), 'Missing fields');
  assert.equal(await page.locator('[data-field="answer"]').innerText(), '');
  assert.equal(await page.locator('.hud-focus').getAttribute('aria-hidden'), 'true');
  await page.evaluate(() => { window.__hudLab.inject(null); window.__hudLab.mounted.destroy(); window.__hudLab.mounted.destroy(); window.__hudLab.inject({}); });
  console.log('ok all focus sources, partial/null fields, double destroy and unsubscribe safety');
  await open('steer-moment');
  assert.equal(await page.locator('.hud-moment').isVisible(), true);
  const moment = await page.evaluate(() => structuredClone(window.__hudLab.current));
  await page.waitForTimeout(2420); // 250ms readiness + 2420ms = mid-transition.
  const during = await page.locator('.hud-moment').evaluate(e => ({ top: e.getBoundingClientRect().top, docked: e.classList.contains('hud-docked') }));
  assert.equal(during.docked, true); assert.ok(during.top > 32 && during.top < 500);
  await page.evaluate(s => window.__hudLab.inject(s), moment); // repeated state cannot restart it.
  await page.waitForTimeout(1550); assert.equal(await page.locator('.hud-moment').isVisible(), false);
  await page.evaluate(s => window.__hudLab.inject(s), moment); assert.equal(await page.locator('.hud-moment').isVisible(), false);
  await page.evaluate(() => { const s = structuredClone(window.__hudLab.current); s.steerMoment.at = Date.now() - 5000; window.__hudLab.inject(s); });
  assert.equal(await page.locator('.hud-moment').isVisible(), false);
  await page.evaluate(() => window.__hudLab.show('steer-moment')); assert.equal(await page.locator('.hud-moment').isVisible(), true);
  await page.evaluate(() => window.__hudLab.show('idle')); assert.equal(await page.locator('.hud-moment').isVisible(), false);
  console.log('ok 2.5s hold, 400ms move, 4s expiry, duplicate/stale moment suppression and image/state cleanup');
  await page.emulateMedia({ reducedMotion: 'reduce' }); await open('steer-moment');
  assert.equal(await page.locator('.hud-moment').evaluate(e => getComputedStyle(e).transitionProperty), 'opacity');
  await page.waitForTimeout(2520); assert.equal(await page.locator('.hud-moment').evaluate(e => e.classList.contains('hud-docked')), true);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [width, height] of [[390,844],[1180,820],[2560,1440]]) {
    await page.setViewportSize({ width, height }); await open('idle', 'compact');
    assert.equal(await page.locator('.hud-qr,.hud-room,.hud-status,.hud-brand,.hud-legend').count(), 0);
    assert.equal(await page.locator('.hud-context').isVisible(), false);
    assert.equal(await page.locator('.hud-answer').evaluate(e => getComputedStyle(e).fontSize), width < 1200 ? '18px' : '28px');
    assert.equal(await page.locator('.hud-result').evaluate(e => getComputedStyle(e).pointerEvents), 'none');
  }
  assert.deepEqual(errors, []);
  console.log('PASS contextual HUD, reduced motion and minimal normal live view; no console errors');
} finally { await browser.close(); }
