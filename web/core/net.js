// The display's link to the relay (contract v1 sections 3–5). The only module that touches the network:
// it registers as the display, publishes display-state and focus-state, and turns controller events
// into api calls. If the relay is unreachable the display keeps working with mouse and keyboard.
import { EVENTS, ROLES } from '/contract/contract.js';

const SEND_MIN_MS = 100;  // ≤ 10 state messages a second (the relay allows 20)

export async function connectRelay(api, { onStatus = () => {} } = {}) {
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
  const net = { room: null, driver: null, controllers: new Map(), phase: 'connecting' };
  const status = (phase, extra = {}) => { net.phase = phase; onStatus({ ...net, ...extra }); };

  const socket = io({ transports: ['websocket', 'polling'] });

  // --- outgoing: coalesce bursts, never more than one message per SEND_MIN_MS per kind -------------------
  const pending = { [EVENTS.DISPLAY_STATE]: undefined, [EVENTS.FOCUS_STATE]: undefined };
  const timers = {};
  const lastSent = {};
  function send(event, payload) {
    pending[event] = payload;
    if (timers[event]) return;
    const wait = Math.max(0, SEND_MIN_MS - (performance.now() - (lastSent[event] ?? -Infinity)));
    timers[event] = setTimeout(() => {
      timers[event] = null;
      if (!socket.connected || !net.room) return;
      lastSent[event] = performance.now();
      socket.emit(event, pending[event]);
    }, wait);
  }
  const withServerFields = (s) => ({ ...s, room: net.room, driver: net.driver, controllerCount: net.controllers.size });
  function publishAll() {
    if (api.state) send(EVENTS.DISPLAY_STATE, withServerFields(api.state));
    send(EVENTS.FOCUS_STATE, api.state?.focus ?? null);
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
  socket.on(EVENTS.PEER_JOINED, (p) => { if (p?.role !== ROLES.DISPLAY) net.controllers.set(p.clientId, p); syncServerFields(); status(net.phase); });
  socket.on(EVENTS.PEER_LEFT, (p) => { net.controllers.delete(p?.clientId); syncServerFields(); status(net.phase); });
  socket.on(EVENTS.DRIVER_CHANGED, (p) => { net.driver = p?.driver ?? null; syncServerFields(); status(net.phase); });
  socket.on(EVENTS.ERROR, (e) => console.warn(`[stark] relay: ${e?.code} ${e?.message ?? ''}`));

  // --- controller events → api (the relay has already checked permissions and payloads) -------------------
  const on = (event, fn) => socket.on(event, (p) => {
    try { fn(p ?? {}); } catch (err) { console.warn(`[stark] ${event} failed:`, err); }
  });
  on(EVENTS.CONTROL_ORBIT, ({ dx, dy }) => api.orbit(dx, dy));
  on(EVENTS.CONTROL_ZOOM, ({ dz }) => api.zoom(dz));
  on(EVENTS.FOCUS_TIP, ({ classId }) => api.focusTip(classId));
  on(EVENTS.CLEAR_FOCUS, () => api.clearFocus());
  on(EVENTS.RESET_VIEW, () => api.resetView());
  on(EVENTS.SELECT_IMAGE, ({ imageId }) => api.loadImage(imageId));
  on(EVENTS.PLAY_PULSE, ({ speed, skipToEnd }) => {
    if (speed !== undefined) api.setSpeed(speed);
    if (skipToEnd) api.jumpToEnd(); else api.replay();
  });
  on(EVENTS.SET_MODE, ({ mode, layerMode }) => api.setMode({ mode, layerMode }));

  return { socket, net, get room() { return net.room; } };
}
