import { EVENTS } from '/contract/contract.js';
// All slider snapshots are complete replacements; never queue a disconnected input.
export function createSteerSender({ emit, canSend, onSent }) {
  const interval = 67; // slightly above 1000/15, including timer rounding
  let seq = 0;
  let last = -Infinity;
  let timer = 0;
  let latest = null;
  let final = null;
  function schedule() {
    if (timer || (!latest && !final) || !canSend()) return;
    const wait = Math.max(0, interval - (performance.now() - last));
    if (wait === 0) flush();
    else timer = setTimeout(flush, wait);
  }
  function flush() {
    timer = 0;
    if (!canSend()) return;
    if (performance.now() - last < interval) { schedule(); return; }
    const payload = final || latest;
    if (!payload) return;
    if (final) final = null; else latest = null;
    const message = { ...payload, seq: ++seq };
    if (emit(EVENTS.STEER_UPDATE, message) !== false) {
      last = performance.now();
      onSent?.(message);
    }
    schedule();
  }
  return {
    update(set, probe) { latest = { set: structuredClone(set), probe }; schedule(); },
    release(set) { latest = null; final = { set: structuredClone(set), probe: null }; schedule(); },
    run(code) { latest = null; final = { code, probe: null }; schedule(); },
    resume: schedule,
    cancel() { clearTimeout(timer); timer = 0; latest = null; final = null; },
    get pending() { return Boolean(latest || final); },
  };
}
