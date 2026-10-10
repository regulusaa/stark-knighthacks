// Steer engine against the pipeline's Keras reference and stored heatmaps:  node web/core/steer/engine.test.mjs
//   1. reference.json: all 1000 logits within 1e-3 and the Grad-CAM (after ReLU + normalization) with r > 0.999
//   2. all-ones scales reproduce the baseline exactly; the identity check passes for every steerable image
//   3. each image's steer.json flip reproduces (zeroing the n channels flips to `to`; n − 1 does not)
//   4. the live unsteered map matches every stored gradcam PNG (mean |Δ| < 3/255)
//   5. timing: apply + one cam
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { createEngine, parseHead, parseConv5, ENGINE } from './engine.js';

const ASSETS = join(import.meta.dirname, '..', '..', 'public', 'assets');
const bytes = (p) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const engine = createEngine(parseHead(bytes(join(ASSETS, 'steer', 'head.bin'))));
const load = (id) => engine.setImage(id, parseConv5(bytes(join(ASSETS, id, 'conv5.bin'))));

let failures = 0;
const check = (ok, msg) => { console.log(ok ? 'ok  ' : 'FAIL', msg); if (!ok) failures += 1; };
const pearson = (a, b) => {
  const n = a.length; let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
  return sab / Math.sqrt(saa * sbb);
};

// 1. reference.json
const ref = json(join(ASSETS, 'steer', 'reference.json'));
for (const im of ref.images) {
  load(im.imageId);
  for (const cs of im.cases) {
    engine.apply(cs.scales);
    let maxErr = 0;
    for (let k = 0; k < 1000; k++) maxErr = Math.max(maxErr, Math.abs(engine.logits[k] - cs.logits[k]));
    const top = engine.argmax();
    check(maxErr < 1e-3 && top === cs.top1.classId,
      `${im.imageId} "${cs.name}": 1000 logits max |Δ| ${maxErr.toExponential(2)}, top-1 ${top}`);
    const g = cs.gradcam;
    const want = g.camRaw.flat().map((v) => Math.max(0, v));
    const wmax = Math.max(...want);
    const got = engine.cam(g.classId, cs.scales);
    const r = got && wmax > 0 ? pearson(Array.from(got.map7, (v) => v / got.rawMax), want.map((v) => v / wmax)) : NaN;
    check(r > 0.999, `${im.imageId} "${cs.name}": Grad-CAM for ${g.classId} r = ${r.toFixed(6)}`);
  }
}

// 2–4. every steerable image
const manifest = json(join(ASSETS, 'manifest.json')).images.filter((m) => m.steerable);
const heat = new Uint8Array(224 * 224);
for (const m of manifest) {
  load(m.id);
  const base = Float64Array.from(engine.baseline);
  engine.apply([]);
  check(engine.logits.every((v, k) => v === base[k]), `${m.id}: all-ones scales equal the baseline exactly`);
  engine.apply([{ channel: 7, scale: 1 }, { channel: 1999, scale: 1 }]);
  check(engine.logits.every((v, k) => v === base[k]), `${m.id}: explicit scale-1 channels equal the baseline exactly`);

  const tree = json(join(ASSETS, m.id, 'tree.json'));
  const idErr = engine.identityError(tree);
  check(idErr < ENGINE.identityTol, `${m.id}: identity check, max |softmax − tree score| over ${tree.topK.length} = ${idErr.toExponential(2)}`);

  const st = json(join(ASSETS, m.id, 'steer.json'));
  const f = st.flip;
  if (f) {
    const zero = (chs) => chs.map((c) => ({ channel: c, scale: 0 }));
    engine.apply(zero(f.channels));
    const to = engine.argmax();
    const toScore = engine.probs[to];
    engine.apply(zero(f.channels.slice(0, -1)));
    const before = engine.argmax();
    check(to === f.to && Math.abs(toScore - f.toScore) < 1e-4 && before === f.from,
      `${m.id}: flip ${f.from} → ${f.to} after ${f.n} zeroed (got ${to}, ${toScore.toFixed(4)} vs ${f.toScore.toFixed(4)}; n − 1 keeps ${before})`);
  }
  // top-5 sets match steer.json's per-class lists
  let setsOk = true;
  for (const c of st.classes) {
    const mine = engine.topChannels(c.classId, 5).map((x) => x.channel);
    if (mine.join() !== c.top.slice(0, 5).map((x) => x.channel).join()) setsOk = false;
  }
  check(setsOk, `${m.id}: topChannels(k, 5) equals steer.json for all ${st.classes.length} classes`);

  const idx = json(join(ASSETS, m.id, 'gradcam', 'index.json'));
  let worst = 0, n = 0;
  for (const c of idx.classes.filter((x) => x.hasHeatmap)) {
    const png = PNG.sync.read(readFileSync(join(ASSETS, m.id, c.file)));
    const got = engine.cam(c.classId, null, heat);
    let sum = 0;
    for (let i = 0; i < 224 * 224; i++) sum += Math.abs((got ? heat[i] : 0) - png.data[i * 4]);
    worst = Math.max(worst, sum / (224 * 224));
    n += 1;
  }
  check(worst < 3, `${m.id}: live unsteered CAM vs ${n} stored PNGs, worst mean |Δ| ${worst.toFixed(3)}/255`);
}

// 5. timing (apply with 5 changed channels + one cam with upsampling), after warm-up
load('clean_retriever');
const set = engine.topChannels(207, 5).map((c, i) => ({ channel: c.channel, scale: i / 5 }));
for (let i = 0; i < 200; i++) { engine.apply(set); engine.cam(207, set, heat); }
const N = 2000;
const t0 = performance.now();
for (let i = 0; i < N; i++) { set[0].scale = (i % 100) / 100; engine.apply(set); engine.cam(engine.argmax(), set, heat); }
const ms = (performance.now() - t0) / N;
check(ms < 4, `apply + cam (5 channels, 224² upsample): ${ms.toFixed(3)} ms per call in node`);

console.log(failures ? `${failures} FAILED` : 'engine: all checks passed');
process.exitCode = failures ? 1 : 0;
