// Per-socket, per-event rate limits (contract v1 section 5). A token bucket per event: it holds up to one
// second's worth of messages and refills continuously, so a steady 30/s stream passes and bursts beyond it drop.
import { EVENTS, DEFAULTS } from '../contract/contract.js';

/** messages per second */
export const RATES = {
  [EVENTS.REGISTER]: 5 / 60,
  [EVENTS.TAKE_CONTROL]: 2,
  [EVENTS.CONTROL_ORBIT]: DEFAULTS.SEND_HZ,
  [EVENTS.CONTROL_ZOOM]: DEFAULTS.SEND_HZ,
  [EVENTS.FOCUS_TIP]: 10,
  [EVENTS.CLEAR_FOCUS]: 10,
  [EVENTS.FOCUS_STATE]: 20,
  [EVENTS.RESET_VIEW]: 5,
  [EVENTS.SELECT_IMAGE]: 5,
  [EVENTS.PLAY_PULSE]: 5,
  [EVENTS.SET_MODE]: 5,
  [EVENTS.DISPLAY_STATE]: 20,
  [EVENTS.STEER_UPDATE]: 5,
  [EVENTS.STEER_RESET]: 2,
};
const DEFAULT_RATE = 5; // events not in the table (server-only names sent by a client)

export class Limiter {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.buckets = new Map();
    this.lastWarn = -Infinity;
  }

  /** true if this event may pass. */
  allow(event) {
    const rate = RATES[event] ?? DEFAULT_RATE;
    const cap = rate >= 1 ? rate : rate * 60; // per-minute limits (register) allow their whole minute as a burst
    const t = this.now();
    const b = this.buckets.get(event) ?? { tokens: cap, t };
    b.tokens = Math.min(cap, b.tokens + ((t - b.t) / 1000) * rate);
    b.t = t;
    this.buckets.set(event, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  /** true at most once per second: whether to tell the client it was rate limited. */
  shouldWarn() {
    const t = this.now();
    if (t - this.lastWarn < 1000) return false;
    this.lastWarn = t;
    return true;
  }
}
