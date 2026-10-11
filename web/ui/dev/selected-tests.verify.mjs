// Real relay regression: tests belong to the selected image, never a hardcoded demo fallback.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const base = process.argv[2] || 'http://localhost:3004';
const info = await (await fetch(`${base}/api/room`)).json();
assert.equal(info.fixedRoom, null, 'Run locally: opening a display on a fixed-room server would replace the live demo.');
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const watch = page => { page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); };
try {
  const display = await browser.newPage({ viewport: { width: 2560, height: 1440 } }); watch(display);
  await display.goto(`${base}/display?image=clean_retriever&pulseAt=done`);
  await display.waitForFunction(() => window.__starkReady && window.__stark.relay?.room, null, { timeout: 45000 });
  const room = await display.evaluate(() => window.__stark.relay.room);
  await display.evaluate(() => {
    window.__testEvents = [];
    for (const event of ['select-image', 'set-mode', 'play-pulse']) window.__stark.relay.socket.on(event, payload => window.__testEvents.push([event, payload]));
  });
  const host = await browser.newPage({ viewport: { width: 1180, height: 820 }, hasTouch: true }); watch(host);
  const controller = `${base}/controller?room=${room}&role=host&key=test`;
  await host.goto(controller);
  await host.waitForFunction(() => window.__inspectionControllerReady);
  const events = () => display.evaluate(() => window.__testEvents);
  const select = async id => {
    const tile = host.locator(`[data-image-id="${id}"]`);
    if (await tile.getAttribute('aria-current') !== 'true') {
      await tile.click();
      assert.equal(await host.locator('[data-demo-beat="stability"]').isDisabled(), true);
      await host.waitForFunction(id => document.querySelector(`[data-image-id="${id}"]`).getAttribute('aria-current') === 'true', id);
    }
    await host.locator('[data-demo-beat="stability"]').waitFor({ state: 'visible' });
    await host.waitForFunction(() => !document.querySelector('[data-demo-beat="stability"]').disabled);
  };
  for (const [id, classId] of [['ambig_cat', 281], ['ambig_wolf', 269], ['clean_retriever', 207]]) {
    await select(id);
    const start = (await events()).length;
    await host.locator('[data-demo-beat="stability"]').click();
    await display.waitForFunction(id => window.__stark.api.state.image.id === id && window.__stark.api.state.stability?.run >= 1, id);
    const state = await display.evaluate(() => window.__stark.api.state);
    assert.equal(state.stability.cleanTop1.classId, classId);
    assert.deepEqual((await events()).slice(start), [['set-mode', { mode: 'stability' }]]);
    console.log(`PASS Stability rail: ${id} stays selected, baseline ${state.stability.cleanTop1.label}, only set-mode emitted`);
    const replayStart = (await events()).length;
    await host.waitForFunction(() => !document.querySelector('[data-demo-beat="stability"]').disabled);
    await host.locator('[data-demo-beat="stability"]').click();
    await display.waitForFunction(n => window.__testEvents.length > n, replayStart);
    assert.deepEqual((await events()).slice(replayStart), [['play-pulse', { speed: state.playback.speed, skipToEnd: false }]]);
    if (id === 'ambig_wolf') {
      await host.screenshot({ path: 'web/ui/.shots/selected-wolf-stability-1180x820.png' });
      await display.screenshot({ path: 'web/ui/.shots/selected-wolf-stability-2560x1440.png' });
      assert.equal(await host.locator('[data-demo-beat="adversarial"]').isVisible(), false);
      assert.match(await host.locator('.demo-availability').innerText(), /No adversarial data/);
      const blocked = (await events()).length;
      await host.evaluate(() => document.querySelector('[data-demo-beat="adversarial"]').click());
      await host.waitForTimeout(80); assert.equal((await events()).length, blocked);
      assert.equal(await display.evaluate(() => window.__stark.api.state.image.id), 'ambig_wolf');
    }
    await host.locator('[data-workspace="usage"]').click();
    await host.locator('[data-mode="normal"]').click();
    await display.waitForFunction(() => window.__stark.api.state.mode === 'normal');
    await host.locator('[data-workspace="modify"]').click();
  }
  for (const id of ['adv_retriever', 'clean_retriever']) {
    const start = (await events()).length;
    await host.locator('[data-demo-beat="adversarial"]').click();
    await host.waitForFunction(() => !document.querySelector('[data-demo-beat="adversarial"]').disabled);
    assert.equal(await display.evaluate(() => window.__stark.api.state.image.id), id);
    assert.deepEqual((await events()).slice(start), [['select-image', { imageId: id }], ['set-mode', { mode: 'normal' }]]);
    console.log(`PASS Adversarial rail: uses actual FGSM pair → ${id}`);
  }
  // Usage settings also applies Stability to the chosen image.
  await select('ambig_wolf');
  await host.locator('[data-workspace="usage"]').click();
  await host.locator('[data-mode="stability"]').click();
  await display.waitForFunction(() => window.__stark.api.state.stability?.cleanTop1.classId === 269);
  await host.locator('[data-mode="normal"]').click();
  await display.waitForFunction(() => window.__stark.api.state.mode === 'normal');
  await host.locator('[data-workspace="modify"]').click();
  for (const id of ['clean_sportscar', 'med_xray_pneumonia']) {
    await host.locator(`[data-image-id="${id}"]`).click();
    await host.waitForFunction(id => document.querySelector(`[data-image-id="${id}"]`).getAttribute('aria-current') === 'true', id);
    assert.equal(await host.locator('[data-demo-beat="stability"]').isVisible(), false);
    assert.equal(await host.locator('[data-demo-beat="adversarial"]').isVisible(), false);
    assert.match(await host.locator('.demo-availability').innerText(), /No stability data.*No adversarial data/);
    console.log(`PASS ${id}: unavailable tests hidden, no substitute image`);
  }
  await host.locator('[data-image-id="ambig_wolf"]').click();
  await host.waitForFunction(() => document.querySelector('[data-image-id="ambig_wolf"]').getAttribute('aria-current') === 'true');
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true }); watch(phone);
  await phone.goto(controller); await phone.waitForFunction(() => window.__inspectionControllerReady);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await phone.screenshot({ path: 'web/ui/.shots/selected-wolf-controls-390x844.png' });
  assert.deepEqual(errors, []);
  console.log('PASS selected-image tests; 0 console errors; phone, iPad and HUD screenshots saved');
} finally { await browser.close(); }
