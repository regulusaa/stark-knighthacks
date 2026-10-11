// Mouse and keyboard fallback controls (master plan 12.6 step 3). Everything goes through the api.
// Keys: 1–9 image (manifest order) · R reset view · Space replay · E end · [ ] speed · G heatmap · H HUD · Esc unfocus
//       Steer (no network needed): F zero the image's flip channels · Shift+F zero the top-5 channels of the current
//       top-1 (again to keep going) · X reset Steer
//       (v3) N noise view · A the other image of the adversarial pair · B glow
import { TRUNK } from './trunk.js';
import { create as createGestures } from '/ui/gestures.js';

export function attachInput(canvas, api, hud, steer = {}) {
  const gestures = createGestures(canvas, { sensitivity: 1 });
  gestures.onOrbit(({ dx, dy }) => api.orbit(dx, dy));
  gestures.onZoom(dz => api.zoom(dz));
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
      case 'escape': api.clearFocus(); break;
      case 'f': if (e.shiftKey) steer.zeroTop1?.(); else steer.zeroFlip?.(); break;
      case 'x': steer.reset?.(); break;
      case 'n': if (api.state?.capabilities.noiseView) api.setMode({ noiseView: !api.state.noiseView }); break;
      case 'a': { const pair = api.state && api.pairOf(api.state.image.id); if (pair) api.loadImage(pair); break; }
      case 'b': if (api.state) api.setMode({ bloom: !api.state.bloom }); break;
      default: return;
    }
  });
}
