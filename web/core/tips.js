// Brain tips (master plan 6.4): one glowing sphere per displayed class, a halo on tips that have a heatmap,
// the true-class ring, and invisible pick spheres for the mouse.
import * as THREE from 'three';
import { inferno } from './inferno.js';

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
};

const sphereGeo = new THREE.SphereGeometry(1, 24, 16);
const pickGeo = new THREE.SphereGeometry(TIPS.pickRadius, 12, 8);
const haloGeo = new THREE.RingGeometry(1.28, 1.42, 40);
const ringGeo = new THREE.TorusGeometry(TIPS.ringRadius, TIPS.ringTube, 12, 64);
const pickMat = new THREE.MeshBasicMaterial({ visible: false });

export function createTips() {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: TIPS.ringColor, fog: false }));
  ring.visible = false;
  ring.renderOrder = 5;
  group.add(ring);

  let tips = [];          // {classId, node, mesh, halo, pick, radius, color, isOther, hasHeatmap}
  const byClass = new Map();
  let hovered = null;
  let lit = 0;

  function dispose() {
    for (const t of tips) {
      group.remove(t.mesh, t.pick);
      if (t.halo) { group.remove(t.halo); t.halo.material.dispose(); }
      t.mesh.material.dispose();
    }
    tips = [];
    byClass.clear();
    hovered = null;
    ring.visible = false;
  }

  function applyBrightness(t) {
    const k = TIPS.dimLevel + (1 - TIPS.dimLevel) * lit;
    t.mesh.material.color.copy(t.color).multiplyScalar(k);
  }

  return {
    group,
    ring,
    get pickables() { return tips.filter((t) => t.pick).map((t) => t.pick); },
    get list() { return tips; },
    build(layout, tree, gradcam) {
      dispose();
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
        const t = { classId: n.classId, node: n, mesh, halo: null, pick: null, radius, color, isOther,
          hasHeatmap: !isOther && heat.get(n.classId) === true, score, pos: mesh.position };
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
      if (prev) { prev.mesh.scale.setScalar(prev.radius); prev.halo?.scale.setScalar(prev.radius); }
      hovered = classId;
      const t = byClass.get(classId);
      if (t) { t.mesh.scale.setScalar(t.radius * TIPS.hoverScale); t.halo?.scale.setScalar(t.radius * TIPS.hoverScale); }
    },
    get hovered() { return hovered; },
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
