"""
Your dataset mixes THREE different nuclear grading scales:

  1. "Standard" 0-6 grading            -> already the canonical target, used as-is.
  2. LOCS III 0-5, with WHO-equivalent bands:
        C0.1-C1.9  ~ LOCS grade 1
        C2.0-C3.9  ~ LOCS grade 2
        C4.0-C5.9+ ~ LOCS grade 3
  3. A second LOCS III 0-5 scale (the "P" scale in your notes),
     same band structure:
        P0.1-P1.9  ~ LOCS grade 1
        P2.0-P3.9  ~ LOCS grade 2
        P4.0-P5.9+ ~ LOCS grade 3

Before training the classifier head in nuclear_vgg11.py, every image's
label needs to land on ONE consistent ordinal scale, or the classifier
will be trained against contradictory targets (e.g. "grade 2" meaning
mild in one scale and moderate in another).

This module maps everything onto the 0-6 scale (since that's your
finest-grained / "standard" scale) using the WHO-equivalence bands you
provided. This is a coarse mapping — LOCS grade "1-ish" spans what would
be roughly standard grades 1-2, "2-ish" spans roughly 3-4, "3-ish" spans
roughly 5-6 — flag this coarseness explicitly in any report, since it's an
approximation from band overlap, not a validated cross-walk.

IMPORTANT: You (or your clinical collaborator) should sanity-check the
exact mapping below against the specific images before training on it —
this encodes MY best reading of the band correspondences you described,
not a clinically validated crosswalk.
"""
from enum import Enum


class SourceScale(Enum):
    STANDARD_0_6 = "standard_0_6"
    LOCS_C = "locs_c_0_5"   # your second dataset (C-prefixed WHO decimal grades)
    LOCS_P = "locs_p_0_5"   # your third dataset (P-prefixed WHO decimal grades)


# Coarse LOCS-grade -> standard 0-6 grade midpoint mapping.
# LOCS "1-ish" (grade 1) -> standard ~1-2, use 2 as a slightly conservative
#   midpoint since C/P1.9 is near the top of that band.
# LOCS "2-ish" (grade 2) -> standard ~3-4, use 4.
# LOCS "3-ish" (grade 3) -> standard ~5-6, use 6.
_LOCS_TO_STANDARD_MIDPOINT = {
    0: 0,
    1: 2,
    2: 4,
    3: 6,
}


def locs_decimal_to_locs_grade(decimal_value: float) -> int:
    """e.g. C2.4 -> pass decimal_value=2.4 -> returns LOCS grade 2 (2.0-3.9 band)."""
    if decimal_value < 0.1:
        return 0
    if decimal_value < 2.0:
        return 1
    if decimal_value < 4.0:
        return 2
    return 3


def to_standard_grade(source_scale: SourceScale, raw_value) -> int:
    """
    Args:
        source_scale: which of your three source datasets this label came from.
        raw_value: for STANDARD_0_6, an int 0-6. For LOCS_C / LOCS_P, either
            the raw WHO decimal (e.g. 2.4) or an already-bucketed LOCS grade
            (0-3) — both are accepted; decimals are detected automatically.

    Returns:
        int, the harmonized standard-scale grade (0-6), for use as the
        training target across all three source datasets.
    """
    if source_scale == SourceScale.STANDARD_0_6:
        grade = int(round(raw_value))
        if not 0 <= grade <= 6:
            raise ValueError(f"Standard-scale grade must be 0-6, got {raw_value}")
        return grade

    # LOCS_C / LOCS_P: normalize to a LOCS grade 0-3 first.
    if isinstance(raw_value, float) or (isinstance(raw_value, (int,)) and raw_value > 3):
        locs_grade = locs_decimal_to_locs_grade(float(raw_value))
    else:
        locs_grade = int(raw_value)
        if not 0 <= locs_grade <= 3:
            raise ValueError(f"LOCS grade must be 0-3, got {raw_value}")

    return _LOCS_TO_STANDARD_MIDPOINT[locs_grade]


def build_label_manifest(entries: list) -> list:
    """
    Convenience batch helper.

    Args:
        entries: list of dicts like
            {"path": "img001.jpg", "scale": SourceScale.LOCS_C, "raw_value": 2.4}

    Returns:
        Same list with an added "standard_grade" key on each entry, ready
        to feed into data/split.py for stratified splitting.
    """
    out = []
    for e in entries:
        e = dict(e)
        e["standard_grade"] = to_standard_grade(e["scale"], e["raw_value"])
        out.append(e)
    return out
