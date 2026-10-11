// Display entry point: builds the scene, loads the first image and runs the render loop.
// Debug query params (reproducible screenshots):
//   ?image=ID ?pulseAt=0..1|done ?heatmap=CLASSID ?focus=CLASSID ?t=SECONDS (freeze animation time) ?guides=1 ?stats=1
//   ?view=front|side|back|top|threeq (fixed camera around the brain)
import * as THREE from 'three';
import { createScene } from './scene.js';
import { loadManifest } from './assets.js';
import { preloadAll, preloadProgress } from './preload.js';
import { createImagePanel, PANEL } from './imagePanel.js';
import { createTrunk } from './trunk.js';
import { createCameraRig } from './cameraRig.js';
import { createApi } from './api.js';
import { mountHud } from './hudBridge.js';
import { attachInput } from './input.js';
import { layoutBrain } from './brainLayout.js';
import { createBrainMesh } from './brainMesh.js';
import { createTissue, createTissueLights } from './brainTissue.js';
import { createFibers } from './brainFibers.js';
import { ANATOMY, BOUNDS, occluded } from './brainShape.js';
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
import { createInspection } from './inspection.js';
import { mountInspectionInput } from './inspectionInput.js';
import { createSignalActivity } from './signalActivity.js';

// The anatomy's bounding box; the whole Brain breathes about the cerebrum's centre.
export const BRAIN_VOLUME = {
  box: new THREE.Box3(new THREE.Vector3(...BOUNDS.min), new THREE.Vector3(...BOUNDS.max)),
  center: new THREE.Vector3(...ANATOMY.origin),
};

const params = new URLSearchParams(location.search);
const preview = params.get("preview") === "1";
if (preview) document.body.classList.add("preview");
const tissueReady = createTissue({ preview });     // ~1 s of geometry in a worker, while the rest loads
const canvas = document.getElementById('stage');
const { renderer, scene, camera, stats, tick, onContextLoss } = createScene(canvas);
if (preview) scene.fog = null;

const panel = createImagePanel();
const trunk = createTrunk();
const brainAssembly = new THREE.Group(), stemAssembly = new THREE.Group();
scene.add(panel.group, brainAssembly, stemAssembly); stemAssembly.add(trunk.mesh);
panel.screenPinned = true;
for (const child of panel.group.children) if (child.material) { child.material.depthTest = false; child.material.depthWrite = false; child.renderOrder = 40; }
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
brainRoot.add(veins.group, tips.group, labels.group);
stemAssembly.add(fibers.mesh);
brainAssembly.add(brainPivot);
scene.add(createTissueLights(BRAIN_VOLUME.center));

if (params.get('guides') === '1') scene.add(new THREE.Box3Helper(BRAIN_VOLUME.box, 0x6b4c8a));

const manifest = await loadManifest();
// The authoritative display preloads demo assets. A controller preview only loads the current scene.
if (!preview) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:16px;bottom:12px;font:14px ui-monospace,monospace;color:#ffffff;z-index:40;pointer-events:none';
  document.body.appendChild(el);
  preloadAll(manifest, {
    onProgress: (p) => { el.textContent = `Loading demo files ${p.done}/${p.total} · ${(p.bytes / 1e6).toFixed(1)} MB${p.failed ? ` · ${p.failed} failed` : ''}`; },
  }).then((p) => setTimeout(() => el.remove(), p.failed ? 8000 : 1200));
}
const api = createApi({ manifest, panel, trunk, rig, preview });
let relay = null; // net.js, connected last
// the room comes from the relay once registered; until then the HUD shows none
const hud = preview ? { visible: false, setVisible() {} } : await mountHud(document.getElementById('hud'), api, { getRoom: () => relay?.room ?? api.state?.room ?? null });
const steerKeys = { zeroFlip: () => steer?.zeroFlip(), zeroTop1: () => steer?.zeroTop1(), reset: () => steer?.reset() };
if (!preview) attachInput(canvas, api, hud, steerKeys);

