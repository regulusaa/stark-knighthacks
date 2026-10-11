// Local verification: current UI over Claude's committed, read-only renderer/server.
import express from 'express';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const ui = resolve(import.meta.dirname, '..');
const core = process.env.STARK_CORE_ROOT || resolve(ui, '../..');
const { start } = await import(pathToFileURL(resolve(core, 'server/index.js')));
const server = await start({ port: Number(process.env.PORT) || 3002, env: { ...process.env, STARK_HOST_KEY: process.env.STARK_HOST_KEY || 'test' } });
const handlers = server.http.listeners('request');
const overlay = express();
overlay.get('/controller', (_req, res) => res.sendFile(resolve(ui, 'controller.html')));
overlay.get('/api/ui-modules', (_req, res) => res.set('Cache-Control', 'no-store').json({ hud: true }));
overlay.use('/ui', express.static(ui, { index: false }));
server.http.removeAllListeners('request');
server.http.on('request', (req, res) => {
  if (['/controller', '/api/ui-modules'].includes(req.url.split('?')[0]) || req.url.startsWith('/ui/')) overlay(req, res);
  else for (const handler of handlers) handler.call(server.http, req, res);
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await server.close(); process.exit(0); });
