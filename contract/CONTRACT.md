# Stark contract v2

**Status: v2.** v2 is Ray's CONTRACT CHANGE v2, which moves Steer onto the display. Claude Code applied it in CC-6 Part A as a one-time exception to the ownership rule; the v2 changes are marked **(v2)**. It replaces master plan section 9.1 (the live-inference service) and `/pipeline/live`, neither of which will exist. This file is authoritative. `contract.js` mirrors it, and `fixtures/` holds one valid example of every shape. If they ever disagree, this file wins. Fix the other two instead.

Owner: Ray. Agents read this file but never edit it. A proposed change goes to Ray, and Ray sends it to both agents in the same message.

Examples are JSONC: `//` comments explain fields and are **not** part of the real files. All scores are **model scores** (master plan section 27). Never call them a "probability correct" or a "chance it is right".

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Class IDs | `classId` is an integer. ImageNet images: index 0–999 from `imagenet_class_index.json`. Medical images: index 0–17 in the torchxrayvision `densenet121-res224-all` pathology list. |
| Scores | Floats in 0–1, unrounded (renderers round for display). `scoreKind` says how to read them: `softmax` (the 1,000 ImageNet scores sum to 1) or `independent` (medical: per-finding scores, not mutually exclusive, not required to sum to 1). |
| Ranks | 1-based, by descending score. |
| Paths | Asset paths in JSON are relative to the image folder (for example `gradcam/207.png`). Folders in the manifest are relative to the site root (for example `assets/clean_retriever/`). |
| Schema tag | Every pipeline file has `"schema": "stark.<kind>/<n>"`. Readers reject an unknown major version. |
| Image IDs | `snake_case`, the same as the gallery file stem: `clean_retriever`, `adv_retriever`, `ambig_husky`, `med_xray_pneumonia`, and so on. |

## 2. Pipeline output files

Everything lives under `web/public/assets/`, which is served at `/assets/`.

```
assets/
  manifest.json
  layer-config.json
  <imageId>/
    crop.png              224×224 RGB: the exact model input crop (X-rays: the exact model input, as grayscale)
    tree.json
    gradcam/index.json
    gradcam/<classId>.png 224×224 8-bit grayscale, one per explained class
    atlas.json + atlas.bin  ResNet50 images only
    conv5.bin + steer.json  ResNet50 images only (v2, section 2.9)
    mc.json                 stability (TTA) images only
    fgsm.json               adv_retriever only (plus noise_x50.png)
    medical.json            medical images only
  steer/                    (v2, section 2.9)
    head.bin + head.json    ResNet50's dense layer
    reference.json          expected outputs from the real Keras layers, for testing the display's maths
```

### 2.1 `manifest.json`: the gallery (fixture: `manifest.json`)

```jsonc
{
  "schema": "stark.manifest/1",
  "images": [                                  // sorted by "order"
    {
      "id": "clean_retriever",
      "name": "Golden retriever",              // display name, shown on the HUD and the host picker
      "category": "clean",                     // clean | ambiguous | adversarial | medical
      "order": 1,                              // 1-based host gallery order (master plan 17.2); also the display number key
      "trueClass": { "classId": 207, "label": "golden retriever" },  // null if there is none (a normal X-ray)
      "folder": "assets/clean_retriever/",
      "files": {                               // which optional files exist; capabilities are derived from these
        "crop": true, "tree": true, "gradcam": true,
        "atlas": true, "stability": true, "fgsm": false, "medical": false
      },
      "steerable": true                        // (v2) true for ResNet50 images (conv5.bin + steer.json written), false for medical
    }
  ]
}
```

### 2.2 `tree.json`: candidate tree (fixtures: `tree.json`, `tree.medical.json`)

