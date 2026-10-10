// Camera framing for any viewport (pure maths, no Three.js; node can test it).
// The authored default view (cameraRig.js RIG) is composed for 16:9 and is kept exactly there. Narrower screens keep
// the same viewing direction (so the Brain's tips, chosen to be visible from it, stay visible) and solve the camera
// distance and target so the whole Brain (spinal cord included, full length) and the whole source image fit:
//   landscape  the image stays front-left of the brain, alongside the cord; all are fitted inside the safe area
//   portrait   the brain fills the width under the HUD with the cord hanging below it; the image moves beside the
//              cord on the frontal side, under the brain, sized to the room there (up to a share of the height),
//              and the whole composition is centred vertically
// Safe area in NDC (x right, y up): the top band is the HUD's; a little room is kept at the other edges.

export const FRAMING = {
  wideAspect: 1.7,          // at or above this the authored default view is used as long as everything fits in it
  safe: { x0: -0.92, x1: 0.92, y0: -0.9, y1: 0.7 },
  portrait: {
    fov: 50,                // degrees (vertical): a tall screen needs a wider lens to keep the brain big
    safe: { x0: -0.9, x1: 0.9, y0: -0.9, y1: 0.68 },  // tips ride a little outside the tissue
    imageShare: 0.42,       // the most NDC height (of 2) given to the source image, caption included
    gap: 0.06,              // NDC between the brain and the image, and between the image and the cord
    inFront: 0.6,           // world units the image sits in front of the nearest brain point
  },
};

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Camera basis for `back` (unit vector from the target toward the camera), y up. */
export function basis(back) {
  const b = norm(back);
  const right = norm(cross([0, 1, 0], b));
  return { back: b, right, up: cross(b, right) };
}

/** NDC bounds of points seen from target + back·radius. */
export function ndcBounds(points, { target, radius, back, fov, aspect }) {
  const { back: b, right, up } = basis(back);
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const eye = add(target, mul(b, radius));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, near = Infinity;
  for (const p of points) {
    const r = sub(p, eye);
    const depth = -dot(r, b);
    const x = dot(r, right) / (depth * tanH);
    const y = dot(r, up) / (depth * tanV);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    if (depth < near) near = depth;
  }
  return { x0, x1, y0, y1, near };
}

const inside = (n, s, eps = 1e-3) => n.x0 >= s.x0 - eps && n.x1 <= s.x1 + eps && n.y0 >= s.y0 - eps && n.y1 <= s.y1 + eps;

/**
 * The closest camera on direction `back` that fits every point inside the NDC box `safe`, centred in it.
 * Iterates scale (distance) and shift (target in the image plane); ends with everything inside.
 */
export function fitView(points, { back, fov, aspect, safe, start = null }) {
  const { right, up } = basis(back);
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  let target = start?.target ?? mul(points.reduce((a, p) => add(a, p), [0, 0, 0]), 1 / points.length);
  let radius = start?.radius ?? 30;
  const w = safe.x1 - safe.x0;
  const h = safe.y1 - safe.y0;
  for (let i = 0; i < 40; i++) {
    const n = ndcBounds(points, { target, radius, back, fov, aspect });
    const s = Math.max((n.x1 - n.x0) / w, (n.y1 - n.y0) / h);
    const dx = (n.x0 + n.x1) / 2 - (safe.x0 + safe.x1) / 2;
    const dy = (n.y0 + n.y1) / 2 - (safe.y0 + safe.y1) / 2;
    if (Math.abs(s - 1) < 1e-4 && Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4) break;
    target = add(target, add(mul(right, dx * tanH * radius), mul(up, dy * tanV * radius)));
    radius *= s;
  }
  // perspective: the last step can leave a point a hair outside; back off until it is in
  for (let i = 0; i < 50 && !inside(ndcBounds(points, { target, radius, back, fov, aspect }), safe); i++) radius *= 1.005;
  return { target, radius };
}

/**
 * The view (and image panel placement) for a viewport.
 * @param brainPoints  world points on the Brain (tissue vertices, subsampled), cerebrum and cerebellum
 * @param stemPoints   world points on the brainstem and spinal cord below the cerebellum
 * @param panel        {size, extentBelow, position}: the authored image panel (its caption hangs extentBelow under it)
 * @param authored     {position, target, fov}: the 16:9 default view
 * @returns {fov, target, radius, back, panel: {position, scale}, kind}
 */
