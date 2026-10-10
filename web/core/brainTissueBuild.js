// Tissue geometry for the Brain (decoration, identical for every image), as plain typed arrays. No Three.js, so it
// runs in a Web Worker (brainTissueWorker.js) and in node.
//
// Each part is a welded box grid, projected onto its SDF envelope (brainShape.js) along rays from the part's centre,
// then displaced along the envelope normal by the part's fold function. The folds are real geometry (no normal
// maps), so they hold up from every orbit angle. Groove depth is baked into vertex colours (cavity shading).
//   hemispheres  rounded gyri of even width from phasor noise (a labyrinth of stripes), steered to run front-to-back
//                over the frontal and temporal lobes and parallel to the central sulcus beside it, plus the Sylvian
//                fissure and central sulcus; different seeds per side, so the two halves are not mirror images
//   cerebellum   fine transverse folia that fan toward the brainstem (out of sight), a deeper fissure every few
//   brainstem    a tube swept down its centreline and pushed out to the brainstem SDF (pons bulge included)
//   callosum     the deep midline filler that closes the bottom of the longitudinal fissure
import {
  ANATOMY, hemisphereSdf, cerebellumSdf, brainstemSdf, callosumSdf, rayHit, traceHit, fromBrain, STEM_AXIS,
} from './brainShape.js';

export const FOLDS = {
  spacing: { hemi: 0.042, cerebellum: 0.03, callosum: 0.12 },
  gyri: { wavelength: 0.92, cell: 1.9, perCell: 9, depth: 0.4, crown: 2.1, depthVar: 0.2, steerWeight: 0.85, mergeBelow: 0.15 },
  sylvian: { from: [3.1, -1.0], to: [-1.6, -0.05], width: 0.36, depth: 0.5 },
  central: { from: [-0.5, 3.2], to: [1.05, -0.35], width: 0.42, depth: 0.34, wobble: 0.35 },
  folia: { angle: 0.042, depth: 0.08, fissureEvery: 6, fissureDepth: 0.15, nucleus: [4.2, 0.9], warp: 0.014, smile: 0.022 },
  cavityFloor: 0.3,               // colour multiplier at the bottom of the deepest groove
  cavityDepth: 0.55,
  cerebellumTint: [1.0, 0.78, 0.82],
  stemTint: [0.96, 0.84, 0.9],
  callosumTint: [0.16, 0.12, 0.16],   // seen only down the fissure: keep it in shadow
  stem: { rings: 90, sides: 40 },
};

// ---------------------------------------------------------------------------------------------------- noise
/** Improved Perlin noise (Perlin 2002) over a seeded permutation, so the folds never change between runs. */
export function makeNoise(seed) {
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const grad = (h, x, y, z) => {
    const g = h & 15;
    const u = g < 8 ? x : y;
    const v = g < 4 ? y : g === 12 || g === 14 ? x : z;
    return ((g & 1) ? -u : u) + ((g & 2) ? -v : v);
  };
  const lerp = (a, b, t) => a + t * (b - a);
  return function noise(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    x -= X; y -= Y; z -= Z;
    const xi = X & 255, yi = Y & 255, zi = Z & 255;
    const u = fade(x), v = fade(y), w = fade(z);
    const A = perm[xi] + yi, AA = perm[A] + zi, AB = perm[A + 1] + zi;
    const B = perm[xi + 1] + yi, BA = perm[B] + zi, BB = perm[B + 1] + zi;
    return lerp(
      lerp(lerp(grad(perm[AA], x, y, z), grad(perm[BA], x - 1, y, z), u),
        lerp(grad(perm[AB], x, y - 1, z), grad(perm[BB], x - 1, y - 1, z), u), v),
      lerp(lerp(grad(perm[AA + 1], x, y, z - 1), grad(perm[BA + 1], x - 1, y, z - 1), u),
        lerp(grad(perm[AB + 1], x, y - 1, z - 1), grad(perm[BB + 1], x - 1, y - 1, z - 1), u), v),
      w);
  };
}

