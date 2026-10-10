// Camera rig (master plan 6.5): a damped spherical orbit around a target, smooth fly-to and reset.
// Damping eases the live camera toward a goal each frame; fly-to tweens the goal itself with easeInOutCubic.
import * as THREE from 'three';

export const RIG = {
  fov: 40,
  defaultPosition: new THREE.Vector3(7.7, 7.2, 20.3), // solved so panel + trunk + Brain volume fill NDC ±0.84 at 16:9
  defaultTarget: new THREE.Vector3(-1.8, 6.55, 0.1),
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
  let tween = null; // {t, ms}
  const tmp = new THREE.Vector3();
  const sphere = new THREE.Sphere();

  function clampSph(s) {
    s.phi = THREE.MathUtils.clamp(s.phi, RIG.minPolar, RIG.maxPolar);
    s.radius = THREE.MathUtils.clamp(s.radius, RIG.minDistance, RIG.maxDistance);
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
      goal.sph.theta -= dx * RIG.orbitSpeed;
      goal.sph.phi -= dy * RIG.orbitSpeed * 0.5;
      clampSph(goal.sph);
    },
    /** d > 0 zooms in; d is a log-scale step (contract control-zoom dz). */
    zoom(d) {
      tween = null;
      goal.sph.radius *= Math.exp(-d);
      clampSph(goal.sph);
    },
    /** Fly so the box fills the view, keeping the current viewing direction. */
    flyTo(box, ms = RIG.flyMs) {
      box.getBoundingSphere(sphere);
      const fit = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov) / 2);
      to.target.copy(sphere.center);
      to.sph.copy(goal.sph);
      to.sph.radius = fit * 1.08;
      clampSph(to.sph);
      startTween(ms);
    },
    resetView(ms = RIG.flyMs) {
      viewOf(RIG.defaultPosition, RIG.defaultTarget, to);
      startTween(ms);
    },
    /** Snap without animation (only for jump-to-end style resets and screenshots). */
    snapToDefault() {
      tween = null;
      viewOf(RIG.defaultPosition, RIG.defaultTarget, goal);
      live.target.copy(goal.target);
      live.sph.copy(goal.sph);
      apply();
    },
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
