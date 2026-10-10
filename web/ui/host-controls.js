const modeNames = { normal: 'Normal', stability: 'Stability test', trunk: 'Trunk interior' };

export function createHostControls({ root, onPlay, onMode, onTimeout }) {
  const replay = root.querySelector('#replay-pulse');
  const jump = root.querySelector('#jump-to-end');
  const speedButtons = [...root.querySelectorAll('[data-speed]')];
  const modeButtons = [...root.querySelectorAll('[data-mode]')];
  const layerButtons = [...root.querySelectorAll('[data-layer-mode]')];
  const layerWrap = root.querySelector('#layer-control-wrap');
  const playbackStatus = root.querySelector('#playback-status');
  const modeStatus = root.querySelector('#mode-status');
  let display = null;
  let pendingPlayback = null;
  let pendingMode = null;
  let pendingLayer = null;
  let pendingTimer = 0;

  function scheduleTimeout() {
    clearTimeout(pendingTimer);
    pendingTimer = setTimeout(() => {
      pendingPlayback = pendingMode = pendingLayer = null;
      render();
      onTimeout();
    }, 8000);
  }

  function render() {
    const playback = display?.playback;
    const speed = pendingPlayback?.speed ?? playback?.speed ?? 1;
    for (const button of speedButtons) {
      const active = Number(button.dataset.speed) === Number(speed);
      button.classList.toggle('active', active);
      button.classList.toggle('pending', active && Boolean(pendingPlayback));
      button.setAttribute('aria-pressed', String(active));
    }
    replay.classList.toggle('pending', pendingPlayback?.skipToEnd === false);
    jump.classList.toggle('pending', pendingPlayback?.skipToEnd === true);
    playbackStatus.textContent = pendingPlayback ? pendingPlayback.skipToEnd ? 'Jumping to end…' : `Replaying at ${speed}×…`
      : playback?.state === 'playing' ? `Pulse playing · ${playback.speed}×`
      : playback?.state === 'done' ? 'Pulse complete' : 'Ready to replay';

    const capabilities = display?.capabilities || {};
    for (const button of modeButtons) {
      const mode = button.dataset.mode;
      button.hidden = mode === 'stability' ? !capabilities.stability : mode === 'trunk' ? !capabilities.trunkInterior : false;
      const active = mode === (pendingMode || display?.mode || 'normal');
      button.classList.toggle('active', active);
      button.classList.toggle('pending', mode === pendingMode);
      button.setAttribute('aria-pressed', String(active));
    }
    layerWrap.hidden = !capabilities.layerModes;
    for (const button of layerButtons) {
      const mode = button.dataset.layerMode;
      const active = mode === (pendingLayer || display?.layerMode || 'full');
      button.classList.toggle('active', active);
      button.classList.toggle('pending', mode === pendingLayer);
      button.setAttribute('aria-pressed', String(active));
    }
    modeStatus.textContent = pendingMode ? `Applying ${modeNames[pendingMode]}…` : pendingLayer ? `Applying ${pendingLayer} layers…` : '';
  }

  function play(speed, skipToEnd) {
    if (!display) return;
    pendingPlayback = { speed, skipToEnd };
    render();
    scheduleTimeout();
    onPlay({ speed, skipToEnd });
  }

  replay.addEventListener('click', () => play(pendingPlayback?.speed ?? display?.playback?.speed ?? 1, false));
  jump.addEventListener('click', () => play(pendingPlayback?.speed ?? display?.playback?.speed ?? 1, true));
  for (const button of speedButtons) button.addEventListener('click', () => play(Number(button.dataset.speed), false));
  for (const button of modeButtons) button.addEventListener('click', () => {
    if (!display || button.hidden) return;
    pendingMode = button.dataset.mode;
    render();
    scheduleTimeout();
    onMode({ mode: pendingMode });
  });
  for (const button of layerButtons) button.addEventListener('click', () => {
    if (!display || layerWrap.hidden) return;
    pendingLayer = button.dataset.layerMode;
    render();
    scheduleTimeout();
    onMode({ layerMode: pendingLayer });
  });

  function setDisplay(value) {
    const imageChanged = display?.image?.id && display.image.id !== value?.image?.id;
    display = value;
    if (imageChanged) pendingPlayback = pendingMode = pendingLayer = null;
    if (pendingPlayback && value?.playback?.speed === pendingPlayback.speed &&
        (pendingPlayback.skipToEnd ? value.playback.state === 'done' : value.playback.state === 'playing')) pendingPlayback = null;
    if (pendingMode && value?.mode === pendingMode) pendingMode = null;
    if (pendingLayer && value?.layerMode === pendingLayer) pendingLayer = null;
    if (!pendingPlayback && !pendingMode && !pendingLayer) clearTimeout(pendingTimer);
    render();
  }

  render();
  return { setDisplay, clearPending() { pendingPlayback = pendingMode = pendingLayer = null; clearTimeout(pendingTimer); render(); } };
}
