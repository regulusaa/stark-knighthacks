// The trunk interior (master plan 6.3 / 7.6; contract v3 mode "trunk"): set-mode trunk opens the forward-pass trunk
// into a column of slabs, one per ResNet50 layer from atlas.json, conv1 at the bottom to conv5_block3_out at the
// top. Every slab has the same world width, so a 112×112 layer has tiny cells and a 7×7 layer large ones. Each cell
// is a box whose height and inferno colour come from its quantized activation (the L2 norm over channels, as the atlas
// stores it). One instanced draw call for every cell of every slab. Stage labels on the left (facts only), the 16
// skip connections as thin arcs on the right (dashed where the shortcut is a projection). layerMode reduced keeps
// layer-config.json's reduced slabs, spread over the same height. The pulse brightens each slab as it passes. The top
// slab is the layer Steer edits: while steering is active its 7×7 heights are recomputed live from conv5.bin and
// the current scales. Entering flies the camera beside the column and dims the Brain; normal reverses it.
import * as THREE from 'three';
import { INFERNO_GLSL } from './inferno.js';

export const INTERIOR = {
  width: 2.4,              // world units, every slab
  y0: 0,
  y1: 6,
  stageGap: 0.16,          // extra space between stages (full mode)
  fill: 0.8,               // a full-height box fills this much of the space to the next slab
  reducedHeight: 0.55,     // box height at full value in reduced mode
  minHeight: 0.004,        // a zero cell is still a thin tile, so every slab reads as a plate
  cellGap: 0.12,           // fraction of each cell left empty around its box
  dim: 0.3,                // the Brain while inside
  openMs: 1200,
  viewPhiDeg: 64,          // camera polar angle beside the column
  skipX: 1.34,             // skip arcs: x of their ends (right side of the column)
  skipBow: 0.32,           // … and how far they bow out, per world unit of span (capped)
  skipRadius: 0.014,
  labelX: -1.55,
  labelHeight: 0.16,
  pulseWidth: 1.2,         // slabs
  steerLabel: 'Steer edits this layer',
};

const STAGE_LABEL = { conv1: 'conv1', conv2: 'stage 2', conv3: 'stage 3', conv4: 'stage 4', conv5: 'stage 5' };

/** Slab heights for both modes (pure; node can test it). */
export function slabLayout(layers, reducedNames, cfg = INTERIOR) {
  const n = layers.length;
  const stageBreaks = layers.reduce((k, l, i) => k + (i > 0 && l.stage !== layers[i - 1].stage ? 1 : 0), 0);
  const spacing = (cfg.y1 - cfg.y0 - stageBreaks * cfg.stageGap) / Math.max(1, n - 1);
  const yFull = [];
  let y = cfg.y0;
  layers.forEach((l, i) => {
    if (i > 0) y += spacing + (l.stage !== layers[i - 1].stage ? cfg.stageGap : 0);
    yFull.push(y);
  });
  const red = layers.map((l) => reducedNames.has(l.name));
  const m = red.filter(Boolean).length;
  let k = 0;
  const yReduced = red.map((r) => (r ? cfg.y0 + (k++ / Math.max(1, m - 1)) * (cfg.y1 - cfg.y0 - cfg.reducedHeight) : null));
  return { spacing, yFull, yReduced, hFull: spacing * cfg.fill };
}

