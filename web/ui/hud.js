// Contract v1 HUD: a quiet, read-only result above the display canvas.
export function mountHud(root, api) {
  const stylesheet = new URL('./styles/hud.css', import.meta.url).href;
  if (![...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === stylesheet)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = stylesheet;
    document.head.append(link);
  }

  const result = document.createElement('section');
  result.className = 'stark-display-result';
  result.setAttribute('aria-label', "Model's answer");
  result.setAttribute('aria-live', 'polite');
  result.setAttribute('aria-atomic', 'true');
  result.hidden = true;
  const label = document.createElement('div');
  label.className = 'stark-display-result__label';
  const score = document.createElement('div');
  score.className = 'stark-display-result__score';
  result.append(label, score);
  root.replaceChildren(result);

  let previous = '';
  const unsubscribe = api.onState(state => {
    const answer = state?.top1;
    const valid = answer && typeof answer.label === 'string' && Number.isFinite(answer.score);
    const signature = valid ? JSON.stringify([answer.label, answer.score]) : '';
    if (signature === previous) return;
    previous = signature;
    result.hidden = !valid;
    label.textContent = valid ? answer.label : '';
    score.textContent = valid ? `Model score ${(answer.score * 100).toFixed(1)}%` : '';
  });

  return { destroy() { unsubscribe?.(); result.remove(); } };
}
