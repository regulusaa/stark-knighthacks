// Framing (framing.js) over the real tissue geometry:  node web/core/framing.test.mjs
// 16:9 keeps the authored view exactly; 1180×820 and 390×844 fit the whole Brain, the whole spinal cord and the whole
// photo (caption included) inside the safe area, along the authored viewing direction. In portrait the photo sits
// beside the cord, under the brain, overlapping neither.
import assert from 'node:assert/strict';
import { buildTissueArrays } from './brainTissueBuild.js';
import { frameFor, ndcBounds, FRAMING } from './framing.js';
import { STEM_FRAME_Y } from './brainShape.js';
import { RIG } from './cameraRig.js';
import { PANEL, panelExtentBelow } from './imagePanel.js';
import { fiberPaths } from './brainFibers.js';

const g = buildTissueArrays();
const pts = [];
const stem = [];
for (let i = 0; i < g.position.length / 3; i += 23) {
  const p = [g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]];
  (p[1] < STEM_FRAME_Y ? stem : pts).push(p);
}
assert.ok(Math.min(...stem.map((p) => p[1])) < STEM_FRAME_Y - 3, 'the cord hangs well below the cerebellum');
for (const path of fiberPaths()) stem.push(...path.points);
for (const x of [-0.35, 0.35]) for (const z of [-0.35, 0.35]) stem.push([x, 0, z], [x, 6, z]);
const authored = { position: RIG.defaultPosition.toArray(), target: RIG.defaultTarget.toArray(), fov: RIG.fov };
const panel = { size: PANEL.size, extentBelow: panelExtentBelow(), position: PANEL.position.toArray() };
const dir = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
const authoredBack = dir(authored.position.map((x, i) => x - authored.target[i]));

for (const [w, h] of [[2560, 1440], [1920, 1080], [1180, 820], [390, 844]]) {
  const aspect = w / h;
  const f = frameFor(aspect, { brainPoints: pts, stemPoints: stem, panel, authored });
  assert.ok(f.back.every((x, i) => Math.abs(x - authoredBack[i]) < 1e-12), `${w}×${h}: viewing direction changed`);
  const s = f.kind === 'portrait' ? FRAMING.portrait.safe : f.kind === 'authored' ? { x0: -0.97, x1: 0.97, y0: -0.97, y1: 0.75 } : FRAMING.safe;
  const hs = (PANEL.size / 2) * f.panel.scale;
  const corners = [];
  // the panel faces the camera: its corners in the camera's right/up plane
  const up0 = [0, 1, 0];
  const right = dir([up0[1] * f.back[2] - up0[2] * f.back[1], up0[2] * f.back[0] - up0[0] * f.back[2], up0[0] * f.back[1] - up0[1] * f.back[0]]);
  const up = [f.back[1] * right[2] - f.back[2] * right[1], f.back[2] * right[0] - f.back[0] * right[2], f.back[0] * right[1] - f.back[1] * right[0]];
  for (const sx of [-1, 1]) for (const [sy, ext] of [[1, hs], [-1, hs + panelExtentBelow() * f.panel.scale]]) {
    corners.push(f.panel.position.map((p, i) => p + sx * hs * right[i] + sy * ext * up[i]));
  }
  const box = {};
  for (const [name, set] of [['brain', pts], ['cord', stem], ['photo', corners]]) {
    const n = ndcBounds(set, { ...f, aspect });
    box[name] = n;
    assert.ok(n.x0 >= s.x0 - 1e-3 && n.x1 <= s.x1 + 1e-3 && n.y0 >= s.y0 - 1e-3 && n.y1 <= s.y1 + 1e-3,
      `${w}×${h}: ${name} outside the safe area (${[n.x0, n.x1, n.y0, n.y1].map((x) => x.toFixed(2))})`);
  }
  const all = ndcBounds([...pts, ...stem, ...corners], {...f, aspect});
  assert.ok(Math.abs((all.x0 + all.x1) / 2 - (s.x0 + s.x1) / 2) < 0.02, `${w}×${h}: horizontal centre drift`);
  assert.ok(Math.abs((all.y0 + all.y1) / 2 - (s.y0 + s.y1) / 2) < 0.02, `${w}×${h}: vertical centre drift`);
  if (f.kind === 'portrait') {
    const { photo, cord } = box;
    assert.ok(photo.x1 <= cord.x0 + 1e-3, `${w}×${h}: the photo overlaps the cord (${photo.x1.toFixed(2)} > ${cord.x0.toFixed(2)})`);
    // under the brain where it hangs over the photo
    const brainOver = ndcBounds(pts.filter((p) => { const n = ndcBounds([p], { ...f, aspect }); return n.x0 >= photo.x0 && n.x0 <= photo.x1; }), { ...f, aspect });
    assert.ok(photo.y1 <= brainOver.y0 + 1e-3, `${w}×${h}: the photo overlaps the brain (${photo.y1.toFixed(2)} > ${brainOver.y0.toFixed(2)})`);
    const brainH = box.brain.y1 - box.brain.y0;
    console.log(`  ${w}×${h} portrait: photo ${(photo.x1 - photo.x0).toFixed(2)}×${(photo.y1 - photo.y0).toFixed(2)} NDC, brain ${(box.brain.x1 - box.brain.x0).toFixed(2)}×${brainH.toFixed(2)}`);
  }
}
console.log('framing: ok (2560×1440, 1920×1080, 1180×820, 390×844 centred; full trunk and nerve roots in frame)');
