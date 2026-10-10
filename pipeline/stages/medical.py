"""Medical card (master plan section 10, contract 2.8): torchxrayvision densenet121-res224-all on a chest X-ray.

Library preprocessing only: grayscale, xrv.datasets.normalize(img, 255), XRayCenterCrop, XRayResizer(224).
Scores are independent per-finding model scores (scoreKind "independent"): never softmaxed, not mutually exclusive,
not required to sum to 1, and not validated diagnostic probabilities. Grad-CAM with pytorch-grad-cam on
features.denseblock4 (the last dense block) for the top 3 findings plus Pneumonia.
Writes crop.png (the exact model input as grayscale), tree.json (kind "fan"), gradcam/ and medical.json.
"""
import shutil

import numpy as np
from PIL import Image

from .. import config, imaging, jsonio, labels

NAME = "medical"
ORDER = 50
SOURCES = ["config.py", "gallery.py", "imaging.py", "jsonio.py", "labels.py", "stages/medical.py"]
MODEL = "torchxrayvision densenet121-res224-all"
WEIGHTS = "densenet121-res224-all"
TARGET_LAYER = "features.denseblock4"
ALWAYS_EXPLAIN = "Pneumonia"
CAVEAT = ("Independent per-finding model scores; not mutually exclusive, need not sum to 1, "
          "not validated diagnostic probabilities.")
NORMALIZATION = "per-heatmap: pytorch-grad-cam scale_cam_image (cam - min) / max, * 255"

_model = None


def applies(entry):
    return entry["category"] == "medical"


def outputs(entry):
    d = config.ASSETS / entry["id"]
    return [d / "crop.png", d / "tree.json", d / "gradcam" / "index.json", d / "medical.json"]


def _load():
    global _model
    if _model is None:
        import torch
        import torchxrayvision as xrv
        torch.manual_seed(0)
        torch.use_deterministic_algorithms(True)
        m = xrv.models.DenseNet(weights=WEIGHTS)  # from ~/.torchxrayvision/models_data (no download when cached)
        m.eval()
        _model = m
    return _model


def model_input(path):
    """The library's own preprocessing -> float32 (1, 224, 224) in the model's [-1024, 1024] range."""
    import skimage.io
    import torchvision
    import torchxrayvision as xrv
    img = skimage.io.imread(str(path))
    img = xrv.datasets.normalize(img, 255)
    if img.ndim == 3:
        img = img[..., :3].mean(2)          # grayscale
    img = img[None, ...]
    tf = torchvision.transforms.Compose([xrv.datasets.XRayCenterCrop(), xrv.datasets.XRayResizer(224)])
    return tf(img).astype(np.float32)


