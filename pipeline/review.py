"""pipeline/review/review_sheet.png: one row per image for checking every demo claim by eye.

Row: crop | top-1 Grad-CAM | true-class Grad-CAM (inferno, 50% blend) | top 5, true rank, correct?, flags.
Also prints the top-1 margin and entropy, a single-pass hint for which ambiguous image is less stable
(the real stability test is the TTA stage).
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import config, jsonio

TILE = 224
PAD = 12
TEXT_W = 560
HEADER = 40
SHEET = config.REVIEW / "review_sheet.png"


def _inferno_lut():
    import matplotlib
    return (matplotlib.colormaps["inferno"](np.linspace(0, 1, 256))[:, :3] * 255).astype(np.uint8)


def _blend(crop, heat_path, lut):
    heat = np.asarray(Image.open(heat_path).convert("L"))
    color = lut[heat].astype(np.float32)
    base = np.asarray(crop.convert("RGB"), dtype=np.float32)
    return Image.fromarray(np.round(0.5 * base + 0.5 * color).astype(np.uint8))


def _placeholder(text, font):
    im = Image.new("RGB", (TILE, TILE), (40, 40, 40))
    ImageDraw.Draw(im).text((10, TILE // 2 - 10), text, fill=(200, 200, 200), font=font)
    return im


def row_stats(t):
    """Top-1 margin over #2 and entropy (nats) of the shown scores + other."""
    k = t["topK"]
    margin = k[0]["score"] - (k[1]["score"] if len(k) > 1 else 0.0)
    ps = [e["score"] for e in k] + [max(t["otherScore"] or 0.0, 0.0)]
    ent = -sum(p * math.log(p) for p in ps if p > 0)
    return margin, ent


def make(manifest_images):
    lut = _inferno_lut()
    font = ImageFont.load_default(size=15)
    bold = ImageFont.load_default(size=18)
    rows = [i for i in manifest_images if (config.ASSETS / i["id"] / "tree.json").exists()]
    w = PAD + 3 * (TILE + PAD) + TEXT_W
    h = HEADER + len(rows) * (TILE + PAD + 22) + PAD
    sheet = Image.new("RGB", (w, h), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    for x, label in ((PAD, "crop (model input)"), (PAD + TILE + PAD, "top-1 Grad-CAM"),
                     (PAD + 2 * (TILE + PAD), "true-class Grad-CAM")):
        d.text((x, 12), label, fill=(170, 170, 170), font=font)

    summary = []
    for r, img in enumerate(rows):
        folder = config.ASSETS / img["id"]
        t = jsonio.read(folder / "tree.json")
        g = jsonio.read(folder / "gradcam" / "index.json")
        heat = {c["classId"]: c for c in g["classes"]}
        crop = Image.open(folder / "crop.png").convert("RGB")
        y = HEADER + r * (TILE + PAD + 22)
        top1 = t["top1"]
        true = t["trueClass"]
        correct = true is not None and true["classId"] == top1["classId"]

        d.text((PAD, y), f"#{img['order']}  {img['id']}  ({img['name']})", fill=(255, 255, 255), font=bold)
        y += 22
        sheet.paste(crop, (PAD, y))
        flags = []
        for col, cid, what in ((1, top1["classId"], "top-1"), (2, true["classId"] if true else None, "true")):
            x = PAD + col * (TILE + PAD)
            entry = heat.get(cid)
            if entry and entry["hasHeatmap"]:
                sheet.paste(_blend(crop, folder / entry["file"], lut), (x, y))
                if entry["rawMax"] == 0:
                    flags.append(f"{what} heatmap is blank (rawMax 0)")
            else:
                sheet.paste(_placeholder("no heatmap" if cid is not None else "no true class", font), (x, y))
                if cid is not None:
                    flags.append(f"{what} has no heatmap")

        tx = PAD + 3 * (TILE + PAD)
        verdict, vcol = ("CORRECT", (120, 230, 140)) if correct else ("WRONG", (255, 110, 110))
        d.text((tx, y), f"top-1: {top1['label']}  {top1['score']:.3f}", fill=(255, 220, 120), font=bold)
        d.text((tx + 440, y), verdict, fill=vcol, font=bold)
        for i, e in enumerate(t["topK"][:5]):
            mark = " *" if true and e["classId"] == true["classId"] else ""
            hm = "" if heat.get(e["classId"], {}).get("hasHeatmap") else "  (no heatmap)"
            d.text((tx, y + 28 + i * 20), f"{e['rank']}. {e['label']}  {e['score']:.4f}{mark}{hm}",
                   fill=(220, 220, 220), font=font)
        if true:
            d.text((tx, y + 134), f"true: {true['label']}  rank {true['rank']}  score {true['score']:.4f}",
                   fill=(170, 230, 255), font=font)
            if true["rank"] > config.TOP_K:
                flags.append("true class outside top 25 (added as an extra leaf)")
        margin, ent = row_stats(t)
        n_heat = sum(1 for c in g["classes"] if c["hasHeatmap"])
        other = "n/a (independent scores)" if t["otherScore"] is None else f"{t['otherScore']:.4f}"
        d.text((tx, y + 156), f"margin #1-#2 {margin:.3f}   entropy {ent:.2f}   other {other}",
               fill=(170, 170, 170), font=font)
        d.text((tx, y + 176), f"{len(t['nodes'])} tree nodes   {n_heat} heatmaps", fill=(170, 170, 170), font=font)
        if flags:
            d.text((tx, y + 198), "FLAG: " + "; ".join(flags), fill=(255, 150, 80), font=font)
        summary.append({"id": img["id"], "top1": top1, "trueRank": true["rank"] if true else None,
                        "nodes": len(t["nodes"]), "heatmaps": n_heat, "correct": correct,
                        "margin": margin, "entropy": ent, "flags": flags})

    SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(SHEET, format="PNG")
    return summary
