import { EVENTS, ERROR_CODES, ROLES } from '/contract/contract.js';

const allowedEvents = new Set(Object.values(EVENTS));
const fixtureRoot = '/contract/fixtures/';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let clientScript;

function loadSocketClient() {
  if (window.io) return Promise.resolve(window.io);
  if (!clientScript) clientScript = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/socket.io/socket.io.js';
    script.async = true;
    script.onload = () => window.io ? resolve(window.io) : reject(new Error('Socket.io client did not load'));
    script.onerror = () => { script.remove(); reject(new Error('Socket.io client unavailable')); };
    document.head.append(script);
  }).catch(error => { clientScript = null; throw error; });
  return clientScript;
}

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
  let baseDisplayState = null;
  let manifest = null;
  let fixtureError = null;
  let fgsm = null;
  let medical = null;
  let currentDriver = null;
  let playbackToken = 0;
  let steerMock = null;

  const status = {
    phase: 'connecting',
    reason: null,
    clientId: mock ? role === ROLES.HOST ? 'h_mock' : 'c_local' : null,
    label: mock ? role === ROLES.HOST ? 'Host' : 'Guest 1' : null,
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

  function mockImageState(image) {
    const next = structuredClone(baseDisplayState);
    next.room = room;
    next.driver = currentDriver;
    next.image = { id: image.id, name: image.name, category: image.category };
    next.focus = null;
    next.mode = 'normal';
    next.layerMode = 'full';
    next.playback = { state: 'done', speed: 1 };
    if (image.id === 'adv_retriever') {
      const top1 = { classId: fgsm.adversarial.classId, label: fgsm.adversarial.label, score: fgsm.adversarial.score, rank: 1, hasHeatmap: true, isTop1: true, isTrueClass: false };
      const trueClass = { classId: fgsm.trueClass.classId, label: fgsm.trueClass.label, score: fgsm.trueClass.adversarialScore, rank: 2, hasHeatmap: true, isTop1: false, isTrueClass: true };
      next.top1 = top1;
      next.trueClass = trueClass;
      next.answers = [top1, trueClass];
      next.capabilities.stability = false;
    } else if (image.id === 'ambig_husky') {
      const top1 = { classId: 250, label: 'Siberian husky', score: 0.32, rank: 1, hasHeatmap: true, isTop1: true, isTrueClass: true };
      next.top1 = top1;
      next.trueClass = top1;
      next.answers = [top1, { classId: 269, label: 'timber wolf', score: 0.30, rank: 2, hasHeatmap: true, isTop1: false, isTrueClass: false }];
      next.capabilities.stability = true;
    } else if (image.id === 'med_xray_pneumonia') {
      const findings = medical.findings.filter(item => item.rank <= 10 || item.classId === medical.sourceLabel.classId)
        .sort((a, b) => a.rank - b.rank).map(item => ({ classId: item.classId, label: item.label, score: item.score, rank: item.rank, hasHeatmap: item.hasHeatmap, isTop1: item.rank === 1, isTrueClass: item.classId === medical.sourceLabel.classId }));
      next.top1 = findings[0];
      next.trueClass = findings.find(item => item.isTrueClass);
      next.answers = findings;
      next.scoreKind = 'independent';
      next.capabilities = { stability: false, trunkInterior: false, layerModes: false, bloom: false, steer: false };
    }
    return next;
  }

  async function beginMock() {
    try {
      if (params.get('v3') === '1') {
        const { createV3Mock } = await import('/ui/dev/contract-v3-shim.js');
        steerMock = await createV3Mock({ room, role, scene });
        status.clientId = steerMock.status.clientId;
        status.label = steerMock.status.label;
        if (closed) { steerMock.close(); return; }
        for (const event of Object.values(EVENTS)) steerMock.on(event, payload => deliver(event, payload));
        steerMock.status.subscribe(value => setStatus(value.phase, value.reason));
        steerMock.start();
        return;
      }
      if (params.get('steer') === '1') {
        const { createSteerMock } = await import('/ui/dev/steer-engine.js');
        steerMock = await createSteerMock({ scene, role });
        if (closed) { steerMock.close(); return; }
        status.clientId = steerMock.status.clientId;
        status.label = steerMock.status.label;
        for (const event of Object.values(EVENTS)) steerMock.on(event, payload => deliver(event, payload));
        steerMock.status.subscribe(value => setStatus(value.phase, value.reason));
        steerMock.start();
        return;
      }
      [baseDisplayState, manifest, fixtureError, fgsm, medical] = await Promise.all([
        loadFixture('display-state'), loadFixture('manifest'), loadFixture('error'), loadFixture('fgsm'), loadFixture('medical'),
      ]);
      displayState = structuredClone(baseDisplayState);
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
    if (document.hidden || closed || status.phase !== 'connected') return false;
    if (steerMock) return steerMock.emit(event, payload);
    if (!mock) {
      if (closed || status.phase !== 'connected' || !socket?.connected) return false;
      socket.emit(event, payload);
      return true;
    }
    console.info('[mock emit]', event, event === EVENTS.REGISTER ? { ...payload, key: payload.key ? '[redacted]' : undefined } : payload);
    if (closed || status.phase !== 'connected') return false;
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
      if (image) later(650, () => {
        playbackToken++;
        displayState = mockImageState(image);
        deliver(EVENTS.DISPLAY_STATE, structuredClone(displayState));
        deliver(EVENTS.FOCUS_STATE, null);
      });
    } else if (event === EVENTS.PLAY_PULSE && role === ROLES.HOST && displayState) {
      const token = ++playbackToken;
      const speed = payload.speed ?? 1;
      later(180, () => {
        if (token !== playbackToken) return;
        updateDisplay({ playback: { state: payload.skipToEnd ? 'done' : 'playing', speed } });
        if (!payload.skipToEnd) later(1300 / speed, () => {
          if (token === playbackToken) updateDisplay({ playback: { state: 'done', speed } });
        });
      });
    } else if (event === EVENTS.SET_MODE && role === ROLES.HOST && displayState) {
      later(180, () => updateDisplay({
        mode: payload.mode ?? displayState.mode,
        layerMode: payload.layerMode ?? displayState.layerMode,
      }));
    }
    return true;
  }

  let socket = null;
  let socketLoading = false;
  let loadRetryTimer = 0;
  let loadRetryDelay = 500;
  let registerAttempt = 0;
  let registrationFailed = false;
  let registrationTimer = 0;
  let registrationRetryTimer = 0;
  let registrationRetryDelay = 500;
  let everRegistered = false;
  let onReconnectAttempt = null;

  function registrationRejected(error) {
    if (closed || registrationFailed) return;
    registrationFailed = true;
    clearTimeout(registrationTimer);
    if (error.code === ERROR_CODES.NO_ROOM && everRegistered) {
      setStatus('reconnecting', 'Waiting for the room to return');
      clearTimeout(registrationRetryTimer);
      registrationRetryTimer = setTimeout(() => {
        registrationRetryTimer = 0;
        if (!closed) socket.disconnect().connect();
      }, registrationRetryDelay);
      registrationRetryDelay = Math.min(5000, registrationRetryDelay * 2);
      return;
    }
    setStatus('error', error.code || error.message);
    deliver(EVENTS.ERROR, error);
  }

  async function beginSocket() {
    if (socketLoading || socket || closed) return;
    socketLoading = true;
    try {
      const io = await loadSocketClient();
      if (closed) return;
      loadRetryDelay = 500;
      socket = io({
        autoConnect: false,
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5000,
        randomizationFactor: 0,
        timeout: 8000,
      });
      socket.on('connect', () => {
        const attempt = ++registerAttempt;
        registrationFailed = false;
        clearTimeout(registrationRetryTimer);
        status.clientId = null;
        status.label = null;
        setStatus(attempt === 1 ? 'connecting' : 'reconnecting', 'Registering with the room');
        clearTimeout(registrationTimer);
        registrationTimer = setTimeout(() => {
          if (closed || attempt !== registerAttempt || registrationFailed || status.phase === 'connected') return;
          setStatus('reconnecting', 'Registration timed out; retrying');
          socket.disconnect().connect();
        }, 8000);
        socket.emit(EVENTS.REGISTER, { room: room || null, role, ...(key ? { key } : {}) }, ack => {
          if (closed || attempt !== registerAttempt) return;
          clearTimeout(registrationTimer);
          if (!ack?.ok) {
            const error = ack?.error || { code: ERROR_CODES.FORBIDDEN, message: 'Could not join the room.', event: EVENTS.REGISTER };
            registrationRejected(error);
            return;
          }
          status.clientId = ack.clientId;
          status.label = ack.label;
          everRegistered = true;
          registrationRetryDelay = 500;
          setStatus('connected');
        });
      });
      socket.on('disconnect', reason => {
        ++registerAttempt;
        clearTimeout(registrationTimer);
        status.clientId = null;
        status.label = null;
        if (!closed) setStatus('reconnecting', reason === 'io server disconnect' ? 'Server closed the connection' : 'Network connection lost');
        if (reason === 'io server disconnect') socket.connect();
      });
      socket.on('connect_error', error => {
        if (!closed) setStatus('reconnecting', 'Cannot reach the server');
      });
      onReconnectAttempt = attempt => {
        if (!closed) setStatus('reconnecting', `Trying again · attempt ${attempt}`);
      };
      socket.io.on('reconnect_attempt', onReconnectAttempt);
      socket.on(EVENTS.ERROR, error => {
        if (error?.event === EVENTS.REGISTER) {
          registrationRejected(error);
          return;
        }
        deliver(EVENTS.ERROR, error);
      });
      for (const event of Object.values(EVENTS)) {
        if (event !== EVENTS.ERROR && event !== EVENTS.REGISTER) socket.on(event, payload => deliver(event, payload));
      }
      socket.connect();
    } catch (error) {
      if (!closed) {
        setStatus('reconnecting', 'Cannot reach the server; trying again');
        loadRetryTimer = setTimeout(() => { loadRetryTimer = 0; void beginSocket(); }, loadRetryDelay);
        loadRetryDelay = Math.min(5000, loadRetryDelay * 2);
      }
    } finally {
      socketLoading = false;
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
      clearTimeout(registrationTimer);
      clearTimeout(registrationRetryTimer);
      clearTimeout(loadRetryTimer);
      socket?.disconnect();
      steerMock?.close();
      socket?.removeAllListeners();
      if (socket && onReconnectAttempt) socket.io.off('reconnect_attempt', onReconnectAttempt);
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      listeners.clear();
      statusListeners.clear();
      status.phase = 'closed';
    },
    reconnect() {
      if (closed || mock) return;
      if (!socket) { void beginSocket(); return; }
      if (!socket.connected) socket.connect();
    },
  };

  if (mock) void beginMock();
  else void beginSocket();
  return api;
}
