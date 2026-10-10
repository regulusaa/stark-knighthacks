// DEV ONLY: proposed v3 additions atop the existing v1/v2 names. No new wire events.
// At SYNC compare these fixture shapes to /contract; production never imports this module.
import { EVENTS, MODES, ROLES, ERROR_CODES } from '/contract/contract.js';

const clone = value => structuredClone(value);
const read = async name => {
  const r = await fetch(`/contract/fixtures/${name}.json`);
  if (!r.ok) throw new Error(`Fixture unavailable: ${name}`);
  return r.json();
};
const answer = (value, rank = 1, trueId = 207) => ({ ...value, rank, isTop1: rank === 1, isTrueClass: value.classId === trueId, hasHeatmap: true, heatmapSource: 'precomputed' });
export const V3_SCENES = ['idle', 'stability-playing', 'stability-summary', 'adversarial', 'adversarial-noise', 'medical', 'steering', 'steer-moment', 'outsideBrain'];

export async function createV3Fixtures(room = '7KQ2M') {
  const [base, fgsm, medical, outside, tree] = await Promise.all(['display-state', 'fgsm', 'medical', 'steer-result.outside-brain', 'tree'].map(read));
  base.answers = base.answers.map(a => ({ ...a, heatmapSource: a.hasHeatmap ? 'precomputed' : null }));
  const clean = answer(base.top1);
  const idle = { ...base, room, focus: null, driver: null, controllerCount: 2, noiseView: false, bloom: true, stability: null, steerMoment: null, steer: null,
    image: { ...base.image, adversarial: null }, capabilities: { ...base.capabilities, noiseView: false, steer: true } };
  const adv = answer(fgsm.adversarial);
  const adversarial = { ...clone(idle), image: { id: 'adv_retriever', name: 'Adversarial retriever', category: 'adversarial', adversarial: { epsilon255: 2, maxPixelChange: 2 / 255, cleanTop1: clean, pairedImageId: 'clean_retriever' } },
    top1: adv, trueClass: answer({ ...clean, score: fgsm.trueClass.adversarialScore }, 2), answers: [adv, answer({ ...clean, score: fgsm.trueClass.adversarialScore }, 2)], capabilities: { ...idle.capabilities, noiseView: true, stability: false } };
  const findings = medical.findings.filter(a => a.rank <= 10).sort((a, b) => a.rank - b.rank).map(a => ({ ...a, isTop1: a.rank === 1, isTrueClass: a.classId === medical.sourceLabel.classId, heatmapSource: a.hasHeatmap ? 'precomputed' : null }));
  const med = { ...clone(idle), image: { id: medical.imageId, name: 'Chest X-ray (pneumonia)', category: 'medical', adversarial: null }, scoreKind: 'independent', top1: findings[0], answers: findings, trueClass: findings.find(a => a.isTrueClass), capabilities: { stability: false, trunkInterior: false, layerModes: false, bloom: true, noiseView: false, steer: false } };
  const current = answer({ classId: 208, label: 'Labrador retriever', score: .48 });
  const stability = { active: true, phase: 'playing', run: 12, runs: 30, current, matchesClean: false, distinctWinners: 3,
    winners: [{ classId: 207, label: clean.label, count: 21 }, { classId: 208, label: current.label, count: 7 }, { classId: 257, label: 'Great Pyrenees', count: 2 }], cleanTop1: clean };
  const playing = { ...clone(idle), mode: MODES.STABILITY, stability, capabilities: { ...idle.capabilities, steer: false } };
  const summary = { ...clone(playing), stability: { ...clone(stability), phase: 'summary', run: 30, current: clean, matchesClean: true } };
  const steering = { ...clone(idle), steer: { active: true, changedCount: 3, top1Changed: false } };
  const moment = { ...clone(steering), top1: current, steer: { active: true, changedCount: 3, top1Changed: true }, steerMoment: { from: clean, to: current, at: Date.now() } };
  const outsideState = { ...clone(steering), top1: outside.result.top1, steer: { active: true, changedCount: 5, top1Changed: true } };
  const states = { idle, 'stability-playing': playing, 'stability-summary': summary, adversarial, 'adversarial-noise': { ...clone(adversarial), noiseView: true }, medical: med, steering, 'steer-moment': moment, outsideBrain: outsideState,
    focused: { ...clone(idle), focus: { ...base.answers[1], heatmapSource: 'live' } }, trunk: { ...clone(idle), mode: MODES.TRUNK, capabilities: { ...idle.capabilities, steer: false } } };
  return { states, outside, drawnClasses: tree.nodes.filter(n => n.classId != null).map(n => n.classId) };
}

