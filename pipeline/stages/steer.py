"""Steer data (contract v2 section 2.9): conv5.bin + steer.json per ResNet50 image; once per run, the dense head
(steer/head.bin + head.json), the 1000 class labels the display resolves Steer programs against (steer/classes.json), the Keras reference file (steer/reference.json), the closed-form Grad-CAM check
against the core stage's heatmaps, and pipeline/review/steer_review.png.
"""
import hashlib

import numpy as np
from PIL import Image

from .. import config, gradcam, imaging, jsonio, labels, resnet, steer_math as sm

NAME = "steer"
ORDER = 60  # after core (needs tree.json and the heatmaps it wrote)
SOURCES = ["config.py", "labels.py", "gallery.py", "imaging.py", "resnet.py", "gradcam.py", "jsonio.py",
           "steer_math.py", "steer_review.py", "stages/steer.py"]
VERSION = 1
IDENTITY_TOL = 1e-3
TOP_CHANNELS = 10
STEER_DIR = config.ASSETS / "steer"
REFERENCE_IMAGES = ["clean_retriever", "ambig_cat", "ambig_wolf"]  # the retriever + both stability candidates
CHECKS = config.REVIEW / "steer_checks.json"
ONCE_OUTPUTS = [STEER_DIR / "head.bin", STEER_DIR / "head.json", STEER_DIR / "classes.json", STEER_DIR / "reference.json", CHECKS,
                config.REVIEW / "steer_review.png"]


def applies(entry):
    return entry["category"] != "medical"


def outputs(entry):
    d = config.ASSETS / entry["id"]
    return [d / "conv5.bin", d / "steer.json"]


def _label(k):
    return labels.classes()[k][2]


def run(ctx):
    entry, out = ctx.entry, ctx.out_dir
    for stale in outputs(entry):
        stale.unlink(missing_ok=True)
    tree = jsonio.read(out / "tree.json")
    # the same crop and forward pass as the core stage
    crop = imaging.model_crop(ctx.input_path, preprocessed=bool(entry.get("preprocessed")))
    model = resnet.get()
    feats, keras_logits = model.forward(imaging.to_array(crop))
    A = feats[0]
    W = model.dense_kernel.astype(np.float64)
    b = model.dense_bias.astype(np.float64)
    p = sm.pooled(A)
    closed = sm.logits(W, b, p)
    err = float(np.max(np.abs(closed - keras_logits[0].astype(np.float64))))
    scores = sm.softmax(closed)
    tree_err = max(abs(scores[e["classId"]] - e["score"]) for e in tree["topK"])
    if err >= IDENTITY_TOL or tree_err >= 1e-4:
        raise AssertionError(f"{entry['id']}: identity check failed (logits {err:.2e}, tree scores {tree_err:.2e}); "
                             "steer.json not written")

    (out / "conv5.bin").write_bytes(sm.conv5_to_bytes(A))

    ranked = [e["classId"] for e in tree["topK"]]
    explain = ranked[:5]
    true = tree["trueClass"]
    if true is not None and true["classId"] not in explain:
        explain.append(true["classId"])
    rank_of = {int(c): r + 1 for r, c in enumerate(np.argsort(-closed, kind="stable"))}

    classes = []
    for k in explain:
        contrib = sm.contributions(W, p, k)
        top = np.argsort(-contrib, kind="stable")[:TOP_CHANNELS]
        classes.append({"classId": k, "label": _label(k), "rank": rank_of[k], "logit": float(keras_logits[0][k]),
                        "top": [{"channel": int(c), "contribution": float(contrib[c]), "pooled": float(p[c])}
                                for c in top]})

    k_for, k_against = ranked[0], ranked[1]
    marg = sm.margins(W, p, k_for, k_against)
    favoring = {"for": k_for, "against": k_against,
                "top": [{"channel": int(c), "margin": float(marg[c])}
                        for c in np.argsort(-marg, kind="stable")[:TOP_CHANNELS]]}
    f = sm.flip(W, b, p, k_for, k_against)
    flip = None if f is None else {"from": f["from"], "to": f["to"], "toLabel": _label(f["to"]),
                                   "toScore": f["toScore"], "n": f["n"], "channels": f["channels"]}

    jsonio.write(out / "steer.json", {
        "version": VERSION, "imageId": entry["id"], "layer": config.GRADCAM_LAYER, "grid": sm.GRID,
        "channels": sm.CHANNELS, "identityMaxAbsErr": err,
        "classes": classes, "favoring": favoring, "flip": flip,
    })
    ctx.log(f"identity max |err| {err:.2e}; flip " + (f"n={flip['n']}: {_label(flip['from'])} -> {flip['toLabel']} "
            f"({flip['toScore']:.3f})" if flip else "none within 64 channels"))


