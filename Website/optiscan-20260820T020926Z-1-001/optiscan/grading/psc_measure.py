"""
Model 3 — Posterior Subcapsular Cataract (PSC) grading.

Also NOT a learned model — PSC grading per the WHO/LOCS protocol reduces to
a single geometric measurement: the vertical diameter (mm) of the central,
most well-defined PSC opacity disc, thresholded against fixed cutoffs. No
training data required.

Grade thresholds (vertical diameter):
    Grade 0:  < 1.0 mm
    Grade 1:  1.0 - < 2.0 mm   ("case")
    Grade 2:  2.0 - < 3.0 mm   ("progression which may require surgery")
    Grade 3:  >= 3.0 mm         ("usually requires surgery")
    Grade 9:  cannot grade (posterior capsule not visualizable — usually
              because advanced nuclear or cortical opacity blocks the red
              reflex; see `visualizable` flag below)

Detection approach: PSC has a "feathered"/lacy central disc appearance in
retro-illumination, in contrast to cortical's sharp radial spokes. We
isolate it as the largest reasonably-central, reasonably-round dark blob
near the posterior pole (image/lens center) that's NOT already claimed by
the cortical radial-spoke mask, since a single image can show both cortical
spokes and a central PSC disc simultaneously (see Fig. 9 in the protocol).
"""
from dataclasses import dataclass
import numpy as np
import cv2


@dataclass
class PSCGradingResult:
    vertical_diameter_mm: float
    grade: str              # "0", "1", "2", "3", or "9" (cannot grade)
    visualizable: bool
    within_central_zone: bool  # at least partially within 3mm central optical zone
    opacity_mask: np.ndarray   # binary mask of the graded disc, for overlay


def _visualizability_check(lens_gray: np.ndarray, center, radius: float,
                            min_valid_frac: float = 0.35) -> bool:
    """Rough proxy for 'can we see the posterior capsule at all': if a
    large fraction of the central lens area is near-uniformly dark/blocked
    (i.e. no usable red reflex contrast), advanced NUC/COR is likely
    obscuring the view and this should be flagged Grade 9 rather than
    guessing a diameter."""
    h, w = lens_gray.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    central_zone = (xx - center[0]) ** 2 + (yy - center[1]) ** 2 <= (radius * 0.5) ** 2
    central_pixels = lens_gray[central_zone]
    if central_pixels.size == 0:
        return False
    contrast = central_pixels.std()
    return contrast > 8.0  # low std => flat/blocked => not visualizable


def detect_psc_disc(lens_gray: np.ndarray, center, radius: float,
                     cortical_mask: np.ndarray = None) -> np.ndarray:
    """Isolate the central PSC disc as a binary mask.

    Uses adaptive thresholding around the posterior pole (lens center) to
    find dark, blob-like (non-radial) regions, then excludes anything
    already attributed to the cortical spoke mask so the two pathways
    don't double-count the same opacity pixels.
    """
    h, w = lens_gray.shape[:2]
    blurred = cv2.GaussianBlur(lens_gray, (7, 7), 0)

    # Central search window: PSC must be at least partially within the
    # 3mm central optical zone per the protocol, so we don't even look
    # for candidate blobs far from center.
    yy, xx = np.mgrid[0:h, 0:w]
    search_zone = (xx - center[0]) ** 2 + (yy - center[1]) ** 2 <= (radius * 0.6) ** 2

    _, dark_mask = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    dark_mask = cv2.bitwise_and(dark_mask, (search_zone.astype(np.uint8) * 255))

    if cortical_mask is not None:
        dark_mask = cv2.bitwise_and(dark_mask, cv2.bitwise_not(cortical_mask))

    # Keep only blob-like components (roundish), not thin radial spoke
    # remnants, using solidity (area / convex-hull area) as the filter —
    # spokes are low-solidity, discs are high-solidity.
    contours, _ = cv2.findContours(dark_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    best_mask = np.zeros_like(dark_mask)
    best_score = -1
    for c in contours:
        area = cv2.contourArea(c)
        if area < 15:
            continue
        hull = cv2.convexHull(c)
        hull_area = cv2.contourArea(hull)
        if hull_area == 0:
            continue
        solidity = area / hull_area
        # distance of blob centroid from lens center, as a centrality score
        M = cv2.moments(c)
        if M["m00"] == 0:
            continue
        bx, by = M["m10"] / M["m00"], M["m01"] / M["m00"]
        dist_from_center = np.hypot(bx - center[0], by - center[1])
        centrality = 1.0 - min(dist_from_center / max(radius, 1.0), 1.0)

        score = solidity * 0.6 + centrality * 0.4
        if solidity > 0.55 and score > best_score:
            best_score = score
            best_mask = np.zeros_like(dark_mask)
            cv2.drawContours(best_mask, [c], -1, 255, thickness=-1)

    return best_mask


def measure_vertical_diameter_mm(psc_mask: np.ndarray, px_per_mm: float) -> float:
    ys, xs = np.nonzero(psc_mask)
    if len(ys) == 0:
        return 0.0
    diameter_px = ys.max() - ys.min()
    return diameter_px / px_per_mm


def grade_psc(lens_gray: np.ndarray, center: tuple, lens_radius_px: float,
              px_per_mm: float = None, cortical_mask: np.ndarray = None) -> PSCGradingResult:
    """
    Args:
        px_per_mm: REQUIRED for a clinically real mm measurement. Falls
            back to lens_radius_px assumed = ~4.5mm adult lens radius if
            not supplied — flag this in your UI as an uncalibrated
            estimate, not a real measurement, until you wire in the actual
            device calibration constant.
    """
    if px_per_mm is None:
        px_per_mm = lens_radius_px / 4.5

    visualizable = _visualizability_check(lens_gray, center, lens_radius_px)
    if not visualizable:
        return PSCGradingResult(
            vertical_diameter_mm=0.0, grade="9", visualizable=False,
            within_central_zone=False, opacity_mask=np.zeros_like(lens_gray),
        )

    psc_mask = detect_psc_disc(lens_gray, center, lens_radius_px, cortical_mask)
    diameter_mm = measure_vertical_diameter_mm(psc_mask, px_per_mm)

    h, w = lens_gray.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    central_3mm_radius_px = 1.5 * px_per_mm
    central_zone = (xx - center[0]) ** 2 + (yy - center[1]) ** 2 <= central_3mm_radius_px ** 2
    within_central_zone = bool((psc_mask.astype(bool) & central_zone).any())

    if diameter_mm < 1.0:
        grade = "0"
    elif diameter_mm < 2.0:
        grade = "1"
    elif diameter_mm < 3.0:
        grade = "2"
    else:
        grade = "3"

    return PSCGradingResult(
        vertical_diameter_mm=diameter_mm, grade=grade, visualizable=True,
        within_central_zone=within_central_zone, opacity_mask=psc_mask,
    )
