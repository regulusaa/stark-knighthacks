// Stability test on the display (master plan section 8, contract v3 3.6): set-mode {mode: "stability"} on an image
// with mc.json plays its test-time-augmentation runs back as a flicker. One run every STABILITY.runMs ÷ playback
// speed; each run lights that run's top-1 path (a quick crossfade, no spring), or "other" when the class isn't drawn
// in the Brain. Every tip that has won keeps a soft halo whose opacity grows with its share of the runs, so the spread
// shows at a glance. After the last run: the summary (the strand returns to the clean top-1, the halos stay).
// play-pulse replays from run 1; set-mode normal exits and clears the halos.
// mc.json does not store each run's crop, flip or brightness, so the image panel stays still (nothing is invented).
import * as THREE from 'three';
import { STABILITY_PHASES } from '/contract/contract.js';

export const STABILITY = {
  runMs: 150,              // one run per 150 ms at 1× (play-pulse speed divides it)
  litFadeMs: 80,           // the lit strand jumps: a crossfade this short reads as a flicker
  haloSize: 1.5,           // world units across
  haloMin: 0.3,            // opacity for a single win …
  haloMax: 0.95,           // … up to this for a tip that won every run
  haloColor: 0xffd27a,
  haloOrder: 13,           // with the tips' own halos: after the tissue
};

let haloTexture = null;
function softDisc() {
  if (haloTexture) return haloTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  haloTexture = new THREE.CanvasTexture(c);
  haloTexture.colorSpace = THREE.SRGBColorSpace;
  return haloTexture;
}

