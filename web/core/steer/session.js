// Steer session on the display (contract v2 sections 3.4, 5): owns SteerState for the current image.
// No Three.js: main.js feeds it images and steer events, calls tick() once per frame, and listens:
//   'applied'    every apply (at most once a frame): steered probs, Brain node values, answers. For the visuals.
//   'result'     the SteerState after every apply; net.js sends it as steer-result (≤ STEER_SEND_HZ, final included).
//   'capability' {steer: boolean} when an image becomes (un)steerable.
// Updates are latest-wins: a lower seq than the last one applied from the same driver is dropped, and of several
// updates that arrive within one frame only the newest is applied.
import { DEFAULTS, STEER } from '../../../contract/contract.js';
import { parse, resolve, format, makeClassFinder } from '../../../contract/steer-dsl.js';
import { createEngine, parseHead, parseConv5, ENGINE } from './engine.js';

export const SESSION = {
  setSize: 5,            // slider rows per set (top-1 and top-2 of the unsteered image)
};

async function defaultFetchBytes(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}
async function defaultFetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const slotError = (message) => ({ line: 1, col: 1, message });

/**
 * Slider rows for class k: its top channels by contribution, except that the top-1's rows lead with the image's flip
 * set (steer.json, the smallest set whose zeroing changes the answer) when it fits, so the flip is reachable from
 * the phone (BUGS #1: on the wolf, channel 252 of the flip set was not among the top-5 by contribution).
 */
function rowsFor(engine, k, flip) {
  const top = engine.topChannels(k, 64);
  if (!flip?.channels?.length || flip.from !== k || flip.channels.length > SESSION.setSize) return top.slice(0, SESSION.setSize);
  const v = engine.contributions(k);
  const rows = flip.channels.map((c) => ({ channel: c, contribution: v[c] }));
  for (const r of top) { if (rows.length >= SESSION.setSize) break; if (!flip.channels.includes(r.channel)) rows.push(r); }
  return rows;
}

/** Validate a slider set again on the display: → {ok, scales: Map} | {ok:false, error}. */
export function validateSet(set) {
  if (!Array.isArray(set)) return { ok: false, error: slotError('set must be a list of {channel, scale}') };
  if (set.length > DEFAULTS.STEER_MAX_CHANNELS) return { ok: false, error: slotError(`at most ${DEFAULTS.STEER_MAX_CHANNELS} channels`) };
  const scales = new Map();
  for (const e of set) {
    const c = e?.channel;
    const s = e?.scale;
    if (!Number.isInteger(c) || c < 0 || c >= STEER.CHANNELS) return { ok: false, error: slotError(`channel ${c} is not 0–${STEER.CHANNELS - 1}`) };
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0 || s > DEFAULTS.STEER_MAX_SCALE) {
      return { ok: false, error: slotError(`scale ${s} for channel ${c} is not 0–${DEFAULTS.STEER_MAX_SCALE}`) };
    }
    if (scales.has(c)) return { ok: false, error: slotError(`channel ${c} appears twice`) };
    if (s !== 1) scales.set(c, s);
  }
  return { ok: true, scales };
}

