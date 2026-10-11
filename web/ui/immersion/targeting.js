// Suggestions use the existing exact head, not names or invented semantic features.
export const normalizeClassName = name => String(name).trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
export function resolveClass(classes, name) {
  const query = normalizeClassName(name);
  return classes?.find(c => normalizeClassName(c.label) === query) || null;
}
export function rankOf(engine, classId) {
  return 1 + Array.from(engine.probs).filter((score, id) => score > engine.probs[classId] || score === engine.probs[classId] && id < classId).length;
}
export function planTarget(engine, classId, scales, limit = 12) {
  const original = new Map(scales), next = new Map(original), used = new Set(), steps = [];
  try {
    engine.apply(original);
    const before = engine.probs[classId];
    for (let n = 0; n < limit && engine.argmax() !== classId; n++) {
      const winner = engine.argmax();
      const targetShares = Float64Array.from(engine.contributions(classId));
      const winnerShares = engine.contributions(winner);
      let best = null;
      for (let channel = 0; channel < targetShares.length; channel++) {
        if (used.has(channel)) continue;
        const difference = targetShares[channel] - winnerShares[channel];
        const scale = difference > 0 ? 3 : 0;
        const gain = difference * (scale - (next.get(channel) ?? 1));
        if (gain > (best?.gain ?? 1e-8)) best = { channel, scale, gain, against: winner };
      }
      if (!best) break;
      next.set(best.channel, best.scale); used.add(best.channel);
      engine.apply(next);
      steps.push({ ...best, score: engine.probs[classId] });
    }
    return { before, score: engine.probs[classId], rank: rankOf(engine, classId), reachesTop: engine.argmax() === classId, steps };
  } finally { engine.apply(original); }
}
