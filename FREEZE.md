# FREEZE (draft, CC-10; final at 1:00 AM)

Main: `freeze` tag (pending). Live box: https://64-177-50-154.sslip.io, room **STRK7**.

## Judging day: the commands

| When | Command | Expect |
|---|---|---|
| Before anything | `STARK_KEY_FILE=~/.config/stark/host-key npm run preflight -- https://64-177-50-154.sslip.io` | `PREFLIGHT PASSED` in < 20 s (health, TLS, 130 assets, head.bin sha, QR, host, guest, latency) |
| Full dress rehearsal | `STARK_KEY_FILE=~/.config/stark/host-key npm run rehearse -- https://64-177-50-154.sslip.io --headless` | `REHEARSE PASSED` in ~30 s. **It opens its own display, which takes over the room**: run it before opening the real display, or use `--external` |
| Rehearse the real display | `... npm run rehearse -- <url> --external` | drives the display already open in the room; skips camera and console checks |
| Perf on the real monitor | `STARK_PERF=1 npm run demo`, open `http://localhost:3000/display?perf=1` full screen, then `npm run perftour -- http://localhost:3000` | p50 ≥ 55 and p95 ≥ 40 fps in every mode |
| Local fallback (no internet) | `npm run demo` | prints the display URL, the hotspot controller URL and a QR; keeps the Mac awake |
| Update the box | on the box, as root: `bash /opt/stark/server/deploy/update.sh` | `health ok (<commit>)` and `https ok` |
| Keyboard check, no network | `node web/core/checks/keysoffline.mjs` | every key works with the server killed |

The host key is read from `STARK_HOST_KEY` or `~/.config/stark/host-key` and never printed.

## Before the demo

1. Run preflight against the box.
2. Open the display full screen at least **20 s before the first image switch**. It preloads all 125 demo files (12.9 MB): 0.2 s locally, **15–17 s over the iPhone hotspot**. A grey "Loading demo files n/125" line shows bottom-left until it finishes.
3. Phones scan the QR. The room is fixed (STRK7), so a display reload never needs a rescan.

## Kill switches (display URL flags)

Add to the display URL and reload. The display comes back to the same image and mode (display recovery), and controllers stay connected.

| Flag | Effect |
|---|---|
| `?nosteer` | Steer off on every image (`capabilities.steer` false) |
| `?nostability` | Stability mode off |
| `?nomedical` | Medical images refuse to load (the display stays on the current image) |
| `?nointerior` | Trunk interior and Full/Reduced off |
| `?nobloom` | Glow off and cannot be turned on |
| `?reduced` | Trunk interior opens with the reduced layer set |
| `?pr=1` | Pixel-ratio cap (default 1.5) |
| `?perf=1` | fps / frame-time overlay (top-right) |

Flags combine: `/display?nobloom&reduced`.

## Keyboard fallback (works with no network at all)

| Key | Does |
|---|---|
| 1–9 | Gallery image by manifest order: 1 retriever, 2 adversarial retriever, 3 cat, 4 pneumonia X-ray, 5 wolf, 6 sports car, 7 monarch, 8 chihuahua, 9 normal X-ray |
| Space / E | Replay the pulse / jump to the end |
| [ / ] | Slower / faster |
| G | Heatmap on/off |
| H | HUD on/off |
| Esc / R | Clear focus / reset view |
| A | The adversarial pair's other image |
| N | Noise ×50 on/off (adversarial image) |
| B | Glow on/off |
| F / Shift+F / X | Steer: zero the flip set / zero the top-1's channels / reset |

## On and off

| Feature | State |
|---|---|
| Brain, pulse, focus, heatmaps, orbit/zoom | on |
| Steer (sliders and code) | on. The wolf's slider rows now lead with the flip set (449, 31, 240, 252): it holds through three, then flips to white wolf on the fourth |
| Stability, adversarial pair + Noise ×50, medical fan, trunk interior, glow | on |
| Display recovery after a reload | on (fixed room only) |

## Defaults (Part B)

Pending the 27-inch perf log: today `layerMode full`, glow on, pixel-ratio cap 1.5. Numbers so far: 60 fps in every mode at 2560×1440 @1× on this Mac's GPU, headless and through the perf tour (p50 59.9, p95 ≥ 57). At 1.5× with glow on, 53.7–56.7 fps.

## Known issues

| # | Issue | Workaround |
|---|---|---|
| 2 | Camera "jumps" on the adversarial switch (Ray). Not reproduced: the camera holds still in every automated path | Use the Original/Adversarial pair button, not the gallery; tell us the exact steps |
| 3 | An occasional single 66 ms frame during the first stability play (headed Chrome on the dev Mac) | Play stability once before judges arrive |
| 4 | "Steering" badge overlaps the QR at 1920 (HUD, Codex's lane) | Present at 2560×1440 |
| — | Switching image while inside the trunk interior leaves the camera at the interior viewpoint | Press Normal (or R) before switching image |
| — | The rehearsal bot opens its own display, which takes over the room | Use `--external` once the real display is up |
