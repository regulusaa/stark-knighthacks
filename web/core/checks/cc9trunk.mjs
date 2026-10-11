// CC-9 trunk interior: frame rate full vs reduced (2560×1440, pixel ratio 1 and 1.5, glow on), GPU memory across
// 5 enter/exit cycles (renderer.info before and after), and the DONE screenshots.
// usage (repo root, a server running): node web/core/checks/cc9trunk.mjs [baseUrl] [shotDir]
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://localhost:3000';
const SHOTS = process.argv[3] ?? null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed += 1; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

async function open(dpr) {
  const p = await browser.newPage({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: dpr });
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') p.errors.push(m.text()); });
  await p.goto(`${base}/display?offline=1&image=clean_retriever&pulseAt=done`);
  await p.waitForFunction(() => window.__starkReady === true && window.__stark.api.state.capabilities.steer, null, { timeout: 60000 });
  await sleep(800);
  return p;
}
const fps = (p, ms = 3000) => p.evaluate((ms) => new Promise((done) => {
  const out = []; let last = performance.now(); const t0 = last;
  const loop = (t) => { out.push(t - last); last = t; if (t - t0 < ms) requestAnimationFrame(loop); else done(out.slice(1)); };
  requestAnimationFrame(loop);
}), ms).then((fr) => ({ fps: fr.length / (fr.reduce((a, b) => a + b, 0) / 1000), long: fr.filter((x) => x > 25).length, n: fr.length, worst: Math.max(...fr) }));
const fmt = (f) => `${f.fps.toFixed(1)} fps, ${f.long}/${f.n} frames > 25 ms (worst ${f.worst.toFixed(1)} ms)`;
const setMode = (p, m) => p.evaluate((m) => window.__stark.api.setMode(m), m);
const info = (p) => p.evaluate(() => { const i = window.__stark.renderer.info; return { geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs.length }; });

const rows = [];
for (const dpr of [1, 1.5]) {
  const p = await open(dpr);
  const pr = await p.evaluate(() => window.__stark.renderer.getPixelRatio());
  rows.push([`normal @${pr}x`, await fps(p)]);
  await setMode(p, { mode: 'trunk' });
  await sleep(1600);
  rows.push([`trunk full @${pr}x`, await fps(p)]);
  // the pulse climbing the column
  await p.evaluate(() => window.__stark.api.replay());
  rows.push([`trunk full, pulse @${pr}x`, await fps(p, 2500)]);
  if (dpr === 1 && SHOTS) {
    await p.evaluate(() => window.__stark.trunk.freezeAt(0.45));
    await sleep(150);
    await p.screenshot({ path: `${SHOTS}/trunk-pulse.png` });
  }
  await p.evaluate(() => window.__stark.api.jumpToEnd());
  if (dpr === 1 && SHOTS) { await sleep(150); await p.screenshot({ path: `${SHOTS}/trunk-full.png` }); }
  await setMode(p, { layerMode: 'reduced' });
  await sleep(1200);
  rows.push([`trunk reduced @${pr}x`, await fps(p)]);
  if (dpr === 1 && SHOTS) await p.screenshot({ path: `${SHOTS}/trunk-reduced.png` });
  await setMode(p, { layerMode: 'full' });
  if (dpr === 1) {
    // the Steer-linked top slab: zero the top-1's strongest channels while inside
    await sleep(900);
    await p.keyboard.press('Shift+F');
    await sleep(500);
    const top = await p.evaluate(() => { const b = window.__stark.interior.built; const a = b.valAttr.array; let d = 0; for (let i = 0; i < 49; i++) d = Math.max(d, Math.abs(a[b.topStart + i] - b.topBase[i])); return { d, label: b.steerLabel.visible, steer: window.__stark.api.state.capabilities.steer }; });
    check(top.steer && top.label && top.d > 0.01, `Steer inside the interior: top slab follows it (max height change ${top.d.toFixed(3)}), "Steer edits this layer" shown`);
    if (SHOTS) await p.screenshot({ path: `${SHOTS}/trunk-steer.png` });
    await p.keyboard.press('x');
    await sleep(400);
    const back = await p.evaluate(() => { const b = window.__stark.interior.built; const a = b.valAttr.array; let d = 0; for (let i = 0; i < 49; i++) d = Math.max(d, Math.abs(a[b.topStart + i] - b.topBase[i])); return { d, label: b.steerLabel.visible }; });
    check(back.d === 0 && !back.label, 'Steer reset: the top slab is the atlas again, label hidden');
    await setMode(p, { mode: 'normal' });
    await sleep(1600);

    // GPU memory across 5 enter/exit cycles (the column is built once per image, then reused)
    const before = await info(p);
    for (let i = 0; i < 5; i++) {
      await setMode(p, { mode: 'trunk' }); await sleep(1500);
      await setMode(p, { mode: 'normal' }); await sleep(1500);
    }
    const after = await info(p);
    check(JSON.stringify(before) === JSON.stringify(after), `5 enter/exit cycles: renderer.info before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
    // and across image switches: a new image's column replaces the old one
    const s0 = await info(p);
    for (const id of ['ambig_cat', 'clean_retriever']) {
      await p.evaluate((i) => window.__stark.api.loadImage(i), id);
      await p.waitForFunction(() => window.__stark.api.state.playback.state !== 'idle', null, { timeout: 10000 });
      await p.evaluate(() => window.__stark.api.jumpToEnd());
      await setMode(p, { mode: 'trunk' }); await sleep(1500);
      await setMode(p, { mode: 'normal' }); await sleep(1500);
    }
    await sleep(1200);   // retired Brain materials are disposed a second after a switch
    const s1 = await info(p);
    check(s1.geometries <= s0.geometries + 2 && s1.textures <= s0.textures + 1, `image switches with the interior: renderer.info ${JSON.stringify(s0)} → ${JSON.stringify(s1)}`);
    check(!(await p.evaluate(() => window.__stark.interior.group.visible)) && await p.evaluate(() => window.__stark.tips.group.visible), 'after exiting: column hidden, Brain back');
  }
  check(p.errors.length === 0, `no console errors @${pr}x (${p.errors.slice(0, 2).join(' | ')})`);
  await p.close();
}
console.log('\nframe rate (2560×1440, glow on):');
for (const [name, f] of rows) console.log(`  ${name.padEnd(26)} ${fmt(f)}`);
const full1 = rows.find(([n]) => n === 'trunk full @1x')[1].fps;
check(full1 >= 45, `trunk full at 1x is ${full1 >= 55 ? 'at' : 'under'} 60 fps (${full1.toFixed(1)})`);
console.log(failed ? `\n${failed} check(s) failed` : '\ncc9 trunk: all checks passed');
await browser.close();
process.exitCode = failed ? 1 : 0;