const tissue = await tissueReady;
brainRoot.add(tissue.parts.brain); stemAssembly.add(tissue.parts.stem);
const inspection = createInspection({ brain: brainAssembly, stem: stemAssembly, tissue, fibers, rig, camera, preview });
api.attachInspection(inspection);
const activity = createSignalActivity({ scene, camera, inspection, veins });
let previewContext = { driving: false, clientId: null }, localSeq = -1, latestRemote = null, remoteToken = 0;
let previewInitialized = false, lastVisualData = '', lastPreviewHeat = '';
let previewLoad = null, previewLoadId = null;
const previewHeatPixels = preview ? new Uint8Array(224*224) : null;
const input = mountInspectionInput({ canvas, camera, inspection, tissue, preview,
  onAction: p => { if (preview) parent.postMessage({type:'stark-scene-action',payload:p},location.origin); else api.sceneAction(p); } });

// Fit the complete assembly independently of the camera-pinned source image.
let framing = null;
function applyFraming() {
  if (!inspection) return;
  framing = inspection.fit('all');
  if (!previewInitialized) { inspection.initial(); previewInitialized = true; }
  else inspection.resize();
  rig.setDefault({ ...framing, fov: camera.fov });
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
if (!preview) attachPicking(canvas, camera, tips, { onTip: (id) => api.focusTip(id), onEmpty: () => api.clearFocus(), isHidden: tipHidden, pickTrack });

api.onImageLoaded(() => {
  const a = api.assets;
  veins.dispose(); tips.dispose(); labels.dispose();
  tissue.setPath(null); tissue.setFocusPath(null);
  if (!a?.tree) return;
  const layout = layoutBrain(a.tree);
  veins.build(layout);
  void activity.build(layout, a);
  api.patchState({}, { capabilities: { inspection: true } });
  tips.build(layout, a.tree, a.gradcam);
  labels.build(tips.list);
  veins.resetReveal();
  const top1 = [...layout.nodes.values()].find((n) => n.isLeaf && n.node.onTop1Path);
  if (top1) tissue.setPath(veins.pathPoints(top1.id));
});
api.onPulseComplete(() => veins.startReveal());
// Steer (contract v2): registered after the Brain's own image-loaded handler, so it moves a Brain that exists
const steer = preview ? { tick() {}, update: () => 1, reset() {}, session: { on() {}, state: null, engine: null } }
  : linkSteer({ api, panel, veins, tips, labels, tissue });
// v3 demo beats (registered after Steer's image-loaded handler too)
const stability = createStability({ api, veins, tips, labels, tissue, trunk, remote: preview });
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
const interior = createTrunkInterior({ api, scene: stemAssembly, rig, camera, trunk, steer, dimBrain, preview });
glowing(trunk.mesh);
api.onImageLoaded(() => {
  for (const m of veins.group.children) if (m.material === veins.material) glowing(m);
  for (const t of tips.list) glowing(t.mesh);
});
// between the two images of the adversarial pair the answered Brain appears at once (api: no pulse, same camera)
api.onPairSwitch(() => veins.setRevealed());

// Exposed for CC-4b/CC-5 code in this lane and for test scripts.
const stark = { inspection, activity, input, preview, get framing() { return framing; }, fibers, pickTrack, api, rig, trunk, panel, stats, renderer, scene, camera, hud, veins, tips, labels, focus, tissue, tipHidden, steer, stability, adversarial, medical, glow, interior, relay: null };
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
let netSettled = preview || params.get('offline') === '1';
setTimeout(() => { netSettled = true; }, 3000); // an unreachable relay must not block the display
const clock = new THREE.Clock();
const frozenT = params.get('t') !== null ? Number(params.get('t')) : null;
let animTime = 0, lastScenePublish = -Infinity, lastSceneJson = "";
const stemDelta = new THREE.Vector3(), pinned = new THREE.Vector3();
const viewSize = new THREE.Vector2();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1); // a stalled tab must not teleport animations
  if (document.hidden) return;
  animTime = frozenT ?? animTime + dt;
  perf.frameStart(dt);
  tick(dt);
  inspection.update(dt);
  if (preview && latestRemote?.scene && localSeq < 0) inspection.applyRemote(latestRemote.scene);
  rig.update(dt);
  veins.setStemOffset(stemDelta.copy(stemAssembly.position).sub(brainAssembly.position));
  trunk.update(dt);
  panel.update(dt);
  steer.tick();
  stability.update(dt);
  interior.update(dt);
  veins.update(animTime, dt);
  if (preview && latestRemote?.scene) {
    const visual = latestRemote.scene;
    veins.material.uniforms.uReveal.value = visual.reveal ?? 1;
    veins.material.uniforms.uMoment.value = visual.moment ?? -1;
    if (visual.pulse?.phase === 'playing') trunk.freezeAt(visual.pulse.progress);
    else if (visual.pulse?.phase === 'idle') trunk.reset();
    else trunk.jumpToEnd();
  }
  brainPivot.scale.setScalar(1); // Parts and their connector endpoints share one placement owner.
  tips.setLit(veins.revealProgress);
  tips.animate(dt);
  tissue.setGlow(veins.revealProgress * steer.update(dt));
  tissue.update(animTime);
  tips.update(camera);
  renderer.getSize(viewSize);
  labels.update(camera, viewSize.x, viewSize.y, dt * 1000);
  const activityCount = activity.update(animTime, viewSize.x, viewSize.y);
  input.update(activityCount);
  // Keep the source image secondary and fixed in a corner while the assembly stays centered.
  const depth = 5, halfH = depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const cropPx = preview ? Math.min(76, viewSize.x * .2) : Math.min(220, viewSize.x * .17);
  const unit = halfH * 2 / viewSize.y, margin = preview ? 12 : 32;
  pinned.set(-halfH * camera.aspect + (margin + cropPx/2)*unit,
    -halfH + (margin + cropPx/2 + (preview?8:28))*unit, -depth).applyQuaternion(camera.quaternion).add(camera.position);
  panel.setPlacement(pinned.toArray(), cropPx * unit / PANEL.size);
  panel.group.quaternion.copy(camera.quaternion);
  if (preview && latestRemote?.scene?.interiorTop && interior.built) {
    const b = interior.built; b.valAttr.array.set(latestRemote.scene.interiorTop, b.topStart); b.valAttr.needsUpdate = true;
  }
  glow.render(dt);
  if (!preview && api.state && performance.now()-lastScenePublish >= 100) {
    lastScenePublish = performance.now();
    const visual = { ...inspection.snapshot(), values: veins.visualValues().map(([id,v])=>[id,Math.round(v*1e6)/1e6]),
      heat: panel.previewHeat, panelCaption: panel.caption, moment: Math.round(veins.material.uniforms.uMoment.value*1000)/1000,
      pulse: { phase: trunk.state.phase, progress: Math.round(trunk.state.progress*1000)/1000 }, litLeaf: veins.litLeaf, litClass: tips.litClass, reveal: Math.round(veins.revealProgress*1000)/1000,
      interiorTop: interior.open>0 && interior.built ? Array.from(interior.built.valAttr.array.slice(interior.built.topStart)) : null };
    const json = JSON.stringify(visual);
    if (json !== lastSceneJson) { lastSceneJson = json; api.patchState({ scene: visual }); }
  }
  if (readyPending && api.state && netSettled) {
    readyPending = false;
    requestAnimationFrame(() => {
      window.__starkReady = true;
      if (preview) parent.postMessage({ type: 'stark-scene-rendered' }, location.origin);
    }); // after the first complete frame is presented
  }
}
renderer.setAnimationLoop(frame);
onContextLoss(
  () => renderer.setAnimationLoop(null),
  () => { clock.getDelta(); renderer.setAnimationLoop(frame); },
);

