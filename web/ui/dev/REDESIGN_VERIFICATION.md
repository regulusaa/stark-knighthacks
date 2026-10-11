# Brain inspection redesign — verification

2026-10-11 · branch `agent/codex-ui`. CX-9 remains paused. Ray explicitly assigned this redesign to Codex across the renderer/controller boundary.

## Delivered

- Independent brain and stem geometry, selection, handles, split/join, inspect and center.
- Interruptible placement and camera transitions derived from the earlier Stark wall/sphere damping.
- Neutral translucent tissue, fine model tracks, attached lower root connections, and a secondary camera-pinned source crop.
- Close-up moving text uses real layer metadata and current model values. It is labeled **Simulated signal flow**.
- One controller workspace on iPad and phones: live preview left, scrollable settings right, full-width orbit/pinch pad below. Portrait phones recommend rotation.
- Preview consumes the controller's existing relay connection. It does not register as a display or load the classifier head. It follows image, camera, component placement, focus, live heatmaps, Stability, answer changes and trunk layer values.
- Existing Answers, Steer, Gallery, Playback and Mode controls remain available. Guest Reset view is in the settings pane.
- Additive `scene-action` protocol: host/current-driver permissions, validated bounded coordinates, 30/s rate limit, server-authored sender and per-sender sequence acknowledgment. Existing events remain unchanged.

## Automated evidence

| Check | Result |
| --- | --- |
| `npm run smoke` | 99 checks passed |
| `node web/core/brainLayout.test.mjs` | All nine gallery layouts passed |
| `node web/core/framing.test.mjs` | All viewport checks passed |
| `node web/ui/dev/inspection.geometry.verify.mjs` | Complete assembled/split geometry safely framed at 2560×1440, 1920×1080, 1180×820, 390×844 and 320×667; independent moves, stale sequence rejection and attached connector endpoints passed |
| `node web/ui/dev/inspection.verify.mjs` | Real display + host + guest: split/join reversal, independent drag, matching preview, ownership, network return, native touch pinch, orbit, focus, live heatmap, Stability replay, computed answer flip and animated pulse passed; zero console/page errors |
| `node web/ui/dev/cx8-hud.verify.mjs http://localhost:3004` | Passed; contextual states, text size, QR clearance, timing, reduced motion, missing fields and compact HUD |
| `node web/ui/dev/display.verify.mjs http://localhost:3004` | Passed; all nine gallery images, framing, transparent overlay, takeover, orbit, pinch, focus/heatmap, reset and long labels; zero console/page errors |

Latest combined display + two previews timing: median 18.9 ms, p95 31 ms over 120 frames. An earlier run measured 16.7/17.7 ms. These are Mac Chromium measurements, not physical phone measurements; a sustained 60 fps is not claimed.

The broader `cc8demo.mjs` run exercised all modes and reported 48.4–60.0 fps. Its post-drag Steer pulse assertion sampled `uMoment=-1` after the short pulse had ended. A dedicated frame-by-frame observer in `inspection.verify.mjs` confirmed the answer flip and active moving pulse. The broad script therefore is not recorded as an all-pass result. Its full output is retained in `.shots/inspection-demo.log`.

## Screenshots inspected

Captured with `npm run shot -- <url> <path> --size <WxH>`:

- `.shots/inspection-final-display-2560x1440.png`
- `.shots/inspection-final-controller-1180x820.png`
- `.shots/inspection-final-controller-390x844.png`
- `.shots/inspection-final-controller-844x390.png`

Real integration captures also cover split display/preview, brain/stem inspection, 320 px portrait, and all nine gallery images. See `.shots/inspection-real-*.png` and `.shots/final-gallery-*.png`.

## BUGS.md #4 — separate HUD fix

The full HUD reserves its QR column using the same responsive width variable as the QR panel. The compact live layout stays compact. A real guest slider activated steering, followed by checks at 1920×1080, 2560×1440 and 1280×720: no intersection, 28 px badge text, complete loaded 220 px QR image, and no console errors.

Evidence: `.shots/bug4-steering-1920x1080.png`, `.shots/bug4-steering-2560x1440.png`, `.shots/bug4-steering-1280x720.png`. Full logs: `.shots/bug4-real.log`, `.shots/bug4-cx8-hud.log`, `.shots/bug4-display.log`.

## Testing handoff

The local server is running on port 3003, room RENEW. Open the display first and keep it visible. Devices must share the Mac's current hotspot/Wi-Fi.

- Display: `http://172.20.10.14:3003/display?room=RENEW`
- Guest controller: `http://172.20.10.14:3003/controller?room=RENEW`
- Local host controller: `http://172.20.10.14:3003/controller?room=RENEW&role=host&key=test`

Physical iPhone/iPad interaction and performance for this redesign are pending Ray's test. The redesign has not been deployed to Vultr. These local links use the new code.
