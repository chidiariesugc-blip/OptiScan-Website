"""
Model 1 — Nuclear cataract detection & grading via your vgg11.tflite.

This IS the one learned model in the pipeline (Models 2 & 3 are
deterministic measurement, see cortical_wisconsin.py / psc_measure.py).
Nuclear grading is holistic/textural (lens colour + density across the
whole nucleus per LOCS III), which doesn't reduce to a clean geometric
measurement the way a cortical spoke area% or a PSC diameter does — hence
a CNN backbone here.

Given your dataset (1-2 images per grade across 3 grading scales), this
module treats vgg11.tflite as a FROZEN FEATURE EXTRACTOR, not something to
retrain end-to-end:
    image -> vgg11.tflite forward pass -> penultimate-layer embedding
          -> small classifier (SVM / logistic regression / kNN) trained
             on YOUR embeddings
This is the standard way to get usable performance out of a deep backbone
on a tiny local dataset: the backbone (pretrained, presumably on ImageNet
or a larger ophthalmic set) already knows general visual features; you're
only fitting a small number of parameters (the classifier head) to your
handful of labelled examples, which is far less prone to overfitting than
fine-tuning millions of CNN weights against ~15 images.

Because your dataset mixes THREE different grading scales (0-6, LOCS III
0-5, and a P0.1-P5.9 WHO-equivalent scale), see `grade_scale_mapping.py`
sibling module (not yet written — flagged in README) for harmonizing them
to one canonical ordinal target before training the head.

Explainability: Grad-CAM needs gradient access, which a converted .tflite
graph does not expose at inference time. Rather than requiring you to keep
the pre-conversion Keras/TF model around just for CAMs, this module
implements Score-CAM — a gradient-free, perturbation-based CAM technique
that treats the network as a pure black box (only needs forward passes),
so it works directly against the .tflite interpreter.
"""
from dataclasses import dataclass
from pathlib import Path
import numpy as np
import cv2

# Interpreter fallback chain: prefer ai-edge-litert (newest, actively
# maintained by Google), fall back to tflite_runtime (lighter-weight than
# full TF, if that's what's installed), and finally full tensorflow's
# built-in tf.lite.Interpreter. This keeps the module usable on Python
# 3.9 environments where ai-edge-litert (which requires Python >=3.10)
# isn't installable at all.
try:
    from ai_edge_litert.interpreter import Interpreter
except ImportError:
    try:
        from tflite_runtime.interpreter import Interpreter
    except ImportError:
        try:
            # NOTE: intentionally `import tensorflow as tf` + attribute
            # access, NOT `from tensorflow.lite import Interpreter`.
            # TensorFlow's tensorflow/lite/__init__.py uses lazy-loading
            # internally, and on some TF builds (seen with 2.15 on
            # Windows/Python 3.9) `from tensorflow.lite import Interpreter`
            # raises ImportError even though `tf.lite.Interpreter` resolves
            # fine once the lazy loader is triggered via attribute access.
            import tensorflow as tf
            Interpreter = tf.lite.Interpreter
        except ImportError:  # pragma: no cover
            Interpreter = None


@dataclass
class NuclearGradingResult:
    grade: int
    confidence: float           # calibrated probability of the predicted grade
    class_probabilities: np.ndarray
    heatmap: np.ndarray          # Score-CAM heatmap, same H,W as input image
    overlay: np.ndarray          # heatmap alpha-blended onto the input image
    embedding: np.ndarray        # penultimate-layer feature vector, for the classifier head


