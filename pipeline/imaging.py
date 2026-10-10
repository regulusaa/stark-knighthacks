"""Preprocessing (master plan 7.3): short side 256 (antialiased), center crop 224."""
import numpy as np
from PIL import Image, ImageOps

from . import config


def load_rgb(path):
    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im)
        return im.convert("RGB")


def center_crop(im, short=config.RESIZE_SHORT, size=config.CROP):
    w, h = im.size
    scale = short / min(w, h)
    nw, nh = (short, int(h * scale)) if w <= h else (int(w * scale), short)
    # PIL's bilinear resize widens its filter when downscaling, so this is antialiased.
    im = im.resize((nw, nh), Image.BILINEAR)
    left = int(round((nw - size) / 2.0))
    top = int(round((nh - size) / 2.0))
    return im.crop((left, top, left + size, top + size))


def model_crop(path, preprocessed=False):
    """The exact 224x224 RGB image the model sees."""
    im = load_rgb(path)
    if preprocessed:
        if im.size != (config.CROP, config.CROP):
            raise ValueError(f"{path.name}: marked preprocessed but is {im.size}, not 224x224")
        return im
    return center_crop(im)


def to_array(crop):
    """uint8 RGB crop -> float32 batch of one, still in 0-255 (preprocess_input is applied in resnet.py)."""
    return np.asarray(crop, dtype=np.float32)[None, ...]


def save_png(im, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, format="PNG", optimize=False)
