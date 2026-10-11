// Frame-time stats for the real monitor (CC-10): a rolling window of frame times (p50/p95), draw calls and triangles per
// frame (all render passes, glow included), and GPU memory counts. ?perf=1 shows an overlay; when the server runs with
// STARK_PERF=1 the display POSTs a summary to /api/perf every 5 s (it asks GET /api/perf first).
const WINDOW = 300;   // frames (5 s at 60 fps)

export function createPerf({ renderer, stats, api, params }) {
  renderer.info.autoReset = false;   // count every render pass of a frame, not just the last (glow renders twice)
  const times = new Float32Array(WINDOW);
  let n = 0;
  let head = 0;
  let calls = 0;
  let triangles = 0;

  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  function summary() {
    const k = Math.min(n, WINDOW);
    const s = Array.from(times.subarray(0, k)).sort((a, b) => a - b);
    const p50 = k ? pct(s, 0.5) : 0;
    const p95 = k ? pct(s, 0.95) : 0;
    const i = renderer.info;
    return {
      fps: stats.fps, frameMsP50: p50, frameMsP95: p95, fpsP50: p50 ? 1000 / p50 : 0, fpsP95: p95 ? 1000 / p95 : 0,
      drawCalls: calls, triangles, textures: i.memory.textures, geometries: i.memory.geometries, programs: i.programs?.length ?? 0,
      pixelRatio: renderer.getPixelRatio(), width: window.innerWidth, height: window.innerHeight,
      mode: api.state?.mode ?? null, layerMode: api.state?.layerMode ?? null, bloom: api.state?.bloom ?? null,
      image: api.state?.image.id ?? null, steering: Boolean(api.state?.steer?.active),
    };
  }

  if (params.get('perf') === '1') {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:12px;top:10px;font:13px/1.35 ui-monospace,monospace;color:#c9b8e0;background:#0009;padding:6px 9px;border-radius:6px;z-index:50;white-space:pre;pointer-events:none';
    document.body.appendChild(el);
    setInterval(() => {
      const s = summary();
      el.textContent = `${s.fps.toFixed(0)} fps  p50 ${s.frameMsP50.toFixed(1)} ms  p95 ${s.frameMsP95.toFixed(1)} ms\n`
        + `${s.drawCalls} calls  ${(s.triangles / 1000).toFixed(0)}k tris  ${s.textures} tex  ${s.geometries} geo  ${s.pixelRatio}x\n`
        + `${s.mode ?? '–'} ${s.layerMode ?? ''} glow ${s.bloom ? 'on' : 'off'}`;
    }, 500);
  }

  fetch('/api/perf').then((r) => (r.ok ? r.json() : null)).then((cfg) => {
    if (!cfg?.enabled) return;   // STARK_PERF is off on this server
    setInterval(() => {
      if (n < 60) return;
      fetch('/api/perf', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ t: Date.now(), ...summary() }) })
        .catch(() => {});   // offline: the next one may get through
    }, 5000);
  }).catch(() => {});

  return {
    /** Call at the start of a frame with the previous frame's dt (seconds). */
    frameStart(dt) {
      if (n > 0) { calls = renderer.info.render.calls; triangles = renderer.info.render.triangles; }
      renderer.info.reset();
      times[head] = dt * 1000; head = (head + 1) % WINDOW; n += 1;
    },
    summary,
  };
}
