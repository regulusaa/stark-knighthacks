"""Skip-if-unchanged bookkeeping. One stamp per (image, stage) in pipeline/.cache/stamps.json.

A stamp hashes everything that can change a stage's output: its code (the source files it lists), the input
image bytes, the gallery entry, the cached weights file and the library versions. TensorFlow is never imported
here (versions come from package metadata), so a no-op run stays fast.
"""
import hashlib
import json
from importlib import metadata

from . import config, gallery

STAMPS = config.CACHE / "stamps.json"
LIBS = ("tensorflow", "keras", "numpy", "pillow", "nltk", "torch", "torchxrayvision", "grad-cam", "scikit-image")


def _lib_versions():
    out = {}
    for lib in LIBS:
        try:
            out[lib] = metadata.version(lib)
        except metadata.PackageNotFoundError:
            out[lib] = None
    return out


_LIBS = None


def key(stage, entry, input_path):
    global _LIBS
    if _LIBS is None:
        _LIBS = _lib_versions()
    h = hashlib.sha256()
    h.update(stage.NAME.encode())
    for src in sorted(stage.SOURCES):
        h.update(src.encode())
        h.update((config.PIPELINE / src).read_bytes())
    h.update(input_path.read_bytes() if input_path and input_path.exists() else b"<no input>")
    h.update(json.dumps(gallery.public_entry(entry), sort_keys=True).encode())
    w = config.RESNET_WEIGHTS
    h.update(str(w.stat().st_size if w.exists() else -1).encode())
    h.update(json.dumps(_LIBS, sort_keys=True).encode())
    return h.hexdigest()


def once_key(stage, input_paths):
    """Stamp for a stage's run_once step: its code plus the bytes of every per-image file it reads."""
    global _LIBS
    if _LIBS is None:
        _LIBS = _lib_versions()
    h = hashlib.sha256()
    h.update(f"{stage.NAME}:once".encode())
    for src in sorted(stage.SOURCES):
        h.update(src.encode())
        h.update((config.PIPELINE / src).read_bytes())
    for p in sorted(input_paths):
        h.update(str(p.relative_to(config.REPO)).encode())
        h.update(p.read_bytes() if p.exists() else b"<missing>")
    w = config.RESNET_WEIGHTS
    h.update(str(w.stat().st_size if w.exists() else -1).encode())
    h.update(json.dumps(_LIBS, sort_keys=True).encode())
    return h.hexdigest()


def load():
    try:
        return json.loads(STAMPS.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def save(stamps):
    STAMPS.parent.mkdir(parents=True, exist_ok=True)
    tmp = STAMPS.with_suffix(".tmp")
    tmp.write_text(json.dumps(stamps, indent=2, sort_keys=True))
    tmp.replace(STAMPS)
