# Integration checkpoint 1

The display and the controllers working together through the relay: Claude's display (`/web/core`), Codex's controller and HUD (`/web/ui`) and the relay (`/server`), merged.

Status: **automated runs pass; the real-device runs and the Vultr runs are still to do.** Fill in the empty columns after those runs.

## The script

Each run, without reloading any page:

1. The host selects the retriever.
2. Pulse, strand and ring appear.
3. The guest takes control, orbits, pinches and picks "Labrador retriever" from the list.
4. The display flies to the tip and shows the heatmap.
5. The guest is released after 20 s idle.
6. The host overrides and resets.

**Automated:** `cc5run.mjs` drives the real pages:
- the display at 1920×1080 on the Mac's GPU (Metal);
- Codex's host page as an iPad Pro 11;
- the guest page as an iPhone 13, with real touch events (a one-finger drag, and a two-finger pinch over Chrome DevTools).

A test socket counts the state messages the controllers receive. It is Chromium on localhost, not Safari on real devices.

## Results

| # | Step | Automated, local (3 runs) | iPad + iPhone, local over hotspot (3 runs) | iPad + iPhone, Vultr (3 runs) |
|---|---|---|---|---|
| 0 | Display registers, gets a server-issued room, HUD shows the room and QR | pass | | |
| 0 | Host and guest pages connect; display counts 2 controllers | pass | | |
| 1 | Host taps the retriever, display loads it | pass 3/3 | | |
| 2 | Pulse plays and completes, strand reveals, true-class ring shown | pass 3/3 | | |
| 2 | Guest's answer list shows the retriever's answers | pass 3/3 | | |
| 3 | Guest takes control | pass 3/3 (68–172 ms) | | |
| 3 | Guest drag orbits the display | pass 3/3 (≈1.8 rad for a 45%-width drag) | | |
| 3 | Guest pinch zooms the display | pass 3/3 (distance 13.5 → 6.2 for a 2.5× pinch) | | |
| 3 | Guest picks "Labrador retriever" | pass 3/3 | | |
| 4 | Display focuses 208, camera flies to it, tip unoccluded | pass 3/3 | | |
| 4 | Labrador heatmap on the photo; focus card on the phone | pass 3/3 (round trip 32–41 ms) | | |
| 5 | Idle release 20 s after the last driver action; guest sees "Take the wheel" | pass 3/3 | | |
| 6 | Host's Reset view overrides the guest (Ray driving, guest locked) | pass 3/3 | | |
| 6 | Display returns to the default camera | pass 3/3 | | |
| – | State traffic ≤ 10/s per kind at the controllers | pass (max 2/s) | | |
| – | No page reloaded across the 3 runs | pass | | |
| – | No console errors on the display, host or guest | pass (0 / 0 / 0) | | |

The automated run counts 67/67 checks: the 6 setup checks, 18 per run, and 7 at the end. The script is `checks/cc5run.mjs`.

**What the automated run cannot show:**
- iOS Safari's touch handling;
- the feel of orbit and pinch on a real thumb;
- cellular latency;
- the live Vultr box.

Those are the two empty columns.

## Measured frame rate (the demo Mac, Apple M1 with a 7-core GPU)

All runs are on the retriever. **Cost** is the time to render one frame, including GPU time: `renderer.render` followed by `gl.finish`, with vsync on.

| Phase | 2560×1440 @1× | | 2560×1440 @2× (render pixel ratio 1.5) | |
|---|---|---|---|---|
| | fps | cost p50 / worst | fps | cost p50 / worst |
| Idle | 60 | 2.1 / 4.0 ms | 60 | 2.2 / 3.4 ms |
| Select the retriever | 60 | 1.1 / 3.9 ms (after the fix) | 60 | 1.1 / 3.9 ms (after the fix) |
| Pulse | 60 | 2.3 / 4.1 ms | 60 | 2.1 / 3.7 ms |
| Strand reveal | 60 | 2.2 / 3.8 ms | 60 | 2.2 / 3.3 ms |
| Focus fly to Labrador | 60 | 1.8 / 2.8 ms | 60 | 1.5 / 3.2 ms |
| Orbit while focused | 60 | 1.6 / 2.9 ms | 60 | 1.7 / 2.4 ms |
| Orbit at the default view | 60 | 2.1 / 3.6 ms | 60 | 2.1 / 3.6 ms |

