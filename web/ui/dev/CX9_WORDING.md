# CX-9 wording audit

Literal, case-insensitive substring search across UI source, dev checks and existing documentation; hidden runtime artifacts excluded. 78 matching lines.

probability: 1 · chance: 1 · sure: 3 · certain: 1 · accuracy: 1 · diagnos: 8 · fix: 60 · correct: 12 · debug: 1 · uncertainty: 1

## Review

- Displayed “Correct” / “Incorrect” compare the top answer with the true class. Medical captions use exactly “not a diagnosis”.
- Removed the unrelated host-key wording “missing or incorrect”; the screen now asks Ray for a fresh host link.
- Other substring hits are identifiers (`toFixed`, `autocorrect`, fixtures, prefixes), CSS positioning, test assertions or documentation. They make no model claims.
- Error messages received from the server are displayed as text; wording in those messages remains a server responsibility.

## Every hit with its full line context

### answer-list.js:5 — fix

```text
  return `${(Number(score) * 100).toFixed(1)}%`;
```

### controller.css:118 — fix

```text
.notice { position: fixed; z-index: 3; left: 50%; bottom: calc(var(--safe-bottom) + 88px); width: min(calc(100% - 32px), 440px); transform: translateX(-50%); padding: 14px 16px; border: 1px solid var(--inferno-3); border-radius: var(--radius); color: var(--color-text); background: #2e1325f5; text-align: center; box-shadow: 0 12px 40px #0009; }
```

### controller.html:57 — correct

```text
          <div class="current-image"><span class="eyebrow">NOW SHOWING</span><strong id="image-name">Waiting for image</strong><span id="top-answer">Model score will appear here</span><div id="truth-status" class="truth-status" hidden><span class="true-class-ring" aria-hidden="true"></span><strong id="correctness"></strong><span id="true-class-name"></span></div></div>
```

### controller.html:71 — diagnos

```text
            <p id="answer-context" class="answer-context" role="status" hidden></p><p id="answer-explanation" class="answer-explanation" hidden>Answers come back when the test ends</p><p id="medical-caveat" class="answer-explanation" hidden>Each score is 0–100% on its own · not a diagnosis</p>
```

### controller.js:86 — fix

```text
  return `${answer.label} · Model score ${(answer.score * 100).toFixed(1)}%`;
```

### controller.js:171 — correct

```text
    const correct = display.top1.classId === display.trueClass.classId;
```

### controller.js:172 — correct

```text
    truth.dataset.correct = String(correct);
```

### controller.js:173 — correct

```text
    document.getElementById('correctness').textContent = correct ? 'Correct' : 'Incorrect';
```

### controller.js:481 — fix

```text
  const manifestUrl = query.get('mock') === '1' ? '/contract/fixtures/manifest.json' : '/assets/manifest.json';
```

### controller.js:522 — fix

```text
sensitivityValue.textContent = `${initialSensitivity.toFixed(1)}×`;
```

### controller.js:527 — fix

```text
  sensitivityValue.textContent = `${value.toFixed(1)}×`;
```

### demo-rail.js:8 — diagnos

```text
  { id: 'xray', label: 'X-ray', image: 'med_xray_pneumonia', mode: MODES.NORMAL, cue: 'Independent findings · not a diagnosis.' },
```

### dev/CX8_VERIFY.md:4 — fix

```text
The v3 fixture shapes are synthetic and dev-only. The checked-out contract is v2.
```

### dev/CX8_VERIFY.md:43 — fix

```text
The requested fixed-state captures use `npm run shot -- <url> <path> --size <WxH>`.
```

### dev/CX8_VERIFY.md:72 — sure

```text
  measured renderer performance remains pinned separately; it is not claimed here.
```

### dev/contract-v3-shim.js:2 — fix

```text
// At SYNC compare these fixture shapes to /contract; production never imports this module.
```

### dev/contract-v3-shim.js:7 — fix

```text
  const r = await fetch(`/contract/fixtures/${name}.json`);
```

### dev/contract-v3-shim.js:8 — fix

```text
  if (!r.ok) throw new Error(`Fixture unavailable: ${name}`);
```

### dev/contract-v3-shim.js:14 — fix

```text
export async function createV3Fixtures(room = '7KQ2M') {
```

### dev/contract-v3-shim.js:43 — fix

```text
  const fixtures = await createV3Fixtures(room);
```

### dev/contract-v3-shim.js:50 — fix

```text
  let state = clone(fixtures.states[scene] || fixtures.states.idle);
```

### dev/contract-v3-shim.js:73 — fix

```text
    state.stability = { ...clone(fixtures.states['stability-playing'].stability), run: 1, phase: 'playing' };
```

### dev/contract-v3-shim.js:74 — fix

```text
    if (state.image.id === 'ambig_cat') state.stability = { ...state.stability, current: clone(fixtures.states.cat.top1), cleanTop1: clone(fixtures.states.cat.top1), distinctWinners: 2, winners: [{ classId: 281, label: 'tabby', count: 18 }, { classId: 282, label: 'tiger cat', count: 12 }] };
```