function labelTexture(text, color = '#e8dcf5') {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const px = 52;
  const font = `500 ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width + px);
  c.height = Math.ceil(px * 1.5);
  g.font = font;
  g.fillStyle = 'rgba(16, 8, 24, 0.6)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, c.height / 2);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, px / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

function makeLabel(text, color) {
  const { tex, aspect } = labelTexture(text, color);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  s.scale.set(INTERIOR.labelHeight * 1.5 * aspect, INTERIOR.labelHeight * 1.5, 1);
  s.renderOrder = 22;
  s.center.set(1, 0.5);   // right-aligned: the text ends at the column
  return s;
}

const cellVertex = /* glsl */ `
attribute vec4 aCell;     // x, z, footprint, slab index
attribute vec2 aY;        // y in full mode, y in reduced mode (-1: not in the reduced set)
attribute float aValue;   // 0..1
uniform float uMix;       // 0 full … 1 reduced
uniform float uHFull;
uniform float uHReduced;
uniform float uMinH;
uniform float uOpen;      // 0 closed (the trunk) … 1 open
uniform float uTop;
uniform float uPulse;     // the pulse band, in slabs; < -5: none
uniform float uPulseWidth;
varying vec3 vColor;
#include <fog_pars_vertex>
${INFERNO_GLSL}
void main() {
  bool inReduced = aY.y > -0.5;
  float gone = inReduced ? 0.0 : uMix;                 // slabs outside the reduced set shrink away
  float y = mix(aY.x, inReduced ? aY.y : aY.x, uMix);
  float h = max(uMinH, aValue * mix(uHFull, uHReduced, uMix)) * (1.0 - gone);
  float fp = aCell.z * (1.0 - gone);
  vec3 p = vec3(aCell.x + position.x * fp, y + (position.y + 0.5) * h, aCell.y + position.z * fp);
  // opening: the column grows out of the trunk (narrow, and hanging from its top) into full size
  float o = uOpen * uOpen * (3.0 - 2.0 * uOpen);
  p.xz *= mix(0.07, 1.0, o);
  p.y = uTop - (uTop - p.y) * mix(0.5, 1.0, o);
  float shade = normal.y > 0.5 ? 1.0 : normal.y < -0.5 ? 0.35 : 0.62;
  vec3 col = inferno(0.1 + 0.85 * aValue) * shade;
  float band = uPulse < -5.0 ? 0.0 : exp(-pow((aCell.w - uPulse) / uPulseWidth, 2.0));
  vColor = col + inferno(0.95) * band * 0.9;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const cellFragment = /* glsl */ `
varying vec3 vColor;
#include <fog_pars_fragment>
void main() {
  gl_FragColor = vec4(vColor, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const skipVertex = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const skipFragment = /* glsl */ `
uniform float uDashes;    // 0: solid
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  if (uDashes > 0.0 && fract(vUv.x * uDashes) > 0.55) discard;
  gl_FragColor = vec4(uColor, uAlpha);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createTrunkInterior({ api, scene, rig, camera, trunk, steer, dimBrain }) {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uMix: { value: 0 }, uHFull: { value: 0.1 }, uHReduced: { value: INTERIOR.reducedHeight }, uMinH: { value: INTERIOR.minHeight },
    uOpen: { value: 0 }, uTop: { value: INTERIOR.y1 }, uPulse: { value: -10 }, uPulseWidth: { value: INTERIOR.pulseWidth },
  }]);
  const cellMaterial = new THREE.ShaderMaterial({ uniforms, vertexShader: cellVertex, fragmentShader: cellFragment, fog: true });
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const skipMats = [false, true].map((dashed) => new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDashes: { value: dashed ? 14 : 0 }, uAlpha: { value: 0 }, uColor: { value: new THREE.Color(0xc9b6e8) } }]),
    vertexShader: skipVertex, fragmentShader: skipFragment, fog: true, transparent: true, depthWrite: false,
  }));

  let built = null;       // {imageId, cells, skips, labels, steerLabel, layers, layout, topStart}
  let reducedNames = null;
  let open = 0;           // 0..1 transition
  let target = 0;
  let mix = 0;
  let mixTarget = 0;
  const steerVals = new Float32Array(49);

  function disposeBuilt() {
    if (!built) return;
    group.remove(built.cells, ...built.skips, ...built.labels, built.steerLabel);
    built.cells.geometry.dispose();
    for (const s of built.skips) s.geometry.dispose();
    for (const l of [...built.labels, built.steerLabel]) { l.material.map.dispose(); l.material.dispose(); }
    built = null;
  }

  async function loadReduced() {
    if (reducedNames) return reducedNames;
    try {
      const cfg = await (await fetch('/assets/layer-config.json', { cache: 'no-cache' })).json();
      reducedNames = new Set(cfg.layers.filter((l) => l.reduced).map((l) => l.name));
    } catch {
      reducedNames = new Set();
    }
    return reducedNames;
  }

  async function build(assets) {
    const base = assets.base;
    const [meta, bin] = await Promise.all([
      fetch(`${base}atlas.json`, { cache: 'no-cache' }).then((r) => r.json()),
      fetch(`${base}atlas.bin`).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b)),
      loadReduced(),
    ]);
    if (meta.schema !== 'stark.atlas/1' || bin.length !== meta.totalBytes) throw new Error('bad atlas');
    const layers = meta.layers;
    const L = slabLayout(layers, reducedNames);
    const total = layers.reduce((a, l) => a + l.length, 0);
    const cell = new Float32Array(total * 4);
    const ys = new Float32Array(total * 2);
    const val = new Float32Array(total);
    let k = 0;
    const W = INTERIOR.width;
    layers.forEach((l, li) => {
      const cs = W / l.width;
      const yr = L.yReduced[li] ?? -1;
      for (let r = 0; r < l.height; r++) {
        for (let c = 0; c < l.width; c++, k++) {
          cell[k * 4] = -W / 2 + (c + 0.5) * cs;      // x: image left → right
          cell[k * 4 + 1] = -W / 2 + (r + 0.5) * cs;  // z: image top at the back
          cell[k * 4 + 2] = cs * (1 - INTERIOR.cellGap);
          cell[k * 4 + 3] = li;
          ys[k * 2] = L.yFull[li];
          ys[k * 2 + 1] = yr;
          val[k] = bin[l.offset + r * l.width + c] / 255;
        }
      }
    });
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = boxGeo.index;
    geo.setAttribute('position', boxGeo.attributes.position);
    geo.setAttribute('normal', boxGeo.attributes.normal);
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cell, 4));
    geo.setAttribute('aY', new THREE.InstancedBufferAttribute(ys, 2));
    const valAttr = new THREE.InstancedBufferAttribute(val, 1);
    valAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aValue', valAttr);
    geo.instanceCount = total;
    const cells = new THREE.Mesh(geo, cellMaterial);
    cells.frustumCulled = false;
    uniforms.uHFull.value = L.hFull;

    // stage labels (left), at each stage's middle slab
    const labels = [];
    for (const stage of Object.keys(STAGE_LABEL)) {
      const idx = layers.map((l, i) => (l.stage === stage ? i : -1)).filter((i) => i >= 0);
      if (!idx.length) continue;
      const l = layers[idx[0]];
      const s = makeLabel(`${STAGE_LABEL[stage]} · ${l.width}×${l.height}`);
      s.userData = { full: (L.yFull[idx[0]] + L.yFull[idx[idx.length - 1]]) / 2,
        reduced: L.yReduced[idx.filter((i) => L.yReduced[i] !== null).at(-1)] ?? null };
      labels.push(s);
    }
    const top = layers.length - 1;
    const steerLabel = makeLabel(INTERIOR.steerLabel, '#ffd27a');
    steerLabel.center.set(0, 0.5);
    steerLabel.userData = { full: L.yFull[top], reduced: L.yReduced[top] };
    steerLabel.visible = false;

    // skip arcs (right side): from the block's input slab to its output slab
    const index = new Map(layers.map((l, i) => [l.name, i]));
    const skips = [];
    for (const sk of meta.skips ?? []) {
      // the block's input (the previous block's output); conv2_block1's input is pool1, not in the atlas: from conv1
      const from = sk.inputInAtlas === false ? 0 : index.get(sk.inputLayer) ?? index.get(sk.fromLayer);
      const to = index.get(sk.toLayer);
      if (from === undefined || to === undefined) continue;
      const y0 = L.yFull[from] + L.hFull * 0.5, y1 = L.yFull[to] + L.hFull * 0.5;
      const bow = Math.min(0.55, INTERIOR.skipBow * (y1 - y0) + 0.12);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(INTERIOR.skipX, y0, 0),
        new THREE.Vector3(INTERIOR.skipX + bow * 2, (y0 + y1) / 2, 0), new THREE.Vector3(INTERIOR.skipX, y1, 0));
      const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, INTERIOR.skipRadius, 6, false), skipMats[sk.projection ? 1 : 0]);
      m.renderOrder = 2;
      skips.push(m);
    }
    group.add(cells, ...skips, ...labels, steerLabel);
    return { imageId: assets.entry.id, cells, valAttr, skips, labels, steerLabel, layers, layout: L, topStart: total - layers[top].length,
      topMax: layers[top].maxRaw, topBase: val.slice(total - layers[top].length) };
  }

  function placeLabels() {
    if (!built) return;
    const e = mix * mix * (3 - 2 * mix);
    for (const s of [...built.labels, built.steerLabel]) {
      const { full, reduced } = s.userData;
      const y = reduced === null ? full : full + (reduced - full) * e;
      const x = s === built.steerLabel ? INTERIOR.width / 2 + 0.25 : INTERIOR.labelX;
      s.position.set(x, y + 0.04, s === built.steerLabel ? -INTERIOR.width / 2 : 0);
      s.material.opacity = open * open * (reduced === null && s !== built.steerLabel ? 1 - e : 1);
    }
    for (const m of skipMats) m.uniforms.uAlpha.value = 0.85 * open * (1 - e);
  }

  /** The top slab follows Steer: L2 over the scaled conv5 activations, on the atlas's own scale. */
  function steerSlab() {
    if (!built) return;
    const st = steer.session.state;
    const eng = steer.session.engine;
    const active = Boolean(st?.active && eng && steer.session.imageId === built.imageId);
    const a = built.valAttr.array;
    if (active) {
      eng.l2Map(st.scales, steerVals);
      for (let i = 0; i < 49; i++) a[built.topStart + i] = Math.min(1.6, steerVals[i] / built.topMax);
    } else a.set(built.topBase, built.topStart);
    built.valAttr.addUpdateRange(built.topStart, 49);
    built.valAttr.needsUpdate = true;
    built.steerLabel.visible = active;
  }

  async function enter() {
    const a = api.assets;
    if (!a?.entry.files?.atlas) return;
    try {
      if (!built || built.imageId !== a.entry.id) { disposeBuilt(); built = await build(a); }
    } catch (err) {
      console.warn(`[stark] trunk interior unavailable: ${err.message}`);
      api.patchState({}, { capabilities: { trunkInterior: false, layerModes: false } });
      return;
    }
    if (api.state?.mode !== 'trunk') return;   // left again while loading
    target = 1;
    mixTarget = api.state.layerMode === 'reduced' ? 1 : 0;
    group.visible = true;
    steerSlab();
    // beside the column, looking at it from the default side, a little lower than the Brain's view
    const W = INTERIOR.width / 2;
    const pts = [];
    for (const x of [-W - 1.2, W + 0.9]) for (const y of [INTERIOR.y0, INTERIOR.y1 + 0.2]) for (const z of [-W, W]) pts.push(new THREE.Vector3(x, y, z));
    rig.flyToFit(pts, INTERIOR.openMs, 0.86, 0.74, { theta: rig.defaultView.theta, phi: THREE.MathUtils.degToRad(INTERIOR.viewPhiDeg) });
  }

  function exit() {
    target = 0;
    rig.resetView(INTERIOR.openMs);
  }

  api.onImageLoaded(({ id }) => {
    target = 0; open = 0; mix = mixTarget = 0;
    group.visible = false;
    trunk.mesh.visible = true;
    dimBrain(1);
    if (built && built.imageId !== id) disposeBuilt();
    const a = api.assets;
    const ok = Boolean(a?.entry.files?.atlas && a.tree?.scoreKind !== 'independent');
    api.patchState({}, { capabilities: { trunkInterior: ok, layerModes: ok } });
  });
  api.onMode(({ from, to }) => {
    if (to === 'trunk') enter();
    else if (from === 'trunk') exit();
  });
  api.onLayerMode((m) => { mixTarget = m === 'reduced' ? 1 : 0; });
  steer.session.on('applied', () => { if (open > 0) steerSlab(); });

  return {
    group,
    get open() { return open; },
    get built() { return built; },
    dispose: disposeBuilt,
    update(dt) {
      const step = dt * 1000 / INTERIOR.openMs;
      if (open !== target) open = target > open ? Math.min(target, open + step) : Math.max(target, open - step);
      if (mix !== mixTarget) mix = mixTarget > mix ? Math.min(mixTarget, mix + step * 1.5) : Math.max(mixTarget, mix - step * 1.5);
      if (open === 0 && target === 0) {
        if (group.visible) { group.visible = false; trunk.mesh.visible = true; dimBrain(1); }
        return;
      }
      uniforms.uOpen.value = open;
      uniforms.uMix.value = mix * mix * (3 - 2 * mix);
      // the forward pass: slab i lights as the band reaches layer i (trunk.js climbs 49 layers)
      const ph = trunk.state.phase;
      uniforms.uPulse.value = ph === 'playing' && built ? trunk.state.progress * built.layers.length - 0.5 : -10;
      trunk.mesh.visible = open < 0.15;
      dimBrain(1 - (1 - INTERIOR.dim) * open);
      placeLabels();
    },
  };
}
