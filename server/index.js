// Stark server: pages, static files, health, QR and the Socket.io relay (contract v1 section 6).
//   npm start            listens on PORT (default 3001) on all interfaces and prints the URLs phones can use
// Env: PORT, STARK_HOST_KEY, STARK_FIXED_ROOM, STARK_PUBLIC_URL (PUBLIC_URL also accepted).
import express from 'express';
import { existsSync } from 'node:fs';
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
  app.use('/assets', files('web/public/assets'));
  app.use('/contract', files('contract'));
  app.use('/vendor/three', files('node_modules/three'));

  const http = createServer(app);
  const io = new Server(http, { serveClient: true, maxHttpBufferSize: 256 * 1024 });
  const rooms = attachRelay(io, { hostKey, fixedRoom: env.STARK_FIXED_ROOM || null, idleMs, emptyRoomMs, log });

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
