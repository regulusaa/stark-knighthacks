// Brain layout (master plan 6.4): places the WordNet tree from tree.json inside the anatomical brain (brainShape.js).
// Pure maths, no Three.js, so node can unit-test it (brainLayout.test.mjs).
//
//  1. Leaf directions: a Fibonacci point set around the core, keeping only directions whose cortex point is visible
//     from the default view: above the base of the brain, off the frontal pole (which faces the image panel), off
//     the far (right) flank, out of the longitudinal fissure, not facing down, with open air outside it, and in
//     plain sight of the default camera (so at rest no tip, including the answer, is behind tissue).
//  2. Sunburst-style allocation: points are ordered along a Hilbert curve and leaves depth-first, so every
//     subtree gets a contiguous, compact patch of cortex whose area is proportional to its leaf count. Siblings are
//     ordered by the smallest ImageNet class id beneath them (ImageNet ids follow WordNet groupings), not by
//     score: the Brain keeps a stable semantic geography, so a different answer (e.g. the adversarial image's)
//     lands in a different region instead of always taking the first slot.
//  3. Depth maps to radius: the root at the core (the thalamus, where the brainstem enters), shallow categories near
//     it, leaves on the cortex. An internal node points at the score-weighted mean direction of its leaves, so the
//     inner veins lean toward where the model's confidence went and the chosen path runs cleanly out to its tip
//     (the tips themselves keep their fixed, score-independent places).
//  4. Edges: the stem climbs the brainstem from the trunk top to the core. Inner edges are Catmull-Rom control points
//     bowed slightly outward. A leaf's edge rises to the cortex and then drapes over it to the tip, like the nerves
//     on Ray's reference, so most of every path (and all of the chosen one's last stretch) is out in the open.
import { CORE, STEM_AXIS, surfacePoint, occluded } from './brainShape.js';

export const BRAIN = {
  core: CORE,
  trunkTop: [0, 6, 0],
  tipLift: 0.16,          // tips float this far above the cortex envelope (fold crowns sit on the envelope)
  innerFrac: 0.86,        // internal nodes: × envelope distance × depth / maxDepth
  frontHalfDeg: 32,       // no tips within this azimuth of straight ahead (−x): the frontal pole faces the panel
  minY: -0.3,             // no tips on directions pointing further down than this
  farFlankZ: -0.5,        // no tips on directions pointing further toward −z (the hidden right flank)
  midline: 0.42,          // no tips closer than this to the midline (they would sit in the fissure)
  minNormalY: -0.35,      // no tips on cortex facing further down than this (the underside is hidden)
  viewFrom: [6.51, 14.95, 10.44],   // the default camera (cameraRig.js RIG.defaultPosition; the test checks they match)
  bow: 0.09,              // outward bow of each inner edge, × edge length
  leafWeightFloor: 0.03,  // every leaf pulls its ancestors' direction by (this + its score)
  drapeGap: 0.03,         // a draped vein rides this far above the cortex (plus its own radius)
  veinRadiusBase: 0.02,
  veinRadiusScale: 0.12,  // vein radius = base + scale · sqrt(value)
};

/** Vein radius for a branch value (shared with brainMesh.js). */
export const veinRadius = (value) => BRAIN.veinRadiusBase + BRAIN.veinRadiusScale * Math.sqrt(Math.max(0, Math.min(1, value)));

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HILBERT_N = 1024;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => add(a, scale(sub(b, a), t));
function slerp(a, b, t) {
  const c = Math.max(-1, Math.min(1, dot(a, b)));
  const th = Math.acos(c);
  if (th < 1e-4) return a.slice();
  const s = Math.sin(th);
  return add(scale(a, Math.sin((1 - t) * th) / s), scale(b, Math.sin(t * th) / s));
}

/** Azimuth (radians, 0..2π) of a direction in the x-z plane, measured from +x toward +z. */
const azimuthOf = (x, z) => (Math.atan2(z, x) + 2 * Math.PI) % (2 * Math.PI);

/** Signed smallest angle a - b, in -π..π. */
const angleDiff = (a, b) => ((a - b + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;

/** Hilbert-curve index of (x, y) on an n×n grid (n a power of two). */
function hilbert(n, x, y) {
  let d = 0;
  for (let s = n / 2; s > 0; s = Math.floor(s / 2)) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
      [x, y] = [y, x];
    }
  }
  return d;
}

/** Azimuth of straight ahead (−x): the frontal pole, which faces the image panel. */
export const FRONT_AZIMUTH = Math.PI;

