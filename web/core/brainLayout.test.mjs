// Unit check for brainLayout.js over every committed tree.json:  node web/core/brainLayout.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { layoutBrain, BRAIN, FRONT_AZIMUTH } from './brainLayout.js';
import { capSdf, occluded, STEM_AXIS } from './brainShape.js';
import { RIG } from './cameraRig.js';

assert.deepEqual(BRAIN.viewFrom, RIG.defaultPosition.toArray(), 'BRAIN.viewFrom must be the default camera position');

const ASSETS = join(import.meta.dirname, '..', 'public', 'assets');
const MIN_TIP_DISTANCE = 0.5;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dirOf = (a, b) => { const d = dist(a, b) || 1; return [(b[0] - a[0]) / d, (b[1] - a[1]) / d, (b[2] - a[2]) / d]; };
const angleDeg = (u, v) => Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]))) * 180 / Math.PI;
const STEM_UP = dirOf(STEM_AXIS[1], STEM_AXIS[0]);

let failures = 0;
let images = 0;
for (const id of readdirSync(ASSETS).sort()) {
  const file = join(ASSETS, id, 'tree.json');
  if (!existsSync(file)) continue;
  images += 1;
  const tree = JSON.parse(readFileSync(file, 'utf8'));
  try {
    const a = layoutBrain(tree);
    const tips = [...a.nodes.values()].filter((n) => n.isLeaf);

    let min = Infinity;
    for (let i = 0; i < tips.length; i++) for (let j = i + 1; j < tips.length; j++) min = Math.min(min, dist(tips[i].pos, tips[j].pos));
    assert.ok(min >= MIN_TIP_DISTANCE, `closest tips ${min.toFixed(3)} < ${MIN_TIP_DISTANCE}`);

    for (const t of tips) {
      // resting on the cortex: tipLift above the smooth cap (the SDF is a bound, so its distance reads a little low)
      const d = capSdf(...t.pos);
      assert.ok(d > 0.5 * BRAIN.tipLift && d < 1.5 * BRAIN.tipLift, `${t.id} is ${d.toFixed(3)} off the cortex (want ≈${BRAIN.tipLift})`);
      // outside the excluded zones: base, frontal pole (faces the panel), far flank, fissure
      assert.ok(t.dir[1] >= BRAIN.minY - 1e-9, `${t.id} below the base`);
      assert.ok(t.dir[2] >= BRAIN.farFlankZ - 1e-9, `${t.id} on the far flank`);
      const az = Math.atan2(t.dir[2], t.dir[0]);
      const off = Math.abs(((az - FRONT_AZIMUTH + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
      assert.ok(t.dir[1] >= 0.9 || off >= BRAIN.frontHalfDeg - 1e-9, `${t.id} on the frontal pole (${off.toFixed(1)}°)`);
      assert.ok(Math.abs(t.pos[2] - BRAIN.core[2]) >= BRAIN.midline - 0.2, `${t.id} in the fissure`);
      // nothing but air between the tip and a point well outside it along its normal
      const out = t.pos.map((v, k) => v + t.normal[k] * 6);
      assert.ok(!occluded(out, t.pos), `${t.id} is buried under tissue`);
      assert.ok(!occluded(BRAIN.viewFrom, t.pos), `${t.id} is hidden from the default camera`);
    }

    // depth maps to radius: every internal node sits at (depth / maxDepth) of its envelope distance, deeper = further out
    for (const e of a.edges) {
      if (e.isStem) continue;
      const from = a.nodes.get(e.from);
      const to = a.nodes.get(e.to);
      assert.ok(to.radius / to.envelope > from.radius / from.envelope, `depth fraction does not grow along ${e.id}`);
    }
    // fibre tracts: through the volume (under the cortex cap but for a leaf's last stretch), smooth through every
    // branch point, the core (where they leave the stem) included; the stem climbs the brainstem
    const stem = a.edges.find((e) => e.isStem);
    assert.ok(angleDeg(STEM_UP, dirOf(stem.points[0], stem.points[2])) < 30, 'the stem climbs the brainstem');
    const into = new Map(a.edges.map((e) => [e.to, e]));
    for (const e of a.edges) {
      if (e.isStem) continue;
      const n = e.points.length;
      const free = into.get(e.to) && a.nodes.get(e.to).isLeaf ? Math.floor(n * (1 - BRAIN.leafTail)) : n - 1;
      for (let i = 1; i < free; i++) {
        const d = capSdf(...e.points[i]);
        assert.ok(d < 0, `${e.id} leaves the cortex at sample ${i} (${d.toFixed(3)})`);
      }
      const start = dirOf(e.points[0], e.points[1]);
      // smooth through its parent node: out of the stem for a first-level tract
      const parent = into.get(e.from);
      const m = parent.points.length;
      const arrive = dirOf(parent.points[m - 2], parent.points[m - 1]);
      assert.ok(angleDeg(arrive, start) < 25, `${e.id} kinks ${angleDeg(arrive, start).toFixed(0)}° at ${e.from}`);
    }
    const top1 = tips.find((t) => t.node.onTop1Path);
    assert.ok(top1, 'top-1 tip placed');
    assert.equal(tips.length, tree.nodes.filter((n) => n.isLeaf).length, 'every leaf placed');
    assert.equal(a.edges.length, tree.nodes.length, 'one edge per node (plus the stem, minus the root)');
    assert.ok(a.edges.every((e) => e.points.length >= 2 && e.points.flat().every(Number.isFinite)), 'finite edge points');

    const again = layoutBrain(JSON.parse(readFileSync(file, 'utf8')));
    assert.deepEqual([...again.nodes.values()].map((n) => n.pos), [...a.nodes.values()].map((n) => n.pos), 'deterministic');

    console.log(`ok   ${id.padEnd(18)} ${String(tips.length).padStart(2)} tips  min tip distance ${min.toFixed(2)}  depth ${a.maxDepth}  edges ${a.edges.length}`);
  } catch (err) {
    failures += 1;
    console.log(`FAIL ${id}: ${err.message}`);
  }
}
if (!images) { console.log('no tree.json files found'); process.exit(1); }
console.log(failures ? `brainLayout: ${failures} failure(s)` : `brainLayout: ok (${images} images)`);
process.exit(failures ? 1 : 0);
