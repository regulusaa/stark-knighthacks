// The display's link to the relay (contract v1 sections 3–5). The only module that touches the network:
// it registers as the display, publishes display-state and focus-state, and turns controller events
// into api calls. If the relay is unreachable the display keeps working with mouse and keyboard.
import { EVENTS, ROLES, DEFAULTS } from '/contract/contract.js';

export const NET = {
  sendMinMs: 100,  // ≤ 10 state messages a second per kind (the relay allows 20)
  // Phone trackpad → camera. control-orbit dx/dy are fractions of the phone's drag area, and the rig turns
  // RIG.orbitSpeed (180°) per full-width drag; a phone pad is small, so a thumb-length swipe should turn more.
  // ?orbitGain= / ?zoomGain= override these on the display for tuning by feel.
  orbitGain: 1.5,
  zoomGain: 1.0,
};

function gainParam(params, name, fallback) {
  const v = Number(params.get(name));
  return params.has(name) && Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Minimum gap between two messages of one kind: steer-result may go at STEER_SEND_HZ, the states at 1/sendMinMs. */
const minGap = (event) => (event === EVENTS.STEER_RESULT ? 1000 / DEFAULTS.STEER_SEND_HZ : NET.sendMinMs);

export async function connectRelay(api, { onStatus = () => {}, steer = null } = {}) {
  let io;
  try {
    ({ io } = await import('/socket.io/socket.io.esm.min.js'));
  } catch (err) {
    console.warn('[stark] relay client unavailable; running offline:', err.message);
    onStatus({ phase: 'offline' });
    return null;
  }

  const params = new URLSearchParams(location.search);
  let room = params.get('room');
  const orbitGain = gainParam(params, 'orbitGain', NET.orbitGain);
  const zoomGain = gainParam(params, 'zoomGain', NET.zoomGain);
  const net = { room: null, driver: null, controllers: new Map(), phase: 'connecting' };
  const status = (phase, extra = {}) => { net.phase = phase; onStatus({ ...net, ...extra }); };

  const socket = io({ transports: ['websocket', 'polling'] });

  // --- outgoing: coalesce bursts (≤ 1 message per NET.sendMinMs per kind) and drop exact repeats ------------
  const pending = {};
  const timers = {};
  const lastSent = {};   // event → performance.now() of the last emit
  const lastJson = {};   // event → the last payload emitted, serialized (forgotten on reconnect)
  const sent = { [EVENTS.DISPLAY_STATE]: 0, [EVENTS.FOCUS_STATE]: 0, [EVENTS.STEER_RESULT]: 0, deduped: 0 }; // counters for tests
  // A steer-result must not reach controllers before the display-state that announces its image (they would drop
  // it as belonging to another image and then wait for channel data): hold it until that state has gone out.
  let stateImage = null;
  let steerHeld = false;
  function send(event, payload, { force = false } = {}) {
    pending[event] = payload;
    if (force) lastJson[event] = undefined;
    if (timers[event]) return;
    const wait = Math.max(0, minGap(event) - (performance.now() - (lastSent[event] ?? -Infinity)));
    timers[event] = setTimeout(() => {
      timers[event] = null;
      if (!socket.connected || !net.room) return;
      if (event === EVENTS.STEER_RESULT && pending[event]?.imageId !== stateImage) { steerHeld = true; return; }
      const json = JSON.stringify(pending[event]); // serialized now: the latest state wins
      if (json === lastJson[event]) { sent.deduped += 1; return; }
      lastJson[event] = json;
      lastSent[event] = performance.now();
      sent[event] += 1;
      socket.emit(event, JSON.parse(json));
      if (event === EVENTS.DISPLAY_STATE) {
        stateImage = pending[event]?.image?.id ?? null;
        if (steerHeld) { steerHeld = false; send(EVENTS.STEER_RESULT, pending[EVENTS.STEER_RESULT], { force: true }); }
      }
    }, wait);
  }
  const withServerFields = (s) => ({ ...s, room: net.room, driver: net.driver, controllerCount: net.controllers.size });
  /** Re-send both states even if unchanged (after registering, and when a controller joins). */
  function publishAll() {
    if (api.state) send(EVENTS.DISPLAY_STATE, withServerFields(api.state), { force: true });
    send(EVENTS.FOCUS_STATE, api.state?.focus ?? null, { force: true });
    if (steer?.state) send(EVENTS.STEER_RESULT, steer.state, { force: true });
  }
  api.onDisplayState((s) => send(EVENTS.DISPLAY_STATE, withServerFields(s)));
  api.onFocus((f) => send(EVENTS.FOCUS_STATE, f ?? null));

  // --- registration (again after every reconnect, reclaiming the same room) --------------------------------
  socket.on('connect', () => {
    status('registering');
    socket.emit(EVENTS.REGISTER, { role: ROLES.DISPLAY, room: net.room ?? room ?? null }, (ack) => {
      if (!ack?.ok) {
        console.warn('[stark] relay refused the display:', ack?.error?.message);
        status('error', { error: ack?.error });
        return;
      }
      net.room = ack.room;
      room = ack.room;
      const url = new URL(location.href);
      url.searchParams.set('room', ack.room);
      history.replaceState(null, '', url);
      net.controllers.clear();
      api.setServerFields({ room: net.room, driver: net.driver, controllerCount: 0 });
      status('connected');
      publishAll();
    });
  });
  socket.on('disconnect', (reason) => status(reason === 'io server disconnect' ? 'replaced' : 'reconnecting'));

  // --- server bookkeeping: shown on the display's own HUD (the server is authoritative for controllers) ----
  const syncServerFields = () => api.setServerFields({ room: net.room, driver: net.driver, controllerCount: net.controllers.size });
  socket.on(EVENTS.PEER_JOINED, (p) => {
    if (p?.role === ROLES.DISPLAY) return;
    net.controllers.set(p.clientId, p);
    syncServerFields();
    status(net.phase);
    publishAll(); // the relay also sends its cached copy; this makes sure the newcomer gets the live one
  });
  socket.on(EVENTS.PEER_LEFT, (p) => { net.controllers.delete(p?.clientId); syncServerFields(); status(net.phase); });
  socket.on(EVENTS.DRIVER_CHANGED, (p) => { net.driver = p?.driver ?? null; syncServerFields(); status(net.phase); });
  socket.on(EVENTS.ERROR, (e) => console.warn(`[stark] relay: ${e?.code} ${e?.message ?? ''}`));

  // --- controller events → api (the relay has already checked permissions and payloads) -------------------
  const on = (event, fn) => socket.on(event, (p) => {
    try { fn(p ?? {}); } catch (err) { console.warn(`[stark] ${event} failed:`, err); }
  });
  on(EVENTS.CONTROL_ORBIT, ({ dx, dy }) => api.orbit(dx * orbitGain, dy * orbitGain));
  on(EVENTS.CONTROL_ZOOM, ({ dz }) => api.zoom(dz * zoomGain));
  on(EVENTS.FOCUS_TIP, ({ classId }) => api.focusTip(classId));
  on(EVENTS.CLEAR_FOCUS, () => api.clearFocus());
  on(EVENTS.RESET_VIEW, () => api.resetView());
  on(EVENTS.SELECT_IMAGE, ({ imageId }) => api.loadImage(imageId));
  on(EVENTS.PLAY_PULSE, ({ speed, skipToEnd }) => {
    if (speed !== undefined) api.setSpeed(speed);
    if (skipToEnd) api.jumpToEnd(); else api.replay();
  });
  // Steer: the session drops stale seqs, coalesces to one apply per frame, and answers with steer-result
  on(EVENTS.STEER_UPDATE, (p) => steer?.update(p));
  on(EVENTS.STEER_RESET, () => steer?.reset());
  steer?.on('result', (state) => send(EVENTS.STEER_RESULT, state));
  on(EVENTS.SET_MODE, ({ mode, layerMode }) => {
    // a mode whose capability is false is ignored (the relay can't know; the HUD hides it anyway)
    const caps = api.state?.capabilities ?? {};
    const modeOk = mode === undefined || mode === 'normal' || (mode === 'stability' && caps.stability)
      || (mode === 'trunk' && caps.trunkInterior);
    const layerOk = layerMode === undefined || caps.layerModes;
    if (!modeOk && !layerOk) return;
    api.setMode({ mode: modeOk ? mode : undefined, layerMode: layerOk ? layerMode : undefined });
  });

  return { socket, net, sent, get room() { return net.room; } };
}