### dev/contract-v3-shim.js:79 — fix

```text
      state.stability.current = state.stability.run % 3 ? clone(state.stability.cleanTop1) : clone(state.image.id === 'ambig_cat' ? fixtures.states.cat.answers[1] : fixtures.states['stability-playing'].stability.current);
```

### dev/contract-v3-shim.js:87 — fix

```text
    status, log, fixtures,
```

### dev/contract-v3-shim.js:90 — fix

```text
    show(name) { runToken++; state = clone(fixtures.states[name] || fixtures.states.idle); state.room = room; if (state.steerMoment) state.steerMoment.at = Date.now(); publish(); deliver(EVENTS.FOCUS_STATE, state.focus); },
```

### dev/contract-v3-shim.js:106 — fix

```text
          const baseline = fixtures.states[state.image.id === 'ambig_cat' ? 'cat' : state.image.category === 'adversarial' ? 'adversarial' : state.scoreKind === 'independent' ? 'medical' : 'idle'];
```

### dev/contract-v3-shim.js:113 — fix

```text
      else if (event === EVENTS.SELECT_IMAGE && role === ROLES.HOST) later(350, () => { runToken++; const name = payload.imageId === 'adv_retriever' ? 'adversarial' : payload.imageId === 'ambig_cat' ? 'cat' : payload.imageId.startsWith('med_') ? 'medical' : 'idle'; const driver = state.driver; state = clone(fixtures.states[name]); state.driver = driver; state.room = room; state.capabilities.steer = steerable(); engine.changeImage(payload.imageId); publish(); deliver(EVENTS.FOCUS_STATE, null); });
```

### dev/cx8-hud.verify.mjs:44 — diagnos

```text
  assert.match(await page.locator('.hud-medical').innerText(), /not a diagnosis/);
```

### dev/cx8.verify.mjs:82 — diagnos

```text
  assert.match(await page.locator('#medical-caveat').innerText(), /not a diagnosis/);
```

### dev/cx9-load.mjs:1 — sure

```text
// Measures actual network navigation; throttling, if requested, is labelled separately.
```

### dev/cx9-wording.mjs:4 — probability, chance, sure, certain, accuracy, diagnos, fix, correct, debug, uncertainty

```text
const terms=['probability','chance','sure','certain','accuracy','diagnos','fix','correct','debug','uncertainty'];
```

### dev/cx9-wording.mjs:21 — diagnos, correct

```text
 '- Displayed “Correct” / “Incorrect” compare the top answer with the true class. Medical captions use exactly “not a diagnosis”.',
```

### dev/cx9-wording.mjs:22 — correct

```text
 '- Removed the unrelated host-key wording “missing or incorrect”; the screen now asks Ray for a fresh host link.',
```

### dev/cx9-wording.mjs:23 — fix, correct

```text
 '- Other substring hits are identifiers (`toFixed`, `autocorrect`, fixtures, prefixes), CSS positioning, test assertions or documentation. They make no model claims.',
```

### dev/display.verify.mjs:32 — diagnos

```text
  assert.match(await display.locator('.hud-medical p').innerText(),/not a diagnosis/);
```

### dev/gestures.html:97 — fix

```text
    const format = value => `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
```

### dev/gestures.html:134 — fix

```text
    sensitivity.addEventListener('input', () => { gesture.setSensitivity(Number(sensitivity.value)); document.getElementById('sensitivity-value').textContent = `${Number(sensitivity.value).toFixed(1)}×`; });
```

### dev/hud.html:11 — fix

```text
    #hud { position: fixed; inset: 0; pointer-events: none; transition: opacity 200ms ease; }
```

### dev/hud.html:16 — fix

```text
  <div id="hud" data-hud-layout="full" data-tree-url="/contract/fixtures/tree.json"></div>
```

### dev/hud.html:20 — fix

```text
    import { createV3Fixtures, V3_SCENES } from './contract-v3-shim.js';
```

### dev/hud.html:25 — fix

```text
    // A default preview registers a fixture display so its QR links to a real room.
```

### dev/hud.html:37 — fix

```text
    const fixtures = await createV3Fixtures(room);
```

### dev/hud.html:38 — fix

```text
    const states = fixtures.states;
```

### dev/hud.html:57 — fix

```text
      const steer = name === 'outsideBrain' ? fixtures.outside : { imageId: current.image?.id, active: false, result: { outsideBrain: null } };
```

### dev/hud.html:63 — fix

```text
    // ?scene=<name> freezes a fixture; ?momentFrame=mid captures the banner moving.
```

### dev/steer-engine.js:6 — fix

```text
    const response = await fetch(`/contract/fixtures/${name}.json`);
```

### dev/steer-engine.js:7 — fix

```text
    if (!response.ok) throw new Error(`Missing fixture: ${name}`);