def run(ctx):
    import torch
    from pytorch_grad_cam import GradCAM
    from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget

    entry, out = ctx.entry, ctx.out_dir
    for stale in outputs(entry):
        stale.unlink(missing_ok=True)
    shutil.rmtree(out / "gradcam", ignore_errors=True)

    model = _load()
    names = dict(model.named_modules())
    if TARGET_LAYER.split(".", 1)[1] not in dict(model.features.named_children()) or TARGET_LAYER not in names:
        raise AssertionError(f"{TARGET_LAYER} is not in the loaded model")
    x = model_input(ctx.input_path)                                   # (1, 224, 224)
    # the exact model input, as grayscale: [-1024, 1024] -> 0-255
    crop = np.clip(np.round((x[0] + 1024.0) / 2048.0 * 255.0), 0, 255).astype(np.uint8)
    imaging.save_png(Image.fromarray(crop, mode="L"), out / "crop.png")

    t = torch.from_numpy(x[None])                                     # (1, 1, 224, 224)
    with torch.no_grad():
        scores = model(t)[0].numpy().astype(np.float64)
    findings = [(k, labels.readable(p)) for k, p in enumerate(model.pathologies) if p]   # skip empty labels
    order = sorted(findings, key=lambda f: (-scores[f[0]], f[0]))
    rank_of = {k: r + 1 for r, (k, _) in enumerate(order)}
    label_of = dict(findings)

    true_name = entry.get("trueFinding")
    true_id = None
    if true_name:
        hits = [k for k, lab in findings if lab.lower() == labels.readable(true_name).lower()]
        if len(hits) != 1:
            raise ValueError(f"{entry['id']}: trueFinding {true_name} is not one of the model's findings")
        true_id = hits[0]

    always = [k for k, lab in findings if lab == ALWAYS_EXPLAIN]
    explain = [k for k, _ in order[:3]] + [k for k in always if k not in [k2 for k2, _ in order[:3]]]

    cam = GradCAM(model=model, target_layers=[names[TARGET_LAYER]])
    raw_max = {}
    corr = {}
    for k in explain:
        m224 = cam(input_tensor=t, targets=[ClassifierOutputTarget(k)])[0]          # (224, 224), scaled 0-1
        acts = cam.activations_and_grads.activations[0].numpy()[0].astype(np.float64)   # (C, 7, 7)
        grads = cam.activations_and_grads.gradients[0].numpy()[0].astype(np.float64)
        raw7 = np.maximum(np.tensordot(grads.mean(axis=(1, 2)), acts, axes=1), 0.0)       # the same Grad-CAM, 7x7
        raw_max[k] = float(raw7.max())
        q = np.clip(np.round(m224 * 255.0), 0, 255).astype(np.uint8) if raw_max[k] > 0 else np.zeros((224, 224), np.uint8)
        imaging.save_png(Image.fromarray(q, mode="L"), out / "gradcam" / f"{k}.png")
        up = np.asarray(Image.fromarray(raw7.astype(np.float32), mode="F").resize((224, 224), Image.BILINEAR))
        corr[k] = float(np.corrcoef(up.ravel(), m224.ravel())[0, 1]) if raw_max[k] > 0 else 1.0
    cam.activations_and_grads.release()

    ref = lambda k: {"classId": k, "label": label_of[k], "score": float(scores[k])}
    top1 = order[0][0]
    top_k = [{"rank": r + 1, "classId": k, "wnid": None, "label": lab, "score": float(scores[k])}
             for r, (k, lab) in enumerate(order)]
    nodes = [{"id": "root", "label": "chest X-ray findings", "depth": 0, "parent": None,
              "children": [f"f{k}" for k, _ in order], "value": None, "isLeaf": False, "onTop1Path": True,
              "isTrueLabel": False, "isOther": False, "classId": None, "rank": None}]
    nodes += [{"id": f"f{k}", "label": lab, "depth": 1, "parent": "root", "children": [], "value": float(scores[k]),
               "isLeaf": True, "onTop1Path": k == top1, "isTrueLabel": k == true_id, "isOther": False,
               "classId": k, "rank": rank_of[k]} for k, lab in order]
    jsonio.write(out / "tree.json", {
        "schema": "stark.tree/1", "kind": "fan", "scoreKind": "independent", "model": MODEL,
        "imageId": entry["id"], "rootId": "root", "top1": ref(top1),
        "trueClass": {**ref(true_id), "rank": rank_of[true_id]} if true_id is not None else None,
        "otherScore": None, "topK": top_k, "nodes": nodes,
    })
    jsonio.write(out / "gradcam" / "index.json", {
        "schema": "stark.gradcam/1", "imageId": entry["id"], "targetLayer": TARGET_LAYER,
        "width": 224, "height": 224, "encoding": "png-gray8", "normalization": NORMALIZATION,
        "classes": [{"classId": k, "label": lab, "hasHeatmap": k in raw_max,
                     "file": f"gradcam/{k}.png" if k in raw_max else None,
                     "rawMax": raw_max.get(k)} for k, lab in order],
    })
    jsonio.write(out / "medical.json", {
        "schema": "stark.medical/1", "imageId": entry["id"], "model": MODEL, "scoreKind": "independent",
        "caveat": CAVEAT, "gradcamTargetLayer": TARGET_LAYER,
        "sourceLabel": ({"classId": true_id, "label": label_of[true_id], "source": entry.get("trueSource", "")}
                        if true_id is not None else None),
        "findings": [{"classId": k, "label": lab, "score": float(scores[k]), "rank": rank_of[k],
                      "hasHeatmap": k in raw_max, "file": f"gradcam/{k}.png" if k in raw_max else None}
                     for k, lab in findings],
    })
    top3 = ", ".join(f"{label_of[k]} {scores[k]:.2f}" for k, _ in order[:3])
    ctx.log(f"top 3: {top3}; " + (f"true {label_of[true_id]} rank {rank_of[true_id]} ({scores[true_id]:.2f}); "
                                  if true_id is not None else "no source label; ")
            + f"heatmaps for {[label_of[k] for k in explain]} (lib vs 7x7 r >= {min(corr.values()):.4f})")


