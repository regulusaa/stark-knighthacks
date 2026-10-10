// Brain tips (master plan 6.4): one glowing sphere per displayed class, a halo on tips that have a heatmap,
// the true-class ring, and invisible pick spheres for the mouse. The top-1 tip, the focused tip and the ring also
// have a faint twin drawn only where tissue hides them, so the chosen answer is never lost behind the brain.
import * as THREE from 'three';
import { inferno } from './inferno.js';
import { retireLater } from './scene.js';

export const TIPS = {
  radiusBase: 0.08,
  radiusScale: 0.12,          // radius = base + scale · sqrt(score)
  colorFloor: 0.25,           // colour = inferno(floor + (1 - floor) · sqrt(score)): faint tips stay visible
  otherRadius: 0.07,
  otherColor: 0x5d5763,
  haloColor: 0xfff1d0,
  haloOpacity: 0.85,
  ringRadius: 0.35,
  ringTube: 0.025,
  ringColor: 0x9ef0ff,
  pickRadius: 0.35,
  hoverScale: 1.2,
  dimLevel: 0.25,             // tip brightness before the reveal
  hiddenOpacity: 0.5,         // twins seen through tissue
  springOmega: 23,            // Steer: scores spring to their new values (critically damped, ~250 ms)
};

const tipRadius = (score) => TIPS.radiusBase + TIPS.radiusScale * Math.sqrt(Math.max(0, Math.min(1, score)));
const tipColor = (score, out) => out.copy(inferno(TIPS.colorFloor + (1 - TIPS.colorFloor) * Math.sqrt(Math.max(0, Math.min(1, score)))));

const sphereGeo = new THREE.SphereGeometry(1, 24, 16);
const pickGeo = new THREE.SphereGeometry(TIPS.pickRadius, 12, 8);
const haloGeo = new THREE.RingGeometry(1.28, 1.42, 40);
const ringGeo = new THREE.TorusGeometry(TIPS.ringRadius, TIPS.ringTube, 12, 64);
const pickMat = new THREE.MeshBasicMaterial({ visible: false });
const throughTissue = (color) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity: TIPS.hiddenOpacity, depthWrite: false, depthFunc: THREE.GreaterDepth, fog: false,
});

