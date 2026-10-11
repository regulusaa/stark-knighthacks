// Demo kill switches and display defaults (CC-10). Each ?no… flag forces its capability false for the whole session,
// so a broken feature can be turned off in seconds without code:
//   ?nosteer ?nostability ?nomedical ?nointerior ?nobloom   and ?reduced (trunk interior starts with the reduced layers)
// DISPLAY holds the defaults chosen from the 27-inch monitor's perf log (FREEZE.md); ?pr=1 overrides the pixel-ratio cap.
const q = new URLSearchParams(location.search);

export const KILL = Object.freeze({
  steer: q.has('nosteer'),
  stability: q.has('nostability'),
  medical: q.has('nomedical'),
  interior: q.has('nointerior'),
  bloom: q.has('nobloom'),
});

const pr = Number(q.get('pr'));
export const DISPLAY = Object.freeze({
  layerMode: q.has('reduced') ? 'reduced' : 'full',
  bloom: !KILL.bloom,
  maxPixelRatio: pr > 0 && pr <= 3 ? pr : 1.5,
});

/** Force the killed capabilities false (in place). */
export function maskCapabilities(caps) {
  if (KILL.steer) caps.steer = false;
  if (KILL.stability) caps.stability = false;
  if (KILL.interior) { caps.trunkInterior = false; caps.layerModes = false; }
  if (KILL.bloom) caps.bloom = false;
  return caps;
}

const killed = Object.entries(KILL).filter(([, v]) => v).map(([k]) => k);
if (killed.length || q.has('reduced') || q.has('pr')) console.info(`[stark] flags: off ${killed.join(', ') || '–'}; layerMode ${DISPLAY.layerMode}; pixel ratio ≤ ${DISPLAY.maxPixelRatio}`);
