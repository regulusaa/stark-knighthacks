// CX-8 behavior checks against the dev-only v3 transport; real contract is read-only.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:3002';
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true });
const watch = p => { p.on('pageerror', e => errors.push(e.message)); p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
watch(page);
const open = async (scene, role = 'host') => {
  await page.goto(`${base}/controller?room=7KQ2M&role=${role}&key=test&mock=1&v3=1&scene=${scene}`);
  await page.waitForSelector(`#app[data-state="${role === 'host' ? 'host' : 'guest-viewing'}"]`);
};
const log = () => page.evaluate(() => window.__v3Mock.log);
const state = () => page.evaluate(() => window.__v3Mock.state);
const wait = () => page.waitForTimeout(220);
try {
  await open('idle');
  assert.equal(await page.locator('#layer-control-wrap').isVisible(), false);
  assert.equal(await page.locator('[data-mode-field="noiseView"]').isVisible(), false);
  await page.locator('[data-mode-field="bloom"]').click();
  assert.equal(await page.locator('[data-mode-field="bloom"]').getAttribute('aria-busy'), 'true');
  await wait(); assert.equal((await state()).bloom, false);
  assert.equal(await page.locator('[data-mode-field="bloom"]').getAttribute('aria-busy'), 'false');
  await page.locator('[data-mode="trunk"]').click(); await wait();
  assert.equal(await page.locator('#layer-control-wrap').isVisible(), true);
  await page.locator('[data-layer-mode="reduced"]').click(); await wait();
  assert.match(await page.locator('.trackpad-note').innerText(), /49 layers/);
  await page.locator('[data-layer-mode="full"]').click(); await wait();
  await page.locator('[data-mode="normal"]').click(); await wait();
  await page.locator('[data-pair-image="adv_retriever"]').click();
  assert.equal(await page.locator('[data-pair-image="adv_retriever"]').getAttribute('aria-busy'), 'true');
  await page.waitForTimeout(420);
  await page.locator('[data-mode-field="noiseView"]').click(); await wait();
  await page.locator('[data-mode-field="noiseView"]').click(); await wait();
  await page.locator('[data-pair-image="clean_retriever"]').click(); await page.waitForTimeout(420);
  assert.deepEqual((await log()).map(e => [e.event, e.payload]), [
    ['set-mode', { bloom: false }], ['set-mode', { mode: 'trunk' }], ['set-mode', { layerMode: 'reduced' }], ['set-mode', { layerMode: 'full' }], ['set-mode', { mode: 'normal' }],
    ['select-image', { imageId: 'adv_retriever' }], ['set-mode', { noiseView: true }], ['set-mode', { noiseView: false }], ['select-image', { imageId: 'clean_retriever' }],
  ]);
  console.log('ok exact field-only mode emits, pair selects both ways, immediate pending feedback and display confirmation');
  // Two independent fields must retain their pending state across an unrelated state update.
  await page.evaluate(() => { document.querySelector('[data-mode-field="bloom"]').click(); document.querySelector('[data-mode="trunk"]').click(); window.__v3Mock.inject(window.__v3Mock.state); });
  assert.equal(await page.locator('[data-mode-field="bloom"]').getAttribute('aria-busy'), 'true');
  assert.equal(await page.locator('[data-mode="trunk"]').getAttribute('aria-busy'), 'true');
  await wait();
  assert.equal(await page.locator('[data-mode-field="bloom"]').getAttribute('aria-busy'), 'false');
  assert.equal(await page.locator('[data-mode="trunk"]').getAttribute('aria-busy'), 'false');
  await page.evaluate(() => { const s = window.__v3Mock.state; s.capabilities = { stability: false, trunkInterior: false, layerModes: false, bloom: false, noiseView: false, steer: false }; window.__v3Mock.inject(s); });
  for (const selector of ['[data-mode="stability"]', '[data-mode="trunk"]', '#layer-control-wrap', '[data-mode-field="bloom"]', '[data-mode-field="noiseView"]']) assert.equal(await page.locator(selector).isVisible(), false, selector);
  // Missing v3 field on v2 server must hide Glow even if the old capability happens to be true.
  await page.evaluate(() => { const s = window.__v3Mock.state; s.capabilities.bloom = true; delete s.bloom; window.__v3Mock.inject(s); });
  assert.equal(await page.locator('[data-mode-field="bloom"]').isVisible(), false);
  console.log('ok independent pending fields, capability=false and absent v3 fields hide controls');
  await open('stability-playing');
  assert.equal(await page.locator('.answer-row:disabled').count(), await page.locator('.answer-row').count());
  await page.evaluate(() => document.querySelector('.answer-row').dispatchEvent(new MouseEvent('click', { bubbles: true })));
  assert.equal((await log()).length, 0);
  assert.match(await page.locator('#answer-context').innerText(), /run 12 \/ 30/);
  await page.locator('#replay-pulse').click(); await page.waitForTimeout(45);
  assert.equal((await state()).stability.run, 1);
  assert.deepEqual((await log()).at(-1).payload, { speed: 1, skipToEnd: false });
  await page.waitForFunction(() => window.__v3Mock.state.stability.phase === 'summary');
  assert.equal(await page.locator('.answer-row:disabled').count(), 0);
  await page.locator('.answer-row').first().click(); await page.waitForTimeout(60);
  assert.equal((await log()).at(-1).event, 'focus-tip');
  console.log('ok stability read-only, focus guard, replay from run 1 and answer taps restored at summary');
  await page.setViewportSize({ width: 390, height: 844 }); await open('medical', 'guest');
  assert.equal(await page.locator('#answers-title').innerText(), 'Findings · independent scores');
  assert.equal(await page.locator('.answer-meter-fill').first().evaluate(e => e.style.width), '71%');
  assert.match(await page.locator('#medical-caveat').innerText(), /not a diagnosis/);
  assert.equal(await page.locator('#explore-tabs').isVisible(), false);
  assert.match(await page.locator('#steer-medical-note').innerText(), /ImageNet model only/);
  for (const width of [320, 375, 390]) { await page.setViewportSize({ width, height: 667 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
  await page.setViewportSize({ width: 1180, height: 820 }); await open('medical');
  assert.equal(await page.locator('[data-mode="stability"]').isVisible(), false);
  assert.equal(await page.locator('#adversarial-pair').isVisible(), false);
  console.log('ok independent medical bars, caveat, ImageNet-only Steer note and 320/375/390px overflow');
  assert.deepEqual(errors, []);
  console.log('PASS CX-8 controller/host checks; no console errors');
} finally { await browser.close(); }
