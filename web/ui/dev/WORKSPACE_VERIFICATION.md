# Controller workspace and scene follow-up — 2026-10-11

## Latest controller correction

The controller no longer mounts an iframe, canvas, or 3D renderer. Brain, Stem and Complete SVG buttons stay vertically arranged beside a pad that fills the workspace height, in both Modify and Usage settings. Each button sends the existing `scene-action` with `action: "inspect"` and its part. Simple one/two-sentence Stability test and Trunk/layer explanations are directly under the mode controls.

Updated `workspace.verify.mjs` and `inspection.verify.mjs` pass: no renderer downloads; exact focus events and confirmations; takeover/locked permissions; orbit/pinch; network recovery; mode/layer actions; SVG loading; 320 px overflow and touch targets. `display.verify.mjs` also passes with no console errors.

New captures: `.shots/controller-pad-{390x844,1180x820,2560x1440}.png` via `npm run shot`; `.shots/controller-mode-explanations-1180x820.png`. Logs: `.shots/controller-layout-verification.log`, `.shots/controller-part-controls.log`, `.shots/controller-display-regression.log`.

Double-click/double-tap on Brain or Stem now moves only that part away, keeps it selected and frames both parts. Existing `move`, `select`, and `center` events are sent in order after permission is confirmed. Single taps still focus. Join together restores both offsets. Chromium mouse/touch and WebKit touch checks cover permissions, early taps before the control acknowledgment, and immediate separation after joining. Evidence: `.shots/double-tap-verification.log`, `.shots/double-tap-{390x844,1180x820,2560x1440}.png` and `.shots/display-separated-stem-1920x1080.png`.

The notes below about the embedded preview describe the prior version. The display's geometry, saved activity values and Glow are unchanged by this UI-only correction. Physical-device confirmation of the revised layout remains pending.

## Changes

- Fixed Modify / Usage settings tabs. Only the active right-hand panel scrolls; existing permissions and controls remain in place.
- Three authored SVGs for brain, brainstem and the assembled anatomy. The diagram follows part selection.
- In-page model-edit walkthrough and plain explanations of Stability test, Trunk interior, layers and Glow.
- Moving labels show current model outputs in the brain and saved atlas values in the stem for all nine images. Medical images use independent findings and explicitly disclose that they have no layer atlas. Motion is illustrative, not a recording of computation.
- Glow follows display state in the preview; it previously forced bloom off. Its halo is more visible. The display retains its performance watchdog.
- Display startup now shows loading, Retry on failure, and graphics-restoration feedback. A stalled geometry worker times out and falls back to the pure builder.
- Controller transport uses WebSocket first with polling fallback; regression reconnects no longer produce stale-polling HTTP 400 console errors.

## Verified locally on the demo Mac

Server: `PORT=3004 STARK_HOST_KEY=test npm start` (development key only).

| Command | Result |
| --- | --- |
| `BASE=http://localhost:3004 node web/ui/dev/workspace.verify.mjs` | Tabs, SVGs, real cat flip/reset, all nine images, Glow pixel change, preview synchronization, 320/390/844/1180 layouts, no console errors |
| `BASE=http://172.20.10.14:3004 node web/ui/dev/workspace-webkit.verify.mjs` | LAN-address WebKit rendering; silent-worker fallback; injected startup failure and Retry recovery |
| `BASE=http://localhost:3004 node web/ui/dev/inspection.geometry.verify.mjs` | Placement, independent movement, path endpoints and stale sequence checks |
| `BASE=http://localhost:3004 node web/ui/dev/inspection.verify.mjs` | Real controls, focus/heatmaps, split/join, network recovery, Stability replay, wolf steering; no console errors |
| `node web/ui/dev/display.verify.mjs http://localhost:3004` | All nine gallery images, quiet HUD, framing, phone orbit/pinch/focus/reset; no console errors |
| `node web/ui/dev/cx8-hud.verify.mjs http://localhost:3004` | Nine contextual HUD states at both monitor sizes; timing, reduced motion, minimal HUD; no console errors |
| `git diff --check` | Pass |

The inspection run measured 16.7 ms median / 18.2 ms p95 with the display and two previews. A frozen-scene pixel comparison confirms that Glow changes the rendered output, independently of animation. A forced WebGL context loss displayed “3D graphics paused” and restoration hid that message.

## Screenshots

All files are gitignored under `web/ui/.shots/`; captured and inspected:

- `workspace-shot-modify-390x844.png`, `workspace-shot-usage-1180x820.png`, `workspace-shot-display-2560x1440.png` via `npm run shot`.
- `workspace-usage-ipad.png`, `workspace-tutorial-ipad.png`.
- `workspace-{modify,usage}-{1180x820,844x390,390x844,320x667}.png`.
- `workspace-<image-id>-{brain,stem}.png` for all nine gallery images.
- `workspace-glow-{on,off}.png`, `workspace-webkit-display.png`, `workspace-startup-retry.png`.
- Exact workspace test output: `.shots/workspace-verification.log`.
- WebKit recovery output: `.shots/workspace-webkit-verification.log`.

## Limits and retest instructions

- Native Safari's original blank-screen cause was not reproduced conclusively. One WebKit rerun timed out at 45 s during startup; the next run reached the scene. WebKit on the LAN and the startup, worker and graphics-recovery paths were verified; native Safari confirmation is still pending. This does not establish a cold-start speed guarantee.
- Physical iPhone/iPad checks of these new tabs and rotation are pending. Portrait phones retain the shared iPad structure and show the sideways-rotation reminder.
- Changes are local and pushed to `agent/codex-ui`; they have not been deployed to Vultr. Earlier CX-9 physical checks remain pending.
- Reload the display first, then the controller, on the same hotspot. Local demo room is RENEW, port 3003.
