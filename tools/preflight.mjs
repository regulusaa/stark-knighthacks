// Preflight (CC-10 Part D4): a green/red checklist for a deployed server, in under 20 s.
//   npm run preflight -- <url> [--room CODE]
// /health · TLS certificate and expiry · every file under web/public/assets answers 200 to HEAD with this checkout's
// size · head.bin's sha256 matches head.json · /api/qr.svg encodes <url>/controller?room=<fixed room> · a host
// registers with the key · a guest joins · round-trip latency (median of 20). The key (STARK_HOST_KEY, or the file
// named by STARK_KEY_FILE) is never printed.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import tls from 'node:tls';
import QRCode from 'qrcode';
import { io } from 'socket.io-client';

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--room') ?? 'http://localhost:3000').replace(/\/+$/, '');
const roomArg = args.includes('--room') ? args[args.indexOf('--room') + 1] : null;
const KEY = process.env.STARK_HOST_KEY
  ?? (process.env.STARK_KEY_FILE ? readFileSync(process.env.STARK_KEY_FILE.replace(/^~/, process.env.HOME), 'utf8').trim() : null);
const ROOT = join(import.meta.dirname, '..');
const T0 = Date.now();
const color = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
let failed = 0;
function row(name, status, note = '') {
  if (status === 'FAIL') failed += 1;
  const c = status === 'ok' ? 32 : status === 'WARN' ? 33 : 31;
  console.log(`${color(c, status.padEnd(4))} ${name.padEnd(34)} ${note}`);
}
async function check(name, fn) {
  try { const r = await fn(); row(name, r?.warn ? 'WARN' : 'ok', r?.note ?? r ?? ''); } catch (err) { row(name, 'FAIL', err.message); }
}
const timed = async (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what}: no answer in ${ms} ms`)), ms))]);

console.log(`preflight ${BASE}\n`);

await check('/health', async () => {
  const r = await timed(fetch(`${BASE}/health`), 5000, '/health');
  const t = await r.text();
  if (!r.ok || t !== 'ok') throw new Error(`HTTP ${r.status} "${t.slice(0, 40)}"`);
});

const url = new URL(BASE);
if (url.protocol === 'https:') {
  await check('TLS certificate', () => new Promise((res, rej) => {
    const s = tls.connect({ host: url.hostname, port: Number(url.port) || 443, servername: url.hostname }, () => {
      const c = s.getPeerCertificate();
      const days = (new Date(c.valid_to) - Date.now()) / 86400000;
      s.end();
      if (!s.authorized) return rej(new Error(`not trusted: ${s.authorizationError}`));
      res({ warn: days < 7, note: `${c.issuer?.O ?? c.issuer?.CN ?? '?'}, expires ${new Date(c.valid_to).toISOString().slice(0, 10)} (${days.toFixed(0)} days)` });
    });
    s.setTimeout(5000, () => { s.destroy(); rej(new Error('TLS: timeout')); });
    s.on('error', rej);
  }));
} else row('TLS certificate', 'WARN', 'plain http (local fallback)');

// the asset HEADs and the 8 MB head.bin download run side by side (cellular: ~15 s each)
const assetsCheck = check('assets: HEAD 200, right sizes', async () => {
  const dir = join(ROOT, 'web/public/assets');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (!f.startsWith('.')) files.push(p); } };
  walk(dir);
  const bad = [];
  let bytes = 0;
  const queue = files.slice();
  await Promise.all(Array.from({ length: 12 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const rel = relative(dir, p).split('\\').join('/');
      const want = statSync(p).size;
      bytes += want;
      try {
        const r = await timed(fetch(`${BASE}/assets/${rel}`, { method: 'HEAD', headers: { 'accept-encoding': 'identity' } }), 5000, rel);   // gzip would hide the true length
        const got = Number(r.headers.get('content-length'));
        if (r.status !== 200) bad.push(`${rel} HTTP ${r.status}`);
        else if (got !== want) bad.push(`${rel} ${got} bytes, want ${want}`);
      } catch (err) { bad.push(err.message); }
    }
  }));
  if (bad.length) throw new Error(`${bad.length}/${files.length} bad: ${bad.slice(0, 3).join('; ')}`);
  return `${files.length} files, ${(bytes / 1e6).toFixed(1)} MB`;
});

const headCheck = check('head.bin sha256 = head.json', async () => {
  const meta = await (await fetch(`${BASE}/assets/steer/head.json`)).json();
  const buf = Buffer.from(await (await timed(fetch(`${BASE}/assets/steer/head.bin`), 15000, 'head.bin')).arrayBuffer());
  const sha = createHash('sha256').update(buf).digest('hex');
  if (sha !== meta.sha256 || buf.length !== meta.bytes) throw new Error(`sha ${sha.slice(0, 12)}… (${buf.length} bytes), want ${meta.sha256.slice(0, 12)}… (${meta.bytes})`);
  return `${sha.slice(0, 12)}…, ${buf.length} bytes`;
});

await Promise.all([assetsCheck, headCheck]);

let room = roomArg;
let displayOn = null;
await check('fixed room', async () => {
  const r = await fetch(`${BASE}/api/room`);
  if (r.ok) { const j = await r.json(); room = room ?? j.fixedRoom; displayOn = j.display; }
  if (!room) throw new Error('no fixed room (set STARK_FIXED_ROOM on the server, or pass --room CODE)');
  return { warn: displayOn === false, note: `${room}${displayOn === false ? ' · no display connected yet' : displayOn ? ' · display connected' : ''}` };
});

if (room) {
  await check('/api/qr.svg encodes the room URL', async () => {
    const r = await fetch(`${BASE}/api/qr.svg?room=${room}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const got = await r.text();
    const want = `${BASE}/controller?room=${room}`;
    if (got !== await QRCode.toString(want, { type: 'svg', margin: 1 })) throw new Error(`the QR does not encode ${want}`);
    return want;
  });
}

async function register(role) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
  await timed(new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); }), 5000, `${role} connect`);
  const ack = await timed(new Promise((res) => s.emit('register', { role, room, ...(role === 'host' ? { key: KEY } : {}) }, res)), 5000, `${role} register`);
  if (!ack?.ok) { s.close(); throw new Error(`${role} register: ${ack?.error?.code ?? '?'} ${ack?.error?.message ?? ''}`); }
  return { s, ack };
}
if (room) {
  if (!KEY) row('host connects with the key', 'FAIL', 'set STARK_HOST_KEY or STARK_KEY_FILE');
  else await check('host connects with the key', async () => { const { s, ack } = await register('host'); s.close(); return `as ${ack.label}`; });
  await check('guest joins', async () => {
    const { s, ack } = await register('guest');
    s.close();
    return `as ${ack.label}`;
  });
}
// socket.io's own ping is not exposed to the client, so time 20 /health requests on a warm keep-alive connection
await check('round trip (median of 20)', async () => {
  const t = [];
  for (let i = 0; i < 20; i++) { const a = performance.now(); await (await fetch(`${BASE}/health`)).text(); t.push(performance.now() - a); }
  t.sort((a, b) => a - b);
  const med = t[10];
  return { warn: med > 150, note: `${med.toFixed(0)} ms (min ${t[0].toFixed(0)}, max ${t[19].toFixed(0)}) over HTTP keep-alive` };
});

const total = Date.now() - T0;
row('total time < 20 s', total < 20000 ? 'ok' : 'FAIL', `${(total / 1000).toFixed(1)} s`);
console.log(failed ? color(31, `\nPREFLIGHT FAILED: ${failed}`) : color(32, '\nPREFLIGHT PASSED'));
process.exitCode = failed ? 1 : 0;
