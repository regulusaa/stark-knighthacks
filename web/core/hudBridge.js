// Mounts Codex's HUD (/ui/hud.js, contract v1 section 7) if it exists; otherwise a minimal built-in HUD,
// so the display never depends on code outside /web/core.
export async function mountHud(root, api, { getRoom = () => null } = {}) {
  let visible = true;
  const hudApi = {
    onState: (cb) => api.onDisplayState(cb),
    onFocus: (cb) => api.onFocus(cb),
    onSteer: (cb) => api.onSteer(cb),   // (v2) SteerState after every change; result.outsideBrain names an answer not drawn
    getRoom,
    setVisible(v) { visible = Boolean(v); root.style.display = visible ? '' : 'none'; },
  };
  try {
    const probe = await fetch('/api/ui-modules', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
    if (!probe.hud) throw new Error('/ui/hud.js is not there yet');
    const mod = await import('/ui/hud.js');
    if (typeof mod.mountHud !== 'function') throw new Error('hud.js has no mountHud export');
    mod.mountHud(root, hudApi);
    return { ...hudApi, kind: 'ui', get visible() { return visible; } };
  } catch (err) {
    console.info('[stark] using the built-in HUD:', err.message);
    builtIn(root, hudApi);
    return { ...hudApi, kind: 'built-in', get visible() { return visible; } };
  }
}

function builtIn(root, hudApi) {
  root.innerHTML = `
    <style>
      .stark-hud { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #f4ecff; }
      .stark-hud .top { position: absolute; top: 28px; left: 0; right: 0; text-align: center; }
      .stark-hud .name { font-size: 22px; letter-spacing: .08em; text-transform: uppercase; color: #bfa9d9; }
      .stark-hud .answer { margin-top: 6px; font-size: 40px; font-weight: 600; text-shadow: 0 0 18px rgba(252,180,60,.35); }
      .stark-hud .score { font-weight: 400; color: #fcd27a; }
      .stark-hud .steer { margin-top: 4px; font-size: 18px; color: #bfa9d9; min-height: 1.2em; }
      .stark-hud .status { position: absolute; left: 28px; bottom: 24px; font-size: 18px; color: #9d8bb3; }
      .stark-hud .status b { color: #f4ecff; letter-spacing: .12em; }
      .stark-hud .qr { position: absolute; right: 28px; bottom: 24px; text-align: center; font-size: 15px; color: #bfa9d9; }
      .stark-hud .qr img { display: block; width: 150px; height: 150px; background: #fff; border-radius: 8px;
        padding: 6px; margin-bottom: 8px; box-sizing: border-box; }
      .stark-hud .qr[hidden] { display: none; }
    </style>
    <div class="stark-hud">
      <div class="top"><div class="name"></div><div class="answer"></div><div class="steer"></div></div>
      <div class="status">Room <b class="room">—</b><span class="who"></span></div>
      <div class="qr" hidden><img alt="QR code: scan to take the wheel"><div>Scan to take the wheel</div></div>
    </div>`;
  let qrRoom = null;
  const $ = (s) => root.querySelector(s);
  hudApi.onSteer((st) => {
    const r = st?.result;
    if (!st?.active || !r) { $('.steer').textContent = ''; return; }
    const was = r.top1Changed ? ` (was ${r.baselineTop1.label})` : '';
    $('.steer').textContent = r.outsideBrain
      ? `Steered: ${r.outsideBrain.label} is not drawn in the Brain; its path runs to "other"${was}`
      : `Steered: ${st.scales.length} channel${st.scales.length === 1 ? '' : 's'} changed${was}`;
  });
  hudApi.onState((s) => {
    $('.name').textContent = s.image?.name ?? '';
    const t = s.top1;
    $('.answer').innerHTML = t
      ? `${escapeHtml(t.label)} <span class="score">· model score ${t.score.toFixed(2)}</span>`
      : 'no data for this image';
    const room = s.room || hudApi.getRoom() || null;
    $('.room').textContent = room || '—';
    const n = s.controllerCount || 0;
    $('.who').textContent = room
      ? `  ·  ${s.driver ? `${s.driver.label} driving` : 'nobody driving'}  ·  ${n} controller${n === 1 ? '' : 's'}`
      : '';
    if (room !== qrRoom) {
      qrRoom = room;
      $('.qr').hidden = !room;
      if (room) $('.qr img').src = `/api/qr.svg?room=${encodeURIComponent(room)}`;
    }
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
