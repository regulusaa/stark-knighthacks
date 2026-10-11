// The display's internal API: the single boundary CC-4b (the Brain) and CC-5 (networking) code against.
// It also builds the contract section 3.2 DisplayState (v3 fields included) from the loaded tree and Grad-CAM index.
import { KILL, DISPLAY, maskCapabilities } from './flags.js';
import { DEFAULTS } from '/contract/contract.js';
import { loadImageAssets, disposeImageAssets, heatmapTexture, placeholderTexture } from './assets.js';
import { TRUNK } from './trunk.js';

function emitter() {
  const sets = new Map();
  return {
    on(name, cb) {
      if (!sets.has(name)) sets.set(name, new Set());
      sets.get(name).add(cb);
      return () => sets.get(name).delete(cb);
    },
    emit(name, value) {
      for (const cb of sets.get(name) || []) {
        try { cb(value); } catch (err) { console.error(`[stark] ${name} listener failed:`, err); }
      }
    },
  };
}

/**
 * Contract Answer list: top ANSWER_LIST by rank, plus the true class if outside them.
 * `live` (Steer ready on this image): every class without a stored PNG can still get a live Grad-CAM.
 */
export function buildAnswers(tree, gradcam, { live = null } = {}) {
  const heat = new Map((gradcam?.classes || []).map((c) => [c.classId, c.hasHeatmap === true]));
  const trueId = tree.trueClass?.classId ?? null;
  const answer = (e) => {
    const source = heat.get(e.classId) === true ? 'precomputed' : live?.(e.classId) ? 'live' : null;
    return {
      classId: e.classId, label: e.label, score: e.score, rank: e.rank,
      hasHeatmap: source !== null, heatmapSource: source,
      isTop1: e.classId === tree.top1.classId,
      isTrueClass: e.classId === trueId,
    };
  };
  const answers = tree.topK.slice(0, DEFAULTS.ANSWER_LIST).map(answer);
  if (trueId !== null && !answers.some((a) => a.classId === trueId)) answers.push(answer(tree.trueClass));
  return answers;
}

