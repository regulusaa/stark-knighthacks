"""Core ResNet50 stage: crop.png, scores, tree.json, gradcam/ (master plan 7.2-7.5, contract 2.2-2.3)."""
import shutil

import numpy as np

from .. import config, gradcam, imaging, jsonio, labels, resnet, tree

NAME = "core"
ORDER = 50  # after input generators (fgsm), before per-image extras (atlas, stability)
SOURCES = ["config.py", "labels.py", "gallery.py", "imaging.py", "resnet.py", "tree.py", "gradcam.py",
           "jsonio.py", "stages/core.py"]


def applies(entry):
    return entry["category"] != "medical"


def outputs(entry):
    d = config.ASSETS / entry["id"]
    return [d / "crop.png", d / "tree.json", d / "gradcam" / "index.json"]


def softmax(logits):
    z = logits.astype(np.float64)
    z = z - z.max()
    e = np.exp(z)
    return e / e.sum()


def run(ctx):
    entry, out = ctx.entry, ctx.out_dir
    image_id = entry["id"]

    crop = imaging.model_crop(ctx.input_path, preprocessed=bool(entry.get("preprocessed")))
    for stale in (out / "crop.png", out / "tree.json"):
        stale.unlink(missing_ok=True)
    shutil.rmtree(out / "gradcam", ignore_errors=True)
    imaging.save_png(crop, out / "crop.png")

    model = resnet.get()
    feats, logits = model.forward(imaging.to_array(crop))
    scores = softmax(logits[0])
    order = np.argsort(-scores, kind="stable")
    rank_of = {int(c): r + 1 for r, c in enumerate(order)}
    cls = labels.classes()

    def ref(c):
        return {"classId": c, "label": cls[c][2], "score": float(scores[c])}

    top_k = [{"rank": r + 1, "classId": int(c), "wnid": cls[c][1], "label": cls[c][2], "score": float(scores[c])}
             for r, c in enumerate(order[:config.TOP_K])]
    top_ids = [t["classId"] for t in top_k]
    top1 = top_ids[0]

    true_id = labels.lookup(entry["trueLabel"])[0] if entry.get("trueLabel") else None
    leaves = list(top_k)
    extra_mass = 0.0
    if true_id is not None and true_id not in top_ids:
        leaves.append({"rank": rank_of[true_id], "classId": true_id, "wnid": cls[true_id][1],
                       "label": cls[true_id][2], "score": float(scores[true_id])})
        extra_mass = float(scores[true_id])
    # "other" holds every score not shown as a leaf, so the root sums to 1.
    other_score = float(1.0 - sum(t["score"] for t in top_k) - extra_mass)

    root_id, nodes = tree.build(leaves, top1, true_id, other_score)

    # Grad-CAM: top 5 (or every tip) plus the true class.
    explain = top_ids if entry.get("gradcam") == "all" else top_ids[:config.GRADCAM_TOP]
    if true_id is not None and true_id not in explain:
        explain = explain + [true_id]
    cams = gradcam.compute(model, feats, explain)
    raw_max = {}
    for c in explain:
        img, raw_max[c] = gradcam.to_png(cams[c][0])
        imaging.save_png(img, out / "gradcam" / f"{c}.png")

    index_classes = []
    for leaf in leaves:
        c = leaf["classId"]
        has = c in raw_max
        index_classes.append({"classId": c, "label": leaf["label"], "hasHeatmap": has,
                              "file": f"gradcam/{c}.png" if has else None,
                              "rawMax": raw_max[c] if has else None})

    jsonio.write(out / "gradcam" / "index.json", {
        "schema": "stark.gradcam/1",
        "imageId": image_id,
        "targetLayer": config.GRADCAM_LAYER,
        "width": config.CROP, "height": config.CROP,
        "encoding": "png-gray8",
        "normalization": gradcam.NORMALIZATION,
        "classes": index_classes,
    })

    jsonio.write(out / "tree.json", {
        "schema": "stark.tree/1",
        "kind": "wordnet",
        "scoreKind": "softmax",
        "model": config.MODEL_NAME,
        "imageId": image_id,
        "rootId": root_id,
        "top1": ref(top1),
        "trueClass": ({**ref(true_id), "rank": rank_of[true_id]} if true_id is not None else None),
        "otherScore": other_score,
        "topK": top_k,
        "nodes": nodes,
    })

    t = ref(top1)
    ctx.log(f"top-1 {t['label']} ({t['score']:.3f}); true rank "
            f"{rank_of[true_id] if true_id is not None else '-'}; {len(nodes)} nodes; {len(explain)} heatmaps")
