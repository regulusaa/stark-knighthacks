# Immersion linked controls and Steer demonstration

## Scope

All changes are in web/ui. Extraction, display names and notes belong to each controller's session workspace. Orbit, zoom, class selection and feature edits use the existing driver/host relay permissions. A viewer cannot change the shared display while another guest drives. Hidden/disconnected updates are dropped.

Feature edits from Immersion use the same complete scale set and monotonically increasing sequence as Surgery / Steer, including channels outside the ten visible slider rows. Slider sending remains capped at 15/s with a final probe:null. There is no synthetic score amplification. The exact existing dense head is reused for local visual feedback after shared results arrive.

## Recorded demonstrations verified against the real model

From original settings, turn off the channels in the image's steer.json recipe. The guided button makes every recorded channel accessible, including channels outside the visible top-five groups.

| Image | Channels off | New answer | Model score |
| --- | ---: | --- | ---: |
| Tabby cat | 1 | tiger cat | 46.6% |
| Wolf in snow | 4 | white wolf | 39.5% |
| Golden retriever | 7 | Labrador retriever | 48.7% |
| Adversarial retriever | 1 | golden retriever | 13.1% |
| Sports car | 1 | snowmobile | 37.2% |
| Monarch | 17 | ringlet | 42.9% |
| Chihuahua | 12 | toy terrier | 43.7% |

Reset returns the original answer and scores on every image. A real pointer drag of cat channel 956 changes the shared screen's answer; Immersion's feature-956 slider does the same. Guided edits preserve other changed channels. Reset suppression waits for acknowledgment. Rapid repeats retain the requested Reset with immediate feedback and respect the server's 2/s reset limit; hidden/disconnected/image-changed resets are cancelled.

## Verification

- `node web/ui/dev/steer-real.verify.mjs`: all seven actual model recipes, actual slider drag, final probe:null, increasing sequence, reset, zero console errors.
- `node web/ui/dev/steer.verify.mjs http://localhost:3004`: 16 groups, rate/sequence/permissions/code/acks/disconnect/hidden/320-375px checks, zero console errors.
- `node web/ui/dev/immersion-integration.verify.mjs`: real relay orbit, two-finger pinch, listed class focus, feature slider flip/reset, viewer lock, private extraction/annotation isolation, all nine gallery images, Chromium touch and WebKit checks, zero console errors.
- `node web/ui/dev/immersion.verify.mjs`: all 74 class/layer objects, extraction/return masks, exact local dev-only feature model, focus, pinch, persistence, rotation/hidden, zero console errors.
- `node web/ui/dev/inspection.verify.mjs http://localhost:3004`: existing component selection, double-tap separation, host modes, orbit/pinch/recovery and viewer permissions preserved.
- `node web/ui/dev/immersion-linked.shots.mjs`: real-room `npm run shot` at 390×844, 1180×820 and 2560×1440 in .shots; inspected. Additional original/flipped Steer and linked feature-control screenshots inspected.

Vultr deployment health and HTTPS checks passed; controller.js, immersion/workspace.js and steer/panel.js return HTTP 200 with the updated code. The complete public integration suite did not pass: Vultr forces all displays into RENEW, so the suite could not isolate its display from the active demo. The suite now refuses fixed-room servers before opening a browser. Full linked-control verification ran on the local real server. Physical iPhone/iPad confirmation of this update remains pending.

## REQUEST-FOR-CLAUDE — send now

Allow `focus-tip` for real Brain tips outside the top-10 answer list. Repro: show `ambig_cat`, open a host controller's Immersion, select laptop (classId 620). The UI emits the existing `{classId:620}` focus request, but `server/validate.js` rejects it with `classId 620 is not in the current answer list`. Keep numeric bounds and driver/host authorization; let the display resolve valid image tips using its existing tree / Steer data. Update the smoke assertion that currently requires answer-list membership. No UI or contract change is needed. Rerun `web/ui/dev/immersion-integration.verify.mjs` after removing its known-server-rejection expectation and checking shared focus 620.

Class focus for answers in the current list already works. Tapping a saved layer opens the stem using existing scene-action inspect; there is no shared per-layer focus event in the present contract.

## Simple explanation

The trunk's 49 layers are 49 recorded processing stages of the image model. Early stages detect simple patterns like edges; later stages combine them into more complex features. The moving flow illustrates saved activations, not biological brain activity.
