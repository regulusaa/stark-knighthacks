// Camera rig (master plan 6.5): a damped spherical orbit around a target, smooth fly-to and reset.
// Damping eases the live camera toward a goal each frame; fly-to tweens the goal itself with easeInOutCubic.
// The default view adapts to the viewport (framing.js via setDefault): same direction as RIG's authored view, with
// the distance, target and lens solved so the Brain and the source image fit. Zoom limits scale with that distance.
import * as THREE from 'three';

export const RIG = {
  fov: 40,
  // A raised posterior-lateral three-quarter view (azimuth 41°, polar 68°): cerebellum, brainstem and the top of the
  // fissure all show. Solved numerically at 16:9: every tissue vertex (the spinal cord to its end included) and the
  // panel within NDC x ±0.95, y −0.95..0.73 (the top band kept for the HUD and the tips riding the crown).
  defaultPosition: new THREE.Vector3(6.86, 14.93, 12.5),
  defaultTarget: new THREE.Vector3(-2.36, 9.26, 1.91),
  damping: 0.08,                 // fraction of the remaining gap closed per 60 Hz frame
  minPolar: THREE.MathUtils.degToRad(20),
  maxPolar: THREE.MathUtils.degToRad(100),
  minDistance: 6,
  maxDistance: 30,
  flyMs: 1200,
  orbitSpeed: Math.PI,           // a full-width drag turns 180°
};

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const TAU = Math.PI * 2;

