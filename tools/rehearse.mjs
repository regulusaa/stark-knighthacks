// Automated rehearsal (CC-10 Part A): plays the whole demo against a running server in the demo order, with the real
// display page open (headed Chromium on the GPU) and a HOST and a GUEST on socket.io-client, exactly as the phones talk.
// Every step asserts on display-state / steer-result / focus-state with a timeout and prints its latency; fps during
// stability and the Steer drag come from window.__starkDebug; any console error on the display is a failure.
//   npm run rehearse -- <url> [--headless] [--reload] [--steer IMAGE_ID]
// The host key comes from STARK_HOST_KEY (or the file named by STARK_KEY_FILE) and is never printed.
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '');
const flag = (f) => args.includes(f);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : d; };
const KEY = process.env.STARK_HOST_KEY
  ?? (process.env.STARK_KEY_FILE ? readFileSync(process.env.STARK_KEY_FILE.replace(/^~/, process.env.HOME), 'utf8').trim() : null);
if (!KEY) { console.error('set STARK_HOST_KEY (or STARK_KEY_FILE) to the host key'); process.exit(2); }
const STEER_IMAGE = opt('--steer', 'ambig_wolf');   // the demo's Steer beat
const STABILITY_IMAGE = 'ambig_cat';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const T0 = Date.now();

// ---- results table ---------------------------------------------------------------------------------------------
const rows = [];
let failed = 0;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
function row(step, ok, ms, note = '') {
  const status = ok === 'warn' ? 'WARN' : ok ? 'ok' : 'FAIL';
  if (ok === false) failed += 1;
  rows.push({ step, status, ms, note });
  const c = status === 'ok' ? green : status === 'WARN' ? yellow : red;
  console.log(`${c(status.padEnd(4))} ${step.padEnd(46)} ${ms === null ? '' : `${String(Math.round(ms)).padStart(5)} ms`}  ${note}`);
}

// ---- display ---------------------------------------------------------------------------------------------------
const browser = await chromium.launch({ headless: flag('--headless'), args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 2560, height: 1440 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(`pageerror ${e.message}`));
await page.goto(`${BASE}/display`);
await page.waitForFunction(() => window.__starkReady === true && window.__stark?.relay?.room, null, { timeout: 60000 });
const ROOM = await page.evaluate(() => window.__stark.relay.room);
{
  const t = Date.now();
  await page.waitForFunction(() => !window.__starkDebug?.preload || window.__starkDebug.preload.finished, null, { timeout: 60000 });
  const p = await page.evaluate(() => window.__starkDebug?.preload ?? null);
  if (p) row('display preload', p.failed === 0, Date.now() - t, `${p.done} files, ${(p.bytes / 1e6).toFixed(1)} MB in ${(p.ms / 1000).toFixed(1)} s${p.failed ? `, ${p.failed} failed` : ''}`);
}
const dbg = () => page.evaluate(() => {
  const d = window.__starkDebug;
  if (d) return { camera: d.camera, fps: d.perf.fps };
  const s = window.__stark;   // builds before CC-10
  return { camera: { position: s.camera.position.toArray(), target: s.rig.state.target.toArray(), moving: s.rig.moving }, fps: s.stats.fps };
});

// ---- controllers -----------------------------------------------------------------------------------------------
async function controller(role) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: true });
  s.latest = {};
  for (const ev of ['display-state', 'steer-result', 'focus-state', 'driver-changed']) s.on(ev, (p) => { s.latest[ev] = p; });
  s.on('error', (e) => { s.lastError = e; });
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
  const ack = await new Promise((res) => s.emit('register', { role, room: ROOM, ...(role === 'host' ? { key: KEY } : {}) }, res));
  if (!ack?.ok) throw new Error(`${role} register failed: ${ack?.error?.code ?? 'no ack'}`);
  s.clientId = ack.clientId;
  return s;
}
/** Resolve with the first `event` payload (or the cached one, unless fresh) that satisfies pred, within ms. */
function until(s, event, pred, ms, { fresh = false } = {}) {
  return new Promise((res, rej) => {
    if (!fresh && s.latest[event] !== undefined && pred(s.latest[event])) return res(s.latest[event]);
    const on = (p) => { if (pred(p)) { clearTimeout(t); s.off(event, on); res(p); } };
    const t = setTimeout(() => { s.off(event, on); rej(new Error(`timeout ${ms} ms waiting for ${event}`)); }, ms);
    s.on(event, on);
  });
}
const host = await controller('host');
const guest = await controller('guest');
const ds = () => host.latest['display-state'];

