// Brain anatomy (decoration, identical for every image): the smooth envelopes of the cerebral hemispheres,
// cerebellum, brainstem and the deep midline filler, as signed-distance functions in world units.
// Pure maths, no Three.js, so the layout and its node test share it with the renderer.
//
// Orientation: the frontal lobe faces the image panel (−x), up is +y, the left hemisphere faces the camera (+z).
// Inside this file "ap" is the anterior coordinate (ORIGIN.x − x), "y" is height above ORIGIN.y, and a
// hemisphere's "lat" is the signed distance from the midline toward its own side.
// The SDFs are approximate (ellipsoid bound, smooth unions): sign-correct with a usable gradient, which is all the
// mesher (ray bisection), the layout (surface points) and occlusion tests (sphere tracing with a safety factor) need.

export const ANATOMY = {
  origin: [-1.2, 9.95, 0],             // cerebrum centre (world)
  // the cerebrum is one ellipsoid (plus temporal lobes) split down the midline into two hemispheres
  hemi: { ap: 0, y: 0.15, rAp: 4.6, rUp: 3.0, rDown: 2.1, rLat: 3.95, medial: 0.2, medialRound: 0.95, center: 1.8 },
  temporal: { ap: 0.95, y: -1.45, lat: 2.45, rAp: 2.45, rY: 1.2, rLat: 1.4, blend: 0.5 },
  cerebellum: { ap: -2.75, y: -2.25, lat: 1.05, rAp: 1.35, rY: 0.9, rLat: 1.4, blend: 0.4 },
  // brainstem centreline, top (inside the cerebrum) to bottom: [ap, y, radius]. Below the medulla it carries on as a
  // tapering spinal cord, well clear of the cerebellum, sleeving the trunk (the forward pass climbs inside it)
  stem: [[-0.45, -0.9, 0.62], [-0.85, -2.3, 0.7], [-1.1, -3.4, 0.48], [-1.2, -4.4, 0.38], [-1.2, -5.6, 0.33], [-1.2, -6.95, 0.24]],
  stemFade: 0.6,                       // the cord's last stretch fades out (it leaves the frame rather than ending)
  pons: { ap: -0.6, y: -2.35, r: 0.6 },
  callosum: { ap: -0.1, y: -0.6, rAp: 2.9, rY: 1.0, rLat: 0.8 },
  core: [-0.3, -0.7],                  // ap, y of the hierarchy's root (thalamus, on the midline)
};

const O = ANATOMY.origin;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
export function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }
const smax = (a, b, k) => -smin(-a, -b, k);

/** Ellipsoid distance bound (Quílez): exact sign, good near the surface. */
function ellipsoid(x, y, z, rx, ry, rz) {
  const ax = x / rx, ay = y / ry, az = z / rz;
  const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
  const bx = ax / rx, by = ay / ry, bz = az / rz;
  const k1 = Math.sqrt(bx * bx + by * by + bz * bz);   // (Math.hypot is several times slower in V8)
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
}

/** The cerebrum before it is split (one smooth cap over both hemispheres), in brain coordinates; lat = |z|. */
function capLocal(ap, y, lat) {
  const H = ANATOMY.hemi;
  const T = ANATOMY.temporal;
  // narrower occipital and frontal poles
  const k = 1 - 0.16 * smoothstep(0.5, 4.6, -ap) - 0.08 * smoothstep(1.5, 4.6, ap);
  const dy = y - H.y;
  const d = ellipsoid(ap - H.ap, dy, lat, H.rAp, dy > 0 ? H.rUp : H.rDown, H.rLat * k);
  return smin(d, ellipsoid(ap - T.ap, y - T.y, Math.abs(lat) - T.lat, T.rAp, T.rY, T.rLat), T.blend);
}

/** One cerebral hemisphere (side +1 = left, world +z): the cap cut by a flat medial wall, rounded at the top edge. */
export function hemisphereSdf(side, x, y, z) {
  const H = ANATOMY.hemi;
  const lat = side * (z - O[2]);
  return smax(capLocal(O[0] - x, y - O[1], lat), H.medial - lat, H.medialRound);
}

/** Both hemispheres, with the longitudinal fissure between them. */
export function cerebrumSdf(x, y, z) { return Math.min(hemisphereSdf(1, x, y, z), hemisphereSdf(-1, x, y, z)); }

/**
 * The smooth cap over both hemispheres (no fissure): where tips and draped veins ride, so a vein crossing from one
 * hemisphere to the other bridges the fissure instead of diving into it.
 */
export function capSdf(x, y, z) { return capLocal(O[0] - x, y - O[1], Math.abs(z - O[2])); }

export function cerebellumSdf(x, y, z) {
  const C = ANATOMY.cerebellum;
  const ap = O[0] - x - C.ap;
  const yy = y - O[1] - C.y;
  const zz = z - O[2];
  const l = ellipsoid(ap, yy, zz - C.lat, C.rAp, C.rY, C.rLat);
  const r = ellipsoid(ap, yy, zz + C.lat, C.rAp, C.rY, C.rLat);
  return smin(l, r, C.blend);
}

function segment(px, py, pz, a, b) {
  // round cone approximation: distance to the segment minus the interpolated radius
  const ax = b[0] - a[0], ay = b[1] - a[1];
  const t = clamp01(((px - a[0]) * ax + (py - a[1]) * ay) / (ax * ax + ay * ay));
  const qx = px - a[0] - ax * t, qy = py - a[1] - ay * t;
  return Math.sqrt(qx * qx + qy * qy + pz * pz) - (a[2] + (b[2] - a[2]) * t);
}

