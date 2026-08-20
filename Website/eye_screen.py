"""
OptiScan screening stage: "Eye or Not Eye Confirmation" (Figure 1, stage b).

Wraps the CNN trained in finalized_cnn-svm.ipynb (saved as best_model.keras)
so pipeline.py / app.py can call one function instead of re-implementing
Keras load + preprocessing.

IMPORTANT — verify before trusting this in production:
The training notebook builds datasets with:
    keras.utils.image_dataset_from_directory(..., label_mode="binary")
Keras assigns label 0 to the alphabetically-first class-folder name and
label 1 to the second. The merge step used folder names "eye" and
"non-eye" ("eye" < "non-eye" alphabetically), so this module assumes:
    label 0 (sigmoid output near 0.0) -> "eye"
    label 1 (sigmoid output near 1.0) -> "non-eye"
Re-run the notebook cell that prints `class_names` and confirm it says
["eye", "non-eye"] before trusting this in anything beyond local testing.
If it's reversed, flip IS_EYE_LABEL below.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

IMG_SIZE = 224          # must match IMG_SIZE in finalized_cnn-svm.ipynb
IS_EYE_LABEL = 0        # sigmoid output near 0 => "eye" (see note above)
DEFAULT_THRESHOLD = 0.5  # decision boundary on the raw sigmoid output

_model = None  # lazy-loaded singleton, avoids reloading Keras model per-request


@dataclass
class ScreeningResult:
    is_eye: bool
    confidence: float          # confidence in the returned decision, 0..1
    raw_score: float           # raw sigmoid output, before thresholding


def _load_model(model_path: str):
    global _model
    if _model is None:
        from tensorflow import keras
        _model = keras.models.load_model(model_path)
    return _model


def _preprocess(image_bgr: np.ndarray) -> np.ndarray:
    """BGR (OpenCV) -> RGB, resized to IMG_SIZE, batch of 1. Model has its
    own internal Rescaling(1/255) layer, so pixels stay in 0-255 range here."""
    rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (IMG_SIZE, IMG_SIZE), interpolation=cv2.INTER_AREA)
    return np.expand_dims(resized.astype(np.float32), axis=0)


def screen_eye(image_bgr: np.ndarray, model_path: str,
               threshold: float = DEFAULT_THRESHOLD) -> ScreeningResult:
    """Run the eye/not-eye screening CNN on a single image.

    Args:
        image_bgr: OpenCV-style BGR image array (e.g. from cv2.imread or
            cv2.imdecode of an uploaded/captured frame).
        model_path: path to best_model.keras.
        threshold: sigmoid decision boundary; raise it to be more
            conservative about accepting an image as "eye".

    Returns:
        ScreeningResult with is_eye, confidence (distance from the
        decision boundary, rescaled to 0..1), and the raw model score.
    """
    model = _load_model(model_path)
    batch = _preprocess(image_bgr)
    raw_score = float(model.predict(batch, verbose=0)[0][0])

    is_eye = (raw_score < threshold) if IS_EYE_LABEL == 0 else (raw_score >= threshold)

    # Confidence = how far the raw score sits from the decision boundary,
    # normalized so 0.5 (right at the boundary) -> 0.0 confidence and
    # 0.0 or 1.0 (fully certain) -> 1.0 confidence.
    confidence = abs(raw_score - threshold) / max(threshold, 1 - threshold)
    confidence = round(min(confidence, 1.0), 3)

    return ScreeningResult(is_eye=is_eye, confidence=confidence, raw_score=round(raw_score, 4))
