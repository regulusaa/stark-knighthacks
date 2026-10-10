"""Check every pipeline output against contract v1. Run alone with: python -m pipeline.validate

Pure Python (json + PIL), no TensorFlow. Stages may add checks for their own files via validate(image_dir, entry).
Exit code 1 if anything fails.
"""
import sys

from PIL import Image

from . import config, gallery, jsonio, labels, manifest
from .stages import discover

SUM_TOL = 1e-4
VAL_TOL = 1e-6
CATEGORIES = {"clean", "ambiguous", "adversarial", "medical"}


class Errors(list):
    def check(self, cond, msg):
        if not cond:
            self.append(msg)
        return cond


def _types(errs, where, obj, spec):
    """spec: {field: type or tuple of types}; None in a tuple allows null."""
    ok = errs.check(isinstance(obj, dict), f"{where}: not an object")
    if not ok:
        return False
    for k, t in spec.items():
        if not errs.check(k in obj, f"{where}: missing field '{k}'"):
            ok = False
            continue
        ts = t if isinstance(t, tuple) else (t,)
        v = obj[k]
        good = (v is None and None in ts) or any(
            t2 is not None and isinstance(v, t2) and not (t2 in (int, float) and isinstance(v, bool))
            for t2 in ts)
        if not errs.check(good, f"{where}: '{k}' has wrong type ({type(v).__name__})"):
            ok = False
    return ok


NUM = (int, float)


def validate_manifest(errs, entries):
    path = config.ASSETS / "manifest.json"
    if not errs.check(path.exists(), "manifest.json missing"):
        return []
    m = jsonio.read(path)
    errs.check(m.get("schema") == "stark.manifest/1", "manifest: bad schema tag")
    imgs = m.get("images", [])
    errs.check(isinstance(imgs, list) and imgs, "manifest: images empty")
    errs.check([i.get("order") for i in imgs] == sorted(i.get("order") for i in imgs), "manifest: not sorted by order")
    ids = [i.get("id") for i in imgs]
    errs.check(len(set(ids)) == len(ids), "manifest: duplicate ids")
    for i in imgs:
        w = f"manifest[{i.get('id')}]"
        if not _types(errs, w, i, {"id": str, "name": str, "category": str, "order": int,
                                   "trueClass": (dict, None), "folder": str, "files": dict}):
            continue
        errs.check(i["category"] in CATEGORIES, f"{w}: bad category")
        errs.check(i["folder"] == f"assets/{i['id']}/", f"{w}: folder should be assets/{i['id']}/")
        if i["trueClass"] is not None:
            _types(errs, f"{w}.trueClass", i["trueClass"], {"classId": int, "label": str})
        on_disk = manifest.files_present(config.ASSETS / i["id"])
        errs.check(i["files"] == on_disk, f"{w}: files flags {i['files']} do not match disk {on_disk}")
    return imgs


