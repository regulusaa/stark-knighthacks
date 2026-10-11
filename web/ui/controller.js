import { EVENTS, ERROR_CODES, ROLES, READY_FLAG } from '/contract/contract.js';
import { create as createGestures } from '/ui/gestures.js';
import { createAnswerList } from '/ui/answer-list.js';
import { createGallery } from '/ui/gallery.js';
import { createHostControls } from '/ui/host-controls.js';
import { connect } from '/ui/transport.js';
import { stabilityPlaying } from '/ui/presentation.js';
import { createSteerPanel } from '/ui/steer/panel.js';
import { createDemoRail } from '/ui/demo-rail.js';
import { mountWorkspaceTabs } from '/ui/workspace-tabs.js';
import { createSceneController } from '/ui/scene-controller.js';

const query = new URLSearchParams(location.search);
const room = (query.get('room') || '').trim().toUpperCase();
const role = query.get('role') === ROLES.HOST ? ROLES.HOST : ROLES.GUEST;
const key = query.get('key') || undefined;
const mockScene = query.get('scene') || '';

const app = document.getElementById('app');
const stateScreen = document.getElementById('state-screen');
const workbench = document.getElementById('workbench');
const bottomBar = document.getElementById('bottom-bar');
const trackpadFrame = document.getElementById('trackpad-frame');
const trackpadLock = document.getElementById('trackpad-lock');
const takeCenter = document.getElementById('take-control-center');
const takeBottom = document.getElementById('take-control-bottom');
const resetBottom = document.getElementById('reset-view');
const resetHost = document.getElementById('host-reset');
const retry = document.getElementById('retry-button');
const notice = document.getElementById('notice');
const connectionDetail = document.getElementById('connection-detail');

let transport;
let state = 'connecting';
let errorKind = null;
let display = null;
let pendingControl = false;
let noticeTimer = 0;
let wakeLock = null;
let wakeRequest = null;
let queuedFocus = null;
let optimisticFocus = null;
let hostTakePending = false;
let connectionWatchdog = 0;
let connectionTimedOut = false;
let selectedPanel = 'answers';
let steerPanel = null;
let sceneController = null, sceneSeq = 0, queuedScene = null;
const drivenKey = 'stark:has-driven';
let hasDriven = false;
try { hasDriven = sessionStorage.getItem(drivenKey) === '1'; } catch {}

app.dataset.role = role;
if (query.get('mock') === '1') {
  document.querySelector('.brand small').textContent = 'MOCK PREVIEW';
  document.querySelector('.current-image .eyebrow').textContent = 'MOCK DATA / NOW SHOWING';
}
document.getElementById('room-code').textContent = room || 'NO ROOM';
document.getElementById('host-slots').hidden = role !== ROLES.HOST;
document.getElementById('host-gallery').hidden = role !== ROLES.HOST;
if (role === ROLES.HOST) {
  document.querySelector('#answers-panel .slot-index').textContent = '04';
  document.getElementById('side-panel').insertBefore(document.getElementById('host-slots'), document.getElementById('explore-tabs'));
}
window[READY_FLAG] = false;
window.__cx2Ready = false;

const screens = {
  connecting: ['CONNECTING', 'Finding the display', 'This usually takes a moment.', false],
  'waiting-for-display': ['CONNECTED', 'Waiting for the screen…', 'Your room is connected. The screen will appear here when it is ready.', false],
  noRoom: ['ROOM NOT FOUND', 'Ask Ray for the code', 'This room is unavailable. Scan the current QR code or ask Ray for a new link.', true],
  badKey: ['HOST ACCESS', 'Host link not accepted', 'Ask Ray for a fresh host link.', true],
  offline: ['DISPLAY OFFLINE', 'The display went away', 'Keep this page open and try again when the monitor is ready.', true],
  reconnecting: ['RECONNECTING', 'Reaching the display again', 'Your connection dropped. We are trying to get you back in.', true],
  unavailable: ['NOT CONNECTED', 'Could not join the room', 'Check your connection and try again.', true],
};

function haptic(duration = 8) { navigator.vibrate?.(duration); }

function showNotice(message) {
  clearTimeout(noticeTimer);
  notice.textContent = message;
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, 4200);
}

