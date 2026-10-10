// npm run smoke: starts the server in-process on a random port and drives it with simulated clients
// (a display, a host and guests). Exits non-zero on the first failed check.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { io as connectClient } from 'socket.io-client';
import { EVENTS, ERROR_CODES } from '../contract/contract.js';
import { start } from './index.js';

const IDLE_MS = 300;
const HOST_KEY = 'smoke-host-key';
const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../contract/fixtures/display-state.json'), 'utf8'));
const t0 = performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let checks = 0;
const relayErrors = [];
const quiet = (m) => { if (/error/i.test(m)) relayErrors.push(m); };

function ok(cond, msg) {
  assert.ok(cond, msg);
  checks += 1;
}

/** A client that records everything it receives. */
async function client(base, name) {
  const s = connectClient(base, { transports: ['websocket'], forceNew: true, reconnection: false });
  s.name = name;
  s.inbox = [];
  s.since = 0;
  s.onAny((event, payload) => s.inbox.push({ event, payload }));
  await new Promise((res, rej) => { s.once('connect', res); s.once('connect_error', rej); });
  s.mark = () => { s.since = s.inbox.length; };
  s.seen = (event, pred = () => true) => s.inbox.slice(s.since).filter((m) => m.event === event && pred(m.payload));
  s.waitFor = async (event, pred = () => true, ms = 1000) => {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      const hit = s.seen(event, pred)[0];
      if (hit) return hit.payload;
      await sleep(5);
    }
    throw new Error(`${name}: timed out waiting for ${event}`);
  };
  s.register = (payload) => s.emitWithAck(EVENTS.REGISTER, payload);
  return s;
}

async function expectError(s, code, action, event) {
  s.mark();
  action();
  const e = await s.waitFor(EVENTS.ERROR, (p) => p.code === code && (!event || p.event === event));
  ok(e, `${s.name}: expected ${code}`);
  return e;
}

async function expectNone(s, event, ms = 80) {
  await sleep(ms);
  ok(s.seen(event).length === 0, `${s.name}: did not expect ${event}`);
}

