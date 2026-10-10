// The Brain's veins (master plan 6.4): one tube per tree edge, all sharing one ShaderMaterial.
// Per-edge data rides in vertex attributes, so time, reveal and breathing are uniforms on that one material.
// Each tube is drawn twice: normally, and again where tissue hides it (depth test inverted), faintly for ordinary
// veins and strongly for the top-1 and focused paths, so the chosen path is never lost inside the brain.
// Steer (contract v2): setValues() retargets each edge's value and the lit path. Values follow a critically damped
// spring and the lit path crossfades; the vertex shader pushes the tube wall along its normal by the change in
// radius, so no geometry is ever rebuilt.
import * as THREE from 'three';
import { INFERNO_GLSL, infernoTexture } from './inferno.js';
import { veinRadius, BRAIN } from './brainLayout.js';

export const VEINS = {
  segmentsPerUnit: 14,         // tube segments per world unit of edge length (min 12)
  radialSegments: 8,
  dim: 0.07,                   // brightness before the reveal
  colorFloor: 0.3,             // colour = inferno(floor + (1 - floor) · sqrt(value)); see the report
  highlightPeriod: 2.5,        // s: top-1 path highlight, root → leaf
  highlightWidth: 0.15,        // fraction of the top-1 path
  livingPeriod: 2.8,           // s: soft pulse leaf → root on every lit vein
  breathePeriod: 14,           // s: noise drift of the control points
  breatheAmp: 0.035,           // (veins draped over the cortex must not sink into it)
  revealMs: 800,
  springOmega: 23,             // rad/s: a critically damped spring settles (within 1%) in about 250 ms
  litFadeMs: 300,              // the lit path crossfades to a new answer over this long
  hiddenPath: 0.5,             // brightness of the top-1 / focused path where tissue hides it
  hiddenThin: 0.5,             // … drawn at this fraction less than its radius
  hiddenOther: 0.07,           // … and of every other vein (faint vessels under the cortex)
};

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uBreatheFreq;
uniform float uBreatheAmp;
uniform float uHidden;
uniform float uHiddenThin;
uniform float uRadiusBase;
uniform float uRadiusScale;
attribute vec4 aEdge;   // built value, onTop1Path, depth, isOther
attribute vec2 aLive;   // live value (Steer), live lit weight (0..1)
attribute vec2 aDist;   // start distance from the trunk top, edge length
attribute float aFocus; // 1 on the focused tip's path
varying vec4 vEdge;
varying float vFocus;
varying float vS;
varying float vU;
varying vec3 vNormal;
varying vec3 vView;
#include <fog_pars_vertex>

float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}

float veinRadius(float v) { return uRadiusBase + uRadiusScale * sqrt(clamp(v, 0.0, 1.0)); }

