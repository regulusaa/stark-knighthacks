# CX-8 verification

Verified on 2026-10-10 on `agent/codex-ui`, using the local server on port 3002.
The v3 fixture shapes are synthetic and dev-only. The checked-out contract is v2.

## Run

```sh
PORT=3002 STARK_HOST_KEY=test npm start
node web/ui/dev/cx8.verify.mjs
node web/ui/dev/cx8-hud.verify.mjs
node web/ui/dev/steer.verify.mjs
node web/ui/dev/display.verify.mjs
```

The first two checks verify exact single-field `set-mode` payloads, both pair selections,
immediate pending feedback, confirmation/timeout/disconnect cleanup, capability hiding,
stability replay and answer locking, independent medical bars, shared Steer flips/reset,
Glow preserving interventions, HUD wording, tree membership, missing fields, banner
timing/deduplication, reduced motion, and console/page errors.
The Steer regression check covers rate/sequence/probe sending, permissions, editing,
image changes, touch input and the real transport's production capability gate.
The display compatibility check exercises the currently integrated renderer's HUD hook,
resize, transparent overlay, Socket.io orbit/pinch/focus/reset and long labels.

## Preview and steps

- Phone: `/controller?room=7KQ2M&mock=1&v3=1&scene=medical`; scroll to Findings,
  compare each bar with its own percentage, and scroll all ten rows. Repeat with
  `scene=stability-playing`: answer taps are disabled with the explanation visible.
- iPad: add `role=host&key=test`. On `scene=idle`, toggle Glow, enter Trunk interior,
  change Full/Reduced layers, return to Normal, and switch Original/Adversarial.
  On the adversarial image toggle Noise ×50. Replay the Stability test from run 1.
  Inspect emitted events in `window.__v3Mock.log`.
- Monitor: `/ui/dev/hud.html` cycles nine states every three seconds. Add
  `?scene=<name>` to freeze a state or `&layout=compact` to preview the live layout.
  For the banner capture, use `scene=steer-moment&momentFrame=mid` and wait for
  `__starkReady`. Reduced motion fades instead of moving the banner.

## Captures

All captures are saved in `web/ui/.shots/` (gitignored) and were visually inspected.
The requested fixed-state captures use `npm run shot -- <url> <path> --size <WxH>`.

- HUD: `cx8-hud-<scene>-2560x1440.png` and `cx8-hud-<scene>-1920x1080.png` for
  `idle`, `stability-playing`, `stability-summary`, `adversarial`, `adversarial-noise`,
  `medical`, `steering`, `steer-moment`, and `outsideBrain`. The moment captures
  show the banner during its transition; `cx8-hud-moment-hold-1920x1080.png`
  shows its centered hold.
- Host: `cx8-host-<state>-1180x820.png` for `normal`, `adversarial`, `medical`,
  and `stability`. Scrolled interaction captures:
  `cx8-host-controls-<scene>-1180x820.png` for `idle`, `adversarial`, `medical`,
  and `stability-playing`.
- Phone: `cx8-phone-medical-390x844.png`, `cx8-phone-medical-375x667.png`,
  `cx8-phone-stability-390x844.png`; scrolled answer captures:
  `cx8-phone-answers-medical-390x844.png`, `cx8-phone-answers-medical-375x667.png`,
  and `cx8-phone-answers-stability-playing-390x844.png`.
- Additional compact/large previews: `cx8-hud-compact-medical-390x844.png`,
  `cx8-hud-compact-stability-1180x820.png`, `cx8-host-normal-2560x1440.png`.

## Contract and remaining integration

- Preserve the existing `mode: "trunk"`, top-level `display-state.scoreKind`,
  `capabilities.layerModes`, event names, and `mountHud(rootEl, api)` hooks.
- v3 data is provided only by `/web/ui/dev/contract-v3-shim.js` when the controller
  has both `mock=1&v3=1`, or by the dev HUD. Production never loads this shim.
- At SYNC, compare v3 additions with `/contract` and test real mode confirmations,
  stability runs, adversarial/noise data, and display-generated Steer moments.
- Physical iPhone/iPad checks for CX-8 have not been performed. Automated touch
  and viewport checks do not establish device Safari performance.
- Final verification of Claude's newer brain anatomy, fibers/transparency and
  measured renderer performance remains pinned separately; it is not claimed here.