async function main() {
  const srv = await start({ port: 0, host: '127.0.0.1', env: { STARK_HOST_KEY: HOST_KEY }, idleMs: IDLE_MS, log: quiet });
  const base = `http://127.0.0.1:${srv.port}`;
  const all = [];
  const mk = async (name) => { const c = await client(base, name); all.push(c); return c; };

  try {
    // --- HTTP ----------------------------------------------------------------------------------------------
    let r = await fetch(`${base}/health`);
    ok(r.status === 200 && (await r.text()) === 'ok', '/health');
    ok((await fetch(`${base}/api/qr.svg?room=bad!`)).status === 400, 'qr: malformed code → 400');
    ok((await fetch(`${base}/api/qr.svg?room=ZZZZZ`)).status === 404, 'qr: unknown room → 404');
    ok((await fetch(`${base}/controller`)).status === 200, '/controller page');
    ok((await fetch(`${base}/display`)).status === 200, '/display page');

    // --- rooms -----------------------------------------------------------------------------------------------
    const display = await mk('display');
    const d = await display.register({ role: 'display', room: null });
    ok(d.ok && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/.test(d.room), `room issued (${d.room})`);
    const room = d.room;
    r = await fetch(`${base}/api/qr.svg?room=${room.toLowerCase()}`);
    ok(r.status === 200 && (await r.text()).includes('<svg'), 'qr: svg for a live room (case-insensitive)');

    const stray = await mk('stray');
    const nr = await stray.register({ role: 'guest', room: 'ZZZZZ' });
    ok(!nr.ok && nr.error.code === ERROR_CODES.NO_ROOM, 'unknown room → NO_ROOM');
    await expectError(stray, ERROR_CODES.FORBIDDEN, () => stray.emit(EVENTS.TAKE_CONTROL, {}), EVENTS.TAKE_CONTROL);

    // --- roles -----------------------------------------------------------------------------------------------
    const host = await mk('host');
    const bad = await host.register({ role: 'host', room, key: 'wrong' });
    ok(!bad.ok && bad.error.code === ERROR_CODES.BAD_KEY, 'wrong key → BAD_KEY');
    const nokey = await host.register({ role: 'host', room });
    ok(!nokey.ok && nokey.error.code === ERROR_CODES.BAD_KEY, 'missing key → BAD_KEY');
    display.mark();
    // state sync: the display publishes state before the host joins; the host must get it on join
    display.emit(EVENTS.DISPLAY_STATE, { ...fixture, room: 'XXXXX', driver: null, controllerCount: 99 });
    await sleep(30);
    host.mark();
    const h = await host.register({ role: 'host', room, key: HOST_KEY });
    ok(h.ok && h.label === 'Ray' && h.role === 'host', 'host accepted after a bad key (same socket), labelled Ray');
    const hs = await host.waitFor(EVENTS.DISPLAY_STATE);
    ok(hs.room === room && hs.controllerCount === 1 && hs.driver === null, 'state sync on join, server fields filled');
    ok(hs.image.id === fixture.image.id, 'state sync carries the display\'s fields');
    await host.waitFor(EVENTS.PEER_JOINED, (p) => p.role === 'display');
    await display.waitFor(EVENTS.PEER_JOINED, (p) => p.role === 'host');
    ok(true, 'peer-joined both ways (host)');
    await expectNone(display, EVENTS.DISPLAY_STATE, 30);

    const g1 = await mk('guest1');
    const g2 = await mk('guest2');
    const a1 = await g1.register({ role: 'guest', room: room.toLowerCase() });
    const a2 = await g2.register({ role: 'guest', room });
    ok(a1.ok && a1.label === 'Guest 1' && a2.label === 'Guest 2', 'guest labels in join order');
    const g2peers = await (async () => { await g2.waitFor(EVENTS.PEER_JOINED, (p) => p.label === 'Guest 1'); return g2.seen(EVENTS.PEER_JOINED).map((m) => m.payload.label); })();
    ok(['Display', 'Ray', 'Guest 1'].every((l) => g2peers.includes(l)), 'newcomer told about every existing peer');
    ok((await g2.waitFor(EVENTS.DISPLAY_STATE)).controllerCount === 3, 'controllerCount counts host + guests');

    // --- permissions -----------------------------------------------------------------------------------------
    await expectError(g1, ERROR_CODES.FORBIDDEN, () => g1.emit(EVENTS.SELECT_IMAGE, { imageId: 'clean_retriever' }), EVENTS.SELECT_IMAGE);
    await expectError(g1, ERROR_CODES.FORBIDDEN, () => g1.emit(EVENTS.DISPLAY_STATE, fixture), EVENTS.DISPLAY_STATE);
    await expectError(g1, ERROR_CODES.FORBIDDEN, () => g1.emit(EVENTS.CONTROL_ORBIT, { dx: 0.1, dy: 0 }), EVENTS.CONTROL_ORBIT);
    await expectError(host, ERROR_CODES.FORBIDDEN, () => host.emit(EVENTS.FOCUS_STATE, null), EVENTS.FOCUS_STATE);
    await expectError(display, ERROR_CODES.FORBIDDEN, () => display.emit(EVENTS.TAKE_CONTROL, {}), EVENTS.TAKE_CONTROL);
    await expectError(g1, ERROR_CODES.FORBIDDEN, () => g1.emit(EVENTS.DRIVER_CHANGED, { driver: null }), EVENTS.DRIVER_CHANGED);

    display.mark();
    host.emit(EVENTS.SELECT_IMAGE, { imageId: 'clean_retriever', junk: 1 });
    const sel = await display.waitFor(EVENTS.SELECT_IMAGE);
    ok(sel.imageId === 'clean_retriever' && !('junk' in sel), 'host select-image relayed, extra fields dropped');
    await expectError(host, ERROR_CODES.BAD_PAYLOAD, () => host.emit(EVENTS.SELECT_IMAGE, { imageId: 'nope' }), EVENTS.SELECT_IMAGE);
    await expectError(host, ERROR_CODES.BAD_PAYLOAD, () => host.emit(EVENTS.FOCUS_TIP, { classId: 1 }), EVENTS.FOCUS_TIP);
    await expectError(host, ERROR_CODES.BAD_PAYLOAD, () => host.emit(EVENTS.FOCUS_TIP, { classId: '207' }), EVENTS.FOCUS_TIP);
    display.mark();
    host.emit(EVENTS.FOCUS_TIP, { classId: fixture.answers[1].classId });
    ok((await display.waitFor(EVENTS.FOCUS_TIP)).classId === fixture.answers[1].classId, 'host focus-tip relayed');
    host.emit(EVENTS.CONTROL_ORBIT, { dx: 0.5, dy: -0.5 });
    await display.waitFor(EVENTS.CONTROL_ORBIT);
    ok(true, 'host may orbit without being the driver');

    // focus-state goes to controllers only
    g1.mark(); display.mark();
    display.emit(EVENTS.FOCUS_STATE, fixture.answers[1]);
    ok((await g1.waitFor(EVENTS.FOCUS_STATE)).classId === fixture.answers[1].classId, 'focus-state relayed to controllers');
    await expectNone(display, EVENTS.FOCUS_STATE, 30);

    // --- driver lock -----------------------------------------------------------------------------------------
    g2.mark();
    g1.emit(EVENTS.TAKE_CONTROL, {});
    let dc = await g2.waitFor(EVENTS.DRIVER_CHANGED);
    ok(dc.driver.label === 'Guest 1' && dc.reason === 'take', 'take-control');
    const locked = await expectError(g2, ERROR_CODES.LOCKED, () => g2.emit(EVENTS.TAKE_CONTROL, {}), EVENTS.TAKE_CONTROL);
    ok(locked.driver.label === 'Guest 1', 'LOCKED names the driver');

    display.mark();
    g1.emit(EVENTS.CONTROL_ORBIT, { dx: 5, dy: -5 });
    const orb = await display.waitFor(EVENTS.CONTROL_ORBIT);
    ok(orb.dx === 1 && orb.dy === -1, 'driver orbit relayed and clamped to −1..1');
    await expectError(g2, ERROR_CODES.FORBIDDEN, () => g2.emit(EVENTS.CONTROL_ZOOM, { dz: 0.1 }), EVENTS.CONTROL_ZOOM);

    // input keeps the lock alive past the idle window
    for (let i = 0; i < 4; i++) { await sleep(IDLE_MS / 2); g1.emit(EVENTS.CONTROL_ZOOM, { dz: 0.01 }); }
    ok(g1.seen(EVENTS.DRIVER_CHANGED, (p) => p.reason === 'idle').length === 0, 'driver input resets the idle timer');

    g1.mark();
    host.emit(EVENTS.TAKE_CONTROL, {});
    dc = await g1.waitFor(EVENTS.DRIVER_CHANGED);
    ok(dc.driver.isHost && dc.driver.label === 'Ray' && dc.reason === 'host-override', 'host override (driver labelled Ray)');
    const hl = await expectError(g1, ERROR_CODES.LOCKED, () => g1.emit(EVENTS.TAKE_CONTROL, {}), EVENTS.TAKE_CONTROL);
    ok(/^Ray is driving/.test(hl.message) && hl.driver.label === 'Ray', `LOCKED message names Ray ("${hl.message}")`);

    g1.mark();
    dc = await g1.waitFor(EVENTS.DRIVER_CHANGED, (p) => p.reason === 'idle', IDLE_MS * 4);
    ok(dc.driver === null, 'idle release');

    g1.mark();
    g2.emit(EVENTS.TAKE_CONTROL, {});
    await g1.waitFor(EVENTS.DRIVER_CHANGED, (p) => p.driver?.label === 'Guest 2');
    g2.disconnect();
    dc = await g1.waitFor(EVENTS.DRIVER_CHANGED, (p) => p.reason === 'disconnect');
    ok(dc.driver === null, 'release on disconnect');
    await g1.waitFor(EVENTS.PEER_LEFT, (p) => p.label === 'Guest 2');
    ok((await g1.waitFor(EVENTS.DISPLAY_STATE, (p) => p.controllerCount === 2)), 'controllerCount drops on leave');

    // --- rate limit --------------------------------------------------------------------------------------------
    g1.emit(EVENTS.TAKE_CONTROL, {});
    await g1.waitFor(EVENTS.DRIVER_CHANGED, (p) => p.driver?.label === 'Guest 1');
    display.mark(); g1.mark();
    for (let i = 0; i < 200; i++) g1.emit(EVENTS.CONTROL_ORBIT, { dx: 0.01, dy: 0 });
    await g1.waitFor(EVENTS.ERROR, (p) => p.code === ERROR_CODES.RATE_LIMITED);
    await sleep(100);
    const got = display.seen(EVENTS.CONTROL_ORBIT).length;
    ok(got > 0 && got <= 40, `orbit burst capped (${got}/200 relayed)`);
    ok(g1.seen(EVENTS.ERROR, (p) => p.code === ERROR_CODES.RATE_LIMITED).length === 1, 'RATE_LIMITED sent once per second');

    // --- display replacement -------------------------------------------------------------------------------------
    const display2 = await mk('display2');
    display.mark();
    const d2 = await display2.register({ role: 'display', room });
    ok(d2.ok && d2.room === room, 'second display reclaims the room');
    await display.waitFor(EVENTS.ERROR, (p) => /newer display/.test(p.message));
    await sleep(50);
    ok(display.disconnected, 'older display told and disconnected');
    display2.mark();
    host.emit(EVENTS.RESET_VIEW, {});
    await display2.waitFor(EVENTS.RESET_VIEW);
    ok(true, 'relay goes to the new display');

    // --- fuzz: garbage to every event from every role -------------------------------------------------------------
    const garbage = [undefined, null, 0, -1, NaN, 'x', true, [], [1, 2], {}, { dx: 'a', dy: {} }, { dx: Infinity },
      { classId: '207' }, { classId: 1e9 }, { imageId: { a: 1 } }, { role: 'god' }, { mode: 'x', layerMode: 7 },
      { channels: 'all' }, { channels: [{ channelIndex: -1 }] }, { image: null, answers: 'x' }, { speed: 'fast' },
      { a: { b: { c: { d: { e: [1, [2, [3]]] } } } } }, { toString: 'boom', __proto__: { x: 1 } }, 'x'.repeat(10000)];
    const fuzzers = [display2, host, g1, await mk('fuzz-unregistered')];
    for (const s of fuzzers) {
      for (const event of [...Object.values(EVENTS), 'nonsense', 'constructor', '__proto__']) {
        for (const g of garbage) s.emit(event, g);
        s.emit(event, garbage[3], () => {}); // with an ack function
      }
    }
    const huge = await mk('huge');
    huge.emit(EVENTS.REGISTER, { role: 'display', room: 'x'.repeat(400 * 1024) });
    await sleep(300);
    r = await fetch(`${base}/health`);
    ok(r.status === 200, 'server alive after fuzz');
    const after = await mk('after');
    const af = await after.register({ role: 'display', room: null });
    ok(af.ok, 'new display can register after fuzz');
    const hostB = await mk('hostB');
    ok((await hostB.register({ role: 'host', room: af.room, key: HOST_KEY })).ok, 'host joins after fuzz');
    hostB.emit(EVENTS.PLAY_PULSE, { speed: 99 });
    ok((await after.waitFor(EVENTS.PLAY_PULSE)).speed === 4, 'relay still works after fuzz (speed clamped)');
    ok(relayErrors.length === 0, `no internal relay errors (got: ${relayErrors[0]})`);
  } finally {
    for (const c of all) c.disconnect();
    await srv.close();
  }

  // --- fixed room ------------------------------------------------------------------------------------------------
  const fixed = await start({ port: 0, host: '127.0.0.1', env: { STARK_HOST_KEY: HOST_KEY, STARK_FIXED_ROOM: 'stark' }, log: quiet });
  const fbase = `http://127.0.0.1:${fixed.port}`;
  try {
    ok((await fetch(`${fbase}/api/qr.svg?room=STARK`)).status === 200, 'fixed room exists before any display');
    const fd = await client(fbase, 'fixed-display');
    const f1 = await fd.register({ role: 'display', room: null });
    ok(f1.ok && f1.room === 'STARK', 'STARK_FIXED_ROOM overrides room issuing');
    const fd2 = await client(fbase, 'fixed-display2');
    const f2 = await fd2.register({ role: 'display', room: 'ABCDE' });
    ok(f2.room === 'STARK', 'fixed room is the only room handed out');
    fd.disconnect(); fd2.disconnect();
  } finally {
    await fixed.close();
  }

  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(`smoke: ok (${checks} checks, ${secs}s)`);
}

main().then(() => process.exit(0), (err) => {
  console.error('smoke: FAILED:', err.message);
  process.exit(1);
});
