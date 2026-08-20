"""
Model 2 — Cortical cataract grading (Wisconsin protocol).

This is deliberately NOT a learned model. Given the cortical opacity mask
from roi/cortical_polar.py, grading here is a deterministic geometric
measurement against the published Wisconsin grid + formula — no training
data is needed and none of the "SVM vs CNN, not enough data" concern
applies to this pathway.

Grid geometry (Fig. 3a in the protocol):
  - Central circle: radius 2mm  -> zone "A" (center disc)
  - Inner circle:   radius 5mm  -> ring between central and inner = zone "B"
  - Outer circle:   radius 8mm  -> ring between inner and outer   = zone "C"
  - 8 radial spokes (at 10:30, 12:00, 1:30, 3:00, 4:30, 6:00, 7:30, 9:00)
    divide the B and C rings into 8 subfields each -> 1 (A) + 8 (B) + 8 (C)
    = 17 sections total.

Formula:
    Total area% = area%_A * 0.0762 + area%_B * 0.0410 + area%_C * 0.0625

Grade thresholds (Total area%):
    Grade 1: < 5%
    Grade 2: 5 - 25%
    Grade 3: > 25%

We also expose the WHO/LOCS-style circumferential COR-0..3 grading and the
central-zone (CEN) yes/no flag described in the protocol, since both are
standard alongside the area-based grade and cost nothing extra once we
have the mask + geometry.
"""
from dataclasses import dataclass
import numpy as np
import cv2


MM_PER_PX_DEFAULT = None  # must be supplied via device calibration; see note below

CENTRAL_RADIUS_MM = 2.0
INNER_RADIUS_MM = 5.0
OUTER_RADIUS_MM = 8.0

AREA_WEIGHT_A = 0.0762
AREA_WEIGHT_B = 0.0410
AREA_WEIGHT_C = 0.0625


@dataclass
class CorticalGradingResult:
    area_pct_A: float
    area_pct_B: float
    area_pct_C: float
    total_area_pct: float
    area_grade: int          # 1, 2, or 3 per Wisconsin total-area thresholds
    circumference_grade: str  # "COR-0".."COR-3" or "9" (cannot grade)
    central_zone_involved: bool
    zone_mask_overlay: np.ndarray  # visualization: grid + opacity overlay


def _mm_to_px(mm: float, px_per_mm: float) -> float:
    return mm * px_per_mm


def _radial_octant_masks(shape, center, r_inner_px, r_outer_px) -> list:
    """8 pie-slice masks between r_inner_px and r_outer_px, split at the
    8 clock positions listed in the protocol (i.e. 45-degree octants,
    offset so boundaries fall AT 12/1:30/3:00/etc, matching the spokes)."""
    h, w = shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    dx, dy = xx - center[0], yy - center[1]
    r = np.sqrt(dx ** 2 + dy ** 2)
    theta = (np.degrees(np.arctan2(dy, dx)) + 360) % 360  # 0=east, clockwise

    ring = (r >= r_inner_px) & (r < r_outer_px)
    masks = []
    for i in range(8):
        lo, hi = i * 45, (i + 1) * 45
        octant = (theta >= lo) & (theta < hi)
        masks.append(ring & octant)
    return masks


