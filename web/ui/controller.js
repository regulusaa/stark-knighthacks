import { EVENTS, ERROR_CODES, ROLES, READY_FLAG } from '/contract/contract.js';
import { create as createGestures } from '/ui/gestures.js';
import { connect } from '/ui/transport.js';

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

let transport;
let state = 'connecting';
let errorKind = null;
let display = null;
let pendingControl = false;
let noticeTimer = 0;
let wakeLock = null;
let wakeRequest = null;

app.dataset.role = role;
if (query.get('mock') === '1') {
  document.querySelector('.brand small').textContent = 'MOCK PREVIEW';
  document.querySelector('.current-image .eyebrow').textContent = 'MOCK DATA / ON DISPLAY';
}
document.getElementById('room-code').textContent = room || 'NO ROOM';
document.getElementById('host-slots').hidden = role !== ROLES.HOST;
window[READY_FLAG] = false;
window.__cx2Ready = false;

const screens = {
  connecting: ['CONNECTING', 'Finding the display', 'This usually takes a moment.', false],
  'waiting-for-display': ['CONNECTED', 'Waiting for the display', 'The room is ready. Ask Ray to open Stark on the monitor.', true],
  noRoom: ['ROOM NOT FOUND', 'Ask Ray for the code', 'This room is unavailable. Scan the current QR code or ask Ray for a new link.', true],
  badKey: ['HOST ACCESS', 'Host link not accepted', 'The host key is missing or incorrect. Ask Ray for a fresh host link.', true],
  offline: ['DISPLAY OFFLINE', 'The display went away', 'Keep this page open and try again when the monitor is ready.', true],
  reconnecting: ['RECONNECTING', 'Reaching the display again', 'Your connection dropped. We are trying to get you back in.', true],
  unavailable: ['NOT CONNECTED', 'Controller preview', 'Live Socket.io transport arrives in CX-5. Add ?mock=1 to preview this page.', true],
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
  return role === ROLES.HOST || (display?.driver?.id && display.driver.id === transport?.status.clientId);
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
  const active = state === 'guest-viewing' || state === 'guest-driving' || state === 'host';
  stateScreen.hidden = active;
  workbench.hidden = !active;
  bottomBar.hidden = !active || role === ROLES.HOST;

  const label = document.getElementById('connection-label');
  if (!active) {
    const config = screens[state === 'error' ? errorKind || 'unavailable' : state] || screens.unavailable;
    document.getElementById('state-kicker').textContent = config[0];
    document.getElementById('state-title').textContent = config[1];
    document.getElementById('state-message').textContent = config[2];
    retry.hidden = !config[3];
    label.textContent = state === 'error' ? errorKind === 'reconnecting' ? 'Reconnecting' : 'No signal' : state === 'connecting' ? 'Connecting' : 'Waiting';
    if (state !== 'connecting') window[READY_FLAG] = true;
    return;
  }

  window[READY_FLAG] = true;
  const driving = Boolean(isDriving());
  const guestViewing = role === ROLES.GUEST && !driving;
  const otherLabel = display?.driver?.label;
  document.getElementById('driver-label').textContent = role === ROLES.HOST ? 'Host control' : driving ? 'You are driving' : otherLabel ? `${otherLabel} is driving` : 'Ready for a driver';
  label.textContent = role === ROLES.HOST ? 'Host' : driving ? 'Driving' : otherLabel ? `${otherLabel} driving` : 'Viewing';
  document.getElementById('image-name').textContent = display?.image?.name || 'Waiting for image';
  document.getElementById('top-answer').textContent = scoreText(display?.top1);
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
  if (status.phase === 'connecting') { display = null; setState('connecting'); }
  else if (status.phase === 'connected') {
    if (!display) setState('waiting-for-display');
    void acquireWakeLock();
  } else if (status.phase === 'disconnected') {
    display = null;
    pendingControl = false;
    releaseWakeLock();
    setState('error', 'offline');
  } else if (status.phase === 'reconnecting') {
    display = null;
    pendingControl = false;
    releaseWakeLock();
    setState('error', 'reconnecting');
  } else if (status.phase === 'error') {
    releaseWakeLock();
    setState('error', 'unavailable');
  }
}

function onDisplayState(value) {
  display = value;
  pendingControl = false;
  setState(role === ROLES.HOST ? 'host' : isDriving() ? 'guest-driving' : 'guest-viewing');
  void acquireWakeLock();
}

function onDriverChanged({ driver }) {
  if (!display) return;
  display = { ...display, driver };
  pendingControl = false;
  const driving = Boolean(isDriving());
  setState(role === ROLES.HOST ? 'host' : driving ? 'guest-driving' : 'guest-viewing');
  if (driving && role === ROLES.GUEST) haptic(12);
}

function onError(error) {
  pendingControl = false;
  if (error.code === ERROR_CODES.NO_ROOM) { releaseWakeLock(); setState('error', 'noRoom'); }
  else if (error.code === ERROR_CODES.BAD_KEY) { releaseWakeLock(); setState('error', 'badKey'); }
  else if (error.code === ERROR_CODES.LOCKED) {
    if (display && error.driver) display = { ...display, driver: error.driver };
    setState(role === ROLES.HOST ? 'host' : 'guest-viewing');
    showNotice(error.driver ? `${error.driver.label} is driving. Try again when they stop.` : 'Someone else is driving.');
    if (mockScene === 'error-locked') window.__cx2Ready = true;
    haptic(6);
  } else showNotice(error.message || 'That action did not work. Please try again.');
}

function startConnection() {
  transport?.close();
  releaseWakeLock();
  display = null;
  pendingControl = false;
  window[READY_FLAG] = false;
  setState('connecting');
  transport = connect({ room, role, key });
  transport.on(EVENTS.DISPLAY_STATE, onDisplayState);
  transport.on(EVENTS.DRIVER_CHANGED, onDriverChanged);
  transport.on(EVENTS.ERROR, onError);
  transport.on(EVENTS.PEER_LEFT, peer => {
    if (peer.role === ROLES.DISPLAY) {
      display = null;
      releaseWakeLock();
      setState('error', 'offline');
    }
  });
  transport.status.subscribe(onStatus);
}

function takeControl() {
  if (role !== ROLES.GUEST || pendingControl || state !== 'guest-viewing') return;
  pendingControl = true;
  haptic();
  render();
  transport.emit(EVENTS.TAKE_CONTROL, {});
}

function resetView() {
  if (!isDriving() || !display) return;
  transport.emit(EVENTS.RESET_VIEW, {});
  showNotice('Reset view sent to the display.');
  haptic();
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
  if (document.visibilityState === 'visible') void acquireWakeLock();
  else releaseWakeLock();
});

const gestures = createGestures(document.getElementById('trackpad'));
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
gestures.onOrbit(({ dx, dy }) => { if (display && isDriving()) transport.emit(EVENTS.CONTROL_ORBIT, { dx, dy }); });
gestures.onZoom(dz => { if (display && isDriving()) transport.emit(EVENTS.CONTROL_ZOOM, { dz }); });
window.addEventListener('pagehide', () => { releaseWakeLock(); gestures.destroy(); transport?.close(); }, { once: true });

startConnection();
