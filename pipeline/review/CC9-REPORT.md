# CC-9 report: the trunk interior

**Status: demo-ready, well before the 11:30 PM stop (finished 9:45 PM).** `capabilities.trunkInterior` is on for every image that has an atlas, and off for medical images. The work is on `agent/claude-core`. Screenshots are in `pipeline/review/cc9/`, taken at 2560×1440 and scaled to 1600 px.

## What it does
- **Enter and exit:** host `set-mode {mode: "trunk"}` flies the camera beside the trunk over 1.2 s. The trunk opens into a column of slabs, and the Brain dims to 30%: the tissue and tracts fade, and the tips, labels and decorative nerves hide. `normal` reverses all of it, and the camera returns home.
- **Slabs:** one per atlas layer, 49 in all, from conv1 at the bottom to conv5_block3_out at the top. They span y = 0 to 6, with extra gaps between stages.
  - Every slab is 2.4 units wide, so a 112×112 layer has tiny cells and a 7×7 layer large ones.
  - Each cell is a box whose height and inferno colour come from its quantized value.
  - **One instanced draw call** covers all 54,145 cells. Building it takes about 200 ms on first entry; it is built once per image and reused.
- **Labels:** "conv1 · 112×112", "stage 2 · 56×56", "stage 3 · 28×28", "stage 4 · 14×14", "stage 5 · 7×7". Facts only.
- **Skip arcs:** 16 thin tubes on the right, each running from its block's input to its output. The 4 projection shortcuts are dashed.
  - conv2_block1's input is pool1, which is not in the atlas, so its arc starts from conv1.
  - The arcs fade out in reduced mode, because the slabs they connect are gone.
- **Reduced mode:** keeps layer-config.json's reduced set and spreads it over the same height. That set is **5 slabs, not 6**: the brief lists conv5_block3_out twice, once as stage 5's last layer and once on its own.
- **Pulse:** the forward-pass pulse (49 layers × 120 ms) lights each slab as the band passes it.
- **Steer link:** the top slab is conv5_block3_out. While steering is active, its 7×7 heights are recomputed live. Each cell is the L2 norm over the 2048 channels of `conv5.bin` × the current scales, divided by the atlas's maxRaw.
  - Unsteered, this reproduces the atlas slab exactly (0 difference after quantization).
  - While steering, the slab carries the label "Steer edits this layer".
- **Contract amendment, decided during CC-9:** v3 said entering `trunk` clears steering. It now keeps steering, and Steer stays available inside, so the slab can follow it. Stability still clears steering. CONTRACT.md 3.6 records the amendment.

## Measured (`web/core/checks/cc9trunk.mjs`, 2560×1440, glow on)

| Mode | @1× | @1.5× |
|---|---|---|
| normal | 60.0 fps | 53.7 fps |
| trunk, full | 60.0 fps | 55.0 fps |
| trunk, full, pulse running | 60.0 fps | 55.2 fps |
| trunk, reduced | 60.0 fps | 56.7 fps |

- **At 1×** (a 27-inch 2560×1440 monitor at native scaling), full mode holds 60 fps, so there is no need to pick reduced for fps.
- **At 1.5×**, every mode drops a few fps, normal included. The trunk interior is not the cause: with glow off, 1.5× runs at 60 fps. Glow is cheap on the GPU (about 3 ms per frame) but costs frames at 1.5× in headless Chrome.
  - If the demo Mac drives the monitor scaled and it shows, turn Glow off. Glow also turns itself off below 45 fps for 3 s.

**GPU memory**

| When | geometries | textures | programs |
|---|---|---|---|
| before 5 enter/exit cycles | 71 | 25 | 27 |
| after 5 enter/exit cycles | 71 | 25 | 27 |
| across image switches with the interior | 71 → 71 | 25 → 24 | 27 → 27 |

## Nothing else changed
- **CC-8 demo order:** passes all checks. It now also enters the trunk interior and switches Full/Reduced through Codex's real host buttons, at 60 fps in both.
- **Steer e2e (CC-7):** passes, with 0 console errors.
- **CC-5:** passes 67/67.
- **Unit tests, steer-dsl and server smoke:** all pass.
- **Codex's buttons check (`v3buttons.mjs`):** still fails one check, the known CX-8 Glow-button bug (Codex's to fix).