/** Whether a tip may sit along `dir` (from the core); returns its cortex point when it may. */
export function tipSite(dir, cfg = BRAIN) {
  if (dir[1] < cfg.minY || dir[2] < cfg.farFlankZ) return null;
  const half = (cfg.frontHalfDeg * Math.PI) / 180;
  if (Math.abs(angleDiff(azimuthOf(dir[0], dir[2]), FRONT_AZIMUTH)) < half && dir[1] < 0.9) return null;
  const s = surfacePoint(dir, cfg.core);
  if (!s || Math.abs(s.pos[2] - cfg.core[2]) < cfg.midline || s.normal[1] < cfg.minNormalY) return null;
  // open air outside it: not tucked under the occipital lobe against the cerebellum, say
  const tip = s.pos.map((v, k) => v + s.normal[k] * cfg.tipLift);
  if (occluded(tip.map((v, k) => v + s.normal[k] * 4), tip)) return null;
  if (cfg.viewFrom && occluded(cfg.viewFrom, tip)) return null;
  return s;
}

/** Exactly n tip sites ({dir, pos, normal, t}) in Hilbert order over the allowed cortex. */
export function tipSites(n, cfg = BRAIN) {
  if (n <= 0) return [];
  const sample = (m) => {
    const out = [];
    for (let i = 0; i < m; i++) {
      const y = 1 - (2 * (i + 0.5)) / m;            // uniform area over the whole sphere of directions
      const phi = (i * GOLDEN_ANGLE) % (2 * Math.PI);
      const r = Math.sqrt(1 - y * y);
      const dir = [r * Math.cos(phi), y, r * Math.sin(phi)];
      const s = tipSite(dir, cfg);
      if (s) out.push({ dir, phi, y, ...s });
    }
    return out;
  };
  // estimate how many directions survive, then grow until exactly n do (the slice keeps the first n)
  const frac = Math.max(0.05, sample(600).length / 600);
  let m = Math.max(n, Math.floor(n / frac) - 3);
  let pts = sample(m);
  while (pts.length < n) pts = sample(++m);
  pts = pts.slice(0, n);
  // Hilbert order over (azimuth measured away from the front, height): neighbours in the order sit together
  const start = FRONT_AZIMUTH;
  for (const p of pts) {
    const u = ((((p.phi - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) / (2 * Math.PI);
    const v = (1 - p.y) / (1 - cfg.minY);
    p.h = hilbert(HILBERT_N, Math.min(HILBERT_N - 1, Math.floor(u * HILBERT_N)), Math.min(HILBERT_N - 1, Math.max(0, Math.floor(v * HILBERT_N))));
  }
  pts.sort((a, b) => a.h - b.h);
  return pts;
}

/** Small deterministic hash of a string → 0..1, for per-edge variation that never changes between runs. */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

const arcLength = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += len(sub(pts[i], pts[i - 1])); return L; };

/**
 * Lay out tree.json nodes. Returns
 *   nodes: Map id → {id, pos, dir, radius, envelope, depth, isLeaf, node, normal?}
 *   edges: [{id, from, to, points:[≥2 × [x,y,z]], length, startDist, depth, value, onTop1Path, isOther, isStem}]
 *   maxDepth, top1PathLength, maxDist
 */
export function layoutBrain(tree, cfg = BRAIN) {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const root = byId.get(tree.rootId) ?? tree.nodes[0];
  // semantic order: depth-first, siblings by the smallest class id beneath them; "other" goes last
  const minClass = new Map();
  const mc = (n) => {
    const v = n.isLeaf ? (n.isOther || n.classId === null ? Infinity : n.classId)
      : Math.min(...n.children.map((c) => mc(byId.get(c))));
    minClass.set(n.id, v);
    return v;
  };
  mc(root);
  const leaves = [];
  const order = (n) => {
    if (n.isLeaf) { leaves.push(n); return; }
    [...n.children].sort((a, b) => minClass.get(a) - minClass.get(b) || (a < b ? -1 : 1)).forEach((c) => order(byId.get(c)));
  };
  order(root);
  const maxDepth = Math.max(1, ...tree.nodes.map((n) => n.depth));
  const sites = tipSites(leaves.length, cfg);
  const C = cfg.core;

  const out = new Map();
  leaves.forEach((leaf, i) => {
    const s = sites[i];
    const pos = add(s.pos, scale(s.normal, cfg.tipLift));
    out.set(leaf.id, { id: leaf.id, dir: s.dir, pos, normal: s.normal, radius: len(sub(pos, C)), envelope: s.t,
      depth: leaf.depth, isLeaf: true, node: leaf });
  });
  // internal nodes: score-weighted mean direction of their leaves; depth as a fraction of their leaves' (weighted)
  // mean envelope distance (the mean direction itself often runs up the fissure, where there is no cortex to measure)
  const leafIds = new Map();
  const collect = (n) => {
    if (n.isLeaf) { leafIds.set(n.id, [n.id]); return leafIds.get(n.id); }
    const all = [];
    for (const c of n.children) all.push(...collect(byId.get(c)));
    leafIds.set(n.id, all);
    return all;
  };
  collect(root);
  for (const n of tree.nodes) {
    if (n.isLeaf) continue;
    const ls = leafIds.get(n.id).map((id) => out.get(id));
    const w = (l) => cfg.leafWeightFloor + Math.max(0, l.node.value ?? 0);
    const dir = norm(ls.reduce((a, l) => add(a, scale(l.dir, w(l))), [0, 0, 0]));
    const env = ls.reduce((a, l) => a + l.envelope * w(l), 0) / ls.reduce((a, l) => a + w(l), 0);
    const radius = n.id === root.id ? 0 : env * cfg.innerFrac * (n.depth / maxDepth);
    out.set(n.id, { id: n.id, dir, pos: add(C, scale(dir, radius)), radius, envelope: env, depth: n.depth, isLeaf: false, node: n });
  }

  // edges, with cumulative distance from the trunk top for travelling light
  const edges = [];
  const startDist = new Map();
  const rootPos = out.get(root.id).pos;
  // the stem climbs the brainstem: trunk top, up the centreline (bottom to top), into the core
  const stemPts = [cfg.trunkTop, ...STEM_AXIS.slice(0, -1).reverse().filter((p) => p[1] > cfg.trunkTop[1] + 0.3), rootPos];
  const stemLen = arcLength(stemPts);
  edges.push({
    id: 'stem', from: null, to: root.id, isStem: true, points: stemPts,
    length: stemLen, startDist: 0, depth: 0, value: root.value ?? 1, onTop1Path: true, isOther: false,
  });
  startDist.set(root.id, stemLen);
  const walk = (n) => {
    for (const cid of n.children) {
      const c = byId.get(cid);
      const P = out.get(n.id);
      const Q = out.get(c.id);
      let points;
      if (c.isLeaf) points = drape(P, Q, c.value ?? 0, cfg);
      else {
        const L = len(sub(Q.pos, P.pos));
        const mid = lerp(P.pos, Q.pos, 0.5);
        const outward = norm(sub(mid, C));
        // a little sideways twist per edge (deterministic) so siblings don't look machine-straight
        const side = norm([outward[2], 0, -outward[0]]);
        const twist = (hash01(c.id) - 0.5) * 0.5;
        const bow = add(scale(outward, cfg.bow * L), scale(side, twist * cfg.bow * L));
        points = [P.pos, add(lerp(P.pos, Q.pos, 1 / 3), scale(bow, 0.9)), add(lerp(P.pos, Q.pos, 2 / 3), scale(bow, 0.6)), Q.pos];
      }
      const arc = arcLength(points);
      edges.push({
        id: `${n.id}>${c.id}`, from: n.id, to: c.id, isStem: false, points,
        length: arc, startDist: startDist.get(n.id), depth: c.depth, value: c.value ?? 0,
        onTop1Path: Boolean(c.onTop1Path), isOther: Boolean(c.isOther),
      });
      startDist.set(c.id, startDist.get(n.id) + arc);
      walk(c);
    }
  };
  walk(root);

  const top1Leaf = leaves.find((l) => l.onTop1Path);
  const top1PathLength = top1Leaf ? startDist.get(top1Leaf.id) : stemLen;
  const maxDist = Math.max(...startDist.values());
  for (const v of out.values()) v.dist = startDist.get(v.id) ?? 0;
  return { nodes: out, edges, maxDepth, top1PathLength, maxDist };
}

/**
 * A leaf's vein: from its parent (inside the brain) up to the cortex, then over the cortex to the tip.
 * The surface stretch follows the envelope at a fixed height above it, so it rides over the folds.
 */
function drape(P, Q, value, cfg) {
  const C = cfg.core;
  const a = P.dir, b = Q.dir;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const ride = veinRadius(value) + cfg.drapeGap;
  const onSurface = (d) => {
    const s = surfacePoint(d, C);
    return s ? add(s.pos, scale(s.normal, ride)) : add(C, scale(d, Q.envelope + ride));
  };
  if (angle < 0.12) {
    // parent straight below the tip: rise directly
    return [P.pos, lerp(P.pos, Q.pos, 0.5), onSurface(slerp(a, b, 0.9)), Q.pos];
  }
  // emerge a quarter of the way across, then ride the surface; more control points for longer drapes
  const steps = Math.max(2, Math.min(6, Math.round(angle / 0.18)));
  const pts = [P.pos];
  const emergeDir = slerp(a, b, 0.2);
  const e = surfacePoint(emergeDir, C);
  const under = e ? sub(e.pos, scale(e.normal, 0.25)) : add(C, scale(emergeDir, Q.envelope * 0.9));
  pts.push(lerp(P.pos, under, 0.6), under);
  for (let k = 1; k <= steps; k++) pts.push(onSurface(slerp(a, b, 0.2 + (0.8 * k) / (steps + 1))));
  pts.push(Q.pos);
  return pts;
}
