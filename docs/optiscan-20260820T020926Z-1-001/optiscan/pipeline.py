"""
OptiScan main pipeline.

    input image --> [user-select: cataract type] --> grade + explainability + confidence

Usage:
    python pipeline.py --image path/to/image.jpg --type nuclear --model vgg11.tflite
    python pipeline.py --image path/to/image.jpg --type cortical
    python pipeline.py --image path/to/image.jpg --type psc

Each cataract type routes to a different ROI algorithm (nuclear = direct
slit-lamp -> Algorithm 1; cortical/psc = retro-illumination -> Algorithm
2/3), consistent with how these are actually captured clinically — the
"type select" doesn't just choose a grading formula, it chooses the whole
upstream localization approach.
"""
import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from roi.slit_lamp_roi import detect_lens_roi_slit_lamp, crop_to_roi
from roi.retro_roi import detect_lens_roi_retro, crop_to_circle, circular_mask
from roi.cortical_polar import detect_cortical_opacity
from grading.cortical_wisconsin import compute_wisconsin_grade
from grading.psc_measure import grade_psc
try:
    from screening.eye_screen import screen_eye
except ModuleNotFoundError:
    from eye_screen import screen_eye


CATARACT_TYPES = ("nuclear", "cortical", "psc")


def run_nuclear(image_bgr: np.ndarray, model_path: str, px_per_mm: float = None) -> dict:
    from grading.nuclear_vgg11 import VGG11TFLiteBackbone, grade_nuclear

    roi = detect_lens_roi_slit_lamp(image_bgr)
    cropped = crop_to_roi(image_bgr, roi)

    backbone = VGG11TFLiteBackbone(model_path)
    result = grade_nuclear(backbone, cropped)

    return {
        "cataract_type": "nuclear",
        "grade": result.grade,
        "grade_label": _nuclear_grade_label(result.grade),
        "confidence": round(result.confidence, 3),
        "class_probabilities": result.class_probabilities.tolist(),
        "roi_bbox": roi.bbox,
        "explainability_overlay": result.overlay,   # np.ndarray, save/display as needed
        "monitor": result.grade > 0,
    }


