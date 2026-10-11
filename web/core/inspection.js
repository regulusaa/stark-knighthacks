// Shared component placement. Geometry stays in authored coordinates; only its two owner groups move.
import * as THREE from 'three';
import { fitView } from './framing.js';
import { ANATOMY } from './brainShape.js';

const PARTS = ['brain', 'stem'];
const SAFE = { x0: -.86, x1: .86, y0: -.86, y1: .78 };
const round = n => Math.round(n * 1e5) / 1e5;
function sample(mesh, max = 650) {
  const g = mesh.geometry, p = g.attributes.position, out = [];
  const count = g.index?.count ?? p.count;
  for (let i = 0; i < count; i += Math.max(1, Math.ceil(count / max))) {
    const j = g.index ? g.index.getX(i) : i;
    out.push(new THREE.Vector3().fromBufferAttribute(p, j));
  }
  if (!g.boundingBox) g.computeBoundingBox();
  const box=g.boundingBox;
  for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])out.push(new THREE.Vector3(x,y,z));
  return out;
}
export function createInspection({ brain, stem, tissue, fibers, rig, camera, preview = false, extraPoints = null }) {
  const targets = { brain: new THREE.Vector3(), stem: new THREE.Vector3() };
  const groups = { brain, stem };
  const points = { brain: sample(tissue.parts.brain), stem: [...sample(tissue.parts.stem, 250), ...sample(fibers.mesh, 250)] };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let selected = 'all', arrangement = 'joined', view = 'all', ack = null, remote = null;
  const seen = new Map(), back = new THREE.Vector3(), right = new THREE.Vector3();
  let revision = 0, homeRadius = 25;
  const subscribers = new Set();
  const notify = () => { revision++; for (const cb of subscribers) cb(snapshot()); };
  function worldPoints(part = 'all', goal = true) {
    const out = [];
    for (const name of PARTS) if (part === 'all' || part === name) {
      const offset = goal ? targets[name] : groups[name].position;
      for (const p of points[name]) out.push([p.x + offset.x, p.y + offset.y, p.z + offset.z]);
    }
    if (part === 'all' && extraPoints) out.push(...extraPoints());   // world-space extras (the assessed image)
    return out;
  }
  function fit(part = 'all', aspect = camera.aspect, direction = null, goal = true) {
    const s = rig.state.spherical;
    back.setFromSphericalCoords(1, s.phi, s.theta);
    const dir = direction ?? back.toArray();
    return { ...fitView(worldPoints(part, goal), { back: dir, fov: camera.fov, aspect, safe: { ...SAFE, y0: preview ? -.86 : -.72 } }), back: dir, fov: camera.fov };
  }
  let homeBack = null;   // the default view direction (captured at load): Reset returns to it
  function frame(part = 'all', snap = false, direction = null) {
    view = part;
    const v = fit(part, camera.aspect, direction);
    if(part==='all')homeRadius=v.radius;
    // Inspect fills the pane, but keeps the complete selected part visible at the end of the fly.
    rig.chase(v, { snap: snap || reduced });
  }
  function snapshot() {
    const sph = rig.state.spherical;
    const back = new THREE.Vector3().setFromSphericalCoords(1, sph.phi, sph.theta).toArray();
    const fitPart = view === 'free' ? 'all' : view;
    const f = fit(fitPart, camera.aspect, back, false);
    return {
      version: 1, revision, selected, arrangement, view, ack,
      offsets: Object.fromEntries(PARTS.map(p => [p, targets[p].toArray().map(round)])),
      positions: Object.fromEntries(PARTS.map(p => [p, groups[p].position.toArray().map(round)])),
      camera: { target: rig.state.target.toArray().map(round), back: back.map(round), radius: round(sph.radius),
        fit: { target: f.target.map(round), radius: round(f.radius) }, aspect: camera.aspect },
    };
  }
  function action(p) {
    if (!p || !['select','split','join','move','inspect','center'].includes(p.action)) return false;
    if (p.from && Number.isSafeInteger(p.seq)) {
      if (p.seq <= (seen.get(p.from) ?? -1)) return false;
      seen.set(p.from, p.seq); ack = { clientId: p.from, seq: p.seq };
      if (seen.size > 32) seen.delete(seen.keys().next().value);
    }
    if (p.action === 'select' && ['brain','stem','all'].includes(p.part)) selected = p.part;
    else if (p.action === 'split') {
      right.set(1,0,0).applyQuaternion(camera.quaternion); right.y = 0; right.normalize();
      targets.brain.copy(right).multiplyScalar(-3.8);
      targets.stem.copy(right).multiplyScalar(4.8); targets.stem.y = 3.2;
      arrangement = 'split'; frame('all');
    } else if (p.action === 'join') {
      targets.brain.set(0,0,0); targets.stem.set(0,0,0); arrangement = 'joined'; frame('all');
    } else if (p.action === 'move' && PARTS.includes(p.part) && p.position?.length === 3 && p.position.every(Number.isFinite)) {
      targets[p.part].fromArray(p.position.map(n => THREE.MathUtils.clamp(n,-16,16)));
      arrangement = 'custom'; view = 'free';
    } else if (p.action === 'inspect') {
      if (['brain','stem','all'].includes(p.part)) selected = p.part;
      frame(selected);
    } else if (p.action === 'center') frame('all');
    notify(); return true;
  }
  function applyRemote(s, { snap = false } = {}) {
    if (!s?.camera || !s.offsets?.brain || !s.offsets?.stem) return;
    selected = s.selected; arrangement = s.arrangement; view = s.view; ack = s.ack; remote = s;
    for (const part of PARTS) {
      targets[part].fromArray(s.offsets[part]);
      if (snap) groups[part].position.fromArray(s.positions?.[part] ?? s.offsets[part]);
    }
    const c = s.camera, f = fit(view === 'free' ? 'all' : view, camera.aspect, c.back, false);
    const base = c.fit ?? f;
    rig.chase({ target: c.target.map((n,i) => n + f.target[i] - base.target[i]), back: c.back,
      radius: c.radius * f.radius / Math.max(.1, base.radius) }, { snap });
  }
  return {
    groups, targets, points, action, snapshot, fit, worldPoints, applyRemote,
    get detail() { return view==='brain'||view==='stem'||rig.state.spherical.radius<homeRadius*.74; },
    get selected() { return selected; }, get arrangement() { return arrangement; }, get view() { return view; },
    onChange(cb) { subscribers.add(cb); return () => subscribers.delete(cb); },
    center: () => action({ action: 'center' }),
    cancelCamera() { view = 'free'; },
    initial() {
      const s = rig.state.spherical;
      homeBack = new THREE.Vector3().setFromSphericalCoords(1, s.phi, s.theta).toArray();
      frame('all', true);
    },
    /** Reset: the whole assembly and the assessed image, from the default direction (Center keeps the current one). */
    home() { frame('all', false, homeBack); notify(); },
    resize() { if (preview && remote) applyRemote(remote); else if (view !== 'free') frame(view); },
    handlePosition(part, out = new THREE.Vector3()) {
      return out.fromArray(part === 'brain' ? ANATOMY.origin : [0,5,0]).add(groups[part].position);
    },
    update(dt) {
      const a = reduced ? 1 : 1 - Math.pow(.92, dt * 60);
      for (const part of PARTS) {
        groups[part].position.lerp(targets[part], a);
        if (groups[part].position.distanceToSquared(targets[part]) < 1e-10) groups[part].position.copy(targets[part]);
      }
    },
  };
}
