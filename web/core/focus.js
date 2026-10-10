// Focus on one Brain tip (master plan 5 step 5–6): fly to a framing with both the tip and the image panel,
// show that class's heatmap if it has one (never invent one), and publish focus-state.
// The camera swings toward the tip's outward side (within limits that keep the panel facing the camera), so a tip
// on the far side of the brain comes into view instead of being framed through the tissue.
import * as THREE from 'three';

export const FOCUS = {
  swing: 0.75,                                    // how far toward the tip's outward normal the view turns (0..1)
  thetaRange: THREE.MathUtils.degToRad(55),       // max azimuth turn either way from the default view
  minPhi: THREE.MathUtils.degToRad(32),
  maxPhi: THREE.MathUtils.degToRad(92),
};

export function createFocus({ api, rig, panel, tips, labels, highlight = () => {} }) {
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const points = [];
  const tipPos = new THREE.Vector3();
  const tipPad = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const sph = new THREE.Spherical();
  const back = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let current = null;

  function panelCorners() {
    panel.group.updateWorldMatrix(true, false); // valid even before the first frame has rendered
    const b = panel.bounds;
    let i = 0;
    for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
      corners[i++].set(x, y, z).applyMatrix4(panel.group.matrixWorld);
    }
    return corners;
  }

  /** The view direction for a tip: the default direction swung toward the tip's outward normal, clamped. */
  function viewFor(tip) {
    const d = rig.defaultView;
    dir.setFromSphericalCoords(1, d.phi, d.theta).lerp(tip.normal, FOCUS.swing).normalize();
    sph.setFromVector3(dir);
    const dTheta = ((sph.theta - d.theta + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    return {
      theta: d.theta + THREE.MathUtils.clamp(dTheta, -FOCUS.thetaRange, FOCUS.thetaRange),
      phi: THREE.MathUtils.clamp(sph.phi, FOCUS.minPhi, FOCUS.maxPhi),
    };
  }

  /** The contract Answer for a tip: from the answer list, or built from topK for ranks beyond it. */
  function answerFor(classId) {
    const s = api.state;
    const listed = s?.answers.find((a) => a.classId === classId);
    if (listed) return { ...listed };
    const steered = api.steerAnswer?.(classId);   // Steer on: the steered score and rank
    if (steered) return steered;
    const tree = api.assets?.tree;
    const k = tree?.topK.find((e) => e.classId === classId)
      ?? (tree?.trueClass?.classId === classId ? tree.trueClass : null);
    if (!k) return null;
    const heat = api.assets.gradcam?.classes.find((c) => c.classId === classId);
    const source = heat?.hasHeatmap === true ? 'precomputed' : s?.capabilities.steer ? 'live' : null;
    return {
      classId, label: k.label, score: k.score, rank: k.rank, hasHeatmap: source !== null, heatmapSource: source,
      isTop1: classId === tree.top1.classId, isTrueClass: classId === tree.trueClass?.classId,
    };
  }

  return {
    get current() { return current; },
    focusTip(classId) {
      const answer = answerFor(classId);
      if (!answer || !tips.worldPosition(classId, tipPos)) {
        console.warn(`[stark] focusTip: class ${classId} is not a tip on this image`);
        return false;
      }
      current = classId;
      points.length = 0;
      points.push(...panelCorners());
      // pad the tip in the new view's screen axes, so its label (above it) also lands inside the frame
      const view = viewFor(tips.get(classId));
      back.setFromSphericalCoords(1, view.phi, view.theta);
      right.crossVectors(UP, back).normalize();
      up.crossVectors(back, right);
      for (const [dx, dy] of [[-1.4, -0.5], [1.4, 1.2]]) {
        points.push(tipPad.copy(tipPos).addScaledVector(right, dx).addScaledVector(up, dy).clone());
      }
      rig.flyToFit(points, undefined, undefined, undefined, view);
      api.showHeatmap(answer.hasHeatmap ? classId : null);
      labels.setFocused(classId);
      tips.setFocused(classId);
      highlight(classId);
      api.setFocus(answer);
      return true;
    },
    clearFocus({ resetView = true } = {}) {
      const had = current !== null;
      current = null;
      labels.setFocused(null);
      tips.setFocused(null);
      highlight(null);
      api.showHeatmap(null);
      if (resetView) rig.resetView();
      if (had || api.state?.focus) api.setFocus(null);
    },
    /** Image switched: forget the focus without flying (the new image resets the view itself). */
    reset() { current = null; labels.setFocused(null); tips.setFocused(null); highlight(null); },
  };
}
