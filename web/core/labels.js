// Tip labels (master plan 6.4): canvas-texture sprites. Top-1, the true class and the focused tip are always
// shown; others only when the camera is within 7 units and the tip isn't behind tissue (`isHidden`).
// Overlapping labels: the lower-priority one is hidden. A label that would rise into the HUD band at the top of the
// screen hangs below its tip instead.
import * as THREE from 'three';

export const LABELS = {
  fontPx: 64,
  worldHeight: 0.35,
  backing: 'rgba(5, 2, 8, 0.6)',
  text: '#f4ecff',
  top1Text: '#ffd98a',
  trueText: '#9ef0ff',
  nearDistance: 7,
  checkEveryMs: 100,
  lift: 0.32,          // world units above the tip
  minPx: 18,           // on-screen label height is clamped to this range (at 1080p; scales with the viewport)
  maxPx: 30,
  hudBand: 0.13,       // fraction of the screen height at the top that labels stay out of
};

function makeTexture(text, color) {
  const pad = 22;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = `600 ${LABELS.fontPx}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  const h = Math.ceil(LABELS.fontPx * 1.35);
  c.width = w;
  c.height = h;
  g.font = font;
  g.fillStyle = LABELS.backing;
  const r = h / 2;
  g.beginPath();
  g.roundRect(0, 0, w, h, r);
  g.fill();
  g.fillStyle = color;
  g.textBaseline = 'middle';
  g.fillText(text, pad, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  return { tex, aspect: w / h };
}

export function createLabels({ isHidden = () => false } = {}) {
  const group = new THREE.Group();
  let labels = []; // {classId, sprite, priority, always, aspect, visible}
  let focused = null;
  let sinceCheck = Infinity;
  const tmp = new THREE.Vector3();
  const rects = [];   // reused: kept screen rectangles [x0, y0, x1, y1]
  const order = [];   // reused: labels sorted by priority

  function dispose() {
    for (const l of labels) { group.remove(l.sprite); l.sprite.material.map.dispose(); l.sprite.material.dispose(); }
    labels = [];
  }

  let near = LABELS.nearDistance;
  return {
    group,
    get list() { return labels; },
    get nearDistance() { return near; },
    set nearDistance(d) { near = d; },
    build(tipList) {
      dispose();
      for (const t of tipList) {
        if (t.isOther) continue;
        const n = t.node;
        const isTop1 = n.onTop1Path;
        const isTrue = n.isTrueLabel;
        const { tex, aspect } = makeTexture(`${n.label}  ${t.score.toFixed(2)}`,
          isTop1 ? LABELS.top1Text : isTrue ? LABELS.trueText : LABELS.text);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, fog: false, transparent: true }));
        sprite.scale.set(LABELS.worldHeight * aspect, LABELS.worldHeight, 1);
        sprite.center.set(0.5, 0);
        const above = t.pos.clone();
        above.y += t.radius + LABELS.lift * 0.4;
        const below = t.pos.clone();
        below.y -= t.radius + LABELS.lift * 0.4;
        sprite.position.copy(above);
        sprite.renderOrder = 10;
        sprite.visible = false;
        group.add(sprite);
        labels.push({ classId: t.classId, sprite, aspect, tip: t, above, below, flipped: false,
          baseAlways: isTop1 || isTrue,
          // higher wins an overlap: always-visible first, then by score
          priority: (isTop1 ? 3 : isTrue ? 2 : 0) + t.score });
      }
      order.length = 0;
      sinceCheck = Infinity;
    },
    dispose,
    setFocused(classId) { focused = classId; sinceCheck = Infinity; },
    /**
     * Every frame: keep each label's on-screen height within minPx..maxPx (world height 0.35 otherwise),
     * so a tip right next to the camera doesn't get a giant label. About 10× a second: visibility + overlaps.
     */
    update(camera, viewW, viewH, dtMs) {
      const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const k = viewH / 1080;
      for (const l of labels) {
        l.sprite.getWorldPosition(tmp);
        const d = Math.max(0.01, tmp.distanceTo(camera.position));
        const px = (LABELS.worldHeight / (2 * d * tanHalf)) * viewH;
        const clamped = Math.min(LABELS.maxPx * k, Math.max(LABELS.minPx * k, px));
        const h = LABELS.worldHeight * (clamped / px);
        l.sprite.scale.set(h * l.aspect, h, 1);
        l.px = clamped;
      }
      sinceCheck += dtMs;
      if (sinceCheck < LABELS.checkEveryMs) return;
      sinceCheck = 0;
      order.length = 0;
      for (const l of labels) order.push(l);
      order.sort((a, b) => (b.classId === focused) - (a.classId === focused) || b.priority - a.priority);
      rects.length = 0;
      for (const l of order) {
        l.sprite.getWorldPosition(tmp);
        const d = tmp.distanceTo(camera.position);
        const always = l.baseAlways || l.classId === focused;
        let show = always || (d < near && !isHidden(l.classId));
        if (show) {
          const hPx = l.px;
          const wPx = hPx * l.aspect;
          // above the tip unless that would reach into the HUD band; then hang below it
          tmp.copy(l.above).applyMatrix4(group.matrixWorld).project(camera);
          if (tmp.z > 1 || Math.abs(tmp.x) > 1.1 || Math.abs(tmp.y) > 1.1) show = always; // off screen
          let x = (tmp.x * 0.5 + 0.5) * viewW;
          let y = (1 - (tmp.y * 0.5 + 0.5)) * viewH;
          const flip = y - hPx < LABELS.hudBand * viewH;
          if (flip !== l.flipped) {
            l.flipped = flip;
            l.sprite.position.copy(flip ? l.below : l.above);
            l.sprite.center.set(0.5, flip ? 1 : 0);
          }
          if (flip) {
            tmp.copy(l.below).applyMatrix4(group.matrixWorld).project(camera);
            x = (tmp.x * 0.5 + 0.5) * viewW;
            y = (1 - (tmp.y * 0.5 + 0.5)) * viewH + hPx;   // centre (0.5, 1): the rect hangs below this point
          }
          const r = [x - wPx / 2, y - hPx, x + wPx / 2, y];
          if (show && !always) {
            for (const k of rects) if (r[0] < k[2] && r[2] > k[0] && r[1] < k[3] && r[3] > k[1]) { show = false; break; }
          } else if (show) {
            // always-visible labels still yield to an earlier (higher-priority) always-visible one
            for (const k of rects) if (r[0] < k[2] && r[2] > k[0] && r[1] < k[3] && r[3] > k[1]) { show = l.classId === focused; break; }
          }
          if (show) rects.push(r);
          l.rect = r;
        }
        l.sprite.visible = show;
      }
    },
  };
}
