"""
Cortical opacity detection via polar-coordinate radial edge detection.

Rationale (per the algorithm description): cortical opacities are
spoke-like and radially oriented, which is much easier to isolate in polar
coordinates than Cartesian — a radial cortical spoke becomes a roughly
*vertical* edge in the polar image, while the PSC's central disc becomes
a horizontal/angular edge. That lets us tell the two apart, which is the
whole point (isolating cortical from PSC opacity).

Pipeline:
  1. Warp the retro-illum lens ROI to polar coordinates, centered on the
     pupil center.
  2. Vertical Sobel (radial-direction gradient) picks up cortical spokes
     AND some PSC edges.
  3. Horizontal Sobel (angular-direction gradient) picks up the PSC's
     roughly circular central disc boundary; subtracting/gating this out
     removes PSC contamination from the cortical mask.
  4. Radial morphological closing (closing along the radius axis, i.e.
     vertical in the polar image) bridges small gaps in a spoke.
  5. Warp back to Cartesian and fill holes to get the final cortical
     opacity binary mask.
"""
import numpy as np
import cv2


def to_polar(image_gray: np.ndarray, center, max_radius: float) -> np.ndarray:
    return cv2.warpPolar(
        image_gray, dsize=(int(max_radius), 360),
        center=center, maxRadius=max_radius,
        flags=cv2.WARP_POLAR_LINEAR + cv2.INTER_LINEAR,
    )


def from_polar(polar_img: np.ndarray, center, max_radius: float, out_shape) -> np.ndarray:
    return cv2.warpPolar(
        polar_img, dsize=(out_shape[1], out_shape[0]),
        center=center, maxRadius=max_radius,
        flags=cv2.WARP_POLAR_LINEAR + cv2.WARP_INVERSE_MAP + cv2.INTER_LINEAR,
    )


def detect_cortical_opacity(lens_gray: np.ndarray, center, radius: float,
                             radial_thresh: float = 30.0,
                             angular_suppress_thresh: float = 45.0) -> np.ndarray:
    """
    Returns a binary mask (uint8, 0/255), same shape as lens_gray, marking
    detected cortical opacity regions.

    Args:
        lens_gray: grayscale, ROI-cropped retro-illum lens image.
        center: (cx, cy) pupil/lens center in lens_gray's coordinates.
        radius: lens radius in pixels.
        radial_thresh: Sobel-radial-gradient magnitude threshold for "this
            is a spoke edge". Tune against your capture device's contrast.
        angular_suppress_thresh: Sobel-angular-gradient magnitude above
            which a pixel is treated as PSC-disc boundary and suppressed
            from the cortical mask.
    """
    polar = to_polar(lens_gray, center, radius)

    # Radial direction Sobel: in warpPolar output, the x-axis IS radius,
    # so the radial gradient is the horizontal Sobel here (note this is
    # the transposed convention vs. the prose description, which frames
    # angle as the horizontal axis; the math is the same either way).
    sobel_radial = cv2.Sobel(polar, cv2.CV_32F, 1, 0, ksize=3)
    sobel_angular = cv2.Sobel(polar, cv2.CV_32F, 0, 1, ksize=3)

    radial_edges = (np.abs(sobel_radial) > radial_thresh).astype(np.uint8) * 255
    angular_edges = (np.abs(sobel_angular) > angular_suppress_thresh).astype(np.uint8) * 255

    # Suppress angular (PSC-disc-like) edges from the radial edge map —
    # this is the step that separates cortical spokes from PSC opacity.
    cortical_polar = cv2.bitwise_and(radial_edges, cv2.bitwise_not(angular_edges))

    # Radial closing: close gaps along the radius axis (image x-axis here)
    # so a broken spoke edge becomes one continuous region.
    close_kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (15, 3))
    closed_polar = cv2.morphologyEx(cortical_polar, cv2.MORPH_CLOSE, close_kernel)

    # Back to Cartesian + hole fill.
    cartesian = from_polar(closed_polar, center, radius, lens_gray.shape)
    _, cartesian_bw = cv2.threshold(cartesian, 30, 255, cv2.THRESH_BINARY)

    filled = _fill_holes(cartesian_bw)
    return filled


def _fill_holes(binary_mask: np.ndarray) -> np.ndarray:
    h, w = binary_mask.shape
    flood = binary_mask.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, mask, (0, 0), 255)
    flood_inv = cv2.bitwise_not(flood)
    return cv2.bitwise_or(binary_mask, flood_inv)