# ------------------------------------------------------------------------------------------------- run once
def once_inputs(entries):
    paths = []
    for e in entries:
        if applies(e):
            d = config.ASSETS / e["id"]
            paths += [d / "conv5.bin", d / "steer.json", d / "crop.png", d / "tree.json", d / "gradcam" / "index.json"]
            paths += sorted((d / "gradcam").glob("*.png")) if (d / "gradcam").exists() else []
    return paths


def _export_head(model, log):
    data = sm.head_to_bytes(model.dense_kernel, model.dense_bias)
    STEER_DIR.mkdir(parents=True, exist_ok=True)
    (STEER_DIR / "head.bin").write_bytes(data)
    jsonio.write(STEER_DIR / "head.json", {
        "layer": "predictions", "inputs": sm.CHANNELS, "outputs": sm.CLASSES, "dtype": "float32",
        "layout": "W[c][k] row-major, then b[k]", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(),
    })
    sm.load_head.cache_clear()
    log(f"steer/head.bin {len(data)} bytes")


def _export_classes(log):
    """All 1000 ImageNet classes, so the display can name any class Steer turns up and resolve top(N, "label")."""
    jsonio.write(STEER_DIR / "classes.json", {
        "schema": "stark.classes/1",
        "classes": [{"classId": k, "wnid": wnid, "label": lab} for k, wnid, lab in labels.classes()],
    })
    log(f"steer/classes.json {len(labels.classes())} classes")


def _interventions(data):
    """The three fixed test interventions for reference.json, from an image's steer.json."""
    by_class = {c["classId"]: c for c in data["classes"]}
    k1, k2 = data["favoring"]["for"], data["favoring"]["against"]
    top1 = [t["channel"] for t in by_class[k1]["top"]]
    top2 = [t["channel"] for t in by_class[k2]["top"]]
    boost = [c for c in top2 if c not in top1[:6]][:4]          # x2: the runner-up's strongest channels
    half = top1[:4]                                               # x0.5: top-1's four strongest
    zero = [c for c in top1[4:] if c not in boost][:2]            # x0: top-1's next two
    return [
        {"name": "all ones", "scales": []},
        {"name": "top-5 channels of top-1 set to 0", "scales": [[c, 0.0] for c in top1[:5]]},
        {"name": "mixed: 4 channels x2, 4 channels x0.5, 2 channels x0",
         "scales": [[c, 2.0] for c in boost] + [[c, 0.5] for c in half] + [[c, 0.0] for c in zero]},
    ]