/** Run one step: fn returns a note (or throws); the step's latency is measured around fn. */
async function step(name, fn) {
  host.lastError = guest.lastError = null;
  const t = performance.now();
  try {
    const note = await fn();
    row(name, true, performance.now() - t, note ?? '');
  } catch (err) {
    const relay = [host, guest].filter((c) => c.lastError).map((c) => `${c === host ? 'host' : 'guest'} relay error ${c.lastError.code}: ${c.lastError.message}`);
    host.lastError = guest.lastError = null;
    row(name, false, performance.now() - t, [err.message, ...relay].join('; '));
  }
}
/** Wait until the camera has stopped: no tween and the same pose for 300 ms (orbit damping included). */
async function settleCamera(ms = 4000) {
  const t = Date.now();
  let last = null; let still = 0;
  while (Date.now() - t < ms) {
    const c = (await dbg()).camera;
    still = !c.moving && last && same(c.position, last) ? still + 100 : 0;
    if (still >= 300) return;
    last = c.position; await sleep(100);
  }
}
const same = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 1e-4);
async function sampleFps(whileFn, maxMs) {
  const out = []; const t = Date.now();
  while (Date.now() - t < maxMs && (await whileFn())) { out.push((await dbg()).fps); await sleep(500); }
  return out.length ? { min: Math.min(...out), avg: out.reduce((a, b) => a + b, 0) / out.length } : null;
}
const fpsNote = (f) => (f ? `fps avg ${f.avg.toFixed(1)}, min ${f.min.toFixed(1)}` : 'fps n/a');
const fpsStats = {};
async function select(id) {
  const answered = until(host, 'display-state', (d) => d.image.id === id, 1000, { fresh: true });
  host.emit('select-image', { imageId: id });
  await answered;
}

console.log(`rehearse ${BASE} · room ${ROOM} · Steer image ${STEER_IMAGE}\n`);

// 1. retriever, pulse completes
await step('1 select retriever → display-state', () => select('clean_retriever'));
await step('1 pulse completes', async () => { await until(host, 'display-state', (d) => d.image.id === 'clean_retriever' && d.playback.state === 'done', 8000); });

// 2. guest takes control
await step('2 guest take-control → driver-changed', async () => {
  guest.emit('take-control', {});
  const p = await until(guest, 'driver-changed', (p) => p.driver?.id === guest.clientId, 500);
  return `driver ${p.driver.label}`;
});

// 3. orbit + zoom for 1 s, then focus the second answer
await step('3 guest orbit + zoom 1 s', async () => {
  for (let i = 0; i < 30; i++) {
    guest.emit('control-orbit', { dx: 0.01, dy: i % 2 ? 0.004 : -0.004 });
    if (i % 3 === 0) guest.emit('control-zoom', { dz: i < 15 ? 0.02 : -0.02 });
    await sleep(33);
  }
  if (guest.lastError) throw new Error(`relay error ${guest.lastError.code}`);
});
await step('3 focus-tip second answer → focus-state', async () => {
  const second = ds().answers.find((a) => a.rank === 2);
  guest.emit('focus-tip', { classId: second.classId });
  const f = await until(guest, 'focus-state', (f) => f?.classId === second.classId, 1000);
  if (!f.heatmapSource) throw new Error(`focus on ${f.label} has no heatmap source`);
  return `${f.label}, heatmap ${f.heatmapSource}`;
});
guest.emit('clear-focus', {});
host.emit('reset-view', {});

