"""
Algorithm 2 & 3 — ROI Gathering for Retro-illumination images.

Used for the CORTICAL and POSTERIOR SUBCAPSULAR (PSC) pathways, both of
which are photographed on retro-illumination (red reflex), unlike nuclear
which uses direct slit-lamp illumination (see slit_lamp_roi.py).

Pipeline (per the algorithm description, section 2.3.1):
  1. Minimum-circumscribed-circle segmentation to get a coarse eyeball crop.
  2. Bright-spot (flash reflection) removal via a simple 3-way color
     clustering ("yellow class" = normal red-reflex tissue tone), so
     specular highlights don't get mistaken for opacity/lens boundary later.
  3. Hough circle transform on the cleaned grayscale image for a precise
     final eyeball/lens localization.

This module gives you the retro-illum ROI crop. The subsequent
cortical-specific polar-transform edge detection (still Algorithm 2/3, but
the feature-extraction half) lives in cortical_polar.py, since it's really
a distinct step that only the cortical pathway needs — PSC just needs the
clean, well-localized ROI from this module plus the mm-diameter measurement
in grading/psc_measure.py.
"""
from dataclasses import dataclass

import numpy as np
import cv2


@dataclass
class EllipseROI:
    cx: float
    cy: float
    major: float      # full major axis
    minor: float      # full minor axis
    angle: float      # degrees
    bbox: tuple


@dataclass
class CircleROI:
    cx: int
    cy: int
    radius: int
    bbox: tuple  # (x, y, w, h)


def _min_enclosing_circle_crop(image_bgr: np.ndarray) -> CircleROI:
    """Coarse eyeball localization via Otsu threshold + largest contour."""
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, bw = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        h, w = gray.shape
        return CircleROI(cx=w // 2, cy=h // 2, radius=min(h, w) // 2,
                          bbox=(0, 0, w, h))
    largest = max(contours, key=cv2.contourArea)
    (cx, cy), radius = cv2.minEnclosingCircle(largest)
    cx, cy, radius = int(cx), int(cy), int(radius)
    x0, y0 = max(0, cx - radius), max(0, cy - radius)
    return CircleROI(cx=cx, cy=cy, radius=radius,
                      bbox=(x0, y0, 2 * radius, 2 * radius))


def remove_bright_spots(image_bgr: np.ndarray, k: int = 3,
                         bright_thresh: int = 235) -> np.ndarray:
    """
    Flash-reflection removal via lightweight color clustering.

    The original algorithm description clusters all pixels into 3 colour
    classes and fills the bright-spot class with the mean of the
    'normal tissue' (red-reflex / yellow-ish) class. A full pairwise
    nearest-neighbour agglomerative pass over every pixel (as literally
    described) is O(n^2) and infeasible at image resolution, so this uses
    K-means (k=3) as the standard, numerically equivalent way to get the
    same 3-cluster partition, then fills any cluster whose mean brightness
    exceeds `bright_thresh` (i.e. the flash highlight cluster) with the
    mean colour of the next-brightest, non-blown-out cluster.
    """
    img = image_bgr.copy()
    h, w = img.shape[:2]
    samples = img.reshape(-1, 3).astype(np.float32)
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 0.5)
    _, labels, centers = cv2.kmeans(
        samples, k, None, criteria, attempts=5, flags=cv2.KMEANS_PP_CENTERS
    )
    labels = labels.flatten()
    brightness = centers.mean(axis=1)  # per-cluster mean brightness
    bright_clusters = np.where(brightness > bright_thresh)[0]
    if len(bright_clusters) == 0:
        return img  # no blown-out highlights detected, nothing to fix
    normal_clusters = [c for c in range(k) if c not in bright_clusters]
    if not normal_clusters:
        return img  # degenerate case (whole image blown out); leave as-is
    fill_color = centers[max(normal_clusters, key=lambda c: brightness[c])]
    out = samples.copy()
    for c in bright_clusters:
        out[labels == c] = fill_color
    return out.reshape(h, w, 3).astype(np.uint8)


def _hough_circle_refine(image_bgr: np.ndarray, coarse: CircleROI,
                          max_center_shift_frac: float = 0.35) -> CircleROI:
    """
    Refine localization using Hough ONLY inside a window around the coarse
    ROI (padded), rather than the whole frame. Retro-illumination images
    have soft, gradient edges, so an unconstrained Hough search tends to
    lock onto a smaller, higher-contrast inner ring instead of the true
    outer disc. We therefore (a) restrict the search window, and (b) fall
    back to the coarse circle if the best Hough hit still drifts too far
    from the coarse estimate.
    """
    h, w = image_bgr.shape[:2]
    pad = int(coarse.radius * 0.20)
    x0 = max(0, coarse.cx - coarse.radius - pad)
    y0 = max(0, coarse.cy - coarse.radius - pad)
    x1 = min(w, coarse.cx + coarse.radius + pad)
    y1 = min(h, coarse.cy + coarse.radius + pad)
    crop = image_bgr[y0:y1, x0:x1]

    gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    gray = cv2.medianBlur(gray, 5)
    gray = cv2.GaussianBlur(gray, (9, 9), 2)

    circles = cv2.HoughCircles(
        gray,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=gray.shape[0],
        param1=80,
        param2=22,
        minRadius=int(coarse.radius * 0.75),
        maxRadius=int(coarse.radius * 1.10),
    )
    if circles is None:
        return coarse  # Hough found nothing better; keep the coarse circle

    circles = np.round(circles[0]).astype(int)

    best = None
    best_score = float("inf")
    for cx, cy, r in circles:
        global_x, global_y = cx + x0, cy + y0
        score = np.hypot(global_x - coarse.cx, global_y - coarse.cy) + abs(r - coarse.radius)
        if score < best_score:
            best_score = score
            best = (global_x, global_y, r)

    cx, cy, r = best

    # Sanity check: if Hough's pick drifted too far from the coarse
    # (contour-based) estimate, it likely locked onto the wrong ring —
    # trust the coarse circle instead.
    center_shift = np.hypot(cx - coarse.cx, cy - coarse.cy)
    if center_shift > coarse.radius * max_center_shift_frac:
        return coarse

    return CircleROI(int(cx), int(cy), int(r),
                      (max(0, cx - r), max(0, cy - r), 2 * r, 2 * r))


def detect_lens_roi_retro(image_bgr: np.ndarray) -> tuple:
    """
    Main entry point for Algorithm 2/3's localization stage.

    Returns:
        (cleaned_image, CircleROI) — cleaned_image has flash highlights
        removed (full frame, same size as input); CircleROI is the refined
        eyeball/lens circle in that cleaned image's coordinate space.
    """
    coarse = _min_enclosing_circle_crop(image_bgr)
    cleaned = remove_bright_spots(image_bgr)
    refined = _hough_circle_refine(cleaned, coarse)
    return cleaned, refined


def crop_to_circle(image_bgr: np.ndarray, roi: CircleROI, pad_frac: float = 0.05) -> np.ndarray:
    h_img, w_img = image_bgr.shape[:2]
    pad = int(roi.radius * pad_frac)
    x0 = max(0, roi.cx - roi.radius - pad)
    y0 = max(0, roi.cy - roi.radius - pad)
    x1 = min(w_img, roi.cx + roi.radius + pad)
    y1 = min(h_img, roi.cy + roi.radius + pad)
    return image_bgr[y0:y1, x0:x1]


def circular_mask(shape, roi: CircleROI) -> np.ndarray:
    h, w = shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    return (xx - roi.cx) ** 2 + (yy - roi.cy) ** 2 <= roi.radius ** 2