/** Small seeded hash → [0, 1) stream, for per-cell kernel placement. */
function hashRand(seed, i, j, k) {
  let s = (Math.imul(seed, 0x9e3779b1) ^ Math.imul(i, 0x85ebca6b) ^ Math.imul(j, 0xc2b2ae35) ^ Math.imul(k, 0x27d4eb2f)) >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Phasor noise (Tricard et al. 2019): a sum of Gabor kernels of which only the phase is kept, so the stripes have
 * the same width and contrast everywhere and wind into a labyrinth where neighbouring kernels disagree, the way
 * gyri do. A kernel's wave direction loses (part of) its component along `steer(c)`, the preferred gyrus direction
 * there, so its stripes run along it; at each sample the direction is projected onto the surface tangent (a
 * direction pointing out of the surface would smear into a plateau), and kernels that point mostly out of the
 * surface count for less. Every step is smooth in the sample position, so the folds have no creases.
 * Returns phase(x, y, z, nx, ny, nz) in radians; `phasor.confidence` is then |Σ| / Σ|kernel| for that sample (near 0
 * at the pattern's singularities, where the phase is ill-defined).
 */
export function makePhasor(seed, { wavelength, cell, perCell, steer = null }) {
  const freq = (2 * Math.PI) / wavelength;
  const b = 1.21 / cell;                         // the Gaussian falls to 1% one cell from its centre
  const a = Math.PI * b * b;
  const R2 = cell * cell;
  const cache = new Map();
  const kernelsAt = (i, j, k) => {
    const key = ((i + 512) * 1024 + (j + 512)) * 1024 + (k + 512);
    let ks = cache.get(key);
    if (ks) return ks;
    const r = hashRand(seed, i, j, k);
    ks = [];
    for (let n = 0; n < perCell; n++) {
      const cx = (i + r()) * cell, cy = (j + r()) * cell, cz = (k + r()) * cell;
      const u = r() * 2 - 1, phi = r() * 2 * Math.PI, q = Math.sqrt(1 - u * u);
      let dx = q * Math.cos(phi), dy = q * Math.sin(phi), dz = u;
      const st = steer ? steer(cx, cy, cz) : null;   // [gx, gy, gz, weight]: the gyri there run along g
      if (st) {
        const along = (dx * st[0] + dy * st[1] + dz * st[2]) * st[3];
        dx -= along * st[0]; dy -= along * st[1]; dz -= along * st[2];
        const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        dx /= l; dy /= l; dz /= l;
      }
      ks.push({ cx, cy, cz, dx, dy, dz, off: r() * 2 * Math.PI });
    }
    cache.set(key, ks);
    return ks;
  };
  // the kernels of the 27 cells around the last sample's cell, flattened (consecutive samples share a cell)
  let near = new Float64Array(0), nearCount = 0, lastKey = NaN;
  const gather = (ci, cj, ck) => {
    const all = [];
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (let k = ck - 1; k <= ck + 1; k++) all.push(...kernelsAt(i, j, k));
    if (near.length < all.length * 7) near = new Float64Array(all.length * 7);
    all.forEach((K, n) => near.set([K.cx, K.cy, K.cz, K.dx, K.dy, K.dz, K.off], n * 7));
    nearCount = all.length;
  };
  const phasor = (x, y, z, nx, ny, nz) => {
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    const key = ((ci + 512) * 1024 + (cj + 512)) * 1024 + (ck + 512);
    if (key !== lastKey) { gather(ci, cj, ck); lastKey = key; }
    let re = 0, im = 0, sum = 0;
    for (let n = 0, o = 0; n < nearCount; n++, o += 7) {
      const px = x - near[o], py = y - near[o + 1], pz = z - near[o + 2];
      const r2 = px * px + py * py + pz * pz;
      if (r2 > R2) continue;
      // the kernel's direction, in the tangent plane
      const kx = near[o + 3], ky = near[o + 4], kz = near[o + 5];
      const dn = kx * nx + ky * ny + kz * nz;
      const tx = kx - dn * nx, ty = ky - dn * ny, tz = kz - dn * nz;
      const tl2 = tx * tx + ty * ty + tz * tz;
      if (tl2 < 1e-6) continue;
      const g = Math.exp(-a * r2) * tl2;      // weight: how much of the kernel lies in the surface
      const ph = freq * (tx * px + ty * py + tz * pz) / Math.sqrt(tl2) + near[o + 6];
      re += g * Math.cos(ph); im += g * Math.sin(ph); sum += g;
    }
    phasor.confidence = sum > 0 ? Math.sqrt(re * re + im * im) / sum : 0;
    return Math.atan2(im, re);
  };
  phasor.confidence = 0;
  return phasor;
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth01 = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
/** Groove profile: 0 on a groove's centre line, rising steeply (a narrow sulcus) to a rounded crown at 1. */
const crown = (d, width) => { const k = 1 - clamp01(d / width); return 1 - k * k * k; };
/** Gyrus profile: rounded all the way across (sausage-like), with a sharp V where neighbours meet. */
const gyrus = (d, width) => { const k = 1 - clamp01(d / width); return 1 - k * k; };

function segDist(px, py, a, b) {
  const ax = b[0] - a[0], ay = b[1] - a[1];
  const t = clamp01(((px - a[0]) * ax + (py - a[1]) * ay) / (ax * ax + ay * ay));
  const qx = px - a[0] - ax * t, qy = py - a[1] - ay * t;
  return Math.sqrt(qx * qx + qy * qy);
}

// ---------------------------------------------------------------------------------------------------- folds
/**
 * Cortex folds of one hemisphere. Takes brain coordinates (ap, y, lat) and the outward envelope normal in the same
 * frame; returns a displacement ≤ 0 along that normal (gyrus crowns sit on the envelope, so tips never sink).
 */
export function hemisphereFolds(side) {
  const G = FOLDS.gyri;
  const S = FOLDS.sylvian;
  const C = FOLDS.central;
  const n2 = makeNoise(side > 0 ? 3301 : 4409);
  const cdx = C.to[0] - C.from[0], cdy = C.to[1] - C.from[1];
  const cdl = Math.hypot(cdx, cdy);
  // preferred gyrus directions (brain frame): front-to-back over the frontal and temporal lobes, parallel to the
  // central sulcus beside it (the pre- and postcentral gyri); free elsewhere (parietal and occipital labyrinth)
  const steer = (ap, y, lat) => {
    const nearCentral = Math.exp(-((segDist(ap, y, C.from, C.to) / 1.15) ** 2));
    if (nearCentral > 0.3) return [cdx / cdl, cdy / cdl, 0, G.steerWeight * nearCentral];
    const frontal = smooth01((ap - 1.6) / 1.2);
    const temporal = smooth01((-0.7 - y) / 0.6) * smooth01((lat - 1.2) / 0.8) * smooth01((ap + 1.5) / 1.5);
    const w = Math.max(frontal, temporal);
    return w > 0.05 ? [1, 0, 0, G.steerWeight * w] : null;
  };
  const phasor = makePhasor(side > 0 ? 7919 : 6007, { ...G, steer });
  return (ap, y, lat, nap, ny, nlat) => {
    const ph = phasor(ap, y, lat, nap, ny, nlat);
    // rounded, sausage-like crowns (x = 0 on a crown's centre line, 1 at the bottom of a sulcus)
    const x = Math.abs(ph) / Math.PI;
    // where the stripes break up (a singularity) the neighbouring gyri merge rather than leave a pit
    const depth = smooth01(phasor.confidence / G.mergeBelow) * G.depth * (1 - G.depthVar + G.depthVar * 2 * (0.5 + 0.5 * n2(ap * 0.45 + 2.1, y * 0.45, lat * 0.45)));
    let disp = -depth * Math.pow(x, G.crown);
    // lateral (Sylvian) fissure above the temporal lobe, on the outer face only
    const lw = clamp01((lat - 1.1) / 1.2);
    if (lw > 0) disp = Math.min(disp, lw * S.depth * (crown(segDist(ap, y, S.from, S.to), S.width) - 1));
    // central sulcus: from the top of the midline down the side toward the Sylvian fissure
    const wob = C.wobble * n2(y * 1.4 + 3.3, lat * 0.9, 7.7);
    disp = Math.min(disp, C.depth * (gyrus(segDist(ap + wob, y, C.from, C.to), C.width) - 1));
    return Math.min(0, disp);
  };
}

/**
 * Cerebellar folia, in brain coordinates (ap, y, z): ridges at constant angle about a lateral axis through a point
 * near the brainstem, so they stack as horizontal lines across the back and fan out along the sides.
 */
export function cerebellumFolds() {
  const F = FOLDS.folia;
  const C = ANATOMY.cerebellum;
  const n = makeNoise(5501);
  return (ap, y, z) => {
    const a = ap - C.ap, b = y - C.y;
    const ang = Math.atan2(b - F.nucleus[1], a - F.nucleus[0]) + F.warp * n(ap * 1.6, y * 1.6, z * 1.6) + F.smile * z * z;
    const f = (ang + Math.PI) / F.angle;
    const v = Math.abs(f - Math.floor(f) - 0.5) * 2;                  // 0 in a groove, 1 on a ridge crest
    const deep = Math.floor(f) % F.fissureEvery === 0 ? F.fissureDepth : F.depth;
    let disp = deep * (crown(v, 0.7) - 1);
    disp -= 0.12 * Math.exp(-(z * z) / 0.05) * clamp01(-a / 0.6 + 0.5);  // the vermis: a shallow midline notch
    return disp;
  };
}

// ---------------------------------------------------------------------------------------------------- meshing
/**
 * Unit directions of a welded grid over the surface of a box with half-extents `ext`, and its triangles (wound
 * outward). Adjacent faces share their edge vertices, so the projected mesh is closed with no seams.
 */
function boxGrid(ext, spacing) {
  const n = ext.map((e) => Math.max(4, Math.round((2 * e) / spacing)));
  const key = (i, j, k) => (i * (n[1] + 1) + j) * (n[2] + 1) + k;
  const map = new Map();
  const dirs = [];
  const tris = [];
  const vert = (c) => {
    const id = key(c[0], c[1], c[2]);
    let v = map.get(id);
    if (v === undefined) {
      v = dirs.length / 3;
      map.set(id, v);
      const x = (c[0] / n[0] * 2 - 1) * ext[0], y = (c[1] / n[1] * 2 - 1) * ext[1], z = (c[2] / n[2] * 2 - 1) * ext[2];
      const l = Math.sqrt(x * x + y * y + z * z);
      dirs.push(x / l, y / l, z / l);
    }
    return v;
  };
  for (let w = 0; w < 3; w++) {
    const u = (w + 1) % 3, v = (w + 2) % 3;          // (u, v, w) is a right-handed cycle, so u × v = +w
    for (const side of [0, n[w]]) {
      const flip = side === 0;                        // the −w face winds the other way
      const c = [0, 0, 0];
      c[w] = side;
      for (let a = 0; a < n[u]; a++) {
        for (let b = 0; b < n[v]; b++) {
          c[u] = a; c[v] = b; const p00 = vert(c);
          c[u] = a + 1; const p10 = vert(c);
          c[v] = b + 1; const p11 = vert(c);
          c[u] = a; const p01 = vert(c);
          if (flip) tris.push(p00, p11, p10, p00, p01, p11);
          else tris.push(p00, p10, p11, p00, p11, p01);
        }
      }
    }
  }
  return { dirs, tris };
}

function cavityShade(disp, tint, out, i) {
  // the deeper the groove, the darker: ambient light can't reach the bottom of a sulcus
  const k = FOLDS.cavityFloor + (1 - FOLDS.cavityFloor) * Math.pow(clamp01(1 + disp / FOLDS.cavityDepth), 1.6);
  out[i * 3] = k * tint[0]; out[i * 3 + 1] = k * tint[1]; out[i * 3 + 2] = k * tint[2];
}

/** One box-grid part, projected onto `sdf` from `center` and displaced by `fold(x, y, z)` (world). */
function buildPart({ sdf, center, extents, spacing, fold = null, shade = null, tint = [1, 1, 1], maxT }) {
  const { dirs, tris } = boxGrid(extents, spacing);
  const count = dirs.length / 3;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const d = [0, 0, 0];
  const h = 0.02;
  for (let i = 0; i < count; i++) {
    d[0] = dirs[i * 3]; d[1] = dirs[i * 3 + 1]; d[2] = dirs[i * 3 + 2];
    const t = traceHit(sdf, center, d, maxT) ?? 0;
    let x = center[0] + d[0] * t, y = center[1] + d[1] * t, z = center[2] + d[2] * t;
    let disp = 0;
    if (fold) {
      let gx = sdf(x + h, y, z) - sdf(x - h, y, z);
      let gy = sdf(x, y + h, z) - sdf(x, y - h, z);
      let gz = sdf(x, y, z + h) - sdf(x, y, z - h);
      const gl = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
      gx /= gl; gy /= gl; gz /= gl;
      disp = fold(x, y, z, gx, gy, gz);
      x += gx * disp; y += gy * disp; z += gz * disp;
    }
    position[i * 3] = x; position[i * 3 + 1] = y; position[i * 3 + 2] = z;
    cavityShade(disp, tint, color, i);
    if (shade) { const k = shade(x, y, z); color[i * 3] *= k; color[i * 3 + 1] *= k; color[i * 3 + 2] *= k; }
  }
  return { position, color, index: Uint32Array.from(tris) };
}

/** Uniform Catmull-Rom (centripetal is unnecessary here: the axis points are evenly spread). */
function catmull(pts, t) {
  const n = pts.length - 1;
  const f = Math.min(n - 1e-9, Math.max(0, t * n));
  const i = Math.floor(f), u = f - i;
  const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n, i + 2)];
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * u + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * u * u
      + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * u * u * u);
  }
  return out;
}

