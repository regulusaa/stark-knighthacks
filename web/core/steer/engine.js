// Steer maths (contract v2 section 2.9). Pure, no Three.js: runs in the browser and in Node (engine.test.mjs).
//
// After conv5_block3_out ResNet50 does only global average pooling and one dense layer, so scaling channels is exact:
//   logits'[k] = b[k] + Σ_c W[c][k] · s_c · p_c                p_c = mean of channel c over the 7×7 grid
//   cam'_k     = ReLU( Σ_c W[c][k] · s_c · A[i][j][c] )         Grad-CAM at that layer, up to the factor 1/49
// Everything is float64 on top of the float32 files. Buffers are allocated once per image, never per call.
import { STEER, DEFAULTS } from '../../../contract/contract.js';

export const ENGINE = {
  identityTol: 1e-4,      // max |softmax(b + Wᵀp) − tree.json score| over the top 25, or Steer stays off
  size: 224,              // heatmaps are upsampled to the model crop
};

const { CHANNELS: C, CLASSES: K, GRID } = STEER;
const HW = GRID * GRID;
const S = ENGINE.size;

/** head.bin bytes → {W, b} Float32Array views (W[c][k] at c*1000+k). Throws on a wrong byte count. */
export function parseHead(buf) {
  if (buf.byteLength !== STEER.HEAD_BYTES) throw new Error(`head.bin is ${buf.byteLength} bytes, want ${STEER.HEAD_BYTES}`);
  return { W: new Float32Array(buf, 0, C * K), b: new Float32Array(buf, C * K * 4, K) };
}

/** conv5.bin bytes → Float32Array, HWC: A[(i*7+j)*2048 + c]. Throws on a wrong byte count. */
export function parseConv5(buf) {
  if (buf.byteLength !== STEER.CONV5_BYTES) throw new Error(`conv5.bin is ${buf.byteLength} bytes, want ${STEER.CONV5_BYTES}`);
  return new Float32Array(buf);
}

/** Numerically stable softmax of z into out (both length K). */
export function softmax(z, out) {
  let m = -Infinity;
  for (let k = 0; k < z.length; k++) if (z[k] > m) m = z[k];
  let sum = 0;
  for (let k = 0; k < z.length; k++) { out[k] = Math.exp(z[k] - m); sum += out[k]; }
  for (let k = 0; k < z.length; k++) out[k] /= sum;
  return out;
}

// --- CC-2's upsampling (pipeline/gradcam.py to_png): PIL Image.resize(BILINEAR) of the float 7×7 map to 224×224.
// PIL samples output pixel x at source centre (x + 0.5)·7/224, weights taps by the triangle 1 − |d| about the
// half-pixel centres, drops taps outside the image and renormalizes (so the edges clamp). Separable: rows, then
// columns. Precomputed once: for each output coordinate, two source indices and their weights.
const TAPS = (() => {
  const i0 = new Int32Array(S), i1 = new Int32Array(S), w0 = new Float64Array(S), w1 = new Float64Array(S);
  const scale = GRID / S;
  for (let x = 0; x < S; x++) {
    const center = (x + 0.5) * scale;
    const xmin = Math.max(Math.trunc(center - 1 + 0.5), 0);
    const xmax = Math.min(Math.trunc(center + 1 + 0.5), GRID);
    let a = [], ws = 0;
    for (let s = xmin; s < xmax; s++) {
      const w = Math.max(0, 1 - Math.abs(s - center + 0.5));
      if (w > 0) { a.push([s, w]); ws += w; }
    }
    if (a.length === 1) a.push([a[0][0], 0]);
    i0[x] = a[0][0]; w0[x] = a[0][1] / ws; i1[x] = a[1][0]; w1[x] = a[1][1] / ws;
  }
  return { i0, i1, w0, w1 };
})();

/**
 * 7×7 (row-major, ≥ 0) → 224×224 uint8, normalized so the brightest upsampled pixel is 255 (as to_png does).
 * `tmp` is a 7×224 Float64Array scratch buffer, `out` a 224×224 Uint8Array. Returns false if nothing is positive.
 */