```

### dev/steer.html:29 — fix

```text
<main class="lab-main"><aside class="lab-side"><p class="eyebrow">CONTROLLER PREVIEW</p><h1>Scale a channel.<br>Watch the answer move.</h1><p>This lab simulates a display with 30 ms latency. These scores are fixtures, not model output.</p><div class="lab-art" aria-hidden="true">◎</div><p class="eyebrow">MOCK EVENT LOG</p><pre id="mock-log">No events sent yet</pre></aside><section id="steer"></section></main>
```

### dev/steer.verify.mjs:114 — fix

```text
 const fixture=JSON.parse(await readFile(new URL('../../../contract/fixtures/display-state.json',import.meta.url),'utf8'));
```

### dev/steer.verify.mjs:115 — fix

```text
 fixture.capabilities.steer=false;displaySocket.emit('display-state',fixture);await page.waitForTimeout(60);
```

### hud.js:20 — correct

```text
      <section class="hud-result" aria-label="Model's answer"><div data-field="answer" class="hud-answer"></div><div data-field="score" class="hud-secondary"></div><div data-field="truth" class="hud-truth"><span class="hud-ring" aria-hidden="true"></span><span data-field="correctness"></span></div></section>
```

### hud.js:21 — diagnos

```text
      <section class="hud-medical" hidden><div class="hud-kicker">Findings (independent scores)</div><div class="hud-findings"></div><p>Each score is 0–100% on its own · not a diagnosis</p></section>
```

### hud.js:98 — fix

```text
      // Initial layout is painted before the transition to its fixed top-center destination.
```

### hud.js:136 — correct

```text
        fields.truth.classList.toggle('hud-empty', !comparable); text('correctness', comparable ? s.top1.classId === s.trueClass.classId ? 'Correct' : 'Incorrect' : '');
```

### presentation.js:2 — fix

```text
export const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '';
```

### steer/panel.js:5 — fix

```text
const pct = n => `${(n * 100).toFixed(1)}%`;
```

### steer/panel.js:23 — correct

```text
        <div class="steer-editor"><pre class="steer-error-line" aria-hidden="true"></pre><textarea id="steer-code-input" rows="6" wrap="off" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" enterkeyhint="done" aria-describedby="steer-code-status" aria-label="Channel program"></textarea></div>
```

### steer/panel.js:122 — fix

```text
      text(readout, `${scale.toFixed(2)}×`);
```

### steer/panel.js:123 — fix

```text
      input.setAttribute('aria-valuetext', `${scale.toFixed(2)} times`);
```

### steer/panel.js:148 — fix

```text
    // Baseline sets are fixed for the image, including while the top answer flips.
```

### steer/panel.js:208 — fix

```text
    const prefix = Number.isInteger(error.line) ? `Line ${error.line}, col ${error.col || 1}: ` : '';
```

### steer/panel.js:209 — fix

```text
    return error.message?.startsWith('Line ') ? error.message : prefix + error.message;
```

### steer/panel.js:308 — fix

```text
      text(row.querySelector('small'),delta === null ? 'Baseline unavailable' : `${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta).toFixed(1)} points`);
```

### styles/host.css:4 — correct

```text
.truth-status[data-correct="false"] strong { color: var(--inferno-3); }
```

### styles/hud.css:71 — fix

```text
/* The live scene has just two lines. The fixture lab keeps the full layout. */
```

### styles/hud.css:119 — fix

```text
/* One remembered intervention, then a fixed result slot. The scene remains interactive. */
```

### transport.js:4 — fix

```text
const fixtureRoot = '/contract/fixtures/';
```

### transport.js:34 — fix

```text
  let fixtureError = null;
```

### transport.js:80 — fix

```text
  async function loadFixture(name) {
```

### transport.js:81 — fix

```text
    const response = await fetch(`${fixtureRoot}${name}.json`, { cache: 'no-store' });
```

### transport.js:82 — fix

```text
    if (!response.ok) throw new Error(`Could not load contract fixture ${name}`);
```

### transport.js:169 — fix

```text
      [baseDisplayState, manifest, fixtureError, fgsm, medical] = await Promise.all([
```

### transport.js:170 — fix

```text
        loadFixture('display-state'), loadFixture('manifest'), loadFixture('error'), loadFixture('fgsm'), loadFixture('medical'),
```

### transport.js:199 — fix

```text
      const otherGuest = fixtureError.driver;
```

### transport.js:211 — fix

```text
        later(400, () => mockError(ERROR_CODES.LOCKED, fixtureError.message, { event: EVENTS.TAKE_CONTROL, driver: otherGuest }));
```

### transport.js:229 — fix

```text
      later(6200, () => mockError(ERROR_CODES.LOCKED, fixtureError.message, { event: EVENTS.TAKE_CONTROL, driver: otherGuest }));
```

### transport.js:259 — fix

```text
        later(280, () => mockError(ERROR_CODES.LOCKED, fixtureError.message, { event, driver: currentDriver }));
```
