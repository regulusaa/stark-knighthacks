// Perf tour (CC-10 Part B): as the host, hold the display that is open in the fixed room (full screen on the real
// monitor, ?perf=1) in each demo mode for 11 s, then read the server's perf log (STARK_PERF=1, logs/perf-*.jsonl) and
// print fps p50/p95 per mode against the targets (p50 ≥ 55, p95 ≥ 40). Run it on the machine that runs the server.
//   STARK_PERF=1 npm run demo        (then open the display on the monitor with ?perf=1)
//   npm run perftour -- http://localhost:3000
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { io } from 'socket.io-client';

const BASE = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const KEY = process.env.STARK_HOST_KEY
  ?? readFileSync((process.env.STARK_KEY_FILE ?? '~/.config/stark/host-key').replace(/^~/, process.env.HOME), 'utf8').trim();
const HOLD = 11000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const room = (await (await fetch(`${BASE}/api/room`)).json()).fixedRoom;
const s = io(BASE, { transports: ['websocket'], forceNew: true });
await new Promise((r) => s.once('connect', r));
const ack = await new Promise((r) => s.emit('register', { role: 'host', room, key: KEY }, r));
if (!ack.ok) { console.error('host register failed:', ack.error?.code); process.exit(2); }
let state = null;
s.on('display-state', (d) => { state = d; });
const until = async (pred, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (state && pred(state)) return; await sleep(50); } throw new Error('timeout'); };
const select = async (id) => { s.emit('select-image', { imageId: id }); await until((d) => d.image.id === id); s.emit('play-pulse', { skipToEnd: true }); await until((d) => d.playback.state === 'done'); };

const segments = [];
async function hold(name, setup) {
  await setup();
  const t0 = Date.now();
  await sleep(HOLD);
  segments.push({ name, t0: t0 + 5000, t1: Date.now() + 500 });   // a sample covers the 5 s before it
  console.log(`  held ${name}`);
}
console.log(`perf tour on ${BASE} (room ${room}), ${HOLD / 1000} s per mode`);
await hold('normal, glow on', async () => { await select('clean_retriever'); s.emit('set-mode', { bloom: true }); });
await hold('normal, glow off', async () => { s.emit('set-mode', { bloom: false }); });
await hold('stability (playing, replayed)', async () => { s.emit('set-mode', { bloom: true }); await select('ambig_cat'); s.emit('set-mode', { mode: 'stability' }); setTimeout(() => s.emit('play-pulse', {}), 5500); });
await hold('trunk interior, full', async () => { s.emit('set-mode', { mode: 'normal' }); await select('clean_retriever'); s.emit('set-mode', { mode: 'trunk' }); await sleep(300); s.emit('set-mode', { layerMode: 'full' }); });
await hold('trunk interior, reduced', async () => { s.emit('set-mode', { layerMode: 'reduced' }); });
await hold('adversarial + noise view', async () => { s.emit('set-mode', { mode: 'normal' }); await select('adv_retriever'); await sleep(500); s.emit('set-mode', { noiseView: true }); });
await hold('medical', async () => { await select('med_xray_pneumonia'); });
await hold('Steer (flipped, wolf)', async () => {
  await select('ambig_wolf');
  s.emit('take-control', {});
  const flip = (await (await fetch(`${BASE}/assets/ambig_wolf/steer.json`)).json()).flip;
  s.emit('steer-update', { seq: 1, set: flip.channels.map((c) => ({ channel: c, scale: 0 })), probe: null });
});
s.emit('steer-reset', {});
s.close();
await sleep(5500);   // the last sample

const dir = 'logs';
const file = readdirSync(dir).filter((f) => f.startsWith('perf-')).sort().at(-1);
const rows = readFileSync(join(dir, file), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
console.log(`\n${file}: ${rows[0]?.width}×${rows[0]?.height} @${rows[0]?.pixelRatio}x\n`);
console.log('mode'.padEnd(32), 'fps p50  fps p95  calls  triangles  verdict');
let bad = 0;
for (const g of segments) {
  const r = rows.filter((x) => x.t >= g.t0 && x.t <= g.t1);
  if (!r.length) { console.log(g.name.padEnd(32), 'no samples (is the display open with ?perf=1 and the server on STARK_PERF=1?)'); bad += 1; continue; }
  const p50 = Math.min(...r.map((x) => x.fpsP50));
  const p95 = Math.min(...r.map((x) => x.fpsP95));
  const ok = p50 >= 55 && p95 >= 40;
  if (!ok) bad += 1;
  console.log(g.name.padEnd(32), p50.toFixed(1).padStart(7), p95.toFixed(1).padStart(8), String(Math.max(...r.map((x) => x.drawCalls))).padStart(6), `${(Math.max(...r.map((x) => x.triangles)) / 1e6).toFixed(2)}M`.padStart(10), ok ? ' ok' : ' MISSES TARGET');
}
console.log(bad ? `\n${bad} mode(s) miss the target (p50 ≥ 55, p95 ≥ 40)` : '\nevery mode meets the target');
process.exit(bad ? 1 : 0);
