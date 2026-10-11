// Decorative nerves (identical for every image, never data): gold fibres that branch off the spinal cord and fan
// down and outward, as on Ray's reference, plus a few strands running along the cord. They carry no score, take no
// inferno colour, never respond to Steer and are never pickable; the model's paths are the tracts in brainMesh.js.
// fiberPaths() is pure maths (node tests it); createFibers() merges every fibre into one mesh and one material.
import * as THREE from 'three';
import { ANATOMY, STEM_AXIS, brainstemSdf } from './brainShape.js';

export const FIBERS = {
  seed: 9173,
  roots: 14,
  rootY: [3.5, 6.2],        // world heights where nerves leave the cord (below the cerebellum)
  length: [1.6, 3.0],       // a root nerve's length; branches are shorter
  branchScale: 0.6,
  branchDepth: 2,           // root → branch → twig
  drop: [0.45, 1.0],        // how steeply a root nerve heads down (direction y = −drop before normalising)
  radius: [0.03, 0.012],    // root nerve, at its start and its end; branches start at the parent's radius there
  twig: 0.008,
  strands: 5,               // along the cord's surface
  strandY: [3.15, 6.4],
  stepLen: 0.16,
  color: 0xc7c7c7,
  roughness: 0.42,
  metalness: 0.25,
  endShade: 0.4,            // brightness at a fibre's far end (they fade into the dark)
  radialSegments: 6,
};

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Distance from the cord's centre at height y, along angle a, to `gap` outside its surface (the SDF, not the radius). */
function surfaceOut(c, y, a, gap) {
  let r = c.r * 0.8;
  while (r < c.r * 3 && brainstemSdf(c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r) < gap) r += 0.005;
  return r;
}

const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** The cord's centre (x, z) and radius at world height y (linear between the brainstem centreline's points). */
export function cordAt(y) {
  const S = ANATOMY.stem;
  for (let i = STEM_AXIS.length - 1; i > 0; i--) {
    const lo = STEM_AXIS[i], hi = STEM_AXIS[i - 1];
    if (y <= hi[1] || i === 1) {
      const t = Math.max(0, Math.min(1, (y - lo[1]) / (hi[1] - lo[1])));
      return { x: lo[0] + (hi[0] - lo[0]) * t, z: 0, r: S[i][2] + (S[i - 1][2] - S[i][2]) * t };
    }
  }
  return { x: STEM_AXIS[0][0], z: 0, r: S[0][2] };
}

/**
 * Every fibre as {points, r0, r1, shade0, shade1}: a polyline (world), its radius at the start and end, and its
 * brightness at the start and end. Deterministic.
 */
export function fiberPaths(cfg = FIBERS) {
  const rand = rng(cfg.seed);
  const out = [];
  const grow = (start, dir, length, r0, r1, shade0, depth) => {
    const pts = [start];
    let d = dir;
    let p = start;
    const steps = Math.max(4, Math.round(length / cfg.stepLen));
    for (let i = 0; i < steps; i++) {
      // wander a little, and sag: nerves hang down and out
      d = norm([d[0] + (rand() - 0.5) * 0.35, d[1] - 0.05 + (rand() - 0.5) * 0.2, d[2] + (rand() - 0.5) * 0.35]);
      p = [p[0] + d[0] * (length / steps), p[1] + d[1] * (length / steps), p[2] + d[2] * (length / steps)];
      pts.push(p);
    }
    const shade1 = Math.max(cfg.endShade, shade0 * cfg.endShade);
    out.push({ points: pts, r0, r1, shade0, shade1 });
    if (depth >= cfg.branchDepth) return;
    for (const at of [0.3 + rand() * 0.15, 0.6 + rand() * 0.15]) {
      const k = Math.round(at * steps);
      const from = pts[k];
      const prev = pts[Math.max(0, k - 1)];
      const along = norm([from[0] - prev[0], from[1] - prev[1], from[2] - prev[2]]);
      // turn off the parent: sideways in the horizontal plane, a little further down
      const s = rand() < 0.5 ? -1 : 1;
      const side = norm([-along[2] * s, 0, along[0] * s]);
      const bd = norm([along[0] + side[0] * 0.8, along[1] - 0.25, along[2] + side[2] * 0.8]);
      const r = r0 + (r1 - r0) * at;
      const sh = shade0 + (shade1 - shade0) * at;
      grow(from, bd, length * cfg.branchScale * (0.8 + rand() * 0.4), r * 0.75, cfg.twig, sh, depth + 1);
    }
  };
  for (let i = 0; i < cfg.roots; i++) {
    const y = cfg.rootY[0] + (cfg.rootY[1] - cfg.rootY[0]) * ((i + 0.2 + rand() * 0.6) / cfg.roots);
    const a = i * 2.39996 + rand() * 0.5;          // golden angle around the cord
    const c = cordAt(y);
    const out0 = [Math.cos(a), 0, Math.sin(a)];
    const r = surfaceOut(c, y, a, 0.03);
    const start = [c.x + out0[0] * r, y, c.z + out0[2] * r];
    const drop = cfg.drop[0] + rand() * (cfg.drop[1] - cfg.drop[0]);
    const length = cfg.length[0] + rand() * (cfg.length[1] - cfg.length[0]);
    grow(start, norm([out0[0], -drop, out0[2]]), length, cfg.radius[0], cfg.radius[1], 1, 0);
  }
  // strands along the cord, twisting slowly round it
  for (let k = 0; k < cfg.strands; k++) {
    const a0 = (k / cfg.strands) * Math.PI * 2 + rand() * 0.6;
    const pts = [];
    const n = Math.round((cfg.strandY[1] - cfg.strandY[0]) / cfg.stepLen);
    for (let i = 0; i <= n; i++) {
      const y = cfg.strandY[0] + ((cfg.strandY[1] - cfg.strandY[0]) * i) / n;
      const c = cordAt(y);
      const a = a0 + 0.5 * (i / n);
      const r = surfaceOut(c, y, a, 0.025);
      pts.push([c.x + Math.cos(a) * r, y, c.z + Math.sin(a) * r]);
    }
    out.push({ points: pts, r0: 0.014, r1: 0.014, shade0: cfg.endShade, shade1: 0.8 });
  }
  return out;
}

