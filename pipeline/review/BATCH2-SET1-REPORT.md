# Batch 2 Set 1 report (CC-6)

**contract v2 ready to merge.** It is on `agent/claude-core`: CONTRACT.md, contract.js, `steer-dsl.js` with 101 passing tests, and 8 new fixtures.

(This report is written as each part completes. The summary is at the end.)

## Part 0: reconcile
- Checkpoint 1 passed: automated 67/67 over 3 runs, and Ray reported all real-device runs passed. CHECKPOINT-1.md is updated.
- main = `9d184d8` (core + ui merged) and pushed. Vultr was updated to main: `/health` ok over HTTPS.
- Asset baseline: sha256 of all 70 files under `web/public/assets`, in `pipeline/.cache/assets-before.json`.

## Part B: Steer data, DONE
- `steer/head.bin` is 8,196,000 bytes, exactly as required; its sha256 is in `head.json`.
- Every image has `conv5.bin` (401,408 bytes) and `steer.json`.
- Code: stage `pipeline/stages/steer.py`, maths in `pipeline/steer_math.py`. It reuses `imaging.model_crop`, `to_array` and `resnet.forward`, the same path the core stage uses.
- **Identity check:** the closed form b + Wᵀp matches the Keras logits to within 2.2e-6 to 8.7e-6 on every image (the threshold is 1e-3). Its softmax also reproduces tree.json's scores (< 1e-4).
- **reference.json:** 9 cases, 3 interventions × 3 images (retriever, cat, wolf). They are computed with a real `keras.Model(avg_pool → predictions)` built from the loaded model's own layers, with Grad-CAM from GradientTape on the scaled tensor.
  - Cross-checked against the closed form: the largest logit difference is 6.9e-6, and the largest relative camRaw difference is 1.1e-8.
  - Two of the cases are real flips (cat → tiger cat, wolf → Arctic fox).
- **Closed-form CAM against the core stage's stored Grad-CAM PNGs**, after the same upsampling and normalization: Pearson r = 1.000000 for all 50 heatmaps on all 6 images (`pipeline/review/steer_checks.json`).
- **Run time:** Part B adds about 2 s to a run.
- `validate.py` now checks:
  - byte counts and the head sha256;
  - the steer.json schema;
  - for each listed class, that the 2048 contributions sum to logit − b (within 1e-3);
  - that the listed top channels equal the recomputed contributions;
  - that the flip reproduces and is minimal;
  - the manifest's `steerable`.
- I looked at `steer_review.png`. The channel maps sit on the subject: the retriever's face, and the monarch's diagonal wing. The flip results are below.
- **Note:** editing `resnet.py` made the core stage re-run on every image. All 70 baseline asset files came out byte-identical.

## Part C: stability test and adversarial retriever, DONE

### Stability
The stage is `pipeline/stages/stability.py`. Each image gets 30 runs with seed 1337:
- a crop covering 85–100% of the area, with aspect ratio 0.9–1.1;
- a horizontal flip with probability 0.5;
- brightness ×U(0.85, 1.15).

Besides the contract fields, mc.json records `cleanTop1` and `matchFraction`.

| Image | Runs matching the clean top-1 | Winners | Top-1 mean ± std |
|---|---|---|---|
| ambig_cat | **40%** (tabby 12/30) | tiger cat 18, tabby 12 | tabby 0.377 ± 0.084 (tiger cat 0.420 ± 0.061) |
| ambig_wolf | 100% | timber wolf 30 | 0.807 ± 0.066 |
| clean_retriever (the contrast) | 100% | golden retriever 30 | 0.958 ± 0.014 |

**Verdict: `ambig_cat` is the less stable candidate, so it becomes the stability demo image.** Its top-1 flips between tabby and tiger cat; tiger cat actually wins most runs. The wolf never changes its answer.