```jsonc
{
  "schema": "stark.tree/1",
  "kind": "wordnet",                 // wordnet (ImageNet hierarchy) | fan (medical: one level, one leaf per finding)
  "scoreKind": "softmax",            // softmax | independent
  "model": "resnet50-imagenet-keras",
  "imageId": "clean_retriever",
  "rootId": "n00001740",             // "entity"; for a fan: "root"
  "top1": { "classId": 207, "label": "golden retriever", "score": 0.62 },
  "trueClass": { "classId": 207, "label": "golden retriever", "score": 0.62, "rank": 1 },  // null if there is none; rank can be > 25 (then the leaf is still added)
  "otherScore": 0.155,               // softmax mass outside topK (an "other" leaf holds it); null for fans
  "topK": [                          // ≤ 25 entries (DEFAULTS.TOP_K); a fan lists all 18 findings
    { "rank": 1, "classId": 207, "wnid": "n02099601", "label": "golden retriever", "score": 0.62 }
    // wnid is null for medical findings
  ],
  "nodes": [                         // depth-first, root first; children in that same order (layout uses it)
    {
      "id": "n02099601",             // WordNet ID; "other" for the remainder leaf; "root"/"f<classId>" in a fan
      "label": "golden retriever",
      "depth": 4,                    // edges from the root AFTER single-child chains are collapsed
      "parent": "n02099029",         // null for the root
      "children": [],
      "value": 0.62,                 // sum of leaf scores beneath (a leaf: its own score). Fan root: null; fan leaf: its independent score
      "isLeaf": true,
      "onTop1Path": true,            // root → top-1 leaf, inclusive
      "isTrueLabel": true,           // the ring goes here (leaves only)
      "isOther": false,
      "classId": 207,                // leaves only, otherwise null ("other" leaf: null)
      "rank": 1                      // leaves only, otherwise null
    }
  ]
}
```

Rules: the first WordNet hypernym path is used. Single-child internal nodes are collapsed, but the root and all leaves are kept. On a `wordnet` tree, `value` of the root equals 1.0 (to float precision) when the "other" leaf is present.

### 2.3 `gradcam/index.json`: heatmap availability (fixture: `gradcam-index.json`)

Every class in `topK`, plus the true class, gets an entry. **`hasHeatmap` is explicit for each one.** A renderer must never draw a heatmap for an entry where it is false.

```jsonc
{
  "schema": "stark.gradcam/1",
  "imageId": "clean_retriever",
  "targetLayer": "conv5_block3_out",          // medical: the DenseNet layer actually used
  "width": 224, "height": 224,                // same pixel grid as crop.png
  "encoding": "png-gray8",                    // 0 = none, 255 = strongest; the front end applies the inferno ramp
  "normalization": "per-heatmap: relu(cam) / max(cam) * 255",  // so brightness is NOT comparable across classes
  "classes": [
    { "classId": 207, "label": "golden retriever", "hasHeatmap": true,  "file": "gradcam/207.png", "rawMax": 0.0123 },
    { "classId": 257, "label": "Great Pyrenees",   "hasHeatmap": false, "file": null,              "rawMax": null }
  ]
}
```

### 2.4 `atlas.json` + `atlas.bin`: trunk interior (fixture: `atlas.json`)

```jsonc
{
  "schema": "stark.atlas/1",
  "imageId": "clean_retriever",
  "file": "atlas.bin",
  "dtype": "uint8",
  "order": "row-major, y down then x right, origin top-left",
  "channelReduction": "l2-norm",                  // over channels at each spatial position
  "quantization": "round(255 * value / maxRaw)",  // per layer
  "totalBytes": 54145,                            // = atlas.bin size
  "layers": [                                     // 49 entries, bottom (input) to top
    { "index": 0, "name": "conv1_relu", "stage": "conv1", "block": null, "kind": "stem",
      "width": 112, "height": 112, "maxRaw": 10.0, "offset": 0, "length": 12544 },
    { "index": 1, "name": "conv2_block1_1_relu", "stage": "conv2", "block": "conv2_block1", "kind": "conv",
      "width": 56, "height": 56, "maxRaw": 10.7, "offset": 12544, "length": 3136 }
    // kind: stem | conv (_1_relu, _2_relu) | block-out (_out). Width/height are read from the real tensor.
  ],
  "skips": [                                      // 16 residual shortcuts, one per block
    { "block": "conv2_block1", "fromLayer": "conv2_block1_1_relu", "toLayer": "conv2_block1_out", "projection": true }
    // projection: true for block1 of each stage (a 1×1 conv shortcut), otherwise identity
  ]
}
```

### 2.5 `layer-config.json`: full vs reduced trunk (fixture: `layer-config.json`)

```jsonc
{
  "schema": "stark.layers/1",
  "layers": [
    { "index": 0, "name": "conv1_relu", "stage": "conv1", "full": true, "reduced": true }
    // reduced = conv1_relu + the last _out of each stage (conv2_block3, conv3_block4, conv4_block6, conv5_block3); the tree is the output
  ]
}
```

