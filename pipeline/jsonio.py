"""Deterministic JSON writing (stable key order, unrounded floats, trailing newline)."""
import json


def dumps(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def write(path, obj):
    """Write only if the content changed. Returns True if the file was (re)written."""
    text = dumps(obj)
    if path.exists() and path.read_text() == text:
        return False
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    return True


def read(path):
    return json.loads(path.read_text())
