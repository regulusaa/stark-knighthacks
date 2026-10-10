// Unit check for brainLayout.js over every committed tree.json:  node web/core/brainLayout.test.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { layoutBrain, BRAIN, gapAzimuth } from './brainLayout.js';

const ASSETS = join(import.meta.dirname, '..', 'public', 'assets');
const MIN_TIP_DISTANCE = 0.5;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

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

    const gap = gapAzimuth();
    for (const t of tips) {
      assert.ok(t.pos[1] >= BRAIN.center[1] - 1e-9, `${t.id} below the equator`);
      const az = Math.atan2(t.dir[2], t.dir[0]);
      const off = Math.abs(((az - gap + 3 * Math.PI) % (2 * Math.PI)) - Math.PI) * 180 / Math.PI;
      assert.ok(t.dir[1] > 0.999 || off >= BRAIN.gapHalfDeg - 1e-9, `${t.id} inside the panel wedge (${off.toFixed(1)}°)`);
    }

    for (const e of a.edges) {
      if (e.isStem) continue;
      assert.ok(a.nodes.get(e.to).radius > a.nodes.get(e.from).radius, `radius does not grow along ${e.id}`);
    }
    assert.equal(tips.length, tree.nodes.filter((n) => n.isLeaf).length, 'every leaf placed');
    assert.equal(a.edges.length, tree.nodes.length, 'one edge per node (plus the stem, minus the root)');

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
