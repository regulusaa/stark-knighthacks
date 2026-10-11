// Keyboard fallback with no network (CC-10 Part D6): open the display, let the preload finish, then KILL THE SERVER and
// press every key in the display's list (input.js), checking each one's effect on the display's own state.
// usage (repo root): node web/core/checks/keysoffline.mjs   (starts and kills its own server on PORT 3005)
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 3005;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) failed += 1; };

const server = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: String(PORT), STARK_HOST_KEY: 'offline-check' }, stdio: 'ignore' });
for (let i = 0; i < 40; i++) { try { if ((await fetch(`http://localhost:${PORT}/health`)).ok) break; } catch { /* starting */ } await sleep(100); }

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
await page.goto(`http://localhost:${PORT}/display`);
await page.waitForFunction(() => window.__starkReady === true && window.__starkDebug.preload.finished, null, { timeout: 60000 });
const pre = await page.evaluate(() => window.__starkDebug.preload);
check(pre.failed === 0, `preloaded ${pre.done} files (${(pre.bytes / 1e6).toFixed(1)} MB) before the network goes`);

server.kill('SIGKILL');
await sleep(300);
const down = await fetch(`http://localhost:${PORT}/health`).then(() => false).catch(() => true);
check(down, 'server killed: no network from here on');

const S = () => page.evaluate(() => {
  const s = window.__stark; const st = s.api.state;
  return { image: st.image.id, playback: st.playback.state, speed: st.playback.speed, heat: s.api.heatmapOn, hud: s.hud?.visible ?? null,
    focus: st.focus?.classId ?? null, steer: Boolean(s.steer.session.state?.active), top1: st.top1?.label, noise: st.noiseView, bloom: st.bloom,
    cam: s.camera.position.toArray(), home: s.rig.home.position.toArray(), order: s.api.manifest.map((m) => m.id) };
});
const key = async (k, ms = 400) => { await page.keyboard.press(k); await sleep(ms); return S(); };
const near = (a, b) => a.every((x, i) => Math.abs(x - b[i]) < 0.05);

let s = await S();
// 1–9: every gallery image from memory
for (let n = 1; n <= s.order.length; n++) {
  s = await key(String(n), 700);
  check(s.image === s.order[n - 1], `${n}: ${s.order[n - 1]} (${s.image === s.order[n - 1] ? 'loaded offline' : `still ${s.image}`})`);
}
s = await key('1', 700);
s = await key('e');       check(s.playback === 'done', 'E: jump to the end');
s = await key(' ', 200);  check(s.playback === 'playing', 'Space: replay the pulse');
const sp = s.speed;
s = await key(']');       check(s.speed > sp, `]: faster (${sp} → ${s.speed})`);
s = await key('[');       check(s.speed === sp, `[: slower (back to ${s.speed})`);
s = await key('e');
const h0 = s.heat;
s = await key('g', 600);  check(s.heat !== h0, `G: heatmap ${h0 ? 'off' : 'on'}`);
s = await key('g', 600);
const hud0 = s.hud;
s = await key('h');       check(hud0 === null || s.hud !== hud0, `H: HUD ${hud0 === null ? '(no HUD on this display)' : s.hud ? 'shown' : 'hidden'}`);
await key('h');
await page.evaluate(() => window.__stark.api.focusTip(window.__stark.api.state.answers.find((a) => a.rank === 2).classId));
await sleep(300);
s = await key('Escape', 1500); check(s.focus === null, 'Esc: focus cleared');
await page.evaluate(() => window.__stark.api.orbit(0.2, 0.05));
await sleep(500);
s = await key('r', 1800); check(near(s.cam, s.home), 'R: back to the home view');
s = await key('b');       check(s.bloom === false, 'B: glow off');
s = await key('b');       check(s.bloom === true, 'B: glow on');
s = await key('a', 900);  check(s.image === 'adv_retriever', `A: the pair's other image (${s.image})`);
s = await key('n', 500);  check(s.noise === true, 'N: noise view on');
s = await key('n', 500);  check(s.noise === false, 'N: noise view off');
s = await key('5', 1200); // the wolf (manifest order 5)
await page.evaluate(() => window.__stark.api.jumpToEnd());
await page.waitForFunction(() => window.__stark.api.state.capabilities.steer, null, { timeout: 5000 }).catch(() => {});
const base = (await S()).top1;
s = await key('f', 800);  check(s.steer && s.top1 !== base, `F: zero the flip set (${base} → ${s.top1})`);
s = await key('x', 800);  check(!s.steer && s.top1 === base, `X: Steer reset (${s.top1})`);
s = await key('Shift+F', 800); check(s.steer, `Shift+F: zero the top-1's channels (${s.top1})`);
await key('x', 500);

check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2).join(' | ')})`);
console.log(failed ? `\n${failed} check(s) failed` : '\nkeyboard offline: all keys work with no network');
await browser.close();
process.exitCode = failed ? 1 : 0;
