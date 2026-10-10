"""FGSM adversarial image (master plan section 9, contract 2.7), for entries with "fgsmFrom": <source image id>.

Untargeted FGSM on the source's 224x224 model crop in 0-255 pixel space; the gradient flows through Keras
preprocess_input inside the tape (the preprocessed tensor is never perturbed). Epsilon steps 1, 2, ... 8 pixel
levels; each candidate is rounded to uint8, written as PNG, read back and classified again, and the first epsilon
whose SAVED PNG still changes the top-1 wins. Writes the adversarial crop to pipeline/.cache/<generated> (the input of
this entry's core/steer/atlas stages), plus fgsm.json and noise_x50.png in the entry's asset folder.
"""
import io

import numpy as np
from PIL import Image

from .. import config, gallery, imaging, jsonio, labels, resnet, steer_math as sm

NAME = "fgsm"
ORDER = 10  # before core: it creates this entry's input
SOURCES = ["config.py", "labels.py", "gallery.py", "imaging.py", "resnet.py", "jsonio.py", "stages/fgsm.py"]
EPSILONS = range(1, 9)


def applies(entry):
    return bool(entry.get("fgsmFrom"))


def _source(entry):
    src = next((e for e in gallery.load() if e["id"] == entry["fgsmFrom"]), None)
    if src is None:
        raise ValueError(f"{entry['id']}: fgsmFrom {entry['fgsmFrom']} is not in gallery.json")
    return src


def input_path(entry):
    """The stage's real input (for its stamp): the source image, not the generated file it writes."""
    return gallery.input_path(_source(entry))


def outputs(entry):
    d = config.ASSETS / entry["id"]
    return [config.CACHE / entry["generated"], d / "fgsm.json", d / "noise_x50.png"]


def _png_roundtrip(arr_uint8):
    buf = io.BytesIO()
    Image.fromarray(arr_uint8, mode="RGB").save(buf, format="PNG")
    buf.seek(0)
    with Image.open(buf) as im:
        return np.asarray(im.convert("RGB"), dtype=np.uint8)


