# OptiScan — Cataract Grading Pipeline

Working scaffold for all 5 tasks. Classical-CV pathways (cortical, PSC) are
fully functional and tested. The nuclear pathway's plumbing (ROI → tflite
inference → Score-CAM → confidence) is tested against a placeholder model —
**upload your real `vgg11.tflite` and point `--model` at it to go live.**

## Status by task

| Task | Status |
|---|---|
| 1. Train/test split | Done — `data/split.py` (stratified + leave-one-out) |
| 2. Augmentation | Done — `augmentation/augment.py` |
| 3. Nuclear/Cortical/PSC grading | Nuclear plumbing tested w/ placeholder model; Cortical & PSC fully tested on synthetic images |
| 4. Type-select → grade → monitor flag | Done — `pipeline.py` |
| 5. Explainability + confidence | Score-CAM (nuclear) + exact opacity-mask overlay (cortical/PSC) tested |

## First thing to do

```bash
pip install --break-system-packages opencv-python-headless scipy scikit-learn \
    scikit-image albumentations ai-edge-litert
```

Then, with your real `vgg11.tflite`:

```python
from grading.nuclear_vgg11 import VGG11TFLiteBackbone
backbone = VGG11TFLiteBackbone("vgg11.tflite")
print(backbone.describe())
```

**Run this first, before anything else.** It tells you the model's real
input size, dtype (float vs quantized uint8), and output shape (7 classes
for 0-6? something else?). `nuclear_vgg11.py` has a couple of assumptions
flagged inline (`/255` normalization, softmax-vs-logits output) that you
should confirm/fix against what `describe()` reports.

## Running it

```bash
# Cortical (fully deterministic, no model needed)
python pipeline.py --image sample.jpg --type cortical

# PSC (fully deterministic, no model needed)
python pipeline.py --image sample.jpg --type psc

# Nuclear (needs your real vgg11.tflite)
python pipeline.py --image sample.jpg --type nuclear --model vgg11.tflite
```

## What's genuinely done vs. what needs your input

**Done and tested:**
- Algorithm 1 (slit-lamp ellipse-fit ROI) — `roi/slit_lamp_roi.py`
- Algorithm 2/3 (retro-illum min-circle + bright-spot removal + Hough) — `roi/retro_roi.py`
- Cortical polar-transform opacity detection — `roi/cortical_polar.py`
- Wisconsin 17-zone grading formula + COR/CEN grading — `grading/cortical_wisconsin.py`
- PSC vertical-diameter measurement + WHO thresholds — `grading/psc_measure.py`
- Score-CAM (gradient-free, works on `.tflite` black box) — `grading/nuclear_vgg11.py`
- Temperature-scaling confidence calibration — `grading/nuclear_vgg11.py`
- Augmentation (type-aware: photometric-light for nuclear, geometric-light for cortical/PSC) — `augmentation/augment.py`
- 3-scale grade harmonization (0-6 / LOCS-C / LOCS-P → one target) — `data/grade_scale_mapping.py`
- Stratified split + leave-one-out CV — `data/split.py`

**Needs your input before this is clinically meaningful:**
1. **`px_per_mm` calibration constant** for your capture device — cortical
   and PSC grading currently fall back to an approximation (assumes lens
   radius = 8mm / 4.5mm respectively) when this isn't supplied. Get the
   real constant from your device's optics spec or a calibration target
   shot, then pass `--px-per-mm <value>`.
2. **`vgg11.tflite`'s actual I/O signature** — run `backbone.describe()`
   above and fix the preprocessing assumptions flagged in
   `nuclear_vgg11.py` if they don't match.
3. **Grade-scale crosswalk sanity check** — the LOCS→standard-0-6 mapping
   in `grade_scale_mapping.py` is my best reading of the bands you
   described, not a validated clinical crosswalk. Have this checked before
   training on it.
4. **Cortical/PSC detection thresholds** (`radial_thresh`,
   `angular_suppress_thresh`, Otsu-based dark-blob detection) were tuned
   against a synthetic test image, not real slit-lamp/retro-illum photos —
   expect to retune against your actual images' contrast/exposure profile.

## Honest framing for whatever writeup this feeds

With 1-2 images per grade, any accuracy number from the nuclear classifier
will have wide uncertainty — report it as a proof-of-concept pipeline
validated on a small annotated set, with leave-one-out CV (not a single
train/test split) as the evaluation method, rather than a clinically
validated tool. See docstrings in `data/split.py` and
`augmentation/augment.py` for why.

## Recommended nuclear training approach (not yet implemented — next step)

Given the sample size, don't fine-tune all of VGG11's weights. Instead:
1. Run every (augmented) training image through `VGG11TFLiteBackbone` and
   pull an embedding (currently a placeholder in `NuclearGradingResult.embedding`
   — needs the real model's penultimate-layer tap wired in once you know
   its architecture from `describe()`).
2. Train a small classifier (SVM / logistic regression, NOT deep) on those
   embeddings against the harmonized 0-6 grade.
3. Given the ordinal nature of the grades, consider an ordinal-aware loss
   (e.g. CORN) over plain multi-class softmax if you end up training any
   layer end-to-end rather than just a linear head.

I can build this training script next once you upload the real
`vgg11.tflite` and confirm its I/O signature.
