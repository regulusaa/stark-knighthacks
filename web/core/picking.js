// Mouse picking for Brain tips: hover enlarges, a click (not a drag) focuses, a click on empty space clears.
import * as THREE from 'three';

const CLICK_PX = 5;

export function attachPicking(canvas, camera, tips, { onTip, onEmpty }) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits = [];
  let down = null;

  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    hits.length = 0;
    ray.intersectObjects(tips.pickables, false, hits);
    return hits.length ? hits[0].object.userData.classId : null;
  }

  canvas.addEventListener('pointermove', (e) => {
    if (down) return; // dragging: no hover changes
    const id = pick(e);
    tips.hover(id);
    canvas.style.cursor = id === null ? '' : 'pointer';
  });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    const d = down;
    down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_PX) return;
    const id = pick(e);
    if (id === null) onEmpty();
    else onTip(id);
  });
  canvas.addEventListener('pointerleave', () => { tips.hover(null); canvas.style.cursor = ''; });
}