export function createTips() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: TIPS.ringColor, fog: false }));
  ring.visible = false;
  ring.renderOrder = 5;
  const ringHidden = new THREE.Mesh(ringGeo, throughTissue(TIPS.ringColor));
  ringHidden.renderOrder = 5;
  ring.add(ringHidden);
  group.add(ring);

  let tips = [];          // {classId, node, mesh, halo, pick, radius, color, isOther, hasHeatmap}
  const byClass = new Map();
  let hovered = null;
  let lit = 0;
  let focused = null;
  let litClass = null;    // the tip whose path is lit (the top-1); Steer can move it
  let moving = false;

  function dispose() {
    const old = [];
    for (const t of tips) {
      group.remove(t.mesh, t.pick);
      if (t.halo) { group.remove(t.halo); old.push(t.halo.material); }
      old.push(t.mesh.material, t.twin.material);
    }
    retireLater(old);
    tips = [];
    byClass.clear();
    hovered = null;
    focused = null;
    ring.visible = false;
  }

  function applyBrightness(t) {
    const k = TIPS.dimLevel + (1 - TIPS.dimLevel) * lit;
    t.mesh.material.color.copy(t.color).multiplyScalar(k);
    t.twin.material.color.copy(t.mesh.material.color);
  }
  function applyTwin(t) { t.twin.visible = !t.isOther && (t.classId === litClass || t.classId === focused); }
  function applySize(t) {
    const k = t.classId !== null && t.classId === hovered ? TIPS.hoverScale : 1;
    t.mesh.scale.setScalar(t.radius * k);
    t.halo?.scale.setScalar(t.radius * k);
  }

  return {
    group,
    ring,
    get pickables() { return tips.filter((t) => t.pick).map((t) => t.pick); },
    get list() { return tips; },
    build(layout, tree, gradcam) {
      dispose();
      litClass = tree.top1?.classId ?? null;
      const heat = new Map((gradcam?.classes || []).map((c) => [c.classId, c.hasHeatmap === true]));
      for (const v of layout.nodes.values()) {
        if (!v.isLeaf) continue;
        const n = v.node;
        const isOther = Boolean(n.isOther);
        const score = Math.max(0, n.value ?? 0);
        const radius = isOther ? TIPS.otherRadius : TIPS.radiusBase + TIPS.radiusScale * Math.sqrt(score);
        const color = isOther ? new THREE.Color(TIPS.otherColor) : inferno(TIPS.colorFloor + (1 - TIPS.colorFloor) * Math.sqrt(score));
        const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: color.clone() }));
        mesh.position.set(v.pos[0], v.pos[1], v.pos[2]);
        mesh.scale.setScalar(radius);
        mesh.renderOrder = 3;
        group.add(mesh);
        const twin = new THREE.Mesh(sphereGeo, throughTissue(color));
        twin.renderOrder = 3;
        mesh.add(twin);                  // follows the tip's position and hover scale
        const t = { classId: n.classId, node: n, mesh, twin, halo: null, pick: null, radius, color, isOther,
          hasHeatmap: !isOther && heat.get(n.classId) === true, score, target: score, vel: 0, pos: mesh.position,
          normal: new THREE.Vector3().fromArray(v.normal ?? v.dir) };
        if (t.hasHeatmap) {
          t.halo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({
            color: TIPS.haloColor, transparent: true, opacity: TIPS.haloOpacity, side: THREE.DoubleSide, depthWrite: false,
          }));
          t.halo.position.copy(mesh.position);
          t.halo.scale.setScalar(radius);
          t.halo.renderOrder = 4;
          group.add(t.halo);
        }
        if (!isOther) {
          t.pick = new THREE.Mesh(pickGeo, pickMat);
          t.pick.position.copy(mesh.position);
          t.pick.userData.classId = n.classId;
          group.add(t.pick);
          byClass.set(n.classId, t);
        }
        if (n.isTrueLabel) {
          ring.position.copy(mesh.position);
          ring.visible = true;
        }
        applyBrightness(t);
        applyTwin(t);
        tips.push(t);
      }
    },
    dispose,
    get(classId) { return byClass.get(classId) ?? null; },
    /** World position of a tip (includes the breathing group transform). */
    worldPosition(classId, target) {
      const t = byClass.get(classId);
      return t ? t.mesh.getWorldPosition(target) : null;
    },
    hover(classId) {
      if (hovered === classId) return;
      const prev = byClass.get(hovered);
      hovered = classId;
      if (prev) applySize(prev);
      const t = byClass.get(classId);
      if (t) applySize(t);
    },
    /** Steer: new scores per class id (the "other" tip keeps its size) and the class whose path is lit. */
    setScores(scoreOf, litClassId) {
      for (const t of tips) {
        if (t.isOther) continue;
        const s = scoreOf(t.classId);
        if (s !== undefined && s !== null) t.target = s;
      }
      moving = true;
      if (litClassId !== undefined && litClassId !== litClass) {
        litClass = litClassId;
        for (const t of tips) applyTwin(t);
      }
    },
    get litClass() { return litClass; },
    /** Springs toward the Steer scores; call every frame. */
    animate(dt) {
      if (!moving) return;
      const w = TIPS.springOmega;
      const steps = Math.max(1, Math.ceil(dt / 0.008));
      const h = dt / steps;
      let still = true;
      for (const t of tips) {
        if (t.isOther) continue;
        for (let i = 0; i < steps; i++) {
          t.vel += (-2 * w * t.vel - w * w * (t.score - t.target)) * h;
          t.score += t.vel * h;
        }
        if (Math.abs(t.score - t.target) < 1e-4 && Math.abs(t.vel) < 1e-3) { t.score = t.target; t.vel = 0; } else still = false;
        t.radius = tipRadius(t.score);
        tipColor(t.score, t.color);
        applySize(t);
        applyBrightness(t);
      }
      if (still) moving = false;
    },
    get hovered() { return hovered; },
    /** The focused tip also shows through tissue. */
    setFocused(classId) { focused = classId; for (const t of tips) applyTwin(t); },
    /** 0..1: brightness follows the strand reveal. */
    setLit(k) {
      if (k === lit) return;
      lit = k;
      for (const t of tips) applyBrightness(t);
    },
    update(camera) {
      // rings and halos always face the camera
      ring.quaternion.copy(camera.quaternion);
      for (const t of tips) if (t.halo) t.halo.quaternion.copy(camera.quaternion);
    },
  };
}
