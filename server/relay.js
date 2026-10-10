// Socket.io relay (contract v1 sections 3–5): register, permissions, validation, rate limits, and routing.
// It is a relay: it checks who may send what, cleans the payload and forwards it. It has no game logic.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { EVENTS, ERROR_CODES, ROLES } from '../contract/contract.js';
import { Rooms, driverInfo } from './rooms.js';
import { validators, BadPayload } from './validate.js';
import { Limiter } from './limits.js';

// Who may send each client event. display = display socket; host = host controller;
// controller = host or guest; driver-or-host = the current driver, or the host at any time.
const PERMISSION = {
  [EVENTS.TAKE_CONTROL]: 'controller',
  [EVENTS.CONTROL_ORBIT]: 'driver-or-host',
  [EVENTS.CONTROL_ZOOM]: 'driver-or-host',
  [EVENTS.FOCUS_TIP]: 'driver-or-host',
  [EVENTS.CLEAR_FOCUS]: 'driver-or-host',
  [EVENTS.RESET_VIEW]: 'driver-or-host',
  [EVENTS.STEER_UPDATE]: 'driver-or-host',
  [EVENTS.STEER_RESET]: 'driver-or-host',
  [EVENTS.SELECT_IMAGE]: 'host',
  [EVENTS.PLAY_PULSE]: 'host',
  [EVENTS.SET_MODE]: 'host',
  [EVENTS.DISPLAY_STATE]: 'display',
  [EVENTS.FOCUS_STATE]: 'display',
};

// Controller events forwarded unchanged (after validation) to the room's display.
const TO_DISPLAY = new Set([
  EVENTS.CONTROL_ORBIT, EVENTS.CONTROL_ZOOM, EVENTS.FOCUS_TIP, EVENTS.CLEAR_FOCUS, EVENTS.RESET_VIEW,
  EVENTS.SELECT_IMAGE, EVENTS.PLAY_PULSE, EVENTS.SET_MODE,
]);

const KNOWN = new Set(Object.values(EVENTS));
const allRoom = (code) => `room:${code}`;
const ctlRoom = (code) => `ctl:${code}`;
const peerInfo = (c) => ({ clientId: c.id, role: c.role, label: c.label });
const newId = (prefix) => `${prefix}_${randomBytes(3).toString('hex')}`;

function digest(s) {
  return createHash('sha256').update(String(s)).digest();
}

