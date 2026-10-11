// Display entry point: builds the scene, loads the first image and runs the render loop.
// Debug query params (reproducible screenshots):
//   ?image=ID ?pulseAt=0..1|done ?heatmap=CLASSID ?focus=CLASSID ?t=SECONDS (freeze animation time) ?guides=1 ?stats=1
//   ?view=front|side|back|top|threeq (fixed camera around the brain)
import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadManifest } from './assets.js';
import { preloadAll, preloadProgress } from './preload.js';
import { createImagePanel, PANEL, panelExtentBelow } from './imagePanel.js';
import { createTrunk } from './trunk.js';
import { createCameraRig, RIG } from './cameraRig.js';
import { frameFor } from './framing.js';
import { createApi } from './api.js';
import { mountHud } from './hudBridge.js';
import { attachInput } from './input.js';
import { layoutBrain } from './brainLayout.js';
import { createBrainMesh, VEINS } from './brainMesh.js';
import { createTissue, createTissueLights } from './brainTissue.js';
import { createFibers } from './brainFibers.js';
import { ANATOMY, BOUNDS, STEM_FRAME_Y, occluded } from './brainShape.js';
import { createTips } from './tips.js';
import { createLabels } from './labels.js';
import { createFocus } from './focus.js';
import { attachPicking } from './picking.js';
import { connectRelay } from './net.js';
import { linkSteer } from './steer/link.js';
import { createStability } from './stability.js';
import { createAdversarial } from './adversarial.js';
import { createMedical } from './medical.js';
import { createGlow, glowing } from './glow.js';
import { createTrunkInterior } from './trunkInterior.js';
import { createPerf } from './perf.js';

// The anatomy's bounding box; the whole Brain breathes about the cerebrum's centre.
export const BRAIN_VOLUME = {
  box: new THREE.Box3(new THREE.Vector3(...BOUNDS.min), new THREE.Vector3(...BOUNDS.max)),
  center: new THREE.Vector3(...ANATOMY.origin),
};

const params = new URLSearchParams(location.search);
const tissueReady = createTissue();     // ~1 s of geometry in a worker, while the rest loads
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
// a tip is hidden when tissue lies between it and the camera (both in brain-root space)
const eyeLocal = new THREE.Vector3();
const eyeArr = [0, 0, 0];
const tipArr = [0, 0, 0];
function tipHidden(classId) {
  const t = tips.get(classId);
  if (!t) return true;
  brainRoot.worldToLocal(eyeLocal.copy(camera.position)).toArray(eyeArr);
  return occluded(eyeArr, t.pos.toArray(tipArr));
}
const labels = createLabels({ isHidden: tipHidden });
if (params.get('labelsAll') === '1') labels.nearDistance = 100; // test hook: make every label eligible
// decorative nerves off the spinal cord (never data, never pickable)
const fibers = createFibers();
brainRoot.add(veins.group, tips.group, labels.group, fibers.mesh);
scene.add(brainPivot, createTissueLights(BRAIN_VOLUME.center));

if (params.get('guides') === '1') scene.add(new THREE.Box3Helper(BRAIN_VOLUME.box, 0x6b4c8a));

const manifest = await loadManifest();
// every gallery image's files into memory now, so no image switch waits on the network during the demo
{
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:16px;bottom:12px;font:14px ui-monospace,monospace;color:#9d8bb3;z-index:40;pointer-events:none';
  document.body.appendChild(el);
  preloadAll(manifest, {
    onProgress: (p) => { el.textContent = `Loading demo files ${p.done}/${p.total} · ${(p.bytes / 1e6).toFixed(1)} MB${p.failed ? ` · ${p.failed} failed` : ''}`; },
  }).then((p) => setTimeout(() => el.remove(), p.failed ? 8000 : 1200));
}
const api = createApi({ manifest, panel, trunk, rig });
let relay = null; // net.js, connected last
// the room comes from the relay once registered; until then the HUD shows none
const hud = await mountHud(document.getElementById('hud'), api, { getRoom: () => relay?.room ?? api.state?.room ?? null });
const steerKeys = { zeroFlip: () => steer?.zeroFlip(), zeroTop1: () => steer?.zeroTop1(), reset: () => steer?.reset() };
attachInput(canvas, api, hud, steerKeys);

