// Controller trackpad only: one pointer orbits, two pointers pinch to zoom.
// Callbacks receive deltas accumulated since the previous emission.
const MIN_INTERVAL_MS = 1000 / 30;
const MIN_DISTANCE_PX = 1;

export function create(el, { sensitivity = 1 } = {}) {
  if (!(el instanceof Element)) throw new TypeError('create expects one Element');

  const orbitListeners = new Set();
  const zoomListeners = new Set();
  const pointers = new Map();
  const originalStyles = new Map();
  const blockedStyles = {
    'touch-action': 'none',
    'overscroll-behavior': 'contain',
    'user-select': 'none',
    '-webkit-user-select': 'none',
    '-webkit-touch-callout': 'none',
  };
  for (const [property, value] of Object.entries(blockedStyles)) {
    originalStyles.set(property, [el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]);
    el.style.setProperty(property, value);
  }

  let gain = checkedSensitivity(sensitivity);
  let orbitX = 0;
  let orbitY = 0;
  let zoom = 0;
  let frame = 0;
  let lastFlush = -Infinity;
  let destroyed = false;

  function checkedSensitivity(value) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('sensitivity must be a finite nonnegative number');
    return value;
  }

  function flush(time) {
    frame = 0;
    if (destroyed || document.hidden) return;
    if (time - lastFlush < MIN_INTERVAL_MS) {
      schedule();
      return;
    }
    lastFlush = time;
    if (orbitX || orbitY) {
      const delta = { dx: orbitX, dy: orbitY };
      orbitX = 0;
      orbitY = 0;
      for (const listener of orbitListeners) listener(delta);
    }
    if (zoom) {
      const delta = zoom;
      zoom = 0;
      for (const listener of zoomListeners) listener(delta);
    }
    if (orbitX || orbitY || zoom) schedule();
  }

  function schedule() {
    if (!frame && !destroyed) frame = requestAnimationFrame(flush);
  }

  function pairDistance() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function point(event) {
    return { x: event.clientX, y: event.clientY };
  }

  function down(event) {
    if (document.hidden) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (pointers.has(event.pointerId) || pointers.size >= 2) return;
    pointers.set(event.pointerId, point(event));
    el.setPointerCapture?.(event.pointerId);
  }

  function move(event) {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    event.preventDefault();
    const beforeDistance = pointers.size === 2 ? pairDistance() : 0;
    const current = point(event);
    pointers.set(event.pointerId, current);
    if (pointers.size === 1) {
      orbitX += ((current.x - previous.x) / Math.max(1, el.clientWidth)) * gain;
      orbitY += ((current.y - previous.y) / Math.max(1, el.clientHeight)) * gain;
    } else {
      const afterDistance = pairDistance();
      zoom += Math.log(Math.max(MIN_DISTANCE_PX, afterDistance) / Math.max(MIN_DISTANCE_PX, beforeDistance)) * gain;
    }
    if (orbitX || orbitY || zoom) schedule();
  }

  function up(event) {
    if (!pointers.has(event.pointerId)) return;
    event.preventDefault();
    pointers.delete(event.pointerId);
    if (el.hasPointerCapture?.(event.pointerId)) el.releasePointerCapture(event.pointerId);
  }

  function block(event) { event.preventDefault(); }
  function cancel() {
    cancelAnimationFrame(frame); frame = 0;
    orbitX = orbitY = zoom = 0;
    for (const id of [...pointers.keys()]) {
      pointers.delete(id);
      if (el.hasPointerCapture?.(id)) el.releasePointerCapture(id);
    }
  }
  function visibility() { if (document.hidden) cancel(); }
  let landscape = innerWidth > innerHeight;
  function resize() {
    const next = innerWidth > innerHeight;
    if (next !== landscape) { landscape = next; cancel(); }
  }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', cancel);
  function subscribe(set, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    set.add(listener);
    return () => set.delete(listener);
  }

  el.addEventListener('pointerdown', down);
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', up);
  for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'dragstart', 'selectstart', 'contextmenu']) {
    el.addEventListener(type, block, { passive: false });
  }

  return {
    onOrbit: (listener) => subscribe(orbitListeners, listener),
    onZoom: (listener) => subscribe(zoomListeners, listener),
    setSensitivity(value) { gain = checkedSensitivity(value); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      cancelAnimationFrame(frame);
      pointers.clear();
      orbitListeners.clear();
      zoomListeners.clear();
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', cancel);
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('lostpointercapture', up);
      for (const type of ['gesturestart', 'gesturechange', 'gestureend', 'dblclick', 'dragstart', 'selectstart', 'contextmenu']) {
        el.removeEventListener(type, block);
      }
      for (const [property, [value, priority]] of originalStyles) {
        if (value) el.style.setProperty(property, value, priority);
        else el.style.removeProperty(property);
      }
    },
  };
}