export function createCameraRig(camera) {
  camera.fov = RIG.fov;
  camera.updateProjectionMatrix();

  // goal = where the camera is heading; live = what is rendered (damped toward goal)
  const goal = { target: new THREE.Vector3(), sph: new THREE.Spherical() };
  const live = { target: new THREE.Vector3(), sph: new THREE.Spherical() };
  const from = { target: new THREE.Vector3(), sph: new THREE.Spherical() };
  const to = { target: new THREE.Vector3(), sph: new THREE.Spherical() };
  const scratch = { target: new THREE.Vector3(), sph: new THREE.Spherical() };
  let tween = null; // {t, ms}
  const tmp = new THREE.Vector3();
  const sphere = new THREE.Sphere();
  const fitBox = new THREE.Box3();
  const dir = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const rel = new THREE.Vector3();
  const tmpSph = new THREE.Spherical();
  const UP = new THREE.Vector3(0, 1, 0);
  // the default view for this viewport (starts as the authored one); zoom limits scale with its distance
  const home = { target: RIG.defaultTarget.clone(), position: RIG.defaultPosition.clone() };
  const authoredRadius = RIG.defaultPosition.distanceTo(RIG.defaultTarget);
  let limitScale = 1;
  let atHome = true;    // nothing has moved the camera since the last reset: a new viewport re-frames it

  function clampSph(s) {
    s.phi = THREE.MathUtils.clamp(s.phi, RIG.minPolar, RIG.maxPolar);
    s.radius = THREE.MathUtils.clamp(s.radius, RIG.minDistance * limitScale, RIG.maxDistance * limitScale);
    return s;
  }
  function viewOf(position, target, out) {
    out.target.copy(target);
    out.sph.setFromVector3(tmp.copy(position).sub(target));
    clampSph(out.sph);
    return out;
  }
  function apply() {
    tmp.setFromSpherical(live.sph).add(live.target);
    camera.position.copy(tmp);
    camera.lookAt(live.target);
  }
  function startTween(ms) {
    from.target.copy(goal.target);
    from.sph.copy(goal.sph);
    // take the short way round in azimuth
    to.sph.theta = from.sph.theta + ((((to.sph.theta - from.sph.theta) % TAU) + TAU + Math.PI) % TAU) - Math.PI;
    tween = { t: 0, ms };
  }

  // start exactly at the default view
  viewOf(RIG.defaultPosition, RIG.defaultTarget, goal);
  live.target.copy(goal.target);
  live.sph.copy(goal.sph);
  apply();

  return {
    /** dx, dy: drag as a fraction of the drag area (−1..1); +x = drag right, +y = drag down. */
    orbit(dx, dy) {
      tween = null;
      atHome = false;
      goal.sph.theta -= dx * RIG.orbitSpeed;
      goal.sph.phi -= dy * RIG.orbitSpeed * 0.5;
      clampSph(goal.sph);
    },
    /** d > 0 zooms in; d is a log-scale step (contract control-zoom dz). */
    zoom(d) {
      tween = null;
      atHome = false;
      goal.sph.radius *= Math.exp(-d);
      clampSph(goal.sph);
    },
    /** Fly so the box fills the view, keeping the current viewing direction. */
    flyTo(box, ms = RIG.flyMs) {
      atHome = false;
      box.getBoundingSphere(sphere);
      const fit = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
      to.target.copy(sphere.center);
      to.sph.copy(goal.sph);
      to.sph.radius = fit * 1.08;
      clampSph(to.sph);
      startTween(ms);
    },
    /**
     * Fly so every point fits inside ±margin of the screen (NDC), keeping the current viewing direction, or
     * looking from `view` ({theta, phi}, radians) when given.
     * Solved exactly per point: depth along the view and the horizontal/vertical half-angles give the distance.
     */
    flyToFit(points, ms = RIG.flyMs, margin = 0.84, topMargin = 0.76, view = null) {
      atHome = false;
      fitBox.makeEmpty();
      for (const p of points) fitBox.expandByPoint(p);
      fitBox.getCenter(to.target);
      to.sph.copy(goal.sph);
      if (view) { to.sph.theta = view.theta; to.sph.phi = view.phi; clampSph(to.sph); }
      dir.setFromSpherical(tmpSph.set(1, to.sph.phi, to.sph.theta));
      right.crossVectors(UP, dir).normalize();
      up.crossVectors(dir, right);
      const tanFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const tanV = tanFov * margin;
      const tanTop = tanFov * topMargin;  // the top of the screen is kept clear for the HUD
      const tanH = tanV * camera.aspect;
      let need = 0;
      for (const p of points) {
        rel.copy(p).sub(to.target);
        const along = rel.dot(dir);
        const y = rel.dot(up);
        need = Math.max(need, along + Math.abs(rel.dot(right)) / tanH, along + (y > 0 ? y / tanTop : -y / tanV));
      }
      to.sph.radius = need;
      clampSph(to.sph);
      startTween(ms);
    },
    resetView(ms = RIG.flyMs) {
      viewOf(home.position, home.target, to);
      startTween(ms);
      atHome = true;
    },
    /**
     * The default view for the current viewport: {target, radius, back, fov} from framing.js. If the camera is at
     * home (initial load, after Reset, or flying back), it goes straight to the new default.
     */
    setDefault({ target, radius, back, fov }) {
      home.target.fromArray(target);
      home.position.fromArray(back).multiplyScalar(radius).add(home.target);
      limitScale = radius / authoredRadius;
      if (camera.fov !== fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
      if (!atHome) return;
      if (tween) { viewOf(home.position, home.target, to); startTween(Math.max(1, tween.ms - tween.t)); return; }
      this.snapToDefault();
    },
    get home() { return { target: home.target.clone(), position: home.position.clone(), fov: camera.fov }; },
    get atHome() { return atHome; },
    /** Snap without animation (only for jump-to-end style resets and screenshots). */
    snapToDefault() {
      tween = null;
      atHome = true;
      viewOf(home.position, home.target, goal);
      live.target.copy(goal.target);
      live.sph.copy(goal.sph);
      apply();
    },
    /** Snap to an explicit view without animation (debug views and screenshots). */
    snapTo(position, target) {
      tween = null;
      atHome = false;
      viewOf(position, target, goal);
      live.target.copy(goal.target);
      live.sph.copy(goal.sph);
      apply();
    },
    /** The default view's direction, as {theta, phi}. */
    get defaultView() { viewOf(RIG.defaultPosition, RIG.defaultTarget, scratch); return { theta: scratch.sph.theta, phi: scratch.sph.phi }; },
    get moving() { return Boolean(tween); },
    get state() { return { target: live.target, spherical: live.sph }; },
    update(dt) {
      if (tween) {
        tween.t += dt * 1000;
        const k = easeInOutCubic(Math.min(1, tween.t / tween.ms));
        goal.target.lerpVectors(from.target, to.target, k);
        goal.sph.radius = from.sph.radius + (to.sph.radius - from.sph.radius) * k;
        goal.sph.phi = from.sph.phi + (to.sph.phi - from.sph.phi) * k;
        goal.sph.theta = from.sph.theta + (to.sph.theta - from.sph.theta) * k;
        if (tween.t >= tween.ms) tween = null;
        // during a fly the tween already eases, so the live camera follows it exactly
        live.target.copy(goal.target);
        live.sph.copy(goal.sph);
      } else {
        const a = 1 - Math.pow(1 - RIG.damping, dt * 60); // frame-rate independent damping
        live.target.lerp(goal.target, a);
        live.sph.radius += (goal.sph.radius - live.sph.radius) * a;
        live.sph.phi += (goal.sph.phi - live.sph.phi) * a;
        live.sph.theta += (goal.sph.theta - live.sph.theta) * a;
      }
      apply();
    },
  };
}
