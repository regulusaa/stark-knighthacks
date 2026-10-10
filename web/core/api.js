// The display's internal API: the single boundary CC-4b (the Brain) and CC-5 (networking) code against.
// It also builds the contract v1 section 3.2 DisplayState from the loaded tree and Grad-CAM index.
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

/** Contract Answer list: top ANSWER_LIST by rank, plus the true class if outside them. */
export function buildAnswers(tree, gradcam) {
  const heat = new Map((gradcam?.classes || []).map((c) => [c.classId, c.hasHeatmap === true]));
  const trueId = tree.trueClass?.classId ?? null;
  const answer = (e) => ({
    classId: e.classId, label: e.label, score: e.score, rank: e.rank,
    hasHeatmap: heat.get(e.classId) === true,
    isTop1: e.classId === tree.top1.classId,
    isTrueClass: e.classId === trueId,
  });
  const answers = tree.topK.slice(0, DEFAULTS.ANSWER_LIST).map(answer);
  if (trueId !== null && !answers.some((a) => a.classId === trueId)) answers.push(answer(tree.trueClass));
  return answers;
}

export function createApi({ manifest, panel, trunk, rig }) {
  const ev = emitter();
  let assets = null;
  let loadToken = 0;
  let state = null;
  let heatOn = false;

  function publish() {
    if (state) ev.emit('display-state', state);
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
      return;
    }
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
      const mine = ++loadToken;
      const next = await loadImageAssets(entry);
      if (mine !== loadToken) { disposeImageAssets(next); return false; } // a newer load won
      const prev = assets;
      assets = next;
      panel.clear();
      panel.setCrop(next.crop || placeholderTexture());
      heatOn = false;
      disposeImageAssets(prev);

      const tree = next.tree;
      state = {
        room: null,
        image: { id: entry.id, name: entry.name, category: entry.category },
        scoreKind: tree?.scoreKind ?? 'softmax',
        top1: null,
        trueClass: null,
        mode: 'normal',
        layerMode: 'full',
        playback: { state: 'idle', speed: trunk.state.speed },
        focus: null,
        driver: null,
        controllerCount: 0,
        capabilities: {
          stability: entry.files?.stability === true,
          trunkInterior: false, layerModes: false, bloom: false, steer: false,
        },
        answers: [],
      };
      if (tree) {
        state.answers = buildAnswers(tree, next.gradcam);
        state.top1 = state.answers.find((a) => a.isTop1) ?? null;
        state.trueClass = state.answers.find((a) => a.isTrueClass) ?? null;
      } else {
        console.warn(`[stark] ${entry.id}: no tree data; showing the placeholder`);
      }
      if (autoplay) trunk.play(); else trunk.reset();
      setPlayback();
      ev.emit('focus-state', null);
      ev.emit('image-loaded', { id: entry.id, ok: next.ok });
      return true;
    },

    orbit: (dx, dy) => rig.orbit(dx, dy),
    zoom: (d) => rig.zoom(d),
    resetView: () => rig.resetView(),
    replay() { trunk.play(); setPlayback(); },
    jumpToEnd() { trunk.jumpToEnd(); setPlayback(); },
    setSpeed(s) {
      const speed = TRUNK.speeds.includes(s) ? s : 1;
      trunk.setSpeed(speed);
      setPlayback();
    },
    showHeatmap,
    toggleHeatmap() { return showHeatmap(heatOn ? null : state?.top1?.classId ?? null); },

    onDisplayState(cb) { const off = ev.on('display-state', cb); if (state) cb(state); return off; },
    onFocus(cb) { const off = ev.on('focus-state', cb); cb(state?.focus ?? null); return off; },
    onPulseComplete: (cb) => ev.on('pulse-complete', cb),
    onImageLoaded: (cb) => ev.on('image-loaded', cb),
  };
  return api;
}