function scoreText(answer) {
  if (!answer) return 'Waiting for a model score';
  return `${answer.label} · Model score ${(answer.score * 100).toFixed(1)}%`;
}

function isDriving() {
  return transport?.status.phase === 'connected' && (role === ROLES.HOST || (!pendingControl && display?.driver?.id && display.driver.id === transport?.status.clientId));
}

function stopConnectionWatchdog() { clearTimeout(connectionWatchdog); connectionWatchdog = 0; }

function armConnectionWatchdog() {
  stopConnectionWatchdog();
  connectionWatchdog = setTimeout(() => {
    if (transport?.status.phase === 'connected' || state !== 'connecting') return;
    connectionTimedOut = true;
    setState('error', 'reconnecting');
  }, 8000);
}

function setState(next, kind = null) {
  state = next;
  errorKind = kind;
  app.dataset.state = state;
  render();
  const expected = {
    connecting: 'connecting',
    'waiting-for-display': 'waiting-for-display',
    'guest-viewing': 'guest-viewing',
    'guest-driving': 'guest-driving',
    host: 'host',
    'error-no-room': 'error:noRoom',
    'error-bad-key': 'error:badKey',
    'error-offline': 'error:offline',
    'error-reconnecting': 'error:reconnecting',
  }[mockScene];
  if (expected && expected === `${next}${kind ? `:${kind}` : ''}`) window.__cx2Ready = true;
}

function render() {
  renderSteer();
  sceneController?.setContext({display,driving:Boolean(isDriving()),connected:transport?.status.phase==='connected',clientId:transport?.status.clientId});
  const active = state === 'guest-viewing' || state === 'guest-driving' || state === 'host';
  stateScreen.hidden = active;
  workbench.hidden = !active;
  bottomBar.hidden = !active || role === ROLES.HOST;
  app.classList.toggle('first-visit', active && role === ROLES.GUEST && !hasDriven);

  const label = document.getElementById('connection-label');
  if (!active) {
    const config = screens[state === 'error' ? errorKind || 'unavailable' : state] || screens.unavailable;
    document.getElementById('state-kicker').textContent = config[0];
    document.getElementById('state-title').textContent = config[1];
    document.getElementById('state-message').textContent = config[2];
    retry.hidden = !config[3];
    connectionDetail.hidden = state === 'connecting' || state === 'waiting-for-display';
    connectionDetail.textContent = connectionTimedOut
      ? 'No response after 8 seconds · reconnecting automatically.'
      : errorKind === 'reconnecting' ? 'Reconnecting automatically · Retry starts a fresh connection.'
      : errorKind === 'offline' ? 'Connected to the room · waiting for the display to return.'
      : '';
    if (!connectionDetail.textContent) connectionDetail.hidden = true;
    label.textContent = state === 'error' ? errorKind === 'reconnecting' ? 'Reconnecting' : 'No signal' : state === 'connecting' ? 'Connecting' : 'Waiting';
    if (state !== 'connecting') window[READY_FLAG] = true;
    return;
  }

  window[READY_FLAG] = true;
  const driving = Boolean(isDriving());
  if (driving && role === ROLES.GUEST && !hasDriven) {
    hasDriven = true;
    try { sessionStorage.setItem(drivenKey, '1'); } catch {}
    app.classList.remove('first-visit');
  }
  const firstVisit = role === ROLES.GUEST && !hasDriven;
  bottomBar.hidden = !active || role === ROLES.HOST || firstVisit;
  document.getElementById('first-drive-help').hidden = !firstVisit;
  const guestViewing = role === ROLES.GUEST && !driving;
  const otherLabel = display?.driver?.id !== transport?.status.clientId ? display?.driver?.label : null;
  document.getElementById('driver-label').textContent = role === ROLES.HOST ? 'Host control' : driving ? 'You are driving' : pendingControl ? 'Requesting control' : otherLabel ? `${otherLabel} is driving` : 'Ready for a driver';
  label.textContent = role === ROLES.HOST ? 'Host' : driving ? 'Driving' : pendingControl ? 'Requesting' : otherLabel ? `${otherLabel} driving` : 'Viewing';
  if (firstVisit && !pendingControl && !otherLabel) label.textContent = 'Connected';
  document.querySelector('.trackpad-note').textContent = display?.mode === 'trunk' ? 'Inside the network: 49 layers' : 'Movement goes to the display while you drive.';
  document.getElementById('image-name').textContent = display?.image?.name || 'Waiting for image';
  document.getElementById('top-answer').textContent = scoreText(display?.top1);
  const truth = document.getElementById('truth-status');
  truth.hidden = display?.scoreKind === 'independent' || !display?.top1 || !display?.trueClass;
  if (!truth.hidden) {
    const correct = display.top1.classId === display.trueClass.classId;
    truth.dataset.correct = String(correct);
    document.getElementById('correctness').textContent = correct ? 'Correct' : 'Incorrect';
    document.getElementById('true-class-name').textContent = `· True class: ${display.trueClass.label}`;
  }
  trackpadFrame.classList.toggle('locked', guestViewing);
  trackpadLock.hidden = !guestViewing;
  document.getElementById('lock-message').textContent = otherLabel ? `${otherLabel} is driving` : 'Take the wheel';
  takeCenter.textContent = pendingControl ? 'Requesting…' : 'Take control';
  takeBottom.textContent = pendingControl ? 'Requesting…' : driving ? 'You are driving' : 'Take control';
  takeCenter.disabled = pendingControl;
  takeBottom.disabled = pendingControl || driving;
  resetBottom.disabled = !driving;
}