def validate_tree(errs, image_dir, image_id):
    w = f"{image_id}/tree.json"
    t = jsonio.read(image_dir / "tree.json")
    if not _types(errs, w, t, {"schema": str, "kind": str, "scoreKind": str, "model": str, "imageId": str,
                               "rootId": str, "top1": dict, "trueClass": (dict, None),
                               "otherScore": (float, int, None), "topK": list, "nodes": list}):
        return None
    errs.check(t["schema"] == "stark.tree/1", f"{w}: bad schema tag")
    errs.check(t["imageId"] == image_id, f"{w}: imageId mismatch")
    if t["kind"] != "wordnet":
        return t  # fan trees (medical) are checked by their own stage
    errs.check(t["scoreKind"] == "softmax", f"{w}: wordnet tree must be softmax")

    top_k = t["topK"]
    errs.check(1 <= len(top_k) <= config.TOP_K, f"{w}: topK has {len(top_k)} entries")
    cls = labels.classes()
    for i, e in enumerate(top_k):
        if not _types(errs, f"{w}.topK[{i}]", e, {"rank": int, "classId": int, "wnid": str, "label": str,
                                                  "score": NUM}):
            return None
        errs.check(e["rank"] == i + 1, f"{w}: topK[{i}] rank {e['rank']} should be {i + 1}")
        errs.check(0 <= e["score"] <= 1, f"{w}: topK[{i}] score out of range")
        c = cls[e["classId"]]
        errs.check(e["wnid"] == c[1] and e["label"] == c[2], f"{w}: topK[{i}] wnid/label do not match classId")
        if i:
            errs.check(e["score"] <= top_k[i - 1]["score"], f"{w}: topK not sorted by score at rank {i + 1}")
    top_ids = [e["classId"] for e in top_k]
    errs.check(len(set(top_ids)) == len(top_ids), f"{w}: duplicate classes in topK")

    top1 = t["top1"]
    errs.check(top1.get("classId") == top_k[0]["classId"] and top1.get("score") == top_k[0]["score"],
               f"{w}: top1 does not match topK[0]")

    true = t["trueClass"]
    extra = 0.0
    if true is not None and _types(errs, f"{w}.trueClass", true,
                                   {"classId": int, "label": str, "score": NUM, "rank": int}):
        if true["classId"] in top_ids:
            e = top_k[top_ids.index(true["classId"])]
            errs.check(true["rank"] == e["rank"] and true["score"] == e["score"],
                       f"{w}: trueClass rank/score disagree with topK")
        else:
            errs.check(true["rank"] > len(top_k), f"{w}: trueClass outside topK but rank {true['rank']}")
            errs.check(true["score"] <= top_k[-1]["score"], f"{w}: trueClass outside topK but outscores it")
            extra = true["score"]

    total = sum(e["score"] for e in top_k) + extra + (t["otherScore"] or 0.0)
    errs.check(abs(total - 1.0) <= SUM_TOL, f"{w}: scores sum to {total:.6f}, not 1")
    errs.check(t["otherScore"] is not None and t["otherScore"] >= -SUM_TOL, f"{w}: otherScore missing or negative")

    nodes = t["nodes"]
    by_id = {}
    for i, n in enumerate(nodes):
        if not _types(errs, f"{w}.nodes[{i}]", n, {
                "id": str, "label": str, "depth": int, "parent": (str, None), "children": list,
                "value": NUM, "isLeaf": bool, "onTop1Path": bool, "isTrueLabel": bool, "isOther": bool,
                "classId": (int, None), "rank": (int, None)}):
            return None
        errs.check(n["id"] not in by_id, f"{w}: duplicate node {n['id']}")
        by_id[n["id"]] = n
    root = nodes[0]
    errs.check(root["id"] == t["rootId"] and root["parent"] is None and root["depth"] == 0, f"{w}: bad root")
    errs.check(abs(root["value"] - 1.0) <= SUM_TOL, f"{w}: root value {root['value']} is not 1")

    # depth-first order, consistent parent/children/depth, values summed, children sorted
    expect = []

    def walk(nid):
        expect.append(nid)
        for c in by_id[nid]["children"]:
            if c in by_id:
                walk(c)
    walk(root["id"])
    errs.check(expect == [n["id"] for n in nodes], f"{w}: nodes are not in depth-first order from the root")
    leaves = {}
    for n in nodes:
        nw = f"{w}:{n['id']}"
        for c in n["children"]:
            if errs.check(c in by_id, f"{nw}: unknown child {c}"):
                errs.check(by_id[c]["parent"] == n["id"], f"{nw}: child {c} has a different parent")
                errs.check(by_id[c]["depth"] == n["depth"] + 1, f"{nw}: child {c} depth")
        errs.check(n["isLeaf"] == (not n["children"]), f"{nw}: isLeaf wrong")
        if n["children"]:
            kids = [by_id[c] for c in n["children"] if c in by_id]
            errs.check(abs(n["value"] - sum(k["value"] for k in kids)) <= VAL_TOL, f"{nw}: value != sum of children")
            errs.check(n["id"] == root["id"] or len(n["children"]) > 1, f"{nw}: single-child chain not collapsed")
            errs.check(n["classId"] is None and n["rank"] is None, f"{nw}: internal node has classId/rank")
            errs.check(not n["isTrueLabel"], f"{nw}: internal node flagged isTrueLabel")
            vals = [(-k["value"], k["label"]) for k in kids]
            errs.check(vals == sorted(vals), f"{nw}: children not ordered by value then label")
        elif n["isOther"]:
            errs.check(n["id"] == "other" and n["parent"] == root["id"], f"{nw}: other leaf misplaced")
            errs.check(n["classId"] is None and abs(n["value"] - t["otherScore"]) <= VAL_TOL, f"{nw}: other leaf")
        else:
            leaves[n["classId"]] = n
    errs.check(sum(1 for n in nodes if n["isOther"]) == 1, f"{w}: needs exactly one other leaf")

    expected_leaves = {e["classId"]: e for e in top_k}
    if true is not None and true["classId"] not in expected_leaves:
        expected_leaves[true["classId"]] = true
    errs.check(set(leaves) == set(expected_leaves), f"{w}: leaves do not match topK + true class")
    for c, n in leaves.items():
        e = expected_leaves.get(c)
        if e:
            errs.check(n["rank"] == e["rank"] and n["value"] == e["score"], f"{w}: leaf {c} rank/value mismatch")
            errs.check(n["isTrueLabel"] == (true is not None and c == true["classId"]), f"{w}: leaf {c} isTrueLabel")
    path = set()
    nid = leaves.get(top_k[0]["classId"], {}).get("id")
    while nid:
        path.add(nid)
        nid = by_id[nid]["parent"]
    errs.check({n["id"] for n in nodes if n["onTop1Path"]} == path, f"{w}: onTop1Path flags wrong")
    return t


