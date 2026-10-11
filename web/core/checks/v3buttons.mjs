// Codex's CX-8 host buttons (Noise ×50, Glow, the Original/Adversarial pair) against the real display and its v3
// display-state, through the relay: what the button shows, what it sends, and what the display does with it.
// usage (repo root): BASE=… STARK_HOST_KEY=… node web/core/checks/v3buttons.mjs [shotDir]
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const KEY = process.env.STARK_HOST_KEY ?? readFileSync(process.env.STARK_KEY_FILE.replace(/^~/, process.env.HOME), 'utf8').trim();
const SHOTS = process.argv[2] ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed += 1; };
const errors = [];
const watch = (page, name) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: pageerror ${e.message}`));
};
const phone = ({ defaultBrowserType, ...d }) => d;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const display = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
watch(display, 'display');
await display.goto(`${BASE}/display`);
await display.waitForFunction(() => window.__starkReady === true && window.__stark.relay?.room, null, { timeout: 60000 });
const room = await display.evaluate(() => window.__stark.relay.room);
const host = await (await browser.newContext(phone(devices['iPad Pro 11']))).newPage();
watch(host, 'host');
await host.goto(`${BASE}/controller?room=${room}&role=host&key=${encodeURIComponent(KEY)}`);
await host.waitForSelector('#gallery-grid [data-image-id]', { timeout: 30000 });
const sent = [];
await display.evaluate(() => { window.__sm = []; window.__stark.relay.socket.on('set-mode', (p) => window.__sm.push(p)); });

const D = () => display.evaluate(() => { const s = window.__stark; const st = s.api.state;
  return { image: st.image.id, noiseView: st.noiseView, bloom: st.bloom, caps: { noiseView: st.capabilities.noiseView, bloom: st.capabilities.bloom },
    mix: s.panel.noiseMix, caption: s.panel.caption, glowOn: s.glow.on }; });
const btn = (field) => host.locator(`[data-mode-field="${field}"]`);
const B = async (field) => ({ hidden: await btn(field).isHidden(), text: (await btn(field).locator('span').textContent())?.trim(),
  pressed: await btn(field).getAttribute('aria-pressed'), busy: await btn(field).getAttribute('aria-busy') });
const lastSent = () => display.evaluate(() => window.__sm.at(-1));
/** Tap a button and wait until the display state and the button agree (pending cleared). */
async function tap(field, want) {
  const t0 = Date.now();
  await btn(field).click();
  await display.waitForFunction(([f, v]) => window.__stark.api.state[f] === v, [field, want], { timeout: 5000 });
  await host.waitForFunction(([f, v]) => { const b = document.querySelector(`[data-mode-field="${f}"]`);
    return b.getAttribute('aria-busy') === 'false' && b.getAttribute('aria-pressed') === String(v); }, [field, want], { timeout: 5000 });
  return Date.now() - t0;
}
async function select(id) {
  await host.click(`#gallery-grid [data-image-id="${id}"]`);
  await display.waitForFunction((i) => window.__stark.api.state.image.id === i && window.__stark.api.state.playback.state === 'done', id, { timeout: 30000 });
  await sleep(300);
}

// --- Glow on a normal image ------------------------------------------------------------------------------------
await select('clean_retriever');
let d = await D(); let g = await B('bloom');
check(d.bloom && d.caps.bloom && !g.hidden && g.text === 'On' && g.pressed === 'true', `retriever: display bloom ${d.bloom} → Glow button shown "${g.text}"`);
let n = await B('noiseView');
check(n.hidden && d.caps.noiseView === false, 'retriever: Noise ×50 hidden (capabilities.noiseView false)');
let ms = await tap('bloom', false);
d = await D(); g = await B('bloom');
check(JSON.stringify(await lastSent()) === '{"bloom":false}' && !d.glowOn && g.text === 'Off', `Glow off: sent ${JSON.stringify(await lastSent())}, display glow off, button "Off" in ${ms} ms`);
if (SHOTS) await display.screenshot({ path: `${SHOTS}/glow-off.png` });
ms = await tap('bloom', true);
d = await D(); g = await B('bloom');
check(JSON.stringify(await lastSent()) === '{"bloom":true}' && d.glowOn && g.text === 'On', `Glow on: sent ${JSON.stringify(await lastSent())}, display glow on, button "On" in ${ms} ms`);

