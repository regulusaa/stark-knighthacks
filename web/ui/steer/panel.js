import { EVENTS, DEFAULTS, ROLES } from '/contract/contract.js';
import { checkSyntax } from './dsl-adapter.js';
import { createSteerSender } from './sender.js';
const INFO = "Each channel is one of 2,048 feature detectors in ResNet50's last convolutional layer. Steer multiplies its output, then reruns the rest of the network on the same image. Channels don't have human names; the number is their index.";
const pct = n => `${(n * 100).toFixed(1)}%`;
const snapped = n => n <= .05 ? 0 : Math.abs(n - 1) <= .050001 ? 1 : Math.min(3, Math.max(0, Math.round(n * 100) / 100));
const text = (el, value = '') => { if (el.textContent !== String(value)) el.textContent = String(value); };
export function createSteerPanel({ root, emit, requestControl, notify = () => {}, onImageChange = () => {} }) {
  root.classList.add('steer-panel');
  root.innerHTML = `
    <header class="steer-header"><div><p class="steer-eyebrow">INSIDE THE MODEL</p><h3>Steer <span>· last layer</span></h3></div><button type="button" class="steer-info" aria-label="About channels" aria-expanded="false">i</button></header>
    <p class="steer-caption">Scale real channels inside ResNet50, then rerun the rest of the network.</p>
    <p class="steer-explainer" hidden></p>
    <div class="steer-state-card" role="status"><strong class="steer-state-title"></strong><p class="steer-state-message"></p><button type="button" class="steer-retry" hidden>Try again</button></div>
    <div class="steer-content" hidden>
      <div class="steer-current"><div><strong class="steer-top-label"></strong><span class="steer-top-score"></span></div><button class="steer-reset" type="button" hidden>Reset</button></div>
      <p class="steer-flip" role="status" hidden></p><p class="steer-outside" hidden></p>
      <div class="steer-permission" hidden><span></span><button type="button" class="steer-take">Take control</button></div>
      <div class="steer-toggle" role="tablist" aria-label="Steer input"><button type="button" role="tab" data-input-mode="sliders" aria-selected="true">Sliders</button><button type="button" role="tab" data-input-mode="code" aria-selected="false">Code</button></div>
      <div class="steer-sliders" role="tabpanel"><div class="steer-groups"></div><div class="steer-equivalent"><div>Equivalent code</div><pre></pre><button type="button" class="steer-copy">Copy to code mode</button></div></div>
      <div class="steer-code" role="tabpanel" hidden>
        <label for="steer-code-input">Channel program</label>
        <div class="steer-editor"><pre class="steer-error-line" aria-hidden="true"></pre><textarea id="steer-code-input" rows="6" wrap="off" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="done" aria-describedby="steer-code-status" aria-label="Channel program"></textarea></div>
        <div class="steer-counter" hidden></div>
        <div class="steer-chips" role="group" aria-label="Insert code"><button type="button" data-chip="channel">channel[ ]</button><button type="button" data-chip="top">top(5, “ ”)</button><button type="button" data-chip="zero">= 0</button><button type="button" data-chip="half">*= 0.5</button><button type="button" data-chip="double">*= 2</button><button type="button" data-chip="reset">reset</button><button type="button" data-chip="newline">↵ Newline</button></div>
        <div id="steer-code-status" class="steer-code-status" role="status" aria-live="polite"></div><button type="button" class="steer-run">Run</button>
      </div>
      <div class="steer-result-heading"><span>NOW / BASELINE</span><span class="steer-sync" role="status"></span></div><div class="steer-results"></div>
    </div>`;
  const $ = sel => root.querySelector(sel);
  const content = $('.steer-content');
  const statusCard = $('.steer-state-card');
  const editor = $('#steer-code-input');
  const codeStatus = $('.steer-code-status');
  const errorLine = $('.steer-error-line');
  const rows = new Map();
  let context = { connected: false, driving: false, display: null };
  let imageId = null;
  let result = null;
  let scales = new Map();
  let baseline = new Map();
  let mode = 'sliders';
  let drag = null;
  let groupsSignature = '';
  let syntax = { ok: null };
  let localError = null;
  let syntaxTimer = 0;
  let syntaxRevision = 0;
  let dirtyCode = false;
  let running = false;
  let sending = false;
  let sendTimeout = 0;
  let waiting = false;
  let destroyed = false;
  let baselineToken = 0;
  let sent = new Map();
  let editRevision = 0;
  const edits = new Map();
  let resetAt = -Infinity;
  let animationFrame = 0;
  const capable = () => context.display?.capabilities?.steer === true;
  const writable = () => !document.hidden && context.connected && capable() && context.driving;
  const sliderSet = () => [...scales].filter(([,scale]) => scale !== 1).sort((a,b)=>a[0]-b[0]).map(([channel,scale])=>({channel,scale}));
  const sender = createSteerSender({
    canSend: writable,
    emit,
    onSent(payload) {
      const values = new Map((payload.set || []).map(item => [item.channel,item.scale]));
      const acknowledgedEdits = new Map([...edits].filter(([channel,edit]) => payload.set && (values.get(channel) ?? 1) === edit.scale));
      sent.set(payload.seq, { payload, edits:acknowledgedEdits }); if (sent.size > 64) sent.delete(sent.keys().next().value);
      sending = true;
      clearTimeout(sendTimeout);
      sendTimeout = setTimeout(() => { sending = false; running = false; localError = { message: 'The display did not respond. Try again.' }; render(); }, 5000);
      render();
    },
  });
  function permit() {
    if (document.hidden) return false;
    if (!context.connected || !capable()) return false;
    if (context.driving) return true;
    const driver = context.display?.driver;
    if (driver && driver.id !== context.clientId) {
      notify(`${driver.label} is driving · Take control in a moment`);
      return false;
    }
    waiting = true;
    requestControl();
    render();
    return true;
  }
  function restoreScales() {
    scales = new Map((result?.scales || []).map(item=>[item.channel,item.scale]));
    paintRows();
  }
  function cancel() {
    cancelAnimationFrame(animationFrame);
    sender.cancel();
    clearTimeout(sendTimeout);
    sending = running = waiting = false;
    drag = null;
    sent.clear();
    edits.clear();
    restoreScales();
  }
  function setScale(channel, value) {
    cancelAnimationFrame(animationFrame);
    const scale = snapped(value);
    if (scale !== 1 && !scales.has(channel) && scales.size >= DEFAULTS.STEER_MAX_CHANNELS) {
      notify('An intervention can scale at most 64 channels.'); return false;
    }
    if (scale === 1) scales.delete(channel); else scales.set(channel,scale);
    edits.set(channel,{scale,revision:++editRevision});
    localError = null;
    paintRows();
    return true;
  }
  function paintRows(values = scales) {
    for (const [channel, entries] of rows) for (const { input, readout, row } of entries) {
      const scale = (drag === channel ? scales : values).get(channel) ?? 1;
      input.value = String(scale);
      input.style.setProperty('--scale-position', `${scale / 3 * 100}%`);
      text(readout, `${scale.toFixed(2)}×`);
      input.setAttribute('aria-valuetext', `${scale.toFixed(2)} times`);
      row.classList.toggle('steer-dragging', drag === channel);
      row.classList.toggle('steer-scaled', scale !== 1);
    }
  }
  function animateRows(previous) {
    cancelAnimationFrame(animationFrame);
    if (document.hidden || matchMedia('(prefers-reduced-motion: reduce)').matches) { paintRows(); return; }
    const start = performance.now();
    const target = new Map(scales);
    const channels = new Set([...previous.keys(), ...target.keys()]);
    const frame = now => {
      if (destroyed || document.hidden) return;
      const t = Math.min(1, (now-start)/160);
      const eased = 1-Math.pow(1-t,3);
      const values = new Map([...channels].map(channel => [channel,(previous.get(channel)??1)+((target.get(channel)??1)-(previous.get(channel)??1))*eased]));
      paintRows(values);
      if (t<1) animationFrame=requestAnimationFrame(frame);
      else paintRows();
    };
    paintRows(previous); animationFrame=requestAnimationFrame(frame);
  }
  function buildGroups(sets) {
    const signature = JSON.stringify(sets);
    if (signature === groupsSignature) return;
    // Baseline sets are fixed for the image, including while the top answer flips.
    if (groupsSignature) return;
    groupsSignature = signature;
    const groups = $('.steer-groups'); groups.replaceChildren(); rows.clear();
    for (const key of ['top1','top2']) {
      const set = sets?.[key]; if (!set) continue;
      const section = document.createElement('section'); section.className = 'steer-group';
      const title = document.createElement('h4'); text(title, `Pushing toward ${set.label}`); section.append(title);
      const strongest = Math.max(...set.channels.map(c=>Math.abs(c.contribution)), .000001);
      for (const item of set.channels.slice(0,5)) {
        const row = document.createElement('div'); row.className = 'steer-row'; row.dataset.channel = item.channel;
        row.innerHTML = `<div class="steer-row-heading"><label></label><span class="steer-contribution" aria-hidden="true"><span></span></span><button type="button" class="steer-readout" aria-label="Double tap to restore scale to 1"></button></div><input type="range" min="0" max="3" step="0.01" value="1"><div class="steer-ticks" aria-hidden="true"><span>off</span><span>1×</span><span>3×</span></div>`;
        const input = row.querySelector('input');
        input.id = `steer-${key}-${item.channel}`;
        const label = row.querySelector('label'); label.htmlFor = input.id; text(label, `#${item.channel}`);
        input.setAttribute('aria-label', `Channel ${item.channel}, pushing toward ${set.label}`);
        row.querySelector('.steer-contribution > span').style.width = `${Math.abs(item.contribution) / strongest * 100}%`;
        const readout = row.querySelector('.steer-readout');
        const entries = rows.get(item.channel) || []; entries.push({input,readout,row}); rows.set(item.channel,entries);
        let denied = false;
        input.addEventListener('pointerdown', event => {
          if (!permit()) { denied = true; event.preventDefault(); return; }
          denied = false; drag = item.channel; row.classList.add('steer-dragging');
          cancelAnimationFrame(animationFrame); paintRows();
          sender.update(sliderSet(), item.channel);
        });
        input.addEventListener('input', () => {
          if (document.hidden) { paintRows(); return; }
          if (denied || (!context.driving && !waiting && !permit())) { paintRows(); return; }
          if (setScale(item.channel, Number(input.value))) {
            sender.update(sliderSet(), drag ?? item.channel);
            if (drag === null) sender.release(sliderSet());
          }
          render();
        });
        const release = () => {
          if (drag !== item.channel) return;
          drag = null; paintRows(); sender.release(sliderSet()); render();
        };
        for (const type of ['pointerup','pointercancel','lostpointercapture']) input.addEventListener(type,release);
        input.addEventListener('change', release);
        input.addEventListener('keydown', event => {
          if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(event.key) && !permit()) event.preventDefault();
        });
        let previousTap = -Infinity;
        readout.addEventListener('click', () => {
          const now = performance.now();
          if (now - previousTap < 350) {
            previousTap = -Infinity;
            if (permit()) { setScale(item.channel,1); sender.release(sliderSet()); render(); }
          } else previousTap = now;
        });
        section.append(row);
      }
      groups.append(section);
    }
    paintRows();
  }
  function errorText(error) {
    if (!error) return '';
    const prefix = Number.isInteger(error.line) ? `Line ${error.line}, col ${error.col || 1}: ` : '';
    return error.message?.startsWith('Line ') ? error.message : prefix + error.message;
  }
  function paintCodeStatus() {
    const error = localError || (syntax.ok === false ? syntax.error : null);
    codeStatus.dataset.kind = error ? 'error' : syntax.ok ? 'ready' : 'pending';
    text(codeStatus, error ? errorText(error) : syntax.ok ? 'Ready' : syntax.message || 'Checking syntax…');
    editor.setAttribute('aria-invalid', String(Boolean(error)));
    const line = error?.line;
    const count = editor.value.split('\n').length;
    errorLine.textContent = Array.from({length:count},(_,i)=>i+1===line ? ' ' : '').join('\n');
    errorLine.style.setProperty('--error-line', Number.isInteger(line) ? line - 1 : -1);
    errorLine.hidden = !Number.isInteger(line);
    $('.steer-run').disabled = !context.connected || !capable() || syntax.ok === false || syntax.ok === null || running || (!context.driving && Boolean(context.display?.driver));
    const length = Array.from(editor.value).length;
    $('.steer-counter').hidden = length <= 500;
    text($('.steer-counter'), `${length} / 600 characters`);
    $('.steer-counter').classList.toggle('over-limit', length > 600);
  }
  async function validate() {
    const revision = ++syntaxRevision;
    const value = editor.value;
    const checked = await checkSyntax(value);
    if (destroyed || revision !== syntaxRevision || value !== editor.value) return;
    syntax = checked; render();
  }
  function codeChanged() {
    dirtyCode = true; localError = null; syntax = { ok: null };
    clearTimeout(syntaxTimer);
    syntaxTimer = setTimeout(validate,150);
    render();
  }
  function enterCode(copy = false) {
    mode = 'code';
    if (copy || !dirtyCode) {
      const label = result?.sets?.top1?.label || context.display?.top1?.label || '';
      // The parser has no escaped quotes; model labels are plain text.
      editor.value = result?.code || `channel[top(5, "${label.replaceAll('"','')}")] = 0`;
      dirtyCode = false; localError = null; void validate();
    }
    render();
  }
  editor.addEventListener('input',codeChanged);
  editor.addEventListener('scroll',()=>{ errorLine.scrollTop = editor.scrollTop; errorLine.scrollLeft = editor.scrollLeft; });
  const chips = {
    channel: ['channel[]',8], top: ['top(5, "")',8], zero: [' = 0',4], half: [' *= 0.5',7], double: [' *= 2',5], reset: ['reset',5], newline: ['\n',1],
  };
  for (const chip of root.querySelectorAll('[data-chip]')) {
    chip.addEventListener('pointerdown',event=>event.preventDefault()); // retain iOS keyboard and caret
    chip.addEventListener('click',()=>{
      if (editor.readOnly) return;
      const [insert,offset] = chips[chip.dataset.chip];
      let start = editor.selectionStart; let end = editor.selectionEnd;
      if (start === end && ['zero','half','double'].includes(chip.dataset.chip)) {
        const rest = editor.value.slice(start);
        const closing = rest.startsWith('")]') ? 3 : rest.startsWith(')]') ? 2 : rest.startsWith(']') ? 1 : 0;
        start += closing; end += closing;
      }
      editor.setRangeText(insert,start,end,'end');
      editor.focus({preventScroll:true}); editor.setSelectionRange(start+offset,start+offset);
      codeChanged();
    });
  }
  $('.steer-run').addEventListener('click',()=>{
    if (syntax.ok !== true || !permit()) return;
    edits.clear(); localError = null; running = true; sender.run(editor.value); render();
  });
  for (const button of root.querySelectorAll('[data-input-mode]')) button.addEventListener('click',()=>{
    if (button.dataset.inputMode === 'code') enterCode();
    else { mode = 'sliders'; render(); }
  });
  $('.steer-copy').addEventListener('click',()=>enterCode(true));
  $('.steer-info').addEventListener('click',()=>{
    const info = $('.steer-explainer'); info.hidden = !info.hidden; text(info,INFO);
    $('.steer-info').setAttribute('aria-expanded',String(!info.hidden));
  });
  $('.steer-take').addEventListener('click',()=>{ if (context.connected && capable()) requestControl(); });
  $('.steer-reset').addEventListener('click',()=>{
    if (!writable()) { permit(); return; }
    if (performance.now() - resetAt < 500) return;
    resetAt = performance.now(); sender.cancel(); edits.clear(); sent.clear(); dirtyCode = false; localError = null; drag = null;
    emit(EVENTS.STEER_RESET,{}); sending = true; render();
  });
  $('.steer-retry').addEventListener('click',()=>{
    if (context.connected && result) { localError = null; render(); }
    else notify('Keep this page open while the display reconnects.');
  });
  function paintResults() {
    const answers = result?.result?.answers || [];
    const host = $('.steer-results'); host.replaceChildren();
    const strongest = answers[0]?.score || 1;
    for (const answer of answers.slice(0,3)) {
      const row = document.createElement('div'); row.className = 'steer-result-row';
      row.innerHTML = '<div class="steer-answer-heading"><span></span><strong></strong></div><div class="steer-result-bar"><span></span></div><small></small>';
      const label = row.querySelector('.steer-answer-heading > span'); text(label,answer.label);
      if (answer.isTrueClass) { const ring = document.createElement('i'); ring.className = 'true-class-ring'; ring.title = 'True class'; ring.setAttribute('aria-label','True class'); label.prepend(ring); }
      text(row.querySelector('strong'),pct(answer.score));
      row.querySelector('.steer-result-bar > span').style.width = `${answer.score / strongest * 100}%`;
      const before = baseline.get(answer.classId) ?? (answer.classId === result?.result?.baselineTop1?.classId ? result.result.baselineTop1.score : undefined);
      const delta = before === undefined ? null : (answer.score-before)*100;
      text(row.querySelector('small'),delta === null ? 'Baseline unavailable' : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)} points`);
      host.append(row);
    }
  }
  function render() {
    const offline = !context.connected;
    const unavailable = !capable();
    const error = localError || result?.error || (mode === 'code' && syntax.ok === false ? syntax.error : null);
    const state = offline ? 'offline' : unavailable ? 'unavailable' : !result ? 'loading' : error ? 'error' : drag !== null || sender.pending || sending || result.active ? 'steering' : 'idle';
    root.dataset.steerState = state;
    root.dataset.readonly = String(!context.driving);
    const blocking = offline || unavailable || !result;
    content.hidden = blocking;
    statusCard.hidden = !blocking && (!error || mode === 'code');
    const title = offline ? 'Display offline' : unavailable ? 'Steer unavailable' : !result ? 'Loading channels' : 'That intervention was not applied';
    const message = offline ? 'Your changes are paused. The controller reconnects automatically.' : unavailable ? context.display?.image?.category === 'medical' ? 'Steer works on the ImageNet model only' : 'Steer is unavailable for this image.' : !result ? 'Waiting for the display’s channel data.' : errorText(error);
    text($('.steer-state-title'),title); text($('.steer-state-message'),message);
    $('.steer-retry').hidden = state !== 'error' && !offline;
    const top = result?.result?.top1 || context.display?.top1;
    text($('.steer-top-label'),top?.label || 'Waiting for an answer'); text($('.steer-top-score'),top ? `Model score ${pct(top.score)}` : '');
    $('.steer-reset').hidden = !result?.active && scales.size === 0;
    $('.steer-reset').disabled = !context.driving;
    const flipped = result?.result?.top1Changed === true;
    $('.steer-flip').hidden = !flipped;
    text($('.steer-flip'),flipped ? `Answer changed: ${result.result.baselineTop1.label} → ${top.label}` : '');
    const outside = result?.result?.outsideBrain;
    $('.steer-outside').hidden = !outside;
    text($('.steer-outside'),outside ? `New top answer isn't drawn in the Brain: ${outside.label} (${pct(outside.score)})` : '');
    const permission = $('.steer-permission'); permission.hidden = context.driving;
    const other = context.display?.driver;
    text(permission.querySelector('span'),waiting || context.requesting ? 'Requesting control…' : other ? `${other.label} is driving · Live view` : 'Take control to scale channels');
    $('.steer-take').disabled = waiting || context.requesting;
    for (const button of root.querySelectorAll('[data-input-mode]')) button.setAttribute('aria-selected',String(button.dataset.inputMode === mode));
    $('.steer-sliders').hidden = mode !== 'sliders'; $('.steer-code').hidden = mode !== 'code';
    editor.readOnly = !context.driving && Boolean(other);
    for (const chip of root.querySelectorAll('[data-chip]')) chip.disabled = editor.readOnly;
    for (const [channel, entries] of rows) for (const {input,row} of entries) {
      input.setAttribute('aria-readonly',String(!context.driving));
      input.disabled = offline || unavailable;
      row.classList.toggle('steer-dragging',drag === channel);
    }
    text($('.steer-equivalent pre'),result?.code || 'reset');
    text($('.steer-sync'),sending || sender.pending ? 'Updating…' : result ? 'Live' : '');
    paintCodeStatus();
  }
  async function loadBaseline(display, token) {
    try {
      const manifest = await fetch('/assets/manifest.json').then(r=>r.ok?r.json():null);
      const entry = manifest?.images?.find(item=>item.id===display.image.id);
      if (!entry) return;
      const response = await fetch(`/${entry.folder}tree.json`);
      if (!response.ok) return;
      const tree = await response.json();
      if (destroyed || token !== baselineToken) return;
      for (const answer of tree.topK || []) baseline.set(answer.classId,answer.score);
      if (tree.trueClass) baseline.set(tree.trueClass.classId,tree.trueClass.score);
      paintResults();
    } catch { /* Baseline unavailable is honest; never substitute zero. */ }
  }
  function visibility() { if (document.hidden) cancel(); else render(); }
  let lastWidth = innerWidth;
  function resize() { if (innerWidth !== lastWidth) { lastWidth = innerWidth; cancel(); render(); } }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('resize', resize);
  return {
    setContext(next) {
      const wasDriving = context.driving;
      context = next;
      const nextId = next.display?.image?.id;
      if (nextId && nextId !== imageId) {
        cancel(); imageId = nextId; result = null; scales.clear(); baseline.clear(); groupsSignature = ''; rows.clear(); $('.steer-groups').replaceChildren();
        dirtyCode = false; mode = 'sliders'; editor.value = ''; localError = null; syntax = {ok:null};
        clearTimeout(syntaxTimer); ++syntaxRevision;
        if (!next.display.steer?.active) for (const answer of next.display.answers || []) baseline.set(answer.classId,answer.score);
        const token = ++baselineToken;
        if (!next.mock) void loadBaseline(next.display,token);
        root.scrollTop = 0; onImageChange();
      }
      if (!next.connected || (wasDriving && !next.driving)) cancel();
      if (waiting && next.driving) { waiting = false; sender.resume(); }
      if (waiting && next.display?.driver && next.display.driver.id !== next.clientId) { cancel(); }
      render();
    },
    setResult(value) {
      if (!value || value.imageId !== imageId) return;
      // A seq belongs to its sending socket, not to the room. Another driver's
      // lower seq is fresh state; only reconcile our own acknowledged edits.
      const own = context.display?.driver?.id === context.clientId ? sent.get(value.seq) : null;
      const laterOwn = context.driving && own && [...sent.keys()].some(seq=>seq>value.seq);
      if (laterOwn) return;
      const previous = result ? new Map(scales) : null;
      result = structuredClone(value);
      const current = scales.get(drag) ?? 1;
      scales = new Map((value.scales || []).map(item=>[item.channel,item.scale]));
      if (own) for (const [channel,edit] of own.edits) {
        if (edits.get(channel)?.revision === edit.revision) edits.delete(channel);
      }
      if (context.driving) for (const [channel,edit] of edits) {
        if (edit.scale === 1) scales.delete(channel); else scales.set(channel,edit.scale);
      }
      if (drag !== null) { if (current === 1) scales.delete(drag); else scales.set(drag,current); }
      if (own || !context.driving || value.seq===0 || value.error) {
        sending = running = false; clearTimeout(sendTimeout);
        for (const seq of sent.keys()) if (own && seq <= value.seq) sent.delete(seq);
      }
      localError = value.error;
      buildGroups(value.sets);
      if (previous) animateRows(previous); else paintRows();
      paintResults(); render();
    },
    setError(error) {
      if (![EVENTS.STEER_UPDATE,EVENTS.STEER_RESET,EVENTS.TAKE_CONTROL].includes(error?.event)) return;
      if (error.code === 'LOCKED') {
        cancel(); localError = null;
        notify(`${error.driver?.label || 'Someone else'} is driving · Take control in a moment`);
        render(); return;
      }
      cancel(); localError = error.error || error.parseError || {message:error.message}; render();
    },
    setMode: modeName => modeName === 'code' ? enterCode() : (mode='sliders',render()),
    get state() { return { imageId, result, scales:sliderSet(), dragging:drag, mode }; },
    destroy() { destroyed=true; cancel(); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', resize); clearTimeout(syntaxTimer); ++syntaxRevision; ++baselineToken; root.replaceChildren(); },
  };
}