### 2.6 `mc.json`: prediction stability under test-time augmentation (fixture: `mc.json`)

This measures stability under the listed transforms. It is **not** calibrated uncertainty.

```jsonc
{
  "schema": "stark.stability/1",
  "imageId": "ambig_husky",
  "method": "test-time augmentation",
  "runs": 30,                                  // fixture uses 5
  "seed": 1234,
  "transforms": { "cropAreaFrac": [0.85, 1.0], "hflipProb": 0.5, "brightnessDelta": 0.15 },
  "perRun": [ { "run": 0, "top1ClassId": 250, "top1Score": 0.48 } ],  // in run order; the flicker plays these
  "winners": [ { "classId": 250, "label": "Siberian husky", "count": 3 } ],  // every class that won ≥ 1 run, by count desc
  "distinctWinners": 3,
  "classes": [ { "classId": 250, "label": "Siberian husky", "mean": 0.43, "std": 0.07 } ]  // the image's topK classes
}
```

### 2.7 `fgsm.json`: adversarial result (fixture: `fgsm.json`)

```jsonc
{
  "schema": "stark.fgsm/1",
  "sourceImageId": "clean_retriever",
  "adversarialImageId": "adv_retriever",     // a full gallery entry with its own tree/gradcam/atlas
  "epsilon": 0.00784,                         // in the pixelSpace below
  "epsilon255": 2,                            // the same, in 0–255 units
  "epsilonsTried255": [1, 2],                 // ascending; the last one is the smallest that flipped top-1
  "pixelSpace": "[0,1] RGB before Keras preprocessing",
  "original":    { "classId": 207, "label": "golden retriever", "score": 0.62 },
  "adversarial": { "classId": 852, "label": "tennis ball",      "score": 0.41 },
  "trueClass":   { "classId": 207, "label": "golden retriever", "adversarialScore": 0.08 },
  "noiseFile": null                           // stretch: "noise.png" (amplified ×50), otherwise null
}
```

### 2.8 `medical.json`: chest X-ray findings (fixtures: `medical.json`, `tree.medical.json`)

```jsonc
{
  "schema": "stark.medical/1",
  "imageId": "med_xray_pneumonia",
  "model": "torchxrayvision densenet121-res224-all",
  "scoreKind": "independent",
  "caveat": "Independent per-finding model scores; not mutually exclusive, need not sum to 1, not validated diagnostic probabilities.",
  "gradcamTargetLayer": "features.denseblock4",   // whatever was verified on the real X-rays
  "sourceLabel": {                                // what the image SOURCE says; null for the normal film
    "classId": 8, "label": "Pneumonia",
    "source": "Wikimedia Commons file caption (lobar pneumonia, right middle lobe)"
  },
  "findings": [                                   // all 18, in model order (classId = index)
    { "classId": 8, "label": "Pneumonia", "score": 0.66, "rank": 2, "hasHeatmap": true, "file": "gradcam/8.png" }
  ]
}
```

A medical image also writes a `tree.json` with `kind: "fan"` and a `gradcam/index.json`, so the renderer uses one code path. Its `trueClass` is the `sourceLabel`.

### 2.9 Steer data (v2)

Steer works on ResNet50's last convolutional layer, `conv5_block3_out` (7×7×2048). After that layer the network does only global average pooling and one dense layer, so scaling channels and running the rest of the network is exactly:

```
logits'[k] = b[k] + Σ_c W[c][k] · s_c · p_c        p_c = mean of channel c over the 7×7 grid, s_c = the channel's scale
cam'_k[i][j] = ReLU( Σ_c W[c][k] · s_c · A[i][j][c] )   Grad-CAM at that layer, up to the constant factor 1/49
```

The display computes both from the files below, in under 5 ms. No Python runs at runtime and no user code is ever executed.

| File | Contents |
|---|---|
| `steer/head.bin` | float32 little-endian. `W[2048][1000]` row-major (`W[c][k]` at index `c*1000+k`), then `b[1000]`. Exactly 8,196,000 bytes. |
| `steer/head.json` | `{layer:"predictions", inputs:2048, outputs:1000, dtype:"float32", layout:"W[c][k] row-major, then b[k]", bytes, sha256}` |
| `steer/reference.json` | Expected outputs computed with the real Keras layers (not the closed form) for fixed test interventions. The display's maths is tested against it. |
| `<id>/conv5.bin` | float32 little-endian `conv5_block3_out` activations, HWC row-major, index `(i*7+j)*2048+c`. Exactly 401,408 bytes. |
| `<id>/steer.json` | Per-image Steer data, below. |