export function frameFor(aspect, { brainPoints, stemPoints = [], panel, authored }) {
  const back = norm(sub(authored.position, authored.target));
  const { right, up } = basis(back);
  const tissue = stemPoints.length ? [...brainPoints, ...stemPoints] : brainPoints;
  const panelCorners = (center, scale) => {
    const hs = (panel.size / 2) * scale;
    const below = (panel.size / 2 + panel.extentBelow) * scale;
    return [add(add(center, mul(right, -hs)), mul(up, hs)), add(add(center, mul(right, hs)), mul(up, hs)),
      add(add(center, mul(right, -hs)), mul(up, -below)), add(add(center, mul(right, hs)), mul(up, -below))];
  };

  if (aspect >= 1) {
    const all = [...tissue, ...panelCorners(panel.position, 1)];
    const radius0 = Math.hypot(...sub(authored.position, authored.target));
    if (aspect >= FRAMING.wideAspect) {
      const n = ndcBounds(all, { target: authored.target, radius: radius0, back, fov: authored.fov, aspect });
      if (inside(n, { x0: -0.97, x1: 0.97, y0: -0.97, y1: 0.75 }, 0)) {
        return { kind: 'authored', fov: authored.fov, target: authored.target.slice(), radius: radius0, back, panel: { position: panel.position.slice(), scale: 1 } };
      }
    }
    const v = fitView(all, { back, fov: authored.fov, aspect, safe: FRAMING.safe, start: { target: authored.target, radius: radius0 } });
    return { kind: 'landscape', fov: authored.fov, ...v, back, panel: { position: panel.position.slice(), scale: 1 } };
  }

  // portrait: brain across the width, the cord below it, the image beside the cord
  const P = FRAMING.portrait;
  const fov = P.fov;
  const tanV = Math.tan((fov * Math.PI) / 360);
  const tanH = tanV * aspect;
  const s = P.safe;
  const photoAspect = (panel.size + panel.extentBelow) / panel.size;   // NDC height per NDC width is this × aspect
  const cord = stemPoints.length ? stemPoints : brainPoints;
  let x0 = s.x0, x1 = s.x1;
  let v = null;
  let photo = null;
  for (let iter = 0; iter < 10; iter++) {
    // 1. the tissue fills the box's width; where does that leave the brain, the cord and the room beside it?
    v = fitView(tissue, { back, fov, aspect, safe: { x0, x1, y0: -10, y1: 10 }, start: v });
    const at = { ...v, back, fov, aspect };
    const nT = ndcBounds(tissue, at);
    const nC = ndcBounds(cord, at);
    // 2. the image, right-aligned against the cord (front side), under the brain over its own span
    const xR = nC.x0 - P.gap;
    const w = Math.max(0.05, Math.min(xR - s.x0, P.imageShare / (photoAspect * aspect)));
    let under = Infinity;
    const { right: r, up: u } = basis(back);
    const eye = add(v.target, mul(back, v.radius));
    for (const p of brainPoints) {
      const q = sub(p, eye);
      const depth = -dot(q, back);
      const x = dot(q, r) / (depth * tanH);
      if (x >= xR - w && x <= xR) under = Math.min(under, dot(q, u) / (depth * tanV));
    }
    if (!Number.isFinite(under)) under = ndcBounds(brainPoints, at).y0;
    const yTop = under - P.gap;
    const h = w * photoAspect * aspect;
    photo = { x0: xR - w, x1: xR, y1: yTop, y0: yTop - h, near: nT.near };
    // 3. everything must fit the safe height: if not, narrow the box and go again; if so, centre it vertically
    const top = nT.y1;
    const bottom = Math.min(nT.y0, photo.y0);
    const tall = top - bottom;
    const room = s.y1 - s.y0;
    if (tall > room + 1e-3) {
      const k = room / tall;
      const c = (x0 + x1) / 2, half = ((x1 - x0) / 2) * k;
      x0 = c - half; x1 = c + half;
      continue;
    }
    const shift = (s.y1 + s.y0) / 2 - (top + bottom) / 2;
    v = fitView(tissue, { back, fov, aspect, safe: { x0, x1, y0: nT.y0 + shift, y1: nT.y1 + shift }, start: v });
    photo = { ...photo, y0: photo.y0 + shift, y1: photo.y1 + shift, near: ndcBounds(tissue, { ...v, back, fov, aspect }).near };
    break;
  }
  // the image: just in front of the Brain, at the NDC box found above
  const eye = add(v.target, mul(back, v.radius));
  const depth = photo.near - P.inFront;
  const scale = ((photo.x1 - photo.x0) * tanH * depth) / panel.size;
  const xc = (photo.x0 + photo.x1) / 2;
  const yc = photo.y1 - ((panel.size / 2) * scale) / (tanV * depth);
  const position = add(add(add(eye, mul(back, -depth)), mul(right, xc * tanH * depth)), mul(up, yc * tanV * depth));
  return { kind: 'portrait', fov, target: v.target, radius: v.radius, back, panel: { position, scale } };
}
