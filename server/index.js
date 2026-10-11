// Stark server: pages, static files, health, QR and the Socket.io relay (contract v1 section 6).
//   npm start            listens on PORT (default 3001) on all interfaces and prints the URLs phones can use
// Env: PORT, STARK_HOST_KEY, STARK_HOST_LABEL (default "Ray"), STARK_FIXED_ROOM, STARK_PUBLIC_URL (PUBLIC_URL also accepted),
//      STARK_PERF=1 (the display's perf summaries are appended to logs/perf-<start time>.jsonl).
import express from 'express';
import { appendFile, existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { Server } from 'socket.io';
import { attachRelay } from './relay.js';
import { normalizeCode } from './rooms.js';
import { placeholderPage } from './placeholder.js';

const ROOT = join(import.meta.dirname, '..');

export function start({
  port = Number(process.env.PORT) || 3001,
  host = process.env.HOST || '0.0.0.0', // all interfaces, so phones on the same network can reach it
  env = process.env,
  idleMs,
  emptyRoomMs,
  log = console.log,
} = {}) {
  let hostKey = env.STARK_HOST_KEY;
  const generatedKey = !hostKey;
  if (generatedKey) hostKey = randomBytes(12).toString('base64url');
  const publicUrl = (env.STARK_PUBLIC_URL || env.PUBLIC_URL || '').replace(/\/+$/, '');

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback'); // Caddy on the same machine sets X-Forwarded-Proto/Host

  app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

  // Pages: the real file if its owner has written it, otherwise a small placeholder so neither lane blocks.
  const page = (file, role) => (_req, res) => {
    const path = join(ROOT, file);
    if (existsSync(path)) res.sendFile(path);
    else res.type('html').send(placeholderPage(role));
  };
  app.get('/display', page('web/core/display.html', 'display'));
  app.get('/controller', page('web/ui/controller.html', 'controller'));

  // Lets the display mount Codex's HUD only when it exists, without a 404 in the console.
  app.get('/api/ui-modules', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ hud: existsSync(join(ROOT, 'web/ui/hud.js')) });
  });

  // Perf log from the display (CC-10): the display asks first, and posts only when STARK_PERF=1.
  app.get('/api/perf', (_req, res) => res.set('Cache-Control', 'no-store').json({ enabled: env.STARK_PERF === '1' }));
  if (env.STARK_PERF === '1') {
    const dir = join(ROOT, 'logs');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `perf-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
    log(`  perf log:      ${file}`);
    app.post('/api/perf', express.json({ limit: '8kb' }), (req, res) => {
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).end();
      appendFile(file, JSON.stringify({ ...b, ua: String(req.get('user-agent') ?? '').slice(0, 160) }) + '\n', () => {});
      res.status(204).end();
    });
  }

  // For tools/preflight.mjs: the fixed room (it is printed on the QR anyway) and whether a display is in it.
  app.get('/api/room', (_req, res) => {
    const code = rooms.fixedRoom ?? null;
    res.set('Cache-Control', 'no-store').json({ fixedRoom: code, display: Boolean(code && rooms.get(code)?.display) });
  });

  app.get('/api/qr.svg', async (req, res) => {
    const code = normalizeCode(req.query.room);
    if (!code) return res.status(400).json({ code: 'BAD_PAYLOAD', message: 'room must be a 5-character room code' });
    if (!rooms.get(code)) return res.status(404).json({ code: 'NO_ROOM', message: `no room ${code}` });
    const base = publicUrl || `${req.protocol}://${req.get('host')}`;
    const svg = await QRCode.toString(`${base}/controller?room=${code}`, { type: 'svg', margin: 1 });
    res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
  });

  const files = (dir) => express.static(join(ROOT, dir), { index: false });
  app.use('/ui', files('web/ui'));
  app.use('/core', files('web/core'));
  app.use('/web', files('web'));
  // Steer's head.bin is 8.2 MB and never changes between deploys of the same pipeline run: cache it for a day
  app.use('/assets/steer', express.static(join(ROOT, 'web/public/assets/steer'), { index: false, maxAge: '1d' }));
  app.use('/assets', files('web/public/assets'));
  app.use('/contract', files('contract'));
  app.use('/vendor/three', files('node_modules/three'));

  const http = createServer(app);
  const io = new Server(http, { serveClient: true, maxHttpBufferSize: 256 * 1024 });
  const rooms = attachRelay(io, { hostKey, hostLabel: env.STARK_HOST_LABEL || 'Ray', fixedRoom: env.STARK_FIXED_ROOM || null, idleMs, emptyRoomMs, log });

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, host, () => {
      const actual = http.address().port;
      resolve({
        port: actual, io, http, rooms, hostKey,
        close: () => new Promise((done) => { rooms.close(); io.close(() => done()); }),
      });
      if (log === console.log) printUrls(actual, host, publicUrl, generatedKey ? hostKey : null, rooms.fixedRoom);
    });
  });
}

function printUrls(port, host, publicUrl, generatedKey, fixedRoom) {
  const loopbackOnly = host === '127.0.0.1' || host === 'localhost'; // behind Caddy: LAN addresses can't reach it
  const lan = loopbackOnly ? [] : Object.values(networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log(`stark server on port ${port}`);
  console.log(`  this machine:  http://localhost:${port}/display`);
  for (const ip of lan) console.log(`  same network:  http://${ip}:${port}/display   (controllers: /controller?room=CODE)`);
  if (publicUrl) console.log(`  public:        ${publicUrl}/display`);
  if (fixedRoom) console.log(`  fixed room:    ${fixedRoom}`);
  if (generatedKey) {
    console.log(`  STARK_HOST_KEY is not set; this run's host key is: ${generatedKey}`);
    console.log(`  host link:     http://localhost:${port}/controller?room=CODE&role=host&key=${generatedKey}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  process.on('uncaughtException', (err) => console.error('uncaught:', err));
  process.on('unhandledRejection', (err) => console.error('unhandled rejection:', err));
  start().catch((err) => { console.error(err); process.exit(1); });
}
