"""
Train/test split for the nuclear grading dataset.

With ~1-2 images per grade, a single fixed train/test split gives a very
noisy, unstable performance estimate — whichever 1-2 images happen to land
in "test" could make the model look great or terrible by chance. Two
strategies are offered here:

  1. stratified_split(): a standard one-shot stratified split, for when
     you just need a train/test partition to build/debug the pipeline.
     With this little data, treat any accuracy number from this as
     illustrative only, not a real generalization estimate.

  2. leave_one_out_splits(): generates N splits (N = number of images),
     each holding out exactly 1 image for testing and training on the
     rest. This is the recommended evaluation strategy for a dataset this
     size — averaging performance across all N folds uses every image for
     both training and testing at some point, giving a much more stable
     estimate than one fixed split. This is standard practice for small
     medical-imaging datasets.

Both operate on the harmonized manifest produced by
grade_scale_mapping.build_label_manifest (a list of dicts with at least
"path" and "standard_grade" keys).
"""
import random
from collections import defaultdict


def stratified_split(manifest: list, test_frac: float = 0.2, seed: int = 42) -> tuple:
    """Returns (train_manifest, test_manifest), attempting to keep at
    least 1 example per grade in train whenever a grade has >=2 examples,
    with the remainder allocated to test."""
    rng = random.Random(seed)
    by_grade = defaultdict(list)
    for e in manifest:
        by_grade[e["standard_grade"]].append(e)

    train, test = [], []
    for grade, items in by_grade.items():
        items = items[:]
        rng.shuffle(items)
        if len(items) == 1:
            # Only one example for this grade: keep it in train, since a
            # grade with zero training examples is worse than a grade with
            # zero test examples for this exercise.
            train.extend(items)
            continue
        n_test = max(1, round(len(items) * test_frac))
        n_test = min(n_test, len(items) - 1)  # always leave >=1 for train
        test.extend(items[:n_test])
        train.extend(items[n_test:])

    return train, test


def leave_one_out_splits(manifest: list):
    """Generator yielding (train_manifest, [held_out_item]) for each item
    in the manifest in turn. Use this for evaluation; average whatever
    metric you care about (accuracy, MAE against the ordinal grade, etc.)
    across all yielded folds for a much more reliable estimate than a
    single stratified_split() on a dataset this size."""
    for i in range(len(manifest)):
        held_out = [manifest[i]]
        train = manifest[:i] + manifest[i + 1:]
        yield train, held_out


def summarize_split(manifest: list, name: str = "split") -> str:
    by_grade = defaultdict(int)
    for e in manifest:
        by_grade[e["standard_grade"]] += 1
    counts = ", ".join(f"grade {g}: {n}" for g, n in sorted(by_grade.items()))
    return f"{name} (n={len(manifest)}): {counts}"
