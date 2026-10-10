"""ResNet50 (ImageNet, Keras), loaded once per run from the local cache.

TensorFlow is imported lazily, so runs where every image is up to date never pay for it.
The model is split at the Grad-CAM layer: features = conv5_block3_out (7x7x2048), head = avg_pool + dense.
classifier_activation=None, so the head returns logits; scores are softmax(logits).
"""
import os

import numpy as np

from . import config

_model = None


def _tf():
    os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
    import tensorflow as tf
    tf.config.experimental.enable_op_determinism()
    return tf


class ResNet:
    def __init__(self):
        tf = _tf()
        import keras
        from keras.applications.resnet50 import ResNet50, preprocess_input

        if not config.RESNET_WEIGHTS.exists():
            raise FileNotFoundError(f"ResNet50 weights not cached at {config.RESNET_WEIGHTS}")
        # Passing the file path (not "imagenet") guarantees Keras never tries to download.
        base = ResNet50(weights=str(config.RESNET_WEIGHTS), classifier_activation=None)
        self.tf = tf
        self.preprocess_input = preprocess_input
        self.features = keras.Model(base.input, base.get_layer(config.GRADCAM_LAYER).output)
        self._pool = base.get_layer("avg_pool")
        self._dense = base.get_layer("predictions")
        self.dense_kernel = self._dense.get_weights()[0]  # (2048, 1000)

    def head(self, feats):
        return self._dense(self._pool(feats))

    def forward(self, batch_0_255):
        """float32 RGB 0-255 batch -> (features, logits) as numpy arrays."""
        x = self.preprocess_input(batch_0_255.copy())
        feats = self.features(x, training=False)
        logits = self.head(feats)
        return feats.numpy(), logits.numpy()

    def logit_grads(self, feats, class_ids):
        """d logit[c] / d features for each class, shape (n, 7, 7, 2048). Only the head is re-run, not the backbone."""
        tf = self.tf
        f = tf.convert_to_tensor(feats)
        with tf.GradientTape(persistent=True) as tape:
            tape.watch(f)
            logits = self.head(f)[0]
            sel = [logits[c] for c in class_ids]
        grads = [tape.gradient(s, f)[0].numpy() for s in sel]
        del tape
        return np.stack(grads)


def get():
    global _model
    if _model is None:
        _model = ResNet()
    return _model