/** One merged, lit mesh of every fibre (decorative: not pickable, not data). */
export function connectedFiberPaths(cfg = FIBERS) {
  const paths = fiberPaths(cfg);
  // Every root begins at the cord. Extend that attachment through the stem to the model trunk entry.
  // Branches share their parent's attachment; the extension is visual anatomy, never invented model evidence.
  const roots = paths.filter(p => p.r0 === cfg.radius[0]);
  for (const [i, root] of roots.entries()) {
    const start = root.points[0], a = i * 2.39996;
    paths.push({ points: [start, [start[0]*.45, start[1]+.3, start[2]*.45],
      [Math.cos(a)*.1, 5.85, Math.sin(a)*.1], [0,6,0]],
      r0: cfg.radius[0], r1: .012, shade0: .8, shade1: 1 });
  }
  // Fine longitudinal tracks through the cord: all terminate exactly at the hierarchy entry.
  for (let i=0;i<24;i++) {
    const a=i*2.39996,r=.08+(i%4)*.025;
    paths.push({points:[[Math.cos(a)*r,3.15,Math.sin(a)*r],
      [Math.cos(a+.25)*r,4,Math.sin(a+.25)*r],[Math.cos(a+.5)*r,5.2,Math.sin(a+.5)*r],[0,6,0]],
      r0:.009,r1:.009,shade0:.55,shade1:.9});
  }
  return paths;
}
export function createFibers(cfg = FIBERS) {
  const parts = [];
  let verts = 0, idx = 0;
  for (const f of connectedFiberPaths(cfg)) {
    const curve = new THREE.CatmullRomCurve3(f.points.map((p) => new THREE.Vector3(...p)), false, 'centripetal');
    const segs = Math.max(8, Math.round(curve.getLength() * 10));
    const g = new THREE.TubeGeometry(curve, segs, 1, cfg.radialSegments, false);
    // taper: TubeGeometry places ring i around getPointAt(i / segs); scale each ring about that centre
    const pos = g.attributes.position;
    const ring = cfg.radialSegments + 1;
    const color = new Float32Array(pos.count * 3);
    const c = new THREE.Vector3();
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      curve.getPointAt(t, c);
      const r = f.r0 + (f.r1 - f.r0) * t;
      const shade = f.shade0 + (f.shade1 - f.shade0) * t;
      for (let j = 0; j < ring; j++) {
        const v = i * ring + j;
        pos.setXYZ(v, c.x + (pos.getX(v) - c.x) * r, c.y + (pos.getY(v) - c.y) * r, c.z + (pos.getZ(v) - c.z) * r);
        color[v * 3] = color[v * 3 + 1] = color[v * 3 + 2] = shade;
      }
    }
    parts.push({ g, color });
    verts += pos.count;
    idx += g.index.count;
  }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index = new Uint32Array(idx);
  let vo = 0, io = 0;
  for (const { g, color: c } of parts) {
    position.set(g.attributes.position.array, vo * 3);
    normal.set(g.attributes.normal.array, vo * 3);
    color.set(c, vo * 3);
    const I = g.index.array;
    for (let i = 0; i < I.length; i++) index[io + i] = I[i] + vo;
    vo += g.attributes.position.count;
    io += I.length;
    g.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: cfg.color, vertexColors: true, roughness: cfg.roughness, metalness: cfg.metalness,
  }));
  mesh.name = 'decorative-fibres';
  return { mesh, vertices: verts };
}