export async function createV3Mock({ room, role, scene = 'idle' }) {
  const fixtures = await createV3Fixtures(room);
  const listeners = new Map();
  const subscribers = new Set();
  const timers = new Set();
  const log = [];
  let state = clone(fixtures.states[scene] || fixtures.states.idle);
  let closed = false;
  let runToken = 0;
  const status = { phase: 'connecting', clientId: role === ROLES.HOST ? 'h_mock' : 'c_local', label: role === ROLES.HOST ? 'Ray' : 'Guest 1', reason: null,
    subscribe(cb) { subscribers.add(cb); cb(status); return () => subscribers.delete(cb); } };
  const deliver = (event, value) => { if (!closed) for (const cb of listeners.get(event) || []) cb(clone(value)); };
  const later = (ms, cb) => { const timer = setTimeout(() => { timers.delete(timer); if (!closed) cb(); }, ms); timers.add(timer); };
  const publish = () => deliver(EVENTS.DISPLAY_STATE, state);
  function replay() {
    const token = ++runToken;
    state.stability = { ...clone(fixtures.states['stability-playing'].stability), run: 1, phase: 'playing' };
    state.playback.state = 'playing'; publish();
    function step() {
      if (token !== runToken || state.mode !== MODES.STABILITY) return;
      state.stability.run++;
      state.stability.current = state.stability.run % 3 ? clone(state.stability.cleanTop1) : clone(fixtures.states['stability-playing'].stability.current);
      state.stability.matchesClean = state.stability.current.classId === state.stability.cleanTop1.classId;
      if (state.stability.run >= state.stability.runs) { state.stability.phase = 'summary'; state.playback.state = 'done'; publish(); }
      else { publish(); later(140, step); }
    }
    later(140, step);
  }
  const api = {
    status, log, fixtures,
    get state() { return clone(state); },
    on(event, cb) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(cb); return () => listeners.get(event)?.delete(cb); },
    show(name) { runToken++; state = clone(fixtures.states[name] || fixtures.states.idle); state.room = room; if (state.steerMoment) state.steerMoment.at = Date.now(); publish(); deliver(EVENTS.FOCUS_STATE, state.focus); },
    inject(value) { state = clone(value); publish(); },
    start() { later(30, () => { status.phase = 'connected'; for (const cb of subscribers) cb(status); deliver(EVENTS.PEER_JOINED, { role: ROLES.DISPLAY, clientId: 'd_mock' }); publish(); }); },
    emit(event, payload = {}) {
      log.push({ event, payload: clone(payload), time: performance.now() }); console.info('[mock emit]', event, payload);
      if (closed || status.phase !== 'connected') return false;
      if (event === EVENTS.TAKE_CONTROL) later(30, () => { state.driver = { id: status.clientId, label: status.label, isHost: role === ROLES.HOST }; publish(); deliver(EVENTS.DRIVER_CHANGED, { driver: state.driver, reason: 'take' }); });
      else if (event === EVENTS.SET_MODE && role === ROLES.HOST) later(180, () => {
        for (const field of ['mode', 'layerMode', 'noiseView', 'bloom']) if (Object.hasOwn(payload, field)) state[field] = payload[field];
        state.steer = null; state.steerMoment = null; state.capabilities.steer = state.mode === MODES.NORMAL && state.scoreKind !== 'independent';
        if (payload.mode === MODES.STABILITY) replay(); else if (payload.mode) { runToken++; state.stability = null; }
        publish();
      });
      else if (event === EVENTS.SELECT_IMAGE && role === ROLES.HOST) later(350, () => { runToken++; const name = payload.imageId === 'adv_retriever' ? 'adversarial' : payload.imageId.startsWith('med_') ? 'medical' : 'idle'; const driver = state.driver; state = clone(fixtures.states[name]); state.driver = driver; state.room = room; publish(); deliver(EVENTS.FOCUS_STATE, null); });
      else if (event === EVENTS.PLAY_PULSE && role === ROLES.HOST) later(30, () => { if (state.mode === MODES.STABILITY) replay(); else { state.playback = { state: payload.skipToEnd ? 'done' : 'playing', speed: payload.speed ?? 1 }; publish(); } });
      else if ([EVENTS.FOCUS_TIP, EVENTS.CLEAR_FOCUS].includes(event)) {
        if (state.stability?.phase === 'playing') return false;
        later(30, () => { state.focus = event === EVENTS.CLEAR_FOCUS ? null : state.answers.find(a => a.classId === payload.classId) || null; publish(); deliver(EVENTS.FOCUS_STATE, state.focus); });
      } else if (![EVENTS.CONTROL_ORBIT, EVENTS.CONTROL_ZOOM, EVENTS.RESET_VIEW].includes(event) && role !== ROLES.HOST) deliver(EVENTS.ERROR, { code: ERROR_CODES.FORBIDDEN, event, message: 'Host control only' });
      return true;
    },
    close() { closed = true; runToken++; for (const timer of timers) clearTimeout(timer); timers.clear(); listeners.clear(); subscribers.clear(); },
  };
  window.__v3Mock = api;
  return api;
}