/** The brainstem: rings down its centreline (which lies in the midline plane), pushed out to the SDF. */
function buildStem() {
  const { rings, sides } = FOLDS.stem;
  const top = STEM_AXIS[0];
  const pts = [[top[0] + 0.1, top[1] + 0.6, top[2]], ...STEM_AXIS];
  const count = (rings + 1) * sides;
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const tint = FOLDS.stemTint;
  const d = [0, 0, 0];
  for (let r = 0; r <= rings; r++) {
    const c = catmull(pts, r / rings);
    const c2 = catmull(pts, Math.min(1, r / rings + 0.002));
    const c1 = catmull(pts, Math.max(0, r / rings - 0.002));
    let tx = c2[0] - c1[0], ty = c2[1] - c1[1];
    const tl = Math.sqrt(tx * tx + ty * ty) || 1; tx /= tl; ty /= tl;
    const nx = ty, ny = -tx;                                // in-plane normal; the binormal is ±z
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      d[0] = Math.cos(a) * nx; d[1] = Math.cos(a) * ny; d[2] = Math.sin(a);
      const t = rayHit(brainstemSdf, c, d, 1.6, 0.05, 14) ?? 0.4;
      // faint longitudinal grooves down the front (the anterior median fissure)
      const front = clamp01(-d[0]);                         // anterior is −x
      const groove = 0.035 * Math.exp(-(d[2] * d[2]) / 0.01) * front;
      const i = r * sides + s;
      position[i * 3] = c[0] + d[0] * (t - groove);
      position[i * 3 + 1] = c[1] + d[1] * (t - groove);
      position[i * 3 + 2] = c[2] + d[2] * (t - groove);
      const k = 0.8 - groove * 6;
      color[i * 3] = k * tint[0]; color[i * 3 + 1] = k * tint[1]; color[i * 3 + 2] = k * tint[2];
    }
  }
  const index = [];
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sides; s++) {
      const a = r * sides + s, b = r * sides + ((s + 1) % sides);
      const c = a + sides, e = b + sides;
      index.push(a, c, b, b, c, e);
    }
  }
  // (a, c, b): down the axis × around it = the ring's outward normal
  return { position, color, index: Uint32Array.from(index) };
}