// 4. stability
await step('4 stability image + set-mode stability', async () => {
  await select(STABILITY_IMAGE);
  await until(host, 'display-state', (d) => d.image.id === STABILITY_IMAGE && d.capabilities.stability, 3000);
  host.emit('set-mode', { mode: 'stability' });
  const d = await until(host, 'display-state', (d) => d.mode === 'stability' && d.stability?.phase === 'playing', 1500);
  return `${d.stability.runs} runs`;
});
await step('4 stability reaches summary', async () => {
  const runs = ds().stability?.runs ?? 30;
  const watch = until(host, 'display-state', (d) => d.stability?.phase === 'summary', runs * 150 + 3000);
  fpsStats.stability = await sampleFps(async () => ds().stability?.phase === 'playing', runs * 150 + 3000);
  await watch;
  return fpsNote(fpsStats.stability);
});
host.emit('set-mode', { mode: 'normal' });

// 5. retriever, then the adversarial retriever: answer differs, camera still
await step('5 retriever → adversarial: top-1 differs, camera still', async () => {
  await until(host, 'display-state', (d) => d.mode === 'normal', 1500);
  await select('clean_retriever');
  await until(host, 'display-state', (d) => d.image.id === 'clean_retriever' && d.playback.state !== 'idle', 2000);
  host.emit('play-pulse', { skipToEnd: true });
  await until(host, 'display-state', (d) => d.image.id === 'clean_retriever' && d.playback.state === 'done', 3000);
  const top0 = ds().top1.label;
  await settleCamera();
  const before = (await dbg()).camera;
  const pre = { focus: ds().focus?.label ?? null, mode: ds().mode, driver: ds().driver?.label ?? null };
  await select('adv_retriever');
  await until(host, 'display-state', (d) => d.image.id === 'adv_retriever' && d.top1, 2000);
  const path = [];
  for (let i = 0; i < 15; i++) { await sleep(100); path.push((await dbg()).camera.position.map((x) => x.toFixed(2)).join(',')); }
  const after = (await dbg()).camera;
  const top1 = ds().top1.label;
  if (top1 === top0) throw new Error(`top-1 did not change (${top1})`);
  if (!same(before.position, after.position) || !same(before.target, after.target)) {
    throw new Error(`camera moved: ${before.position.map((x) => x.toFixed(2))} → ${[...new Set(path)].join(' → ')} (before: ${JSON.stringify(pre)})`);
  }
  return `${top0} → ${top1}`;
});

// 6. noise view
await step('6 noiseView on, off', async () => {
  host.emit('set-mode', { noiseView: true });
  await until(host, 'display-state', (d) => d.noiseView === true, 1000);
  host.emit('set-mode', { noiseView: false });
  await until(host, 'display-state', (d) => d.noiseView === false, 1000);
});

// 7. medical
{
  const t = performance.now();
  const manifest = await (await fetch(`${BASE}/assets/manifest.json`)).json();
  const med = (manifest.images ?? manifest).find((m) => m.id === 'med_xray_pneumonia');
  if (!med || !med.files?.medical) row('7 medical X-ray', 'warn', null, 'medical is OFF: skipped');
  else {
    await step('7 medical X-ray: independent, no Steer', async () => {
      await select('med_xray_pneumonia');
      const d = await until(host, 'display-state', (d) => d.image.id === 'med_xray_pneumonia' && d.answers.length > 0, 3000);
      if (d.scoreKind !== 'independent') throw new Error(`scoreKind ${d.scoreKind}`);
      if (d.capabilities.steer !== false) throw new Error('capabilities.steer is not false');
      return `top ${d.top1?.label}`;
    });
  }
  void t;
}