export function upsample(map7, out, tmp = new Float64Array(GRID * S), up = new Float64Array(S * S)) {
  const { i0, i1, w0, w1 } = TAPS;
  for (let r = 0; r < GRID; r++) {
    for (let x = 0; x < S; x++) tmp[r * S + x] = map7[r * GRID + i0[x]] * w0[x] + map7[r * GRID + i1[x]] * w1[x];
  }
  let peak = 0;
  for (let y = 0; y < S; y++) {
    const ra = i0[y] * S, rb = i1[y] * S, wa = w0[y], wb = w1[y];
    for (let x = 0; x < S; x++) {
      const v = Math.max(0, tmp[ra + x] * wa + tmp[rb + x] * wb);
      up[y * S + x] = v;
      if (v > peak) peak = v;
    }
  }
  if (!(peak > 0)) { out.fill(0); return false; }
  const k = 255 / peak;
  for (let i = 0; i < S * S; i++) out[i] = Math.min(255, Math.round(up[i] * k));
  return true;
}

/** The engine for one head. Load an image with setImage(); everything else works on that image. */
export function createEngine({ W, b }) {
  const baseline = new Float64Array(K);
  const logits = new Float64Array(K);
  const probs = new Float64Array(K);
  const p = new Float64Array(C);
  const wk = new Float64Array(C);
  const cam7 = new Float64Array(HW);
  const tmp = new Float64Array(GRID * S);
  const up = new Float64Array(S * S);
  const contrib = new Float64Array(C);
  let A = null;
  let camCache = new Map();   // classId → unsteered raw 7×7 (Float64Array)
  let topCache = new Map();   // classId → channels sorted by contribution, strongest first
  let image = null;

  function column(k) {
    for (let c = 0; c < C; c++) wk[c] = W[c * K + k];
    return wk;
  }

  /** Iterate (channel, scale) pairs from a Map, [[c, s]] or [{channel, scale}]. */
  function each(scales, fn) {
    if (!scales) return;
    if (scales instanceof Map) { for (const [c, s] of scales) fn(c, s); return; }
    for (const e of scales) Array.isArray(e) ? fn(e[0], e[1]) : fn(e.channel, e.scale);
  }

  const engine = {
    get imageId() { return image; },
    get baseline() { return baseline; },
    get logits() { return logits; },
    get probs() { return probs; },

    /**
     * Load one image's conv5 activations. Computes p and the baseline logits once.
     * If `tree` is given, checks softmax(baseline) against tree.json's top 25 scores.
     * @returns {{ok: boolean, maxErr: number|null}}
     */
    setImage(imageId, conv5) {
      A = conv5;
      image = imageId;
      camCache = new Map();
      topCache = new Map();
      p.fill(0);
      for (let ij = 0; ij < HW; ij++) {
        const o = ij * C;
        for (let c = 0; c < C; c++) p[c] += A[o + c];
      }
      for (let c = 0; c < C; c++) p[c] /= HW;
      for (let k = 0; k < K; k++) baseline[k] = b[k];
      for (let c = 0; c < C; c++) {
        const pc = p[c];
        if (pc === 0) continue;
        const o = c * K;
        for (let k = 0; k < K; k++) baseline[k] += W[o + k] * pc;
      }
      logits.set(baseline);
      softmax(logits, probs);
      return engine;
    },

    /** max |baseline softmax − tree score| over tree.topK (the identity check). */
    identityError(tree) {
      softmax(baseline, probs);
      let maxErr = 0;
      for (const e of tree?.topK ?? []) maxErr = Math.max(maxErr, Math.abs(probs[e.classId] - e.score));
      logits.set(baseline);
      return (tree?.topK?.length ?? 0) > 0 ? maxErr : Infinity;
    },

    /** Steered logits and softmax for these scales (only s ≠ 1 matter). Writes engine.logits / engine.probs. */
    apply(scales) {
      logits.set(baseline);
      each(scales, (c, s) => {
        const d = (s - 1) * p[c];
        if (d === 0) return;
        const o = c * K;
        for (let k = 0; k < K; k++) logits[k] += W[o + k] * d;
      });
      softmax(logits, probs);
      return probs;
    },

    /** Index of the largest steered score (ties → lowest class id). */
    argmax(v = probs) {
      let best = 0;
      for (let k = 1; k < K; k++) if (v[k] > v[best]) best = k;
      return best;
    },

    /** The class ids ranked by steered score, top n. */
    ranked(n = DEFAULTS.TOP_K, v = probs) {
      const idx = Array.from({ length: K }, (_, k) => k);
      idx.sort((a, c) => v[c] - v[a] || a - c);
      return idx.slice(0, n);
    },

    /** Raw unsteered 7×7 Grad-CAM for a class (Σ_c W[c][k] A[ij][c], before ReLU), cached. */
    camRaw(classId) {
      let m = camCache.get(classId);
      if (m) return m;
      m = new Float64Array(HW);
      const w = column(classId);
      for (let ij = 0; ij < HW; ij++) {
        const o = ij * C;
        let s = 0;
        for (let c = 0; c < C; c++) s += w[c] * A[o + c];
        m[ij] = s;
      }
      camCache.set(classId, m);
      return m;
    },

    /**
     * Steered Grad-CAM for a class: the cached unsteered map plus the change from each scaled channel, ReLU,
     * then CC-2's upsampling and normalization into `out` (224×224 Uint8Array).
     * Returns {rawMax, map7} or null when there is no positive evidence (never a fake map).
     */
    cam(classId, scales, out) {
      cam7.set(engine.camRaw(classId));
      each(scales, (c, s) => {
        if (s === 1) return;
        const w = W[c * K + classId] * (s - 1);
        for (let ij = 0; ij < HW; ij++) cam7[ij] += w * A[ij * C + c];
      });
      let rawMax = 0;
      for (let ij = 0; ij < HW; ij++) { if (cam7[ij] < 0) cam7[ij] = 0; if (cam7[ij] > rawMax) rawMax = cam7[ij]; }
      if (!(rawMax > 0)) return null;
      if (out) upsample(cam7, out, tmp, up);
      return { rawMax, map7: cam7 };
    },

    /** W[c][k]·p_c for every channel (the channel's share of the logit), into a shared buffer. */
    contributions(classId) {
      for (let c = 0; c < C; c++) contrib[c] = W[c * K + classId] * p[c];
      return contrib;
    },

    /** The n channels that contribute most to a class, strongest first: [{channel, contribution}]. */
    topChannels(classId, n = 5) {
      let list = topCache.get(classId);
      if (!list) {
        const v = engine.contributions(classId);
        list = Array.from({ length: C }, (_, c) => c).sort((x, y) => v[y] - v[x] || x - y).slice(0, 64)
          .map((c) => ({ channel: c, contribution: v[c] }));
        topCache.set(classId, list);
      }
      return list.slice(0, n);
    },

    /** One channel's 7×7 activations normalized by their max, and upsampled into `out`. null if it never fires. */
    channelMap(channel, out) {
      let max = 0;
      for (let ij = 0; ij < HW; ij++) { cam7[ij] = A[ij * C + channel]; if (cam7[ij] > max) max = cam7[ij]; }
      if (!(max > 0)) return null;
      for (let ij = 0; ij < HW; ij++) cam7[ij] = Math.max(0, cam7[ij]) / max;
      if (out) upsample(cam7, out, tmp, up);
      return { max, map7: cam7 };
    },

    pooled(channel) { return p[channel]; },
  };
  return engine;
}

/**
 * Browser/Node loader: fetch head.bin once (the caller caches the engine) and each image's conv5.bin.
 * `fetchBytes(url)` → ArrayBuffer; defaults to fetch().
 */
export async function loadHead(fetchBytes = defaultFetch, url = '/assets/steer/head.bin') {
  return parseHead(await fetchBytes(url));
}
export async function loadConv5(folder, fetchBytes = defaultFetch) {
  return parseConv5(await fetchBytes(`${folder}conv5.bin`));
}
async function defaultFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}
