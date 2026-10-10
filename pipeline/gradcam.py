"""Grad-CAM (master plan 7.5) on conv5_block3_out, from the logits.

cam_c = ReLU( sum_k alpha_k * A_k ), alpha_k = spatial mean of d logit_c / d A_k.
rawMax is the max of the 7x7 cam before normalization. The map is bilinearly upsampled to 224x224 and
scaled to 0-255 per heatmap (brightest pixel = 255), so brightness is not comparable across classes (the contract says so too).
"""
import numpy as np
from PIL import Image

from . import config

NORMALIZATION = "per-heatmap: relu(cam) / max(cam) * 255"


def compute(model, feats, class_ids):
    """-> {classId: (cam7x7 float64, alpha float64[2048])}"""
    grads = model.logit_grads(feats, class_ids)          # (n, 7, 7, 2048)
    alphas = grads.mean(axis=(1, 2)).astype(np.float64)  # (n, 2048)
    a = feats[0].astype(np.float64)                      # (7, 7, 2048)
    out = {}
    for i, c in enumerate(class_ids):
        cam = np.maximum(a @ alphas[i], 0.0)
        out[c] = (cam, alphas[i])
    _check_gap_identity(model, feats, class_ids, alphas)
    return out


def _check_gap_identity(model, feats, class_ids, alphas):
    """ResNet50 ends in global average pooling + one dense layer, so the Grad-CAM channel weights must equal
    the dense weights / (H*W). If this fails, the gradients are wrong."""
    hw = feats.shape[1] * feats.shape[2]
    expected = model.dense_kernel[:, list(class_ids)].T.astype(np.float64) / hw
    if not np.allclose(alphas, expected, rtol=1e-3, atol=1e-7):
        raise AssertionError("Grad-CAM weights do not match dense_kernel / (H*W)")


def to_png(cam7):
    """7x7 cam -> (224x224 uint8 PIL image, rawMax)."""
    raw_max = float(cam7.max())
    up = Image.fromarray(cam7.astype(np.float32), mode="F").resize((config.CROP, config.CROP), Image.BILINEAR)
    up = np.maximum(np.asarray(up, dtype=np.float64), 0.0)
    peak = float(up.max())  # bilinear never quite reaches the 7x7 peak; scale so the brightest pixel is 255
    if raw_max > 0 and peak > 0:
        q = np.clip(np.round(up / peak * 255.0), 0, 255).astype(np.uint8)
    else:
        q = np.zeros((config.CROP, config.CROP), np.uint8)  # no positive evidence: an honest blank map
    return Image.fromarray(q, mode="L"), raw_max