def run_cortical(image_bgr: np.ndarray, px_per_mm: float = None) -> dict:
    cleaned, circle_roi = detect_lens_roi_retro(image_bgr)
    lens_crop = crop_to_circle(cleaned, circle_roi)
    lens_gray = cv2.cvtColor(lens_crop, cv2.COLOR_BGR2GRAY)

    center = (lens_crop.shape[1] // 2, lens_crop.shape[0] // 2)
    opacity_mask = detect_cortical_opacity(lens_gray, center, circle_roi.radius)

    result = compute_wisconsin_grade(
        opacity_mask, center, circle_roi.radius, px_per_mm=px_per_mm
    )

    return {
        "cataract_type": "cortical",
        "grade": result.area_grade,
        "grade_label": f"Grade {result.area_grade} (total area {result.total_area_pct:.1f}%)",
        "circumference_grade": result.circumference_grade,
        "central_zone_involved": result.central_zone_involved,
        "confidence": None,  # deterministic measurement, not a learned confidence
        "roi_bbox": (circle_roi.cx - circle_roi.radius, circle_roi.cy - circle_roi.radius,
                     2 * circle_roi.radius, 2 * circle_roi.radius),
        "explainability_overlay": result.zone_mask_overlay,
        "monitor": result.area_grade > 0,
    }


def run_psc(image_bgr: np.ndarray, px_per_mm: float = None, cortical_mask: np.ndarray = None) -> dict:
    cleaned, circle_roi = detect_lens_roi_retro(image_bgr)
    lens_crop = crop_to_circle(cleaned, circle_roi)
    lens_gray = cv2.cvtColor(lens_crop, cv2.COLOR_BGR2GRAY)

    center = (lens_crop.shape[1] // 2, lens_crop.shape[0] // 2)
    result = grade_psc(lens_gray, center, circle_roi.radius,
                        px_per_mm=px_per_mm, cortical_mask=cortical_mask)

    overlay = lens_crop.copy()
    overlay[result.opacity_mask.astype(bool)] = (0, 0, 255)

    return {
        "cataract_type": "psc",
        "grade": result.grade,
        "grade_label": _psc_grade_label(result.grade),
        "vertical_diameter_mm": round(result.vertical_diameter_mm, 2),
        "visualizable": result.visualizable,
        "within_central_zone": result.within_central_zone,
        "confidence": None,
        "roi_bbox": (circle_roi.cx - circle_roi.radius, circle_roi.cy - circle_roi.radius,
                     2 * circle_roi.radius, 2 * circle_roi.radius),
        "explainability_overlay": overlay,
        "monitor": result.grade not in ("0",),
    }


def _nuclear_grade_label(grade: int) -> str:
    if grade == 0:
        return "Grade 0 - no cataract detected"
    return f"Grade {grade} - cataract detected, monitor"


def _psc_grade_label(grade: str) -> str:
    labels = {
        "0": "Grade 0 - no cataract detected",
        "1": "Grade 1 - case",
        "2": "Grade 2 - progression, may require surgery",
        "3": "Grade 3 - usually requires surgery",
        "9": "Cannot grade - posterior capsule not visualizable",
    }
    return labels.get(grade, f"Grade {grade}")


def grade_image(image_path: str, cataract_type: str, model_path: str = None,
                 px_per_mm: float = None) -> dict:
    if cataract_type not in CATARACT_TYPES:
        raise ValueError(f"cataract_type must be one of {CATARACT_TYPES}, got {cataract_type!r}")

    image_bgr = cv2.imread(image_path)
    if image_bgr is None:
        raise FileNotFoundError(f"Could not read image at {image_path}")

    if cataract_type == "nuclear":
        if not model_path:
            raise ValueError("nuclear grading requires --model path/to/vgg11.tflite")
        return run_nuclear(image_bgr, model_path, px_per_mm=px_per_mm)
    elif cataract_type == "cortical":
        return run_cortical(image_bgr, px_per_mm=px_per_mm)
    else:
        return run_psc(image_bgr, px_per_mm=px_per_mm)


def analyze_image(image_bgr: np.ndarray, cataract_type: str, *,
                   screening_model_path: str, model_path: str = None,
                   px_per_mm: float = None, screening_threshold: float = 0.5) -> dict:
    """Full cascade matching Figure 1: screen for eye/not-eye first, then
    only run the grading branch if the image passes screening.

    Unlike grade_image(), this takes an in-memory BGR array (not a file
    path) so it can be called directly from a web request handler with a
    captured/uploaded frame, and it always runs the screening stage first.
    """
    if cataract_type not in CATARACT_TYPES:
        raise ValueError(f"cataract_type must be one of {CATARACT_TYPES}, got {cataract_type!r}")

    screening = screen_eye(image_bgr, screening_model_path, threshold=screening_threshold)

    if not screening.is_eye:
        return {
            "cataract_type": cataract_type,
            "is_eye": False,
            "screening_confidence": screening.confidence,
            "grade": None,
            "grade_label": "Not an eye image - re-capture required",
            "confidence": None,
            "explainability_overlay": None,
            "monitor": False,
        }

    if cataract_type == "nuclear":
        if not model_path:
            raise ValueError("nuclear grading requires model_path to vgg11.tflite")
        result = run_nuclear(image_bgr, model_path, px_per_mm=px_per_mm)
    elif cataract_type == "cortical":
        result = run_cortical(image_bgr, px_per_mm=px_per_mm)
    else:
        result = run_psc(image_bgr, px_per_mm=px_per_mm)

    result["is_eye"] = True
    result["screening_confidence"] = screening.confidence
    return result


def main():
    parser = argparse.ArgumentParser(description="OptiScan cataract grading pipeline")
    parser.add_argument("--image", required=True, help="Path to input image")
    parser.add_argument("--type", required=True, choices=CATARACT_TYPES,
                         help="Which cataract pathway to run")
    parser.add_argument("--model", default=None, help="Path to vgg11.tflite (nuclear only)")
    parser.add_argument("--px-per-mm", type=float, default=None,
                         help="Device calibration constant (cortical/psc). "
                              "Without this, results use an approximate fallback.")
    parser.add_argument("--out-overlay", default=None,
                         help="Optional path to save the explainability overlay image")
    args = parser.parse_args()

    result = grade_image(args.image, args.type, model_path=args.model, px_per_mm=args.px_per_mm)

    overlay = result.pop("explainability_overlay")
    for k, v in result.items():
        print(f"{k}: {v}")

    if args.out_overlay:
        cv2.imwrite(args.out_overlay, overlay)
        print(f"\nExplainability overlay saved to: {args.out_overlay}")


if __name__ == "__main__":
    main()