def run(ctx):
    entry = ctx.entry
    src = _source(entry)
    crop = imaging.model_crop(gallery.input_path(src), preprocessed=bool(src.get("preprocessed")))
    x0 = np.asarray(crop, dtype=np.uint8)
    model = resnet.get()
    tf = model.tf
    name = lambda k: labels.classes()[int(k)][2]

    x = tf.convert_to_tensor(x0.astype(np.float32)[None])
    with tf.GradientTape() as tape:
        tape.watch(x)
        z = model.logits_from_pixels(x)
        clean_top = int(tf.argmax(z[0]))
        loss = tf.keras.losses.sparse_categorical_crossentropy(tf.constant([clean_top]), z, from_logits=True)
    grad = tape.gradient(loss, x)
    if grad is None:
        raise AssertionError("no gradient reached the pixels (preprocess_input must be inside the tape)")
    sign = np.sign(grad.numpy()[0]).astype(np.float32)
    clean_scores = sm.softmax(z.numpy()[0])

    def classify(arr_uint8):
        _, lg = model.forward(arr_uint8.astype(np.float32)[None])
        return sm.softmax(lg[0])

    tried, found = [], None
    for eps in EPSILONS:
        tried.append(eps)
        adv = np.clip(np.round(x0.astype(np.float32) + eps * sign), 0, 255).astype(np.uint8)
        s = classify(_png_roundtrip(adv))   # what counts is the image as saved and read back
        if int(np.argmax(s)) != clean_top:
            found = (eps, adv)
            break
    if found is None:
        raise AssertionError(f"FGSM: no epsilon up to {max(EPSILONS)}/255 flips {name(clean_top)} after PNG rounding")
    eps, adv = found

    out_png = config.CACHE / entry["generated"]
    out_png.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(adv, mode="RGB").save(out_png, format="PNG", optimize=False)
    with Image.open(out_png) as im:                    # reload the file actually written, and classify that
        reloaded = np.asarray(im.convert("RGB"), dtype=np.uint8)
    assert np.array_equal(reloaded, adv)
    adv_scores = classify(reloaded)
    adv_top = int(np.argmax(adv_scores))
    assert adv_top != clean_top

    diff = reloaded.astype(np.int16) - x0.astype(np.int16)
    mse = float(np.mean(diff.astype(np.float64) ** 2))
    psnr = float(10 * np.log10(255.0 ** 2 / mse)) if mse > 0 else None
    noise = np.clip(diff.astype(np.float64) * 50 + 128, 0, 255).round().astype(np.uint8)
    imaging.save_png(Image.fromarray(noise, mode="RGB"), ctx.out_dir / "noise_x50.png")

    true_id = labels.lookup(src["trueLabel"])[0] if src.get("trueLabel") else clean_top
    jsonio.write(ctx.out_dir / "fgsm.json", {
        "schema": "stark.fgsm/1",
        "sourceImageId": src["id"],
        "adversarialImageId": entry["id"],
        "epsilon": eps / 255.0,
        "epsilon255": eps,
        "epsilonsTried255": tried,
        "pixelSpace": "[0,1] RGB before Keras preprocessing",
        "method": "untargeted FGSM: x + epsilon * sign(grad of cross-entropy vs the clean top-1), gradient through "
                  "preprocess_input; the saved uint8 PNG is what was reclassified",
        "original": {"classId": clean_top, "label": name(clean_top), "score": float(clean_scores[clean_top])},
        "adversarial": {"classId": adv_top, "label": name(adv_top), "score": float(adv_scores[adv_top])},
        "trueClass": {"classId": true_id, "label": name(true_id), "adversarialScore": float(adv_scores[true_id])},
        "maxPixelChange": int(np.max(np.abs(diff))),
        "meanAbsChange": float(np.mean(np.abs(diff))),
        "psnr": psnr,
        "noiseFile": "noise_x50.png",
    })
    ctx.log(f"epsilon {eps}/255: {name(clean_top)} ({clean_scores[clean_top]:.3f}) -> {name(adv_top)} "
            f"({adv_scores[adv_top]:.3f}); true-class score {adv_scores[true_id]:.3f}; PSNR {psnr:.1f} dB")


def validate(image_dir, entry):
    w = f"{entry['id']}/fgsm.json"
    p = image_dir / "fgsm.json"
    if not p.exists():
        return [f"{w}: missing"]
    f = jsonio.read(p)
    errs = []
    if f.get("schema") != "stark.fgsm/1" or f.get("adversarialImageId") != entry["id"] \
            or f.get("sourceImageId") != entry["fgsmFrom"]:
        errs.append(f"{w}: schema/ids")
    if f.get("epsilonsTried255", [None])[-1] != f.get("epsilon255") or abs(f["epsilon"] * 255 - f["epsilon255"]) > 1e-9:
        errs.append(f"{w}: epsilon fields disagree")
    if f["original"]["classId"] == f["adversarial"]["classId"]:
        errs.append(f"{w}: top-1 did not change")
    t = jsonio.read(image_dir / "tree.json") if (image_dir / "tree.json").exists() else None
    if t is not None:
        if t["top1"]["classId"] != f["adversarial"]["classId"] or abs(t["top1"]["score"] - f["adversarial"]["score"]) > 1e-4:
            errs.append(f"{w}: adversarial top-1 does not match {entry['id']}/tree.json")
    if f.get("noiseFile") and not (image_dir / f["noiseFile"]).exists():
        errs.append(f"{w}: {f['noiseFile']} missing")
    if not (0 < f.get("maxPixelChange", 0) <= f["epsilon255"]):
        errs.append(f"{w}: maxPixelChange should be 1..epsilon255")
    return errs