if (params.get('stats') === '1') {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;right:12px;bottom:10px;font:14px ui-monospace,monospace;color:#ffffff;z-index:9';
  document.body.appendChild(el);
  setInterval(() => { el.textContent = `${stats.fps.toFixed(0)} fps · ${stats.pixelRatio}x`; }, 500);
}

// fixed cameras around the brain for verification shots (offsets from the cerebrum's centre)
const DEBUG_VIEWS = {
  front: [-15, 1.5, 0.01], side: [0, 1.5, 15], back: [15, 1.5, 0.01], top: [0.01, 15, 0.5], threeq: [9.5, 5, 11],
};

const first = preview ? null : manifest.find((m) => m.id === params.get('image')) ?? manifest[0];
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

// Reproducible inspection scenes for screenshots; production links need none of these parameters.
if (!preview && params.get('parts') === 'split') api.sceneAction({ action: 'split' });
if (!preview && ['brain','stem'].includes(params.get('inspect'))) api.sceneAction({ action: 'inspect', part: params.get('inspect') });
setTimeout(() => { window.__inspectionReady = true; }, 2200);

// Networking last, so the first state the relay sees is a loaded image. ?offline=1 skips it.
if (!preview && params.get('offline') !== '1') {
  stark.relay = relay = await connectRelay(api, {
    steer: steer.session,
    onStatus: (st) => { stark.netStatus = st.phase; if (st.phase !== 'connecting' && st.phase !== 'registering') netSettled = true; },
  });
  if (!stark.relay) netSettled = true;
}

