// Mouse and keyboard fallback controls (master plan 12.6 step 3). Everything goes through the api.
import { TRUNK } from './trunk.js';

export function attachInput(canvas, api, hud) {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = (e.clientX - drag.x) / canvas.clientWidth;
    const dy = (e.clientY - drag.y) / canvas.clientHeight;
    drag.x = e.clientX;
    drag.y = e.clientY;
    api.orbit(dx, dy);
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    api.zoom(-e.deltaY * 0.0015);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key)) {
      // the number key is the manifest "order" (contract 2.1), so gaps (e.g. 2 before FGSM exists) do nothing
      const img = api.manifest.find((m) => m.order === Number(e.key));
      if (img) api.loadImage(img.id);
      return;
    }
    const speeds = TRUNK.speeds;
    const i = speeds.indexOf(api.state?.playback.speed ?? 1);
    switch (e.key.toLowerCase()) {
      case 'r': api.resetView(); break;
      case ' ': e.preventDefault(); api.replay(); break;
      case 'e': api.jumpToEnd(); break;
      case '[': api.setSpeed(speeds[Math.max(0, i - 1)]); break;
      case ']': api.setSpeed(speeds[Math.min(speeds.length - 1, i + 1)]); break;
      case 'g': api.toggleHeatmap(); break;
      case 'h': hud.setVisible(!hud.visible); break;
      default: return;
    }
  });
}
