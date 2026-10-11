import { percent, heatmapText } from './presentation.js';
import { mountFocusEvidence } from './focus-evidence.js';

// Owns no transport. All callbacks are isolated so HUD failures never stop the renderer.
export function mountHud(rootEl, api) {
  const subscriptions = [], timers = new Set();
  let hud, focusEvidence, destroyed = false, state = {}, outside = null, drawn = null, treeImage = null;
  let momentKey = null, momentTimerKey = null;
  const seenMoments = new Set();
  const safely = fn => { try { return fn(); } catch { return undefined; } };
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); if (!destroyed) safely(fn); }, ms); timers.add(id); return id; };
  const destroy = () => { if (destroyed) return; destroyed = true; for (const id of timers) clearTimeout(id); timers.clear(); for (const off of subscriptions) safely(off); safely(() => focusEvidence?.destroy()); safely(() => hud?.remove()); };
  safely(() => {
    if (!rootEl?.append) return;
    const href = new URL('./styles/hud.css', import.meta.url).href;
    if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(l => l.href === href)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); }
    const full = rootEl.dataset.hudLayout === 'full';
    hud = document.createElement('div'); hud.className = `stark-hud hud-mounting${full ? '' : ' hud-compact'}`;
    hud.innerHTML = `
      <header class="hud-brand"><div class="hud-wordmark">STARK</div><div class="hud-image-line"><span data-field="image" class="hud-label"></span><span class="hud-adversarial-chip" hidden>Adversarial</span></div></header>
      <section class="hud-result" aria-label="Model's answer"><div data-field="answer" class="hud-answer"></div><div data-field="score" class="hud-secondary"></div><div data-field="truth" class="hud-truth"><span class="hud-ring" aria-hidden="true"></span><span data-field="correctness"></span></div></section>
      <section class="hud-medical" hidden><div class="hud-kicker">Findings (independent scores)</div><div class="hud-findings"></div><p>Each score is 0–100% on its own · not a diagnosis</p></section>
      <section class="hud-context" hidden><div class="hud-context-image" hidden><span data-field="contextImage"></span><span class="hud-adversarial-chip">Adversarial</span></div><div data-field="contextTitle" class="hud-context-title"></div><div data-field="contextAnswer" class="hud-label"></div><div data-field="original" class="hud-secondary"></div><div data-field="noise" class="hud-secondary"></div><div class="hud-progress" hidden><span></span></div><div class="hud-winners"></div><div data-field="stabilityCaption" class="hud-caption"></div></section>
      <section class="hud-focus hud-fade" aria-label="Focused class" aria-hidden="true"><div class="hud-kicker">FOCUSED ANSWER</div><div data-field="focusLabel" class="hud-label"></div><div class="hud-focus-meta"><span data-field="focusScore"></span><span data-field="rank"></span></div><div data-field="heatmap" class="hud-heatmap"></div><div class="hud-focus-evidence"></div><p class="hud-caption">Highlights image regions associated with this class score</p></section>
      <section class="hud-status"><div data-field="controllers"></div><div data-field="driver" class="hud-secondary"></div><div data-field="mode" class="hud-mode"></div></section>
      <section class="hud-feature-status" hidden><div data-field="steeringBadge" class="hud-mode"></div><div data-field="outside" class="hud-outside"></div></section>
      <section class="hud-legend"><div class="hud-inferno" aria-hidden="true"></div><div>low → high model score</div><div class="hud-legend-truth"><span class="hud-ring" aria-hidden="true"></span>true class</div></section>
      <section class="hud-qr"><img class="hud-qr-image" alt="Scan to open the Stark controller"><div data-field="scan">Scan to steer</div><div data-field="room" class="hud-room"></div><div class="hud-host"></div></section>
      <section class="hud-moment" hidden aria-live="polite"><div class="hud-moment-kicker">Answer changed</div><div class="hud-moment-pair"><div><div data-field="fromLabel"></div><div data-field="fromScore" class="hud-moment-score"></div></div><span class="hud-moment-arrow" aria-hidden="true">→</span><div><div data-field="toLabel"></div><div data-field="toScore" class="hud-moment-score"></div></div></div></section>`;
    if (!full) for (const el of hud.querySelectorAll('.hud-brand,.hud-status,.hud-legend,.hud-qr,.hud-truth')) el.remove();
    rootEl.replaceChildren(hud);
    focusEvidence=mountFocusEvidence(hud.querySelector('.hud-focus-evidence'),{enabled:!full&&rootEl.dataset.focusEvidence!=='off'});
    const fields = Object.fromEntries([...hud.querySelectorAll('[data-field]')].map(e => [e.dataset.field, e]));
    const text = (name, value) => { const e = fields[name]; if (!e) return; const str = value == null ? '' : String(value); if (e.textContent !== str) e.textContent = str; e.classList.toggle('hud-empty', !str); };
    const score = value => percent(value) ? `${full ? 'model' : 'Model'} score ${percent(value)}` : '';
    const result = hud.querySelector('.hud-result'), medical = hud.querySelector('.hud-medical'), context = hud.querySelector('.hud-context');
    const feature = hud.querySelector('.hud-feature-status'), moment = hud.querySelector('.hud-moment');
    let qrRoom, winnersSignature = '', findingsSignature = '';
    const qr = hud.querySelector('.hud-qr-image');
    qr?.addEventListener('error', () => qr.classList.add('hud-empty'));
    qr?.addEventListener('load', () => qr.classList.toggle('hud-empty', !qrRoom));
    if (full) hud.querySelector('.hud-host').textContent = location.host;
    function setRoom(room) {
      if (!full) return;
      const valid = typeof room === 'string' && /^[A-HJ-NP-Z2-9]{5}$/i.test(room) ? room.toUpperCase() : null;
      text('room', valid); text('scan', valid ? 'Scan to steer' : '');
      if (valid === qrRoom) return; qrRoom = valid; qr.classList.toggle('hud-empty', !valid);
      if (valid) qr.src = `/api/qr.svg?room=${encodeURIComponent(valid)}`; else qr.removeAttribute('src');
    }
    function focus(a) {
      const card = hud.querySelector('.hud-focus');
      const active = a && typeof a === 'object';
      card.classList.toggle('hud-visible', Boolean(active)); card.setAttribute('aria-hidden', String(!active));
      text('focusLabel', a?.label); text('focusScore', score(a?.score)); text('rank', Number.isFinite(a?.rank) ? `Rank ${a.rank}` : ''); text('heatmap', heatmapText(a));
      hud.querySelector('.hud-focus .hud-caption').hidden=!(a?.heatmapSource || a?.heatmapSource===undefined&&a?.hasHeatmap);
      void focusEvidence.update(state,a);
    }
    function listRows(parent, values, kind) {
      const signature = JSON.stringify(values);
      if (kind === 'findings' ? signature === findingsSignature : signature === winnersSignature) return;
      if (kind === 'findings') findingsSignature = signature; else winnersSignature = signature;
      const fragment = document.createDocumentFragment();
      for (const a of values) {
        const row = document.createElement('div'); row.className = 'hud-data-row';
        const label = document.createElement('span'); label.className = 'hud-label'; label.textContent = a.label || '';
        const value = document.createElement('span'); value.className = 'hud-data-score'; value.textContent = kind === 'findings' ? percent(a.score) : `${a.count} run${a.count === 1 ? '' : 's'}`;
        if (kind === 'findings' && a.isTrueClass) { const ring = document.createElement('span'); ring.className = 'hud-ring'; ring.setAttribute('aria-label', 'True class'); label.prepend(ring); }
        row.append(label, value); fragment.append(row);
      }
      parent.replaceChildren(fragment);
    }
    function outsideNotice() {
      const s = state;
      const current = s.stability?.active && s.stability.phase === 'playing' ? s.stability.current : null;
      const a = outside || (current?.classId != null && drawn && !drawn.has(current.classId) ? current : null);
      text('outside', a?.label ? `Top answer isn't drawn in the Brain: ${a.label} (${percent(a.score)})` : '');
      const steering = s.steer?.active === true;
      text('steeringBadge', steering && Number.isInteger(s.steer.changedCount) ? `Steering · ${s.steer.changedCount} channels changed` : '');
      feature.hidden = !steering && !a;
    }
    async function loadDrawn(s) {
      if (!s.stability?.active || treeImage === s.image?.id || !s.image?.id) return;
      const id = s.image.id; treeImage = id; drawn = null;
      // Tree leaves, not the top-10 answer list, determine whether a run is drawn.
      const url = rootEl.dataset.treeUrl || `/assets/${encodeURIComponent(id)}/tree.json`;
      try {
        const response = await fetch(url); if (!response.ok) return;
        const tree = await response.json();
        const classes = tree.nodes?.filter(n => n.classId != null).map(n => n.classId);
        if (!destroyed && state.image?.id === id && Array.isArray(classes)) { drawn = new Set(classes); outsideNotice(); }
      } catch { /* Missing membership data hides only this notice. */ }
    }
    function clearMoment() { momentTimerKey = null; moment.hidden = true; moment.classList.remove('hud-docked'); hud.classList.remove('hud-has-moment'); }
    function showMoment(m) {
      if (!m || !Number.isFinite(m.at) || !m.from?.label || !m.to?.label) { clearMoment(); return; }
      const age = Math.max(0, Date.now() - m.at), key = `${state.image?.id}:${m.at}`;
      if (age >= 4000) { clearMoment(); return; }
      if (key === momentKey || seenMoments.has(key)) return;
      seenMoments.add(key); if (seenMoments.size > 32) seenMoments.delete(seenMoments.values().next().value);
      momentKey = momentTimerKey = key; moment.style.opacity = ''; moment.hidden = false; moment.classList.remove('hud-docked'); hud.classList.add('hud-has-moment');
      text('fromLabel', m.from.label); text('toLabel', m.to.label); text('fromScore', percent(m.from.score) ? `Model score ${percent(m.from.score)}` : ''); text('toScore', percent(m.to.score) ? `Model score ${percent(m.to.score)}` : '');
      // Initial layout is painted before the transition to its fixed top-center destination.
      if (age >= 2500) moment.classList.add('hud-docked');
      else later(2500 - age, () => {
        if (momentTimerKey !== key) return;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
          moment.style.opacity = '0';
          later(200, () => { if (momentTimerKey === key) { moment.classList.add('hud-docked'); moment.style.opacity = '1'; } });
        } else moment.classList.add('hud-docked');
      });
      later(4000 - age, () => { if (momentTimerKey === key) clearMoment(); });
    }
    function render(value) {
      const s = value && typeof value === 'object' ? value : {};
      const changed = state.image?.id !== s.image?.id;
      if (changed) { outside = null; drawn = null; treeImage = null; clearMoment(); }
      state = s;
      const independent = s.scoreKind === 'independent';
      result.hidden = independent || s.stability?.active === true; medical.hidden = !independent;
      text('image', s.image?.name); text('answer', s.top1?.label); text('score', score(s.top1?.score));
      const adversarial = s.image?.category === 'adversarial';
      for (const chip of hud.querySelectorAll('.hud-brand .hud-adversarial-chip')) chip.hidden = !adversarial;
      const st = s.stability?.active ? s.stability : null;
      const playing = st?.phase === 'playing', summary = st?.phase === 'summary';
      const winnerCount = Array.isArray(st?.winners) ? st.winners.find(w => w.classId === st.cleanTop1?.classId)?.count ?? 0 : null;
      hud.dataset.contextKind = st ? 'stability' : adversarial ? 'adversarial' : '';
      text('contextTitle', playing && Number.isFinite(st.run) && Number.isFinite(st.runs) ? `Stability test · run ${st.run} / ${st.runs}` : summary && st.cleanTop1?.label && Number.isFinite(winnerCount) ? `${st.cleanTop1.label} won ${winnerCount} of ${st.runs} runs` : '');
      text('contextAnswer', playing && st.current?.label ? `${st.current.label} · model score ${percent(st.current.score)}` : summary && st.distinctWinners > 1 ? `${st.distinctWinners} different answers` : '');
      text('original', adversarial && s.image?.adversarial?.cleanTop1?.label ? `Original answer: ${s.image.adversarial.cleanTop1.label} (${percent(s.image.adversarial.cleanTop1.score)})` : '');
      text('noise', adversarial && s.noiseView === true ? 'The change, amplified 50×' : '');
      text('stabilityCaption', st ? 'Stability under small changes' : '');
      const progress = hud.querySelector('.hud-progress'); progress.hidden = !playing || !(st.runs > 0); progress.querySelector('span').style.width = playing && st.runs > 0 ? `${Math.max(0, Math.min(100, st.run / st.runs * 100))}%` : '0%';
      listRows(hud.querySelector('.hud-winners'), summary && st.distinctWinners > 1 ? (st.winners || []).slice(0, 3) : [], 'winners');
      listRows(hud.querySelector('.hud-findings'), independent ? (s.answers || []).filter(a => Number.isFinite(a.rank)).sort((a, b) => a.rank - b.rank).slice(0, 3) : [], 'findings');
      context.hidden = !st && !adversarial;
      hud.querySelector('.hud-context-image').hidden = full || !adversarial;
      text('contextImage', !full && adversarial ? s.image?.name : '');
      if (full) {
        const comparable = !independent && s.top1?.classId != null && s.trueClass?.classId != null;
        fields.truth.classList.toggle('hud-empty', !comparable); text('correctness', comparable ? s.top1.classId === s.trueClass.classId ? 'Correct' : 'Incorrect' : '');
        text('controllers', Number.isInteger(s.controllerCount) ? `${s.controllerCount} controller${s.controllerCount === 1 ? '' : 's'} connected` : '');
        text('driver', s.driver?.label ? `${s.driver.label} is driving` : s.driver === null ? 'Nobody is driving' : '');
        text('mode', { normal: 'Normal', stability: 'Stability test', trunk: 'Trunk interior' }[s.mode]);
        setRoom(s.room || safely(() => api.getRoom()));
      }
      focus(s.focus ?? null);
      outsideNotice(); void loadDrawn(s); showMoment(s.steerMoment);
    }
    const steer = st => { if (st?.imageId !== state.image?.id) return; outside = st?.result?.outsideBrain || null; outsideNotice(); };
    render({}); focus(null);
    for (const [name, cb] of [['onState', render], ['onFocus', focus], ['onSteer', steer]]) {
      const off = safely(() => api?.[name]?.(value => { if (!destroyed) safely(() => cb(value)); }));
      if (typeof off === 'function') subscriptions.push(off);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => { if (!destroyed) hud.classList.remove('hud-mounting'); }));
  });
  return { destroy };
}