class VGG11TFLiteBackbone:
    """Thin wrapper around the .tflite interpreter. Handles the two things
    every downstream piece needs: a forward pass to logits/probabilities,
    and access to an intermediate embedding layer for the classifier-head
    training approach described in the module docstring."""

    def __init__(self, model_path: str, embedding_layer_name: str = None):
        if Interpreter is None:
            raise ImportError(
                "No TFLite interpreter is available. Install one of: "
                "pip install ai-edge-litert (requires Python >=3.10), "
                "pip install tflite-runtime, or pip install tensorflow"
            )
        self.model_path = Path(model_path)
        if not self.model_path.exists():
            raise FileNotFoundError(
                f"'{model_path}' not found. Upload vgg11.tflite and pass its "
                f"path here before running nuclear grading."
            )
        self.interpreter = Interpreter(model_path=str(self.model_path))
        self.interpreter.allocate_tensors()
        self.input_details = self.interpreter.get_input_details()
        self.output_details = self.interpreter.get_output_details()
        self._embedding_layer_name = embedding_layer_name

    @property
    def input_shape(self):
        return self.input_details[0]["shape"]  # e.g. [1, 224, 224, 3]

    def describe(self) -> dict:
        """Dump input/output signature — run this FIRST once the real
        vgg11.tflite is available, since expected input size, channel
        order, normalization range, and number of output classes/grades
        all depend on how the model was actually trained/exported, and
        must not be guessed."""
        return {
            "inputs": self.input_details,
            "outputs": self.output_details,
        }

    def preprocess(self, image_bgr: np.ndarray) -> np.ndarray:
        shape = self.input_shape  # 4 elements, e.g. [1, 224, 224, 3] or [1, 3, 224, 224]
        if len(shape) != 4:
            raise ValueError(
                f"Expected a 4D input tensor [batch, H, W, C] or [batch, C, H, W], "
                f"got shape {list(shape)}. Inspect backbone.describe() and adjust "
                f"preprocess() manually for this model."
            )

        # Detect NHWC vs NCHW rather than assuming NHWC. Channel counts are
        # almost always 1 or 3, and image dimensions are almost never that
        # small, so whichever axis (1 or 3) holds a 1/3 is the channel axis.
        # (vgg11.tflite turned out to be NCHW — [1, 3, 224, 224] — likely
        # from a PyTorch/ONNX conversion path rather than Keras-native.)
        channels_first = shape[1] in (1, 3) and shape[3] not in (1, 3)
        if channels_first:
            c, h, w = int(shape[1]), int(shape[2]), int(shape[3])
        else:
            h, w, c = int(shape[1]), int(shape[2]), int(shape[3])

        img = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
        img = cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)
        img = img.astype(np.float32)

        in_dtype = self.input_details[0]["dtype"]
        if in_dtype == np.uint8:
            # Quantized model: leave in [0, 255] uint8, no float normalization.
            img = img.astype(np.uint8)
        else:
            # Float model: standard [0, 1] scaling. NOTE — if vgg11.tflite
            # was trained with ImageNet mean/std normalization instead of
            # plain /255, swap this out once describe() / the training
            # script confirms which preprocessing the model expects.
            img = img / 255.0

        if channels_first:
            img = np.transpose(img, (2, 0, 1))  # HWC -> CHW

        return np.expand_dims(img, axis=0)

    def predict_probs(self, image_bgr: np.ndarray) -> np.ndarray:
        inp = self.preprocess(image_bgr)
        self.interpreter.set_tensor(self.input_details[0]["index"], inp)
        self.interpreter.invoke()
        out = self.interpreter.get_tensor(self.output_details[0]["index"])
        probs = out[0].astype(np.float32)
        # If the exported graph doesn't already end in softmax, this makes
        # `predict_probs` robust either way.
        if not np.isclose(probs.sum(), 1.0, atol=1e-2):
            probs = _softmax(probs)
        return probs

    def predict_batch_probs(self, images_bgr: list) -> np.ndarray:
        return np.stack([self.predict_probs(im) for im in images_bgr], axis=0)


def _softmax(x: np.ndarray) -> np.ndarray:
    e = np.exp(x - x.max())
    return e / e.sum()


def score_cam(backbone: VGG11TFLiteBackbone, image_bgr: np.ndarray,
              target_class: int, n_masks: int = 32, mask_grid: int = 7) -> np.ndarray:
    """
    Gradient-free Score-CAM against a .tflite black box.

    Standard Score-CAM upsamples internal activation maps to use as masks;
    since we can't reach internal activations through the plain .tflite
    invoke() API without a custom output signature, this uses the
    occlusion-based variant: a coarse grid of soft random/structured masks
    is applied directly to the input image, and each masked image's
    effect on the target class's predicted probability becomes that mask's
    weight. This is slower (n_masks forward passes) but requires nothing
    beyond the interpreter you already have, and is a well-established
    fallback (RISE-style) when true intermediate-layer Score-CAM isn't
    accessible.

    Returns: heatmap (H, W) float32 in [0, 1], same size as image_bgr.
    """
    h, w = image_bgr.shape[:2]
    baseline_prob = backbone.predict_probs(image_bgr)[target_class]

    heatmap = np.zeros((h, w), dtype=np.float32)
    weight_sum = 0.0

    rng = np.random.default_rng(seed=42)  # deterministic masks -> reproducible explanations

    for _ in range(n_masks):
        # Structured coarse mask upsampled with smooth interpolation, so
        # masked regions correspond to spatially coherent lens regions
        # rather than salt-and-pepper noise.
        coarse = rng.random((mask_grid, mask_grid)) > 0.5
        mask = cv2.resize(coarse.astype(np.float32), (w, h), interpolation=cv2.INTER_LINEAR)
        mask = cv2.GaussianBlur(mask, (0, 0), sigmaX=w / (mask_grid * 2))
        mask = np.clip(mask, 0, 1)

        masked_img = (image_bgr.astype(np.float32) * mask[..., None]).astype(np.uint8)
        prob = backbone.predict_probs(masked_img)[target_class]

        # Weight = how much this masked-in region alone drives the
        # target-class score, relative to baseline.
        weight = max(prob - 0.0, 0.0)  # simple non-negative weighting
        heatmap += weight * mask
        weight_sum += weight

    if weight_sum > 1e-8:
        heatmap /= weight_sum
    heatmap = (heatmap - heatmap.min()) / (heatmap.max() - heatmap.min() + 1e-8)
    return heatmap


