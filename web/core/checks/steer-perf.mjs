// Steer performance on the display (CC-7): engine apply + cam in the browser, and frame rate while a slider drags.
// usage (repo root, a server running): node web/core/checks/steer-perf.mjs [baseUrl] [dpr]
//   phases on clean_retriever at 2560×1440: idle · drag at 15 Hz (the phone's pace) · values changing every frame
import { chromium } from 'playwright';
const base = process.argv[2] ?? 'http://localhost:3000';
const dpr = Number(process.argv[3] ?? 1);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: dpr });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
p.on('pageerror', (e) => errors.push(e.message));
await p.goto(`${base}/display?offline=1&image=clean_retriever&pulseAt=done`);
await p.waitForFunction(() => window.__starkReady === true && window.__stark.steer.session.ready, null, { timeout: 30000 });
await sleep(1500);

// 1. engine alone, in the browser: apply (5 changed channels) + one cam with the 224² upsample
const engineMs = await p.evaluate(() => {
  const e = window.__stark.steer.session.engine;
  const set = e.topChannels(207, 5).map((c, i) => ({ channel: c.channel, scale: i / 5 }));
  const heat = new Uint8Array(224 * 224);
  for (let i = 0; i < 300; i++) { e.apply(set); e.cam(207, set, heat); }
  const N = 2000;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) { set[0].scale = (i % 100) / 100; e.apply(set); e.cam(e.argmax(), set, heat); }
  return (performance.now() - t0) / N;
});

await p.evaluate(() => {
  const s = window.__stark;
  const gl = s.renderer.getContext();
  window.__prof = { cost: [], frames: [], steer: [], marks: [] };
  const render = s.renderer.render.bind(s.renderer);
  s.renderer.render = (scene, cam) => { const t0 = performance.now(); render(scene, cam); gl.finish(); window.__prof.cost.push([t0, performance.now() - t0]); };
  // everything Steer does in a frame: apply, answers, Brain targets, labels, live heatmap upload
  const tick = s.steer.tick.bind(s.steer);
  s.steer.tick = () => { const t0 = performance.now(); tick(); window.__prof.steer.push([t0, performance.now() - t0]); };
  let last = performance.now();
  const loop = (t) => { window.__prof.frames.push([t, t - last]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
const mark = (name) => p.evaluate((n) => window.__prof.marks.push([performance.now(), n]), name);

await mark('idle'); await sleep(1500);
// a judge's drag: the strongest top-1 slider 1 → 0 over 2 s at 15 Hz (with the probe), then 4 more channels zeroed
await mark('drag @15 Hz');
await p.evaluate(async () => {
  const ss = window.__stark.steer.session;
  const top = ss.state.sets.top1.channels.map((c) => c.channel);
  let seq = 0;
  const set = [];
  const send = (probe) => ss.update({ seq: ++seq, set: set.map((x) => ({ ...x })), probe, from: 'perf' });
  for (let k = 0; k < top.length; k++) {
    set.push({ channel: top[k], scale: 1 });
    for (let i = 1; i <= 30; i++) { set[k].scale = 1 - i / 30; send(top[k]); await new Promise((r) => setTimeout(r, 1000 / 15)); }
  }
  send(null);
});
await sleep(500);
await mark('every frame (60 Hz)');
await p.evaluate(async () => {
  const ss = window.__stark.steer.session;
  const top = ss.state.sets.top2.channels.map((c) => c.channel);
  let seq = 1000;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = (t) => {
      const k = (t - t0) / 3000;
      ss.update({ seq: ++seq, set: top.map((c, i) => ({ channel: c, scale: 1.5 + 1.5 * Math.sin(6.283 * (k * 2 + i / 5)) })), probe: null, from: 'perf' });
      if (t - t0 < 3000) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
});
await mark('reset (springs back)'); await p.evaluate(() => window.__stark.steer.reset()); await sleep(1000);
await mark('end');

const prof = await p.evaluate(() => ({ ...window.__prof, pr: window.__stark.stats.pixelRatio, top1: window.__stark.api.state.top1.label }));
console.log(`engine in Chrome: apply + cam (5 channels, 224² upsample) ${engineMs.toFixed(3)} ms per call`);
console.log(`2560×1440 @${dpr}x (render pixel ratio ${prof.pr}); cost = render + gl.finish; steer = the whole Steer tick`);
console.log('phase                     fps   frame p95/worst   cost p50   p95   steer p50   p95  worst');
const rows = [];
for (let i = 0; i < prof.marks.length - 1; i++) {
  const [t0, name] = prof.marks[i]; const t1 = prof.marks[i + 1][0];
  const sel = (arr) => arr.filter(([t]) => t > t0 && t <= t1).map(([, d]) => d).sort((a, b) => a - b);
  const f = sel(prof.frames); const c = sel(prof.cost); const st = sel(prof.steer);
  const q = (a, x) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * x))] : NaN;
  const fps = f.length / ((t1 - t0) / 1000);
  rows.push({ name, fps });
  console.log(`${name.padEnd(24)} ${fps.toFixed(1).padStart(5)}   ${q(f, 0.95).toFixed(1).padStart(5)} / ${f.at(-1)?.toFixed(1).padStart(5)}   ${q(c, 0.5).toFixed(2).padStart(6)} ${q(c, 0.95).toFixed(2).padStart(5)}   ${q(st, 0.5).toFixed(3).padStart(8)} ${q(st, 0.95).toFixed(3).padStart(5)} ${st.at(-1)?.toFixed(2).padStart(6)}`);
}
console.log(`final top-1 after reset: ${prof.top1}`);
console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.join('\n') : 'console errors: 0');
await b.close();
