"""Paths and constants shared by every pipeline module."""
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
PIPELINE = REPO / "pipeline"
INPUTS = PIPELINE / "inputs"
GALLERY_JSON = PIPELINE / "gallery.json"
CACHE = PIPELINE / ".cache"            # gitignored: run stamps, generated intermediates
REVIEW = PIPELINE / "review"
ASSETS = REPO / "web" / "public" / "assets"
ASSETS_URL_PREFIX = "assets/"          # manifest folders are relative to the site root

KERAS_MODELS = Path.home() / ".keras" / "models"
RESNET_WEIGHTS = KERAS_MODELS / "resnet50_weights_tf_dim_ordering_tf_kernels.h5"
IMAGENET_INDEX = KERAS_MODELS / "imagenet_class_index.json"

MODEL_NAME = "resnet50-imagenet-keras"
GRADCAM_LAYER = "conv5_block3_out"

# Mirrors contract.js DEFAULTS.
TOP_K = 25
GRADCAM_TOP = 5        # heatmaps for the top 5 (+ true class) unless the entry says "gradcam": "all"

RESIZE_SHORT = 256
CROP = 224

IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