async function acquireWakeLock() {
  if (wakeLock || wakeRequest || document.visibilityState !== 'visible' || !navigator.wakeLock || transport?.status.phase !== 'connected' || state === 'error') return;
  wakeRequest = navigator.wakeLock.request('screen').then(lock => {
    if (state === 'error') { void lock.release().catch(() => {}); return; }
    wakeLock = lock;
    lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
  }).catch(() => {}).finally(() => { wakeRequest = null; });
  await wakeRequest;
}

function releaseWakeLock() {
  const lock = wakeLock;
  wakeLock = null;
  if (lock) void lock.release().catch(() => {});
}

function onStatus(status) {
  if (status.phase === 'connecting') { display = null; armConnectionWatchdog(); setState('connecting'); }
  else if (status.phase === 'connected') {
    stopConnectionWatchdog();
    connectionTimedOut = false;
    if (!display) setState('waiting-for-display');
    void acquireWakeLock();
  } else if (status.phase === 'disconnected') {
    display = null;
    pendingControl = false;
    queuedFocus = null;
    optimisticFocus = null;
    hostTakePending = false;
    gallery?.clearPending();
    hostControls?.clearPending();
    demoRail?.setDisplay(null);
    releaseWakeLock();
    setState('error', 'offline');
  } else if (status.phase === 'reconnecting') {
    display = null;
    pendingControl = false;
    queuedFocus = null;
    optimisticFocus = null;
    hostTakePending = false;
    gallery?.clearPending();
    hostControls?.clearPending();
    demoRail?.setDisplay(null);
    releaseWakeLock();
    if (!connectionWatchdog) armConnectionWatchdog();
    setState('error', 'reconnecting');
  } else if (status.phase === 'error') {
    stopConnectionWatchdog();
    releaseWakeLock();
    setState('error', status.reason === ERROR_CODES.NO_ROOM ? 'noRoom' : status.reason === ERROR_CODES.BAD_KEY ? 'badKey' : 'unavailable');
  }
}

function onDisplayState(value) {
  const imageChanged = Boolean(display && display.image?.id !== value.image?.id);
  display = value;
  if (value.driver?.id === transport?.status.clientId) hostTakePending = false;
  gallery?.setCurrent(value.image?.id);
  hostControls?.setDisplay(value);
  demoRail?.setDisplay(value);
  answerList.setContext(value);
  const answersChanged = answerList.setAnswers(value.answers);
  if (stabilityPlaying(value)) { queuedFocus = null; optimisticFocus = null; }
  if (imageChanged) {
    queuedFocus = null;
    optimisticFocus = null;
    answerList.setFocus(null, { scroll: false });
    answerList.resetScroll();
  } else if (optimisticFocus && answersChanged) {
    answerList.setFocus(value.answers.find(answer => answer.classId === optimisticFocus.classId) || null);
  } else if (!optimisticFocus || (value.focus?.classId ?? null) === optimisticFocus.classId) {
    optimisticFocus = null;
    answerList.setFocus(value.focus);
  }
  setState(role === ROLES.HOST ? 'host' : isDriving() ? 'guest-driving' : 'guest-viewing');
  void acquireWakeLock();
}