const tissue = await tissueReady;
brainRoot.add(tissue.mesh);

// Framing (framing.js): the default view and the photo's place follow the viewport, on load, on resize and on Reset.
// The Brain's extent is a subsample of its tissue vertices (brain-root space is world space at rest), split into the
// brain itself and the brainstem and cord below the cerebellum, which hang down beside the photo.
const framePoints = [];
const stemPoints = [];
{
  const pos = tissue.mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 23) (pos.getY(i) < STEM_FRAME_Y ? stemPoints : framePoints).push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  // The visible assembly also includes the complete forward-pass column and nerve roots.
  // Fitting tissue alone cut these off at the bottom of the default/fullscreen view.
  for (const geometry of [trunk.mesh.geometry, fibers.mesh.geometry]) {
    const p = geometry.attributes.position;
    for (let i = 0; i < p.count; i += 7) stemPoints.push([p.getX(i), p.getY(i), p.getZ(i)]);
  }
}
let framing = null;
function applyFraming() {
  framing = frameFor(camera.aspect, {
    brainPoints: framePoints,
    stemPoints,
    panel: { size: PANEL.size, extentBelow: panelExtentBelow(), position: PANEL.position.toArray() },
    authored: { position: RIG.defaultPosition.toArray(), target: RIG.defaultTarget.toArray(), fov: RIG.fov },
  });
  panel.setPlacement(framing.panel.position, framing.panel.scale);
  rig.setDefault(framing);
}
applyFraming();
window.addEventListener('resize', applyFraming); // after scene.js's own resize handler has set the aspect

// the focused tip's path lights up in the veins and glows through the tissue above it
function highlight(classId) {
  const id = classId === null ? null : tips.get(classId)?.node.id ?? null;
  veins.setFocusPath(id);
  tissue.setFocusPath(id === null ? null : veins.pathPoints(id));
}
const focus = createFocus({ api, rig, panel, tips, labels, highlight });
api.attachFocus(focus);
// a click on a fibre tract selects its leaf (an inner tract: the best-scoring leaf beneath it)
function pickTrack(x, y, w, h) {
  const leaf = veins.pickTrack(x, y, camera, w, h);
  return leaf === null ? null : tips.list.find((t) => t.node.id === leaf && !t.isOther)?.classId ?? null;
}
attachPicking(canvas, camera, tips, { onTip: (id) => api.focusTip(id), onEmpty: () => api.clearFocus(), isHidden: tipHidden, pickTrack });

api.onImageLoaded(() => {
  const a = api.assets;
  veins.dispose(); tips.dispose(); labels.dispose();
  tissue.setPath(null); tissue.setFocusPath(null);
  if (!a?.tree) return;
  const layout = layoutBrain(a.tree);
  veins.build(layout);
  tips.build(layout, a.tree, a.gradcam);
  labels.build(tips.list);
  veins.resetReveal();
  const top1 = [...layout.nodes.values()].find((n) => n.isLeaf && n.node.onTop1Path);
  if (top1) tissue.setPath(veins.pathPoints(top1.id));
});
api.onPulseComplete(() => veins.startReveal());
// Steer (contract v2): registered after the Brain's own image-loaded handler, so it moves a Brain that exists
const steer = linkSteer({ api, panel, veins, tips, labels, tissue });
// v3 demo beats (registered after Steer's image-loaded handler too)
const stability = createStability({ api, veins, tips, labels, tissue, trunk });
const adversarial = await createAdversarial({ api, panel });
const medical = createMedical({ api, tips, parent: brainRoot });
// glow on the strands, the tips and the pulse only (after the Brain's own image-loaded handler has rebuilt them)
const glow = createGlow({ renderer, scene, camera, stats, api });
// the trunk interior (mode "trunk"): the Brain dims while the trunk is open
function dimBrain(k) {
  tissue.setDim(k);
  veins.setFade(k);
  const show = k > 0.97;
  tips.group.visible = show;
  labels.group.visible = show;
  fibers.mesh.visible = show;
}
const interior = createTrunkInterior({ api, scene, rig, camera, trunk, steer, dimBrain });
glowing(trunk.mesh);
api.onImageLoaded(() => {
  for (const m of veins.group.children) if (m.material === veins.material) glowing(m);
  for (const t of tips.list) glowing(t.mesh);
});
// between the two images of the adversarial pair the answered Brain appears at once (api: no pulse, same camera)
api.onPairSwitch(() => veins.setRevealed());

