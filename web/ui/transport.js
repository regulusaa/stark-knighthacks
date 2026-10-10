import { EVENTS, ERROR_CODES, ROLES } from '/contract/contract.js';

const allowedEvents = new Set(Object.values(EVENTS));
const fixtureRoot = '/contract/fixtures/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export function connect({ room, role = ROLES.GUEST, key } = {}) {
  const params = new URLSearchParams(location.search);
  const mock = params.get('mock') === '1';
  const scene = params.get('scene') || '';
  const longAnswers = params.get('answers') === 'long';
  const initialFocusId = Number(params.get('focus'));
  const listeners = new Map();
  const statusListeners = new Set();
  const timers = new Set();
  let closed = false;
  let displayState = null;
  let manifest = null;
  let fixtureError = null;
  let fgsm = null;
  let currentDriver = null;

  const status = {
    phase: 'connecting',
    reason: null,
    clientId: role === ROLES.HOST ? 'h_mock' : 'c_local',
    label: role === ROLES.HOST ? 'Host' : 'Guest 1',
    subscribe(callback) {
      if (typeof callback !== 'function') throw new TypeError('status callback must be a function');
      statusListeners.add(callback);
      callback(status);
      return () => statusListeners.delete(callback);
    },
  };

  function setStatus(phase, reason = null) {
    if (closed) return;
    status.phase = phase;
    status.reason = reason;
    for (const callback of statusListeners) callback(status);
  }

  function deliver(event, payload) {
    if (closed) return;
    for (const callback of listeners.get(event) || []) callback(payload);
  }

  function later(ms, callback) {
    const timer = setTimeout(() => { timers.delete(timer); if (!closed) callback(); }, ms);
    timers.add(timer);
  }

  function updateDisplay(patch) {
    displayState = { ...displayState, ...patch };
    deliver(EVENTS.DISPLAY_STATE, structuredClone(displayState));
  }

  function mockError(code, message, extra = {}) {
    deliver(EVENTS.ERROR, { code, message, ...extra });
  }

  async function loadFixture(name) {
    const response = await fetch(`${fixtureRoot}${name}.json`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load contract fixture ${name}`);
    return response.json();
  }

  function longAnswerDisplay(base) {
    const original = new Map(base.answers.map(answer => [answer.classId, answer]));
    const top1 = { ...original.get(852), rank: 1, score: 0.41, isTop1: true, isTrueClass: false };
    const entries = [
      top1,
      { ...original.get(208), rank: 2, score: 0.11 },
      { ...original.get(205), rank: 3, score: 0.05 },
      { ...original.get(222), rank: 4, score: 0.03 },
      { ...original.get(257), rank: 5, score: 0.025 },
      { classId: 209, label: 'Chesapeake Bay retriever', score: 0.02, rank: 6, hasHeatmap: true },
      { classId: 206, label: 'curly-coated retriever', score: 0.015, rank: 7, hasHeatmap: false },
      { classId: 213, label: 'Irish setter', score: 0.012, rank: 8, hasHeatmap: true },
      { classId: 212, label: 'English setter', score: 0.009, rank: 9, hasHeatmap: false },
      { classId: 210, label: 'German short-haired pointer', score: 0.007, rank: 10, hasHeatmap: false },
      { ...original.get(207), rank: 12, score: 0.004, isTop1: false, isTrueClass: true },
    ].map(answer => ({ isTop1: false, isTrueClass: false, ...answer }));
    return {
      ...base,
      image: { id: 'adv_retriever', name: 'Adversarial retriever', category: 'adversarial' },
      top1,
      trueClass: entries.at(-1),
      answers: entries,
    };
  }

  async function beginMock() {
    try {
      [displayState, manifest, fixtureError, fgsm] = await Promise.all([
        loadFixture('display-state'), loadFixture('manifest'), loadFixture('error'), loadFixture('fgsm'),
      ]);
      // The delay is part of the mock, not an arbitrary loading animation.
      await delay(2000);
      if (closed) return;
      if (scene === 'connecting') return;
      console.info('[mock emit]', EVENTS.REGISTER, { room, role, key: key ? '[redacted]' : undefined });
      if (!room || scene === 'error-no-room' || !/^[A-HJ-NP-Z2-9]{5}$/i.test(room)) {
        setStatus('connected');
        mockError(ERROR_CODES.NO_ROOM, 'That room is not available. Ask Ray for the code.');
        return;
      }
      if (role === ROLES.HOST && (!key || scene === 'error-bad-key')) {
        setStatus('connected');
        mockError(ERROR_CODES.BAD_KEY, 'This host link has the wrong key. Ask Ray for a fresh link.');
        return;
      }
      if (scene === 'error-reconnecting') {
        setStatus('reconnecting', 'Connection lost');
        return;
      }
      setStatus('connected');
      if (scene === 'waiting-for-display') return;
      if (scene === 'error-offline') {
        deliver(EVENTS.PEER_LEFT, { clientId: 'd_mock', role: ROLES.DISPLAY, label: 'Display' });
        return;
      }

      const otherGuest = fixtureError.driver;
      currentDriver = scene === 'guest-driving' ? { id: status.clientId, label: status.label, isHost: false }
        : scene === 'guest-viewing' || scene === 'error-locked' ? otherGuest : null;
      displayState = structuredClone(displayState);
      if (longAnswers) displayState = longAnswerDisplay(displayState);
      displayState.room = room;
      displayState.driver = currentDriver;
      displayState.focus = displayState.answers.find(answer => answer.classId === initialFocusId) || null;
      deliver(EVENTS.PEER_JOINED, { clientId: 'd_mock', role: ROLES.DISPLAY, label: 'Display' });
      deliver(EVENTS.DISPLAY_STATE, structuredClone(displayState));
      if (displayState.focus) deliver(EVENTS.FOCUS_STATE, structuredClone(displayState.focus));
      if (scene === 'error-locked') {
        later(400, () => mockError(ERROR_CODES.LOCKED, fixtureError.message, { event: EVENTS.TAKE_CONTROL, driver: otherGuest }));
      }
      if (scene) return;

      // The default mock demonstrates the complete room story on a loop once.
      later(2500, () => {
        const next = manifest.images.find(image => image.id !== displayState.image.id);
        if (next) {
          const top1 = { ...fgsm.adversarial, rank: 1, hasHeatmap: true, isTop1: true, isTrueClass: false };
          const trueClass = { classId: fgsm.trueClass.classId, label: fgsm.trueClass.label, score: fgsm.trueClass.adversarialScore, rank: 2, hasHeatmap: true, isTop1: false, isTrueClass: true };
          updateDisplay({ image: { id: next.id, name: next.name, category: next.category }, top1, trueClass, answers: [top1, trueClass], mode: 'normal', focus: null, capabilities: { ...displayState.capabilities, stability: false } });
        }
      });
      later(5000, () => {
        currentDriver = otherGuest;
        updateDisplay({ driver: otherGuest });
        deliver(EVENTS.DRIVER_CHANGED, { driver: otherGuest, reason: 'take' });
      });
      later(6200, () => mockError(ERROR_CODES.LOCKED, fixtureError.message, { event: EVENTS.TAKE_CONTROL, driver: otherGuest }));
      later(8500, () => {
        setStatus('disconnected', 'Display connection lost');
        deliver(EVENTS.PEER_LEFT, { clientId: 'd_mock', role: ROLES.DISPLAY, label: 'Display' });
      });
      later(10000, () => setStatus('reconnecting', 'Trying again'));
      later(12000, () => {
        currentDriver = null;
        setStatus('connected');
        deliver(EVENTS.PEER_JOINED, { clientId: 'd_mock', role: ROLES.DISPLAY, label: 'Display' });
        updateDisplay({ driver: null });
      });
    } catch (error) {
      setStatus('error', error.message);
    }
  }

  function emit(event, payload = {}) {
    if (!allowedEvents.has(event)) throw new RangeError(`Unknown contract event: ${event}`);
    console.info(`[${mock ? 'mock' : 'socket stub'} emit]`, event, event === EVENTS.REGISTER ? { ...payload, key: payload.key ? '[redacted]' : undefined } : payload);
    if (!mock || closed || status.phase !== 'connected') return;
    if (event === EVENTS.TAKE_CONTROL) {
      if (currentDriver && currentDriver.id !== status.clientId && role !== ROLES.HOST) {
        later(280, () => mockError(ERROR_CODES.LOCKED, fixtureError.message, { event, driver: currentDriver }));
      } else {
        later(280, () => {
          currentDriver = { id: status.clientId, label: status.label, isHost: role === ROLES.HOST };
          updateDisplay({ driver: currentDriver });
          deliver(EVENTS.DRIVER_CHANGED, { driver: currentDriver, reason: 'take' });
        });
      }
    } else if (event === EVENTS.FOCUS_TIP && displayState) {
      const answer = displayState.answers.find(item => item.classId === payload.classId);
      if (answer) { updateDisplay({ focus: answer }); deliver(EVENTS.FOCUS_STATE, answer); }
    } else if (event === EVENTS.CLEAR_FOCUS && displayState) {
      updateDisplay({ focus: null }); deliver(EVENTS.FOCUS_STATE, null);
    } else if (event === EVENTS.SELECT_IMAGE && role === ROLES.HOST && displayState) {
      const image = manifest.images.find(item => item.id === payload.imageId);
      if (image) updateDisplay({ image: { id: image.id, name: image.name, category: image.category }, focus: null });
    }
  }

  const api = {
    on(event, callback) {
      if (!allowedEvents.has(event)) throw new RangeError(`Unknown contract event: ${event}`);
      if (typeof callback !== 'function') throw new TypeError('listener must be a function');
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
      return () => listeners.get(event)?.delete(callback);
    },
    emit,
    status,
    close() {
      if (closed) return;
      closed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      statusListeners.clear();
      status.phase = 'closed';
    },
  };

  if (mock) void beginMock();
  else queueMicrotask(() => setStatus('error', 'Live connection arrives in CX-5. Add ?mock=1 to preview the controller.'));
  return api;
}
