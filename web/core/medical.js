// The medical card (master plan section 10): fan trees (brainLayout.js fanSites) show one strand per finding, each
// sized and lit by its own independent score. This module adds the permanent reading note above the fan, shown
// whenever the image's scores are independent.
import * as THREE from 'three';

export const MEDICAL = {
  note: 'Independent scores · each 0–100% on its own · not a diagnosis',
  fontPx: 56,
  height: 0.2,           // world units (the sprite's text height)
  above: 1.1,            // world units above the highest tip (clear of its label)
  color: '#e8dcf5',
  order: 21,             // over the tissue and the tips
};

function noteTexture(text) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `500 ${MEDICAL.fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font;
  const pad = MEDICAL.fontPx * 0.5;
  c.width = Math.ceil(g.measureText(text).width + pad * 2);
  c.height = Math.ceil(MEDICAL.fontPx * 1.5);
  g.font = font;
  g.fillStyle = 'rgba(16, 8, 24, 0.62)';
  const r = c.height / 2;
  g.beginPath();
  g.roundRect(0, 0, c.width, c.height, r);
  g.fill();
  g.fillStyle = MEDICAL.color;
  g.textBaseline = 'middle';
  g.fillText(text, pad, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: c.width / c.height };
}

export function createMedical({ api, tips, parent }) {
  const { tex, aspect } = noteTexture(MEDICAL.note);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, fog: false }));
  sprite.scale.set(MEDICAL.height * 1.5 * aspect, MEDICAL.height * 1.5, 1);
  sprite.renderOrder = MEDICAL.order;
  sprite.visible = false;
  parent.add(sprite);

  api.onImageLoaded(() => {
    const independent = api.assets?.tree?.scoreKind === 'independent';
    sprite.visible = independent && tips.list.length > 0;
    if (!sprite.visible) return;
    // centred over the fan, just above its highest tip
    const box = new THREE.Box3();
    for (const t of tips.list) box.expandByPoint(t.mesh.position);
    const c = box.getCenter(new THREE.Vector3());
    sprite.position.set(c.x, box.max.y + MEDICAL.above, c.z);
  });

  return { sprite };
}
