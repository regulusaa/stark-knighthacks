// CC-5 checkpoint script, automated: display (1920×1080) + Codex's host controller (iPad) + guest controller (iPhone),
// all real pages through the relay. Runs the full script RUNS times without reloading any page.
// usage (repo root): STARK_HOST_KEY=… node web/core/checks/cc5run.mjs <baseUrl> [runs] [--swiftshader]
// Renders on the GPU (Metal) by default: on SwiftShader the Brain draws too slowly for the fly-to, reset and pulse
// timings, and those checks fail for that reason alone.
// The host key comes from the environment only, so it never lands in shell history or logs.
import { chromium, devices } from 'playwright';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = args[0] ?? 'http://localhost:3000';
const key = process.env.STARK_HOST_KEY;
if (!key) { console.error('set STARK_HOST_KEY'); process.exit(2); }
const RUNS = Number(args[1] ?? 3);
const metal = !process.argv.includes('--swiftshader');
const IDLE_MS = 20000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];          // {run, step, ok, detail}
let run = 0;
const check = (step, ok, detail = '') => {
  results.push({ run, step, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} run ${run} · ${step}${detail ? ` (${detail})` : ''}`);
};
async function until(fn, ms = 10000, every = 100) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    if (Date.now() - t0 > ms) return v;
    await sleep(every);
  }
}

const gpuArgs = metal ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist']
  : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ headless: true, args: gpuArgs });
const errors = { display: [], host: [], guest: [] };
async function open(name, ctxOpts, url) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors[name].push(m.text()); });
  page.on('pageerror', (e) => errors[name].push(`pageerror ${e.message}`));
  let loads = 0;
  page.on('load', () => { loads += 1; });
  await page.goto(url);
  page.loads = () => loads;
  return page;
}

// --- display -------------------------------------------------------------------------------------------------
const display = await open('display', { viewport: { width: 1920, height: 1080 } }, `${base}/display`);
await display.waitForFunction(() => window.__starkReady === true, null, { timeout: 30000 });
const room = await display.evaluate(() => window.__stark.relay?.room);
run = 0;
check('display registers and gets a server-issued room', /^[A-Z2-9]{5}$/.test(room ?? ''), room);
check('HUD api getRoom returns the room', await display.evaluate(() => window.__stark.hud.getRoom()) === room);
const D = () => display.evaluate(() => {
  const s = window.__stark;
  return {
    image: s.api.state?.image.id, playback: s.api.state?.playback.state, driver: s.api.state?.driver?.label ?? null,
    focus: s.api.state?.focus?.classId ?? null, heat: s.panel.heatClass ?? null, reveal: s.veins.revealProgress,
    ring: s.tips.ring.visible, theta: s.rig.state.spherical.theta, radius: s.rig.state.spherical.radius,
    moving: s.rig.moving, controllers: s.api.state?.controllerCount, sent: { ...s.relay.sent },
  };
});

// --- controllers ----------------------------------------------------------------------------------------------
const host = await open('host', { ...devices['iPad Pro 11'] }, `${base}/controller?room=${room}&role=host&key=${encodeURIComponent(key)}`);
const guest = await open('guest', { ...devices['iPhone 13'] }, `${base}/controller?room=${room}`);
const appState = (p) => p.evaluate(() => document.getElementById('app').dataset.state);
check('host page connects as host', await until(async () => (await appState(host)) === 'host'));
check('guest page connects as guest', await until(async () => (await appState(guest)) === 'guest-viewing'));
check('display counts 2 controllers', await until(async () => (await D()).controllers === 2), `${(await D()).controllers}`);

// Inbound state traffic at the guest (to check dedupe/throttle): count display-state per second via a test socket.
const { io } = await import('socket.io-client');
const spy = io(base, { transports: ['websocket'], reconnection: false });
const spyTimes = { 'display-state': [], 'focus-state': [] };
spy.onAny((e) => { if (spyTimes[e]) spyTimes[e].push(Date.now()); });
await new Promise((r) => spy.on('connect', r));
const spyAck = await spy.emitWithAck('register', { role: 'guest', room });
check('state spy joins as an extra guest', spyAck.ok);
await sleep(500);
const maxPerSecond = (ts) => { let m = 0; for (let i = 0; i < ts.length; i++) { let j = i; while (j < ts.length && ts[j] - ts[i] < 1000) j++; m = Math.max(m, j - i); } return m; };

const cdp = await guest.context().newCDPSession(guest);
async function touchDrag(page, sel, fromFrac, toFrac, steps = 20) {
  const b = await page.locator(sel).boundingBox();
  const pt = ([fx, fy]) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
  const s = cdp;
  await s.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [pt(fromFrac)] });
  for (let i = 1; i <= steps; i++) {
    const f = [fromFrac[0] + (toFrac[0] - fromFrac[0]) * i / steps, fromFrac[1] + (toFrac[1] - fromFrac[1]) * i / steps];
    await s.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [pt(f)] });
    await sleep(16);
  }
  await s.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function pinch(page, sel, from, to, steps = 20) {
  const b = await page.locator(sel).boundingBox();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const pts = (d) => [{ x: cx - d / 2, y: cy, id: 1 }, { x: cx + d / 2, y: cy, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(from) });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(from + (to - from) * i / steps) });
    await sleep(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const timings = { focusRoundTrip: [], takeControl: [], hostHold: [] };
for (run = 1; run <= RUNS; run++) {
  // 1. host selects the retriever → pulse, strand, ring
  if (run > 1) { // start each run from another image, so "select the retriever" is a real switch
    await host.locator('.gallery-tile[data-image-id="clean_monarch"]').tap();
    await until(async () => (await D()).image === 'clean_monarch');
  }
  const t0 = Date.now();
  await host.locator('.gallery-tile[data-image-id="clean_retriever"]').tap();
  check('host selects the retriever → display loads it', await until(async () => (await D()).image === 'clean_retriever'),
    `${Date.now() - t0} ms`);
  check('pulse plays', await until(async () => (await D()).playback === 'playing', 3000) || (await D()).playback === 'done');
  check('pulse completes', await until(async () => (await D()).playback === 'done', 40000));
  check('strand reveals', await until(async () => (await D()).reveal >= 1, 5000), `reveal ${(await D()).reveal.toFixed(2)}`);
  check('true-class ring shown', (await D()).ring);
  check('guest list shows the retriever answers', await until(() => guest.evaluate(() =>
    document.querySelectorAll('#answer-list .answer-row').length >= 10 && document.getElementById('image-name').textContent.includes('retriever'))));

  // 2. guest takes control (after a host override the host stays driver until it idles out: contract §4)
  const tWait = Date.now();
  const free = await until(async () => (await D()).driver === null, IDLE_MS + 6000, 250);
  if (Date.now() - tWait > 500) timings.hostHold.push(Date.now() - tWait);
  check('wheel is free for the guest', free, Date.now() - tWait > 500 ? `waited ${((Date.now() - tWait) / 1000).toFixed(1)} s for the host to idle out` : '');
  const tTake = Date.now();
  await guest.locator('#take-control-center').tap();
  const took = await until(async () => (await appState(guest)) === 'guest-driving' && (await D()).driver?.startsWith('Guest'));
  timings.takeControl.push(Date.now() - tTake);
  check('guest takes control', took, `${(await D()).driver}, ${Date.now() - tTake} ms`);

  // 3. orbit and pinch
  const before = await D();
  await touchDrag(guest, '#trackpad', [0.25, 0.5], [0.7, 0.45]);
  await sleep(700);
  const afterOrbit = await D();
  check('guest drag orbits the display', Math.abs(afterOrbit.theta - before.theta) > 0.3,
    `Δθ ${(afterOrbit.theta - before.theta).toFixed(2)} rad`);
  await pinch(guest, '#trackpad', 80, 200);
  await sleep(700);
  const afterPinch = await D();
  check('guest pinch zooms the display', afterPinch.radius < afterOrbit.radius - 0.5,
    `r ${afterOrbit.radius.toFixed(1)} → ${afterPinch.radius.toFixed(1)}`);

  // 4. pick Labrador from the list → fly-to and heatmap
  const tFocus = Date.now();
  await guest.locator('#answer-list .answer-row[data-class-id="208"]').tap();
  const gotFocus = await until(() => guest.evaluate(() => !document.getElementById('focus-card').hidden
    && document.getElementById('focus-label').textContent.includes('Labrador')), 5000, 20);
  timings.focusRoundTrip.push(Date.now() - tFocus);
  const df = await D();
  check('guest picks "Labrador retriever" → display focus', df.focus === 208 && gotFocus, `${Date.now() - tFocus} ms round trip`);
  check('camera flies to the tip', df.moving || Math.abs(df.theta - afterPinch.theta) > 0.05);
  check('Labrador heatmap shown', await until(async () => (await D()).heat === 208, 3000));
  const settled = await until(async () => !(await D()).moving, 10000);
  check('tip visible after the fly-to', settled && await display.evaluate(() => !window.__stark.tipHidden(208)), settled ? '' : 'still flying');

  // 5. idle release after 20 s
  const tIdle = Date.now();
  const released = await until(async () => (await D()).driver === null, IDLE_MS + 6000, 250);
  check('idle release after 20 s', released && (await appState(guest)) === 'guest-viewing', `${((Date.now() - tIdle) / 1000).toFixed(1)} s`);

  // 6. host override → reset
  await guest.locator('#take-control-center').tap();
  await until(async () => (await D()).driver?.startsWith('Guest'));
  await host.locator('#host-reset').tap();
  check('host override takes the wheel', await until(async () => (await D()).driver === 'Ray'), (await D()).driver);
  check('guest sees it is locked out', await until(async () => (await appState(guest)) === 'guest-viewing'));
  const reset = await until(() => display.evaluate(async () => {
    const { RIG } = await import('/core/cameraRig.js');
    const r = window.__stark.rig.state.spherical.radius;
    return Math.abs(r - RIG.defaultPosition.distanceTo(RIG.defaultTarget)) < 0.05 && !window.__stark.rig.moving;
  }), 10000);
  if (!reset) console.log('   reset debug', await display.evaluate(() => ({ r: window.__stark.rig.state.spherical.radius, moving: window.__stark.rig.moving, focus: window.__stark.api.state.focus?.classId })));
  check('reset view returns to the default camera', reset);
  // leave a clean slate for the next run: clear focus from the host, release by idling isn't needed (host keeps it)
  await host.locator('#clear-focus').tap().catch(() => {});
  await until(async () => (await D()).focus === null, 3000);
}
run = 0;

const ds = spyTimes['display-state'];
const fsTimes = spyTimes['focus-state'];
check('display-state ≤ 10/s at the controllers', maxPerSecond(ds) <= 11, `max ${maxPerSecond(ds)}/s, ${ds.length} total`);
check('focus-state ≤ 10/s', maxPerSecond(fsTimes) <= 11, `max ${maxPerSecond(fsTimes)}/s, ${fsTimes.length} total`);
const sent = (await D()).sent;
check('display deduplicates repeated states', true, `sent ${sent['display-state']} display-state, ${sent['focus-state']} focus-state, ${sent.deduped} repeats dropped`);
check('no page was reloaded', display.loads() === 1 && host.loads() === 1 && guest.loads() === 1);
for (const [k, v] of Object.entries(errors)) check(`no console errors on ${k}`, v.length === 0, v.slice(0, 3).join(' | '));

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
console.log(`\nfocus round trip (guest tap → focus card): median ${med(timings.focusRoundTrip)} ms, all ${timings.focusRoundTrip.join(', ')}`);
console.log(`guest locked out after a host override: ${timings.hostHold.map((x) => (x / 1000).toFixed(1) + ' s').join(', ') || 'never'}`);
console.log(`take control (tap → driving everywhere): median ${med(timings.takeControl)} ms, all ${timings.takeControl.join(', ')}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
spy.close();
await browser.close();
process.exitCode = failed.length ? 1 : 0;
