// Payload validation per event (contract v1 section 5). Each validator returns a clean payload, or throws a
// BadPayload with a short message. Unknown extra fields are dropped. Nothing here trusts the client.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS, MODES, LAYER_MODES } from '../contract/contract.js';

export const MAX_PAYLOAD_CHARS = 64 * 1024;

export class BadPayload extends Error {}

const fail = (msg) => { throw new BadPayload(msg); };
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function obj(p) {
  if (!isObj(p)) fail('payload must be an object');
  return p;
}
function num(v, name, lo, hi) {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${name} must be a finite number`);
  return clamp(v, lo, hi);
}
function int(v, name, lo, hi) {
  if (!Number.isInteger(v) || v < lo || v > hi) fail(`${name} must be an integer ${lo}–${hi}`);
  return v;
}
function str(v, name, max) {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) fail(`${name} must be a string of 1–${max} chars`);
  return v;
}
function size(p) {
  let n;
  try { n = JSON.stringify(p)?.length ?? 0; } catch { fail('payload is not JSON'); }
  if (n > MAX_PAYLOAD_CHARS) fail('payload too large');
}

// Manifest image ids, re-read when the file changes.
const MANIFEST = join(import.meta.dirname, '..', 'web', 'public', 'assets', 'manifest.json');
let manifestCache = { mtime: -1, ids: new Set() };
export function manifestIds() {
  try {
    const mtime = statSync(MANIFEST).mtimeMs;
    if (mtime !== manifestCache.mtime) {
      const ids = JSON.parse(readFileSync(MANIFEST, 'utf8')).images.map((i) => i.id);
      manifestCache = { mtime, ids: new Set(ids) };
    }
  } catch {
    manifestCache = { mtime: -1, ids: new Set() };
  }
  return manifestCache.ids;
}

const empty = (p) => { obj(p); return {}; };

/** event -> (payload, room) => clean payload. `room` gives access to the cached display-state. */
export const validators = {
  [EVENTS.REGISTER]: (p) => {
    obj(p);
    if (!['display', 'host', 'guest'].includes(p.role)) fail('role must be display, host or guest');
    const room = p.room === null || p.room === undefined ? null : str(p.room, 'room', 16);
    const key = p.key === undefined || p.key === null ? null : str(p.key, 'key', 256);
    return { role: p.role, room, key };
  },
  [EVENTS.TAKE_CONTROL]: empty,
  [EVENTS.CLEAR_FOCUS]: empty,
  [EVENTS.RESET_VIEW]: empty,
  [EVENTS.STEER_RESET]: empty,
  [EVENTS.CONTROL_ORBIT]: (p) => (obj(p), { dx: num(p.dx, 'dx', -1, 1), dy: num(p.dy, 'dy', -1, 1) }),
  [EVENTS.CONTROL_ZOOM]: (p) => (obj(p), { dz: num(p.dz, 'dz', -1, 1) }),
  [EVENTS.FOCUS_TIP]: (p, room) => {
    obj(p);
    const classId = int(p.classId, 'classId', 0, 999);
    const answers = room?.displayState?.answers;
    if (!Array.isArray(answers) || !answers.some((a) => a?.classId === classId)) {
      fail(`classId ${classId} is not in the current answer list`);
    }
    return { classId };
  },
  [EVENTS.SELECT_IMAGE]: (p) => {
    obj(p);
    const imageId = str(p.imageId, 'imageId', 64);
    if (!manifestIds().has(imageId)) fail(`unknown imageId "${imageId}"`);
    return { imageId };
  },
  [EVENTS.PLAY_PULSE]: (p) => {
    obj(p);
    const out = {};
    if (p.speed !== undefined) out.speed = num(p.speed, 'speed', 0.25, 4);
    if (p.skipToEnd !== undefined) {
      if (typeof p.skipToEnd !== 'boolean') fail('skipToEnd must be a boolean');
      out.skipToEnd = p.skipToEnd;
    }
    return out;
  },
  [EVENTS.SET_MODE]: (p, room) => {
    obj(p);
    const caps = room?.displayState?.capabilities || {};
    const out = {};
    if (p.mode !== undefined) {
      if (!Object.values(MODES).includes(p.mode)) fail('unknown mode');
      if (p.mode === MODES.STABILITY && !caps.stability) fail('stability is not available for this image');
      if (p.mode === MODES.TRUNK && !caps.trunkInterior) fail('trunk interior is not available for this image');
      out.mode = p.mode;
    }
    if (p.layerMode !== undefined) {
      if (!Object.values(LAYER_MODES).includes(p.layerMode)) fail('unknown layerMode');
      if (!caps.layerModes) fail('layer modes are not available');
      out.layerMode = p.layerMode;
    }
    if (!('mode' in out) && !('layerMode' in out)) fail('set mode or layerMode');
    return out;
  },
  [EVENTS.DISPLAY_STATE]: (p) => {
    obj(p);
    size(p);
    if (!isObj(p.image) || typeof p.image.id !== 'string') fail('display-state needs image.id');
    if (!Array.isArray(p.answers) || p.answers.length > 64) fail('display-state needs answers (≤ 64)');
    return p;
  },
  [EVENTS.FOCUS_STATE]: (p) => {
    if (p === null) return null;
    obj(p);
    size(p);
    int(p.classId, 'classId', 0, 999);
    return p;
  },
  [EVENTS.STEER_UPDATE]: (p) => {
    obj(p);
    const mode = p.mode === 'code' ? 'code' : p.mode === 'slider' ? 'slider' : fail('mode must be slider or code');
    if (!Array.isArray(p.channels ?? []) || (p.channels ?? []).length > 32) fail('channels must be an array (≤ 32)');
    const channels = (p.channels ?? []).map((c, i) => (obj(c), {
      channelIndex: int(c.channelIndex, `channels[${i}].channelIndex`, 0, 4095),
      scale: num(c.scale, `channels[${i}].scale`, 0, 4),
    }));
    const code = p.code === null || p.code === undefined ? null : str(p.code, 'code', 2000);
    return { layer: str(p.layer, 'layer', 64), mode, channels, code };
  },
};
