"""Prediction stability under test-time augmentation (master plan section 8, contract 2.6): mc.json.

For entries with "stability": true. 30 runs with a fixed seed; each run takes a random crop covering 85-100% of the
224 crop's area (aspect 0.9-1.1) resized back to 224, a horizontal flip with probability 0.5, and a brightness
factor U(0.85, 1.15), clipped to 0-255. This measures stability under these transforms; it is NOT calibrated
uncertainty.
"""
import numpy as np
from PIL import Image

from .. import config, imaging, jsonio, labels, resnet, steer_math as sm

NAME = "stability"
ORDER = 70
SOURCES = ["config.py", "labels.py", "gallery.py", "imaging.py", "resnet.py", "jsonio.py", "stages/stability.py"]
RUNS = 30
SEED = 1337
AREA = (0.85, 1.0)
ASPECT = (0.9, 1.1)
HFLIP = 0.5
BRIGHTNESS = (0.85, 1.15)
TOP_CLASSES = 10


def applies(entry):
    return bool(entry.get("stability")) and entry["category"] != "medical"


def outputs(entry):
    return [config.ASSETS / entry["id"] / "mc.json"]


def augment(crop, rng):
    """One augmented copy of a 224x224 PIL crop -> float32 HxWx3 in 0-255."""
    size = config.CROP
    area = rng.uniform(*AREA) * size * size
    aspect = rng.uniform(*ASPECT)
    w = min(size, int(round(np.sqrt(area * aspect))))
    h = min(size, int(round(np.sqrt(area / aspect))))
    x0 = int(rng.integers(0, size - w + 1))
    y0 = int(rng.integers(0, size - h + 1))
    im = crop.crop((x0, y0, x0 + w, y0 + h)).resize((size, size), Image.BILINEAR)
    if rng.random() < HFLIP:
        im = im.transpose(Image.FLIP_LEFT_RIGHT)
    a = np.asarray(im, dtype=np.float32) * np.float32(rng.uniform(*BRIGHTNESS))
    return np.clip(a, 0, 255)


def run(ctx):
    entry = ctx.entry
    crop = imaging.model_crop(ctx.input_path, preprocessed=bool(entry.get("preprocessed")))
    model = resnet.get()
    _, clean_logits = model.forward(imaging.to_array(crop))
    clean = sm.softmax(clean_logits[0])
    clean_top = int(np.argmax(clean))

    rng = np.random.default_rng(SEED)
    batch = np.stack([augment(crop, rng) for _ in range(RUNS)])
    _, z = model.forward(batch)
    scores = np.stack([sm.softmax(row) for row in z])           # (30, 1000)
    tops = scores.argmax(axis=1)
    name = lambda k: labels.classes()[int(k)][2]

    per_run = [{"run": i, "top1ClassId": int(tops[i]), "top1Score": float(scores[i, tops[i]])} for i in range(RUNS)]
    counts = {}
    for t in tops:
        counts[int(t)] = counts.get(int(t), 0) + 1
    winners = [{"classId": k, "label": name(k), "count": n}
               for k, n in sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))]
    mean = scores.mean(axis=0)
    std = scores.std(axis=0)
    classes = [{"classId": int(k), "label": name(k), "mean": float(mean[k]), "std": float(std[k])}
               for k in np.argsort(-mean, kind="stable")[:TOP_CLASSES]]
    match = float(np.mean(tops == clean_top))

    jsonio.write(ctx.out_dir / "mc.json", {
        "schema": "stark.stability/1",
        "imageId": entry["id"],
        "method": "test-time augmentation",
        "runs": RUNS,
        "seed": SEED,
        "transforms": {"cropAreaFrac": list(AREA), "aspectRatio": list(ASPECT), "hflipProb": HFLIP,
                       "brightnessDelta": round(BRIGHTNESS[1] - 1, 6)},
        "perRun": per_run,
        "winners": winners,
        "distinctWinners": len(winners),
        "classes": classes,                          # the top 10 classes by mean score over the runs
        "cleanTop1": {"classId": clean_top, "label": name(clean_top), "score": float(clean[clean_top])},
        "matchFraction": match,                      # fraction of runs whose top-1 is the clean top-1
    })
    ctx.log(f"{len(winners)} distinct winner(s); {match:.0%} of runs match the clean top-1 ({name(clean_top)}); "
            f"top-1 score mean {mean[clean_top]:.3f} ± {std[clean_top]:.3f}")


def validate(image_dir, entry):
    p = image_dir / "mc.json"
    w = f"{entry['id']}/mc.json"
    if not p.exists():
        return [f"{w}: missing"]
    m = jsonio.read(p)
    errs = []
    if m.get("schema") != "stark.stability/1" or m.get("imageId") != entry["id"]:
        errs.append(f"{w}: schema/imageId")
    if m.get("method") != "test-time augmentation" or m.get("runs") != RUNS or m.get("seed") != SEED:
        errs.append(f"{w}: method/runs/seed")
    runs = m.get("perRun", [])
    if [r.get("run") for r in runs] != list(range(RUNS)):
        errs.append(f"{w}: perRun must list runs 0..{RUNS - 1} in order")
    if any(not 0 <= r.get("top1Score", -1) <= 1 for r in runs):
        errs.append(f"{w}: perRun score out of range")
    counts = {}
    for r in runs:
        counts[r["top1ClassId"]] = counts.get(r["top1ClassId"], 0) + 1
    winners = m.get("winners", [])
    if {x["classId"]: x["count"] for x in winners} != counts or m.get("distinctWinners") != len(counts):
        errs.append(f"{w}: winners/distinctWinners do not match perRun")
    if [x["count"] for x in winners] != sorted((x["count"] for x in winners), reverse=True):
        errs.append(f"{w}: winners not sorted by count")
    cls = m.get("classes", [])
    if len(cls) != TOP_CLASSES or any(not (0 <= c["mean"] <= 1 and c["std"] >= 0) for c in cls):
        errs.append(f"{w}: classes must be {TOP_CLASSES} entries with mean 0-1 and std >= 0")
    clean = m.get("cleanTop1", {}).get("classId")
    if abs(m.get("matchFraction", -1) - counts.get(clean, 0) / RUNS) > 1e-9:
        errs.append(f"{w}: matchFraction does not match perRun")
    return errs
