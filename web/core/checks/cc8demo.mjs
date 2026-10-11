// CC-8 demo order, end to end: the display + Codex's iPad host controller + an iPhone guest, through the relay, no
// reloads. retriever → stability image (stability mode, play, summary, replay, back to normal) → adversarial pair
// switch (same camera; noise on, off) → glow off/on → medical (fan, note, ring) → Steer demo image (the phone drags
// four sliders to zero; the answer flips; the Steer moment fires). Screenshots for the report and the frame rate in
// each mode, measured on the display.
// usage (repo root): BASE=https://… STARK_KEY_FILE=~/.config/stark/host-key node web/core/checks/cc8demo.mjs [shotDir]
//   (or STARK_HOST_KEY=… for a local server). The key is never printed. Devices are Playwright presets on Chromium.
// The controller has no noise or glow buttons yet (Codex's CX-8): those two go out as set-mode from a second host
// socket, exactly the event the button will send; the output says so.
import { readFileSync } from 'node:fs';
import { chromium, devices } from 'playwright';
import { io } from 'socket.io-client';

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
const fpsTable = [];

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const display = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
watch(display, 'display');
let loads = 0;
display.on('load', () => { loads += 1; });
await display.goto(`${BASE}/display`);
await display.waitForFunction(() => window.__starkReady === true && window.__stark.relay?.room, null, { timeout: 60000 });
const room = await display.evaluate(() => window.__stark.relay.room);
console.log(`room ${room} on ${BASE}`);

const host = await (await browser.newContext(phone(devices['iPad Pro 11']))).newPage();
watch(host, 'host');
await host.goto(`${BASE}/controller?room=${room}&role=host&key=${encodeURIComponent(KEY)}`);
const guest = await (await browser.newContext(phone(devices['iPhone 13']))).newPage();
watch(guest, 'guest');
await guest.goto(`${BASE}/controller?room=${room}`);
await host.waitForSelector('#gallery-grid [data-image-id]', { timeout: 30000 });
// the noise and glow toggles (see the header)
const tools = io(BASE, { transports: ['websocket'], reconnection: false });
await new Promise((r) => tools.on('connect', r));
check((await tools.emitWithAck('register', { role: 'host', room, key: KEY })).ok, 'host tools socket registered (for set-mode noiseView/bloom)');

const S = (fn, arg) => display.evaluate(fn, arg);
const state = () => S(() => window.__stark.api.state);
const shot = async (name) => { if (SHOTS) await display.screenshot({ path: `${SHOTS}/${name}.png` }); };
/** Frame rate on the display over `ms` (requestAnimationFrame intervals). */
async function fps(mode, ms = 2500) {
  const fr = await S((ms) => new Promise((done) => {
    const out = []; let last = performance.now(); const t0 = last;
    const loop = (t) => { out.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(loop); else done(out.slice(1)); };
    requestAnimationFrame(loop);
  }), ms);
  const f = fr.length / (fr.reduce((a, b) => a + b, 0) / 1000);
  fpsTable.push({ mode, fps: f, long: fr.filter((x) => x > 25).length, worst: Math.max(...fr), n: fr.length });
  return f;
}
async function select(id, { waitDone = true } = {}) {
  await host.click(`#gallery-grid [data-image-id="${id}"]`);
  await display.waitForFunction((i) => window.__stark.api.state.image.id === i, id, { timeout: 30000 });
  if (waitDone) await display.waitForFunction(() => window.__stark.api.state.playback.state === 'done' && window.__stark.veins.revealProgress >= 1, null, { timeout: 30000 });
}

// --- retriever ------------------------------------------------------------------------------------------------
await select('clean_retriever');
let st = await state();
check(st.top1.label === 'golden retriever' && st.bloom === true && st.capabilities.bloom === true, `retriever: top-1 ${st.top1.label}, glow on`);
await fps('normal (retriever, glow on)');

// --- stability ------------------------------------------------------------------------------------------------
await select('ambig_cat');
await host.waitForSelector('[data-mode="stability"]:not([hidden])', { timeout: 10000 });
await host.click('[data-mode="stability"]');
await display.waitForFunction(() => window.__stark.api.state.stability?.phase === 'playing', null, { timeout: 5000 });
st = await state();
check(st.mode === 'stability' && st.capabilities.steer === false, 'stability: entered from the host controller; Steer suspended');
const playFps = fps('stability (playing)', 2500);
await display.waitForFunction(() => window.__stark.api.state.stability?.run >= 12, null, { timeout: 5000 });
await shot('stability-mid');
await playFps;
await display.waitForFunction(() => window.__stark.api.state.stability?.phase === 'summary', null, { timeout: 10000 });
st = await state();
const w = st.stability.winners.map((x) => `${x.label} ${x.count}`).join(', ');
check(st.stability.run === 30 && st.stability.current.classId === st.stability.cleanTop1.classId && st.stability.distinctWinners === 2,
  `stability summary: ${w} of ${st.stability.runs}; the strand is back on ${st.stability.current.label}`);