def _reference(model, log):
    """Expected outputs from the REAL Keras layers (avg_pool + predictions as a keras.Model, GradientTape)."""
    tf = model.tf
    head = model.head_model()
    images = []
    for image_id in REFERENCE_IMAGES:
        d = config.ASSETS / image_id
        if not (d / "steer.json").exists():
            log(f"reference: {image_id} has no steer data; skipped")
            continue
        A = sm.conv5_from_bytes((d / "conv5.bin").read_bytes()).astype(np.float32)
        data = jsonio.read(d / "steer.json")
        cases = []
        for iv in _interventions(data):
            s = sm.scale_vector(iv["scales"]).astype(np.float32)
            scaled = tf.convert_to_tensor(A[None] * s[None, None, None, :])
            with tf.GradientTape() as tape:
                tape.watch(scaled)
                z = head(scaled, training=False)[0]
                k = int(tf.argmax(z))
                target = z[k]
            g = tape.gradient(target, scaled)[0].numpy().astype(np.float64)   # (7, 7, 2048)
            alpha = g.mean(axis=(0, 1))
            cam_raw = scaled[0].numpy().astype(np.float64) @ alpha          # 7x7, before ReLU and normalization
            z = z.numpy().astype(np.float64)
            cases.append({
                "name": iv["name"],
                "scales": [{"channel": int(c), "scale": float(v)} for c, v in sorted(iv["scales"])],
                "top1": {"classId": k, "label": _label(k), "logit": float(z[k]), "score": float(sm.softmax(z)[k])},
                "logits": [float(v) for v in z],
                "gradcam": {"classId": k, "camRaw": [[float(v) for v in row] for row in cam_raw]},
            })
        images.append({"imageId": image_id, "cases": cases})
    jsonio.write(STEER_DIR / "reference.json", {
        "version": 1,
        "model": config.MODEL_NAME,
        "computedWith": "keras.Model(Input((7,7,2048)), predictions(avg_pool(x))) from the loaded ResNet50's own "
                        "layers; Grad-CAM with tf.GradientTape on the scaled tensor",
        "input": "assets/<imageId>/conv5.bin scaled per channel (channels not listed keep scale 1)",
        "gradcamNote": "camRaw = sum_c alpha_c * A'[i][j][c] with alpha_c = mean over the grid of d logit_k / d A', "
                       "before ReLU and normalization. alpha_c = W[c][k] / 49, so camRaw = (1/49) * "
                       "sum_c W[c][k] * s_c * A[i][j][c].",
        "images": images,
    })
    log(f"steer/reference.json: {sum(len(i['cases']) for i in images)} cases on {len(images)} images")


def _pearson(a, b):
    a = a.astype(np.float64).ravel()
    b = b.astype(np.float64).ravel()
    if a.std() == 0 or b.std() == 0:
        return 1.0 if np.array_equal(a, b) else 0.0
    return float(np.corrcoef(a, b)[0, 1])


def _closed_form_check(entries, log):
    """Closed-form CAM vs the core stage's Grad-CAM PNGs (same upsampling and normalization)."""
    W, _ = sm.load_head()
    out = {}
    for e in entries:
        d = config.ASSETS / e["id"]
        if not applies(e) or not (d / "conv5.bin").exists():
            continue
        A = sm.conv5_from_bytes((d / "conv5.bin").read_bytes())
        per = {}
        for c in jsonio.read(d / "gradcam" / "index.json")["classes"]:
            if not c["hasHeatmap"]:
                continue
            mine, _ = gradcam.to_png(sm.cam(A, W, c["classId"]))
            with Image.open(d / c["file"]) as im:
                stored = np.asarray(im.convert("L"))
            mine = np.asarray(mine)
            per[str(c["classId"])] = {"pearson": _pearson(mine, stored),
                                      "maxPixelDiff": int(np.max(np.abs(mine.astype(int) - stored.astype(int))))}
        rs = [v["pearson"] for v in per.values()]
        out[e["id"]] = {"classes": per, "min": min(rs), "mean": float(np.mean(rs)), "n": len(rs)}
        log(f"closed-form CAM vs core Grad-CAM, {e['id']}: min r {min(rs):.6f} over {len(rs)} heatmaps")
    return out


def run_once(entries, log):
    from .. import steer_review
    model = resnet.get()
    _export_head(model, log)
    _export_classes(log)
    _reference(model, log)
    cams = _closed_form_check(entries, log)
    identity = {}
    for e in entries:
        p = config.ASSETS / e["id"] / "steer.json"
        if applies(e) and p.exists():
            identity[e["id"]] = jsonio.read(p)["identityMaxAbsErr"]
    jsonio.write(CHECKS, {"identityMaxAbsErr": identity, "closedFormCam": cams})
    worst = min((v["min"] for v in cams.values()), default=None)
    if worst is not None and worst < 0.98:
        log(f"!!! closed-form CAM correlation {worst:.4f} < 0.98: the core Grad-CAM and the closed form disagree")
    steer_review.make(entries, log)


