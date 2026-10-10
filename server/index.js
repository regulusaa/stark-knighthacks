// Stark server: static pages and assets (contract v1 section 6). The Socket.io relay is attached here and
// filled in by the relay task; for now it only serves the client bundle at /socket.io/*.
import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0'; // all interfaces, so phones on the same LAN can reach it

const app = express();
app.disable('x-powered-by');

app.get('/health', (_req, res) => res.type('text/plain').send('ok'));

// Pages. Query strings (room, role, key) are read by the page itself.
app.get('/controller', (_req, res) => res.sendFile(join(ROOT, 'web/ui/controller.html')));

// Static trees. /web/ui is owned by Codex and served read-only as-is.
app.use('/ui', express.static(join(ROOT, 'web/ui'), { index: false }));
app.use('/core', express.static(join(ROOT, 'web/core'), { index: false }));
app.use('/contract', express.static(join(ROOT, 'contract'), { index: false }));
app.use('/assets', express.static(join(ROOT, 'web/public/assets'), { index: false }));
app.use('/vendor/three', express.static(join(ROOT, 'node_modules/three'), { index: false }));

const http = createServer(app);
export const io = new Server(http, { serveClient: true });

http.listen(PORT, HOST, () => {
  console.log(`stark server on ${HOST}:${PORT}`);
  console.log(`  this machine:  http://localhost:${PORT}/controller`);
  for (const ip of lanAddresses()) console.log(`  same Wi-Fi:    http://${ip}:${PORT}/controller`);
  if (process.env.STARK_PUBLIC_URL) console.log(`  cellular/any:  ${process.env.STARK_PUBLIC_URL}/controller`);
});

function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}