```jsonc
{
  "version": 1,
  "imageId": "clean_retriever",
  "layer": "conv5_block3_out", "grid": 7, "channels": 2048,
  "identityMaxAbsErr": 0.00002,      // max |b + Wᵀp − Keras logits| over all 1000 classes; must be < 1e-3
  "classes": [                       // top 5 classes + the true class
    { "classId": 207, "label": "golden retriever", "rank": 1, "logit": 17.3,
      "top": [ { "channel": 1187, "contribution": 0.91, "pooled": 3.2 } ] }   // 10 channels, contribution descending
  ],                                 // contribution = W[c][k] · p_c; over all 2048 channels they sum exactly to logit_k − b_k
  "favoring": { "for": 207, "against": 208,            // top-1 vs top-2
                "top": [ { "channel": 1187, "margin": 0.44 } ] },  // margin = contribution_for − contribution_against; 10 channels
  "flip": { "from": 207, "to": 208, "toLabel": "Labrador retriever", "toScore": 0.41,
            "n": 6, "channels": [1187, 311, 87, 1402, 12, 640] }  // the smallest n channels (in margin order) whose zeroing
                                                                    // changes the global top-1; null if n > 64
}
```

---

## 3. Shared runtime shapes

### 3.1 Answer

The single item shape used by the answer list, `focus-state`, `top1`, `trueClass`, and steer results.

```jsonc
{
  "classId": 208,
  "label": "Labrador retriever",
  "score": 0.11,          // model score; read it with display-state.scoreKind
  "rank": 2,
  "hasHeatmap": true,     // from gradcam/index.json, never guessed; equals heatmapSource !== null
  "heatmapSource": "precomputed",  // (v2) "precomputed" (gradcam/<id>.png) | "live" (computed by Steer on the display) | null
  "isTop1": false,
  "isTrueClass": false
}
```

### 3.2 `display-state` (fixture: `display-state.json`)

```jsonc
{
  "room": "7KQ2M",                          // server-authoritative
  "image": { "id": "clean_retriever", "name": "Golden retriever", "category": "clean" },
  "scoreKind": "softmax",                   // PROPOSED ADDITION: softmax | independent (medical)
  "top1": { /* Answer */ },
  "trueClass": { /* Answer */ },            // null if the image has none
  "mode": "normal",                         // normal | stability | trunk
  "layerMode": "full",                      // full | reduced
  "playback": { "state": "done", "speed": 1.0 },  // state: idle | playing | done; speed multiplies 1/MS_PER_LAYER
  "focus": { /* Answer */ },                // null when nothing is focused
  "driver": { "id": "c_3f9a", "label": "Guest 2", "isHost": false },  // null = nobody driving; server-authoritative
  "controllerCount": 3,                     // host + guests currently connected; server-authoritative
  "capabilities": {                         // what works RIGHT NOW for this image/session; controllers hide what is false
    "stability": true,                      // this image has mc.json
    "trunkInterior": true,                  // this image has an atlas and the renderer loaded it
    "layerModes": true,                     // full/reduced switch available
    "bloom": true,                          // glow is on (the display may turn it off for fps)
    "steer": true                           // (v2) true only when head.bin and this image's conv5.bin are loaded AND the
                                            // identity check passed (all-ones scales reproduce tree.json's scores)
  },
  "steer": { "active": true, "changedCount": 3, "top1Changed": false },  // (v2) null when Steer is unavailable
  "answers": [ /* Answer[] */ ]             // top ANSWER_LIST (10) by rank, plus the true class appended if outside them
}
```

Who writes what: the **display** emits `display-state`. The **server** overwrites `room`, `driver` and `controllerCount` with its own values, caches the latest copy per room, rebroadcasts it to controllers, and sends the cached copy to every controller right after it registers. The display emits again whenever any field it owns changes.

### 3.3 `focus-state` (fixtures: `focus-state.json`, `focus-state.none.json`)

An `Answer`, or `null`. The display emits it after each `focus-tip` / `clear-focus` / image change. The server caches and rebroadcasts it the same way as display-state.

### 3.4 `SteerState`: payload of `steer-result` (v2; fixtures: `steer-result.*.json`)

