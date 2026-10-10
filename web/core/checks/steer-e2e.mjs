// Steer end to end (CC-7): the real display page, an iPad host and phone guests on the real controller UI, through
// the relay. Runs the demo `runs` times on the same pages without reloading:
//   host selects ambig_wolf → guest takes control, drags the strongest top-1 slider 1× → 0× (the Brain must move
//   DURING the drag), zeroes 3 more until the answer flips → the code box shows the equivalent program → code mode:
//   Reset, type channel[top(5, "timber wolf")] = 0, Run → the same flip → a second phone joins mid-steer and sees
//   the state at once → the host switches image and steering clears everywhere.
// usage (repo root):  BASE=https://… STARK_KEY_FILE=~/.config/stark/host-key node web/core/checks/steer-e2e.mjs [runs] [shotDir]
//   (or STARK_HOST_KEY=… for a local server). The key is never printed.
// Phones and the iPad are Playwright device presets on Chromium (viewport, touch, UA), not physical devices.
import { chromium, devices } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const BASE = (process.env.BASE ?? 'http://localhost:3000').replace(/\/+$/, '');
const KEY = process.env.STARK_HOST_KEY ?? readFileSync(process.env.STARK_KEY_FILE.replace(/^~/, homedir()), 'utf8').trim();
const RUNS = Number(process.argv[2] ?? 3);
const SHOTS = process.argv[3] ?? null;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed += 1; };
const errors = [];
const toastSeen = [];
const dragStats = [];
const watch = (page, name) => {
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${name}: pageerror ${e.message}`));
};
const phone = ({ defaultBrowserType, ...d }) => d; // device presets on Chromium

const DEMO = { image: 'ambig_wolf', from: 269, fromLabel: 'timber wolf', to: 279, toLabel: 'Arctic fox', sliders: [31, 240, 449, 1220] };
const PROGRAM = 'channel[top(5, "timber wolf")] = 0';

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const display = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
watch(display, 'display');
await display.goto(`${BASE}/display`);
await display.waitForFunction(() => window.__starkReady === true && window.__stark.relay?.room, null, { timeout: 60000 });
const room = await display.evaluate(() => window.__stark.relay.room);
await display.evaluate(() => { window.__rx = []; window.__stark.relay.socket.on('steer-update', (p) => window.__rx.push({ seq: p.seq, from: p.from, n: p.set?.length, code: !!p.code, t: performance.now() })); });
console.log(`room ${room} on ${BASE}`);

const hostCtx = await browser.newContext(phone(devices['iPad Pro 11']));
const host = await hostCtx.newPage();
watch(host, 'host');
await host.goto(`${BASE}/controller?room=${room}&role=host&key=${encodeURIComponent(KEY)}`);
const guestCtx = await browser.newContext(phone(devices['iPhone 13']));
const guest = await guestCtx.newPage();
watch(guest, 'guest');
await guest.goto(`${BASE}/controller?room=${room}`);
await host.waitForSelector('#gallery-grid [data-image-id]', { timeout: 30000 });

const ds = () => display.evaluate(() => {
  const s = window.__stark; const st = s.steer.session.state;
  return { image: s.api.state.image.id, ready: s.steer.session.ready, top1: s.api.state.top1?.classId, top1Label: s.api.state.top1?.label,
    score: s.api.state.top1?.score, active: st?.active ?? false, scales: st?.scales ?? [], source: st?.source, code: st?.code,
    caption: s.panel.caption, fps: s.stats.fps, driver: s.api.state.driver?.label ?? null };
});
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

async function selectImage(id) {
  await host.click(`#gallery-grid [data-image-id="${id}"]`);
  await display.waitForFunction((i) => window.__stark.api.state.image.id === i && window.__stark.steer.session.imageId === i, id, { timeout: 30000 });
  // the judge watches the pulse first; then a second for the frame-rate counter to forget the image switch
  await display.waitForFunction(() => window.__stark.api.state.playback.state === 'done', null, { timeout: 30000 });
  await sleep(1200);
}

