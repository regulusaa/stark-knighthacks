// The image panel (master plan 6.1): the exact 224x224 model crop on a tilted plane, with a Grad-CAM heatmap
// coloured by the shared inferno ramp and blended over it. Heatmaps crossfade through two slots.
import * as THREE from 'three';
import { INFERNO_GLSL, infernoTexture } from './inferno.js';
import { RIG } from './cameraRig.js';

export const PANEL = {
  size: 3.8,           // secondary to the Brain, which is the subject
  position: new THREE.Vector3(-7.2, 6.9, 5.0),   // front-left of the brain, clear of the frontal and temporal lobes
  // parallel to the default camera's image plane, so the crop reads as an upright square photo
  heatAlpha: 0.55,
  fadeMs: 300,
  frameWidth: 0.028,   // ≈ 2 px at the default view on a 1080p screen
  frameOpacity: 0.3,
  frameColor: 0xe6eeff,
};

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
${INFERNO_GLSL}
uniform sampler2D uCrop;
uniform sampler2D uHeatA;
uniform sampler2D uHeatB;
uniform float uWeightA;
uniform float uWeightB;
uniform float uHeatAlpha;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(uCrop, vUv).rgb;
  col = mix(col, inferno(texture2D(uHeatA, vUv).r), uHeatAlpha * uWeightA);
  col = mix(col, inferno(texture2D(uHeatB, vUv).r), uHeatAlpha * uWeightB);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const BLANK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLANK.needsUpdate = true;

export function createImagePanel() {
  const group = new THREE.Group();
  group.position.copy(PANEL.position);
  group.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(RIG.defaultPosition, RIG.defaultTarget, new THREE.Vector3(0, 1, 0)));

  const uniforms = {
    uInferno: { value: infernoTexture },
    uCrop: { value: BLANK },
    uHeatA: { value: BLANK },
    uHeatB: { value: BLANK },
    uWeightA: { value: 0 },
    uWeightB: { value: 0 },
    uHeatAlpha: { value: PANEL.heatAlpha },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, fog: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(PANEL.size, PANEL.size), material);
  group.add(plane);

  // Frame: four thin quads just outside the image edge, so they never cover the crop.
  const frameMat = new THREE.MeshBasicMaterial({
    color: PANEL.frameColor, transparent: true, opacity: PANEL.frameOpacity, depthWrite: false, fog: false,
  });
  const s = PANEL.size / 2;
  const w = PANEL.frameWidth;
  for (const [x, y, sw, sh] of [[0, s + w / 2, 2 * s + 2 * w, w], [0, -s - w / 2, 2 * s + 2 * w, w],
    [s + w / 2, 0, w, 2 * s], [-s - w / 2, 0, w, 2 * s]]) {
    const q = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), frameMat);
    q.position.set(x, y, 0.001);
    group.add(q);
  }

  // Two heat slots. `active` is the slot showing (or fading in) the current heatmap.
  let active = 'A';
  let currentClass = null;
  let fade = null; // {from: {A, B}, to: {A, B}, t, ms}
  let token = 0;

  function startFade(toA, toB) {
    fade = { fromA: uniforms.uWeightA.value, fromB: uniforms.uWeightB.value, toA, toB, t: 0, ms: PANEL.fadeMs };
  }

  return {
    group,
    bounds: new THREE.Box3().setFromObject(plane),
    setCrop(texture) {
      uniforms.uCrop.value = texture || BLANK;
    },
    /** Show a heatmap texture (or null to clear) with a 300 ms crossfade. `instant` skips the fade. */
    setHeat(texture, classId, instant = false) {
      const my = ++token;
      if (!texture) {
        currentClass = null;
        if (instant) { uniforms.uWeightA.value = uniforms.uWeightB.value = 0; fade = null; }
        else startFade(0, 0);
        return my;
      }
      if (classId === currentClass) return my;
      currentClass = classId;
      active = active === 'A' ? 'B' : 'A';
      uniforms[active === 'A' ? 'uHeatA' : 'uHeatB'].value = texture;
      const toA = active === 'A' ? 1 : 0;
      if (instant) { uniforms.uWeightA.value = toA; uniforms.uWeightB.value = 1 - toA; fade = null; }
      else startFade(toA, 1 - toA);
      return my;
    },
    get heatClass() { return currentClass; },
    clear() {
      currentClass = null;
      fade = null;
      uniforms.uCrop.value = BLANK;
      uniforms.uHeatA.value = uniforms.uHeatB.value = BLANK;
      uniforms.uWeightA.value = uniforms.uWeightB.value = 0;
    },
    update(dt) {
      if (!fade) return;
      fade.t += dt * 1000;
      const k = Math.min(1, fade.t / fade.ms);
      uniforms.uWeightA.value = fade.fromA + (fade.toA - fade.fromA) * k;
      uniforms.uWeightB.value = fade.fromB + (fade.toB - fade.fromB) * k;
      if (k >= 1) fade = null;
    },
  };
}