// Exposed for CC-4b/CC-5 code in this lane and for test scripts.
const stark = { get framing() { return framing; }, fibers, pickTrack, api, rig, trunk, panel, stats, renderer, scene, camera, hud, veins, tips, labels, focus, tissue, tipHidden, steer, stability, adversarial, medical, glow, interior, relay: null };
window.__stark = stark;
const perf = createPerf({ renderer, stats, api, params });
// read-only numbers for tools/rehearse.mjs and the perf log: camera pose, frame times, GPU counts
window.__starkDebug = Object.freeze({
  get camera() { return { position: camera.position.toArray(), target: rig.state.target.toArray(), fov: camera.fov, moving: rig.moving }; },
  get perf() { return perf.summary(); },
  get room() { return stark.relay?.room ?? null; },
  get preload() { return { ...preloadProgress }; },
});

let readyPending = true;
// contract §9: ready = registered with the relay (or offline), first image loaded, a frame rendered
let netSettled = params.get('offline') === '1';
setTimeout(() => { netSettled = true; }, 3000); // an unreachable relay must not block the display
const clock = new THREE.Clock();
const frozenT = params.get('t') !== null ? Number(params.get('t')) : null;
let animTime = 0;
const viewSize = new THREE.Vector2();
const BREATHE = { amp: 0.012, period: VEINS.breathePeriod };
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1); // a stalled tab must not teleport animations
  animTime = frozenT ?? animTime + dt;
  perf.frameStart(dt);
  tick(dt);
  rig.update(dt);
  trunk.update(dt);
  panel.update(dt);
  steer.tick();
  stability.update(dt);
  interior.update(dt);
  veins.update(animTime, dt);
  brainPivot.scale.setScalar(1 + BREATHE.amp * Math.sin((2 * Math.PI * animTime) / BREATHE.period));
  tips.setLit(veins.revealProgress);
  tips.animate(dt);
  tissue.setGlow(veins.revealProgress * steer.update(dt));
  tissue.update(animTime);
  tips.update(camera);
  renderer.getSize(viewSize);
  labels.update(camera, viewSize.x, viewSize.y, dt * 1000);
  glow.render(dt);
  if (readyPending && api.state && netSettled) {
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

// fixed cameras around the brain for verification shots (offsets from the cerebrum's centre)
const DEBUG_VIEWS = {
  front: [-15, 1.5, 0.01], side: [0, 1.5, 15], back: [15, 1.5, 0.01], top: [0.01, 15, 0.5], threeq: [9.5, 5, 11],
};

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
  const view = DEBUG_VIEWS[params.get('view')];
  if (view) rig.snapTo(new THREE.Vector3(...view).add(BRAIN_VOLUME.center), BRAIN_VOLUME.center);
}

// Networking last, so the first state the relay sees is a loaded image. ?offline=1 skips it.
if (params.get('offline') !== '1') {
  stark.relay = relay = await connectRelay(api, {
    steer: steer.session,
    onStatus: (st) => { stark.netStatus = st.phase; if (st.phase !== 'connecting' && st.phase !== 'registering') netSettled = true; },
  });
  if (!stark.relay) netSettled = true;
}

if (!first) {
  console.warn('[stark] no gallery images in the manifest');
  panel.setCrop(null);
  window.__starkReady = true;
}