/** Area-weighted vertex normals (every part is wound outward). */
function normalsFor(part) {
  const { position: P, index: I } = part;
  const N = new Float32Array(P.length);
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    N[a] += nx; N[a + 1] += ny; N[a + 2] += nz;
    N[b] += nx; N[b + 1] += ny; N[b + 2] += nz;
    N[c] += nx; N[c + 1] += ny; N[c + 2] += nz;
  }
  for (let i = 0; i < N.length; i += 3) {
    const l = Math.sqrt(N[i] * N[i] + N[i + 1] * N[i + 1] + N[i + 2] * N[i + 2]) || 1;
    N[i] /= l; N[i + 1] /= l; N[i + 2] /= l;
  }
  return N;
}

/** All parts' geometry as one set of arrays: {position, normal, color, index, vertices, ms}. */
export function buildTissueArrays() {
  const t0 = (globalThis.performance ?? Date).now();
  const H = ANATOMY.hemi;
  const O = ANATOMY.origin;
  const parts = [];
  for (const side of [1, -1]) {
    const folds = hemisphereFolds(side);
    parts.push(buildPart({
      sdf: (x, y, z) => hemisphereSdf(side, x, y, z),
      center: fromBrain(0.3, -0.1, side * H.center),
      extents: [H.rAp, 2.6, H.rLat / 2],
      spacing: FOLDS.spacing.hemi,
      fold: (x, y, z, nx, ny, nz) => folds(O[0] - x, y - O[1], side * (z - O[2]), -nx, ny, side * nz),
      // the medial wall darkens toward the midline, so the longitudinal fissure reads as a deep cleft
      shade: (x, y, z) => 0.18 + 0.82 * smooth01((side * (z - O[2]) - H.medial) / 0.8),
      maxT: 6.5,
    }));
  }
  const C = ANATOMY.cerebellum;
  const cf = cerebellumFolds();
  parts.push(buildPart({
    sdf: cerebellumSdf,
    center: fromBrain(C.ap, C.y),
    extents: [C.rAp, C.rY, C.lat + C.rLat],
    spacing: FOLDS.spacing.cerebellum,
    fold: (x, y, z) => cf(O[0] - x, y - O[1], z - O[2]),
    tint: FOLDS.cerebellumTint,
    maxT: 3.6,
  }));
  const K = ANATOMY.callosum;
  parts.push(buildPart({
    sdf: callosumSdf, center: fromBrain(K.ap, K.y), extents: [K.rAp, K.rY, K.rLat],
    spacing: FOLDS.spacing.callosum, tint: FOLDS.callosumTint, maxT: 4,
  }));
  parts.push(buildStem());

  let verts = 0, idx = 0;
  for (const p of parts) { verts += p.position.length / 3; idx += p.index.length; }
  const position = new Float32Array(verts * 3);
  const normal = new Float32Array(verts * 3);
  const color = new Float32Array(verts * 3);
  const index = new Uint32Array(idx);
  let vo = 0, io = 0;
  for (const p of parts) {
    position.set(p.position, vo * 3);
    normal.set(normalsFor(p), vo * 3);
    color.set(p.color, vo * 3);
    for (let i = 0; i < p.index.length; i++) index[io + i] = p.index[i] + vo;
    vo += p.position.length / 3;
    io += p.index.length;
  }
  return { position, normal, color, index, vertices: verts, ms: (globalThis.performance ?? Date).now() - t0 };
}
