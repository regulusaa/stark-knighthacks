import { MODES } from '/contract/contract.js';
const modeNames = { [MODES.NORMAL]: 'Normal', [MODES.STABILITY]: 'Stability test', [MODES.TRUNK]: 'Trunk interior' };

export function createHostControls({ root, onPlay, onMode, onImage, onTimeout }) {
  const replay = root.querySelector('#replay-pulse');
  const jump = root.querySelector('#jump-to-end');
  const speedButtons = [...root.querySelectorAll('[data-speed]')];
  const modeButtons = [...root.querySelectorAll('[data-mode]')];
  const layerButtons = [...root.querySelectorAll('[data-layer-mode]')];
  const toggles = [...root.querySelectorAll('[data-mode-field]')];
  const pairButtons = [...root.querySelectorAll('[data-pair-image]')];
  const pairWrap = root.querySelector('#adversarial-pair');
  const layerWrap = root.querySelector('#layer-control-wrap');
  const playbackStatus = root.querySelector('#playback-status');
  const modeStatus = root.querySelector('#mode-status');
  let display = null;
  let manifestIds = new Set();
  const pending = new Map();
  const valueFor = field => pending.get(field)?.value ?? display?.[field];
  const mark = (button, active, busy) => {
    button.classList.toggle('active', active);
    button.classList.toggle('pending', busy);
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-busy', String(busy));
  };
  function clear(field) { clearTimeout(pending.get(field)?.timer); pending.delete(field); }
  function clearPending() { for (const field of [...pending.keys()]) clear(field); render(); }
  function request(field, value, send) {
    if (!display) return;
    clear(field);
    pending.set(field, { value, timer: setTimeout(() => { clear(field); render(); onTimeout(); }, 8000) });
    render();
    if (send() === false) { clear(field); render(); }
  }
  function render() {
    const playback = display?.playback;
    const nextPlayback = pending.get('playback')?.value;
    const speed = nextPlayback?.speed ?? playback?.speed ?? 1;
    for (const b of speedButtons) mark(b, Number(b.dataset.speed) === Number(speed), Boolean(nextPlayback) && Number(b.dataset.speed) === Number(speed));
    replay.classList.toggle('pending', nextPlayback?.skipToEnd === false);
    jump.classList.toggle('pending', nextPlayback?.skipToEnd === true);
    const stability = display?.mode === MODES.STABILITY;
    replay.textContent = stability ? 'Replay test' : 'Replay pulse';
    // Stability replays from run 1; pulse-only actions must not suggest another behavior.
    jump.hidden = stability;
    root.querySelector('#speed-control').hidden = stability;
    root.querySelector('#speed-caption').hidden = stability;
    playbackStatus.textContent = nextPlayback ? stability ? 'Restarting at run 1…' : nextPlayback.skipToEnd ? 'Jumping to end…' : `Replaying at ${speed}×…`
      : stability && display.stability ? display.stability.phase === 'playing' ? `Stability test · run ${display.stability.run} / ${display.stability.runs}` : 'Stability test complete'
      : playback?.state === 'playing' ? `Pulse playing · ${playback.speed}×` : playback?.state === 'done' ? 'Pulse complete' : 'Ready to replay';
    const caps = display?.capabilities || {};
    const medical = display?.scoreKind === 'independent';
    for (const b of modeButtons) {
      const mode = b.dataset.mode;
      b.hidden = mode === MODES.STABILITY ? medical || caps.stability !== true : mode === MODES.TRUNK ? caps.trunkInterior !== true : false;
      mark(b, mode === (valueFor('mode') || MODES.NORMAL), mode === pending.get('mode')?.value);
    }
    // Show layers only after the confirmed mode has entered the network.
    layerWrap.hidden = display?.mode !== MODES.TRUNK || caps.layerModes !== true;
    for (const b of layerButtons) mark(b, b.dataset.layerMode === (valueFor('layerMode') || 'full'), b.dataset.layerMode === pending.get('layerMode')?.value);
    for (const b of toggles) {
      const field = b.dataset.modeField;
      b.hidden = caps[field] !== true || typeof display?.[field] !== 'boolean' || (field === 'noiseView' && display?.image?.category !== 'adversarial');
      mark(b, valueFor(field) === true, pending.has(field));
      b.querySelector('span').textContent = valueFor(field) ? 'On' : 'Off';
    }
    const id = display?.image?.id;
    const pair = manifestIds.has('clean_retriever') && manifestIds.has('adv_retriever');
    pairWrap.hidden = !pair || !['clean_retriever', 'adv_retriever'].includes(id);
    for (const b of pairButtons) {
      mark(b, b.dataset.pairImage === (valueFor('imageId') || id), b.dataset.pairImage === pending.get('imageId')?.value);
    }
    root.querySelector('#pair-status').textContent = pending.has('imageId') ? 'Loading image…' : '';
    const names = [...pending.keys()].filter(k => !['imageId', 'playback'].includes(k)).map(k => k === 'mode' ? modeNames[valueFor(k)] : k === 'layerMode' ? `${valueFor(k)} layers` : k === 'noiseView' ? 'Noise ×50' : 'Glow');
    modeStatus.textContent = names.length ? `Applying ${names.join(' · ')}…` : '';
  }
  function play(speed, skipToEnd) { request('playback', { speed, skipToEnd }, () => onPlay({ speed, skipToEnd })); }
  replay.addEventListener('click', () => play(pending.get('playback')?.value?.speed ?? display?.playback?.speed ?? 1, false));
  jump.addEventListener('click', () => { if (!jump.hidden) play(display?.playback?.speed ?? 1, true); });
  for (const b of speedButtons) b.addEventListener('click', () => { if (!root.querySelector('#speed-control').hidden) play(Number(b.dataset.speed), false); });
  for (const b of modeButtons) b.addEventListener('click', () => { if (!b.hidden) request('mode', b.dataset.mode, () => onMode({ mode: b.dataset.mode })); });
  for (const b of layerButtons) b.addEventListener('click', () => { if (!layerWrap.hidden) request('layerMode', b.dataset.layerMode, () => onMode({ layerMode: b.dataset.layerMode })); });
  for (const b of toggles) b.addEventListener('click', () => {
    if (b.hidden) return;
    const field = b.dataset.modeField; const value = valueFor(field) !== true;
    request(field, value, () => onMode({ [field]: value }));
  });
  for (const b of pairButtons) b.addEventListener('click', () => {
    if (pairWrap.hidden || pending.has('imageId') || b.dataset.pairImage === display?.image?.id) return;
    request('imageId', b.dataset.pairImage, () => onImage(b.dataset.pairImage));
  });
  function setDisplay(value) {
    if (display?.image?.id && display.image.id !== value?.image?.id) clearPending();
    display = value;
    for (const [field, item] of pending) {
      if (field === 'playback') {
        const p = value?.playback;
        if (p?.speed === item.value.speed && (item.value.skipToEnd ? p.state === 'done' : p.state === 'playing')) clear(field);
      } else if ((field === 'imageId' ? value?.image?.id : value?.[field]) === item.value) clear(field);
    }
    render();
  }
  render();
  return { setDisplay, clearPending, setManifest(value) { manifestIds = new Set(value?.images?.map(i => i.id) || []); render(); } };
}