function onDriverChanged({ driver, reason }) {
  if (driver?.id !== transport?.status.clientId) { queuedScene = null; sceneController?.cancel(); }
  if (!display) return;
  const previous = display.driver;
  const wasDriving = previous?.id === transport?.status.clientId;
  display = { ...display, driver };
  pendingControl = false;
  hostTakePending = false;
  const driving = Boolean(isDriving());
  setState(role === ROLES.HOST ? 'host' : driving ? 'guest-driving' : 'guest-viewing');
  if (reason === 'idle' && wasDriving && role === ROLES.GUEST) showNotice('Tap to take control again');
  else if (driver && driver.id !== transport?.status.clientId && driver.id !== previous?.id) {
    showNotice(reason === 'host-override' ? `${driver.label} is driving` : `${driver.label} took control`);
  }
  if (driving && role === ROLES.GUEST) {
    haptic(12);
    if (queuedScene) { const action = queuedScene; queuedScene = null; requestSceneAction(action); }
    if (queuedFocus && !stabilityPlaying(display)) {
      const { event, payload } = queuedFocus;
      queuedFocus = null;
      transport.emit(event, payload);
    }
  } else if (queuedFocus) {
    queuedFocus = null;
    optimisticFocus = null;
    answerList.setFocus(display.focus);
  }
}

function onFocusState(value) {
  if (!display) return;
  display = { ...display, focus: value };
  optimisticFocus = null;
  answerList.setFocus(value);
}

function onError(error) {
  if (!error || typeof error !== 'object') error = { message: 'That action did not work. Try again.' };
  steerPanel?.setError(error);
  pendingControl = false;
  queuedScene = null; sceneController?.cancel();
  if (error.event === EVENTS.TAKE_CONTROL) hostTakePending = false;
  if ([EVENTS.TAKE_CONTROL, EVENTS.FOCUS_TIP, EVENTS.CLEAR_FOCUS].includes(error.event)) {
    queuedFocus = null;
    optimisticFocus = null;
    answerList.setFocus(display?.focus);
  }
  if (role === ROLES.HOST) {
    gallery?.clearPending();
    hostControls?.clearPending();
    demoRail?.cancel();
  }
  if (error.code === ERROR_CODES.NO_ROOM) { stopConnectionWatchdog(); releaseWakeLock(); setState('error', 'noRoom'); }
  else if (error.code === ERROR_CODES.BAD_KEY) { stopConnectionWatchdog(); releaseWakeLock(); setState('error', 'badKey'); }
  else if (error.code === ERROR_CODES.LOCKED) {
    if (display && error.driver) display = { ...display, driver: error.driver };
    queuedFocus = null;
    optimisticFocus = null;
    answerList.setFocus(display?.focus);
    setState(role === ROLES.HOST ? 'host' : 'guest-viewing');
    showNotice(error.driver ? `${error.driver.label} is driving · Take control in a moment` : 'Someone else is driving · Take control in a moment');
    if (mockScene === 'error-locked') window.__cx2Ready = true;
    haptic(6);
  } else if (error.code === ERROR_CODES.FORBIDDEN) {
    const driverEvent = [EVENTS.CONTROL_ORBIT, EVENTS.CONTROL_ZOOM, EVENTS.SCENE_ACTION, EVENTS.FOCUS_TIP, EVENTS.CLEAR_FOCUS, EVENTS.RESET_VIEW, EVENTS.STEER_UPDATE, EVENTS.STEER_RESET].includes(error.event);
    if (driverEvent && role === ROLES.GUEST && display?.driver?.id === transport?.status.clientId) {
      display = { ...display, driver: null };
      setState('guest-viewing');
    }
    queuedFocus = null;
    optimisticFocus = null;
    answerList.setFocus(display?.focus);
    showNotice(error.message || 'This control is unavailable right now.');
  } else if (error.code === ERROR_CODES.BAD_PAYLOAD) showNotice(error.message || 'That control was not accepted.');
  else if (error.code === ERROR_CODES.RATE_LIMITED) showNotice('Too many inputs · slow down for a moment.');
  else showNotice(error.message || 'That action did not work. Please try again.');
}