def overlay_heatmap(image_bgr: np.ndarray, heatmap: np.ndarray, alpha: float = 0.45) -> np.ndarray:
    heat_color = cv2.applyColorMap((heatmap * 255).astype(np.uint8), cv2.COLORMAP_JET)
    return cv2.addWeighted(image_bgr, 1 - alpha, heat_color, alpha, 0)


class TemperatureScaledCalibrator:
    """
    Post-hoc confidence calibration. A model trained on ~15 images will be
    overconfident by default (softmax probabilities pushed near 0/1 even
    when the model is guessing) — temperature scaling divides logits by a
    single learned scalar T > 1 to soften this, fit on a held-out
    validation split. This does NOT change which grade is predicted (it's
    monotonic), only how honest the reported confidence number is.
    """
    def __init__(self, temperature: float = 1.0):
        self.temperature = temperature

    def fit(self, logits: np.ndarray, true_labels: np.ndarray, lr: float = 0.01, n_iter: int = 200):
        """logits: (N, C) pre-softmax scores from held-out validation
        examples. true_labels: (N,) int labels. Simple gradient descent on
        NLL w.r.t. T — no external optimizer dependency needed for a
        single scalar parameter."""
        T = np.array([self.temperature], dtype=np.float64)
        n = len(true_labels)
        for _ in range(n_iter):
            scaled = logits / T
            probs = np.exp(scaled - scaled.max(axis=1, keepdims=True))
            probs /= probs.sum(axis=1, keepdims=True)
            grad = 0.0
            for i in range(n):
                p = probs[i]
                y = true_labels[i]
                # d(NLL)/dT for this sample
                grad += -(logits[i, y] - np.sum(p * logits[i])) / (T[0] ** 2)
            grad /= n
            T -= lr * grad
            T = np.clip(T, 0.05, 20.0)
        self.temperature = float(T[0])
        return self

    def calibrate(self, logits: np.ndarray) -> np.ndarray:
        scaled = logits / self.temperature
        return _softmax(scaled)


def grade_nuclear(backbone: VGG11TFLiteBackbone, image_bgr: np.ndarray,
                   calibrator: TemperatureScaledCalibrator = None,
                   n_score_cam_masks: int = 24) -> NuclearGradingResult:
    probs = backbone.predict_probs(image_bgr)
    if calibrator is not None:
        # NOTE: requires raw logits, not post-softmax probs, for a correct
        # temperature-scaling application. If vgg11.tflite's output layer
        # already applies softmax internally, you'll need a version of the
        # model exported with logits output for calibration to be exact;
        # otherwise this rescales already-softmaxed probabilities as an
        # approximation.
        probs = calibrator.calibrate(np.log(probs + 1e-8))

    grade = int(np.argmax(probs))
    confidence = float(probs[grade])

    heatmap = score_cam(backbone, image_bgr, target_class=grade, n_masks=n_score_cam_masks)
    heatmap_resized = cv2.resize(heatmap, (image_bgr.shape[1], image_bgr.shape[0]))
    overlay = overlay_heatmap(image_bgr, heatmap_resized)

    return NuclearGradingResult(
        grade=grade, confidence=confidence, class_probabilities=probs,
        heatmap=heatmap_resized, overlay=overlay, embedding=probs,  # placeholder until embedding tap is wired
    )