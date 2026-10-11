# STATUS (CC-10, updated 2026-10-10 23:40)

Legend: **WORKS** = passes an automated check end to end · **FLAKY** = works but a known bug in BUGS.md · **OFF** = disabled.
Live box: https://64-177-50-154.sslip.io, on main d0e56d5 (deployed by Codex 2026-10-10 ~22:30).

## Must-have

| Feature | Status | Evidence | Capability / flag |
|---|---|---|---|
| Display + relay + QR, host (key) and guests | WORKS | `cc8demo.mjs` on Vultr (all ok), `npm run smoke` (99) | — |
| Gallery: 9 images, number keys 1–9 | WORKS | `cc8demo.mjs`, CC-5 67/67 | — |
| Forward pulse up the trunk, answered Brain (tree, tips, labels) | WORKS | CC-5, `cc8demo.mjs` | playback |
| Focus a tip → heatmap on the photo, fly to it | WORKS | CC-5, Codex `cx8.verify` | focus-state |
| Orbit / zoom / reset from the phone | WORKS | CC-5, `frame/verify` | driver |
| Steer (sliders + code) on the phone, answer flips | WORKS | BUGS #1 FIXED: the wolf's rows lead with the flip set; holds through 3, flips to white wolf at the 4th (`steer-e2e.mjs` 2/2, `cc8demo.mjs`, rehearse) | `capabilities.steer`, `?nosteer` |
| Steer moment (pulse down the new path, 4 s) | WORKS | `cc8demo.mjs` (Vultr) | `steerMoment` |

## Should-have

| Feature | Status | Evidence | Capability / flag |
|---|---|---|---|
| Stability mode (30 runs, summary, halos) | WORKS | rehearse step 4 (fps avg 59–60); BUGS #3 FIXED (start hitch gone; one stray 66 ms frame sometimes on the first play) | `capabilities.stability`, `?nostability` |
| Adversarial pair + Noise ×50 | WORKS (BUGS #2 not reproduced) | `v3buttons.mjs` (Vultr), rehearse step 5 asserts the camera still (to 1e-4) | `capabilities.noiseView` |
| Medical fan (2 X-rays, independent scores, note, ring) | WORKS | `cc8demo.mjs` (Vultr), rehearse step 7 | `scoreKind: independent`, `?nomedical` |
| Trunk interior (49 slabs, 54,145 cells, Full/Reduced) | WORKS | `cc9trunk.mjs`, `cc8demo.mjs` (Vultr), perftour | `capabilities.trunkInterior`, `layerModes`, `?nointerior`, `?reduced` |
| Selective glow, auto-off < 45 fps for 3 s, host can restore | WORKS | `v3buttons.mjs` (Vultr, 15/15) | `capabilities.bloom`, `?nobloom` |
| Contextual HUD (Codex) | **FLAKY** | `cx8-hud.verify` ok; BUGS #4 "Steering" badge overlaps QR at 1920 (Codex's lane) | — |
| Keyboard fallback (R, Space, E, [ ], G, H, Esc, F, Shift+F, X, N, A, B, 1–9) | WORKS with no network | `checks/keysoffline.mjs` (server killed after the preload) | — |

## Demo safety (CC-10)

| Feature | Status | Evidence |
|---|---|---|
| Preload of every demo file + head.bin (125 files, 12.9 MB) | WORKS | rehearse "display preload"; 0.2 s local, 15–17 s over the iPhone hotspot to Vultr |
| Kill switches `?nosteer ?nostability ?nomedical ?nointerior ?nobloom ?reduced ?pr=` | WORKS | `flags.js`; FREEZE.md |
| Display recovery after a reload (fixed room) | WORKS | `rehearse --reload`: restored in 1.4–1.5 s, controllers keep their sockets; trunk + reduced survives |
| `npm run rehearse` | WORKS | 3× local 20–32 s; Vultr pending the deploy (old build: stability select > 1 s without preload) |
| `npm run preflight` | WORKS | local 0.2 s, Vultr 15.7 s |
| `npm run demo` (hotspot fallback) | WORKS | rehearse --reload passes against http://172.20.10.14:3000 (this Mac on the iPhone hotspot) |
| `?perf=1` + `STARK_PERF=1` + `npm run perftour` | WORKS | stand-in run: every mode p50 59.9, p95 ≥ 57 at 2560×1440 @1× |

## Measured

| What | Number | Where |
|---|---|---|
| fps at 2560×1440 @1×, every mode (normal, stability, adversarial, noise, glow off, medical, Steer, trunk full/reduced) | 60.0, 0 frames > 25 ms | `cc8demo.mjs` on Vultr (headless Chromium, Metal, this Mac) |
| fps @1.5× pixel ratio, glow on | 53.7 (normal) – 56.7 (trunk reduced); 60 with glow off | `cc9trunk.mjs` |
| Glow cost | +0.5–1.3 ms/frame | CC8-REPORT |
| Host tap → display answers (pair switch, Vultr) | 158 ms | `cc8demo.mjs` |
| Host toggle round trip (Vultr) | 115–160 ms (one 2 s outlier, not reproduced in 3 reruns) | `v3buttons.mjs` |
| Steer apply on the display | 13–35 ms | CC8-REPORT |
| Trunk interior first build | ~200 ms | CC9-REPORT |
| Assets | 13 MB total: head.bin 8.2 MB, per image 0.6–0.8 MB, medical 70 KB each | `du` |
| Real 27-inch monitor numbers | not yet | Part B: `npm run perftour` with the display on the monitor |
| Preload over the iPhone hotspot (Vultr) | 125 files in 15–17 s | CC-10 |
| Display recovery after a reload | 1.4–1.5 s | `rehearse --reload` |
