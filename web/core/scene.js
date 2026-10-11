// Renderer, scene, camera and frame stats. Owns the pixel-ratio governor and WebGL context-loss recovery.
import { DISPLAY } from './flags.js';
import * as THREE from 'three';

export const BACKGROUND = 0x050505;
export const FOG_DENSITY = 0.022;

/**
 * Dispose materials/textures of a Brain that was just replaced, but only after the new one has rendered: three.js
 * deletes a shader program when its last material is disposed, so disposing first made every image switch
 * recompile the tip, halo and label shaders (15–27 ms on the M1, a dropped frame right as the pulse starts).
 */
export function retireLater(disposables, ms = 1000) {
  if (disposables.length) setTimeout(() => { for (const d of disposables) d.dispose(); }, ms);
}
const MAX_PIXEL_RATIO = DISPLAY.maxPixelRatio;   // flags.js (default 1.5, ?pr= overrides)
const LOW_FPS = 45;
const LOW_FPS_SECONDS = 2;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(BACKGROUND, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.FogExp2(BACKGROUND, FOG_DENSITY);

  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 200);

  // fps: frames counted over 0.5 s windows; the governor drops to pixel ratio 1 after 2 s below 45 fps.
  const stats = { fps: 0, frameMs: 0, pixelRatio: renderer.getPixelRatio(), contextLost: false };
  let windowFrames = 0;
  let windowTime = 0;
  let lowFor = 0;

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  function tick(dt) {
    stats.frameMs = dt * 1000;
    windowFrames += 1;
    windowTime += dt;
    if (windowTime >= 0.5) {
      stats.fps = windowFrames / windowTime;
      lowFor = stats.fps < LOW_FPS ? lowFor + windowTime : 0;
      windowFrames = 0;
      windowTime = 0;
      if (lowFor >= LOW_FPS_SECONDS && renderer.getPixelRatio() > 1) {
        renderer.setPixelRatio(1);
        stats.pixelRatio = 1;
        resize();
        console.info('[stark] fps below 45 for 2 s: pixel ratio lowered to 1.0');
      }
    }
  }

  // Context loss: stop drawing, then let three re-create GPU resources on restore (it re-uploads lazily).
  function onContextLoss(onLost, onRestored) {
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      stats.contextLost = true;
      console.warn('[stark] WebGL context lost; waiting for restore');
      onLost();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      stats.contextLost = false;
      console.info('[stark] WebGL context restored');
      onRestored();
    });
  }

  return { renderer, scene, camera, stats, tick, resize, onContextLoss };
}
