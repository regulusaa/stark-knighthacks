// Focus on one Brain tip (master plan 5 step 5–6): fly to a framing with both the tip and the image panel,
// show that class's heatmap if it has one (never invent one), and publish focus-state.
import * as THREE from 'three';

export function createFocus({ api, rig, panel, tips, labels }) {
  const corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const points = [];
  const tipPos = new THREE.Vector3();
  const tipPad = new THREE.Vector3();
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

  /** The contract Answer for a tip: from the answer list, or built from topK for ranks beyond it. */
  function answerFor(classId) {
    const s = api.state;
    const listed = s?.answers.find((a) => a.classId === classId);
    if (listed) return { ...listed };
    const tree = api.assets?.tree;
    const k = tree?.topK.find((e) => e.classId === classId)
      ?? (tree?.trueClass?.classId === classId ? tree.trueClass : null);
    if (!k) return null;
    const heat = api.assets.gradcam?.classes.find((c) => c.classId === classId);
    return {
      classId, label: k.label, score: k.score, rank: k.rank, hasHeatmap: heat?.hasHeatmap === true,
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
      // pad the tip so its label (above it) also lands inside the frame
      for (const [dx, dy] of [[-1.2, -0.4], [1.2, 0.9]]) points.push(tipPad.copy(tipPos).add(new THREE.Vector3(dx, dy, 0)).clone());
      rig.flyToFit(points);
      api.showHeatmap(answer.hasHeatmap ? classId : null);
      labels.setFocused(classId);
      api.setFocus(answer);
      return true;
    },
    clearFocus({ resetView = true } = {}) {
      const had = current !== null;
      current = null;
      labels.setFocused(null);
      api.showHeatmap(null);
      if (resetView) rig.resetView();
      if (had || api.state?.focus) api.setFocus(null);
    },
    /** Image switched: forget the focus without flying (the new image resets the view itself). */
    reset() { current = null; labels.setFocused(null); },
  };
}