// --- the pair and Noise ×50 --------------------------------------------------------------------------------------
const pair = host.locator('#adversarial-pair');
check(await pair.isVisible(), 'Original/Adversarial pair shown on the retriever');
const cam = () => display.evaluate(() => window.__stark.camera.position.toArray().map((x) => x.toFixed(5)).join(','));
await sleep(1200);
const c0 = await cam();
await host.click('[data-pair-image="adv_retriever"]');
await display.waitForFunction(() => window.__stark.api.state.image.id === 'adv_retriever' && window.__stark.api.state.capabilities.noiseView, null, { timeout: 5000 });
await host.waitForFunction(() => !document.querySelector('[data-mode-field="noiseView"]').hidden, null, { timeout: 5000 });
d = await D(); n = await B('noiseView');
check(await cam() === c0, 'pair button → adversarial image, camera unchanged');
check(!n.hidden && n.text === 'Off' && d.noiseView === false, `adversarial: Noise ×50 shown "${n.text}" (capabilities.noiseView ${d.caps.noiseView}, noiseView ${d.noiseView})`);
ms = await tap('noiseView', true);
await sleep(350);
d = await D(); n = await B('noiseView');
check(JSON.stringify(await lastSent()) === '{"noiseView":true}' && d.mix === 1 && d.caption === 'The change, amplified 50×' && n.text === 'On',
  `Noise on: sent ${JSON.stringify(await lastSent())}, panel shows the noise ("${d.caption}"), button "On" in ${ms} ms`);
if (SHOTS) { await display.screenshot({ path: `${SHOTS}/noise-on.png` }); await host.screenshot({ path: `${SHOTS}/host-noise-on.png` }); }
ms = await tap('noiseView', false);
await sleep(350);
d = await D(); n = await B('noiseView');
check(JSON.stringify(await lastSent()) === '{"noiseView":false}' && d.mix === 0 && d.caption === 'Changed by at most 2/255 per pixel' && n.text === 'Off',
  `Noise off: sent ${JSON.stringify(await lastSent())}, photo back ("${d.caption}"), button "Off" in ${ms} ms`);
await tap('noiseView', true);
await host.click('[data-pair-image="clean_retriever"]');
await display.waitForFunction(() => window.__stark.api.state.image.id === 'clean_retriever', null, { timeout: 5000 });
await host.waitForFunction(() => document.querySelector('[data-mode-field="noiseView"]').hidden, null, { timeout: 5000 });
d = await D(); n = await B('noiseView');
check(d.noiseView === false && d.mix === 0 && n.hidden && await cam() === c0, 'back to the original with the noise on: photo again, Noise ×50 hidden, camera unchanged');

// --- Glow and Noise elsewhere ------------------------------------------------------------------------------------
await select('med_xray_pneumonia');
check(!(await B('bloom')).hidden && (await B('noiseView')).hidden, 'medical: Glow shown, Noise ×50 hidden');

// --- Glow after the display turned it off for fps -----------------------------------------------------------------
await select('clean_retriever');
await display.evaluate(() => { const s = window.__stark.stats; let real = s.fps; Object.defineProperty(s, 'fps', { configurable: true, get: () => 30, set: (v) => { real = v; } }); window.__fpsRestore = () => { Object.defineProperty(s, 'fps', { configurable: true, writable: true, value: real }); }; });
await display.waitForFunction(() => window.__stark.api.state.capabilities.bloom === false, null, { timeout: 8000 });
await display.evaluate(() => window.__fpsRestore());
await sleep(500);
d = await D(); g = await B('bloom');
check(!d.glowOn && d.bloom === false && d.caps.bloom === false, 'display auto-disabled glow (simulated 30 fps for 3 s): bloom false, capabilities.bloom false');
check(!g.hidden, `host can turn glow back on after the auto-off (contract v3 3.6): Glow button ${g.hidden ? 'HIDDEN' : `shown "${g.text}"`}`);
if (!g.hidden) {
  await tap('bloom', true);
  d = await D();
  check(d.glowOn && d.caps.bloom === true, 'Glow on again from the host: capabilities.bloom true');
} else {
  // put the display back for the rest of the session (the host could not)
  await display.evaluate(() => window.__stark.api.setMode({ bloom: true }));
}

check(errors.length === 0, `no console errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
console.log(failed ? `\n${failed} check(s) failed` : '\nv3 buttons: all checks passed');
await browser.close();
process.exitCode = failed ? 1 : 0;
