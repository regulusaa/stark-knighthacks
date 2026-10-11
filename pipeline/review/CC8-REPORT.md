# CC-8 report: the remaining demo beats on the display

Everything is on `agent/claude-core`, with one commit per part. Screenshots are in `pipeline/review/cc8/`, taken at 2560×1440 and scaled down to 1600 px.

## Part 0: what exists, and contract v3
- **Stability data:** `mc.json` exists for `ambig_cat`, `ambig_wolf` and `clean_retriever`. Only the cat changes its answer (tabby wins 12 of 30 runs, tiger cat 18), so it is the stability image.
  - `mc.json` stores each run's top-1 but not its crop, flip or brightness. The panel therefore stays still during playback; nothing is invented.
- **Adversarial:** `adv_retriever` has `fgsm.json` (ε = 2/255, maxPixelChange 2) and `noise_x50.png`.
- **Atlas:** all 7 ResNet images have one. `capabilities.trunkInterior` stays false until CC-9.
- **Medical:** present (both films, fan trees, Grad-CAM). It is **not BLOCKED**.
- **Contract v3** (`0adda9a`): additions only, plus 5 fixtures. The server accepts `set-mode {noiseView, bloom}`, and the smoke test passes 99 checks.
- **v1 names kept** (v3 used other names for the same things):
  - the mode stays **`"trunk"`** (v3 calls it `trunkInterior`);
  - the score kind stays at the top level as **`scoreKind`** (v3 places it at `image.scoreKind`).

## A: stability (`d249d9d`)
- **Playback:** host `set-mode {mode: "stability"}` plays one run every 150 ms ÷ speed.
  - The lit strand jumps to each run's top-1, with an 80 ms crossfade and no spring.
  - A run whose winner is not drawn in the Brain lights "other", and `stability.current` names the real class.
- **Halos:** each tip that has won keeps a soft halo. Its opacity runs from 0.3 for one win to 0.95 for every run.
- **Summary:** the strand returns to the clean top-1, and `display-state.stability` carries the winners.
- **Controls:** `play-pulse` replays from run 1. `normal` exits and clears the halos.
- **Steer:** entering stability clears steering and sets `capabilities.steer` false. The display also ignores `steer-update` until Steer comes back.

## B: the adversarial pair (`273655c`)
- **Pairing:** the pair comes from `fgsm.json`. The current image and its partner stay loaded, the partner's Steer data included.
- **Switch speed:**
  - on the display: 13–35 ms;
  - host tap to answered Brain through the relay, measured locally: 57–200 ms.
- **Camera:** it does not move between the pair (checked to 6 decimals), and the answered Brain appears at once. Every other switch behaves as before.
- **State and caption:** `image.adversarial` is filled in, and the caption reads "Changed by at most 2/255 per pixel".
- **Noise view** (set-mode `noiseView`, key N): a 300 ms crossfade to "The change, amplified 50×". It turns off on any image switch.
- **Keys:** A jumps between the pair.

## C: the medical card (`f388d1d`)
- **Fan layout:** strands are ordered by score, highest first, along a sweep over the upper hemisphere facing the camera. Two staggered arcs keep the tips at least 0.72 apart.
- **Strands:** each strand's thickness and brightness come from its own independent score. Nothing is normalized, and there is no "other".
- **Ring:** on Pneumonia on the pneumonia film; none on the normal film.
- **Note:** a permanent note sits above the fan: "Independent scores · each 0–100% on its own · not a diagnosis".
- **Capabilities:** `scoreKind` is independent, and Steer and stability are false.

## D: glow (`d487485`)
- **What glows:** the strands, the tips and the pulse only. Labels, the panel and the tissue never glow.
- **Settings:** UnrealBloomPass with **threshold 0.7, strength 0.6, radius 0.35**. The glow layer renders at half resolution.
- **How it is drawn:** only the blur is added over the normal frame. A full composer would blend the translucent tissue in linear space and wash it out.
- **Cost:** +0.5 to 1.3 ms per frame at 2560×1440 (the median render goes from 1.2–2.5 ms to 2.1–3.2 ms), at 60 fps.
- **Auto-off:** if fps stays below 45 for 3 s, glow turns off, `capabilities.bloom` goes false, and the console gets a note. The host (`set-mode bloom`) or key B turns it back on.

## E: the Steer moment (`b553c33`)
- **When it fires:** steering, or its reset, changes the top answer.
- **What happens:** `steerMoment {from, to, at}` is set for 4 s, and one bright pulse runs down the new lit path in 600 ms.
- **Mode changes** do not fire it.

## Checks
- **`web/core/checks/cc8demo.mjs`** runs the whole demo order: a 2560×1440 display, an emulated iPad host and an iPhone guest, through the relay, with no reloads.
  - **Locally: 23/23 checks pass, with 0 console errors.**
  - The noise and glow toggles go out as `set-mode` from a second host socket, because the controller has no buttons for them yet (Codex's CX-8).
- **Steer e2e (CC-7):** passes, with 0 console errors. **CC-5:** passes 67/67.
- **Vultr:** not run yet. The box serves a build from before the framing work, so it has to be updated to main first.

### Frame rate on the display (2560×1440, local, measured over 2.5 s each)

| Mode | fps | frames > 25 ms |
|---|---|---|
| normal, glow on | 60.0 | 0 |
| normal, glow off | 60.0 | 0 |
| stability, playing | 60.0 | 0 |
| adversarial | 60.0 | 0 |
| noise view | 60.0 | 0 |
| medical | 60.0 | 0 |
| Steer, flipped | 60.0 | 0 |