const halos = await S(() => window.__stark.stability.counts.size);
check(halos === 2, `win halos on ${halos} tips`);
await sleep(400);
await shot('stability-summary');
await host.click('#replay-pulse');
await display.waitForFunction(() => window.__stark.api.state.stability?.phase === 'playing' && window.__stark.api.state.stability.run <= 5, null, { timeout: 5000 })
  .then(() => check(true, 'play-pulse in stability replays from run 1'), () => check(false, 'play-pulse in stability replays from run 1'));
await display.waitForFunction(() => window.__stark.api.state.stability?.phase === 'summary', null, { timeout: 10000 });
await host.click('[data-mode="normal"]');
await display.waitForFunction(() => window.__stark.api.state.mode === 'normal' && window.__stark.api.state.stability === null, null, { timeout: 5000 });
st = await state();
check(st.capabilities.steer === true && (await S(() => window.__stark.stability.counts.size)) === 0, 'normal again: halos cleared, Steer back');

// --- adversarial pair -----------------------------------------------------------------------------------------
await select('clean_retriever');
await sleep(1500);   // the adversarial partner preloads
const cam = () => S(() => [...window.__stark.camera.position.toArray(), ...window.__stark.camera.quaternion.toArray()].map((x) => x.toFixed(6)).join(','));
const c0 = await cam();
await shot('adversarial-before');
const t0 = Date.now();
await host.click('#gallery-grid [data-image-id="adv_retriever"]');
await display.waitForFunction(() => window.__stark.api.state.image.id === 'adv_retriever' && window.__stark.veins.revealProgress >= 1, null, { timeout: 5000 });
const switchMs = Date.now() - t0;
await sleep(300);
st = await state();
check(switchMs < 300 + 150, `pair switch: tap → answered Brain on the display in ${switchMs} ms (includes the relay hop)`);
check(await cam() === c0, 'pair switch: the camera did not move');
check(st.top1.label === 'Labrador retriever' && st.image.adversarial?.maxPixelChange === 2 && st.image.adversarial.cleanTop1.label === 'golden retriever'
  && st.image.adversarial.pairedImageId === 'clean_retriever', `adversarial: top-1 ${st.top1.label}; image.adversarial ${JSON.stringify({ ...st.image.adversarial, cleanTop1: st.image.adversarial?.cleanTop1.label })}`);
check(await S(() => window.__stark.panel.caption) === 'Changed by at most 2/255 per pixel', 'caption: "Changed by at most 2/255 per pixel"');
await shot('adversarial-after');
await fps('normal (adversarial)');
tools.emit('set-mode', { noiseView: true });
await display.waitForFunction(() => window.__stark.panel.noiseMix > 0 && window.__stark.panel.noiseMix < 1, null, { timeout: 2000 })
  .then(() => check(true, 'noise view crossfades in'), () => check(false, 'noise view crossfades in'));
await sleep(450);
st = await state();
check(st.noiseView === true && await S(() => window.__stark.panel.noiseMix) === 1 && await S(() => window.__stark.panel.caption) === 'The change, amplified 50×',
  'noise view on (set-mode noiseView from a host socket): "The change, amplified 50×"');
await shot('noise-view');
await fps('noise view');
tools.emit('set-mode', { noiseView: false });
await sleep(450);
check((await state()).noiseView === false && await S(() => window.__stark.panel.noiseMix) === 0, 'noise view off: the photo is back');
tools.emit('set-mode', { noiseView: true });
await sleep(450);
await host.click('#gallery-grid [data-image-id="clean_retriever"]');
await display.waitForFunction(() => window.__stark.api.state.image.id === 'clean_retriever', null, { timeout: 5000 });
check((await state()).noiseView === false && await S(() => window.__stark.panel.noiseMix) === 0 && await cam() === c0, 'switching back with the noise on: photo again, same camera');

// --- glow -----------------------------------------------------------------------------------------------------
await shot('glow-on');
tools.emit('set-mode', { bloom: false });
await display.waitForFunction(() => window.__stark.api.state.bloom === false, null, { timeout: 3000 });
check(await S(() => window.__stark.glow.on) === false, 'glow off from the host (set-mode bloom)');
await sleep(300);
await shot('glow-off');
await fps('normal (retriever, glow off)');
tools.emit('set-mode', { bloom: true });
await display.waitForFunction(() => window.__stark.api.state.bloom === true, null, { timeout: 3000 });

