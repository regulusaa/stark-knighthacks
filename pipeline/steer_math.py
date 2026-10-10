"""Steer maths (contract v2 section 2.9), pure numpy. Shared by the steer stage and the validator.

After conv5_block3_out, ResNet50 does only global average pooling and one dense layer, so for channel scales s:
    logits'[k] = b[k] + sum_c W[c][k] * s_c * p_c          p_c = mean of channel c over the 7x7 grid
    cam'_k     = ReLU( sum_c W[c][k] * s_c * A[i][j][c] )   (Grad-CAM at that layer, up to the factor 1/49)
Everything here is float64.
"""
from functools import lru_cache

import numpy as np

from . import config

CHANNELS, CLASSES, GRID = 2048, 1000, 7
HEAD_BYTES = (CHANNELS * CLASSES + CLASSES) * 4     # 8,196,000
CONV5_BYTES = GRID * GRID * CHANNELS * 4             # 401,408
HEAD_BIN = config.ASSETS / "steer" / "head.bin"
FLIP_MAX = 64


def head_to_bytes(W, b):
    """W (2048, 1000) and b (1000) -> head.bin bytes: float32 LE, W[c][k] row-major, then b."""
    W = np.ascontiguousarray(W, dtype="<f4")
    b = np.ascontiguousarray(b, dtype="<f4")
    assert W.shape == (CHANNELS, CLASSES) and b.shape == (CLASSES,)
    data = W.tobytes(order="C") + b.tobytes()
    assert len(data) == HEAD_BYTES, len(data)
    return data


def head_from_bytes(data):
    if len(data) != HEAD_BYTES:
        raise ValueError(f"head.bin is {len(data)} bytes, want {HEAD_BYTES}")
    a = np.frombuffer(data, dtype="<f4")
    return a[:CHANNELS * CLASSES].reshape(CHANNELS, CLASSES).astype(np.float64), a[CHANNELS * CLASSES:].astype(np.float64)


@lru_cache(maxsize=1)
def load_head(path=HEAD_BIN):
    return head_from_bytes(path.read_bytes())


def conv5_to_bytes(A):
    """A (7, 7, 2048) -> conv5.bin bytes: float32 LE, HWC row-major, index (i*7+j)*2048+c."""
    A = np.ascontiguousarray(A, dtype="<f4")
    assert A.shape == (GRID, GRID, CHANNELS)
    data = A.tobytes(order="C")
    assert len(data) == CONV5_BYTES, len(data)
    return data


def conv5_from_bytes(data):
    if len(data) != CONV5_BYTES:
        raise ValueError(f"conv5.bin is {len(data)} bytes, want {CONV5_BYTES}")
    return np.frombuffer(data, dtype="<f4").reshape(GRID, GRID, CHANNELS).astype(np.float64)


def pooled(A):
    return np.asarray(A, np.float64).mean(axis=(0, 1))


def logits(W, b, p, scales=None):
    s = np.ones(CHANNELS) if scales is None else scales
    return b + (s * p) @ W


def scale_vector(pairs):
    """[(channel, scale)] -> full 2048 vector of scales (1 elsewhere)."""
    s = np.ones(CHANNELS)
    for c, v in pairs:
        s[int(c)] = float(v)
    return s


def softmax(z):
    z = np.asarray(z, np.float64)
    e = np.exp(z - z.max())
    return e / e.sum()


def contributions(W, p, k):
    """W[c][k] * p_c for every channel c."""
    return W[:, k] * p


def margins(W, p, k_for, k_against):
    return (W[:, k_for] - W[:, k_against]) * p


def flip(W, b, p, k_for, k_against, max_n=FLIP_MAX):
    """Zero channels in descending margin order; the first n whose zeroing changes the global top-1 (over all
    1000 classes). -> dict or None if n > max_n."""
    order = np.argsort(-margins(W, p, k_for, k_against), kind="stable")
    z = logits(W, b, p)
    base = int(np.argmax(z))
    for n in range(1, max_n + 1):
        c = int(order[n - 1])
        z = z - W[c] * p[c]
        top = int(np.argmax(z))
        if top != base:
            return {"from": base, "to": top, "n": n, "channels": [int(x) for x in order[:n]],
                    "toScore": float(softmax(z)[top]), "logits": z}
    return None


def cam(A, W, k, scales=None):
    """Closed-form CAM for class k: ReLU(sum_c W[c][k] * s_c * A[i][j][c]), 7x7."""
    s = np.ones(CHANNELS) if scales is None else scales
    return np.maximum(np.asarray(A, np.float64) @ (W[:, k] * s), 0.0)
