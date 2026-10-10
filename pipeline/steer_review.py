"""pipeline/review/steer_review.png: one row per steerable image, for checking the Steer data by eye.

Row: crop | top-3 before | flip (n channels zeroed -> new top-1 and score) | top-3 after the flip |
the 7x7 maps of the 5 strongest channels for top-1 (upper row) and top-2 (lower row), inferno, 64 px.
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFont

from . import config, jsonio, labels, steer_math as sm
from .review import _inferno_lut

SHEET = config.REVIEW / "steer_review.png"
CROP = 160
MAP = 64
PAD = 12
TEXT_W = 430
ROW_H = max(CROP, 2 * (MAP + 18)) + 34


def _channel_map(A, c, lut):
    m = A[:, :, c].astype(np.float32)
    peak = float(m.max())
    q = np.zeros_like(m) if peak <= 0 else m / peak
    im = Image.fromarray(q, mode="F").resize((MAP, MAP), Image.BILINEAR)
    idx = np.clip(np.round(np.asarray(im) * 255), 0, 255).astype(np.uint8)
    return Image.fromarray(lut[idx])


def make(entries, log=print):
    lut = _inferno_lut()
    font = ImageFont.load_default(size=14)
    bold = ImageFont.load_default(size=17)
    W, b = sm.load_head()
    rows = [e for e in entries if e["category"] != "medical" and (config.ASSETS / e["id"] / "steer.json").exists()]
    width = PAD + CROP + PAD + TEXT_W + 5 * (MAP + 8) + PAD
    sheet = Image.new("RGB", (width, PAD + len(rows) * ROW_H), (18, 18, 22))
    d = ImageDraw.Draw(sheet)
    name = lambda k: labels.classes()[k][2]
    for r, e in enumerate(rows):
        folder = config.ASSETS / e["id"]
        s = jsonio.read(folder / "steer.json")
        A = sm.conv5_from_bytes((folder / "conv5.bin").read_bytes())
        p = sm.pooled(A)
        before = sm.softmax(sm.logits(W, b, p))
        y = PAD + r * ROW_H
        d.text((PAD, y), f"#{e['order']}  {e['id']}   identity |err| {s['identityMaxAbsErr']:.1e}",
               fill=(255, 255, 255), font=bold)
        y += 24
        sheet.paste(Image.open(folder / "crop.png").convert("RGB").resize((CROP, CROP), Image.BILINEAR), (PAD, y))
        tx = PAD + CROP + PAD
        d.text((tx, y), "top-3 before", fill=(170, 170, 170), font=font)
        for i, k in enumerate(np.argsort(-before)[:3]):
            d.text((tx, y + 18 + i * 17), f"{i + 1}. {name(int(k))}  {before[k]:.3f}", fill=(230, 230, 230), font=font)
        f = s["flip"]
        if f:
            after = sm.softmax(sm.logits(W, b, p, sm.scale_vector([(c, 0.0) for c in f["channels"]])))
            d.text((tx, y + 76), f"flip: zero {f['n']} channel{'s' if f['n'] != 1 else ''} -> {f['toLabel']} "
                   f"({f['toScore']:.3f})", fill=(255, 210, 110), font=bold)
            d.text((tx, y + 100), "top-3 after", fill=(170, 170, 170), font=font)
            for i, k in enumerate(np.argsort(-after)[:3]):
                d.text((tx, y + 118 + i * 17), f"{i + 1}. {name(int(k))}  {after[k]:.3f}", fill=(230, 230, 230), font=font)
        else:
            d.text((tx, y + 76), "flip: none within 64 channels", fill=(255, 140, 120), font=bold)
        mx = tx + TEXT_W
        by_class = {c["classId"]: c for c in s["classes"]}
        for row, k in enumerate((s["favoring"]["for"], s["favoring"]["against"])):
            yy = y + row * (MAP + 18)
            for j, t in enumerate(by_class[k]["top"][:5]):
                x = mx + j * (MAP + 8)
                sheet.paste(_channel_map(A, t["channel"], lut), (x, yy))
                d.text((x, yy + MAP + 1), f"{'top1' if row == 0 else 'top2'} c{t['channel']}",
                       fill=(170, 170, 170), font=ImageFont.load_default(size=11))
    SHEET.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(SHEET, format="PNG")
    log(f"wrote {SHEET.relative_to(config.REPO)}")