export function createSteerSession({ fetchBytes = defaultFetchBytes, fetchJson = defaultFetchJson, assetsBase = '/assets/' } = {}) {
  const listeners = { applied: new Set(), result: new Set(), capability: new Set() };
  const emit = (name, v) => { for (const cb of listeners[name]) { try { cb(v); } catch (err) { console.error(`[stark] steer ${name} listener failed:`, err); } } };

  let headPromise = null;   // {engine, classes, findClass}, loaded once per page
  let core = null;
  let img = null;           // the current image: {id, tree, gradcam, entry, ...}; null when Steer is off
  let token = 0;

  // the current intervention
  let scales = new Map();
  let source = null;
  let probe = null;
  let error = null;
  let seq = 0;
  const lastSeq = new Map(); // driver → last applied seq
  let pending = null;        // the newest update not yet applied
  let state = null;          // the last SteerState
  let last = null;           // the last 'applied' payload

  function loadCore() {
    headPromise ??= (async () => {
      const [buf, classes] = await Promise.all([fetchBytes(`${assetsBase}steer/head.bin`), fetchJson(`${assetsBase}steer/classes.json`)]);
      const engine = createEngine(parseHead(buf));
      const list = classes.classes;
      if (!Array.isArray(list) || list.length !== STEER.CLASSES) throw new Error(`steer/classes.json has ${list?.length} classes`);
      return { engine, labels: list.map((c) => c.label), findClass: makeClassFinder(list) };
    })();
    return headPromise;
  }

  function disable() {
    img = null;
    pending = null;
    state = null;
    last = null;
    emit('capability', { steer: false });
  }

  /** Post-order node list and leaf bookkeeping for one tree, so node values are a single pass per apply. */
  function prepareTree(tree) {
    const byId = new Map(tree.nodes.map((n) => [n.id, n]));
    const order = [];
    const visit = (n) => { for (const c of n.children) visit(byId.get(c)); order.push(n); };
    visit(byId.get(tree.rootId));
    const leafOf = new Map();  // classId → leaf node id
    let other = null;
    for (const n of tree.nodes) {
      if (!n.isLeaf) continue;
      if (n.isOther) other = n.id;
      else leafOf.set(n.classId, n.id);
    }
    return { order, leafOf, other };
  }

  function answer(classId, rank, heat) {
    const { engine, labels } = core;
    // unsteered, a class in tree.json shows the pipeline's own score (the engine agrees to < 1e-4; see identity)
    const score = scales.size === 0 && img.treeScore.has(classId) ? img.treeScore.get(classId) : engine.probs[classId];
    return {
      classId, label: labels[classId], score, rank,
      hasHeatmap: heat !== null, heatmapSource: heat,
      isTop1: rank === 1, isTrueClass: classId === img.trueId,
    };
  }

  /** Where a class's heatmap comes from right now: the stored PNG when unsteered, otherwise live (null if no evidence). */
  function heatSource(classId) {
    if (scales.size === 0 && img.pngs.has(classId)) return 'precomputed';
    return core.engine.cam(classId, scales) ? 'live' : null;
  }

  function rankOf(classId) {
    const p = core.engine.probs;
    const v = p[classId];
    let r = 1;
    for (let k = 0; k < p.length; k++) if (p[k] > v || (p[k] === v && k < classId)) r += 1;
    return r;
  }

  /** Apply the current scales and rebuild everything derived from them. */
  function applyNow() {
    const { engine } = core;
    const probs = engine.apply(scales);
    const ranked = engine.ranked(DEFAULTS.ANSWER_LIST);
    const answers = ranked.map((k, i) => answer(k, i + 1, heatSource(k)));
    let trueAnswer = null;
    if (img.trueId !== null) {
      trueAnswer = answers.find((a) => a.classId === img.trueId) ?? null;
      if (!trueAnswer) { trueAnswer = answer(img.trueId, rankOf(img.trueId), heatSource(img.trueId)); answers.push(trueAnswer); }
    }
    const top1 = answers[0];
    const outsideBrain = img.prep.leafOf.has(top1.classId) ? null : top1;

    // Brain: leaf = steered score, other = 1 − the displayed leaves, inner = sum of its children
    const values = new Map();
    let shown = 0;
    for (const [classId, id] of img.prep.leafOf) { values.set(id, probs[classId]); shown += probs[classId]; }
    if (img.prep.other) values.set(img.prep.other, Math.max(0, 1 - shown));
    for (const n of img.prep.order) {
      if (n.isLeaf) continue;
      let s = 0;
      for (const c of n.children) s += values.get(c) ?? 0;
      values.set(n.id, s);
    }
    const litLeaf = outsideBrain ? img.prep.other : img.prep.leafOf.get(top1.classId);
    const scaleList = [...scales].sort((a, b) => a[0] - b[0]).map(([channel, scale]) => ({ channel, scale }));

    state = {
      seq,
      imageId: img.id,
      active: scales.size > 0,
      source: scales.size > 0 ? source : null,
      scales: scaleList,
      code: scales.size > 0 ? format(scales) : null,
      sets: img.sets,
      result: {
        answers,
        top1,
        baselineTop1: img.baselineTop1,
        top1Changed: top1.classId !== img.baselineTop1.classId,
        outsideBrain,
      },
      probe,
      error,
    };
    last = { imageId: img.id, probs, values, litLeaf, answers, top1, trueAnswer, scales, probe, state,
      summary: { active: state.active, changedCount: scales.size, top1Changed: state.result.top1Changed } };
    emit('applied', last);
    emit('result', state);
  }

  /** Turn one update into new scales (or an error that leaves them unchanged). */
  function process(u) {
    if (u.reset) {
      scales = new Map(); source = null; probe = null; error = null; seq = 0;
      return;
    }
    if (typeof u.code === 'string') {
      const parsed = parse(u.code);
      const resolved = parsed.ok ? resolve(parsed.statements, {
        findClass: core.findClass,
        topChannels: (k, n) => core.engine.topChannels(k, n).map((c) => c.channel),
      }) : parsed;
      seq = u.seq;
      probe = null;
      if (!resolved.ok) { error = resolved.error; return; }
      scales = resolved.scales; source = 'code'; error = null;
      return;
    }
    const v = validateSet(u.set);
    seq = u.seq;
    if (!v.ok) { error = v.error; return; }
    scales = v.scales;
    source = u.source ?? 'slider';
    probe = Number.isInteger(u.probe) && u.probe >= 0 && u.probe < STEER.CHANNELS ? u.probe : null;
    error = null;
  }

  const session = {
    on(name, cb) { listeners[name].add(cb); return () => listeners[name].delete(cb); },
    get ready() { return Boolean(img); },
    get state() { return state; },
    get last() { return last; },
    get engine() { return core?.engine ?? null; },
    get scales() { return scales; },
    get imageId() { return img?.id ?? null; },
    /** The flip channels for the current image (steer.json), for the keyboard fallback. */
    get flipChannels() { return img?.flip?.channels ?? null; },

    /**
     * A new image is showing. Steer turns on only for steerable (ResNet50) images whose head and conv5 load and
     * whose baseline reproduces tree.json (the identity check); otherwise steer=false and no steered number shows.
     */
    async setImage(entry, assets) {
      const mine = ++token;
      scales = new Map(); source = null; probe = null; error = null; seq = 0;
      lastSeq.clear();
      pending = null;
      if (!entry?.steerable || !assets?.tree || assets.tree.scoreKind !== 'softmax') { disable(); return false; }
      img = null;
      emit('capability', { steer: false });
      try {
        core = await loadCore();
        const [conv5, steerJson] = await Promise.all([
          fetchBytes(`${assets.base}conv5.bin`).then(parseConv5),
          fetchJson(`${assets.base}steer.json`).catch(() => null),
        ]);
        if (mine !== token) return false;
        core.engine.setImage(entry.id, conv5);
        const err = core.engine.identityError(assets.tree);
        if (!(err < ENGINE.identityTol)) {
          console.error(`[stark] Steer is off for ${entry.id}: the identity check failed (max |softmax(b + Wᵀp) − tree score| = ${err.toExponential(2)}, limit ${ENGINE.identityTol})`);
          disable();
          return false;
        }
        const tree = assets.tree;
        const pngs = new Set((assets.gradcam?.classes ?? []).filter((c) => c.hasHeatmap).map((c) => c.classId));
        const [k1, k2] = [tree.topK[0].classId, tree.topK[1].classId];
        const set = (k) => ({ classId: k, label: core.labels[k], channels: rowsFor(core.engine, k, steerJson?.flip) });
        img = {
          id: entry.id, tree, entry, pngs, flip: steerJson?.flip ?? null,
          trueId: tree.trueClass?.classId ?? null,
          treeScore: new Map(tree.topK.map((e) => [e.classId, e.score])),
          prep: prepareTree(tree),
          sets: { top1: set(k1), top2: set(k2) },
        };
        core.engine.apply(scales);
        img.baselineTop1 = { ...answer(k1, 1, pngs.has(k1) ? 'precomputed' : 'live') };
        emit('capability', { steer: true });
        applyNow();
        return true;
      } catch (err) {
        if (mine !== token) return false;
        console.error(`[stark] Steer is off for ${entry.id}: ${err.message}`);
        disable();
        return false;
      }
    },

    /** steer-update from the relay (already validated there). `from` is the sender, added by the relay. */
    update(payload = {}) {
      if (!img) return false;
      const from = payload.from ?? 'local';
      const s = Number.isInteger(payload.seq) && payload.seq >= 0 ? payload.seq : null;
      if (s === null) return false;
      const prev = lastSeq.get(from);
      if (prev !== undefined && s < prev) return false;   // an older message overtaken by a newer one
      lastSeq.set(from, s);
      pending = typeof payload.code === 'string'
        ? { seq: s, code: payload.code }
        : { seq: s, set: payload.set, probe: payload.probe ?? null };
      return true;
    },
    reset() {
      if (!img) return false;
      lastSeq.clear();
      pending = { reset: true };
      return true;
    },
    /** Local changes (keyboard fallback): replace the scales directly. */
    setLocal(map, src = 'slider') {
      if (!img) return false;
      pending = { seq, set: [...map].map(([channel, scale]) => ({ channel, scale })), probe: null, source: src };
      return true;
    },
    /** Once per frame: apply the newest pending update, if any. */
    tick() {
      if (!img || !pending) return false;
      const u = pending;
      pending = null;
      process(u);
      applyNow();
      return true;
    },
    /** The steered Answer for any class (score, rank among all 1000, heatmap source); null when Steer is off. */
    answerFor(classId) {
      if (!img || !Number.isInteger(classId) || classId < 0 || classId >= STEER.CLASSES) return null;
      return answer(classId, rankOf(classId), heatSource(classId));
    },
    /** Live Grad-CAM for a class under the current scales into a 224×224 Uint8Array; null = no positive evidence. */
    cam(classId, out) { return img ? core.engine.cam(classId, scales, out) : null; },
    channelMap(channel, out) { return img ? core.engine.channelMap(channel, out) : null; },
  };
  return session;
}
