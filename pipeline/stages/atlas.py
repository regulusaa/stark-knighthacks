"""Activation atlas for the trunk interior (master plan section 7.6, contract 2.4-2.5): atlas.bin + atlas.json.

49 layers: conv1_relu, then _1_relu, _2_relu and _out of each of the 16 bottleneck blocks, read from the model.
One multi-output model, one forward pass per image. Per layer: the L2 norm over channels at each position, quantized
to uint8 as round(255 * value / maxRaw) (all zeros if maxRaw is 0). Once per run: layer-config.json.
"""
import numpy as np

from .. import config, imaging, jsonio, resnet, steer_math as sm

NAME = "atlas"
ORDER = 80
SOURCES = ["config.py", "gallery.py", "imaging.py", "resnet.py", "jsonio.py", "stages/atlas.py"]
BLOCKS = {"conv2": 3, "conv3": 4, "conv4": 6, "conv5": 3}
GRIDS = {"conv1": 112, "conv2": 56, "conv3": 28, "conv4": 14, "conv5": 7}
TOTAL_BYTES = 54145
LAYER_CONFIG = config.ASSETS / "layer-config.json"
ONCE_OUTPUTS = [LAYER_CONFIG]

_model = None


def applies(entry):
    return entry["category"] != "medical"


def outputs(entry):
    d = config.ASSETS / entry["id"]
    return [d / "atlas.bin", d / "atlas.json"]


def layer_specs():
    """[{name, stage, block, kind}] in network order, plus the 16 skips."""
    layers = [{"name": "conv1_relu", "stage": "conv1", "block": None, "kind": "stem"}]
    skips = []
    prev_out = "conv1_relu"  # conv2_block1's real input is pool1_pool, which is not in the atlas
    for stage, n in BLOCKS.items():
        for i in range(1, n + 1):
            block = f"{stage}_block{i}"
            layers += [{"name": f"{block}_1_relu", "stage": stage, "block": block, "kind": "conv"},
                       {"name": f"{block}_2_relu", "stage": stage, "block": block, "kind": "conv"},
                       {"name": f"{block}_out", "stage": stage, "block": block, "kind": "block-out"}]
            real_input = "pool1_pool" if block == "conv2_block1" else prev_out
            skips.append({"block": block, "fromLayer": f"{block}_1_relu", "toLayer": f"{block}_out",
                          "projection": i == 1,
                          "inputLayer": real_input, "inputInAtlas": real_input != "pool1_pool"})
            prev_out = f"{block}_out"
    return layers, skips


def _atlas_model(model):
    global _model
    if _model is None:
        layers, _ = layer_specs()
        names = {l.name for l in model.base.layers}
        missing = [l["name"] for l in layers if l["name"] not in names]
        if missing:
            raise AssertionError(f"layers not in the loaded ResNet50: {missing}")
        _model = model.keras.Model(model.base.input, [model.base.get_layer(l["name"]).output for l in layers])
    return _model


def run(ctx):
    entry = ctx.entry
    layers, skips = layer_specs()
    assert len(layers) == 49 and len(skips) == 16
    crop = imaging.model_crop(ctx.input_path, preprocessed=bool(entry.get("preprocessed")))
    model = resnet.get()
    outs = _atlas_model(model)(model.preprocess_input(imaging.to_array(crop).copy()), training=False)
    blobs, meta, offset = [], [], 0
    for idx, (spec, out) in enumerate(zip(layers, outs)):
        a = np.asarray(out)[0].astype(np.float64)             # (h, w, channels)
        h, w = a.shape[:2]
        if h != w or h != GRIDS[spec["stage"]]:
            raise AssertionError(f"{spec['name']} is {h}x{w}, expected {GRIDS[spec['stage']]}")
        norm = np.sqrt((a * a).sum(axis=-1))
        raw_max = float(norm.max())
        q = np.zeros((h, w), np.uint8) if raw_max <= 0 else np.clip(np.round(255.0 * norm / raw_max), 0, 255).astype(np.uint8)
        data = q.tobytes(order="C")                          # row-major, y down then x right
        blobs.append(data)
        meta.append({"index": idx, **spec, "width": w, "height": h, "maxRaw": raw_max,
                     "offset": offset, "length": len(data)})
        offset += len(data)
    blob = b"".join(blobs)
    if len(blob) != TOTAL_BYTES:
        raise AssertionError(f"atlas is {len(blob)} bytes, expected {TOTAL_BYTES}")
    (ctx.out_dir / "atlas.bin").write_bytes(blob)
    jsonio.write(ctx.out_dir / "atlas.json", {
        "schema": "stark.atlas/1",
        "imageId": entry["id"],
        "file": "atlas.bin",
        "dtype": "uint8",
        "order": "row-major, y down then x right, origin top-left",
        "channelReduction": "l2-norm",
        "quantization": "round(255 * value / maxRaw)",
        "totalBytes": len(blob),
        "layers": meta,
        "skips": skips,
    })
    ctx.log(f"{len(meta)} layers, {len(blob)} bytes")


