"""manifest.json (contract 2.1), built from gallery.json plus what actually exists on disk.

The files flags are derived from the folder contents, so stages added later (atlas, stability, fgsm, medical)
show up without changes here. An entry whose tree.json is missing is left out with a warning.
"""
from . import config, jsonio, labels

FILES = {
    "crop": ["crop.png"],
    "tree": ["tree.json"],
    "gradcam": ["gradcam/index.json"],
    "atlas": ["atlas.json", "atlas.bin"],
    "stability": ["mc.json"],
    "fgsm": ["fgsm.json"],
    "medical": ["medical.json"],
}


def files_present(image_dir):
    return {k: all((image_dir / f).exists() for f in fs) for k, fs in FILES.items()}


def build(entries, warn=print):
    images = []
    for e in entries:
        d = config.ASSETS / e["id"]
        if not (d / "tree.json").exists():
            warn(f"manifest: {e['id']} has no tree.json yet; left out")
            continue
        t = jsonio.read(d / "tree.json").get("trueClass")
        if t is not None:
            true_class = {"classId": t["classId"], "label": t["label"]}
        elif e.get("trueLabel") and e["category"] != "medical":
            c = labels.lookup(e["trueLabel"])
            true_class = {"classId": c[0], "label": c[2]}
        else:
            true_class = None
        images.append({
            "id": e["id"],
            "name": e["name"],
            "category": e["category"],
            "order": e["order"],
            "trueClass": true_class,
            "folder": f"{config.ASSETS_URL_PREFIX}{e['id']}/",
            "files": files_present(d),
        })
    known = {e["id"] for e in entries}
    if config.ASSETS.exists():
        for d in sorted(config.ASSETS.iterdir()):
            if d.is_dir() and d.name not in known:
                warn(f"manifest: assets/{d.name}/ is not in gallery.json; ignored")
    return {"schema": "stark.manifest/1", "images": images}


def write(entries, warn=print):
    return jsonio.write(config.ASSETS / "manifest.json", build(entries, warn))
