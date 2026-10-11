import { EVENTS, MODES } from '/contract/contract.js';

const beats = [
  { id: 'retriever', label: 'Retriever', image: 'clean_retriever', mode: MODES.NORMAL, cue: 'Bright path → answer → heatmap.' },
  { id: 'handover', label: 'Handover', image: 'clean_retriever', mode: MODES.NORMAL, cue: 'Judge: take control, turn, tap Labrador.' },
  { id: 'stability', label: 'Stability', mode: MODES.STABILITY, cue: 'Watch this image’s answer across 30 small changes.' },
  { id: 'adversarial', label: 'Adversarial', mode: MODES.NORMAL, cue: 'Compare this image with its adversarial pair.' },
  { id: 'xray', label: 'X-ray', image: 'med_xray_pneumonia', mode: MODES.NORMAL, cue: 'Independent findings · not a diagnosis.' },
  { id: 'steer', label: 'Steer', image: 'ambig_cat', mode: MODES.NORMAL, cue: 'Turn down a channel. Watch the answer change.' },
  { id: 'close', label: 'Close', image: 'clean_retriever', mode: MODES.NORMAL, cue: 'See the answer. Reach in and change it.' },
];

export function createDemoRail({ root, emit, notify, onSteer, mock = false }) {
  root.hidden = false;
  root.className = 'demo-rail';
  root.innerHTML = `<div class="demo-heading"><h2>Demo</h2><button class="demo-cue-toggle" type="button" aria-expanded="true">Hide cue</button></div><div class="demo-beats" role="group" aria-label="Demo beats"></div><p class="demo-cue"></p><p class="demo-availability"></p><div class="demo-footer"><p class="demo-status" role="status" aria-live="polite"></p><button class="demo-reset" type="button" aria-label="Hold for one second to reset the demo"><span class="demo-hold-ring" aria-hidden="true"></span><span>Hold to reset demo</span></button></div>`;
  const strip = root.querySelector('.demo-beats');
  const cue = root.querySelector('.demo-cue');
  const status = root.querySelector('.demo-status');
  const availability = root.querySelector('.demo-availability');
  const reset = root.querySelector('.demo-reset');
  const ring = root.querySelector('.demo-hold-ring');
  const toggle = root.querySelector('.demo-cue-toggle');
  const buttons = new Map();
  const setups = beats.map(b => ({ ...b }));
  let display = null;
  let pendingImage = null;
  let imagePairs = new Map();
  let current = 'retriever';
  let action = null;
  let timeout = 0;
  let frame = 0;
  let holding = false;
  let pointerId = null;
  let destroyed = false;
  let manifestRevision = 0;
  let cueHidden = false;
  try { cueHidden = sessionStorage.getItem('stark:demo-cue-hidden') === '1'; } catch {}
  const target = () => action?.beat || setups.find(b => b.id === current);
  const pairFor = () => display?.image?.adversarial?.pairedImageId || imagePairs.get(display?.image?.id);
  const canTest = () => display?.capabilities?.stability === true && display?.scoreKind !== 'independent';
  const matches = b => display?.image?.id === b.image && display?.mode === b.mode;
  const ready = b => matches(b) && (b.id !== 'steer' || display?.capabilities?.steer === true) && (b.mode !== MODES.STABILITY || display?.stability?.active === true);
  function render() {
    for (const [id, button] of buttons) {
      button.classList.toggle('active', id === current);
      button.classList.toggle('pending', id === action?.beat.id);
      button.setAttribute('aria-pressed', String(id === current));
      button.setAttribute('aria-busy', String(id === action?.beat.id));
      button.hidden = id === 'stability' ? !canTest() : id === 'adversarial' ? !pairFor() : false;
      button.disabled = !display || Boolean(action) || Boolean(pendingImage);
      if (id === 'adversarial') button.textContent = display?.image?.category === 'adversarial' ? 'Original' : 'Adversarial';
    }
    const selected = target();
    cue.textContent = selected?.cue || '';
    cue.hidden = cueHidden;
    toggle.textContent = cueHidden ? 'Show cue' : 'Hide cue';
    toggle.setAttribute('aria-expanded', String(!cueHidden));
    const name = display?.image?.name || 'this image';
    availability.textContent = display ? `${canTest() ? `Stability tests ${name}.` : `No stability data for ${name}.`} ${pairFor() ? 'Adversarial compares this image’s pair.' : 'No adversarial data for this image.'}` : '';
    status.textContent = action ? `Preparing ${action.reset ? 'the demo' : action.beat.label}…` : pendingImage ? 'Loading the selected image…' : current === 'steer' ? 'Start with the first channel at 0×' : '';
    reset.disabled = !display || Boolean(action) || Boolean(pendingImage);
  }
  function scrollToBeat(id) {
    const button = buttons.get(id);
    if (!button) return;
    strip.scrollTo({ left: Math.max(0, button.offsetLeft - strip.offsetLeft - 4), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }
  function stopHold() {
    holding = false;
    cancelAnimationFrame(frame); frame = 0;
    ring.style.setProperty('--hold', '0');
    reset.classList.remove('holding');
    const id = pointerId; pointerId = null;
    if (id !== null && reset.hasPointerCapture?.(id)) reset.releasePointerCapture(id);
  }
  function cancel() { clearTimeout(timeout); timeout = 0; action = null; stopHold(); render(); }
  function finish() {
    const finished = action;
    if (!finished) return;
    clearTimeout(timeout); action = null;
    current = finished.beat.id;
    if (finished.reset) {
      emit(EVENTS.STEER_RESET, {});
      emit(EVENTS.RESET_VIEW, {});
      notify('Demo reset');
    } else if (current === 'close') emit(EVENTS.RESET_VIEW, {});
    else if (current === 'steer') onSteer();
    render(); scrollToBeat(current);
  }
  function advance() {
    if (!action || !display) return;
    if (action.stage === 'image' && display.image?.id === action.beat.image) {
      action.stage = 'mode';
      if (emit(EVENTS.SET_MODE, { mode: action.beat.mode }) === false) { cancel(); return; }
      // A matching existing mode is already confirmed; the ordered command still goes out.
      if (ready(action.beat)) finish();
    } else if (action?.stage === 'mode' && ready(action.beat)) finish();
  }
  function start(beat, isReset = false) {
    if (destroyed || document.hidden || !display || action || pendingImage) return;
    if (beat.id === 'stability') {
      if (!canTest()) { notify('No stability data for this image.'); return; }
      beat = { ...beat, image: display.image.id };
    } else if (beat.id === 'adversarial') {
      const image = pairFor();
      if (!image) { notify('No adversarial data for this image.'); return; }
      beat = { ...beat, image };
    }
    stopHold();
    action = { beat, reset: isReset, stage: beat.id === 'stability' ? 'mode' : 'image' };
    render(); scrollToBeat(beat.id);
    timeout = setTimeout(() => { cancel(); notify('The screen did not confirm the setup. Tap the beat to try again.'); }, 8000);
    // Testing the current image must never reload it or substitute a demo image.
    const event = beat.id === 'stability' ? display.mode === MODES.STABILITY ? EVENTS.PLAY_PULSE : EVENTS.SET_MODE : EVENTS.SELECT_IMAGE;
    const payload = event === EVENTS.PLAY_PULSE ? { speed: display.playback?.speed || 1, skipToEnd: false } : event === EVENTS.SET_MODE ? { mode: beat.mode } : { imageId: beat.image };
    if (emit(event, payload) === false) { cancel(); return; }
    advance();
  }
  for (const beat of setups) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.demoBeat = beat.id; button.textContent = beat.label;
    button.addEventListener('click', () => start(beat));
    strip.append(button); buttons.set(beat.id, button);
  }
  function beginHold() {
    if (holding || reset.disabled || document.hidden) return;
    holding = true; reset.classList.add('holding');
    const started = performance.now();
    const tick = now => {
      if (!holding || document.hidden) return;
      const progress = Math.min(1, (now - started) / 1000);
      ring.style.setProperty('--hold', String(progress));
      if (progress === 1) start(setups[0], true);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  reset.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    if (reset.disabled) return;
    pointerId = event.pointerId; reset.setPointerCapture?.(pointerId); beginHold();
  });
  reset.addEventListener('pointermove', event => {
    if (!holding) return;
    const b = reset.getBoundingClientRect();
    if (event.clientX < b.left || event.clientX > b.right || event.clientY < b.top || event.clientY > b.bottom) stopHold();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) reset.addEventListener(type, stopHold);
  reset.addEventListener('keydown', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); if (!event.repeat) beginHold(); } });
  reset.addEventListener('keyup', event => { if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); stopHold(); } });
  reset.addEventListener('blur', stopHold);
  // Clicks (including double taps) alone can never trigger a reset.
  reset.addEventListener('click', event => event.preventDefault());
  toggle.addEventListener('click', () => {
    cueHidden = !cueHidden;
    try { sessionStorage.setItem('stark:demo-cue-hidden', cueHidden ? '1' : '0'); } catch {}
    render();
  });
  function visibility() { if (document.hidden) cancel(); }
  document.addEventListener('visibilitychange', visibility);
  render();
  return {
    setDisplay(value) {
      const previousImage = display?.image?.id;
      display = value;
      if (!value) { pendingImage = null; cancel(); return; }
      if (!action && (previousImage !== value.image?.id || current === 'stability' && value.mode !== MODES.STABILITY)) {
        current = value.mode === MODES.STABILITY ? 'stability' : value.image?.category === 'adversarial' ? 'adversarial' : value.image?.id === setups[0].image ? 'retriever' : null;
        if (current) requestAnimationFrame(() => { if (!destroyed) scrollToBeat(current); });
      }
      if (value.image?.id === pendingImage) pendingImage = null;
      if (action && action.stage === 'mode' && value.image?.id !== action.beat.image) cancel();
      advance(); render();
    },
    setImagePending(id) { pendingImage = id; render(); },
    async setManifest(manifest) {
      const revision = ++manifestRevision;
      const allImages = manifest?.images || [];
      imagePairs = new Map();
      // The fixture pair has the same IDs; real pairs come from their FGSM metadata.
      if (mock && allImages.some(i => i.id === 'clean_retriever') && allImages.some(i => i.id === 'adv_retriever')) {
        imagePairs.set('clean_retriever', 'adv_retriever'); imagePairs.set('adv_retriever', 'clean_retriever');
      }
      render();
      if (!mock) {
        const pairs = await Promise.all(allImages.filter(i => i.files?.fgsm).map(async image => {
          try {
            const response = await fetch(`/${String(image.folder || `assets/${image.id}/`).replace(/^\/+/, '')}fgsm.json`);
            if (!response.ok) return null;
            const data = await response.json();
            return data.schema === 'stark.fgsm/1' && allImages.some(i => i.id === data.sourceImageId) ? [image.id, data.sourceImageId] : null;
          } catch { return null; }
        }));
        if (destroyed || revision !== manifestRevision) return;
        for (const pair of pairs.filter(Boolean)) { imagePairs.set(pair[0], pair[1]); imagePairs.set(pair[1], pair[0]); }
        render();
      }
      const images = (manifest?.images || []).filter(i => i.steerable === true && i.category !== 'medical');
      if (mock) return;
      // These small metadata files are host-only; never load model tensors on a controller.
      const candidates = await Promise.all(images.map(async image => {
        try {
          const response = await fetch(`/${image.folder || `assets/${image.id}/`}steer.json`);
          if (!response.ok) return null;
          const data = await response.json();
          return Number.isInteger(data.flip?.n) && data.flip.n > 0 ? { image, n: data.flip.n } : null;
        } catch { return null; }
      }));
      if (destroyed || revision !== manifestRevision) return;
      candidates.sort((a, b) => !a ? 1 : !b ? -1 : a.n - b.n || Number(a.image.category === 'adversarial') - Number(b.image.category === 'adversarial') || a.image.order - b.image.order);
      const best = candidates.find(Boolean);
      if (best) setups.find(b => b.id === 'steer').image = best.image.id;
    },
    cancel,
    destroy() { destroyed = true; ++manifestRevision; cancel(); document.removeEventListener('visibilitychange', visibility); root.replaceChildren(); },
  };
}
