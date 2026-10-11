// The image panel (master plan 6.1): the exact 224x224 model crop on a tilted plane, with a Grad-CAM heatmap
// coloured by the shared inferno ramp and blended over it. Heatmaps crossfade through two slots.
// Steer (contract v2) writes live heatmaps into two 224×224 data textures (setLiveHeat), and a caption under the
// photo says where the map comes from.
import * as THREE from 'three';
import { INFERNO_GLSL, infernoTexture } from './inferno.js';
import { RIG } from './cameraRig.js';

/** How far the caption hangs below the photo's bottom edge (frame + gap + caption), for framing. */
export const panelExtentBelow = () => PANEL.frameWidth + PANEL.captionGap + PANEL.captionHeight;

export const PANEL = {
  size: 3.8,           // secondary to the Brain, which is the subject
  position: new THREE.Vector3(-7.2, 6.9, 5.0),   // front-left of the brain, clear of the frontal and temporal lobes
  // parallel to the default camera's image plane, so the crop reads as an upright square photo
  heatAlpha: 0.55,
  fadeMs: 300,
  noiseFadeMs: 300,     // (v3) photo ↔ amplified noise
  noiseCaption: 'The change, amplified 50×',
  frameWidth: 0.028,   // ≈ 2 px at the default view on a 1080p screen
  frameOpacity: 0.3,
  frameColor: 0xe6eeff,
  captionHeight: 0.24,  // world units
  captionGap: 0.12,
  captionFontPx: 44,
  captionColor: '#d9cbe8',
};

function captionTexture(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `500 ${PANEL.captionFontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font;
  const pad = 18;
  c.width = Math.ceil(g.measureText(text).width) + pad * 2;
  c.height = Math.ceil(PANEL.captionFontPx * 1.4);
  g.font = font;
  g.fillStyle = 'rgba(5, 2, 8, 0.55)';
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, c.height / 2);
  g.fill();
  g.fillStyle = PANEL.captionColor;
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2 + 1);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, aspect: c.width / c.height };
}

const LIVE = 224;
function liveTexture() {
  const tex = new THREE.DataTexture(new Uint8Array(LIVE * LIVE), LIVE, LIVE, THREE.RedFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
/** Model-crop rows run top to bottom; a data texture's first row is the bottom (v = 0). */
function copyFlipped(src, tex) {
  const dst = tex.image.data;
  for (let y = 0; y < LIVE; y++) dst.set(src.subarray(y * LIVE, (y + 1) * LIVE), (LIVE - 1 - y) * LIVE);
  tex.needsUpdate = true;
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
${INFERNO_GLSL}
uniform sampler2D uCrop;
uniform sampler2D uNoise;     // (v3) the adversarial change, amplified
uniform float uNoiseMix;
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
  col = mix(col, texture2D(uNoise, vUv).rgb, uNoiseMix);   // the noise replaces the photo (and its heatmap)
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
    uNoise: { value: BLANK },
    uNoiseMix: { value: 0 },
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
    q.renderOrder = 20;   // after the translucent tissue, which would otherwise paint over it
    group.add(q);
  }

  // Caption under the photo: one quad, its texture cached per text. What shows: the noise view's caption, else a
  // passing one (Steer's live map, a probe), else the image's own (v3: the adversarial image's change budget).
  const captionMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false });
  const caption = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), captionMat);
  caption.position.set(0, -s - w - PANEL.captionGap - PANEL.captionHeight / 2, 0.002);
  caption.visible = false;
  caption.renderOrder = 20;
  group.add(caption);
  const captions = new Map();
  let captionText = null;
  let passing = null;
  let base = null;
  let noiseOn = false;
  let noiseFade = null;   // {from, to, t}

  const live = [liveTexture(), liveTexture()];
  let liveKey = null;

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
    /** Where the panel sits for this viewport (framing.js): world position and uniform scale. */
    setPlacement(position, scale = 1) {
      group.position.fromArray(position);
      group.scale.setScalar(scale);
      group.updateMatrixWorld(true);
    },
    get heatClass() { return currentClass; },
    /**
     * A live heatmap (224×224 uint8, rows top to bottom) under `key` (e.g. "cam:207", "probe:31"). The same key
     * updates the map in place; a new key crossfades to it. null clears the overlay.
     */
    setLiveHeat(data, key, instant = false) {
      if (!data) { liveKey = null; return this.setHeat(null, null, instant); }
      const shown = uniforms[active === 'A' ? 'uHeatA' : 'uHeatB'].value;
      if (key === liveKey && currentClass === key && live.includes(shown)) { copyFlipped(data, shown); return token; }
      const tex = shown === live[0] ? live[1] : live[0];
      copyFlipped(data, tex);
      liveKey = key;
      return this.setHeat(tex, key, instant);
    },
    get liveKey() { return currentClass === liveKey ? liveKey : null; },
    /** A passing caption under the photo (Steer), or null to fall back to the image's own. */
    setCaption(text) {
      passing = text ?? null;
      showCaption();
    },
    /** (v3) The image's own caption, shown whenever nothing else is. */
    setBaseCaption(text) {
      base = text ?? null;
      showCaption();
    },
    /** (v3) The noise texture for this image (null: none). */
    setNoise(texture) {
      uniforms.uNoise.value = texture || BLANK;
    },
    /** (v3) Show the noise instead of the photo, crossfading over PANEL.noiseFadeMs; `instant` skips the fade. */
    setNoiseView(on, { instant = false } = {}) {
      noiseOn = Boolean(on);
      const to = noiseOn ? 1 : 0;
      if (instant) { uniforms.uNoiseMix.value = to; noiseFade = null; } else noiseFade = { from: uniforms.uNoiseMix.value, to, t: 0 };
      showCaption();
    },
    get noiseView() { return noiseOn; },
    get noiseMix() { return uniforms.uNoiseMix.value; },
    get caption() { return captionText; },
    clear() {
      currentClass = null;
      liveKey = null;
      fade = null;
      passing = base = null;
      noiseOn = false;
      noiseFade = null;
      uniforms.uNoiseMix.value = 0;
      uniforms.uNoise.value = BLANK;
      showCaption();
      uniforms.uCrop.value = BLANK;
      uniforms.uHeatA.value = uniforms.uHeatB.value = BLANK;
      uniforms.uWeightA.value = uniforms.uWeightB.value = 0;
    },
    update(dt) {
      if (noiseFade) {
        noiseFade.t += dt * 1000;
        const k = Math.min(1, noiseFade.t / PANEL.noiseFadeMs);
        uniforms.uNoiseMix.value = noiseFade.from + (noiseFade.to - noiseFade.from) * k * k * (3 - 2 * k);
        if (k >= 1) noiseFade = null;
      }
      if (!fade) return;
      fade.t += dt * 1000;
      const k = Math.min(1, fade.t / fade.ms);
      uniforms.uWeightA.value = fade.fromA + (fade.toA - fade.fromA) * k;
      uniforms.uWeightB.value = fade.fromB + (fade.toB - fade.fromB) * k;
      if (k >= 1) fade = null;
    },
  };

  function showCaption() {
    const text = noiseOn ? PANEL.noiseCaption : passing ?? base;
    if (text === captionText) return;
    captionText = text;
    caption.visible = Boolean(text);
    if (!text) return;
    if (!captions.has(text)) captions.set(text, captionTexture(text));
    const { tex, aspect } = captions.get(text);
    captionMat.map = tex;
    captionMat.needsUpdate = true;
    caption.scale.set(PANEL.captionHeight * aspect, PANEL.captionHeight, 1);
  }
}
