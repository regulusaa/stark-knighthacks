// Demo safety (CC-10 Part D1): download every gallery image's files (crop, tree, heatmaps, Steer data, atlas,
// stability, fgsm and its noise image) plus head.bin into memory when the display loads, then answer the display's
// own fetches and texture loads from memory. Once it has finished, no image switch waits on the network.
// Only GETs of /assets/… are served from memory; everything else (socket, /api) goes to the network as before.

const store = new Map();   // pathname → { buf: ArrayBuffer, type: string }
const realFetch = window.fetch.bind(window);
const progress = { done: 0, total: 0, bytes: 0, failed: 0, finished: false, ms: 0 };

const pathOf = (input) => new URL(typeof input === 'string' ? input : input.url, location.href).pathname;

window.fetch = (input, init) => {
  const method = (init?.method ?? (typeof input === 'string' ? 'GET' : input.method ?? 'GET')).toUpperCase();
  const hit = method === 'GET' && store.get(pathOf(input));
  if (!hit) return realFetch(input, init);
  return Promise.resolve(new Response(hit.buf, { status: 200, headers: { 'content-type': hit.type } }));   // the body is a copy
};

/** A blob: URL for a preloaded file (the caller revokes it), or null. */
export function cachedObjectUrl(url) {
  const hit = store.get(pathOf(url));
  return hit ? URL.createObjectURL(new Blob([hit.buf], { type: hit.type })) : null;
}

export const preloadProgress = progress;

async function get(path) {
  if (store.has(path)) return store.get(path);
  const res = await realFetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const hit = { buf: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'application/octet-stream' };
  store.set(path, hit);
  progress.bytes += hit.buf.byteLength;
  return hit;
}
const json = (hit) => JSON.parse(new TextDecoder().decode(hit.buf));

/** Start downloading everything; resolves when finished (failures are counted and warned, never thrown). */
export async function preloadAll(manifest, { concurrency = 6, onProgress = () => {} } = {}) {
  const t0 = performance.now();
  const queue = ['/assets/layer-config.json', '/assets/steer/head.bin', '/assets/steer/classes.json'];
  for (const m of manifest) {
    const base = '/' + m.folder.replace(/^\/+/, '');
    const f = m.files ?? {};
    queue.push(base + 'tree.json', base + 'crop.png');
    if (f.gradcam) queue.push(base + 'gradcam/index.json');
    if (f.atlas) queue.push(base + 'atlas.json', base + 'atlas.bin');
    if (f.stability) queue.push(base + 'mc.json');
    if (f.fgsm) queue.push(base + 'fgsm.json');
    if (m.steerable) queue.push(base + 'steer.json', base + 'conv5.bin');
  }
  progress.total = queue.length;
  const follow = async (path, hit) => {   // files named inside other files
    if (path.endsWith('/gradcam/index.json')) {
      const base = path.slice(0, -'gradcam/index.json'.length);
      for (const c of json(hit).classes ?? []) if (c.hasHeatmap && c.file) { queue.push(base + c.file); progress.total += 1; }
    } else if (path.endsWith('/fgsm.json')) {
      const nf = json(hit).noiseFile;
      if (nf) { queue.push(path.slice(0, -'fgsm.json'.length) + nf); progress.total += 1; }
    }
  };
  const worker = async () => {
    while (queue.length) {
      const path = queue.shift();
      try { await follow(path, await get(path)); } catch (err) { progress.failed += 1; console.warn('[stark] preload:', err.message); }
      progress.done += 1;
      onProgress(progress);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  progress.finished = true;
  progress.ms = performance.now() - t0;
  onProgress(progress);
  console.info(`[stark] preloaded ${progress.done} files, ${(progress.bytes / 1e6).toFixed(1)} MB in ${(progress.ms / 1000).toFixed(1)} s${progress.failed ? ` (${progress.failed} failed)` : ''}`);
  return progress;
}
