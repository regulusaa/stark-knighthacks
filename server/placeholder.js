// Stand-in page for /display or /controller while the real page (web/core or web/ui) doesn't exist yet.
// It registers with the relay and logs what it receives, so connections can be tested in two tabs.
export function placeholderPage(kind) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<title>Stark ${kind} (placeholder)</title>
<style>
  body { margin: 0; padding: 16px; background: #0d0d10; color: #eee; font: 16px/1.4 system-ui, sans-serif; }
  h1 { font-size: 20px; margin: 0 0 8px; } .muted { color: #999; } img { background: #fff; width: 180px; }
  button { font-size: 18px; padding: 12px 18px; margin: 8px 8px 8px 0; }
  pre { white-space: pre-wrap; font-size: 13px; color: #bbb; max-height: 50vh; overflow: auto; }
</style></head>
<body>
<h1>Stark ${kind}: placeholder</h1>
<p class="muted">The real page isn't built yet. This one only tests the connection.</p>
<p>Status: <b id="status">connecting…</b></p>
<div id="extra"></div>
<pre id="log"></pre>
<script type="module">
import { io } from '/socket.io/socket.io.esm.min.js';
const kind = ${JSON.stringify(kind)};
const q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const log = (...a) => { $('log').textContent = a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\\n' + $('log').textContent; };
const socket = io();
const reg = kind === 'display'
  ? { role: 'display', room: q.get('room') }
  : { role: q.get('role') === 'host' ? 'host' : 'guest', room: q.get('room'), key: q.get('key') || undefined };
socket.on('connect', () => socket.emit('register', reg, (ack) => {
  if (!ack.ok) { $('status').textContent = 'error: ' + ack.error.code; return; }
  $('status').textContent = 'connected as ' + ack.label + ' in room ' + ack.room;
  if (kind === 'display') {
    history.replaceState(null, '', '?room=' + ack.room);
    $('extra').innerHTML = '<p>Room <b>' + ack.room + '</b></p><img alt="QR" src="/api/qr.svg?room=' + ack.room + '">';
  } else {
    $('extra').innerHTML = '<button id="take">Take control</button><button id="orbit">Send orbit</button>';
    $('take').onclick = () => socket.emit('take-control', {});
    $('orbit').onclick = () => socket.emit('control-orbit', { dx: 0.1, dy: 0 });
  }
  window.__starkReady = true;
}));
socket.on('disconnect', () => { $('status').textContent = 'reconnecting…'; });
socket.onAny((event, payload) => log(event, payload ?? null));
</script>
</body></html>`;
}