Every phase holds 60 fps, and the worst frame in every phase is 16.8 ms. The rendering budget is about 85% unused.

Other measurements:
- **Cold start:** about 1.1 s from page load to ready, of which the tissue build (in a worker) takes about 0.85 s.
- **Image switch:** about 24 ms of main-thread JS. The veins take 9 ms and the labels 5 ms.

### The worst issue, and the fix

Before the fix, **every image switch recompiled three shaders**: the tips, the halos and the labels.
- **Cause:** the old Brain's materials were disposed before the new Brain's first render. That dropped each shader program's use count to zero, so three.js deleted it, and the next frame compiled it again.
- **Cost:** the first frame after a switch took 15–27 ms of render time, and one frame was dropped just as the pulse started. On a busy GPU the stall stretched to 0.5–0.9 s.
- **Fix** (`retireLater` in `scene.js`): the old materials are disposed 1 s later, after the new Brain has rendered.
- **Result:** the program count stays at 10 across switches, and the first frame now takes 3–4 ms. Textures return to their baseline 2 s after a burst of 12 switches, so nothing leaks.

## Latency

**Local** (Wi-Fi/loopback, automated):
- Guest taps an answer → the focus card appears on the phone: median 33 ms. That is the full trip: phone → relay → display → relay → phone.
- Guest taps Take control → driving on every screen: median 146 ms.

**Cellular:** not measured yet. To be filled in from the Vultr runs:
- Orbit feel:
- Focus tap → fly-to:
- Anything that stuttered:

## Demo risks, ranked

1. **A host override locks guests out for up to 20 s.**
   - **Cause:**
     - Codex's host controller claims the wheel whenever the host orbits, zooms or presses Reset view (`claimHostControl`).
     - Under the contract (§4), the driver is only released after `DRIVER_IDLE_MS`, and a guest's take-control gets LOCKED until then.
   - **Effect:** in the script, after "host override → reset" the next guest waited 13 s to drive. The host can also lock everyone out without meaning to, just by pressing Reset view.
   - **Options (Ray's call, contract §4/§5):**
     - (a) accept it, and narrate "the host has the wheel";
     - (b) the host acts without becoming driver (the relay already lets the host send driver-or-host events at any time);
     - (c) add a `release-control` event;
     - (d) a shorter idle time for the host.
2. **None of it has run on real devices yet.**
   - The real-device risks are iOS Safari's pointer and pinch behaviour, the wake lock, a phone sleeping mid-demo, and cellular jitter on orbit.
   - The orbit gain (`NET.orbitGain` = 1.5) was chosen, not tuned by feel. Try it live with `/display?orbitGain=1.2` (or 2), plus the phone's own sensitivity slider. Then fix the value in `net.js`.
3. **Software rendering makes the demo unusable.**
   - Without the GPU (Chrome's hardware acceleration off, or the GPU blocklisted), the pulse takes over 20 s and the fly-to tweens crawl.
   - Before the demo, check that `chrome://gpu` shows hardware acceleration on the display machine.
4. **Vultr doesn't run this build yet.** It is on `ed1864e`, the branch from before the anatomical Brain. It has to be updated to main before the Vultr runs.
5. **A display reload costs about 1–2 s of black screen** while the tissue builds and shaders compile. Over Vultr, add the asset download.
   - The display reclaims its room after a reload, and the controllers recover on their own.
   - Avoid reloading mid-demo anyway.
6. **The tissue build runs on the main thread if workers fail** (for example, an old Safari as the display). That would freeze the page for about 1 s at startup. Chrome on the demo Mac uses the worker.

## How to run it again

From the repo root, on the integrated tree (core + ui):

```sh
read -s STARK_HOST_KEY && export STARK_HOST_KEY   # type the key; it is not echoed
PORT=3000 node server/index.js &
node web/core/checks/cc5run.mjs http://localhost:3000 3 --metal   # the script: 3 runs on the Metal GPU
node web/core/checks/cc5run.mjs https://<ip-with-dashes>.sslip.io 3 --metal   # the same against Vultr
node web/core/checks/prof2.mjs http://localhost:3000 2            # frame cost per phase at 2560×1440 @2×
```

`cc5run.mjs` joins the room as an extra guest to count messages, so Vultr's guest labels will skip a number.