```jsonc
{
  "seq": 12,                          // the steer-update seq this answers (0 after steer-reset or select-image)
  "imageId": "clean_retriever",
  "active": true,                     // false when every scale is 1
  "source": "slider",                 // slider | code | null (nothing applied)
  "scales": [ { "channel": 87, "scale": 0 }, { "channel": 1187, "scale": 2 } ],  // only scale ≠ 1, sorted by channel
  "code": "channel[87] = 0\nchannel[1187] = 2",   // canonical program for the current scales (steer-dsl format()); null if none
  "sets": {                           // 5 channels each, from the UNSTEERED image, so slider rows never reorder
    "top1": { "classId": 207, "label": "golden retriever", "channels": [ { "channel": 1187, "contribution": 0.91 } ] },
    "top2": { "classId": 208, "label": "Labrador retriever", "channels": [ { "channel": 640, "contribution": 0.52 } ] }
  },
  "result": {
    "answers": [ /* Answer[], same rules as display-state.answers, recomputed */ ],
    "top1": { /* Answer */ },
    "baselineTop1": { /* Answer: the unsteered top-1 */ },
    "top1Changed": false,
    "outsideBrain": null              // the steered top-1 when it is not one of the classes drawn in the Brain
  },
  "probe": null,                      // channel being probed (its 7×7 map shown on the photo), or null
  "error": null                       // {line, col, message} when a program failed to parse or resolve
}
```

The display emits `steer-result` at most `STEER_SEND_HZ` (15) times per second. The server caches the latest per room and sends it to controllers that join. `select-image` clears steering on the display.

### 3.5 `error` (fixture: `error.json`)

```jsonc
{
  "code": "LOCKED",        // NO_ROOM | BAD_KEY | LOCKED | FORBIDDEN | BAD_PAYLOAD | RATE_LIMITED
  "message": "Guest 2 is driving. Try again when they stop, or ask the host.",
  "event": "take-control", // the event that caused it (optional)
  "driver": { "id": "c_3f9a", "label": "Guest 2", "isHost": false }  // only with LOCKED
}
```

| Code | When |
|---|---|
| `NO_ROOM` | A controller registered for a room that doesn't exist. Also the QR endpoint for an unknown room (HTTP 404). |
| `BAD_KEY` | `role: "host"` with a missing or wrong key. The socket stays connected with no role, so the client may retry. |
| `LOCKED` | A guest sent `take-control` while another guest is the active driver. Includes `driver`. |
| `FORBIDDEN` | The sender's role or driver status doesn't allow the event. |
| `BAD_PAYLOAD` | Schema validation failed: unknown `classId` / `imageId`, a value out of range, a wrong type. |
| `RATE_LIMITED` | Over the event's limit. Excess messages are dropped, and this error is sent at most once per second per client. |

---

## 4. Rooms, roles and the driver lock

- **Room codes** are issued by the server: 5 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (A–Z without I and O, digits 2–9). Input is case-insensitive, and the server uppercases it.
- **`STARK_FIXED_ROOM`** (env), when set, is the only room the server hands out. It exists from startup and is never destroyed, which gives the printed table QR a stable target.
- A **display** registers with `room: null` to get a new code, or with its previous code to reclaim that room after a reload. There is one display per room: a newer display registration replaces the older socket, which is disconnected.
- A room with no clients is destroyed after 10 minutes (except the fixed room).
- **Host**: a valid `key` equal to env `STARK_HOST_KEY`. If the env var is unset, the server generates a random key at startup and prints the host URL to its console.
- **Guest labels** are assigned by the server: "Guest 1", "Guest 2", … per room. Host label: "Host".
- **Driver lock**: `take-control` from a guest succeeds only if nobody is driving. Otherwise it gets `LOCKED`, which names the current driver. `take-control` from the host always succeeds immediately (`reason: "host-override"` if it displaced someone).
- **Idle release**: the driver is released after `DRIVER_IDLE_MS` (20 s) without a driver-gated event (orbit, zoom, focus-tip, clear-focus, reset-view, steer-*), or immediately on disconnect. The server then emits `driver-changed` with `driver: null`.
- Host-only actions (`select-image`, `play-pulse`, `set-mode`) never require being the driver.

## 5. Socket events

Transport: Socket.io v4, default namespace. "→ display" means the server relays the event only to the room's display socket; "→ room" means every socket in the room.

Permission key: **display** = the display socket only; **host** = the host controller; **driver-or-host** = the current driver, or the host at any time; **any** = any socket.

