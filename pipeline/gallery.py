"""Gallery entries from pipeline/gallery.json, with input files resolved by stem.

Entry keys used by the core stage:
  id, name, category, order, trueLabel (ImageNet label, or null)
  file / backup     stems in pipeline/inputs/ (any extension in config.IMAGE_EXTS)
  useBackup         true to always use the backup file
  generated         instead of file: a path under pipeline/.cache/ written by an earlier stage (e.g. FGSM)
  preprocessed      true if the input is already the exact 224x224 model crop (skip resize/crop)
  gradcam           "all" to explain every top-K tip; default is top 5 + true class
Later stages may add their own keys; unknown keys are ignored here.
"""
import json

from . import config


def load(use_backup=()):
    data = json.loads(config.GALLERY_JSON.read_text())
    entries = sorted(data["images"], key=lambda e: e["order"])
    ids = [e["id"] for e in entries]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate image ids in gallery.json")
    orders = [e["order"] for e in entries]
    if len(set(orders)) != len(orders):
        raise ValueError("duplicate order values in gallery.json")
    unknown = set(use_backup) - set(ids)
    if unknown:
        raise ValueError(f"--use-backup: unknown image id(s): {', '.join(sorted(unknown))}")
    for e in entries:
        e["_useBackup"] = bool(e.get("useBackup")) or e["id"] in use_backup
    return entries


def find_stem(stem):
    hits = sorted(p for p in config.INPUTS.iterdir()
                  if p.stem == stem and p.suffix.lower() in config.IMAGE_EXTS)
    if not hits:
        raise FileNotFoundError(f'no input file named "{stem}.*" in {config.INPUTS}')
    if len(hits) > 1:
        raise ValueError(f'several input files share the stem "{stem}": ' + ", ".join(p.name for p in hits))
    return hits[0]


def input_path(entry):
    if entry.get("generated"):
        return config.CACHE / entry["generated"]
    if entry["_useBackup"]:
        if not entry.get("backup"):
            raise ValueError(f'{entry["id"]}: --use-backup given but the entry has no backup file')
        return find_stem(entry["backup"])
    return find_stem(entry["file"])


def public_entry(entry):
    """The entry as written into stamps (no private runtime keys)."""
    return {k: v for k, v in entry.items() if not k.startswith("_")}
