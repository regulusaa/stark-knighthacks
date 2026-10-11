// Wires the Steer session (session.js) to the display: the api (display-state, focus, heatmaps), the Brain (veins,
// tips, labels, tissue glow) and the image panel. main.js creates it after the Brain's own image-loaded handler, so
// the Brain is rebuilt for a new image before Steer starts moving it.
import { createSteerSession } from './session.js';
import { DEFAULTS, STEER_MOMENT_MS } from '../../../contract/contract.js';

export const LINK = {
  glowFadeMs: 300,        // the tissue glow above the lit path fades out and back in on the new path
  captionLive: 'Grad-CAM, computed live from the last layer',
  captionNone: 'No positive evidence for this class',
  captionProbe: (c) => `Channel #${c} responds here`,
  captionProbeSilent: (c) => `Channel #${c} does not fire on this image`,
};

export function linkSteer({ api, panel, veins, tips, labels, tissue }) {
  const session = createSteerSession();
  const heat = new Uint8Array(224 * 224);
  let litLeaf = null;
  let glow = null;          // {t, swapped, pts} while the tissue glow moves to a new path
  let glowK = 1;
  let steeringShown = false; // the panel is showing a Steer map (live CAM or probe)
  let shownTop1 = null;      // the top answer the Brain shows (null until this image's first result)
  let momentTimer = null;

  function showLive(classId, instant = false) {
    const m = session.cam(classId, heat);
    if (!m) {
      panel.setLiveHeat(null, null, instant);
      panel.setCaption(LINK.captionNone);
      return null;
    }
    panel.setLiveHeat(heat, `cam:${classId}`, instant);
    panel.setCaption(LINK.captionLive);
    return true;
  }

  /** What the photo shows under Steer: the probed channel, or the live CAM of the focused class / steered top-1. */
  function refreshHeat() {
    const st = session.state;
    if (!st) return;
    if (st.probe !== null) {
      const m = session.channelMap(st.probe, heat);
      if (m) panel.setLiveHeat(heat, `probe:${st.probe}`); else panel.setLiveHeat(null, null);
      panel.setCaption(m ? LINK.captionProbe(st.probe) : LINK.captionProbeSilent(st.probe));
      api.heatOn = Boolean(m);
      steeringShown = true;
      return;
    }
    if (st.active) {
      api.heatOn = showLive(api.state?.focus?.classId ?? st.result.top1.classId) === true;
      steeringShown = true;
      return;
    }
    if (steeringShown) {
      // steering ended: back to what the photo showed without it (the focused tip's heatmap, or nothing)
      steeringShown = false;
      api.showHeatmap(api.state?.focus?.classId ?? null);
    }
  }

  let steerable = false;     // the image's steer data is loaded and checked (true even while a mode suspends it)
  const live = (k) => session.cam(k) !== null;
  session.on('capability', ({ steer }) => {
    steerable = steer;
    api.setSteerCapability(steer, { live });
    if (!steer) { api.steerAnswer = () => null; api.steerAnswerAny = () => null; return; }
    api.steerAnswer = (k) => (session.state?.active ? session.answerFor(k) : null);
    api.steerAnswerAny = (k) => session.answerFor(k);
  });
  // (v3, amended in CC-9) stability clears steering and suspends Steer; back in normal it returns. The trunk interior
  // keeps it: its top slab is the layer Steer edits and follows the steering live
  api.onMode(({ to }) => {
    if (to === 'stability') {
      if (session.state?.active) session.reset();
      api.setSteerCapability(false);
    } else if (steerable && !api.state?.capabilities.steer) api.setSteerCapability(true, { live });
  });

  session.on('result', (st) => api.publishSteer(st));

  session.on('applied', (r) => {
    // (v3) the Steer moment: steering (or its reset) changed the top answer
    const changed = Boolean(shownTop1 && r.top1.classId !== shownTop1.classId && api.state?.capabilities.steer);
    if (changed) {
      clearTimeout(momentTimer);
      api.patchState({ steerMoment: { from: shownTop1, to: r.top1, at: Date.now() } });
      momentTimer = setTimeout(() => api.patchState({ steerMoment: null }), STEER_MOMENT_MS);
    }
    shownTop1 = r.top1;
    veins.setValues(r.values, r.litLeaf);
    if (changed) veins.pulseLitPath();   // down the new lit path
    tips.setScores((k) => r.probs[k], r.outsideBrain ? null : r.top1.classId);
    labels.setTop1(r.outsideBrain ? null : r.top1.classId);
    api.applySteer(r);
    if (r.litLeaf !== litLeaf) {
      const first = litLeaf === null;
      litLeaf = r.litLeaf;
      if (!first) glow = { t: 0, swapped: false, pts: veins.pathPoints(litLeaf) };
    }
    refreshHeat();
  });

  // The live heatmap for any class: always while steering, and for classes with no stored PNG when unsteered.
  api.attachHeatProvider((classId, instant) => {
    if (!session.ready) return false;
    const png = api.assets?.gradcam?.classes.some((c) => c.classId === classId && c.hasHeatmap);
    if (!session.state?.active && png) { panel.setCaption(null); return false; }
    return showLive(classId, instant);
  });
  // focusing or unfocusing while steering: the photo follows (the focused class, or back to the steered top-1)
  api.onFocus(() => { if (session.state?.active) refreshHeat(); });

  api.onImageLoaded(() => {
    shownTop1 = null;
    clearTimeout(momentTimer);
    litLeaf = null;
    glow = null;
    glowK = 1;
    steeringShown = false;
    const a = api.assets;
    session.setImage(a?.entry, a).then((ok) => { if (ok) litLeaf = session.last?.litLeaf ?? null; });
  });

  /** Add zeroed channels to the current intervention (keyboard fallback), capped at STEER_MAX_CHANNELS. */
  function zero(channels) {
    if (!session.ready || !channels?.length) return false;
    const next = new Map(session.scales);
    for (const c of channels) if (next.size < DEFAULTS.STEER_MAX_CHANNELS || next.has(c)) next.set(c, 0);
    return session.setLocal(next);
  }

  return {
    session,
    /** Once per frame, before the Brain animates: apply the newest steer update. */
    tick() { session.tick(); },
    /** The tissue glow factor for this frame (it dips while the lit path moves). */
    update(dt) {
      if (glow) {
        glow.t += dt * 1000;
        const half = LINK.glowFadeMs / 2;
        if (!glow.swapped && glow.t >= half) { tissue.setPath(glow.pts); glow.swapped = true; }
        glowK = glow.t < half ? 1 - glow.t / half : Math.min(1, (glow.t - half) / half);
        if (glow.t >= LINK.glowFadeMs) { glow = null; glowK = 1; }
      }
      return glowK;
    },
    // keyboard fallback (a demo with no network)
    zeroFlip: () => zero(session.flipChannels),
    zeroTop1() {
      const top = session.state?.result.top1.classId;
      return top === undefined ? false : zero(session.engine.topChannels(top, 5).map((c) => c.channel));
    },
    reset: () => session.reset(),
  };
}