// 8. Steer: the flip set as slider drags, then as code, then reset
const steerJson = await (await fetch(`${BASE}/assets/${STEER_IMAGE}/steer.json`)).json();
const flip = steerJson.flip;
let seq = 1;
let flippedTo = null;
await step(`8 select ${STEER_IMAGE}, Steer ready`, async () => {
  if (ds().driver?.id !== guest.clientId) {   // the guest's control may have idled out during the other beats
    guest.emit('take-control', {});
    await until(guest, 'driver-changed', (p) => p.driver?.id === guest.clientId, 1000);
  }
  await select(STEER_IMAGE);
  await until(host, 'display-state', (d) => d.image.id === STEER_IMAGE && d.capabilities.steer === true, 8000);
  await until(host, 'display-state', (d) => d.image.id === STEER_IMAGE && d.playback.state === 'done', 8000);   // the presenter lets the pulse finish
  return `flip set n=${flip.n}: ${flip.channels.join(', ')} → ${flip.toLabel}`;
});
await step('8 slider drags (15/s) → top1Changed + steerMoment', async () => {
  const set = [];
  const watch = until(guest, 'steer-result', (r) => r.result?.top1Changed === true, 5000 + flip.n * 600);
  const drag = (async () => {
    for (const ch of flip.channels) {
      const entry = { channel: ch, scale: 1 };
      set.push(entry);
      for (const scale of [0.75, 0.5, 0.25, 0]) {
        entry.scale = scale;
        guest.emit('steer-update', { seq: seq++, set: set.map((e) => ({ ...e })), probe: null });
        await sleep(1000 / 15);
      }
    }
  })();
  fpsStats.steer = await sampleFps(async () => { await sleep(0); return true; }, flip.n * 4 * 67 + 400);
  await drag;
  const r = await watch;
  flippedTo = r.result.top1.label;
  const d = await until(host, 'display-state', (d) => d.steerMoment, 1500);
  return `${r.result.baselineTop1.label} → ${flippedTo} (steerMoment ${d.steerMoment.from?.label ?? d.steerMoment.from} → ${d.steerMoment.to?.label ?? d.steerMoment.to}); ${fpsNote(fpsStats.steer)}`;
});
await step('8 steer-reset → baseline', async () => {
  guest.emit('steer-reset', {});
  await until(guest, 'steer-result', (r) => r.active === false && r.result?.top1Changed === false, 1500);
});
await step('8 same flip as a code program', async () => {
  const code = flip.channels.map((c) => `channel[${c}] = 0`).join('\n');
  guest.emit('steer-update', { seq: seq++, code, probe: null });
  const r = await until(guest, 'steer-result', (r) => r.source === 'code' && r.active, 2000);
  if (r.error) throw new Error(`program error: ${r.error.message}`);
  if (r.result.top1.label !== flippedTo) throw new Error(`code gives ${r.result.top1.label}, sliders gave ${flippedTo}`);
  return `→ ${r.result.top1.label}`;
});
await step('8 steer-reset → baseline again', async () => {
  guest.emit('steer-reset', {});
  const r = await until(guest, 'steer-result', (r) => r.active === false && r.result?.top1Changed === false, 1500);
  return `top-1 ${r.result.top1.label}`;
});

// 9. reset view; final state sane
await step('9 reset-view; final display-state sane', async () => {
  host.emit('reset-view', {});
  await sleep(1500);
  const d = ds();
  const bad = [];
  if (d.image.id !== STEER_IMAGE) bad.push(`image ${d.image.id}`);
  if (d.mode !== 'normal') bad.push(`mode ${d.mode}`);
  if (d.focus) bad.push('focused');
  if (d.playback.state !== 'done') bad.push(`playback ${d.playback.state}`);
  if (d.steer?.active) bad.push('steering');
  if (!(await page.evaluate(() => window.__stark.relay.socket.connected))) bad.push('display offline');
  if (bad.length) throw new Error(bad.join(', '));
  return `controllers ${d.controllerCount}`;
});

row('display console errors', consoleErrors.length === 0, null, consoleErrors.length ? consoleErrors.slice(0, 3).join(' | ') : '0');
const total = Date.now() - T0;
row('total time < 90 s', total < 90000, total);

host.close(); guest.close();
await browser.close();
console.log(failed ? red(`\nREHEARSE FAILED: ${failed} step(s)`) : green('\nREHEARSE PASSED'));
process.exitCode = failed ? 1 : 0;
