"""
Augmentation for the small (1-2 images/grade) cataract datasets.

Important caveat to keep in front of whoever reads results from this
pipeline: augmentation multiplies VARIANCE around the same handful of real
eyes, it does not create new clinical diversity. 100 augmented copies of
1 real grade-4 image will make training more stable and reduce
overfitting to pixel-level noise, but the model still has only ever "seen"
1 real case of grade 4 — generalization claims should be scoped
accordingly.

Augmentations are chosen to reflect REALISTIC slit-lamp/retro-illum
capture variance (device positioning, exposure, focus) rather than
generic image augmentations that could distort clinically meaningful
features:
  - small rotations / flips: patient/device positioning varies
  - brightness/contrast jitter: flash exposure and ambient light vary
  - mild Gaussian noise: sensor noise varies across devices/sessions
  - mild elastic/optical distortion: slight capture-angle variation

Deliberately AVOIDED: aggressive color shifts (lens color IS the nuclear
grading signal — don't distort it), heavy blur (destroys the fine cortical
spoke / PSC feathering detail those pathways depend on), and cutout/erasing
(could remove the exact opacity region being graded).
"""
import albumentations as A
import numpy as np


def build_augmentation_pipeline(cataract_type: str = "nuclear") -> A.Compose:
    """
    Args:
        cataract_type: "nuclear", "cortical", or "psc" — slightly different
            augmentation strength since nuclear grading is sensitive to lens
            COLOR (keep photometric jitter mild) while cortical/PSC grading
            is sensitive to fine SPATIAL detail (keep geometric distortion mild).
    """
    if cataract_type == "nuclear":
        return A.Compose([
            A.Rotate(limit=15, border_mode=0, p=0.7),
            A.HorizontalFlip(p=0.5),
            A.RandomBrightnessContrast(brightness_limit=0.15, contrast_limit=0.15, p=0.6),
            A.GaussNoise(std_range=(0.02, 0.06), p=0.3),
            A.Affine(scale=(0.95, 1.05), translate_percent=(0.0, 0.03), p=0.5),
        ])
    else:  # cortical / psc: preserve fine radial/disc structure more carefully
        return A.Compose([
            A.Rotate(limit=10, border_mode=0, p=0.7),
            A.HorizontalFlip(p=0.5),
            A.RandomBrightnessContrast(brightness_limit=0.1, contrast_limit=0.1, p=0.5),
            A.GaussNoise(std_range=(0.01, 0.03), p=0.25),
            A.Affine(scale=(0.97, 1.03), translate_percent=(0.0, 0.02), p=0.4),
        ])


def augment_image_set(image: np.ndarray, cataract_type: str, n_variants: int = 50,
                       seed: int = 42) -> list:
    """Generate n_variants augmented copies of a single source image."""
    pipeline = build_augmentation_pipeline(cataract_type)
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n_variants):
        augmented = pipeline(image=image)["image"]
        out.append(augmented)
    return out


def augment_manifest(manifest: list, image_loader, cataract_type: str,
                      n_variants_per_image: int = 50) -> list:
    """
    Args:
        manifest: list of dicts with at least "path" and "standard_grade".
        image_loader: callable(path) -> np.ndarray (BGR image), e.g. cv2.imread.
        cataract_type: passed through to build_augmentation_pipeline.
        n_variants_per_image: how many synthetic copies per source image.

    Returns:
        New manifest list (does NOT mutate input) where each entry has an
        added "image" key holding the augmented np.ndarray, and
        "is_augmented" bool flag. Original images are included once each
        with is_augmented=False, PLUS n_variants_per_image augmented copies
        with is_augmented=True — so callers can exclude augmented copies
        from validation folds if desired (recommended: augment only the
        TRAIN split, never validation/test, per data/split.py's docstring).
    """
    out = []
    for entry in manifest:
        img = image_loader(entry["path"])
        base = dict(entry)
        base["image"] = img
        base["is_augmented"] = False
        out.append(base)

        variants = augment_image_set(img, cataract_type, n_variants=n_variants_per_image)
        for v in variants:
            aug_entry = dict(entry)
            aug_entry["image"] = v
            aug_entry["is_augmented"] = True
            out.append(aug_entry)

    return out