def validate(image_dir, entry):
    w = f"{entry['id']}/medical"
    errs = []
    for f in outputs(entry):
        if not f.exists():
            errs.append(f"{w}: {f.name} missing")
    if errs:
        return errs
    t = jsonio.read(image_dir / "tree.json")
    m = jsonio.read(image_dir / "medical.json")
    g = jsonio.read(image_dir / "gradcam" / "index.json")
    if (t.get("kind"), t.get("scoreKind"), t.get("otherScore"), t.get("rootId")) != ("fan", "independent", None, "root"):
        errs.append(f"{w}: tree.json must be a fan with independent scores and no other leaf")
    if m.get("schema") != "stark.medical/1" or m.get("scoreKind") != "independent" or m.get("imageId") != entry["id"]:
        errs.append(f"{w}: medical.json schema/scoreKind/imageId")
    fs = m.get("findings", [])
    if [f["classId"] for f in fs] != sorted(f["classId"] for f in fs) or any(not 0 <= f["score"] <= 1 for f in fs):
        errs.append(f"{w}: findings must be in model order with scores 0-1")
    if sorted(f["rank"] for f in fs) != list(range(1, len(fs) + 1)):
        errs.append(f"{w}: ranks must be 1..{len(fs)}")
    by_id = {f["classId"]: f for f in fs}
    for e in t["topK"]:
        f = by_id.get(e["classId"])
        if f is None or abs(f["score"] - e["score"]) > 1e-12 or f["rank"] != e["rank"]:
            errs.append(f"{w}: tree.json topK and medical.json disagree on {e['label']}")
            break
    leaves = [n for n in t["nodes"] if n["isLeaf"]]
    if len(leaves) != len(fs) or any(n["parent"] != "root" or n["depth"] != 1 for n in leaves):
        errs.append(f"{w}: fan leaves must all hang off the root")
    if sum(n["onTop1Path"] for n in leaves) != 1 or t["top1"]["classId"] != t["topK"][0]["classId"]:
        errs.append(f"{w}: exactly one top-1 leaf")
    heat = {c["classId"] for c in g["classes"] if c["hasHeatmap"]}
    want = {e["classId"] for e in t["topK"][:3]} | {k for k, f in by_id.items() if f["label"] == ALWAYS_EXPLAIN}
    if heat != want or heat != {f["classId"] for f in fs if f["hasHeatmap"]}:
        errs.append(f"{w}: heatmaps should be the top 3 + {ALWAYS_EXPLAIN}")
    true = m.get("sourceLabel")
    tt = t.get("trueClass")
    if (true is None) != (tt is None) or (true and true["classId"] != tt["classId"]):
        errs.append(f"{w}: sourceLabel and tree trueClass disagree")
    if entry.get("trueFinding") and not true:
        errs.append(f"{w}: trueFinding set but no sourceLabel")
    return errs
