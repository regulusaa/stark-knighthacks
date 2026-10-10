// The live display stays quiet; the lab opts into the full CX-6 HUD.
// Both layouts read the same display API and own no socket.
export function mountHud(rootEl, api) {
  const subscriptions = [];
  let hud;
  let destroyed = false;
  const safely = fn => { try { return fn(); } catch { return undefined; } };
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const off of subscriptions) safely(() => off?.());
    safely(() => hud?.remove());
  };
  safely(() => {
    if (!rootEl?.append) return;
    const href = new URL('./styles/hud.css', import.meta.url).href;
    if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href; document.head.append(link);
    }
    hud = document.createElement('div');
    const full = rootEl.dataset.hudLayout === 'full';
    hud.className = `stark-hud hud-mounting${full ? '' : ' hud-compact'}`;
    hud.innerHTML = `
      <header class="hud-brand"><div class="hud-wordmark">STARK</div><div data-field="image" class="hud-label"></div></header>
      <section class="hud-result" aria-label="Model's answer"><div data-field="answer" class="hud-answer"></div><div data-field="score" class="hud-secondary"></div><div data-field="truth" class="hud-truth"><span class="hud-ring" aria-hidden="true"></span><span data-field="correctness"></span></div></section>
      <section class="hud-focus hud-fade" aria-label="Focused class" aria-hidden="true"><div class="hud-kicker">FOCUSED ANSWER</div><div data-field="focusLabel" class="hud-label"></div><div class="hud-focus-meta"><span data-field="focusScore"></span><span data-field="rank"></span></div><div data-field="heatmap" class="hud-heatmap"></div><p class="hud-caption">Highlights image regions associated with this class score</p></section>
      <section class="hud-status"><div data-field="controllers"></div><div data-field="driver" class="hud-secondary"></div><div data-field="mode" class="hud-mode"></div></section>
      <section class="hud-legend" aria-label="Score legend"><div class="hud-inferno" aria-hidden="true"></div><div>low → high model score</div><div class="hud-legend-truth"><span class="hud-ring" aria-hidden="true"></span>true class</div></section>
      <section class="hud-qr"><img class="hud-qr-image" alt="Scan to open the Stark controller"><div data-field="scan">Scan to steer</div><div data-field="room" class="hud-room"></div><div class="hud-host"></div></section>`;
    if (!full) {
      for (const el of hud.querySelectorAll('header, section:not(.hud-result), .hud-truth')) el.remove();
    }
    rootEl.replaceChildren(hud);
    const fields = Object.fromEntries([...hud.querySelectorAll('[data-field]')].map(el => [el.dataset.field, el]));
    const focusCard = hud.querySelector('.hud-focus');
    const qr = hud.querySelector('.hud-qr-image');
    if (full) hud.querySelector('.hud-host').textContent = location.host;
    const text = (field, value) => {
      const el = fields[field];
      if (!el) return;
      const content = value === null || value === undefined ? '' : String(value);
      if (el.textContent !== content) el.textContent = content;
      el.classList.toggle('hud-empty', !content);
    };
    const score = value => Number.isFinite(value) ? `${full ? 'model' : 'Model'} score ${(value * 100).toFixed(1)}%` : null;
    let qrRoom;
    qr?.addEventListener('error', () => { qr.classList.add('hud-empty'); });
    qr?.addEventListener('load', () => { if (qrRoom) qr.classList.remove('hud-empty'); });
    function setRoom(room) {
      if (!full) return;
      const valid = typeof room === 'string' && /^[A-HJ-NP-Z2-9]{5}$/i.test(room) ? room.toUpperCase() : null;
      text('room', valid); text('scan', valid ? 'Scan to steer' : null);
      if (valid === qrRoom) return;
      qrRoom = valid;
      qr.classList.toggle('hud-empty', !valid);
      if (valid) qr.src = `/api/qr.svg?room=${encodeURIComponent(valid)}`;
      else qr.removeAttribute('src');
    }
    function focus(answer) {
      if (!full) return;
      const active = answer !== null && typeof answer === 'object';
      focusCard.classList.toggle('hud-visible', active);
      focusCard.setAttribute('aria-hidden', String(!active));
      text('focusLabel', answer?.label);
      text('focusScore', score(answer?.score));
      text('rank', Number.isFinite(answer?.rank) ? `Rank ${answer.rank}` : null);
      text('heatmap', typeof answer?.hasHeatmap === 'boolean' ? answer.hasHeatmap ? 'Grad-CAM shown on the display' : 'No heatmap precomputed' : null);
    }
    function state(value) {
      const s = value && typeof value === 'object' ? value : {};
      text('image', s.image?.name);
      text('answer', s.top1?.label);
      text('score', score(s.top1?.score));
      if (!full) return;
      const comparable = s.top1?.classId != null && s.trueClass?.classId != null;
      fields.truth.classList.toggle('hud-empty', !comparable);
      text('correctness', comparable ? s.top1.classId === s.trueClass.classId ? 'Correct' : 'Incorrect' : null);
      text('controllers', Number.isInteger(s.controllerCount) && s.controllerCount >= 0 ? `${s.controllerCount} controller${s.controllerCount === 1 ? '' : 's'} connected` : null);
      text('driver', s.driver?.label ? `${s.driver.label} is driving` : s.driver === null ? 'Nobody is driving' : null);
      text('mode', { normal: 'Normal', stability: 'Stability test', trunk: 'Trunk interior' }[s.mode]);
      setRoom(s.room || safely(() => api.getRoom()));
      if (Object.hasOwn(s, 'focus')) focus(s.focus);
    }
    state({}); focus(null);
    for (const [name, callback] of [['onState', state], ['onFocus', focus]]) {
      const off = safely(() => api?.[name]?.(value => { if (!destroyed) safely(() => callback(value)); }));
      if (typeof off === 'function') subscriptions.push(off);
    }
    // Paint the initial state before enabling fades on subsequent state changes.
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!destroyed) hud.classList.remove('hud-mounting'); }));
  });
  return { destroy };
}
