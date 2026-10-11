// Steer session (node):  node web/core/steer/session.test.mjs
// The demo flow on ambig_wolf (sliders, then code), latest-wins, errors that keep the scales, reset, medical.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSteerSession } from './session.js';

const ROOT = join(import.meta.dirname, '..', '..', 'public');
const file = (url) => join(ROOT, url.replace(/^\//, ''));
const fetchBytes = async (url) => { const b = readFileSync(file(url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const fetchJson = async (url) => JSON.parse(readFileSync(file(url), 'utf8'));
const manifest = (await fetchJson('/assets/manifest.json')).images;
const assetsFor = async (id) => {
  const e = manifest.find((m) => m.id === id);
  const base = '/' + e.folder;
  return [e, { base, tree: await fetchJson(base + 'tree.json'), gradcam: await fetchJson(base + 'gradcam/index.json') }];
};

let failures = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failures += 1; };

const s = createSteerSession({ fetchBytes, fetchJson });
const results = [];
const caps = [];
s.on('result', (r) => results.push(r));
s.on('capability', (c) => caps.push(c.steer));

check(await s.setImage(...await assetsFor('ambig_wolf')), 'ambig_wolf: Steer ready');
const st0 = s.state;
check(st0.seq === 0 && !st0.active && st0.source === null && st0.code === null && st0.error === null, 'baseline state: seq 0, inactive, no code');
check(st0.sets.top1.classId === 269 && st0.sets.top1.channels.map((c) => c.channel).join() === '449,31,240,252,1220', 'sets.top1: timber wolf leads with the flip set 449, 31, 240, 252, then 1220 (BUGS #1)');
check(st0.sets.top2.channels.map((c) => c.channel).join() === '1220,240,31,894,788', 'sets.top2: white wolf by contribution');
check(st0.result.top1.classId === 269 && st0.result.answers[0].heatmapSource === 'precomputed', 'unsteered top-1 timber wolf, precomputed heatmap');
check(st0.result.answers.every((a) => a.hasHeatmap === (a.heatmapSource !== null)), 'hasHeatmap equals heatmapSource !== null');

// the slider demo: 31 to 0 in steps, then 240, 449, 1220
const set = [];
const drive = (seq) => { s.update({ seq, set: set.map((x) => ({ ...x })), probe: set.at(-1)?.channel ?? null, from: 'g1' }); s.tick(); return s.state; };
let q = 0;
for (const v of [0.75, 0.5, 0.25, 0]) { set[0] = { channel: 31, scale: v }; drive(++q); }
check(s.state.result.top1.classId === 269 && s.state.probe === 31, '31 at 0: still timber wolf, probe 31');
const scores = [];
for (const c of [240, 449]) { set.push({ channel: c, scale: 0 }); scores.push(drive(++q).result.top1.score); }
check(s.state.result.top1.classId === 269, `240, 449 at 0: timber wolf holds (${scores.map((x) => x.toFixed(3)).join(' → ')})`);
set.push({ channel: 1220, scale: 0 });
const flipped = drive(++q);
check(flipped.result.top1Changed && flipped.result.top1.label === 'Arctic fox', `1220 at 0: flips to ${flipped.result.top1.label} ${flipped.result.top1.score.toFixed(3)}`);
check(flipped.code === 'channel[31, 240, 449, 1220] = 0', `code box: ${JSON.stringify(flipped.code)}`);
check(flipped.result.answers[0].heatmapSource === 'live', 'steered answers use live heatmaps');
check(flipped.result.outsideBrain === null, 'Arctic fox is drawn in the Brain (outsideBrain null)');

// latest wins: an older seq from the same driver is dropped; a different driver starts its own count
check(s.update({ seq: 2, set: [], from: 'g1' }) === false, 'older seq from the same driver is dropped');
s.update({ seq: q + 1, set: [{ channel: 31, scale: 0.5 }], from: 'g1' });
s.update({ seq: q + 2, set: [{ channel: 31, scale: 0 }], from: 'g1' });
s.tick();
check(s.state.seq === q + 2 && s.state.scales.length === 1 && s.state.scales[0].scale === 0, 'two updates in one frame: only the newest is applied');
check(s.update({ seq: 1, set: [], from: 'host' }) === true, 'another driver may start from seq 1');
s.tick();

// code mode: reset, then the top() program
s.reset(); s.tick();
check(s.state.seq === 0 && !s.state.active && s.state.result.top1.classId === 269, 'reset: baseline again');
s.update({ seq: 1, code: 'channel[top(5, "timber wolf")] = 0', from: 'g1' }); s.tick();
check(s.state.source === 'code' && s.state.result.top1.label === 'Arctic fox' && s.state.code === 'channel[31, 240, 449, 894, 1220] = 0',
  `code top(5, "timber wolf") = 0 → ${s.state.result.top1.label} ${s.state.result.top1.score.toFixed(3)}; code ${JSON.stringify(s.state.code)}`);
const before = JSON.stringify(s.state.scales);
s.update({ seq: 2, code: 'channel[top(5, "timbr wolf")] = 0', from: 'g1' }); s.tick();
check(s.state.error && /timber wolf/.test(s.state.error.message) && JSON.stringify(s.state.scales) === before,
  `resolve error keeps the scales: ${s.state.error?.message}`);
s.update({ seq: 3, code: 'channel[12 = 0', from: 'g1' }); s.tick();
check(s.state.error?.line === 1 && JSON.stringify(s.state.scales) === before, `parse error keeps the scales: ${s.state.error?.message}`);
s.update({ seq: 4, set: [{ channel: 5000, scale: 0 }], from: 'g1' }); s.tick();
check(s.state.error && JSON.stringify(s.state.scales) === before, `bad slider set keeps the scales: ${s.state.error?.message}`);

// a class outside the Brain (found by zeroing the top-5 of each successive top-1 on the sports car)
await s.setImage(...await assetsFor('clean_sportscar'));
const chain = ['sports car', 'crash helmet', 'snowmobile', 'lifeboat', 'violin', 'harvester', 'go-kart', 'motor scooter'];
s.update({ seq: 1, code: chain.map((l) => `channel[top(5, "${l}")] = 0`).join('\n'), from: 'g1' }); s.tick();
const ob = s.state.result.outsideBrain;
check(s.state.error === null && ob?.classId === s.state.result.top1.classId,
  `outsideBrain set when the top-1 is not drawn: ${ob?.label} ${ob?.score.toFixed(3)} (${s.state.scales.length} channels)`);
check(s.last.litLeaf === 'other', 'the lit path goes to "other"');
const rootId = s.last.state && (await assetsFor('clean_sportscar'))[1].tree.rootId;
check(Math.abs(s.last.values.get(rootId) - 1) < 1e-9 && s.last.values.get('other') > 0.5, `node values: root ${s.last.values.get(rootId).toFixed(6)}, other ${s.last.values.get('other').toFixed(3)}`);

// medical: Steer off
const caps0 = caps.length;
check(await s.setImage(...await assetsFor('med_xray_pneumonia')) === false && caps.at(-1) === false && caps.length > caps0, 'medical image: steer = false');
check(s.update({ seq: 1, set: [] }) === false, 'updates are ignored while Steer is off');

console.log(failures ? `${failures} FAILED` : 'session: all checks passed');
process.exitCode = failures ? 1 : 0;
