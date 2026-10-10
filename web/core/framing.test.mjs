// Framing (framing.js) over the real tissue geometry:  node web/core/framing.test.mjs
// 16:9 keeps the authored view exactly; 1180×820 and 390×844 fit the whole Brain and the whole photo (caption
// included) inside the safe area, along the authored viewing direction.
import assert from 'node:assert/strict';
import { buildTissueArrays } from './brainTissueBuild.js';
import { frameFor, ndcBounds, FRAMING } from './framing.js';
import { RIG } from './cameraRig.js';
import { PANEL, panelExtentBelow } from './imagePanel.js';

const g = buildTissueArrays();
const pts = [];
for (let i = 0; i < g.position.length / 3; i += 23) pts.push([g.position[i * 3], g.position[i * 3 + 1], g.position[i * 3 + 2]]);
const authored = { position: RIG.defaultPosition.toArray(), target: RIG.defaultTarget.toArray(), fov: RIG.fov };
const panel = { size: PANEL.size, extentBelow: panelExtentBelow(), position: PANEL.position.toArray() };
const dir = (a) => { const l = Math.hypot(...a); return a.map((x) => x / l); };
const authoredBack = dir(authored.position.map((x, i) => x - authored.target[i]));

for (const [w, h] of [[2560, 1440], [1920, 1080], [1180, 820], [390, 844]]) {
  const aspect = w / h;
  const f = frameFor(aspect, { brainPoints: pts, panel, authored });
  assert.ok(f.back.every((x, i) => Math.abs(x - authoredBack[i]) < 1e-12), `${w}×${h}: viewing direction changed`);
  if (aspect >= 16 / 9 - 1e-9) {
    assert.equal(f.kind, 'authored', `${w}×${h} should keep the authored view`);
    assert.deepEqual(f.target, authored.target);
    continue;
  }
  const s = f.kind === 'portrait' ? FRAMING.portrait.safe : FRAMING.safe;
  const hs = (PANEL.size / 2) * f.panel.scale;
  const corners = [];
  // the panel faces the camera: its corners in the camera's right/up plane
  const up0 = [0, 1, 0];
  const right = dir([up0[1] * f.back[2] - up0[2] * f.back[1], up0[2] * f.back[0] - up0[0] * f.back[2], up0[0] * f.back[1] - up0[1] * f.back[0]]);
  const up = [f.back[1] * right[2] - f.back[2] * right[1], f.back[2] * right[0] - f.back[0] * right[2], f.back[0] * right[1] - f.back[1] * right[0]];
  for (const sx of [-1, 1]) for (const [sy, ext] of [[1, hs], [-1, hs + panelExtentBelow() * f.panel.scale]]) {
    corners.push(f.panel.position.map((p, i) => p + sx * hs * right[i] + sy * ext * up[i]));
  }
  for (const [name, set] of [['brain', pts], ['photo', corners]]) {
    const n = ndcBounds(set, { ...f, aspect });
    assert.ok(n.x0 >= s.x0 - 1e-3 && n.x1 <= s.x1 + 1e-3 && n.y0 >= s.y0 - 1e-3 && n.y1 <= s.y1 + 1e-3,
      `${w}×${h}: ${name} outside the safe area (${[n.x0, n.x1, n.y0, n.y1].map((x) => x.toFixed(2))})`);
  }
}
console.log('framing: ok (2560×1440, 1920×1080 authored; 1180×820, 390×844 fitted)');
