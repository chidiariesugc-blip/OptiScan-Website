"""
Algorithm 1 — ROI Gathering for Slit Lamp (direct illumination) images.

Used for the NUCLEAR cataract pathway. Nuclear cataracts are photographed
under direct slit-lamp illumination (not retro-illumination), so pupil/lens
localization here relies on edge + ellipse fitting rather than the
minimum-circle / Hough approach used for retro-illum images (see retro_roi.py).

Pipeline (per the algorithm description):
  1. Morphological open/close to denoise while preserving the lens boundary.
  2. Canny edge detection on both the original and the morphologically
     closed image.
  3. Keep only edges on the convex hull of the candidate lens region, which
     discards internal opacity edges (severe cataract) and external
     reflective noise.
  4. Non-linear least squares (Gauss-Newton) ellipse fit on the surviving
     edge pixels to recover (x_c, y_c, a, b) i.e. the pupil ellipse, which
     also naturally handles oblong (non-circular) pupils.

Output: bounding box (x, y, w, h) of the fitted ellipse, plus the ellipse
parameters themselves for anything downstream that wants the true
elliptical mask rather than a rectangular crop.
"""
from dataclasses import dataclass
import numpy as np
import cv2
from scipy.optimize import least_squares


@dataclass
class EllipseROI:
    cx: float
    cy: float
    a: float          # semi-major axis
    b: float          # semi-minor axis
    theta: float       # rotation, radians
    bbox: tuple        # (x, y, w, h) axis-aligned bounding box

    def mask(self, shape):
        """Boolean mask (H, W) of the fitted ellipse for shape (H, W)."""
        h, w = shape[:2]
        yy, xx = np.mgrid[0:h, 0:w]
        cos_t, sin_t = np.cos(self.theta), np.sin(self.theta)
        x_shift = xx - self.cx
        y_shift = yy - self.cy
        x_rot = x_shift * cos_t + y_shift * sin_t
        y_rot = -x_shift * sin_t + y_shift * cos_t
        return (x_rot / max(self.a, 1e-6)) ** 2 + (y_rot / max(self.b, 1e-6)) ** 2 <= 1.0


def _morphological_open_close(gray: np.ndarray, ksize: int = 7) -> np.ndarray:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksize, ksize))
    opened = cv2.morphologyEx(gray, cv2.MORPH_OPEN, kernel)
    closed = cv2.morphologyEx(opened, cv2.MORPH_CLOSE, kernel)
    return closed


def _convex_hull_edges(gray: np.ndarray, closed: np.ndarray,
                        canny_lo: int = 40, canny_hi: int = 120) -> np.ndarray:
    """Canny on both original and morph-closed image; keep only edge points
    that lie on the convex hull of the largest connected bright region.
    This is what discards internal opacity edges for severe cataract."""
    edges_orig = cv2.Canny(gray, canny_lo, canny_hi)
    edges_closed = cv2.Canny(closed, canny_lo, canny_hi)
    edges = cv2.bitwise_or(edges_orig, edges_closed)

    # Candidate lens region: threshold the closed image, take the largest
    # contour, and use ITS convex hull to gate which edge pixels we trust.
    _, bw = cv2.threshold(closed, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return edges  # fall back: no gating possible

    largest = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(largest)
    hull_mask = np.zeros_like(gray)
    cv2.drawContours(hull_mask, [hull], -1, 255, thickness=-1)

    # Only keep edge pixels within a thin band around the hull boundary,
    # i.e. the true lens border, not noise deep inside the opacity.
    hull_boundary = cv2.morphologyEx(
        hull_mask, cv2.MORPH_GRADIENT,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    )
    gated = cv2.bitwise_and(edges, hull_boundary)
    # If gating wiped out too much (very small/faint lens), fall back to
    # edges restricted to inside the hull generally, better than nothing.
    if np.count_nonzero(gated) < 20:
        gated = cv2.bitwise_and(edges, hull_mask)
    return gated


def _ellipse_residuals(params, xs, ys):
    cx, cy, a, b, theta = params
    cos_t, sin_t = np.cos(theta), np.sin(theta)
    x_shift = xs - cx
    y_shift = ys - cy
    x_rot = x_shift * cos_t + y_shift * sin_t
    y_rot = -x_shift * sin_t + y_shift * cos_t
    # Algebraic distance to ellipse boundary (=0 on the ellipse itself).
    return (x_rot / max(a, 1e-6)) ** 2 + (y_rot / max(b, 1e-6)) ** 2 - 1.0


def _fit_ellipse_gauss_newton(edge_points: np.ndarray, init: tuple) -> EllipseROI:
    """edge_points: (N, 2) array of (x, y). init: (cx, cy, a, b, theta)."""
    xs, ys = edge_points[:, 0], edge_points[:, 1]
    result = least_squares(
        _ellipse_residuals, x0=np.array(init, dtype=float),
        args=(xs, ys), method="lm", max_nfev=2000,
    )
    cx, cy, a, b, theta = result.x
    a, b = abs(a), abs(b)
    x0, y0 = cx - a, cy - b
    w, h = 2 * a, 2 * b
    return EllipseROI(cx=cx, cy=cy, a=a, b=b, theta=theta,
                       bbox=(int(x0), int(y0), int(w), int(h)))


def detect_lens_roi_slit_lamp(image_bgr: np.ndarray) -> EllipseROI:
    """
    Main entry point for Algorithm 1.

    Args:
        image_bgr: raw slit-lamp direct-illumination image (BGR, as read by cv2).

    Returns:
        EllipseROI with the fitted lens/pupil ellipse and its bounding box.

    Raises:
        RuntimeError if too few edge pixels survive hull-gating to fit an
        ellipse reliably (e.g. extremely low-contrast or corrupted image) —
        caller should surface this to the operator rather than silently
        cropping a wrong region.
    """
    gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY) if image_bgr.ndim == 3 else image_bgr
    gray = cv2.equalizeHist(gray)

    closed = _morphological_open_close(gray)
    edges = _convex_hull_edges(gray, closed)

    ys, xs = np.nonzero(edges)
    if len(xs) < 15:
        raise RuntimeError(
            "Too few reliable edge pixels found for ellipse fitting — "
            "check image quality/contrast before retrying."
        )
    edge_points = np.stack([xs, ys], axis=1).astype(float)

    # Initialize from the point cloud's bounding box / centroid rather than
    # a fixed guess, so Gauss-Newton starts close to the true optimum.
    cx0, cy0 = xs.mean(), ys.mean()
    a0 = max((xs.max() - xs.min()) / 2.0, 5.0)
    b0 = max((ys.max() - ys.min()) / 2.0, 5.0)
    theta0 = 0.0

    return _fit_ellipse_gauss_newton(edge_points, (cx0, cy0, a0, b0, theta0))


def crop_to_roi(image_bgr: np.ndarray, roi: EllipseROI, pad_frac: float = 0.05) -> np.ndarray:
    """Axis-aligned crop to the ellipse bbox with a small padding margin,
    clipped to image bounds."""
    h_img, w_img = image_bgr.shape[:2]
    x, y, w, h = roi.bbox
    pad_x, pad_y = int(w * pad_frac), int(h * pad_frac)
    x0 = max(0, x - pad_x)
    y0 = max(0, y - pad_y)
    x1 = min(w_img, x + w + pad_x)
    y1 = min(h_img, y + h + pad_y)
    return image_bgr[y0:y1, x0:x1]