void main() {
  vEdge = vec4(aLive.x, aLive.y, aEdge.z, aEdge.w);
  vFocus = aFocus;
  vU = uv.x;
  vS = aDist.x + uv.x * aDist.y;
  // breathing: slow noise drift, zero at both ends so joints stay attached
  vec3 q = position * 0.35 + vec3(0.0, uTime * uBreatheFreq, uTime * uBreatheFreq * 0.7);
  vec3 drift = vec3(noise(q), noise(q + 17.3), noise(q + 41.9)) - 0.5;
  vec3 p = position + drift * 2.0 * uBreatheAmp * sin(3.14159265 * uv.x);
  // live value: the tube was built at radius veinRadius(aEdge.x); grow or shrink it along the (radial) normal
  p += normal * (veinRadius(aLive.x) - veinRadius(aEdge.x));
  // behind tissue the vessel is drawn thinner: pull the tube wall toward its centre line (normal = radial here)
  if (uHidden > 0.5) p -= normal * veinRadius(aLive.x) * uHiddenThin;
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
${INFERNO_GLSL}
uniform float uTime;
uniform float uReveal;        // 0..1
uniform float uMaxDepth;
uniform float uDim;
uniform float uColorFloor;
uniform float uPathLen;
uniform float uMaxDist;
uniform float uHiPeriod;
uniform float uHiWidth;
uniform float uLivePeriod;
uniform float uHidden;        // 0: normal pass; 1: the pass behind tissue
uniform float uHiddenPath;
uniform float uHiddenOther;
varying vec4 vEdge;
varying float vFocus;
varying float vS;
varying float vU;
varying vec3 vNormal;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  float value = vEdge.x;
  float onPath = vEdge.y;
  float depth = vEdge.z;
  float isOther = vEdge.w;

  // reveal front sweeps root → leaves by depth (each edge fills from its parent end)
  float front = uReveal * (uMaxDepth + 1.0);
  float lit = clamp((front - (depth + vU * 0.999)) * 3.0, 0.0, 1.0);

  float chosen = max(onPath, vFocus);
  // onPath is a weight (0..1) so a new answer's path can crossfade in while the old one fades out
  float bright = mix(vFocus > 0.5 ? 0.85 : 0.25 + 0.35 * value, 1.0, onPath);
  float level = mix(uDim, bright, lit);

  // tissue look: translucent core, brighter silhouette
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 1.6);
  float body = 0.35 + 1.0 * rim;

  // "other" is grey, unless Steer pushed the answer outside the Brain: then its path is the lit one
  vec3 base = isOther > 0.5 ? mix(vec3(0.16, 0.15, 0.17), inferno(uColorFloor + (1.0 - uColorFloor) * sqrt(value)), onPath)
                            : inferno(uColorFloor + (1.0 - uColorFloor) * sqrt(value));
  vec3 col = base * level * body;

  // top-1 highlight: a band 15% of the path long, root → leaf, looping
  if (onPath > 0.0) {
    float head = fract(uTime / uHiPeriod) * (1.0 + uHiWidth) - uHiWidth * 0.5;
    float s = vS / uPathLen;
    float band = 1.0 - smoothstep(0.0, uHiWidth * 0.5, abs(s - head));
    col += inferno(1.0) * band * lit * onPath * (0.6 + 0.6 * rim);
  }
  // living pulse: softer, slower, leaf → root, on every lit vein
  float headD = (1.0 - fract(uTime / uLivePeriod)) * (uMaxDist + 1.0);
  float live = exp(-pow((vS - headD) / 0.45, 2.0));
  col += base * live * lit * 0.55;
  // behind tissue: the chosen path shows through strongly, everything else as faint vessels
  if (uHidden > 0.5) col *= isOther > 0.5 ? onPath * uHiddenPath : mix(uHiddenOther * (0.5 + value), uHiddenPath, chosen);

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createBrainMesh() {
  const group = new THREE.Group();
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uInferno: { value: null },
    uTime: { value: 0 },
    uReveal: { value: 0 },
    uMaxDepth: { value: 1 },
    uDim: { value: VEINS.dim },
    uColorFloor: { value: VEINS.colorFloor },
    uPathLen: { value: 1 },
    uMaxDist: { value: 1 },
    uHiPeriod: { value: VEINS.highlightPeriod },
    uHiWidth: { value: VEINS.highlightWidth },
    uLivePeriod: { value: VEINS.livingPeriod },
    uBreatheFreq: { value: 1 / VEINS.breathePeriod },
    uBreatheAmp: { value: VEINS.breatheAmp },
    uHidden: { value: 0 },
    uHiddenThin: { value: VEINS.hiddenThin },
    uHiddenPath: { value: VEINS.hiddenPath },
    uHiddenOther: { value: VEINS.hiddenOther },
    uRadiusBase: { value: BRAIN.veinRadiusBase },
    uRadiusScale: { value: BRAIN.veinRadiusScale },
  }]);
  uniforms.uInferno.value = infernoTexture;
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, fog: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  // the same veins where tissue is in front of them (shares every uniform object except uHidden)
  const hiddenMaterial = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uHidden: { value: 1 } }, vertexShader, fragmentShader, fog: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthFunc: THREE.GreaterDepth,
  });

  let meshes = [];      // [{edge, mesh, hidden, curve, live, v, vel, target, lit, litFrom, litTo}]
  let byTo = new Map(); // child node id → its entry
  let reveal = null;    // {t, ms} while animating
  let litFade = null;   // {t} while the lit path crossfades
  let litLeaf = null;   // node id of the lit (top-1) leaf
  let moving = false;   // any spring not yet at rest

  function dispose() {
    for (const m of meshes) { group.remove(m.mesh, m.hidden); m.mesh.geometry.dispose(); }
    meshes = [];
    byTo = new Map();
    litFade = null;
    litLeaf = null;
    moving = false;
  }

  function writeLive(m) {
    const a = m.live.array;
    if (a[0] === m.v && a[1] === m.lit) return;
    for (let i = 0; i < a.length; i += 2) { a[i] = m.v; a[i + 1] = m.lit; }
    m.live.needsUpdate = true;
  }

  /** The edges from the stem to a node, in order. */
  function pathTo(nodeId) {
    const chain = [];
    for (let e = byTo.get(nodeId); e; e = e.edge.from === null ? null : byTo.get(e.edge.from)) chain.unshift(e);
    return chain;
  }

  return {
    group,
    material,
    build(layout) {
      dispose();
      uniforms.uMaxDepth.value = layout.maxDepth;
      uniforms.uPathLen.value = layout.top1PathLength;
      uniforms.uMaxDist.value = layout.maxDist;
      for (const e of layout.edges) {
        const curve = new THREE.CatmullRomCurve3(e.points.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
        const value = Math.max(0, Math.min(1, e.value));
        const segments = Math.max(12, Math.round(e.length * VEINS.segmentsPerUnit));
        const geo = new THREE.TubeGeometry(curve, segments, veinRadius(value), VEINS.radialSegments, false);
        const n = geo.attributes.position.count;
        const edgeAttr = new Float32Array(n * 4);
        const distAttr = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          edgeAttr.set([value, e.onTop1Path ? 1 : 0, e.depth, e.isOther ? 1 : 0], i * 4);
          distAttr.set([e.startDist, e.length], i * 2);
        }
        geo.setAttribute('aEdge', new THREE.BufferAttribute(edgeAttr, 4));
        geo.setAttribute('aDist', new THREE.BufferAttribute(distAttr, 2));
        geo.setAttribute('aFocus', new THREE.BufferAttribute(new Float32Array(n), 1));
        const lit = e.onTop1Path ? 1 : 0;
        const live = new THREE.BufferAttribute(new Float32Array(n * 2), 2);
        live.setUsage(THREE.DynamicDrawUsage);
        for (let i = 0; i < n; i++) { live.array[i * 2] = value; live.array[i * 2 + 1] = lit; }
        geo.setAttribute('aLive', live);
        const mesh = new THREE.Mesh(geo, material);
        mesh.renderOrder = e.onTop1Path ? 2 : 1;
        mesh.frustumCulled = false; // the breathing offset happens in the shader
        const hidden = new THREE.Mesh(geo, hiddenMaterial);
        hidden.renderOrder = 1;
        hidden.frustumCulled = false;
        group.add(mesh, hidden);
        const entry = { edge: e, mesh, hidden, curve, live, v: value, vel: 0, target: value, lit, litFrom: lit, litTo: lit };
        meshes.push(entry);
        byTo.set(e.to, entry);
        if (e.onTop1Path && e.to !== null && !layout.edges.some((x) => x.from === e.to)) litLeaf = e.to;
      }
    },
    /**
     * Steer: new values per node id (an edge takes its child's value) and the leaf whose path is lit.
     * Positions and topology never change; values spring to their targets and the lit path crossfades.
     */
    setValues(values, leafId) {
      for (const m of meshes) {
        const v = values.get(m.edge.to);
        if (v !== undefined) m.target = Math.max(0, Math.min(1, v));
      }
      moving = true;
      if (leafId !== undefined && leafId !== litLeaf && byTo.has(leafId)) {
        litLeaf = leafId;
        const on = new Set(pathTo(leafId));
        for (const m of meshes) { m.litFrom = m.lit; m.litTo = on.has(m) ? 1 : 0; }
        uniforms.uPathLen.value = on.size ? [...on].reduce((a, m) => a + m.edge.length, 0) : uniforms.uPathLen.value;
        litFade = { t: 0 };
      }
    },
    /** Back to the values the Brain was built with (no Steer). */
    resetValues() {
      for (const m of meshes) m.target = Math.max(0, Math.min(1, m.edge.value));
      moving = true;
      const leaf = meshes.find((m) => m.edge.onTop1Path && !meshes.some((x) => x.edge.from === m.edge.to));
      if (leaf) this.setValues(new Map(), leaf.edge.to);
    },
    get litLeaf() { return litLeaf; },
    /** Current (animated) value of the edge into a node. */
    valueOf(nodeId) { return byTo.get(nodeId)?.v ?? null; },
    /** Mark the path to a node as focused (null clears). */
    setFocusPath(nodeId) {
      const on = new Set(nodeId === null ? [] : pathTo(nodeId));
      for (const m of meshes) {
        const a = m.mesh.geometry.attributes.aFocus;
        const v = on.has(m) ? 1 : 0;
        if (a.array[0] === v) continue;
        a.array.fill(v);
        a.needsUpdate = true;
      }
    },
    /** About `n` points spread along the path from the trunk top to a node (brain-root space). */
    pathPoints(nodeId, n = 40) {
      const chain = pathTo(nodeId);
      const total = chain.reduce((a, m) => a + m.edge.length, 0) || 1;
      const pts = [];
      for (const m of chain) {
        const k = Math.max(2, Math.round((m.edge.length / total) * n));
        for (let i = pts.length ? 1 : 0; i <= k; i++) pts.push(m.curve.getPointAt(i / k));
      }
      return pts.slice(0, n);
    },
    dispose,
    /** Dim, waiting for the pulse. */
    resetReveal() { reveal = null; uniforms.uReveal.value = 0; },
    startReveal() { reveal = { t: 0, ms: VEINS.revealMs }; },
    setRevealed() { reveal = null; uniforms.uReveal.value = 1; },
    get revealProgress() { return uniforms.uReveal.value; },
    update(time, dt) {
      uniforms.uTime.value = time;
      if (moving) {
        // critically damped spring per edge: x'' = −2ω x' − ω² (x − target), integrated in small substeps
        const w = VEINS.springOmega;
        const steps = Math.max(1, Math.ceil(dt / 0.008));
        const h = dt / steps;
        let still = true;
        for (const m of meshes) {
          for (let i = 0; i < steps; i++) {
            m.vel += (-2 * w * m.vel - w * w * (m.v - m.target)) * h;
            m.v += m.vel * h;
          }
          if (Math.abs(m.v - m.target) < 1e-4 && Math.abs(m.vel) < 1e-3) { m.v = m.target; m.vel = 0; } else still = false;
        }
        if (still) moving = false;
      }
      if (litFade) {
        litFade.t += dt * 1000;
        const k = Math.min(1, litFade.t / VEINS.litFadeMs);
        const e = k * k * (3 - 2 * k);
        for (const m of meshes) m.lit = m.litFrom + (m.litTo - m.litFrom) * e;
        if (k >= 1) litFade = null;
      }
      for (const m of meshes) writeLive(m);
      if (reveal) {
        reveal.t += dt * 1000;
        uniforms.uReveal.value = Math.min(1, reveal.t / reveal.ms);
        if (reveal.t >= reveal.ms) reveal = null;
      }
    },
  };
}