def compute_wisconsin_grade(opacity_mask: np.ndarray, center: tuple,
                             lens_radius_px: float,
                             px_per_mm: float = None) -> CorticalGradingResult:
    """
    Args:
        opacity_mask: binary (0/255 or 0/1) cortical opacity mask, same
            shape as the lens ROI, from roi/cortical_polar.py.
        center: (cx, cy) pupil center in the same coordinate space.
        lens_radius_px: measured lens radius in pixels (from retro_roi.py's
            CircleROI.radius), used as a fallback calibration if px_per_mm
            isn't supplied.
        px_per_mm: pixels-per-millimeter calibration constant for the
            capture device. REQUIRED for clinically meaningful mm-based
            zone boundaries — if you don't have this yet, this function
            falls back to treating the measured lens_radius_px as the
            8mm outer zone boundary, which is an approximation, not a true
            calibration. Get the real px/mm constant from your device's
            geometry/spec sheet or a calibration target shot and pass it
            in explicitly as soon as you have it.
    """
    mask_bin = (opacity_mask > 0).astype(np.uint8)

    if px_per_mm is None:
        # Fallback: assume the detected lens radius corresponds to the
        # 8mm outer Wisconsin zone. This is a reasonable approximation for
        # a first pass but should be replaced with a real device
        # calibration constant before this is used for anything clinical.
        px_per_mm = lens_radius_px / OUTER_RADIUS_MM

    r_central_px = _mm_to_px(CENTRAL_RADIUS_MM, px_per_mm)
    r_inner_px = _mm_to_px(INNER_RADIUS_MM, px_per_mm)
    r_outer_px = _mm_to_px(OUTER_RADIUS_MM, px_per_mm)

    h, w = mask_bin.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    r = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2)

    zone_A = r < r_central_px
    zone_B_octants = _radial_octant_masks(mask_bin.shape, center, r_central_px, r_inner_px)
    zone_C_octants = _radial_octant_masks(mask_bin.shape, center, r_inner_px, r_outer_px)

    def pct(zone_mask):
        total = zone_mask.sum()
        if total == 0:
            return 0.0
        return 100.0 * (mask_bin.astype(bool) & zone_mask).sum() / total

    area_pct_A = pct(zone_A)
    area_pct_B = float(np.mean([pct(m) for m in zone_B_octants]))
    area_pct_C = float(np.mean([pct(m) for m in zone_C_octants]))

    total_area_pct = (
        area_pct_A * AREA_WEIGHT_A
        + area_pct_B * AREA_WEIGHT_B
        + area_pct_C * AREA_WEIGHT_C
    )

    if total_area_pct < 5.0:
        area_grade = 1
    elif total_area_pct <= 25.0:
        area_grade = 2
    else:
        area_grade = 3

    circumference_grade, central_involved = _circumferential_grade(
        mask_bin, center, r_central_px, r_outer_px
    )

    overlay = _draw_zone_overlay(mask_bin, center, r_central_px, r_inner_px, r_outer_px)

    return CorticalGradingResult(
        area_pct_A=area_pct_A, area_pct_B=area_pct_B, area_pct_C=area_pct_C,
        total_area_pct=total_area_pct, area_grade=area_grade,
        circumference_grade=circumference_grade,
        central_zone_involved=central_involved,
        zone_mask_overlay=overlay,
    )


def _circumferential_grade(mask_bin, center, r_central_px, r_outer_px) -> tuple:
    """WHO/LOCS-style COR-0..3 grading by fraction of the circumference
    (0-360 degrees) touched by opacity anywhere within the graded radius,
    plus the CEN (central 3mm zone involvement) yes/no flag."""
    h, w = mask_bin.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    dx, dy = xx - center[0], yy - center[1]
    r = np.sqrt(dx ** 2 + dy ** 2)
    theta_deg = (np.degrees(np.arctan2(dy, dx)) + 360) % 360

    within_graded_zone = r < r_outer_px
    opacity_here = mask_bin.astype(bool) & within_graded_zone

    n_bins = 360
    bin_idx = np.clip((theta_deg / 360.0 * n_bins).astype(int), 0, n_bins - 1)
    touched = np.zeros(n_bins, dtype=bool)
    touched_bins = np.unique(bin_idx[opacity_here])
    touched[touched_bins] = True
    frac = touched.mean()

    if frac < 1 / 8:
        grade = "COR-0"
    elif frac < 1 / 4:
        grade = "COR-1"
    elif frac < 1 / 2:
        grade = "COR-2"
    else:
        grade = "COR-3"

    # CEN: central 3mm-diameter zone (radius 1.5mm) involvement.
    r_cen_px = r_central_px * (1.5 / CENTRAL_RADIUS_MM)
    central_zone = r < r_cen_px
    central_involved = bool((mask_bin.astype(bool) & central_zone).any())

    return grade, central_involved


def _draw_zone_overlay(mask_bin, center, r_central_px, r_inner_px, r_outer_px) -> np.ndarray:
    """RGB visualization: Wisconsin grid lines + detected opacity in red,
    for the explainability step (Model 2/3 don't need Grad-CAM — the exact
    opacity mask + grid IS the explanation)."""
    h, w = mask_bin.shape[:2]
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    canvas[mask_bin.astype(bool)] = (0, 0, 255)  # opacity in red (BGR)

    center_i = (int(center[0]), int(center[1]))
    for r_px, color in [(r_central_px, (0, 255, 0)),
                         (r_inner_px, (0, 255, 255)),
                         (r_outer_px, (255, 255, 0))]:
        cv2.circle(canvas, center_i, int(r_px), color, 1, lineType=cv2.LINE_AA)

    for i in range(8):
        angle = np.radians(i * 45)
        x1 = int(center[0] + r_central_px * np.cos(angle))
        y1 = int(center[1] + r_central_px * np.sin(angle))
        x2 = int(center[0] + r_outer_px * np.cos(angle))
        y2 = int(center[1] + r_outer_px * np.sin(angle))
        cv2.line(canvas, (x1, y1), (x2, y2), (255, 255, 0), 1, lineType=cv2.LINE_AA)

    return canvas