export function attachRelay(io, { hostKey, fixedRoom, idleMs, emptyRoomMs, log = console.log }) {
  const keyDigest = digest(hostKey);
  const keyOk = (key) => typeof key === 'string' && timingSafeEqual(digest(key), keyDigest);

  const rooms = new Rooms({
    fixedRoom, idleMs, emptyRoomMs,
    onDriverChanged(room, reason) {
      io.to(allRoom(room.code)).emit(EVENTS.DRIVER_CHANGED, { driver: driverInfo(room.driver), reason });
      broadcastState(room);
    },
  });

  /** Send the cached display-state, with the server-owned fields filled in, to controllers. */
  function broadcastState(room, target = io.to(ctlRoom(room.code))) {
    if (!room.displayState) return;
    target.emit(EVENTS.DISPLAY_STATE, {
      ...room.displayState,
      room: room.code,
      driver: driverInfo(room.driver),
      controllerCount: room.controllers.size,
    });
  }

  function sendError(socket, code, message, event, extra = {}) {
    socket.emit(EVENTS.ERROR, { code, message, ...(event ? { event } : {}), ...extra });
  }

  function register(socket, p, ack) {
    if (socket.data.client) {
      return reject('Already registered.', ERROR_CODES.FORBIDDEN);
    }
    function reject(message, code) {
      const error = { code, message, event: EVENTS.REGISTER };
      sendError(socket, code, message, EVENTS.REGISTER);
      ack?.({ ok: false, error });
    }

    let room;
    let client;
    if (p.role === ROLES.DISPLAY) {
      room = rooms.roomForDisplay(p.room);
      const old = room.display;
      if (old) {
        sendError(old.socket, ERROR_CODES.FORBIDDEN, 'A newer display took over this room.');
        old.socket.disconnect(true); // runs the disconnect handler: peer-left, room.display = null
      }
      client = { id: newId('d'), role: ROLES.DISPLAY, label: 'Display', isHost: false };
    } else {
      room = rooms.get(p.room);
      if (!room) return reject('That room is not available. Check the code on the display.', ERROR_CODES.NO_ROOM);
      if (p.role === ROLES.HOST) {
        if (!keyOk(p.key)) return reject('This host link has the wrong key.', ERROR_CODES.BAD_KEY);
        client = { id: newId('h'), role: ROLES.HOST, label: 'Host', isHost: true };
      } else {
        client = { id: newId('c'), role: ROLES.GUEST, label: rooms.nextGuestLabel(room), isHost: false };
      }
    }
    client.socket = socket;
    client.room = room.code;
    socket.data.client = client;
    rooms.join(room, client);
    socket.join(allRoom(room.code));
    if (client.role !== ROLES.DISPLAY) socket.join(ctlRoom(room.code));

    ack?.({ ok: true, room: room.code, clientId: client.id, role: client.role, label: client.label });

    // Announce in both directions (master plan 12.7), so link status is right in any join order.
    socket.to(allRoom(room.code)).emit(EVENTS.PEER_JOINED, peerInfo(client));
    for (const peer of [room.display, ...room.controllers.values()]) {
      if (peer && peer !== client) socket.emit(EVENTS.PEER_JOINED, peerInfo(peer));
    }
    if (client.role !== ROLES.DISPLAY) {
      broadcastState(room); // controllerCount changed; also syncs the newcomer
      if (room.displayState) socket.emit(EVENTS.FOCUS_STATE, room.focusState);
    }
    log(`[${room.code}] + ${client.label} (${client.id})`);
  }

  function handle(socket, limiter, event, args) {
    if (!KNOWN.has(event)) return; // unknown names are ignored
    const ack = typeof args.at(-1) === 'function' ? args.pop() : null;
    const payload = args[0];

    if (!limiter.allow(event)) {
      if (limiter.shouldWarn()) sendError(socket, ERROR_CODES.RATE_LIMITED, 'Too many messages; some were dropped.', event);
      return;
    }

    if (!(event in validators)) {
      return sendError(socket, ERROR_CODES.FORBIDDEN, `${event} is sent by the server only.`, event);
    }
    const client = socket.data.client;
    const room = client ? rooms.get(client.room) : null;
    if (event !== EVENTS.REGISTER) {
      if (!client || !room) return sendError(socket, ERROR_CODES.FORBIDDEN, 'Register first.', event);
      const perm = PERMISSION[event];
      const allowed =
        perm === 'display' ? client.role === ROLES.DISPLAY
        : perm === 'host' ? client.isHost
        : perm === 'controller' ? client.role !== ROLES.DISPLAY
        : perm === 'driver-or-host' ? client.isHost || room.driver === client
        : false;
      if (!allowed) {
        const why = perm === 'driver-or-host' ? 'Press Take control first.' : `Your role can't send ${event}.`;
        return sendError(socket, ERROR_CODES.FORBIDDEN, why, event);
      }
    }

    let clean;
    try {
      clean = validators[event](payload, room);
    } catch (err) {
      if (!(err instanceof BadPayload)) throw err;
      sendError(socket, ERROR_CODES.BAD_PAYLOAD, err.message, event);
      ack?.({ ok: false, error: { code: ERROR_CODES.BAD_PAYLOAD, message: err.message } });
      return;
    }
    if (event === EVENTS.REGISTER) return register(socket, clean, ack);

    if (PERMISSION[event] === 'driver-or-host') rooms.touch(room, client);

    if (event === EVENTS.TAKE_CONTROL) {
      const r = rooms.takeControl(room, client);
      if (!r.ok) {
        sendError(socket, ERROR_CODES.LOCKED,
          `${r.driver.label} is driving. Try again when they stop, or ask the host.`, event,
          { driver: driverInfo(r.driver) });
      }
    } else if (event === EVENTS.DISPLAY_STATE) {
      room.displayState = clean;
      broadcastState(room);
    } else if (event === EVENTS.FOCUS_STATE) {
      room.focusState = clean;
      io.to(ctlRoom(room.code)).emit(EVENTS.FOCUS_STATE, clean);
    } else if (event === EVENTS.STEER_UPDATE || event === EVENTS.STEER_RESET) {
      sendError(socket, ERROR_CODES.FORBIDDEN, 'Steer is not available yet.', event); // batch 2
    } else if (TO_DISPLAY.has(event)) {
      room.display?.socket.emit(event, clean);
    }
  }

  io.on('connection', (socket) => {
    const limiter = new Limiter();
    socket.onAny((event, ...args) => {
      try {
        handle(socket, limiter, event, args);
      } catch (err) {
        log(`relay error on ${event}: ${err?.stack || err}`);
      }
    });
    socket.on('disconnect', () => {
      const client = socket.data.client;
      if (!client) return;
      const room = rooms.get(client.room);
      if (!room) return;
      try {
        rooms.leave(room, client);
        io.to(allRoom(room.code)).emit(EVENTS.PEER_LEFT, peerInfo(client));
        if (client.role !== ROLES.DISPLAY) broadcastState(room);
        log(`[${room.code}] - ${client.label} (${client.id})`);
      } catch (err) {
        log(`relay error on disconnect: ${err?.stack || err}`);
      }
    });
  });

  return rooms;
}
