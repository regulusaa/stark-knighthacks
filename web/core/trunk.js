// The trunk (master plan 6.3): a glowing column for the forward pass, with a pulse that climbs it layer by
// layer over 49 × MS_PER_LAYER / speed. CC-4b listens for the pulse reaching the top.
// It is the core of the spinal cord: it runs inside the translucent cord from the cord's faded bottom up to where the
// Brain's stem path starts (BRAIN.trunkTop), and fades out at the bottom with it.
import * as THREE from 'three';
import { DEFAULTS } from '/contract/contract.js';
import { INFERNO_GLSL, infernoTexture } from './inferno.js';
import { ANATOMY, STEM_BOTTOM_Y } from './brainShape.js';

const TOP = 6;   // BRAIN.trunkTop[1]

export const TRUNK = {
  base: STEM_BOTTOM_Y,
  height: TOP - STEM_BOTTOM_Y,
  radius: 0.16,
  fade: ANATOMY.stemFade,
  layers: 49,
  baseLevel: 0.12,   // inferno(0.12): dim resting glow
  litLevel: 0.2,     // layers the pulse has passed stay a little brighter
  bandHeight: 0.6,
  speeds: [0.5, 1, 2],
};

const vertexShader = /* glsl */ `
varying float vY;
varying vec3 vNormal;
varying vec3 vView;
#include <fog_pars_vertex>
void main() {
  vY = position.y;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vView = normalize(-mvPosition.xyz);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const fragmentShader = /* glsl */ `
${INFERNO_GLSL}
uniform float uHeight;
uniform float uLayers;
uniform float uPulseY;      // band centre; below 0 = not started
uniform float uBandHalf;
uniform float uBase;
uniform float uLit;
uniform float uFade;
varying float vY;
varying vec3 vNormal;
varying vec3 vView;
#include <fog_pars_fragment>
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vView)));
  float rim = pow(1.0 - facing, 2.0);
  float f = fract(vY / uHeight * uLayers);
  float ring = 1.0 - smoothstep(0.0, 0.08, min(f, 1.0 - f));
  float passed = step(vY, uPulseY);
  float level = mix(uBase, uLit, passed) + ring * 0.05;
  float d = abs(vY - uPulseY) / uBandHalf;
  float band = 1.0 - smoothstep(0.0, 1.0, d);          // soft falloff, 0 beyond half the band height
  band *= band;
  // hollow glowing tube: faint through the middle, brighter at the silhouette
  vec3 col = vec3(level * .5) * (0.22 + 1.4 * rim) + vec3(1.0) * band * (0.75 + 0.5 * rim);
  col *= smoothstep(0.0, uFade, vY);                   // fades out with the bottom of the cord
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export function createTrunk() {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
    uInferno: { value: null },
    uHeight: { value: TRUNK.height },
    uLayers: { value: TRUNK.layers },
    uPulseY: { value: -1 },
    uBandHalf: { value: TRUNK.bandHeight / 2 },
    uBase: { value: TRUNK.baseLevel },
    uLit: { value: TRUNK.baseLevel },
    uFade: { value: TRUNK.fade },
  }]);
  uniforms.uInferno.value = infernoTexture; // merge() clones textures; keep the one shared instance
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader, fog: true,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const geometry = new THREE.CylinderGeometry(TRUNK.radius, TRUNK.radius, TRUNK.height, 48, 98, true);
  geometry.translate(0, TRUNK.height / 2, 0);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = TRUNK.base;
  mesh.renderOrder = 1;   // before the tissue (brainTissue.js TISSUE.order), which it shows through

  const listeners = new Set();
  const state = { phase: 'idle', progress: 0, speed: 1, frozen: false };
  const durationS = () => (TRUNK.layers * DEFAULTS.MS_PER_LAYER) / 1000 / state.speed;

  function apply() {
    const p = state.progress;
    uniforms.uPulseY.value = state.phase === 'idle' ? -1 : state.phase === 'done' ? TRUNK.height + 1 : p * TRUNK.height;
    uniforms.uLit.value = state.phase === 'idle' ? TRUNK.baseLevel : TRUNK.litLevel;
  }
  function complete() {
    state.phase = 'done';
    state.progress = 1;
    apply();
    for (const cb of listeners) cb();
  }

  apply();
  return {
    mesh,
    state,
    bounds: new THREE.Box3(new THREE.Vector3(-TRUNK.radius, TRUNK.base, -TRUNK.radius),
      new THREE.Vector3(TRUNK.radius, TOP, TRUNK.radius)),
    get durationMs() { return durationS() * 1000; },
    onComplete(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    play() { state.phase = 'playing'; state.progress = 0; state.frozen = false; apply(); },
    reset() { state.phase = 'idle'; state.progress = 0; state.frozen = false; apply(); },
    jumpToEnd() { if (state.phase !== 'done') complete(); },
    setSpeed(s) { state.speed = s; },
    /** Debug/screenshots: hold the pulse at a fraction of the climb. */
    freezeAt(p) { state.phase = 'playing'; state.progress = p; state.frozen = true; apply(); },
    update(dt) {
      if (state.phase !== 'playing' || state.frozen) return;
      state.progress += dt / durationS();
      if (state.progress >= 1) complete();
      else apply();
    },
  };
}
