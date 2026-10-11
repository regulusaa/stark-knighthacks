// Decorative fibres (brainFibers.js):  node web/core/brainFibers.test.mjs
// Deterministic, finite, and outside the Brain (they hang off the cord; none may run through the tissue).
import assert from 'node:assert/strict';
import { fiberPaths } from './brainFibers.js';
import { tissueSdf, cerebrumSdf, cerebellumSdf } from './brainShape.js';

const a = fiberPaths();
const b = fiberPaths();
assert.deepEqual(a, b, 'deterministic');
assert.ok(a.length >= 20, `only ${a.length} fibres`);
let points = 0;
for (const [i, f] of a.entries()) {
  assert.ok(f.points.length >= 4 && f.points.flat().every(Number.isFinite), `fibre ${i}: finite points`);
  for (const p of f.points.slice(1)) {
    points += 1;
    assert.ok(tissueSdf(...p) > 0, `fibre ${i} runs through tissue at ${p.map((v) => v.toFixed(2))}`);
    assert.ok(cerebrumSdf(...p) > 0.2 && cerebellumSdf(...p) > 0.2, `fibre ${i} touches the brain at ${p.map((v) => v.toFixed(2))}`);
  }
}
console.log(`brainFibers: ok (${a.length} fibres, ${points} points outside the tissue)`);