def validate_gradcam(errs, image_dir, image_id, t):
    w = f"{image_id}/gradcam/index.json"
    p = image_dir / "gradcam" / "index.json"
    if not errs.check(p.exists(), f"{w}: missing"):
        return
    g = jsonio.read(p)
    if not _types(errs, w, g, {"schema": str, "imageId": str, "targetLayer": str, "width": int, "height": int,
                               "encoding": str, "normalization": str, "classes": list}):
        return
    errs.check(g["schema"] == "stark.gradcam/1" and g["imageId"] == image_id, f"{w}: schema/imageId")
    errs.check(g["encoding"] == "png-gray8", f"{w}: encoding")
    ids = [c.get("classId") for c in g["classes"]]
    if t is not None:
        want = [e["classId"] for e in t["topK"]]
        if t["trueClass"] is not None and t["trueClass"]["classId"] not in want:
            want.append(t["trueClass"]["classId"])
        errs.check(sorted(ids) == sorted(want), f"{w}: entries do not match topK + true class")
        if t["kind"] == "wordnet":
            explained = {c["classId"] for c in g["classes"] if c.get("hasHeatmap")}
            must = set(want[:5]) | ({t["trueClass"]["classId"]} if t["trueClass"] else set())
            errs.check(must <= explained, f"{w}: top 5 / true class missing heatmaps: {sorted(must - explained)}")
    for c in g["classes"]:
        cw = f"{w}[{c.get('classId')}]"
        if not _types(errs, cw, c, {"classId": int, "label": str, "hasHeatmap": bool,
                                    "file": (str, None), "rawMax": (float, int, None)}):
            continue
        if c["hasHeatmap"]:
            errs.check(c["file"] == f"gradcam/{c['classId']}.png", f"{cw}: file path")
            errs.check(c["rawMax"] is not None and c["rawMax"] >= 0, f"{cw}: rawMax")
            f = image_dir / c["file"]
            if errs.check(f.exists(), f"{cw}: {c['file']} missing"):
                with Image.open(f) as im:
                    errs.check(im.size == (g["width"], g["height"]) == (224, 224), f"{cw}: size {im.size}")
                    errs.check(im.mode == "L", f"{cw}: mode {im.mode}, want 8-bit grayscale")
        else:
            errs.check(c["file"] is None and c["rawMax"] is None, f"{cw}: no heatmap but file/rawMax set")
    pngs = {p.name for p in (image_dir / "gradcam").glob("*.png")}
    listed = {c["file"].split("/")[-1] for c in g["classes"] if c.get("hasHeatmap") and c.get("file")}
    errs.check(pngs == listed, f"{w}: stray or unlisted heatmaps {sorted(pngs ^ listed)}")


def validate_all(entries=None):
    errs = Errors()
    entries = entries if entries is not None else gallery.load()
    imgs = validate_manifest(errs, entries)
    by_entry = {e["id"]: e for e in entries}
    stages = discover()
    for i in imgs:
        d = config.ASSETS / i["id"]
        if errs.check((d / "crop.png").exists(), f"{i['id']}: crop.png missing"):
            with Image.open(d / "crop.png") as im:
                errs.check(im.size == (224, 224), f"{i['id']}: crop.png is {im.size}")
        t = validate_tree(errs, d, i["id"])
        validate_gradcam(errs, d, i["id"], t)
        if t is not None and i["trueClass"] is not None and t["trueClass"] is not None:
            errs.check(i["trueClass"]["classId"] == t["trueClass"]["classId"], f"{i['id']}: manifest/tree true class")
        e = by_entry.get(i["id"])
        for s in stages:
            if e is not None and hasattr(s, "validate") and s.applies(e):
                errs.extend(s.validate(d, e))
    return errs, len(imgs)


def main():
    errs, n = validate_all()
    if errs:
        print(f"validate: {len(errs)} problem(s)")
        for e in errs:
            print("  -", e)
        return 1
    print(f"validate: ok ({n} images)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
