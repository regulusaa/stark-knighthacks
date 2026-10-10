// Display entry point: builds the scene, loads the first image and runs the render loop.
// Debug query params (reproducible screenshots):
//   ?image=ID ?pulseAt=0..1|done ?heatmap=CLASSID ?focus=CLASSID ?t=SECONDS (freeze animation time) ?guides=1 ?stats=1
import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadManifest } from './assets.js';
import { createImagePanel } from './imagePanel.js';
import { createTrunk } from './trunk.js';
import { createCameraRig } from './cameraRig.js';
import { createApi } from './api.js';
import { mountHud } from './hudBridge.js';
import { attachInput } from './input.js';
import { layoutBrain } from './brainLayout.js';
import { createBrainMesh, VEINS } from './brainMesh.js';
import { createTips } from './tips.js';
import { createLabels } from './labels.js';
import { createFocus } from './focus.js';
import { attachPicking } from './picking.js';

export const BRAIN_VOLUME = { center: new THREE.Vector3(0, 8.5, 0), radius: 4.5 }; // filled by CC-4b

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('stage');
const { renderer, scene, camera, stats, tick, onContextLoss } = createScene(canvas);

const panel = createImagePanel();
const trunk = createTrunk();
scene.add(panel.group, trunk.mesh);
const rig = createCameraRig(camera);

// The Brain lives in a pivot at its centre so the whole mass can breathe (scale) about that point.
const brainPivot = new THREE.Group();
brainPivot.position.copy(BRAIN_VOLUME.center);
const brainRoot = new THREE.Group();
brainRoot.position.copy(BRAIN_VOLUME.center).negate();
brainPivot.add(brainRoot);
const veins = createBrainMesh();
const tips = createTips();
const labels = createLabels();
if (params.get('labelsAll') === '1') labels.nearDistance = 100; // test hook: make every label eligible
brainRoot.add(veins.group, tips.group, labels.group);
scene.add(brainPivot);

if (params.get('guides') === '1') {
  const guide = new THREE.Mesh(
    new THREE.SphereGeometry(BRAIN_VOLUME.radius, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x6b4c8a, wireframe: true, transparent: true, opacity: 0.25, fog: false }),
  );
  guide.position.copy(BRAIN_VOLUME.center);
  scene.add(guide);
}

const manifest = await loadManifest();
const api = createApi({ manifest, panel, trunk, rig });
const hud = await mountHud(document.getElementById('hud'), api);
attachInput(canvas, api, hud);

const focus = createFocus({ api, rig, panel, tips, labels });
api.attachFocus(focus);
attachPicking(canvas, camera, tips, { onTip: (id) => api.focusTip(id), onEmpty: () => api.clearFocus() });

api.onImageLoaded(() => {
  const a = api.assets;
  veins.dispose(); tips.dispose(); labels.dispose();
  if (!a?.tree) return;
  const layout = layoutBrain(a.tree);
  veins.build(layout);
  tips.build(layout, a.tree, a.gradcam);
  labels.build(tips.list);
  veins.resetReveal();
});
api.onPulseComplete(() => veins.startReveal());

// Exposed for CC-4b/CC-5 code in this lane and for test scripts.
window.__stark = { api, rig, trunk, panel, stats, renderer, scene, camera, hud, veins, tips, labels, focus };

let readyPending = true;
const clock = new THREE.Clock();
const frozenT = params.get('t') !== null ? Number(params.get('t')) : null;
let animTime = 0;
const viewSize = new THREE.Vector2();
const BREATHE = { amp: 0.012, period: VEINS.breathePeriod };
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1); // a stalled tab must not teleport animations
  animTime = frozenT ?? animTime + dt;
  tick(dt);
  rig.update(dt);
  trunk.update(dt);
  panel.update(dt);
  veins.update(animTime, dt);
  brainPivot.scale.setScalar(1 + BREATHE.amp * Math.sin((2 * Math.PI * animTime) / BREATHE.period));
  tips.setLit(veins.revealProgress);
  tips.update(camera);
  renderer.getSize(viewSize);
  labels.update(camera, viewSize.x, viewSize.y, dt * 1000);
  renderer.render(scene, camera);
  if (readyPending && api.state) {
    readyPending = false;
    requestAnimationFrame(() => { window.__starkReady = true; }); // after the first complete frame is presented
  }
}
renderer.setAnimationLoop(frame);
onContextLoss(
  () => renderer.setAnimationLoop(null),
  () => { clock.getDelta(); renderer.setAnimationLoop(frame); },
);

if (params.get('stats') === '1') {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:12px;bottom:10px;font:14px ui-monospace,monospace;color:#9d8bb3;z-index:9';
  document.body.appendChild(el);
  setInterval(() => { el.textContent = `${stats.fps.toFixed(0)} fps · ${stats.pixelRatio}x`; }, 500);
}

const first = manifest.find((m) => m.id === params.get('image')) ?? manifest[0];
if (first) {
  const pulseAt = params.get('pulseAt');
  await api.loadImage(first.id, { autoplay: pulseAt === null });
  if (pulseAt === 'done' || Number(pulseAt) >= 1) api.jumpToEnd();
  else if (pulseAt !== null) trunk.freezeAt(Math.min(1, Math.max(0, Number(pulseAt) || 0)));
  if (frozenT !== null || pulseAt === 'done' || Number(pulseAt) >= 1) veins.setRevealed();
  const heat = params.get('heatmap');
  if (heat !== null) await api.showHeatmap(Number(heat), { instant: true });
  const focusId = params.get('focus');
  if (focusId !== null) api.focusTip(Number(focusId));
} else {
  console.warn('[stark] no gallery images in the manifest');
  panel.setCrop(null);
  window.__starkReady = true;
}