// --- medical --------------------------------------------------------------------------------------------------
await select('med_xray_pneumonia');
st = await state();
const med = await S(() => ({ tips: window.__stark.tips.list.length, ring: window.__stark.tips.ring.visible, note: window.__stark.medical.sprite.visible,
  other: window.__stark.tips.list.some((t) => t.isOther), trueTip: window.__stark.tips.list.find((t) => t.node.isTrueLabel)?.node.label }));
check(st.scoreKind === 'independent' && !st.capabilities.steer && !st.capabilities.stability, 'medical: scoreKind independent, Steer and stability off');
check(med.tips === 18 && !med.other && med.ring && med.trueTip === 'Pneumonia' && med.note, `medical fan: ${med.tips} strands, no "other", ring on ${med.trueTip}, the note above the fan`);
await sleep(300);
await shot('medical');
await fps('medical');
await select('med_xray_normal');
check(!(await S(() => window.__stark.tips.ring.visible)), 'normal X-ray: no ring');

// --- Steer demo -----------------------------------------------------------------------------------------------
const DEMO = { image: 'ambig_wolf', from: 'timber wolf', to: 'Arctic fox', sliders: [31, 240, 449, 1220] };
await select(DEMO.image);
await display.waitForFunction(() => window.__stark.api.state.capabilities.steer === true, null, { timeout: 20000 });
await guest.waitForSelector('#explore-tabs:not([hidden]) [data-panel="steer"]', { timeout: 20000 });
await guest.click('[data-panel="steer"]');
await guest.waitForSelector('#steer-panel [data-input-mode="sliders"]', { timeout: 20000 });
await guest.click('#steer-panel [data-input-mode="sliders"]');
const take = guest.locator('#steer-panel .steer-take:visible, #take-control-bottom:visible').first();
if (await take.count()) await take.click();
await display.waitForFunction(() => window.__stark.api.state.driver?.label?.startsWith('Guest'), null, { timeout: 10000 });
const toast = guest.getByText('Tap to take control again');
let momentSeen = null;
for (const c of DEMO.sliders) {
  if (await toast.isVisible().catch(() => false)) await toast.click();
  const input = guest.locator(`#steer-panel .steer-row[data-channel="${c}"] input`).first();
  await input.scrollIntoViewIfNeeded();
  const box = await input.boundingBox();
  const value = Number(await input.inputValue());
  const xAt = (v) => box.x + 10 + (box.width - 20) * (v / 3);
  const y = box.y + box.height / 2;
  await guest.mouse.move(xAt(value), y);
  await guest.mouse.down();
  for (let i = 1; i <= 16; i++) { await guest.mouse.move(xAt(value * (1 - i / 16)), y); await sleep(50); }
  await guest.mouse.up();
  await display.waitForFunction((ch) => window.__stark.steer.session.scales.get(ch) === 0, c, { timeout: 5000 });
  await sleep(120);
  momentSeen ??= await S(() => { const m = window.__stark.api.state.steerMoment; return m && { from: m.from.label, to: m.to.label, pulse: window.__stark.veins.material.uniforms.uMoment.value }; });
  if (momentSeen) break;
}
st = await state();
check(st.top1.label === DEMO.to, `Steer from the phone: ${DEMO.from} → ${st.top1.label}`);
check(momentSeen?.from === DEMO.from && momentSeen.to === DEMO.to && momentSeen.pulse > -0.5,
  `steerMoment ${JSON.stringify(momentSeen)} (the pulse was running down the new path)`);
await shot('steer-moment');
await sleep(4200);
check((await state()).steerMoment === null, 'steerMoment cleared after 4 s');
await fps('Steer (flipped)');

// --- wrap up --------------------------------------------------------------------------------------------------
check(loads === 1, 'the display was never reloaded');
check(errors.length === 0, `no console errors (${errors.length}${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''})`);
console.log('\nframe rate on the display (2560×1440):');
for (const f of fpsTable) console.log(`  ${f.mode.padEnd(30)} ${f.fps.toFixed(1)} fps  ${f.long} frames > 25 ms of ${f.n} (worst ${f.worst.toFixed(1)} ms)`);
console.log(failed ? `\n${failed} check(s) failed` : '\ncc8 demo: all checks passed');
tools.close();
await browser.close();
process.exitCode = failed ? 1 : 0;