if (!first && !preview) {
  console.warn('[stark] no gallery images in the manifest');
  panel.setCrop(null);
  window.__starkReady = true;
}


// Embedded controller renderer: consume its parent's existing relay connection. Never register as a display.
if (preview) {
  window.addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin || !event.data) return;
    const { type, payload } = event.data;
    if (type === 'stark-scene-context') {
      previewContext = payload; input.setEnabled(payload.driving);
      if (!payload.driving) { localSeq = -1; input.cancel(); if (latestRemote?.scene) inspection.applyRemote(latestRemote.scene); }
    } else if (type === 'stark-scene-local' && previewContext.driving) {
      localSeq = payload.seq; inspection.action(payload);
    } else if (type === 'stark-scene-cancel') {
      localSeq = -1; input.cancel(); if (latestRemote?.scene) inspection.applyRemote(latestRemote.scene);
    } else if (type === 'stark-scene-state' && payload?.image?.id) {
      latestRemote = payload;
      const mine = ++remoteToken;
      if (api.state?.image.id !== payload.image.id) {
        localSeq = -1; input.cancel();
        if (previewLoadId !== payload.image.id) {
          previewLoadId = payload.image.id;
          previewLoad = api.loadImage(payload.image.id, { autoplay: false });
        }
        await previewLoad;
        if (mine !== remoteToken) return;
        api.jumpToEnd(); veins.setRevealed();
      }
      if (latestRemote !== payload || !api.state) return;
      Object.assign(api.state.capabilities, payload.capabilities);
      api.setMode({ mode: payload.mode, layerMode: payload.layerMode, noiseView: payload.noiseView, bloom: false });
      const previousFocus = api.state.focus?.classId;
      api.patchState({ ...payload, bloom: false });
      stability.applyRemote(payload.stability);
      const ack = payload.scene?.ack;
      if (localSeq >= 0 && ack?.clientId === previewContext.clientId && ack.seq >= localSeq) localSeq = -1;
      const data = JSON.stringify([payload.scene?.values, payload.scene?.litLeaf, payload.focus]);
      if (data !== lastVisualData) {
        lastVisualData = data;
        const values = new Map(payload.scene?.values ?? []);
        veins.setValues(values, payload.scene?.litLeaf, 60);
        tips.setScores(k => values.get(tips.get(k)?.node.id), payload.scene?.litClass ?? payload.top1?.classId);
        labels.setTop1(payload.scene?.litClass ?? payload.top1?.classId);
        labels.setFocused(payload.focus?.classId ?? null);tips.setFocused(payload.focus?.classId ?? null);highlight(payload.focus?.classId ?? null);
        if (previousFocus !== payload.focus?.classId) await api.showHeatmap(payload.focus?.heatmapSource === 'precomputed' ? payload.focus.classId : null);
      }
      const heat = payload.scene?.heat;
      const heatJson=JSON.stringify(heat);
      if(heatJson!==lastPreviewHeat){
        const had=lastPreviewHeat&&lastPreviewHeat!=='null';lastPreviewHeat=heatJson;
        if(heat?.data?.length===28*28){
          for(let y=0;y<224;y++)for(let x=0;x<224;x++)previewHeatPixels[y*224+x]=heat.data[Math.min(27,Math.floor(y/8))*28+Math.min(27,Math.floor(x/8))];
          panel.setLiveHeat(previewHeatPixels,heat.key);
        } else if(had)await api.showHeatmap(payload.focus?.heatmapSource==='precomputed'?payload.focus.classId:null);
      }
      panel.setCaption(payload.scene?.panelCaption??null);
      window.__starkReady = true;
    }
  });
  parent.postMessage({ type: 'stark-scene-ready' }, location.origin);
}
