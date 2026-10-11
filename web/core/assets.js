// Loads pipeline outputs (contract v1 section 2). Checks only the shapes the display relies on.
// A missing or broken file never throws to the caller: it yields a placeholder and a console warning.
import * as THREE from 'three';

const loader = new THREE.TextureLoader();

async function fetchJson(url, schema) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = await res.json();
  if (schema && data.schema !== schema) throw new Error(`${url}: expected schema ${schema}, got ${data.schema}`);
  return data;
}

export async function loadManifest() {
  try {
    const m = await fetchJson('/assets/manifest.json', 'stark.manifest/1');
    if (!Array.isArray(m.images)) throw new Error('manifest.images missing');
    return m.images.slice().sort((a, b) => a.order - b.order);
  } catch (err) {
    console.warn('[stark] manifest unavailable:', err.message);
    return [];
  }
}

/** A visible "missing" texture: dark magenta checker with a label, so a gap is obvious on screen. */
let placeholder = null;
export function placeholderTexture() {
  if (placeholder) return placeholder;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    g.fillStyle = (x + y) % 2 ? '#3a0b3a' : '#1a061c';
    g.fillRect(x * 32, y * 32, 32, 32);
  }
  g.fillStyle = '#f0c6ff';
  g.font = 'bold 28px system-ui, sans-serif';
  g.textAlign = 'center';
  g.fillText('missing image', 128, 136);
  placeholder = new THREE.CanvasTexture(c);
  placeholder.colorSpace = THREE.SRGBColorSpace;
  return placeholder;
}

export function loadTexture(url, colorSpace) {
  return new Promise((resolve) => {
    loader.load(url, (tex) => {
      tex.colorSpace = colorSpace;
      tex.generateMipmaps = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      resolve(tex);
    }, undefined, () => {
      console.warn(`[stark] missing texture ${url}`);
      resolve(null);
    });
  });
}

/**
 * Everything the display needs for one image. Heatmaps load lazily and are cached per image.
 * `ok` is false if the tree or crop could not be loaded (the display then shows the placeholder).
 */
export async function loadImageAssets(entry) {
  const base = '/' + entry.folder.replace(/^\/+/, '');
  const out = { entry, base, tree: null, gradcam: null, crop: null, heat: new Map(), ok: true };
  const [tree, gradcam, crop] = await Promise.all([
    fetchJson(base + 'tree.json', 'stark.tree/1').catch((e) => { console.warn('[stark]', e.message); return null; }),
    fetchJson(base + 'gradcam/index.json', 'stark.gradcam/1').catch((e) => { console.warn('[stark]', e.message); return null; }),
    loadTexture(base + 'crop.png', THREE.SRGBColorSpace),
  ]);
  if (tree && !(Array.isArray(tree.topK) && tree.top1 && Array.isArray(tree.nodes))) {
    console.warn(`[stark] ${base}tree.json: missing topK/top1/nodes`);
    out.tree = null;
  } else out.tree = tree;
  out.gradcam = gradcam && Array.isArray(gradcam.classes) ? gradcam : null;
  out.crop = crop;
  out.ok = Boolean(out.tree && crop);
  return out;
}

/** The heatmap texture for classId, or null if there is none (never invented). Cached per image. */
export function heatmapTexture(assets, classId) {
  const entry = assets.gradcam?.classes.find((c) => c.classId === classId);
  if (!entry || !entry.hasHeatmap || !entry.file) return Promise.resolve(null);
  if (!assets.heat.has(classId)) {
    // 8-bit grayscale data, not colour: no colour-space conversion
    assets.heat.set(classId, loadTexture(assets.base + entry.file, THREE.NoColorSpace));
  }
  return assets.heat.get(classId);
}

export async function disposeImageAssets(assets) {
  if (!assets) return;
  assets.crop?.dispose();
  for (const p of assets.heat.values()) (await p)?.dispose();
  assets.heat.clear();
}