export function createStability({ api, veins, tips, labels, tissue, trunk, remote = false }) {
  let mc = null;            // mc.json of the current image (null if it has none)
  let mcFor = null;         // image id mc belongs to
  let play = null;          // {t, run} while playing
  let counts = new Map();   // classId → wins so far
  const halos = new Map();  // tip key (classId, or 'other') → Sprite
  let leafOf = new Map();   // classId → leaf node id in the Brain
  let otherLeaf = null;
  let clean = null;         // clean top-1 Answer

  // BUGS #3: the first halo draw (an additive sprite with its own texture) made the GPU build its pipeline mid-run, a
  // visible hitch on the first play only. Draw one invisible halo for a few frames when an image with stability data
  // loads, so that happens before anyone presses Stability. Kept (never disposed), hidden after warming.
  let warm = null;
  function warmHalo() {
    if (!warm) {
      warm = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDisc(), color: STABILITY.haloColor, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending, opacity: 0,
      }));
      warm.scale.setScalar(STABILITY.haloSize);
      warm.renderOrder = STABILITY.haloOrder;
      warm.frustumCulled = false;
    }
    if (warm.parent !== tips.group) tips.group.add(warm);
    warm.position.copy(tips.list[0]?.mesh.position ?? warm.position);
    warm.visible = true;
    warm.frames = 4;
  }

  function clearHalos() {
    for (const h of halos.values()) { h.parent?.remove(h); h.material.dispose(); }
    halos.clear();
  }

  /** An Answer for a class on this image: the clean answer list's when it is there, else from mc.json. */
  function answerFor(classId, score) {
    const a = api.state?.answers.find((x) => x.classId === classId);
    const k = api.assets?.tree?.topK.find((x) => x.classId === classId);
    const label = a?.label ?? k?.label ?? mc.winners.find((w) => w.classId === classId)?.label
      ?? mc.classes?.find((w) => w.classId === classId)?.label ?? `class ${classId}`;
    const heat = a?.hasHeatmap ?? false;
    return {
      classId, label, score, rank: a?.rank ?? k?.rank ?? null,
      hasHeatmap: heat, heatmapSource: heat ? (a?.heatmapSource ?? 'precomputed') : null,
      isTop1: classId === clean?.classId, isTrueClass: classId === api.state?.trueClass?.classId,
    };
  }

  function winners() {
    return [...counts].map(([classId, count]) => ({ classId, label: answerFor(classId, 0).label, count }))
      .sort((a, b) => b.count - a.count || a.classId - b.classId);
  }

  function tipFor(classId) {
    if (leafOf.has(classId)) return tips.get(classId);
    return tips.list.find((t) => t.isOther) ?? null;
  }

  function setHalo(classId) {
    const t = tipFor(classId);
    if (!t) return;
    const key = leafOf.has(classId) ? classId : 'other';
    let h = halos.get(key);
    if (!h) {
      h = new THREE.Sprite(new THREE.SpriteMaterial({
        map: softDisc(), color: STABILITY.haloColor, transparent: true, depthWrite: false, fog: false,
        blending: THREE.AdditiveBlending,
      }));
      h.scale.setScalar(STABILITY.haloSize);
      h.renderOrder = STABILITY.haloOrder;
      h.position.copy(t.mesh.position);
      t.mesh.parent.add(h);
      halos.set(key, h);
    }
    // "other" collects every class outside the Brain
    const n = key === 'other' ? [...counts].filter(([k]) => !leafOf.has(k)).reduce((a, [, c]) => a + c, 0) : counts.get(classId);
    h.material.opacity = STABILITY.haloMin + (STABILITY.haloMax - STABILITY.haloMin) * (n - 1) / Math.max(1, mc.runs - 1);
  }

  /** Light the path of a class (or "other") and name it on the Brain. */
  function light(classId, fadeMs = undefined) {
    const inBrain = leafOf.has(classId);
    const leaf = inBrain ? leafOf.get(classId) : otherLeaf;
    if (leaf === null || leaf === undefined) return;
    veins.setLit(leaf, fadeMs);
    tips.setScores(() => undefined, inBrain ? classId : null);
    labels.setTop1(inBrain ? classId : null);
    tissue.setPath(veins.pathPoints(leaf));
  }

  function publish(phase, run, current) {
    const w = winners();
    api.patchState({
      stability: {
        active: true, phase, run, runs: mc.runs, current,
        matchesClean: current.classId === clean.classId,
        distinctWinners: w.length, winners: w, cleanTop1: clean,
      },
    });
  }

  function showRun(i) {
    const r = mc.perRun[i];
    counts.set(r.top1ClassId, (counts.get(r.top1ClassId) ?? 0) + 1);
    light(r.top1ClassId, STABILITY.litFadeMs);
    setHalo(r.top1ClassId);
    publish(STABILITY_PHASES.PLAYING, i + 1, answerFor(r.top1ClassId, r.top1Score));
  }

  function summary() {
    play = null;
    light(clean.classId);              // back to the clean answer (the normal crossfade)
    publish(STABILITY_PHASES.SUMMARY, mc.runs, clean);
  }

  function start() {
    if (!mc || mcFor !== api.state?.image.id) return;
    clearHalos();
    counts = new Map();
    // the forward pass and the strand reveal are finished first: stability starts from the answered Brain
    if (trunk.state.phase !== 'done') api.jumpToEnd();
    veins.setRevealed();
    play = { t: 0, run: -1 };
  }

  function stop() {
    play = null;
    clearHalos();
    counts = new Map();
    if (clean) light(clean.classId);
    api.patchState({ stability: null });
  }

  api.onImageLoaded(async ({ id }) => {
    play = null;
    clearHalos();            // tips were rebuilt; old sprites went with their parents' children list
    counts = new Map();
    mc = null;
    mcFor = null;
    const a = api.assets;
    const tree = a?.tree;
    leafOf = new Map();
    otherLeaf = null;
    for (const n of tree?.nodes ?? []) {
      if (!n.isLeaf) continue;
      if (n.isOther) otherLeaf = n.id; else if (n.classId !== null) leafOf.set(n.classId, n.id);
    }
    clean = api.state?.top1 ?? null;
    if (!a?.entry.files?.stability || a.tree?.scoreKind === 'independent') return;
    warmHalo();
    if (remote) return;
    try {
      const res = await fetch(`${a.base}mc.json`, { cache: 'no-cache' });
      const json = await res.json();
      if (json?.schema !== 'stark.stability/1' || !Array.isArray(json.perRun) || !json.perRun.length) throw new Error('bad mc.json');
      if (api.state?.image.id !== id) return;
      mc = json;
      mcFor = id;
    } catch (err) {
      console.warn(`[stark] ${id}: no stability data (${err.message}); the mode stays unavailable`);
      api.patchState({}, { capabilities: { stability: false } });
    }
  });
  api.onMode(({ from, to }) => {
    if (remote) return;
    if (to === 'stability') start();
    else if (from === 'stability') stop();
  });
  api.onStabilityReplay(() => { if (!remote && api.state?.mode === 'stability') start(); });

  return {
    applyRemote(state) {
      if (!remote) return;
      if (!state?.active) { if(halos.size)clearHalos();counts=new Map();return; }
      mc = { runs: state.runs };
      const next = new Map((state.winners ?? []).map(w => [w.classId, w.count]));
      if ([...counts].some(([id, count]) => (next.get(id) ?? 0) < count)) clearHalos();
      counts = next;
      for(const id of counts.keys())setHalo(id);
    },
    get playing() { return Boolean(play); },
    get counts() { return counts; },
    /** Once per frame, after Steer has applied (so a steering reset can't overwrite a run). */
    update(dt) {
      if (warm?.visible && --warm.frames <= 0) warm.visible = false;
      if (!play) return;
      play.t += dt * 1000;
      const step = STABILITY.runMs / Math.max(0.25, trunk.state.speed || 1);
      const due = Math.min(mc.perRun.length - 1, Math.floor(play.t / step));
      while (play.run < due) showRun(++play.run);
      if (play.t >= step * mc.perRun.length) summary();
    },
  };
}
