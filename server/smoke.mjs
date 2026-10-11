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
    r = await fetch(`${base}/assets/steer/head.json`);
    ok(r.status === 200 && /max-age=86400/.test(r.headers.get('cache-control') ?? ''), `steer assets cached for a day (${r.headers.get('cache-control')})`);

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
    // (v3) set-mode: noiseView needs its capability (the fixture has none), off and bloom always pass
    await expectError(host, ERROR_CODES.BAD_PAYLOAD, () => host.emit(EVENTS.SET_MODE, { noiseView: true }), EVENTS.SET_MODE);
    await expectError(host, ERROR_CODES.BAD_PAYLOAD, () => host.emit(EVENTS.SET_MODE, { bloom: 'yes' }), EVENTS.SET_MODE);
    await expectError(host, ERROR_CODES.BAD_PAYLOAD, () => host.emit(EVENTS.SET_MODE, {}), EVENTS.SET_MODE);
    display.mark();
    host.emit(EVENTS.SET_MODE, { bloom: false, noiseView: false, junk: 1 });
    const sm = await display.waitFor(EVENTS.SET_MODE);
    ok(sm.bloom === false && sm.noiseView === false && !('junk' in sm) && !('mode' in sm), 'set-mode {bloom, noiseView} relayed (v3)');
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

    // --- Steer (v2) ----------------------------------------------------------------------------------------------
    // g1 drives right now (rate-limit section); the host may steer at any time; a fresh guest may not
    await sleep(IDLE_MS * 2); // g1's lock lapses
    const g3 = await mk('guest3');
    const a3 = await g3.register({ role: 'guest', room });
    ok(a3.ok, 'guest3 joins');
    await expectError(g3, ERROR_CODES.FORBIDDEN, () => g3.emit(EVENTS.STEER_UPDATE, { seq: 1, set: [] }), EVENTS.STEER_UPDATE);
    await expectError(g3, ERROR_CODES.FORBIDDEN, () => g3.emit(EVENTS.STEER_RESET, {}), EVENTS.STEER_RESET);
    await expectError(g3, ERROR_CODES.FORBIDDEN, () => g3.emit(EVENTS.STEER_RESULT, { seq: 0 }), EVENTS.STEER_RESULT);
    await expectError(display, ERROR_CODES.FORBIDDEN, () => display.emit(EVENTS.STEER_UPDATE, { seq: 1, set: [] }), EVENTS.STEER_UPDATE);
    g3.mark();
    g3.emit(EVENTS.TAKE_CONTROL, {});
    await g3.waitFor(EVENTS.DRIVER_CHANGED, (p) => p.driver?.label === 'Guest 3');
    display.mark();
    g3.emit(EVENTS.STEER_UPDATE, { seq: 1, set: [{ channel: 31, scale: 0 }, { channel: 2047, scale: 3 }], probe: 31, junk: 1 });
    const su = await display.waitFor(EVENTS.STEER_UPDATE);
    ok(su.seq === 1 && su.set.length === 2 && su.probe === 31 && su.from === a3.clientId && !('junk' in su),
      'driver steer-update relayed to the display with its sender, extra fields dropped');
    display.mark();
    host.emit(EVENTS.STEER_UPDATE, { seq: 7, code: 'channel[top(5, "timber wolf")] = 0' });
    const sc = await display.waitFor(EVENTS.STEER_UPDATE);
    ok(sc.code && sc.probe === null && sc.from !== su.from, 'host may steer without driving (code form relayed)');
    display.mark();
    g3.emit(EVENTS.STEER_RESET, {});
    ok((await display.waitFor(EVENTS.STEER_RESET)).from === su.from, 'steer-reset relayed with its sender');

    const badSteer = [
      [{ seq: 2, set: [{ channel: 2048, scale: 0 }] }, 'out-of-range channel'],
      [{ seq: 2, set: [{ channel: -1, scale: 0 }] }, 'negative channel'],
      [{ seq: 2, set: [{ channel: 5, scale: 9 }] }, 'scale 9'],
      [{ seq: 2, set: [{ channel: 5, scale: -0.5 }] }, 'negative scale'],
      [{ seq: 2, set: Array.from({ length: 65 }, (_, i) => ({ channel: i, scale: 0 })) }, '65 entries'],
      [{ seq: 2, set: [{ channel: 5, scale: 0 }, { channel: 5, scale: 1 }] }, 'duplicate channel'],
      [{ seq: 2, code: 'channel[1] = 0 ' + '#'.repeat(586) }, '601-character code'],
      [{ seq: 2, code: 'channel[12 = 0' }, 'broken syntax'],
      [{ seq: 2, code: 'channel[1] = 0', set: [] }, 'both set and code'],
      [{ seq: 2, code: 'channel[1] = 0', probe: 4 }, 'probe with code'],
      [{ set: [] }, 'missing seq'],
      [{ seq: 1.5, set: [] }, 'fractional seq'],
      [{ seq: 2, set: [{ channel: 5, scale: 0 }], probe: 9999 }, 'probe out of range'],
    ];
    display.mark();
    for (const [p, what] of badSteer) {
      const e = await expectError(g3, ERROR_CODES.BAD_PAYLOAD, () => g3.emit(EVENTS.STEER_UPDATE, p), EVENTS.STEER_UPDATE);
      if (what === '601-character code') ok(p.code.length === 601 && /600/.test(e.message), `601-character code refused (${e.message})`);
      if (what === 'broken syntax') ok(e.parseError?.line === 1 && e.parseError?.col > 0, `broken syntax: parse error attached (${e.message})`);
    }
    ok(true, `${badSteer.length} bad steer-update payloads → BAD_PAYLOAD`);
    await expectNone(display, EVENTS.STEER_UPDATE, 30);
    const okCode = 'channel[1] = 0 ' + '#'.repeat(585);
    display.mark();
    g3.emit(EVENTS.STEER_UPDATE, { seq: 3, code: okCode });
    ok((await display.waitFor(EVENTS.STEER_UPDATE)).code.length === 600, '600-character code accepted');

    // rate limit: a steady 15/s (the controller's pace) all passes; a burst is capped at ~20
    display.mark();
    for (let i = 0; i < 15; i++) { g3.emit(EVENTS.STEER_UPDATE, { seq: 10 + i, set: [{ channel: 1, scale: i / 15 }] }); await sleep(1000 / 15); }
    await sleep(50);
    ok(display.seen(EVENTS.STEER_UPDATE).length === 15, 'steady 15/s steer-update stream fully relayed');
    await sleep(1100); // the bucket refills (and g3's lock lapses: take it again)
    g3.mark();
    g3.emit(EVENTS.TAKE_CONTROL, {});
    await g3.waitFor(EVENTS.DRIVER_CHANGED, (p) => p.driver?.label === 'Guest 3');
    display.mark(); g3.mark();
    for (let i = 0; i < 100; i++) g3.emit(EVENTS.STEER_UPDATE, { seq: 100 + i, set: [] });
    await g3.waitFor(EVENTS.ERROR, (p) => p.code === ERROR_CODES.RATE_LIMITED && p.event === EVENTS.STEER_UPDATE);
    await sleep(100);
    const sgot = display.seen(EVENTS.STEER_UPDATE).length;
    ok(sgot >= 18 && sgot <= 23, `steer-update burst capped at 20/s (${sgot}/100 relayed)`);

    // steer-result: display → controllers, cached, replayed on join, cleared by select-image
    const steerFixture = JSON.parse(readFileSync(join(import.meta.dirname, '../contract/fixtures/steer-result.active.json'), 'utf8'));
    host.mark(); g3.mark();
    display.emit(EVENTS.STEER_RESULT, steerFixture);
    ok((await host.waitFor(EVENTS.STEER_RESULT)).seq === steerFixture.seq && (await g3.waitFor(EVENTS.STEER_RESULT)), 'steer-result relayed to controllers');
    await expectNone(display, EVENTS.STEER_RESULT, 30);
    await expectError(display, ERROR_CODES.BAD_PAYLOAD, () => display.emit(EVENTS.STEER_RESULT, { seq: 1 }), EVENTS.STEER_RESULT);
    const g4 = await mk('guest4');
    g4.mark();
    ok((await g4.register({ role: 'guest', room })).ok, 'guest4 joins mid-steer');
    const replay = await g4.waitFor(EVENTS.STEER_RESULT);
    ok(replay.seq === steerFixture.seq && replay.code === steerFixture.code, 'mid-steer joiner gets the cached steer-result at once');
    display.mark();
    host.emit(EVENTS.SELECT_IMAGE, { imageId: 'clean_retriever' });
    await display.waitFor(EVENTS.SELECT_IMAGE);
    const g5 = await mk('guest5');
    g5.mark();
    ok((await g5.register({ role: 'guest', room })).ok, 'guest5 joins after select-image');
    await expectNone(g5, EVENTS.STEER_RESULT, 80);
    ok(true, 'select-image cleared the cached steer-result');

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
