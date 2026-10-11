// Local fallback for the demo (CC-10 Part D5): `npm run demo`.
// Starts the server on PORT (default 3000) with a fixed room (STARK_FIXED_ROOM, default STRK7) so controllers never
// rescan, keeps the Mac awake (caffeinate -dimsu, stopped on exit), and prints the display URL, the LAN controller URL
// and its QR for the phones on the hotspot. The host key comes from STARK_HOST_KEY or ~/.config/stark/host-key and is
// never printed.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces, homedir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import { start } from '../server/index.js';

const PORT = Number(process.env.PORT) || 3000;
const ROOM = process.env.STARK_FIXED_ROOM || 'STRK7';
const keyFile = (process.env.STARK_KEY_FILE ?? join(homedir(), '.config/stark/host-key')).replace(/^~/, homedir());
const KEY = process.env.STARK_HOST_KEY ?? (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : null);
if (!KEY) { console.error(`no host key: set STARK_HOST_KEY or put it in ${keyFile}`); process.exit(2); }

const server = await start({ port: PORT, env: { ...process.env, STARK_HOST_KEY: KEY, STARK_FIXED_ROOM: ROOM }, log: () => {} });

let caffeinate = null;
if (process.platform === 'darwin') {
  caffeinate = spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });
  caffeinate.on('error', () => { caffeinate = null; });
}
const stop = () => { caffeinate?.kill(); server.close().finally(() => process.exit(0)); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// the hotspot's address first (iPhone hotspots hand out 172.20.10.x), then any other private IPv4
const lan = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a.address)
  .sort((a, b) => b.startsWith('172.20.10.') - a.startsWith('172.20.10.'));
const ip = lan[0] ?? 'localhost';
const base = `http://${ip}:${PORT}`;
const guest = `${base}/controller?room=${ROOM}`;

console.log(`\nSTARK local fallback · room ${ROOM} · ${caffeinate ? 'caffeinate on (the Mac will not sleep)' : 'caffeinate unavailable'}\n`);
console.log(`  DISPLAY (open on this Mac, full screen):  http://localhost:${PORT}/display`);
console.log(`  phones on the same network:              ${guest}`);
console.log(`  host (iPad):                             ${guest}&role=host&key=<the key in ${keyFile.replace(homedir(), '~')}>`);
if (lan.length > 1) console.log(`  other addresses:                         ${lan.slice(1).join(', ')}`);
console.log(`  rehearse against it:                     npm run rehearse -- ${base}`);
console.log('\n' + await QRCode.toString(guest, { type: 'terminal', small: true }));
console.log('Ctrl+C stops the server and caffeinate.');