export function createApi({ manifest, panel, trunk, rig, preview = false }) {
  const ev = emitter();
  let assets = null;
  let loadToken = 0;
  let state = null;
  let heatOn = false;
  let inspection = null;
  let focusImpl = null; // focus.js, attached by main once the Brain exists
  let heatProvider = null; // Steer: (classId, instant) → true if it showed a live heatmap
  const server = { room: null, driver: null, controllerCount: 0 }; // kept across image switches
  // (v3) the adversarial pair: image id → its partner (both ways), from fgsm.json. The current image and its partner
  // stay loaded, so switching between the two is instant; everything else is disposed when it stops being current.
  let pairs = new Map();
  const kept = new Map();   // image id → Promise<assets>
  function assetsFor(entry) {
    if (!kept.has(entry.id)) kept.set(entry.id, loadImageAssets(entry));
    return kept.get(entry.id);
  }
  function keepOnly(ids) {
    for (const [id, p] of kept) if (!ids.has(id)) { kept.delete(id); p.then(disposeImageAssets); }
  }
  /** Fetch a partner's assets ahead of time, Steer data included (it goes through the HTTP cache). */
  function preload(id) {
    const entry = manifest.find((m) => m.id === id);
    if (!entry) return;
    assetsFor(entry).then((a) => {
      if (preview || !entry.steerable) return;
      for (const f of ['conv5.bin', 'steer.json']) fetch(a.base + f).then((r) => r.arrayBuffer()).catch(() => {});
    });
  }

  function publish() {
    if (!state) return;
    maskCapabilities(state.capabilities);   // kill switches (flags.js)
    ev.emit('display-state', state);
  }

  function setPlayback() {
    if (!state) return;
    state.playback = { state: trunk.state.phase === 'playing' ? 'playing' : trunk.state.phase, speed: trunk.state.speed };
    publish();
  }

  trunk.onComplete(() => {
    setPlayback();
    ev.emit('pulse-complete', { imageId: state?.image.id ?? null });
  });

  async function showHeatmap(classId, { instant = false } = {}) {
    if (!assets) return;
    if (classId === null || classId === undefined) {
      heatOn = false;
      panel.setHeat(null, null, instant);
      panel.setCaption(null);
      return;
    }
    if (heatProvider) {
      const shown = heatProvider(classId, instant);
      if (shown !== false) { heatOn = shown === true; return; }   // true: live map; null: no positive evidence
    }
    panel.setCaption(null);
    const entry = assets.gradcam?.classes.find((c) => c.classId === classId);
    if (!entry?.hasHeatmap) {
      console.warn(`[stark] no heatmap for class ${classId} on ${assets.entry.id}; overlay cleared`);
      heatOn = false;
      panel.setHeat(null, null, instant);
      return;
    }
    const mine = assets;
    const tex = await heatmapTexture(assets, classId);
    if (mine !== assets) return; // image changed while loading
    heatOn = Boolean(tex);
    panel.setHeat(tex, classId, instant);
  }

  const api = {
    get manifest() { return manifest; },
    get state() { return state; },
    get assets() { return assets; },
    get heatmapOn() { return heatOn; },

    async loadImage(id, { autoplay = true } = {}) {
      const entry = manifest.find((m) => m.id === id);
      if (!entry) { console.warn(`[stark] unknown image ${id}`); return false; }
      if (KILL.medical && entry.category === 'medical') { console.warn(`[stark] ${id}: medical images are off (?nomedical)`); return false; }
      const mine = ++loadToken;
      // (v3) between the two images of an adversarial pair the camera stays exactly where it is and the answered
      // Brain appears at once (no pulse), so the strand visibly jumps while the photo doesn't change
      const pairSwitch = Boolean(state && pairs.get(state.image.id) === id);
      const next = await assetsFor(entry);
      if (mine !== loadToken) return false;   // a newer load won (these assets stay cached until evicted)
      if (!next.ok) kept.delete(id);          // let a later select retry
      assets = next;
      panel.clear();
      panel.setCrop(next.crop || placeholderTexture());
      heatOn = false;
      keepOnly(new Set([id, pairs.get(id)].filter(Boolean)));
      if (pairs.has(id)) preload(pairs.get(id));

      const tree = next.tree;
      state = {
        room: server.room,
        image: { id: entry.id, name: entry.name, category: entry.category, adversarial: null },
        scoreKind: tree?.scoreKind ?? 'softmax',
        top1: null,
        trueClass: null,
        mode: 'normal',
        layerMode: DISPLAY.layerMode,
        playback: { state: 'idle', speed: trunk.state.speed },
        focus: null,
        driver: server.driver,
        controllerCount: server.controllerCount,
        capabilities: maskCapabilities({
          stability: entry.files?.stability === true,
          trunkInterior: false, layerModes: false, bloom: false, steer: false, noiseView: false,
        }),
        steer: null,
        answers: [],
        noiseView: false,     // (v3)
        bloom: false,
        stability: null,
        steerMoment: null,
      };
      if (tree) {
        state.answers = buildAnswers(tree, next.gradcam);
        state.top1 = state.answers.find((a) => a.isTop1) ?? null;
        state.trueClass = state.answers.find((a) => a.isTrueClass) ?? null;
      } else {
        console.warn(`[stark] ${entry.id}: no tree data; showing the placeholder`);
      }
      const wasFocused = Boolean(focusImpl?.current !== null && focusImpl?.current !== undefined);
      focusImpl?.reset();
      if (wasFocused && !pairSwitch) rig.resetView();
      ev.emit('image-loaded', { id: entry.id, ok: next.ok, pairSwitch }); // the Brain rebuilds here, before the pulse
      if (pairSwitch) { trunk.jumpToEnd(); ev.emit('pair-switch', entry.id); }
      else if (autoplay) trunk.play(); else trunk.reset();
      setPlayback();
      ev.emit('focus-state', null);
      return true;
    },

    attachInspection(impl) { inspection = impl; },
    sceneAction(p) { return inspection?.action(p); },
    orbit(dx,dy) { inspection?.cancelCamera(); rig.orbit(dx,dy); },
    zoom(d) { inspection?.cancelCamera(); rig.zoom(d); },
    resetView() { if (inspection && state?.mode !== 'trunk') inspection.home(); else rig.resetView(); },
    /** play-pulse: the forward pass; in stability mode (v3) the stability sequence from run 1 instead. */
    replay() {
      if (state?.mode === 'stability') { ev.emit('stability-replay'); return; }
      trunk.play(); setPlayback();
    },
    jumpToEnd() { trunk.jumpToEnd(); setPlayback(); },
    /** Pulse speed multiplier; the contract allows 0.25–4 (keys step through 0.5 / 1 / 2). */
    setSpeed(s) {
      const speed = Number.isFinite(s) ? Math.min(4, Math.max(0.25, s)) : 1;
      trunk.setSpeed(speed);
      setPlayback();
    },
    showHeatmap,
    /** Focus one tip: fly to it and the panel, show its heatmap if it has one, emit focus-state. */
    focusTip(classId) { inspection?.cancelCamera(); return focusImpl ? focusImpl.focusTip(classId) : false; },
    clearFocus() { focusImpl?.clearFocus(); },
    attachFocus(impl) { focusImpl = impl; },
    /** Relay bookkeeping (net.js): room, driver, controller count. The server stays authoritative. */
    setServerFields({ room, driver, controllerCount }) {
      server.room = room ?? null;
      server.driver = driver ?? null;
      server.controllerCount = controllerCount ?? 0;
      if (!state) return;
      Object.assign(state, server);
      publish();
    },
    /**
     * set-mode from the host (v3: any subset of {mode, layerMode, noiseView, bloom}; omitted fields are unchanged).
     * Only what its capability allows is accepted (the relay checks too). Listeners see 'mode' {from, to} first,
     * then the state is published once.
     */
    setMode({ mode, layerMode, noiseView, bloom } = {}) {
      if (!state) return;
      const caps = state.capabilities;
      if (mode !== undefined && mode !== state.mode) {
        if (mode === 'normal' || (mode === 'stability' && caps.stability) || (mode === 'trunk' && caps.trunkInterior)) {
          const from = state.mode;
          state.mode = mode;
          ev.emit('mode', { from, to: mode });
        } else console.warn(`[stark] mode ${mode} is not available for this image`);
      }
      if (layerMode !== undefined && caps.layerModes && layerMode !== state.layerMode) {
        state.layerMode = layerMode;
        ev.emit('layer-mode', layerMode);
      }
      if (noiseView !== undefined && (!noiseView || caps.noiseView)) ev.emit('noise-view', Boolean(noiseView));
      if (bloom !== undefined) ev.emit('bloom', Boolean(bloom));
      publish();
    },
    /** (v3) Merge display-state fields owned by a display module (stability, steerMoment, noiseView, bloom, image,
     *  capabilities) and publish. */
    patchState(fields, { capabilities = null } = {}) {
      if (!state) return;
      for (const [k, v] of Object.entries(fields)) state[k] = v;
      if (capabilities) Object.assign(state.capabilities, capabilities);
      publish();
    },
    onMode: (cb) => ev.on('mode', cb),
    /** (v3) image id → partner id, both ways (adversarial.js sets it from fgsm.json). */
    setPairs(map) { pairs = map; if (state && pairs.has(state.image.id)) preload(pairs.get(state.image.id)); },
    pairOf: (id) => pairs.get(id) ?? null,
    /** (v3) The loaded (or loading) assets of an image the display keeps, e.g. the pair's partner; else null. */
    assetsOf: (id) => kept.get(id) ?? null,
    onPairSwitch: (cb) => ev.on('pair-switch', cb),
    onNoiseView: (cb) => ev.on('noise-view', cb),
    onLayerMode: (cb) => ev.on('layer-mode', cb),
    onBloom: (cb) => ev.on('bloom', cb),
    onStabilityReplay: (cb) => ev.on('stability-replay', cb),
    /**
     * Steer (contract v2): turn the capability on or off for the current image. On: classes without a stored PNG
     * get live heatmaps. Off: back to the pipeline's answers.
     */
    setSteerCapability(on, { live = null } = {}) {
      if (!state || !assets?.tree) return;
      on = on && !KILL.steer;   // ?nosteer
      // (v3) no steering in stability mode, and never on medical images (they have no steer data anyway)
      state.capabilities.steer = Boolean(on) && state.mode !== 'stability';
      state.steer = on ? { active: false, changedCount: 0, top1Changed: false } : null;
      state.answers = buildAnswers(assets.tree, assets.gradcam, { live: on ? live : null });
      state.top1 = state.answers.find((a) => a.isTop1) ?? null;
      state.trueClass = state.answers.find((a) => a.isTrueClass) ?? null;
      publish();
    },
    /** Steer applied: the display-state shows the steered answers, top-1 and true class. */
    applySteer({ answers, top1, trueAnswer, summary }) {
      if (!state?.capabilities.steer) return;
      state.answers = answers;
      state.top1 = top1;
      state.trueClass = trueAnswer;
      state.steer = summary;
      if (state.focus) {
        const f = answers.find((a) => a.classId === state.focus.classId);
        if (f) { state.focus = f; ev.emit('focus-state', f); }
      }
      publish();
    },
    attachHeatProvider(fn) { heatProvider = fn; },
    /** Set by the Steer link: the steered Answer for any class (null when Steer is off or inactive). */
    steerAnswer: () => null,
    steerAnswerAny: () => null,   // Steer ready: any class's Answer under the current scales (link.js)
    get heatProviderActive() { return Boolean(heatProvider); },
    /** Used by focus.js: record the focused Answer (or null) and publish it. */
    setFocus(answer) {
      if (!state) return;
      state.focus = answer;
      ev.emit('focus-state', answer);
      publish();
    },
    toggleHeatmap() { return showHeatmap(heatOn ? null : state?.top1?.classId ?? null); },
    get heatOn() { return heatOn; },
    set heatOn(v) { heatOn = Boolean(v); },

    onDisplayState(cb) { const off = ev.on('display-state', cb); if (state) cb(state); return off; },
    onFocus(cb) { const off = ev.on('focus-state', cb); cb(state?.focus ?? null); return off; },
    onPulseComplete: (cb) => ev.on('pulse-complete', cb),
    /** Steer: every SteerState the display produces (contract 3.4), e.g. for a HUD to name result.outsideBrain. */
    onSteer: (cb) => ev.on('steer-result', cb),
    publishSteer: (st) => ev.emit('steer-result', st),
    onImageLoaded: (cb) => ev.on('image-loaded', cb),
  };
  return api;
}