### FGSM
The stage is `pipeline/stages/fgsm.py`; it runs before core and creates `adv_retriever`'s input.
- **Method:** untargeted FGSM, with the gradient taken through `preprocess_input` inside the tape. Each candidate is rounded to uint8, written as PNG, read back and classified again.
- **Result:**
  - ε = 1/255 did not flip after rounding.
  - **ε = 2/255** flips it: golden retriever (0.969) → **Labrador retriever (0.213)**.
  - Golden retriever drops to 0.108, now rank 2.
- **Size of the change:**
  - maxPixelChange 2 levels, meanAbsChange 1.998;
  - **PSNR 42.1 dB**: the two crops are indistinguishable by eye.
- `noise_x50.png` is written.
- `adv_retriever` (gallery order 2, `generated` + `preprocessed: true`) gets the full asset set: crop, tree, Grad-CAM, conv5/steer, atlas. Its steer identity check passes. It isn't one of reference.json's three images, so it has no reference cases.

## Part D: activation atlas, DONE
- `pipeline/stages/atlas.py` reads the 49 layer names from the loaded model: conv1_relu, then `_1_relu`, `_2_relu` and `_out` for each of the 16 blocks. It runs one multi-output model, with one forward pass per image.
- **Asserts:** 49 layers; grid sizes 112, 56, 28, 14 and 7 (conv3_block1_1_relu is already 28, because Keras puts the stride on the first 1×1 conv); a total of exactly **54,145 bytes**.
- `atlas.json` follows contract 2.4 (the field is `maxRaw`, as the contract names it), and `layer-config.json` is written (5 layers in the reduced trunk). All 7 steerable images have an atlas, `adv_retriever` included.
- **Skips:** `fromLayer` follows the contract and its fixture (the block's `_1_relu` → `_out`). The prompt says "from the block's input layer", so each skip also carries `inputLayer` (the previous block's `_out`) and `inputInAtlas`. For conv2_block1 the real input is `pool1_pool`, which is not in the atlas. **Open question** below.
- **Validator:** checks offsets, lengths, sizes, a peak of 255 and the skips. It also checks that the conv5_block3_out map matches `conv5.bin` (it does).
- **What I saw:** the edges of the dog and the butterfly at conv1–conv2, part outlines at conv3, and coarse object blobs at conv5. **conv4_block6_out peaks at the top-left corner on both images I checked**, a border response rather than the subject. It is worth knowing before narrating that layer.

## Part E: medical card, DONE
- **Model:** torchxrayvision `densenet121-res224-all`, loaded from the local cache. Preprocessing is the library's own: grayscale, `xrv.datasets.normalize(img, 255)`, `XRayCenterCrop`, `XRayResizer(224)`.
- **Scores:** all 18 pathologies are non-empty labels, and all are kept with `scoreKind: "independent"`. Nothing is softmaxed. xrv's operating-point normalization puts each finding's threshold at 0.5.
- **Grad-CAM:** pytorch-grad-cam 1.5.7 on **`features.denseblock4`**, the last dense block (the name was checked against the loaded model). It covers the top 3 findings plus Pneumonia.
  - The library's map agrees with a 7×7 Grad-CAM recomputed from the same hooks (r ≥ 0.9999).
  - The PNG keeps the library's own min-max scaling, and `index.json` says so.
- **Outputs:**
  - `crop.png`, the exact model input as grayscale;
  - a fan `tree.json`;
  - `gradcam/`;
  - `medical.json`, with the caveat text;
  - `steerable: false` in the manifest.
- **Inputs:** gallery orders 4 and 9.
  - `med_xray_pneumonia.jpg` is now ["X-ray lung consolidation.jpg"](https://commons.wikimedia.org/wiki/File:X-ray_lung_consolidation.jpg): Parmar MS, *BMC Infectious Diseases* 2005;5:30, "Overwhelming Blastomycosis pneumonia", the initial PA film showing consolidation in the right mid and both lower lobes. It is CC BY 2.0 and the attribution is in `credits.txt`. True class: Pneumonia, from the paper.
  - `med_xray_normal.jpg` is the 960-px file from `~/Downloads` dated Oct 8. True class: null.

**Scores**

| Image | Top 3 (independent scores) | Pneumonia |
|---|---|---|
| med_xray_pneumonia | Lung Opacity 0.97, Pneumonia 0.84, Mass 0.76 | **rank 2 of 18, 0.84** |
| med_xray_normal | Pleural Thickening 0.51, Fibrosis 0.50, Infiltration 0.45 | rank 14, 0.02 (not a true class) |

**How the pneumonia film was chosen (follow-up, after Ray asked for a fix).** The first film, the Oct 8 file from Downloads, got Pneumonia 0.18 (rank 13), with every finding near the 0.5 operating point. The fix had to keep the contract model, because the contract pins `densenet121-res224-all` and its class IDs 0–17.
- **Other weight sets:** I tried them on that film first. RSNA gave 0.48 and PadChest 0.53; none was clear.
- **Screening:** I then scored 19 adult PA/AP films from Commons "Category:X-rays of pneumonia" with the contract model, and kept the one where it scores Pneumonia highest. The other 18 put Pneumonia between rank 3 and rank 17, and only two of them (rank 3, about 0.53) put it in the top 3.
- **So the gallery film is a favourable case, chosen by screening.** The card must not suggest the model reliably finds pneumonia; it is the model's per-finding scores on one film. The screening script and its full results are in this session's scratchpad (`cxr_score.py`); I can commit them if you want the selection to be reproducible.

**What the heatmaps show.** I looked at them myself and am describing only what is visible:
- **Pneumonia film:**
  - Lung Opacity and Pneumonia: nearly the same map. Both peak on the patient's right mid zone (image left), on the consolidation, and fade down into the right lower zone.
  - Mass: the heart and mediastinum, centre, spreading into the same right mid-zone consolidation.
- **Normal film:**
  - Pleural Thickening: the left image border at the lower lung zone.
  - Fibrosis: the bottom-left corner below the diaphragm, plus the top-right near the shoulder.
  - Infiltration: the upper mediastinum.
  - Pneumonia: a small spot right of the trachea near the aortic knob.
- **Markers and borders:**
  - The center crop removes the side markers ("L" on the pneumonia film, "Sin"/"Dx" on the normal one), so no map sits on a marker.
  - Several maps do sit on image borders or below the diaphragm rather than in the lung fields: Fibrosis's corners on the normal film.

## Final: clean run, validation and regression

**Clean run.** I deleted all of `web/public/assets/*` and `pipeline/.cache`, then ran `python -m pipeline.run --force`.
- It took **70.5 s** for all 9 images. The total per stage was: core 14.6 s, steer 7.0 s, stability 28.9 s (most of it TensorFlow warm-up on the first batch), atlas 6.2 s, medical 9.0 s, fgsm 2.0 s.
- `python -m pipeline.validate` passes, with 9 images.
- `node contract/steer-dsl.test.mjs` passes, 101/101.
- **Reproducibility:** the clean run reproduced every committed file byte for byte. `git status` was empty afterwards, review PNGs included.

**Regression check against Part 0.** 69 of the 70 baseline files are unchanged. The one change is `manifest.json`, which is intentional: it gains `steerable` on every entry plus three new entries (adv_retriever, med_xray_pneumonia, med_xray_normal). 61 files were added. Nothing unexpected changed.

**Display.** It loads all 9 images with 0 console errors, including the fan trees (18 tips) with the true-class ring on Pneumonia. The layout test passes for all 9 images. The suites still pass: relay 19/19, CC-4a 21/21, CC-4b 30/30, all with 0 console errors, and server smoke passes 58 checks. CC-4a's old check that "key 2 does nothing" now expects key 2 to load adv_retriever, since gallery order 2 exists.

### Flip table (zero the top channels by margin, top-1 vs top-2; global argmax re-checked after each)

| Image | n | From → to | New score | Identity error |
|---|---|---|---|---|
| clean_retriever | 7 | golden retriever (0.969) → Labrador retriever | 0.487 | 2.8e-06 |
| adv_retriever | 1 | Labrador retriever (0.213) → golden retriever | 0.131 | 1.5e-06 |
| ambig_cat | 1 | tabby (0.438) → tiger cat | 0.466 | 3.3e-06 |
| ambig_wolf | 4 | timber wolf (0.884) → white wolf | 0.395 | 6.9e-06 |
| clean_sportscar | 1 | sports car (0.564) → snowmobile | 0.372 | 4.1e-06 |
| clean_monarch | 17 | monarch (1.000) → ringlet | 0.429 | 8.7e-06 |
| ambig_chihuahua | 12 | Chihuahua (0.977) → toy terrier | 0.437 | 2.2e-06 |

Demo note: on `adv_retriever`, **zeroing one channel undoes the attack** (it returns to golden retriever).

### Closed-form CAM correlation (Pearson, against the core stage's PNGs)
r = 1.000000 (minimum) on every image: retriever 25 heatmaps, every other ResNet image 5 each, 50 in total. The details are in `pipeline/review/steer_checks.json`.

## Summary

| Part | Status | Evidence |
|---|---|---|
| 0 Reconcile | DONE | Checkpoint 1 passed; main `9d184d8` pushed; Vultr on main, health ok; 70 assets hashed |
| A Contract v2 + DSL | DONE | CONTRACT.md, contract.js, `steer-dsl.js`; 101/101 tests (limits, positions, round trip ×200, hostile input); 8 fixtures; server smoke ok |
| B Steer data | DONE | head.bin 8,196,000 B; conv5.bin 401,408 B ×7; identity < 1e-5; reference.json from real Keras layers; CAM r = 1.0; steer_review.png checked |
| C Stability + FGSM | DONE | mc.json ×3; the cat is less stable (40%); adv_retriever flips at ε = 2/255 after PNG rounding, PSNR 42.1 dB, full asset set |
| D Atlas | DONE | 49 layers, 54,145 B, ×7 images; layer-config.json |
| E Medical | DONE | Fan trees, independent scores, Grad-CAM on `features.denseblock4`; the pneumonia film was replaced after screening (Pneumonia 0.84, rank 2) |

## Open questions for Ray
1. **The medical result: fixed by changing the film.** Pneumonia is now 0.84 (rank 2), behind Lung Opacity at 0.97. The film was chosen by screening 19 candidates, as described in Part E; the narration should not claim the model is reliable.
2. **Image credits.** The pneumonia film is credited in `credits.txt` (CC BY 2.0). The normal film's source and licence are still unknown.
3. **Atlas skips.** The prompt says each skip runs from the block's input layer; the contract and its fixture say `_1_relu`. I followed the contract and added `inputLayer`/`inputInAtlas` with the real input. Which one should the renderer draw?
4. **mc.json `classes`** holds the top 10 by mean, as the prompt asked; contract 2.6 says "the image's topK classes". Extra fields: `aspectRatio`, `cleanTop1`, `matchFraction`.
5. **fgsm.json** has extra fields beyond contract 2.7: `maxPixelChange`, `meanAbsChange`, `psnr`, `method`. `noiseFile` is `noise_x50.png`.
6. **The server lags contract v2** (`/server` was out of scope here). Its `steer-update` validator still checks the v1 shape and sends "Steer is not available yet". The v2 rate limits (steer-update 20/s, steer-result from the display at 15/s) and the `steer-dsl` parse check need a Set 2 task.
7. **The gallery key** is `preprocessed: true` (it already existed for exactly this) rather than `precropped: true`.
8. **conv4_block6_out** peaks at the top-left corner on both images I looked at, a border response. Worth knowing before narrating the trunk interior.