# ------------------------------------------------------------------------------------------------- validate
def validate(image_dir, entry):
    errs = []
    w = f"{entry['id']}/steer"
    c5, sj = image_dir / "conv5.bin", image_dir / "steer.json"
    if not c5.exists() or not sj.exists():
        return [f"{w}: conv5.bin or steer.json missing"]
    if c5.stat().st_size != sm.CONV5_BYTES:
        return [f"{w}: conv5.bin is {c5.stat().st_size} bytes, want {sm.CONV5_BYTES}"]
    head = sm.HEAD_BIN
    if not head.exists() or head.stat().st_size != sm.HEAD_BYTES:
        return [f"{w}: steer/head.bin missing or not {sm.HEAD_BYTES} bytes"]
    hj = jsonio.read(STEER_DIR / "head.json") if (STEER_DIR / "head.json").exists() else {}
    if hj.get("sha256") != hashlib.sha256(head.read_bytes()).hexdigest():
        errs.append(f"{w}: head.json sha256 does not match head.bin")
    s = jsonio.read(sj)
    need = {"version": int, "imageId": str, "layer": str, "grid": int, "channels": int,
            "identityMaxAbsErr": float, "classes": list, "favoring": dict, "flip": (dict, type(None))}
    for k, t in need.items():
        if k not in s or not isinstance(s[k], t) or isinstance(s[k], bool):
            errs.append(f"{w}: field '{k}' missing or wrong type")
    if errs:
        return errs
    if (s["imageId"], s["layer"], s["grid"], s["channels"]) != (entry["id"], config.GRADCAM_LAYER, 7, 2048):
        errs.append(f"{w}: imageId/layer/grid/channels")
    if not s["identityMaxAbsErr"] < IDENTITY_TOL:
        errs.append(f"{w}: identityMaxAbsErr {s['identityMaxAbsErr']} >= {IDENTITY_TOL}")

    W, b = sm.load_head()
    A = sm.conv5_from_bytes(c5.read_bytes())
    p = sm.pooled(A)
    z = sm.logits(W, b, p)
    tree = jsonio.read(image_dir / "tree.json")
    ranked = [e["classId"] for e in tree["topK"]]
    want = ranked[:5] + ([tree["trueClass"]["classId"]]
                         if tree["trueClass"] and tree["trueClass"]["classId"] not in ranked[:5] else [])
    if [c["classId"] for c in s["classes"]] != want:
        errs.append(f"{w}: classes should be the top 5 + true class {want}")
    for c in s["classes"]:
        k = c["classId"]
        contrib = sm.contributions(W, p, k)
        # all 2048 contributions sum to logit − b, and the stored logit is the Keras one
        if abs(contrib.sum() - (c["logit"] - b[k])) > 1e-3:
            errs.append(f"{w}[{k}]: contributions sum {contrib.sum():.6f} != logit - b {c['logit'] - b[k]:.6f}")
        top = c["top"]
        if len(top) != TOP_CHANNELS or [t["contribution"] for t in top] != sorted((t["contribution"] for t in top), reverse=True):
            errs.append(f"{w}[{k}]: top must be {TOP_CHANNELS} channels, contribution descending")
        for t in top:
            if abs(t["contribution"] - contrib[t["channel"]]) > 1e-5 or abs(t["pooled"] - p[t["channel"]]) > 1e-6:
                errs.append(f"{w}[{k}]: channel {t['channel']} contribution/pooled mismatch")
                break
        if abs(np.sort(contrib)[::-1][0] - top[0]["contribution"]) > 1e-6:
            errs.append(f"{w}[{k}]: top[0] is not the strongest channel")
    fav = s["favoring"]
    if (fav.get("for"), fav.get("against")) != (ranked[0], ranked[1]) or len(fav.get("top", [])) != TOP_CHANNELS:
        errs.append(f"{w}: favoring should be top-1 vs top-2 with {TOP_CHANNELS} channels")
    f = s["flip"]
    if f is not None:
        zz = sm.logits(W, b, p, sm.scale_vector([(c, 0.0) for c in f["channels"]]))
        if len(f["channels"]) != f["n"] or int(np.argmax(zz)) != f["to"] or f["from"] != int(np.argmax(z)):
            errs.append(f"{w}: flip does not reproduce (zeroing {f['n']} channels gives {int(np.argmax(zz))}, not {f['to']})")
        elif abs(sm.softmax(zz)[f["to"]] - f["toScore"]) > 1e-6:
            errs.append(f"{w}: flip toScore mismatch")
        if f["n"] > 1:
            zp = sm.logits(W, b, p, sm.scale_vector([(c, 0.0) for c in f["channels"][:-1]]))
            if int(np.argmax(zp)) != f["from"]:
                errs.append(f"{w}: flip is not minimal (n-1 channels already flip)")
    return errs