async function openSteer(page) {
  await page.waitForSelector('#explore-tabs:not([hidden]) [data-panel="steer"]', { timeout: 20000 });
  await page.click('[data-panel="steer"]');
  await page.waitForSelector('#steer-panel [data-input-mode="sliders"]', { timeout: 20000 }).catch(async (err) => {
    const card = await page.evaluate(() => [...document.querySelectorAll('#steer-panel .steer-state-card *')].map((e) => e.textContent).join(' | '));
    const d = await display.evaluate(() => ({ st: window.__stark.steer.session.state && { seq: window.__stark.steer.session.state.seq, img: window.__stark.steer.session.state.imageId }, caps: window.__stark.api.state.capabilities.steer, img: window.__stark.api.state.image.id }));
    console.log('steer panel card:', card, JSON.stringify(d));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/debug-panel.png` });
    throw err;
  });
  await page.click('#steer-panel [data-input-mode="sliders"]'); // a previous run may have left it in code mode
  await page.waitForSelector('#steer-panel .steer-row input', { timeout: 20000 });
}

/** Drag one slider from its current value to 0 with real pointer events; samples the display while still pressed. */
async function dragToZero(page, channel, { samples = false } = {}) {
  const input = page.locator(`#steer-panel .steer-row[data-channel="${channel}"] input`).first();
  await input.scrollIntoViewIfNeeded();
  const box = await input.boundingBox();
  const value = Number(await input.inputValue());
  const xAt = (v) => box.x + 10 + (box.width - 20) * (v / 3); // thumb centre, 0–3 range
  const y = box.y + box.height / 2;
  await page.mouse.move(xAt(value), y);
  await page.mouse.down();
  const seen = [];
  const steps = 24;
  if (samples) await display.evaluate(() => {
    window.__fr = []; let last = performance.now(); window.__frOn = true;
    const loop = (t) => { window.__fr.push(t - last); last = t; if (window.__frOn) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(xAt(value * (1 - i / steps)), y);
    await sleep(60); // ≈ 1.4 s for the whole drag, like a thumb
    if (samples && i % 4 === 0) {
      seen.push(await display.evaluate((leaf) => ({
        v: window.__stark.veins.valueOf(leaf), scale: window.__stark.steer.session.scales.get(31) ?? 1,
        probe: window.__stark.steer.session.state?.probe, caption: window.__stark.panel.caption, fps: window.__stark.stats.fps,
      }), await display.evaluate((k) => window.__stark.tips.get(k)?.node.id, DEMO.from)));
      if (i === steps / 2) await shot(display, 'mid-drag');
    }
  }
  await page.mouse.up();
  if (samples) seen.frames = await display.evaluate(() => { window.__frOn = false; return window.__fr.slice(1); });
  await display.waitForFunction((c) => window.__stark.steer.session.scales.get(c) === 0, channel, { timeout: 5000 }).catch(async (err) => {
    console.log('display received:', JSON.stringify(await display.evaluate(() => window.__rx.slice(-6))), 'state seq', await display.evaluate(() => window.__stark.steer.session.state?.seq), 'driver', await display.evaluate(() => window.__stark.api.state.driver?.label));
    throw err;
  });
  return seen;
}

for (let run = 1; run <= RUNS; run++) {
  console.log(`--- run ${run}`);
  await selectImage(DEMO.image);
  let d = await ds();
  check(d.ready && d.top1 === DEMO.from && !d.active, `${DEMO.image} selected by the host, Steer ready, top-1 ${d.top1Label}`);
  await openSteer(guest);
  const take = guest.locator('#steer-panel .steer-take:visible, #take-control-bottom:visible').first();
  if (await take.count()) await take.click();
  await display.waitForFunction(() => window.__stark.api.state.driver?.label?.startsWith('Guest'), null, { timeout: 10000 });
  if (run === 1) { await shot(display, 'before'); await shot(guest, 'phone-before'); }
  // Codex's controller can leave a "Tap to take control again" toast over the first slider while the phone is
  // already driving (reported to Codex); a person would tap it away, so the script does too
  const toast = guest.getByText('Tap to take control again');
  if (await toast.isVisible().catch(() => false)) {
    toastSeen.push(run);
    await toast.click();
    await toast.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // 1. the strongest top-1 slider, 1× → 0×, sampled while the finger is down
  const seen = await dragToZero(guest, DEMO.sliders[0], { samples: run === 1 || true });
  const vals = seen.map((s) => s.v);
  const moving = vals.length >= 3 && vals.every((v, i) => i === 0 || v < vals[i - 1] - 1e-4);
  check(moving, `the Brain moves during the drag (timber wolf vein value: ${vals.map((v) => v.toFixed(3)).join(' → ')})`);
  check(seen.some((s) => s.probe === DEMO.sliders[0] && /Channel #31 responds here/.test(s.caption ?? '')), `probe view while dragging ("${seen.find((s) => s.probe !== null)?.caption}")`);
  const fr = seen.frames;
  const dragFps = fr.length / (fr.reduce((a, b) => a + b, 0) / 1000);
  const long = fr.filter((x) => x > 25).length;
  dragStats.push({ fps: dragFps, long, n: fr.length, worst: Math.max(...fr) });
  check(dragFps >= 55, `display during the drag: ${dragFps.toFixed(1)} fps over ${fr.length} frames, ${long} frames > 25 ms (worst ${Math.max(...fr).toFixed(1)} ms)`);
  d = await ds();
  check(d.top1 === DEMO.from, `31 at 0×: still ${d.top1Label} (${d.score.toFixed(3)})`);

  // 2. three more until it flips
  const path = [];
  for (const c of DEMO.sliders.slice(1)) { await dragToZero(guest, c); await sleep(150); d = await ds(); path.push(`${c}→${d.top1Label} ${d.score.toFixed(2)}`); }
  check(d.top1 === DEMO.to, `zeroing ${DEMO.sliders.slice(1).join(', ')} flips the answer: ${path.join(' · ')}`);
  await guest.waitForFunction((l) => document.querySelector('.steer-top-label')?.textContent === l, DEMO.toLabel, { timeout: 5000 });
  if (run === 1) { await sleep(400); await shot(display, 'after-flip'); await shot(guest, 'phone-after-flip'); }
  const eq = (await guest.textContent('.steer-equivalent pre'))?.trim();
  check(eq === 'channel[31, 240, 449, 1220] = 0', `the code box shows the equivalent program: ${JSON.stringify(eq)}`);

  // 3. code mode: Reset, a broken program (run 1), then the real one
  await guest.click('[data-input-mode="code"]');
  await guest.click('#steer-panel .steer-reset');
  await display.waitForFunction(() => window.__stark.steer.session.state?.active === false, null, { timeout: 5000 });
  check((await ds()).top1 === DEMO.from, 'Reset: back to the baseline');
  if (run === 1) {
    await guest.fill('#steer-code-input', 'channel[top(5, "timbr wolf")] = 0');
    await guest.click('#steer-panel .steer-run');
    await guest.waitForFunction(() => document.querySelector('.steer-code-status')?.dataset.kind === 'error', null, { timeout: 5000 });
    const msg = await guest.textContent('.steer-code-status');
    check(/timber wolf/.test(msg) && !(await ds()).active, `code error shown, scales unchanged: "${msg.trim()}"`);
    await guest.evaluate(() => document.querySelector('#steer-code-input').scrollIntoView({ block: 'center' }));
    await sleep(300);
    await shot(guest, 'phone-code-error');
  }
  await guest.fill('#steer-code-input', PROGRAM);
  await guest.click('#steer-panel .steer-run');
  await display.waitForFunction((k) => window.__stark.api.state.top1?.classId === k && window.__stark.steer.session.state?.source === 'code', DEMO.to, { timeout: 5000 });
  d = await ds();
  check(d.top1 === DEMO.to && d.code === 'channel[31, 240, 449, 894, 1220] = 0', `code ${PROGRAM} → ${d.top1Label} ${d.score.toFixed(3)} (${d.code})`);

  // 4. a second phone joins mid-steer
  const lateCtx = await browser.newContext(phone(devices['iPhone 15 Pro']));
  const late = await lateCtx.newPage();
  watch(late, `late-phone-${run}`);
  const t0 = Date.now();
  await late.goto(`${BASE}/controller?room=${room}`);
  await openSteer(late);
  await late.waitForFunction((l) => document.querySelector('.steer-top-label')?.textContent === l, DEMO.toLabel, { timeout: 10000 });
  const lateCode = (await late.textContent('.steer-equivalent pre'))?.trim();
  check(lateCode === d.code, `second phone joins mid-steer and shows ${DEMO.toLabel} + the program at once (${Date.now() - t0} ms from navigation)`);
  if (run === 1) await shot(late, 'phone-late-join');

  // 5. the host switches image: steering clears
  await selectImage('clean_retriever');
  d = await ds();
  check(!d.active && d.top1 === 207, `host switched to clean_retriever: steering cleared (${d.top1Label})`);
  await guest.waitForFunction(() => document.querySelector('.steer-top-label')?.textContent === 'golden retriever', null, { timeout: 10000 });
  await late.waitForFunction(() => document.querySelector('.steer-top-label')?.textContent === 'golden retriever', null, { timeout: 10000 });
  check(true, 'both phones show the new image\'s baseline');
  await lateCtx.close();
}

// the probe view, held mid-drag (for the screenshot)
if (SHOTS) {
  await selectImage(DEMO.image);
  await openSteer(guest);
  const take = guest.locator('#steer-panel .steer-take:visible, #take-control-bottom:visible').first();
  if (await take.count()) await take.click();
  await guest.click('[data-input-mode="sliders"]');
  const input = guest.locator('#steer-panel .steer-row[data-channel="1220"] input').first();
  const box = await input.boundingBox();
  const y = box.y + box.height / 2;
  await guest.mouse.move(box.x + 10 + (box.width - 20) / 3, y);
  await guest.mouse.down();
  await guest.mouse.move(box.x + 10 + (box.width - 20) * 0.6, y, { steps: 8 });
  await sleep(800);
  await shot(display, 'probe');
  await guest.mouse.up();
}

if (toastSeen.length) console.log(`note: the stale "Tap to take control again" toast covered the slider in runs ${toastSeen.join(', ')}`);
console.log(errors.length ? `CONSOLE ERRORS (${errors.length}):\n` + errors.join('\n') : 'console errors: 0');
console.log(failed ? `${failed} FAILED` : `steer e2e: ${RUNS} runs passed`);
await browser.close();
process.exitCode = failed || errors.length ? 1 : 0;