| Event | Direction | Payload | Permission | Rate limit |
|---|---|---|---|---|
| `register` | client → server, with an ack | `{role, room, key?}` → ack `{ok:true, room, clientId, role, label}` or `{ok:false, error}` | any (once per socket) | 5/min |
| `peer-joined` | server → room | `{clientId, role, label}`. Also sent to a newcomer once per existing peer. | server only | n/a |
| `peer-left` | server → room | `{clientId, role, label}` | server only | n/a |
| `take-control` | controller → server | `{}` | host, guest | 2/s |
| `driver-changed` | server → room | `{driver: Driver\|null, reason: "take"\|"host-override"\|"idle"\|"disconnect"}` | server only | n/a |
| `control-orbit` | controller → server → display | `{dx, dy}`: drag since the last send as a fraction of the drag area's width/height (−1..1); +x = drag right, +y = drag down | driver-or-host | 30/s (`SEND_HZ`) |
| `control-zoom` | controller → server → display | `{dz}`: ln(pinchScale now / pinchScale at last send), clamped −1..1; + = zoom in | driver-or-host | 30/s |
| `focus-tip` | controller → server → display | `{classId}`, which must be in the cached `display-state.answers` | driver-or-host | 10/s |
| `clear-focus` | controller → server → display | `{}` | driver-or-host | 10/s |
| `focus-state` | display → server → controllers | `Answer \| null` | display | 20/s |
| `reset-view` | controller → server → display | `{}` | driver-or-host | 5/s |
| `select-image` | host → server → display | `{imageId}`, which must be in the manifest | host | 5/s |
| `play-pulse` | host → server → display | `{speed?, skipToEnd?}`: speed 0.25–4 (default 1), skipToEnd jumps to the finished state | host | 5/s |
| `set-mode` | host → server → display | `{mode?, layerMode?}`, at least one, each valid only if its capability is true | host | 5/s |
| `display-state` | display → server → controllers | `DisplayState` (server fills `room`, `driver`, `controllerCount`) | display | 20/s |
| `steer-update` | controller → server → display | (v2) `{seq, set:[{channel, scale}], probe?}` or `{seq, code, probe?:null}`. See below. | driver-or-host | 20/s |
| `steer-reset` | controller → server → display | `{}` | driver-or-host | 2/s |
| `steer-result` | display → server → controllers | (v2) `SteerState` (section 3.4) | display | 15/s |
| `error` | server → one client | `StarkError` (section 3.5) | server only | n/a |

Every event payload is an object (or `null` for `focus-state`). Unknown extra fields are ignored. Missing or invalid fields produce `BAD_PAYLOAD`. Examples for every event are in `fixtures/events.json`.

**Steer events (v2).** All are driver-or-host and ignored by the display unless `capabilities.steer` is true.
- `steer-update` slider form: `seq` is an integer ≥ 0; `set` is the COMPLETE list of changed channels and replaces the previous one (≤ `STEER_MAX_CHANNELS` entries, `channel` an integer 0–2047, `scale` a number 0–3); `probe` is a channel or null.
- `steer-update` code form: `seq`, and `code`, a string of at most `STEER_CODE_MAX` (600) characters in the Steer language (section 11); `probe` must be null or absent.
- The server validates types and ranges, and checks that `code` passes `steer-dsl` `parse()` (syntax only). Anything else gets `BAD_PAYLOAD`, with the parse error attached for code.

**Not in the contract:** `control-tap`, `mark-region` and `clear-region` (removed). There is no tap-to-aim: answers are chosen from the list.

## 6. HTTP routes and URL scheme

| Route | Serves | Owner |
|---|---|---|
| `GET /display?room=CODE` | Display page (`room` optional: omit it to get a new code) | core |
| `GET /controller?room=CODE` | Guest controller | ui |
| `GET /controller?room=CODE&role=host&key=KEY` | Host controller | ui |
| `GET /api/qr.svg?room=CODE` | SVG QR code of the guest URL `<origin>/controller?room=CODE`. The server builds the URL from `STARK_PUBLIC_URL` if set, otherwise from the request origin. 404 + `{code:"NO_ROOM"}` for an unknown room. | server |
| `GET /health` | `200 ok` (text/plain) | server |
| `/assets/*` | `web/public/assets/` | pipeline output |
| `/core/*`, `/ui/*` | `web/core/`, `web/ui/` | core, ui |
| `/contract/contract.js` | this contract's JS mirror | Ray |
| `/vendor/three/*` | `node_modules/three/` (`three` → `/vendor/three/build/three.module.js`, `three/addons/` → `/vendor/three/examples/jsm/`) | server |
| `/socket.io/*` | the Socket.io client (`/socket.io/socket.io.esm.min.js`) | server |