export function brainstemSdf(x, y, z) {
  const ap = O[0] - x, yy = y - O[1], zz = z - O[2];
  const S = ANATOMY.stem;
  let d = Infinity;
  for (let i = 0; i < S.length - 1; i++) d = smin(d, segment(ap, yy, zz, S[i], S[i + 1]), 0.25);
  const P = ANATOMY.pons;
  const px = ap - P.ap, py = yy - P.y;
  return smin(d, Math.sqrt(px * px + py * py + zz * zz) - P.r, 0.35);
}

export function callosumSdf(x, y, z) {
  const C = ANATOMY.callosum;
  return ellipsoid(O[0] - x - C.ap, y - O[1] - C.y, z - O[2], C.rAp, C.rY, C.rLat);
}

/** All tissue (for occlusion). */
export function tissueSdf(x, y, z) {
  return Math.min(cerebrumSdf(x, y, z), cerebellumSdf(x, y, z), brainstemSdf(x, y, z), callosumSdf(x, y, z));
}

/** World position of a brain-coordinate point on the midline / given side. */
export function fromBrain(ap, y, z = 0) { return [O[0] - ap, O[1] + y, O[2] + z]; }

/** The hierarchy's root (world). */
export const CORE = fromBrain(ANATOMY.core[0], ANATOMY.core[1]);

/** The brainstem centreline (world), top to bottom. */
export const STEM_AXIS = ANATOMY.stem.map(([ap, y]) => fromBrain(ap, y));

/** World height of the bottom of the spinal cord, and of the cerebellum (below it, tissue is "stem" for framing). */
export const STEM_BOTTOM_Y = STEM_AXIS[STEM_AXIS.length - 1][1];
export const STEM_FRAME_Y = O[1] + ANATOMY.cerebellum.y - ANATOMY.cerebellum.rY;

/** Unit gradient of an SDF (world), by central differences. */
export function gradient(sdf, p, h = 0.01) {
  const [x, y, z] = p;
  const g = [sdf(x + h, y, z) - sdf(x - h, y, z), sdf(x, y + h, z) - sdf(x, y - h, z), sdf(x, y, z + h) - sdf(x, y, z - h)];
  const l = Math.hypot(g[0], g[1], g[2]) || 1;
  return [g[0] / l, g[1] / l, g[2] / l];
}

/**
 * The outermost crossing of `sdf` along the ray from `from` in unit direction `dir`, or null when the ray never
 * enters it within `maxT`. Marches inward from maxT so overhangs resolve to the outer skin, then bisects.
 */
export function rayHit(sdf, from, dir, maxT = 9, step = 0.08, bisect = 24) {
  const at = (t) => sdf(from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t);
  let hi = maxT;
  if (at(hi) <= 0) return null;
  let lo = hi;
  while (lo > 0) {
    lo = Math.max(0, lo - step);
    if (at(lo) <= 0) break;
    hi = lo;
    if (lo === 0) return null;
  }
  for (let i = 0; i < bisect; i++) { const m = (lo + hi) / 2; if (at(m) <= 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/**
 * rayHit by sphere tracing: steps inward from maxT by a fraction of the distance bound, so the crossing it brackets
 * is the same outer skin, found in far fewer evaluations (the mesher's hot loop). Bisects to about 1e-5.
 */
export function traceHit(sdf, from, dir, maxT, bisect = 10, k = 0.8, minStep = 0.01) {
  const at = (t) => sdf(from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t);
  let hi = maxT;
  let d = at(hi);
  if (d <= 0) return null;
  let lo = hi;
  for (;;) {
    lo = Math.max(0, hi - Math.max(minStep, d * k));
    d = at(lo);
    if (d <= 0) break;
    hi = lo;
    if (lo === 0) return null;
  }
  for (let i = 0; i < bisect; i++) { const m = (lo + hi) / 2; if (at(m) <= 0) lo = m; else hi = m; }
  return (lo + hi) / 2;
}

/** Point on the cortex cap (no folds, fissure bridged) seen from the core along `dir`, and its outward normal. */
export function surfacePoint(dir, from = CORE) {
  const t = rayHit(capSdf, from, dir);
  if (t === null) return null;
  const p = [from[0] + dir[0] * t, from[1] + dir[1] * t, from[2] + dir[2] * t];
  return { pos: p, normal: gradient(capSdf, p), t };
}

/**
 * True when tissue blocks the straight line from `eye` to `target` (world). Sphere-traces from the target toward
 * the eye, starting `skip` units off the target so a tip resting on the cortex does not occlude itself.
 */
export function occluded(eye, target, skip = 0.22) {
  const dx = eye[0] - target[0], dy = eye[1] - target[1], dz = eye[2] - target[2];
  const len = Math.hypot(dx, dy, dz);
  if (len <= skip) return false;
  const ux = dx / len, uy = dy / len, uz = dz / len;
  let t = skip;
  for (let i = 0; i < 160 && t < len; i++) {
    const d = tissueSdf(target[0] + ux * t, target[1] + uy * t, target[2] + uz * t);
    if (d < 0) return true;
    t += Math.max(0.03, d * 0.6);
  }
  return false;
}

/** Axis-aligned world bounds of all the anatomy (generous; for camera framing). */
export const BOUNDS = (() => {
  const H = ANATOMY.hemi;
  const C = ANATOMY.cerebellum;
  const S = ANATOMY.stem[ANATOMY.stem.length - 1];
  // the front, left/right and top come from the hemisphere ellipsoid; the back from whichever reaches further
  return {
    min: [O[0] - (H.ap + H.rAp), O[1] + S[1] - S[2], O[2] - H.rLat],
    max: [O[0] + Math.max(H.rAp - H.ap, C.rAp - C.ap), O[1] + H.y + H.rUp, O[2] + H.rLat],
  };
})();