function startConnection() {
  queuedScene = null; sceneController?.cancel();
  stopConnectionWatchdog();
  connectionTimedOut = false;
  transport?.close();
  releaseWakeLock();
  display = null;
  pendingControl = false;
  queuedFocus = null;
  optimisticFocus = null;
  hostTakePending = false;
  gallery?.clearPending();
  hostControls?.setDisplay(null);
  demoRail?.setDisplay(null);
  answerList.setAnswers([]);
  answerList.setFocus(null);
  window[READY_FLAG] = false;
  setState('connecting');
  transport = connect({ room, role, key });
  transport.on(EVENTS.DISPLAY_STATE, onDisplayState);
  transport.on(EVENTS.DRIVER_CHANGED, onDriverChanged);
  transport.on(EVENTS.FOCUS_STATE, onFocusState);
  transport.on(EVENTS.ERROR, onError);
  transport.on(EVENTS.STEER_RESULT, value => steerPanel?.setResult(value));
  transport.on(EVENTS.PEER_LEFT, peer => {
    if (peer.role === ROLES.DISPLAY) {
      display = null;
      releaseWakeLock();
      demoRail?.setDisplay(null);
      setState('waiting-for-display');
    }
  });
  transport.on(EVENTS.PEER_JOINED, peer => {
    if (peer.role === ROLES.DISPLAY && !display) setState('waiting-for-display');
  });
  transport.status.subscribe(onStatus);
}

function takeControl() {
  if (role !== ROLES.GUEST || pendingControl || state !== 'guest-viewing' || transport?.status.phase !== 'connected') return;
  pendingControl = true;
  haptic();
  render();
  transport.emit(EVENTS.TAKE_CONTROL, {});
}

function claimHostControl() {
  if (role !== ROLES.HOST || !display || transport?.status.phase !== 'connected') return;
  if (display.driver?.id === transport.status.clientId || hostTakePending) return;
  hostTakePending = transport.emit(EVENTS.TAKE_CONTROL, {});
}

function resetView() {
  if (!isDriving() || !display || transport?.status.phase !== 'connected') return;
  claimHostControl();
  transport.emit(EVENTS.RESET_VIEW, {});
  showNotice('Reset view sent to the display.');
  haptic();
}

function requestFocus(event, payload, answer) {
  if (stabilityPlaying(display)) { showNotice('Answers come back when the test ends'); return; }
  if (!display || transport?.status.phase !== 'connected') return;
  const otherDriver = role === ROLES.GUEST && display.driver && display.driver.id !== transport?.status.clientId;
  if (otherDriver) {
    showNotice(`${display.driver.label} is driving · Take control in a moment`);
    haptic(6);
    return;
  }
  optimisticFocus = { classId: answer?.classId ?? null };
  answerList.setFocus(answer);
  haptic();
  if (isDriving()) {
    claimHostControl();
    transport.emit(event, payload);
  } else {
    queuedFocus = { event, payload };
    if (!pendingControl) takeControl();
  }
}

function selectAnswer(answer) { requestFocus(EVENTS.FOCUS_TIP, { classId: answer.classId }, answer); }
function clearFocus() {
  if (answerList.hasFocus()) requestFocus(EVENTS.CLEAR_FOCUS, {}, null);
}

