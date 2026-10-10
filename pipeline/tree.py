"""WordNet candidate tree (master plan 7.4, contract 2.2). Pure Python: no TensorFlow.

Leaves are the top-K classes plus the true class. Each leaf's FIRST hypernym path (see first_path) is merged into one tree,
processing leaves by rank: if an ancestor is already in the tree (via a better-ranked leaf), the new path joins
it there, so every synset appears once and the top-1 path is exactly its own first hypernym path.
Then an "other" leaf is added under the root, single-child internal nodes are collapsed (root and leaves
kept), values are summed bottom-up and children are ordered by descending value, ties broken by label.
"""
from nltk.corpus import wordnet as wn

from .labels import readable

OTHER_ID = "other"
OTHER_LABEL = "other (classes not shown)"


def synset_id(s):
    return f"n{s.offset():08d}"


def synset_for(wnid):
    return wn.synset_from_pos_and_offset("n", int(wnid[1:]))


def first_path(s):
    """The first hypernym path, root -> s, made deterministic.

    NLTK's hypernyms() order comes from a set, so hypernym_paths()[0] changes with Python's hash seed
    (golfcart flips between golf_equipment and motor_vehicle from run to run). Here "first" means: at every
    step, take the parent with the lowest WordNet offset."""
    path = [s]
    while True:
        parents = s.hypernyms() + s.instance_hypernyms()
        if not parents:
            return path[::-1]
        s = min(parents, key=lambda p: p.offset())
        path.append(s)


def build(leaves, top1_class, true_class, other_score):
    """leaves: [{classId, wnid, label, score, rank}] (top-K plus the true class if outside it).
    Returns (rootId, nodes in depth-first order)."""
    nodes = {}

    def add(s, label=None):
        nid = synset_id(s)
        nodes[nid] = {"id": nid, "label": label or readable(s.lemma_names()[0]),
                      "parent": None, "children": [], "leaf": None}
        return nodes[nid]

    root_id = None
    for leaf in sorted(leaves, key=lambda l: l["rank"]):
        path = first_path(synset_for(leaf["wnid"]))
        if root_id is None:
            root_id = synset_id(path[0])
            add(path[0])
        elif synset_id(path[0]) != root_id:
            raise ValueError(f"{leaf['label']}: hypernym path does not start at {root_id}")
        if synset_id(path[-1]) in nodes:
            raise ValueError(f"{leaf['label']} ({leaf['wnid']}) is already in the tree as an ancestor or duplicate")
        child = add(path[-1], leaf["label"])
        child["leaf"] = leaf
        for s in reversed(path[:-1]):
            sid = synset_id(s)
            existed = sid in nodes
            parent = nodes[sid] if existed else add(s)
            child["parent"] = parent["id"]
            parent["children"].append(child["id"])
            if existed:
                break
            child = parent

    for n in nodes.values():
        if n["leaf"] is None and not n["children"]:
            raise AssertionError(f"internal node {n['id']} has no children")
        if n["leaf"] is not None and n["children"]:
            raise ValueError(f"class {n['label']} is also an ancestor of another displayed class")

    nodes[OTHER_ID] = {"id": OTHER_ID, "label": OTHER_LABEL, "parent": root_id, "children": [], "leaf": None,
                       "other": other_score}
    nodes[root_id]["children"].append(OTHER_ID)

    _collapse(nodes, root_id)
    _values(nodes, root_id)
    for n in nodes.values():
        n["children"].sort(key=lambda cid: (-nodes[cid]["value"], nodes[cid]["label"]))

    top1_path = set()
    nid = next(n["id"] for n in nodes.values() if n["leaf"] and n["leaf"]["classId"] == top1_class)
    while nid is not None:
        top1_path.add(nid)
        nid = nodes[nid]["parent"]

    out = []

    def dfs(nid, depth):
        n = nodes[nid]
        leaf = n["leaf"]
        is_leaf = not n["children"]
        out.append({
            "id": nid,
            "label": n["label"],
            "depth": depth,
            "parent": n["parent"],
            "children": list(n["children"]),
            "value": n["value"],
            "isLeaf": is_leaf,
            "onTop1Path": nid in top1_path,
            "isTrueLabel": bool(leaf and true_class is not None and leaf["classId"] == true_class),
            "isOther": nid == OTHER_ID,
            "classId": leaf["classId"] if leaf else None,
            "rank": leaf["rank"] if leaf else None,
        })
        for cid in n["children"]:
            dfs(cid, depth + 1)

    dfs(root_id, 0)
    return root_id, out


def _collapse(nodes, root_id):
    """Remove internal nodes (not the root) with exactly one child, joining parent straight to child."""
    stack = [root_id]
    while stack:
        nid = stack.pop()
        n = nodes[nid]
        new_children = []
        for cid in n["children"]:
            c = nodes[cid]
            while c["leaf"] is None and c["id"] != OTHER_ID and len(c["children"]) == 1:
                only = nodes[c["children"][0]]
                del nodes[c["id"]]
                c = only
            c["parent"] = nid
            new_children.append(c["id"])
            stack.append(c["id"])
        n["children"] = new_children


def _values(nodes, nid):
    n = nodes[nid]
    if n["id"] == OTHER_ID:
        n["value"] = n["other"]
    elif n["leaf"] is not None:
        n["value"] = n["leaf"]["score"]
    else:
        n["value"] = sum(_values(nodes, c) for c in n["children"])
    return n["value"]
