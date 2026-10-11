// Per-frame render cost (render + gl.finish, so GPU time is included) per phase, vsync on; and image-switch JS cost.
// usage (repo root): node web/core/checks/prof2.mjs [baseUrl] [dpr] [--no-glow]
import { chromium } from 'playwright';
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const base = args[0] ?? 'http://localhost:3000';
const dpr = Number(args[1] ?? 1);
const noGlow = process.argv.includes('--no-glow');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: dpr });
const errors = [];
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(`${base}/display?offline=1&image=clean_monarch&pulseAt=done`);
await p.waitForFunction(() => window.__starkReady === true, null, { timeout: 30000 });
await sleep(1500);
if (noGlow) await p.evaluate(() => window.__stark.glow?.set(false));
await p.evaluate(() => {
  const s = window.__stark;
  const gl = s.renderer.getContext();
  window.__prof = { cost: [], frames: [], marks: [], hooks: {} };
  // one sample per frame: the whole frame's rendering (with glow: the scene, the bloom passes and the overlay)
  const owner = s.glow ?? s.renderer;
  const render = owner.render.bind(owner);
  owner.render = (...a) => {
    const t0 = performance.now(); render(...a); gl.finish();
    window.__prof.cost.push([t0, performance.now() - t0]);
  };
  let last = performance.now();
  const loop = (t) => { window.__prof.frames.push([t, t - last]); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  // time the Brain rebuild on image change (the onImageLoaded handlers run synchronously inside loadImage)
  for (const k of ['build']) {
    for (const [name, obj] of [['veins', s.veins], ['tips', s.tips], ['labels', s.labels]]) {
      const f = obj[k].bind(obj);
      obj[k] = (...a) => { const t = performance.now(); const r = f(...a); (window.__prof.hooks[name] ??= []).push(performance.now() - t); return r; };
    }
  }
  const load = s.api.loadImage.bind(s.api);
  s.api.loadImage = async (...a) => { const t = performance.now(); const r = await load(...a); (window.__prof.hooks.loadImage ??= []).push(performance.now() - t); return r; };
});
const mark = (name) => p.evaluate((n) => window.__prof.marks.push([performance.now(), n]), name);
const s = (code) => p.evaluate(code);

await mark('idle (monarch)'); await sleep(2000);
await mark('select retriever'); await s(() => window.__stark.api.loadImage('clean_retriever')); await sleep(300);
await mark('pulse'); await p.waitForFunction(() => window.__stark.api.state.playback.state === 'done', null, { timeout: 30000 });
await mark('reveal'); await sleep(1500);
await mark('idle (retriever)'); await sleep(1500);
await mark('focus 208 (fly)'); await s(() => window.__stark.api.focusTip(208)); await sleep(2500);
await mark('orbit, focused');
for (let i = 0; i < 90; i++) { await s(() => window.__stark.api.orbit(0.01, 0.002)); await sleep(16); }
await sleep(500);
await mark('clear focus (fly back)'); await s(() => window.__stark.api.clearFocus()); await sleep(2500);
await mark('orbit, default');
for (let i = 0; i < 90; i++) { await s(() => window.__stark.api.orbit(0.01, 0.002)); await sleep(16); }
await sleep(500);
await mark('end');

const prof = await p.evaluate(() => ({ ...window.__prof, pr: window.__stark.stats.pixelRatio }));
console.log(`2560×1440 @${dpr}x (render pixel ratio ${prof.pr}), glow ${noGlow ? 'off' : 'on'}; cost = the frame's rendering + gl.finish`);
console.log('phase                     fps   frame p95/worst   cost p50   p95  worst');
for (let i = 0; i < prof.marks.length - 1; i++) {
  const [t0, name] = prof.marks[i]; const t1 = prof.marks[i + 1][0];
  const sel = (arr) => arr.filter(([t]) => t > t0 && t <= t1).map(([, d]) => d).sort((a, b) => a - b);
  const f = sel(prof.frames); const c = sel(prof.cost);
  const q = (a, k) => a.length ? a[Math.min(a.length - 1, Math.floor(k * a.length))].toFixed(1) : '-';
  console.log(`${name.padEnd(25)} ${(1000 * f.length / (t1 - t0)).toFixed(0).padStart(4)}   ${q(f, 0.95).padStart(6)} / ${(f.at(-1) ?? 0).toFixed(1).padStart(5)}    ${q(c, 0.5).padStart(6)} ${q(c, 0.95).padStart(5)} ${(c.at(-1) ?? 0).toFixed(1).padStart(6)}`);
}
for (const [k, v] of Object.entries(prof.hooks)) console.log(`${k}: ${v.map((x) => x.toFixed(0)).join(', ')} ms`);
console.log('console errors:', errors.length);
await b.close();
