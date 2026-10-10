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
//     (the tips themselves keep their fixed, score-independent places). That mean direction shifts level by level as
//     the leaf set narrows, so inner nodes are then relaxed toward the line from their parent to their heaviest
//     child, at their own depth: the confident path sweeps out instead of zigzagging.
//  4. Edges are fibre tracts through the brain's volume. The stem climbs the brainstem from the trunk top and bends
//     into the core over the brainstem's upper half.
//     Every other edge is a cubic Bézier between its nodes whose handles follow per-node tangents (a node heads from
//     its parent toward the score-weighted centre of its children, bent a little outward; the root's leans up the
//     brainstem; a tip's is its cortex normal), so a whole path is smooth through every branch point, the stem's
//     own last stretch included: tracts flow out of the stem, fan out like the corona radiata and arrive square to
//     the cortex under their tips. Samples that would leave the cortex early are pulled
//     back inside it; only a leaf's last stretch crosses it, to reach the tip.
import { CORE, STEM_AXIS, surfacePoint, occluded, capSdf, gradient } from './brainShape.js';

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
  viewFrom: [6.86, 14.93, 12.5],     // the default camera (cameraRig.js RIG.defaultPosition; the test checks they match)
  leafWeightFloor: 0.03,  // every leaf pulls its ancestors' direction by (this + its score)
  relax: 0.8,             // inner nodes move this far toward the midpoint of their parent and heaviest child …
  relaxSweeps: 6,         // … this many times (top-down)
  handle: 0.38,           // Bézier handle length, × the edge's chord
  outwardBend: 0.3,       // an inner node's tangent: toward its children's centre, blended this far toward its radial
  rootLean: 0.7,          // the root's tangent: up the brainstem, blended this far toward its children's centre
  bow: 0.06,              // deterministic sideways bow of each tract, × chord (siblings must not look machine-made)
  samples: 18,            // points per tract (brainMesh threads a Catmull-Rom through them)
  insideMargin: 0.06,     // tracts stay this far (plus their radius) under the smooth cortex cap …
  leafTail: 0.25,         // … except a leaf's last quarter, which crosses the cortex to its tip
  veinRadiusBase: 0.035,
  veinRadiusScale: 0.16,  // vein radius = base + scale · sqrt(value)
};

/** Vein radius for a branch value (shared with brainMesh.js). */
export const veinRadius = (value) => BRAIN.veinRadiusBase + BRAIN.veinRadiusScale * Math.sqrt(Math.max(0, Math.min(1, value)));

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HILBERT_N = 1024;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

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
  // relax inner nodes toward the line from their parent to their heaviest child (keeping their depth), so a path's
  // nodes don't zigzag as the leaf set narrows level by level: the confident path runs as one smooth sweep
  const subtreeWeight = new Map();
  for (const [id, ls] of leafIds) subtreeWeight.set(id, ls.reduce((a, l) => a + cfg.leafWeightFloor + Math.max(0, byId.get(l).value ?? 0), 0));
  const parentOf = new Map();
  for (const n of tree.nodes) for (const c of n.children ?? []) parentOf.set(c, n.id);
  const inner = tree.nodes.filter((n) => !n.isLeaf && n.id !== root.id).sort((a, b) => a.depth - b.depth);
  for (let sweep = 0; sweep < cfg.relaxSweeps; sweep++) {
    for (const n of inner) {
      const o = out.get(n.id);
      const heavy = n.children.reduce((a, c) => (subtreeWeight.get(c) > subtreeWeight.get(a) ? c : a));
      const mid = scale(add(out.get(parentOf.get(n.id)).pos, out.get(heavy).pos), 0.5);
      o.dir = norm(sub(add(o.pos, scale(sub(mid, o.pos), cfg.relax)), C));
      o.pos = add(C, scale(o.dir, o.radius));
    }
  }

  // edges, with cumulative distance from the trunk top for travelling light
  const edges = [];
  const startDist = new Map();
  const rootPos = out.get(root.id).pos;
  // per-node tangents (direction of travel away from the stem): from the parent toward the weighted centre of the
  // children, so paths bend through nodes rather than at them
  const weight = (id) => cfg.leafWeightFloor + Math.max(0, byId.get(id).value ?? 0);
  const towardChildren = (n, from) => {
    let c = [0, 0, 0], wsum = 0;
    for (const cid of n.children) { const w = weight(cid); c = add(c, scale(out.get(cid).pos, w)); wsum += w; }
    return norm(sub(scale(c, 1 / wsum), from));
  };
  const axisUp = norm(sub(STEM_AXIS[0], STEM_AXIS[1]));
  const tangent = new Map([[root.id, norm(add(scale(axisUp, 1 - cfg.rootLean), scale(towardChildren(root, rootPos), cfg.rootLean)))]]);

  // the stem climbs the brainstem: trunk top, up the centreline, then bends from the lowest axis point above the
  // trunk top into the core along the root's tangent (a long, gentle bend), so the tracts carry on out of it
  const axis = STEM_AXIS.slice(1, -1).reverse().filter((p) => p[1] > cfg.trunkTop[1] + 0.3);
  const bendFrom = axis[0] ?? cfg.trunkTop;
  const stemPts = [cfg.trunkTop,
    ...tract(bendFrom, norm(sub(bendFrom, cfg.trunkTop)), rootPos, tangent.get(root.id), { id: 'stem', value: root.value ?? 1 }, { ...cfg, bow: 0, samples: 16 }, false)];
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
      tangent.set(c.id, c.isLeaf ? Q.normal
        : norm(add(scale(towardChildren(c, P.pos), 1 - cfg.outwardBend), scale(Q.dir, cfg.outwardBend))));
      const points = tract(P.pos, tangent.get(n.id), Q.pos, tangent.get(c.id), c, cfg);
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
 * One fibre tract from P (leaving along tangent tP) to Q (arriving along tQ): a cubic Bézier plus a sideways bow,
 * sampled to cfg.samples points and kept under the cortex (but for a leaf's last stretch).
 */
function tract(P, tP, Q, tQ, node, cfg, keepInside = true) {
  const L = len(sub(Q, P));
  const h = cfg.handle * L;
  const chord = norm(sub(Q, P));
  let side = cross(chord, tP);
  if (len(side) < 1e-3) side = cross(chord, [0, 1, 0]);
  side = norm(side);
  const bow = scale(side, (hash01(node.id) - 0.5) * 2 * cfg.bow * L);
  const c1 = add(P, scale(tP, h));
  const c2 = sub(Q, scale(tQ, h));
  const r = veinRadius(node.value ?? 0);
  const pts = [];
  for (let i = 0; i < cfg.samples; i++) {
    const t = i / (cfg.samples - 1);
    const u = 1 - t;
    let p = add(add(scale(P, u * u * u), scale(c1, 3 * u * u * t)), add(scale(c2, 3 * u * t * t), scale(Q, t * t * t)));
    p = add(p, scale(bow, Math.sin(Math.PI * t) ** 2));   // a bump with zero slope at both ends: no kink at the nodes
    if (keepInside && i > 0 && i < cfg.samples - 1 && !(node.isLeaf && t > 1 - cfg.leafTail)) {
      // pulled back under the cortex cap (the cap has no fissure: a tract may cross the midline between hemispheres)
      for (let k = 0; k < 4; k++) {
        const over = capSdf(p[0], p[1], p[2]) + r + cfg.insideMargin;
        if (over <= 0) break;
        p = sub(p, scale(gradient(capSdf, p), over));
      }
    }
    pts.push(p);
  }
  return pts;
}