function requestSceneAction(action) {
  if (document.hidden || !display?.capabilities?.inspection || transport?.status.phase !== 'connected') return false;
  if (!isDriving()) {
    if (display.driver) { showNotice(`${display.driver.label} is driving · Take control in a moment`); return false; }
    queuedScene = action; takeControl(); return false;
  }
  claimHostControl();
  const payload = { ...action, seq: ++sceneSeq };
  return transport.emit(EVENTS.SCENE_ACTION,payload) ? payload : false;
}
sceneController = createSceneController({ pane: document.getElementById('scene-pane'), controls: document.getElementById('inspection-controls'), onAction: requestSceneAction, notify: showNotice });
// The result anchors the settings pane; component controls follow it on every device.
const currentImage = document.querySelector('.current-image');
document.getElementById('side-panel').insertBefore(currentImage, document.getElementById('inspection-controls'));
// Keep the guest's existing Reset view action in the scrollable settings pane.
if (role === ROLES.GUEST) document.getElementById('side-panel').insertBefore(resetBottom, document.querySelector('.sensitivity-control'));

const workspaceTabs = mountWorkspaceTabs(document.getElementById('side-panel'));

const answerList = createAnswerList({
  root: document.getElementById('answers-panel'),
  onSelect: selectAnswer,
  onClear: clearFocus,
  onLongLabel: showNotice,
});

steerPanel = createSteerPanel({
  root: document.getElementById('steer-panel'),
  emit(event, payload) {
    if (!display?.capabilities?.steer || !isDriving()) return false;
    claimHostControl();
    return transport.emit(event, payload);
  },
  requestControl: takeControl,
  notify: showNotice,
  onImageChange() { document.getElementById('modify-workspace').scrollTop = 0; },
});
function renderSteer() {
  const available = display?.capabilities?.steer === true;
  if (!available) selectedPanel = 'answers';
  document.getElementById('explore-tabs').hidden = !available;
  document.getElementById('steer-medical-note').hidden = display?.image?.category !== 'medical';
  document.getElementById('steer-panel').hidden = selectedPanel !== 'steer';
  document.getElementById('answers-panel').hidden = selectedPanel !== 'answers';
  for (const button of document.querySelectorAll('[data-panel]')) button.setAttribute('aria-selected', String(button.dataset.panel === selectedPanel));
  steerPanel?.setContext({ display, connected: transport?.status.phase === 'connected', driving: Boolean(isDriving()), clientId: transport?.status.clientId, role, requesting: pendingControl, mock: query.get('mock') === '1' });
}
for (const button of document.querySelectorAll('[data-panel]')) button.addEventListener('click', () => { selectedPanel = button.dataset.panel; renderSteer(); });

const gallery = role === ROLES.HOST ? createGallery({
  root: document.getElementById('gallery-grid'),
  mock: query.get('mock') === '1',
  onSelect: imageId => { transport.emit(EVENTS.SELECT_IMAGE, { imageId }); haptic(); },
  onTimeout: () => showNotice('The image did not load. Try again.'),
}) : null;
const hostControls = role === ROLES.HOST ? createHostControls({
  root: document.getElementById('side-panel'),
  onPlay: payload => { haptic(); return transport.emit(EVENTS.PLAY_PULSE, payload); },
  onMode: payload => { haptic(); return transport.emit(EVENTS.SET_MODE, payload); },
  onImage: imageId => { haptic(); return transport.emit(EVENTS.SELECT_IMAGE, { imageId }); },
  onTimeout: () => showNotice('The display did not confirm that control. Try again.'),
}) : null;
const demoRail = role === ROLES.HOST ? createDemoRail({
  root: document.getElementById('demo-rail'),
  emit: (event, payload) => transport?.emit(event, payload) ?? false,
  notify: showNotice,
  onSteer: () => {
    workspaceTabs.select('modify'); selectedPanel = 'steer'; renderSteer();
    const panel = document.getElementById('steer-panel');
    panel.style.scrollMarginTop = `${document.getElementById('demo-rail').offsetHeight + 16}px`;
    requestAnimationFrame(() => panel.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }));
  },
  mock: query.get('mock') === '1',
}) : null;

if (gallery) {
  const manifestUrl = query.get('mock') === '1' ? '/contract/fixtures/manifest.json' : '/assets/manifest.json';
  fetch(manifestUrl).then(response => {
    if (!response.ok) throw new Error('Gallery manifest unavailable');
    return response.json();
  }).then(manifest => { gallery.setManifest(manifest); hostControls.setManifest(manifest); demoRail.setManifest(manifest); }).catch(() => showNotice('Gallery unavailable. Try again later.'));
}

