// Payload validation per event (contract v2 section 5). Each validator returns a clean payload, or throws a
// BadPayload with a short message. Unknown extra fields are dropped. Nothing here trusts the client.
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { EVENTS, MODES, LAYER_MODES, DEFAULTS, STEER } from '../contract/contract.js';
import { parse as parseSteer } from '../contract/steer-dsl.js';

export const MAX_PAYLOAD_CHARS = 64 * 1024;

export class BadPayload extends Error {
  constructor(message, extra = null) {
    super(message);
    this.extra = extra; // extra fields for the error event (e.g. the parse error of a Steer program)
  }
}

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
// Classes drawn as tips on an image (its tree.json leaves), so focus-tip accepts every drawn node, not only the
// top answers. Cached per image and file mtime.
const drawnCache = new Map();   // imageId → {mtime, ids}
export function drawnClasses(imageId) {
  try {
    const entry = JSON.parse(readFileSync(MANIFEST, 'utf8')).images.find((i) => i.id === imageId);
    if (!entry) return new Set();
    const file = join(import.meta.dirname, '..', 'web', 'public', entry.folder, 'tree.json');
    const mtime = statSync(file).mtimeMs;
    const hit = drawnCache.get(imageId);
    if (hit && hit.mtime === mtime) return hit.ids;
    const ids = new Set(JSON.parse(readFileSync(file, 'utf8')).nodes.filter((n) => n.isLeaf && !n.isOther && Number.isInteger(n.classId)).map((n) => n.classId));
    drawnCache.set(imageId, { mtime, ids });
    return ids;
  } catch {
    return new Set();
  }
}

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
  [EVENTS.SCENE_ACTION]: (p, room) => {
    obj(p);
    if (room?.displayState?.capabilities?.inspection !== true) fail('component inspection is not available on this display');
    const seq = int(p.seq, 'seq', 0, Number.MAX_SAFE_INTEGER);
    if (!['select','split','join','move','inspect','center'].includes(p.action)) fail('unknown scene action');
    const out = { seq, action: p.action };
    if (['select','inspect','move'].includes(p.action)) {
      if (!(p.action === 'move' ? ['brain','stem'] : ['brain','stem','all']).includes(p.part)) fail('unknown scene part');
      out.part = p.part;
    }
    if (p.action === 'move') {
      if (!Array.isArray(p.position) || p.position.length !== 3) fail('position needs three coordinates');
      out.position = p.position.map(n => num(n, 'position', -16, 16));
    }
    return out;
  },
  [EVENTS.FOCUS_TIP]: (p, room) => {
    obj(p);
    const classId = int(p.classId, 'classId', 0, 999);
    const st = room?.displayState;
    const answers = st?.answers;
    // a listed answer, any class drawn as a tip on this image, or (Steer live on the display) any ImageNet class: the
    // display scores it with the model's own head and computes its Grad-CAM, so nothing is invented
    const ok = (Array.isArray(answers) && answers.some((a) => a?.classId === classId))
      || (st?.image?.id && drawnClasses(st.image.id).has(classId))
      || (st?.capabilities?.steer === true && st?.scoreKind !== 'independent');
    if (!ok) fail(`classId ${classId} is not a class on the current image`);
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
    // (v3) the noise view needs its capability to turn on; off and glow are always allowed
    if (p.noiseView !== undefined) {
      if (typeof p.noiseView !== 'boolean') fail('noiseView must be a boolean');
      if (p.noiseView && !caps.noiseView) fail('the noise view is not available for this image');
      out.noiseView = p.noiseView;
    }
    if (p.bloom !== undefined) {
      if (typeof p.bloom !== 'boolean') fail('bloom must be a boolean');
      out.bloom = p.bloom;
    }
    if (!Object.keys(out).length) fail('set mode, layerMode, noiseView or bloom');
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
  // (v2) slider form {seq, set, probe?} or code form {seq, code, probe?: null}. Out-of-range values are refused,
  // not clamped: a slider can't produce them, so they mean a broken or hostile client.
  [EVENTS.STEER_UPDATE]: (p) => {
    obj(p);
    const seq = int(p.seq, 'seq', 0, Number.MAX_SAFE_INTEGER);
    const hasCode = p.code !== undefined && p.code !== null;
    if (hasCode === (p.set !== undefined && p.set !== null)) fail('send either set or code');
    if (hasCode) {
      if (typeof p.code !== 'string') fail('code must be a string');
      if (p.code.length > DEFAULTS.STEER_CODE_MAX) fail(`code is ${p.code.length} characters; the limit is ${DEFAULTS.STEER_CODE_MAX}`);
      if (p.probe !== undefined && p.probe !== null) fail('probe must be null with code');
      const r = parseSteer(p.code);
      if (!r.ok) throw new BadPayload(`code: ${r.error.message}`, { parseError: r.error });
      return { seq, code: p.code, probe: null };
    }
    if (!Array.isArray(p.set)) fail('set must be an array of {channel, scale}');
    if (p.set.length > DEFAULTS.STEER_MAX_CHANNELS) fail(`set has ${p.set.length} entries; the limit is ${DEFAULTS.STEER_MAX_CHANNELS}`);
    const seen = new Set();
    const set = p.set.map((e, i) => {
      obj(e);
      const channel = int(e.channel, `set[${i}].channel`, 0, STEER.CHANNELS - 1);
      if (typeof e.scale !== 'number' || !Number.isFinite(e.scale) || e.scale < 0 || e.scale > DEFAULTS.STEER_MAX_SCALE) {
        fail(`set[${i}].scale must be a number 0–${DEFAULTS.STEER_MAX_SCALE}`);
      }
      if (seen.has(channel)) fail(`channel ${channel} appears twice in set`);
      seen.add(channel);
      return { channel, scale: e.scale };
    });
    const probe = p.probe === undefined || p.probe === null ? null : int(p.probe, 'probe', 0, STEER.CHANNELS - 1);
    return { seq, set, probe };
  },
  // (v2) the display's SteerState: checked for shape and size only, then cached and relayed to controllers
  [EVENTS.STEER_RESULT]: (p) => {
    obj(p);
    size(p);
    int(p.seq, 'seq', 0, Number.MAX_SAFE_INTEGER);
    str(p.imageId, 'imageId', 64);
    if (!Array.isArray(p.scales) || p.scales.length > DEFAULTS.STEER_MAX_CHANNELS) fail(`scales must be an array (≤ ${DEFAULTS.STEER_MAX_CHANNELS})`);
    if (!isObj(p.result) || !Array.isArray(p.result.answers) || p.result.answers.length > 64) fail('result.answers must be an array (≤ 64)');
    return p;
  },
};
