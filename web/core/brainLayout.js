// Brain layout (master plan 6.4): places the WordNet tree from tree.json on a rounded mass above the trunk.
// Pure maths, no Three.js, so node can unit-test it (brainLayout.test.mjs).
//
//  1. Leaf directions: a Fibonacci point set on the upper hemisphere, minus a wedge facing the image panel.
//  2. Sunburst-style allocation: points are ordered along a Hilbert curve and leaves depth-first, so every
//     subtree gets a contiguous, compact patch whose area is proportional to its leaf count. Siblings are
//     ordered by the smallest ImageNet class id beneath them (ImageNet ids follow WordNet groupings), not by
//     score: the Brain keeps a stable semantic geography, so a different answer (e.g. the adversarial image's)
//     lands in a different region instead of always taking the first slot.
//  3. Depth maps to radius: the root at the core, shallow categories near it, leaves near the surface.
//     An internal node points at the mean direction of its leaves.
//  4. Edges are Catmull-Rom control points, bowed slightly outward so they read as veins, not spokes.

export const BRAIN = {
  center: [0, 8.5, 0],
  radius: 4.5,
  leafRadius: 0.96,       // × radius
  innerRadius: 0.9,       // internal nodes: × radius × depth / maxDepth
  gapHalfDeg: 40,         // half-width of the empty wedge facing the image panel
  panelPosition: [-7, 5.5, 0.5],
  trunkTop: [0, 6, 0],
  bow: 0.18,              // outward bow of each edge, × edge length
};

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HILBERT_N = 1024;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => add(a, scale(sub(b, a), t));

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

export function gapAzimuth(cfg = BRAIN) {
  return azimuthOf(cfg.panelPosition[0] - cfg.center[0], cfg.panelPosition[2] - cfg.center[2]);
}

/** Exactly n unit directions on the upper hemisphere outside the panel wedge, in Hilbert order. */
export function capDirections(n, cfg = BRAIN) {
  if (n <= 0) return [];
  const gap = gapAzimuth(cfg);
  const half = (cfg.gapHalfDeg * Math.PI) / 180;
  const allowed = 2 * Math.PI - 2 * half;
  const start = gap + half; // allowed azimuths run from here, counter-clockwise, for `allowed` radians
  const inCap = (phi) => Math.abs(angleDiff(phi, gap)) > half;

  // grow the spiral until exactly n points fall outside the wedge (count rises by 0 or 1 per extra point)
  let m = Math.max(n, Math.floor(n / (allowed / (2 * Math.PI))) - 2);
  let pts;
  for (;; m++) {
    pts = [];
    for (let i = 0; i < m; i++) {
      const y = 1 - (i + 0.5) / m;           // cos(polar): uniform area on the hemisphere
      const phi = (i * GOLDEN_ANGLE) % (2 * Math.PI);
      if (!inCap(phi)) continue;
      const r = Math.sqrt(1 - y * y);
      pts.push({ dir: [r * Math.cos(phi), y, r * Math.sin(phi)], phi, y });
    }
    if (pts.length >= n) break;
  }
  pts = pts.slice(0, n);
  for (const p of pts) {
    const u = (((p.phi - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) / allowed; // 0..1 across the cap
    const v = 1 - p.y;                                                                       // 0 at the top
    p.h = hilbert(HILBERT_N, Math.min(HILBERT_N - 1, Math.floor(u * HILBERT_N)), Math.min(HILBERT_N - 1, Math.floor(v * HILBERT_N)));
  }
  pts.sort((a, b) => a.h - b.h);
  return pts.map((p) => p.dir);
}

/** Small deterministic hash of a string → 0..1, for per-edge variation that never changes between runs. */
function hash01(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Lay out tree.json nodes. Returns
 *   nodes: Map id → {id, pos, dir, radius, depth, isLeaf, node}
 *   edges: [{id, from, to, points:[4 × [x,y,z]], length, startDist, depth, value, onTop1Path, isOther, isStem}]
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
  const dirs = capDirections(leaves.length, cfg);
  const R = cfg.radius;
  const C = cfg.center;

  const out = new Map();
  leaves.forEach((leaf, i) => {
    const dir = dirs[i];
    out.set(leaf.id, { id: leaf.id, dir, radius: R * cfg.leafRadius, depth: leaf.depth, isLeaf: true, node: leaf });
  });
  // internal nodes: mean direction of their leaves, radius by depth (post-order so children exist first)
  const leafDirs = new Map();
  const collect = (n) => {
    if (n.isLeaf) { leafDirs.set(n.id, [out.get(n.id).dir]); return leafDirs.get(n.id); }
    const all = [];
    for (const c of n.children) all.push(...collect(byId.get(c)));
    leafDirs.set(n.id, all);
    return all;
  };
  collect(root);
  for (const n of tree.nodes) {
    if (n.isLeaf) continue;
    const sum = leafDirs.get(n.id).reduce((a, d) => add(a, d), [0, 0, 0]);
    out.set(n.id, {
      id: n.id, dir: norm(sum), radius: n.id === root.id ? 0 : R * cfg.innerRadius * (n.depth / maxDepth),
      depth: n.depth, isLeaf: false, node: n,
    });
  }
  for (const v of out.values()) v.pos = add(C, scale(v.dir, v.radius));

  // edges, with cumulative distance from the trunk top for travelling light
  const edges = [];
  const startDist = new Map();
  const stemLen = len(sub(out.get(root.id).pos, cfg.trunkTop));
  edges.push({
    id: 'stem', from: null, to: root.id, isStem: true,
    points: [cfg.trunkTop, lerp(cfg.trunkTop, out.get(root.id).pos, 1 / 3), lerp(cfg.trunkTop, out.get(root.id).pos, 2 / 3), out.get(root.id).pos],
    length: stemLen, startDist: 0, depth: 0, value: root.value ?? 1, onTop1Path: true, isOther: false,
  });
  startDist.set(root.id, stemLen);
  const walk = (n) => {
    for (const cid of n.children) {
      const c = byId.get(cid);
      const P = out.get(n.id).pos;
      const Q = out.get(c.id).pos;
      const L = len(sub(Q, P));
      const mid = lerp(P, Q, 0.5);
      const outward = norm(sub(mid, C));
      // a little sideways twist per edge (deterministic) so siblings don't look machine-straight
      const side = norm([outward[2], 0, -outward[0]]);
      const twist = (hash01(c.id) - 0.5) * 0.5;
      const bow = add(scale(outward, cfg.bow * L), scale(side, twist * cfg.bow * L));
      const points = [P, add(lerp(P, Q, 1 / 3), scale(bow, 0.9)), add(lerp(P, Q, 2 / 3), scale(bow, 0.6)), Q];
      const arc = len(sub(points[1], points[0])) + len(sub(points[2], points[1])) + len(sub(points[3], points[2]));
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
