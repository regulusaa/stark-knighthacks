// The Brain's veins (master plan 6.4): one tube per tree edge, all sharing one ShaderMaterial.
// Per-edge data rides in vertex attributes, so time, reveal and breathing are uniforms on that one material.
import * as THREE from 'three';
import { INFERNO_GLSL, infernoTexture } from './inferno.js';
import { BRAIN } from './brainLayout.js';

export const VEINS = {
  radiusBase: 0.02,
  radiusScale: 0.12,           // radius = base + scale · sqrt(value)
  tubularSegments: 40,
  radialSegments: 8,
  dim: 0.07,                   // brightness before the reveal
  colorFloor: 0.3,             // colour = inferno(floor + (1 - floor) · sqrt(value)); see the report
  highlightPeriod: 2.5,        // s: top-1 path highlight, root → leaf
  highlightWidth: 0.15,        // fraction of the top-1 path
  livingPeriod: 2.8,           // s: soft pulse leaf → root on every lit vein
  breathePeriod: 14,           // s: noise drift of the control points
  breatheAmp: 0.07,
  revealMs: 800,
  membraneLevel: 0.32,         // inferno level of the mass's faint outer membrane
  membraneOpacity: 0.55,
};

// The mass's outer membrane: a faint fresnel shell over the dome, so the Brain reads as one rounded body.
// Decoration only (it carries no data); it breathes with the same noise as the veins.
const membraneVertex = /* glsl */ `
uniform float uTime;
uniform float uBreatheFreq;
varying vec3 vNormal;
varying vec3 vView;
varying float vH;
#include <fog_pars_vertex>
float hash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
void main() {
  vH = normal.y;
  float n = noise(normal * 2.2 + vec3(0.0, uTime * uBreatheFreq, 0.0)) - 0.5;
  vec3 p = position + normal * n * 0.35;               // lumpy, organic outline
  vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;
const membraneFragment = /* glsl */ `
${INFERNO_GLSL}
uniform float uLevel;
uniform float uOpacity;
uniform float uReveal;
varying vec3 vNormal;
varying vec3 vView;
varying float vH;
#include <fog_pars_fragment>
void main() {
  float rim = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 3.0);
  float base = smoothstep(-0.25, 0.25, vH);            // fades out below the equator, into the stem
  float k = rim * base * uOpacity * (0.45 + 0.55 * uReveal);
  gl_FragColor = vec4(inferno(uLevel) * k, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

const vertexShader = /* glsl */ `
uniform float uTime;
uniform float uBreatheFreq;
uniform float uBreatheAmp;
attribute vec4 aEdge;   // value, onTop1Path, depth, isOther
attribute vec2 aDist;   // start distance from the trunk top, edge length
varying vec4 vEdge;
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

void main() {
  vEdge = aEdge;
  vU = uv.x;
  vS = aDist.x + uv.x * aDist.y;
  // breathing: slow noise drift, zero at both ends so joints stay attached
  vec3 q = position * 0.35 + vec3(0.0, uTime * uBreatheFreq, uTime * uBreatheFreq * 0.7);
  vec3 drift = vec3(noise(q), noise(q + 17.3), noise(q + 41.9)) - 0.5;
  vec3 p = position + drift * 2.0 * uBreatheAmp * sin(3.14159265 * uv.x);
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
varying vec4 vEdge;
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

  float bright = onPath > 0.5 ? 1.0 : 0.25 + 0.35 * value;
  float level = mix(uDim, bright, lit);

  // tissue look: translucent core, brighter silhouette
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 1.6);
  float body = 0.35 + 1.0 * rim;

  vec3 base = isOther > 0.5 ? vec3(0.32, 0.30, 0.34) : inferno(uColorFloor + (1.0 - uColorFloor) * sqrt(value));
  vec3 col = base * level * body;

  // top-1 highlight: a band 15% of the path long, root → leaf, looping
  if (onPath > 0.5) {
    float head = fract(uTime / uHiPeriod) * (1.0 + uHiWidth) - uHiWidth * 0.5;
    float s = vS / uPathLen;
    float band = 1.0 - smoothstep(0.0, uHiWidth * 0.5, abs(s - head));
    col += inferno(1.0) * band * lit * (0.6 + 0.6 * rim);
  }
  // living pulse: softer, slower, leaf → root, on every lit vein
  float headD = (1.0 - fract(uTime / uLivePeriod)) * (uMaxDist + 1.0);
  float live = exp(-pow((vS - headD) / 0.45, 2.0));
  col += base * live * lit * 0.55;

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
  }]);
  uniforms.uInferno.value = infernoTexture;
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, fog: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  });

  const membraneUniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uInferno: { value: null }, uTime: uniforms.uTime, uBreatheFreq: uniforms.uBreatheFreq,
    uLevel: { value: VEINS.membraneLevel }, uOpacity: { value: VEINS.membraneOpacity }, uReveal: { value: 0 },
  }]);
  membraneUniforms.uInferno.value = infernoTexture;
  membraneUniforms.uTime = uniforms.uTime;          // share the same uniform objects
  membraneUniforms.uReveal = uniforms.uReveal;
  const membrane = new THREE.Mesh(
    new THREE.SphereGeometry(BRAIN.radius * 1.04, 64, 40, 0, Math.PI * 2, 0, Math.PI * 0.62),
    new THREE.ShaderMaterial({
      uniforms: membraneUniforms, vertexShader: membraneVertex, fragmentShader: membraneFragment, fog: true,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
    }),
  );
  membrane.position.set(BRAIN.center[0], BRAIN.center[1], BRAIN.center[2]);
  membrane.renderOrder = 0;
  group.add(membrane);

  let meshes = [];
  let reveal = null; // {t, ms} while animating
  const tmpPoints = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];

  function dispose() {
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); }
    meshes = [];
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
        e.points.forEach((p, i) => tmpPoints[i].set(p[0], p[1], p[2]));
        const curve = new THREE.CatmullRomCurve3(tmpPoints.map((v) => v.clone()), false, 'centripetal');
        const value = Math.max(0, Math.min(1, e.value));
        const geo = new THREE.TubeGeometry(curve, VEINS.tubularSegments, VEINS.radiusBase + VEINS.radiusScale * Math.sqrt(value),
          VEINS.radialSegments, false);
        const n = geo.attributes.position.count;
        const edgeAttr = new Float32Array(n * 4);
        const distAttr = new Float32Array(n * 2);
        for (let i = 0; i < n; i++) {
          edgeAttr.set([value, e.onTop1Path ? 1 : 0, e.depth, e.isOther ? 1 : 0], i * 4);
          distAttr.set([e.startDist, e.length], i * 2);
        }
        geo.setAttribute('aEdge', new THREE.BufferAttribute(edgeAttr, 4));
        geo.setAttribute('aDist', new THREE.BufferAttribute(distAttr, 2));
        const mesh = new THREE.Mesh(geo, material);
        mesh.renderOrder = e.onTop1Path ? 2 : 1;
        mesh.frustumCulled = false; // the breathing offset happens in the shader
        group.add(mesh);
        meshes.push(mesh);
      }
    },
    dispose,
    /** Dim, waiting for the pulse. */
    resetReveal() { reveal = null; uniforms.uReveal.value = 0; },
    startReveal() { reveal = { t: 0, ms: VEINS.revealMs }; },
    setRevealed() { reveal = null; uniforms.uReveal.value = 1; },
    get revealProgress() { return uniforms.uReveal.value; },
    update(time, dt) {
      uniforms.uTime.value = time;
      if (reveal) {
        reveal.t += dt * 1000;
        uniforms.uReveal.value = Math.min(1, reveal.t / reveal.ms);
        if (reveal.t >= reveal.ms) reveal = null;
      }
    },
  };
}

export { BRAIN };
