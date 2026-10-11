// Mouse picking for Brain tips: hover enlarges, a click (not a drag) focuses, a click on empty space clears.
// Tips hidden behind tissue are skipped (`isHidden`), so you can't click through the brain. A click that misses
// every tip may still land on a fibre tract (`pickTrack`, seen through the translucent tissue): it selects that
// tract's leaf. Decorative fibres are never pickable.
import * as THREE from 'three';

const CLICK_PX = 5;

export function attachPicking(canvas, camera, tips, { onTip, onEmpty, isHidden = () => false, pickTrack = () => null }) {
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
    for (const h of hits) if (!isHidden(h.object.userData.classId)) return h.object.userData.classId;
    return null;
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
    if (id !== null) { onTip(id); return; }
    const r = canvas.getBoundingClientRect();
    const track = pickTrack(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
    if (track !== null) onTip(track);
    else onEmpty();
  });
  canvas.addEventListener('pointerleave', () => { tips.hover(null); canvas.style.cursor = ''; });
}