takeCenter.addEventListener('click', takeControl);
takeBottom.addEventListener('click', takeControl);
resetBottom.addEventListener('click', resetView);
resetHost.addEventListener('click', resetView);
retry.addEventListener('click', () => {
  if (query.get('mock') === '1' && ['error-offline', 'error-reconnecting'].includes(query.get('scene'))) {
    query.delete('scene');
    history.replaceState(null, '', `${location.pathname}?${query}`);
  }
  startConnection();
});
document.addEventListener('visibilitychange', () => {
  app.dataset.pageHidden = String(document.hidden);
  if (document.visibilityState === 'visible') { transport?.reconnect?.(); void acquireWakeLock(); }
  else {
    releaseWakeLock();
    queuedScene = null; sceneController?.cancel();
    queuedFocus = null;
    optimisticFocus = null;
    demoRail?.cancel();
    clearTouches();
  }
});
window.addEventListener('pageshow', () => transport?.reconnect?.());
window.addEventListener('online', () => transport?.reconnect?.());

const sensitivityInput = document.getElementById('sensitivity');
const sensitivityValue = document.getElementById('sensitivity-value');
const sensitivityKey = 'stark:touch-sensitivity';
let initialSensitivity = 1;
try {
  const saved = Number(sessionStorage.getItem(sensitivityKey));
  if (saved >= 0.5 && saved <= 2) initialSensitivity = saved;
} catch {}
sensitivityInput.value = String(initialSensitivity);
sensitivityValue.textContent = `${initialSensitivity.toFixed(1)}×`;
const gestures = createGestures(document.getElementById('trackpad'), { sensitivity: initialSensitivity });
sensitivityInput.addEventListener('input', () => {
  const value = Number(sensitivityInput.value);
  gestures.setSensitivity(value);
  sensitivityValue.textContent = `${value.toFixed(1)}×`;
  try { sessionStorage.setItem(sensitivityKey, String(value)); } catch {}
});
const trackpad = document.getElementById('trackpad');
const touchDots = [document.getElementById('touch-one'), document.getElementById('touch-two')];
const pinchLine = document.getElementById('pinch-line');
const touchPoints = new Map();

function renderTouches() {
  const rect = trackpad.getBoundingClientRect();
  const points = [...touchPoints.values()];
  touchDots.forEach((dot, index) => {
    const point = points[index];
    dot.style.display = point ? 'block' : 'none';
    if (point) {
      dot.style.left = `${point.x - rect.left}px`;
      dot.style.top = `${point.y - rect.top}px`;
    }
  });
  pinchLine.style.display = points.length === 2 ? 'block' : 'none';
  if (points.length === 2) {
    const [a, b] = points;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    pinchLine.style.left = `${a.x - rect.left}px`;
    pinchLine.style.top = `${a.y - rect.top}px`;
    pinchLine.style.width = `${Math.hypot(dx, dy)}px`;
    pinchLine.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  }
  trackpad.classList.toggle('active', points.length > 0);
}
function clearTouches() { touchPoints.clear(); renderTouches(); }
window.addEventListener('orientationchange', clearTouches);

trackpad.addEventListener('pointerdown', event => {
  if (touchPoints.size < 2) touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  renderTouches();
});
trackpad.addEventListener('pointermove', event => {
  if (!touchPoints.has(event.pointerId)) return;
  touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
  renderTouches();
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  trackpad.addEventListener(type, event => { touchPoints.delete(event.pointerId); renderTouches(); });
}
gestures.onOrbit(({ dx, dy }) => { if (display && isDriving()) { claimHostControl(); transport.emit(EVENTS.CONTROL_ORBIT, { dx, dy }); } });
gestures.onZoom(dz => { if (display && isDriving()) { claimHostControl(); transport.emit(EVENTS.CONTROL_ZOOM, { dz }); } });
window.addEventListener('pagehide', event => {
  releaseWakeLock();
  if (!event.persisted) { gestures.destroy(); sceneController?.destroy(); steerPanel.destroy(); demoRail?.destroy(); transport?.close(); }
});

startConnection();