Pages use native ES modules with an import map. There are no CDNs and no build step. The server listens on `PORT` (Claude Code dev: 3001).

## 7. HUD mount API

`/web/ui/hud.js` (Codex) exports `mountHud(rootEl, api)`. The display page (core) calls it once with an absolutely positioned overlay element.

```js
api = {
  onState(cb),     // cb(DisplayState) on every change; returns unsubscribe()
  onFocus(cb),     // cb(Answer|null) on every change; returns unsubscribe()
  getRoom(),       // → current room code (string)
  setVisible(bool) // show/hide the HUD (see open question 4)
}
```

The HUD reads only through `api`. It never opens its own socket or touches the Three.js scene. The QR shown on the display is an `<img src="/api/qr.svg?room=...">`.

## 8. Defaults (`contract.js` → `DEFAULTS`)

| Name | Value | Meaning |
|---|---|---|
| `MS_PER_LAYER` | 120 | Pulse time per layer at speed 1.0 |
| `SEND_HZ` | 30 | Max orbit/zoom sends per second per controller |
| `DRIVER_IDLE_MS` | 20000 | Driver idle release |
| `TOP_K` | 25 | Tree tips per image (plus the true class) |
| `ANSWER_LIST` | 10 | Answers in display-state (plus the true class) |
| `STEER_MAX_CHANNELS` | 64 | (v2) Distinct channels in one intervention |
| `STEER_MAX_SCALE` | 3 | (v2) Scales are clamped to 0–3 |
| `STEER_CODE_MAX` | 600 | (v2) Characters in a Steer program |
| `STEER_SEND_HZ` | 15 | (v2) Max `steer-result` messages per second |

## 9. Ready flag

Each page sets `window.__starkReady = true` once it is usable. The display sets it when it has registered, loaded the first image, and rendered a frame. A controller sets it when it has registered and received its first `display-state`, or rendered its "waiting for display" state. Screenshot tooling waits for this flag.

## 10. Fixtures

`fixtures/` has one small valid example per file type and per runtime state. v2 adds `steer-update.slider.json`, `steer-update.code.json`, `steer-result.{active,flipped,outside-brain,parse-error}.json` (`steer-state.json` is the same as `steer-result.active.json`), `display-state.steer.json` and `answer.live.json`. Labels and WordNet paths are real. **Scores are synthetic and are not model output.** Fixtures with arrays shorter than production sizes (topK, runs) are still valid against the rules above.

## 11. The Steer language (v2): `/contract/steer-dsl.js`

A pure ES module with no dependencies that runs in the browser and in Node. Its tokenizer is hand-written. It never uses `eval`, `new Function`, dynamic import of user text, or any other code execution.

```
reset
channel[SEL] *= NUMBER
channel[SEL] = NUMBER

SEL    := INT | INT, INT, ... | top(N, "class label")
INT    0–2047        N   1–20        NUMBER  decimal ≥ 0 (0, 0.5, .5, 2, 2.0; no sign, exponent or hex)
```

- **Statements:** one per line, or several on a line separated by `;`. `#` starts a comment. Whitespace is free.
- **Semantics:** a program starts from a fresh baseline (every scale 1) and applies its statements in order. The result is the complete intervention; it is not added to the previous one. Every resulting scale is clamped to 0–3.
- **Limits:** 600 characters, 20 statements, 64 distinct channels.
- **Exports:**
  - `parse(text)` returns `{ok:true, statements}` or `{ok:false, error:{line, col, message}}`.
  - `resolve(statements, resolver)` returns `{ok:true, scales: Map<channel, scale>}` or `{ok:false, error}`. The display supplies `resolver.findClass(label)` and `resolver.topChannels(classId, n)`. Labels match case-insensitively: an exact match first, then a unique prefix; otherwise the error names the closest label.
  - `format(scales)` returns the canonical program text. Channels are grouped by equal scale and written in the `=` form, sorted, with scales rounded to 3 decimals. Channels whose scale is 1 are left out. For example:

    ```
    channel[87, 311, 1402] = 0
    channel[12] = 2
    ```
