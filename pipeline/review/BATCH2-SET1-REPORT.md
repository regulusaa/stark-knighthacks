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
