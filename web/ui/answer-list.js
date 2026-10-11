import { heatmapText, stabilityPlaying } from './presentation.js';
import { mountFocusEvidence } from './focus-evidence.js';
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function modelScore(score) {
  return `${(Number(score) * 100).toFixed(1)}%`;
}

function appendText(parent, className, value) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = value;
  parent.append(span);
  return span;
}

export function createAnswerList({ root, onSelect, onClear, onLongLabel }) {
  const list = root.querySelector('#answer-list');
  const count = root.querySelector('#answer-count');
  const focusCard = root.querySelector('#focus-card');
  const focusLabel = root.querySelector('#focus-label');
  const focusScore = root.querySelector('#focus-score');
  const focusRank = root.querySelector('#focus-rank');
  const heatmapStatus = root.querySelector('#focus-heatmap');
  const evidenceRoot=document.createElement('div');
  focusCard.insertBefore(evidenceRoot,focusCard.querySelector('.focus-caption'));
  const evidence=mountFocusEvidence(evidenceRoot,{enabled:new URLSearchParams(location.search).get('mock')!=='1'});
  let display=null,currentFocus=null;
  const rows = new Map();
  let answers = [];
  let answersSignature = '';
  let focusSignature = '';
  let focusedId = null;
  let independent = false;
  let readOnly = false;
  function setContext(state) {
    if(display?.image?.id!==state?.image?.id)currentFocus=null;
    display=state;
    void evidence.update(display,currentFocus);
    const nextIndependent = state?.scoreKind === 'independent';
    if (independent !== nextIndependent) answersSignature = '';
    independent = nextIndependent;
    readOnly = stabilityPlaying(state);
    root.dataset.readonly = String(readOnly);
    root.querySelector('#answers-title').textContent = independent ? 'Findings · independent scores' : 'Answers';
    const context = root.querySelector('#answer-context');
    context.hidden = !readOnly;
    context.textContent = readOnly ? `Stability test running · run ${state.stability.run} / ${state.stability.runs}` : '';
    root.querySelector('#answer-explanation').hidden = !readOnly;
    root.querySelector('#medical-caveat').hidden = !independent;
    root.querySelector('#clear-focus').disabled = readOnly;
    for (const row of rows.values()) row.disabled = readOnly;
  }

  root.querySelector('#clear-focus').addEventListener('click', onClear);

  function normalizedAnswers(source) {
    if (!Array.isArray(source)) return [];
    const seen = new Set();
    return source.filter(answer => {
      if (!answer || !Number.isFinite(answer.rank) || !Number.isFinite(answer.classId)) return false;
      if (answer.rank > 10 && !answer.isTrueClass) return false;
      if (seen.has(answer.classId)) return false;
      seen.add(answer.classId);
      return true;
    }).sort((a, b) => a.rank - b.rank);
  }

  function buildRow(answer, topScore) {
    const row = document.createElement('button');
    row.type = 'button';
    row.disabled = readOnly;
    row.className = 'answer-row';
    row.dataset.classId = String(answer.classId);
    row.title = answer.label;
    row.setAttribute('aria-pressed', 'false');
    row.setAttribute('aria-label', `Rank ${answer.rank}: ${answer.label}, model score ${modelScore(answer.score)}${answer.isTrueClass ? ', true class' : ''}${answer.hasHeatmap ? ', heatmap available' : ', no heatmap precomputed'}`);

    appendText(row, 'answer-rank', String(answer.rank).padStart(2, '0'));
    const body = document.createElement('span');
    body.className = 'answer-body';
    const heading = document.createElement('span');
    heading.className = 'answer-heading';
    appendText(heading, 'answer-label', answer.label);
    appendText(heading, 'answer-percent', modelScore(answer.score));
    body.append(heading);
    const meter = document.createElement('span');
    meter.className = 'answer-meter';
    const fill = document.createElement('span');
    fill.className = 'answer-meter-fill';
    fill.style.width = `${Math.max(0, Math.min(100, independent ? answer.score * 100 : topScore > 0 ? answer.score / topScore * 100 : 0))}%`;
    meter.append(fill);
    body.append(meter);
    const badges = document.createElement('span');
    badges.className = 'answer-badges';
    if (answer.isTop1) appendText(badges, 'answer-badge top-answer-badge', "Model's answer");
    if (answer.isTrueClass) {
      const badge = appendText(badges, 'answer-badge true-class-badge', 'True class');
      const ring = document.createElement('span');
      ring.className = 'true-class-ring';
      ring.setAttribute('aria-hidden', 'true');
      badge.prepend(ring);
    }
    if (answer.hasHeatmap) {
      const badge = appendText(badges, 'heatmap-badge', '');
      badge.title = 'Heatmap available';
      badge.setAttribute('aria-hidden', 'true');
    }
    body.append(badges);
    row.append(body);

    let longPressTimer = 0;
    let longPressed = false;
    let startX = 0;
    let startY = 0;
    const cancelLongPress = () => { clearTimeout(longPressTimer); longPressTimer = 0; };
    row.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse') return;
      longPressed = false;
      startX = event.clientX;
      startY = event.clientY;
      cancelLongPress();
      longPressTimer = setTimeout(() => { longPressed = true; onLongLabel(answer.label); }, 550);
    });
    row.addEventListener('pointermove', event => {
      if (Math.hypot(event.clientX - startX, event.clientY - startY) > 10) cancelLongPress();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) row.addEventListener(type, cancelLongPress);
    row.addEventListener('contextmenu', event => { event.preventDefault(); onLongLabel(answer.label); });
    row.addEventListener('click', event => {
      if (longPressed) { event.preventDefault(); longPressed = false; return; }
      if (!readOnly) onSelect(answer);
    });
    return row;
  }

  function setAnswers(source) {
    const next = normalizedAnswers(source);
    const signature = JSON.stringify(next.map(({ classId, label, score, rank, hasHeatmap, heatmapSource, isTop1, isTrueClass }) =>
      [classId, label, score, rank, hasHeatmap, heatmapSource, isTop1, isTrueClass]));
    if (signature === answersSignature) return false;
    answers = next;
    answersSignature = signature;
    rows.clear();
    const fragment = document.createDocumentFragment();
    const topScore = next[0]?.score || 0;
    for (const answer of next) {
      const row = buildRow(answer, topScore);
      rows.set(answer.classId, row);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    count.textContent = String(next.length);
    focusSignature = '';
    return true;
  }

  function setFocus(value, { scroll = true } = {}) {
    const base = value && answers.find(item => item.classId === value.classId);
    const answer = base ? { ...base, ...value } : null;
    currentFocus=answer;
    void evidence.update(display,answer);
    const nextId = answer?.classId ?? null;
    const nextSignature = answer ? JSON.stringify([answer.classId, answer.label, answer.score, answer.rank, answer.hasHeatmap, answer.heatmapSource]) : 'none';
    if (focusSignature === nextSignature) return;
    const priorId = focusedId;
    focusedId = nextId;
    focusSignature = nextSignature;
    for (const id of [priorId, nextId]) {
      const row = rows.get(id);
      if (!row) continue;
      const selected = id === nextId;
      row.classList.toggle('selected', selected);
      row.setAttribute('aria-pressed', String(selected));
    }
    focusCard.hidden = !answer;
    if (!answer) return;
    focusLabel.textContent = answer.label;
    focusScore.textContent = `Model score ${modelScore(answer.score)}`;
    focusRank.textContent = `Rank ${answer.rank}`;
    heatmapStatus.textContent = heatmapText(answer);
    focusCard.querySelector('.focus-caption').hidden=!(answer.heatmapSource || answer.heatmapSource===undefined&&answer.hasHeatmap);
    if (scroll && priorId !== nextId) {
      requestAnimationFrame(() => {
        const row = rows.get(nextId);
        if (!row) return;
        const rowRect = row.getBoundingClientRect();
        const listRect = list.getBoundingClientRect();
        const top = list.scrollTop + rowRect.top - listRect.top - (list.clientHeight - row.offsetHeight) / 2;
        const behavior = reduceMotion.matches ? 'auto' : 'smooth';
        list.scrollTo({ top, behavior });
        if (matchMedia('(max-width: 760px)').matches) root.scrollIntoView({ block: 'start', behavior });
      });
    }
  }

  return {
    setContext,
    setAnswers,
    setFocus,
    resetScroll() { list.scrollTop = 0; },
    hasFocus() { return focusedId !== null; },
    destroy() { evidence.destroy(); },
  };
}
