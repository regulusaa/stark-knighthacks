// Rooms, guest labels and the driver lock (contract v1 section 4). No sockets here: the relay passes in
// plain client records ({id, role, label, isHost}) and reacts to the onDriverChanged callback.
import { randomInt } from 'node:crypto';
import { ROOM_CODE, DEFAULTS } from '../contract/contract.js';

const CODE_RE = new RegExp(`^[${ROOM_CODE.ALPHABET}]{${ROOM_CODE.LENGTH}}$`);

/** Uppercases and checks a room code; returns null if it is not a valid code. */
export function normalizeCode(code) {
  if (typeof code !== 'string') return null;
  const up = code.trim().toUpperCase();
  return CODE_RE.test(up) ? up : null;
}

export class Rooms {
  constructor({ fixedRoom = null, idleMs = DEFAULTS.DRIVER_IDLE_MS, emptyRoomMs = 10 * 60 * 1000, onDriverChanged }) {
    this.rooms = new Map();
    this.idleMs = idleMs;
    this.emptyRoomMs = emptyRoomMs;
    this.onDriverChanged = onDriverChanged;
    this.fixedRoom = fixedRoom ? normalizeCode(fixedRoom) : null;
    if (fixedRoom && !this.fixedRoom) throw new Error(`STARK_FIXED_ROOM "${fixedRoom}" is not a valid room code`);
    if (this.fixedRoom) this.create(this.fixedRoom, true);
  }

  get(code) {
    const c = normalizeCode(code);
    return c ? this.rooms.get(c) || null : null;
  }

  create(code, fixed = false) {
    const room = {
      code, fixed,
      display: null,          // client record of the display
      controllers: new Map(), // clientId -> client record
      guestCount: 0,
      driver: null,           // client record of the driver
      idleTimer: null,
      emptyTimer: null,
      displayState: null,     // last display-state from the display (before server fields are filled in)
      focusState: null,
      steerState: null,       // last steer-result from the display (v2); replayed to controllers that join
    };
    this.rooms.set(code, room);
    return room;
  }

  /** Room for a registering display: the fixed room, the room it names (reclaim after reload), or a new code. */
  roomForDisplay(requested) {
    if (this.fixedRoom) return this.rooms.get(this.fixedRoom);
    const code = normalizeCode(requested);
    if (code) return this.rooms.get(code) || this.create(code);
    return this.create(this.newCode());
  }

  newCode() {
    for (;;) {
      let code = '';
      for (let i = 0; i < ROOM_CODE.LENGTH; i++) code += ROOM_CODE.ALPHABET[randomInt(ROOM_CODE.ALPHABET.length)];
      if (!this.rooms.has(code)) return code;
    }
  }

  nextGuestLabel(room) {
    room.guestCount += 1;
    return `Guest ${room.guestCount}`;
  }

  join(room, client) {
    clearTimeout(room.emptyTimer);
    room.emptyTimer = null;
    if (client.role === 'display') room.display = client;
    else room.controllers.set(client.id, client);
  }

  leave(room, client) {
    if (room.display === client) room.display = null;
    room.controllers.delete(client.id);
    if (room.driver === client) this.setDriver(room, null, 'disconnect');
    if (!room.display && room.controllers.size === 0 && !room.fixed) {
      room.emptyTimer = setTimeout(() => this.rooms.delete(room.code), this.emptyRoomMs);
      room.emptyTimer.unref?.();
    }
  }

  // --- driver lock -------------------------------------------------------------------------------------------

  /** take-control. Returns {ok:true} or {ok:false, driver} when a guest is locked out. */
  takeControl(room, client) {
    if (room.driver === client) {
      this.touch(room, client);
      return { ok: true };
    }
    if (client.isHost) {
      this.setDriver(room, client, room.driver ? 'host-override' : 'take');
      return { ok: true };
    }
    if (room.driver) return { ok: false, driver: room.driver };
    this.setDriver(room, client, 'take');
    return { ok: true };
  }

  /** Driver-gated input from `client`: restarts the idle timer if it is the driver. */
  touch(room, client) {
    if (room.driver !== client) return;
    clearTimeout(room.idleTimer);
    room.idleTimer = setTimeout(() => this.setDriver(room, null, 'idle'), this.idleMs);
    room.idleTimer.unref?.();
  }

  setDriver(room, client, reason) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
    room.driver = client;
    if (client) this.touch(room, client);
    this.onDriverChanged(room, reason);
  }

  close() {
    for (const room of this.rooms.values()) {
      clearTimeout(room.idleTimer);
      clearTimeout(room.emptyTimer);
    }
  }
}

export function driverInfo(client) {
  return client ? { id: client.id, label: client.label, isHost: client.isHost } : null;
}
