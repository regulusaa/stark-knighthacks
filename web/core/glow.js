// Selective glow (master plan section 6.4, contract v3): bloom on the strands, the tips and the forward-pass pulse
// only (never the labels, the image panel or the tissue). Glowing objects also sit on GLOW.layer; each frame that layer
// alone is rendered into a smaller target and blurred (UnrealBloomPass), and the result is added over the normal
// render with one full-screen quad. The scene itself still renders straight to the canvas, so the translucent tissue
// blends exactly as it does without glow (a composer would blend it in linear space and wash it out). The threshold
// keeps the glow to what is already bright: the lit strand, the confident veins and tips, the pulse.
// Off, the display renders exactly as before (no extra passes). It turns itself off if the frame rate stays under
// GLOW.lowFps for GLOW.lowSeconds (capabilities.bloom false, a console note); the host (set-mode bloom) or key B
// turns it back on.
import { KILL, DISPLAY } from './flags.js';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

export const GLOW = {
  layer: 1,
  threshold: 0.7,         // linear luminance a glowing pixel must exceed: the lit strand, top tips, the pulse
  strength: 0.6,
  radius: 0.35,
  bloomScale: 0.5,        // the bloom layer renders at this fraction of the canvas resolution
  lowFps: 45,
  lowSeconds: 3,
};

const addShader = {
  vertexShader: /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
uniform sampler2D tBloom;
varying vec2 vUv;
void main() {
  gl_FragColor = vec4(texture2D(tBloom, vUv).rgb, 1.0);
  #include <colorspace_fragment>
}`,
};

/** Put an object (not its children) on the glow layer as well as its usual one. */
export const glowing = (obj) => { obj.layers.enable(GLOW.layer); return obj; };

export function createGlow({ renderer, scene, camera, stats, api }) {
  let on = DISPLAY.bloom;
  let auto = true;           // false once it turned itself off for fps (until the host turns it back on)
  let lowFor = 0;
  const size = new THREE.Vector2();
  let built = null;          // made on first use

  function build() {
    const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    composer.renderToScreen = false;
    const layerPass = new RenderPass(scene, camera);
    layerPass.clearColor = new THREE.Color(0, 0, 0);
    layerPass.clearAlpha = 1;
    composer.addPass(layerPass);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), GLOW.strength, GLOW.radius, GLOW.threshold);
    composer.addPass(bloom);
    // the bloom added over the canvas
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      ...addShader, uniforms: { tBloom: { value: null } },
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, transparent: true,
    }));
    quad.frustumCulled = false;
    const overlay = new THREE.Scene();
    overlay.add(quad);
    built = { composer, bloom, quad, overlay, ortho: new THREE.Camera(), w: 0, h: 0, pr: 0 };
  }

  function fit() {
    const pr = renderer.getPixelRatio();
    renderer.getSize(size);
    if (size.x === built.w && size.y === built.h && pr === built.pr) return;
    built.w = size.x; built.h = size.y; built.pr = pr;
    built.composer.setPixelRatio(pr * GLOW.bloomScale);
    built.composer.setSize(size.x, size.y);
  }

  function set(next, { manual = true } = {}) {
    on = next && !KILL.bloom;
    if (manual && next) { auto = true; lowFor = 0; }
    api.patchState({ bloom: on }, { capabilities: { bloom: auto } });
  }
  api.onBloom((v) => set(v));
  api.onImageLoaded(() => api.patchState({ bloom: on }, { capabilities: { bloom: auto } }));

  return {
    /** The bloom pass (for tuning), once built. */
    get bloom() { return built?.bloom ?? null; },
    get on() { return on; },
    get auto() { return auto; },
    set,
    /** Render a frame (with or without glow). */
    render(dt) {
      // fps watchdog (stats.fps is measured over 0.5 s windows)
      if (on) {
        lowFor = stats.fps > 0 && stats.fps < GLOW.lowFps ? lowFor + dt : 0;
        if (lowFor >= GLOW.lowSeconds) {
          auto = false;
          lowFor = 0;
          console.info(`[stark] fps below ${GLOW.lowFps} for ${GLOW.lowSeconds} s: glow turned off (the host can turn it back on)`);
          set(false, { manual: false });
        }
      }
      renderer.render(scene, camera);
      if (!on) return;
      if (!built) build();
      fit();
      // the glowing layer alone, blurred
      const mask = camera.layers.mask;
      const bg = scene.background;
      camera.layers.set(GLOW.layer);
      scene.background = null;
      built.composer.render(dt);
      camera.layers.mask = mask;
      scene.background = bg;
      // added over the frame on the canvas
      renderer.setRenderTarget(null);
      // the blur alone (UnrealBloomPass composites its mips here before adding them to the layer render)
      built.quad.material.uniforms.tBloom.value = built.bloom.renderTargetsHorizontal[0].texture;
      const autoClear = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(built.overlay, built.ortho);
      renderer.autoClear = autoClear;
    },
  };
}