def once_inputs(entries):
    return []


def run_once(entries, log):
    layers, _ = layer_specs()
    reduced = {"conv1_relu"} | {f"{s}_block{n}_out" for s, n in BLOCKS.items()}
    jsonio.write(LAYER_CONFIG, {
        "schema": "stark.layers/1",
        "layers": [{"index": i, "name": l["name"], "stage": l["stage"], "full": True, "reduced": l["name"] in reduced}
                   for i, l in enumerate(layers)],
    })
    log(f"layer-config.json: {len(layers)} layers, {len(reduced)} in the reduced trunk")


def validate(image_dir, entry):
    w = f"{entry['id']}/atlas"
    jp, bp = image_dir / "atlas.json", image_dir / "atlas.bin"
    if not jp.exists() or not bp.exists():
        return [f"{w}: atlas.json or atlas.bin missing"]
    a = jsonio.read(jp)
    blob = bp.read_bytes()
    errs = []
    if a.get("schema") != "stark.atlas/1" or a.get("imageId") != entry["id"] or a.get("totalBytes") != len(blob):
        errs.append(f"{w}: schema/imageId/totalBytes")
    if len(blob) != TOTAL_BYTES:
        errs.append(f"{w}: {len(blob)} bytes, want {TOTAL_BYTES}")
    layers, skips = layer_specs()
    got = a.get("layers", [])
    if [l.get("name") for l in got] != [l["name"] for l in layers]:
        errs.append(f"{w}: layer names/order")
        return errs
    offset = 0
    for l in got:
        if l["offset"] != offset or l["length"] != l["width"] * l["height"] or l["width"] != GRIDS[l["stage"]]:
            errs.append(f"{w}: {l['name']} offset/length/size")
        if l["maxRaw"] < 0:
            errs.append(f"{w}: {l['name']} maxRaw < 0")
        chunk = blob[l["offset"]:l["offset"] + l["length"]]
        if l["maxRaw"] > 0 and max(chunk) != 255:
            errs.append(f"{w}: {l['name']} peak is not 255")
        offset += l["length"]
    if [(s["block"], s["fromLayer"], s["toLayer"], s["projection"]) for s in a.get("skips", [])] != \
            [(s["block"], s["fromLayer"], s["toLayer"], s["projection"]) for s in skips]:
        errs.append(f"{w}: skips")
    # the last layer is conv5_block3_out, the Steer layer: its L2 map must match conv5.bin
    c5 = image_dir / "conv5.bin"
    if c5.exists():
        last = got[-1]
        A = sm.conv5_from_bytes(c5.read_bytes())
        norm = np.sqrt((A * A).sum(axis=-1))
        q = np.round(255.0 * norm / norm.max()).astype(np.uint8)
        stored = np.frombuffer(blob[last["offset"]:last["offset"] + last["length"]], np.uint8).reshape(7, 7)
        if np.max(np.abs(q.astype(int) - stored.astype(int))) > 1 or abs(norm.max() - last["maxRaw"]) > 1e-3 * norm.max():
            errs.append(f"{w}: conv5_block3_out does not match conv5.bin")
    return errs
