"""ImageNet class index: classId <-> wnid <-> readable label, read from the cached Keras file."""
import json
from functools import lru_cache

from . import config


def readable(raw_label):
    return raw_label.replace("_", " ")


@lru_cache(maxsize=1)
def classes():
    """List of (classId, wnid, readable label), indexed by classId."""
    raw = json.loads(config.IMAGENET_INDEX.read_text())
    out = [None] * len(raw)
    for k, (wnid, label) in raw.items():
        out[int(k)] = (int(k), wnid, readable(label))
    return out


def lookup(label):
    """Resolve a label like "golden retriever" to (classId, wnid, label). Case- and underscore-insensitive."""
    key = readable(label).strip().lower()
    hits = [c for c in classes() if c[2].lower() == key]
    if not hits:
        raise ValueError(f'label "{label}" is not an ImageNet class in {config.IMAGENET_INDEX.name}')
    if len(hits) > 1:
        raise ValueError(f'label "{label}" is ambiguous: ' + ", ".join(f"{c[0]} ({c[1]})" for c in hits))
    return hits[0]
