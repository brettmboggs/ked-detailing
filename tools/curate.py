#!/usr/bin/env python3
"""
Score a folder of photographs, reject the weak ones, and grade the keepers.

Built for the Instagram row on the site. Jacob photographs good cars badly:
phone shots that are soft, flat, under-exposed or heavily colour-cast. Posting
the feed verbatim would put those on the site, so everything is scored first
and only what clears the bar is published — then given the same treatment the
video grade gets, so the row looks like one body of work rather than a
camera roll.

Nothing here is a subjective "is this a nice picture" judgement. Every measure
is something you can check, and every rejection says which measure failed.

    tools/.venv/bin/python tools/curate.py <src-dir> --out <dir> --top 4

Ordinarily the source is the Instagram feed; see fetch_instagram.py. Any folder
works, which is how it is tested against the archive.
"""

from __future__ import annotations

import argparse
import json
import math
from dataclasses import dataclass, asdict, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageEnhance, ImageOps

# Anything below these is rejected outright. Tuned against the archive so that
# the known-bad frames fail and the shoot frames pass.
MIN_EDGE = 900          # px on the short side
MIN_SHARPNESS = 55.0    # variance of Laplacian, on a 1024px-normalised frame
MIN_CONTRAST = 26.0     # std dev of luminance

# Blown highlights are unrecoverable; crushed blacks are a style. Car
# photography lives in deep shadow on purpose, so the two are judged apart
# rather than added together.
MAX_BLOWN = 0.035
MAX_CRUSHED = 0.42

# Cast is measured only across near-neutral pixels. Measured across the whole
# frame, a blue van reads as a blue cast and gets thrown out for being blue.
MAX_CAST = 30.0

SUPPORTED = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass
class Measures:
    width: int
    height: int
    short_edge: int
    sharpness: float
    contrast: float
    blown: float
    crushed: float
    cast: float
    neutral_px: float
    mean_luma: float


@dataclass
class Verdict:
    name: str
    ok: bool
    score: float
    reasons: list[str] = field(default_factory=list)
    measures: Measures | None = None


def _luma(arr: np.ndarray) -> np.ndarray:
    return arr[..., 0] * 0.299 + arr[..., 1] * 0.587 + arr[..., 2] * 0.114


def _laplacian_variance(grey: np.ndarray) -> float:
    """Focus measure. A blurred frame has little high-frequency energy."""
    lap = (
        -4.0 * grey[1:-1, 1:-1]
        + grey[:-2, 1:-1]
        + grey[2:, 1:-1]
        + grey[1:-1, :-2]
        + grey[1:-1, 2:]
    )
    return float(lap.var())


def measure(path: Path) -> Measures:
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    w, h = img.size

    # Normalise before measuring focus, or big files always look sharper.
    probe = img.copy()
    probe.thumbnail((1024, 1024), Image.LANCZOS)
    arr = np.asarray(probe, dtype=np.float64)
    grey = _luma(arr)

    blown = float((grey >= 251).mean())
    crushed = float((grey <= 4).mean())

    # Near-neutral pixels only: low channel spread relative to their own
    # brightness, and not sitting at either end of the range.
    flat = arr.reshape(-1, 3)
    spread = flat.max(axis=1) - flat.min(axis=1)
    lum = flat.mean(axis=1)
    neutral = (spread < np.maximum(lum * 0.22, 12)) & (lum > 25) & (lum < 235)
    neutral_frac = float(neutral.mean())
    if neutral.sum() > 500:
        means = flat[neutral].mean(axis=0)
        cast = float(means.max() - means.min())
    else:
        # Not enough neutral reference to judge; do not reject on it.
        cast = 0.0

    return Measures(
        width=w,
        height=h,
        short_edge=min(w, h),
        sharpness=round(_laplacian_variance(grey), 2),
        contrast=round(float(grey.std()), 2),
        blown=round(blown, 4),
        crushed=round(crushed, 4),
        cast=round(cast, 2),
        neutral_px=round(neutral_frac, 3),
        mean_luma=round(float(grey.mean()), 2),
    )


def judge(name: str, m: Measures) -> Verdict:
    reasons: list[str] = []
    if m.short_edge < MIN_EDGE:
        reasons.append(f"too small ({m.short_edge}px short edge)")
    if m.sharpness < MIN_SHARPNESS:
        reasons.append(f"soft (focus {m.sharpness:.0f})")
    if m.blown > MAX_BLOWN:
        reasons.append(f"blown highlights ({m.blown * 100:.0f}%)")
    if m.crushed > MAX_CRUSHED:
        reasons.append(f"crushed to black ({m.crushed * 100:.0f}%)")
    if m.contrast < MIN_CONTRAST:
        reasons.append(f"flat (contrast {m.contrast:.0f})")
    if m.cast > MAX_CAST:
        reasons.append(f"colour cast on neutrals ({m.cast:.0f})")
    if m.mean_luma > 215:
        reasons.append(f"over-exposed (mean {m.mean_luma:.0f})")

    # Rank survivors on the things that survive a grade: detail and resolution.
    # Contrast and cast are recoverable, so they carry little weight.
    score = (
        min(m.sharpness / 320.0, 1.0) * 58
        + min(m.contrast / 70.0, 1.0) * 18
        + min(m.short_edge / 2000.0, 1.0) * 16
        + (1.0 - min(m.cast / MAX_CAST, 1.0)) * 8
        - min(m.blown / MAX_BLOWN, 1.0) * 10
    )
    return Verdict(name=name, ok=not reasons, score=round(score, 1), reasons=reasons, measures=m)


def grade(path: Path, out: Path, size: int = 1600) -> None:
    """
    The same intent as the video grade: neutralise the cast, then add contrast.
    Deliberately restrained — the aim is a consistent set, not a filter.
    """
    img = ImageOps.exif_transpose(Image.open(path)).convert("RGB")
    img.thumbnail((size, size), Image.LANCZOS)
    arr = np.asarray(img, dtype=np.float64)

    # White balance on bright pixels, which are closer to true neutral than the
    # whole-frame average when a car fills most of the frame.
    grey = _luma(arr)
    bright = grey >= np.percentile(grey, 80)
    if bright.sum() > 64:
        ref = arr[bright].mean(axis=0)
        target = ref.mean()
        arr *= np.clip(target / np.maximum(ref, 1.0), 0.82, 1.22)

    # Per-channel levels off the 0.5/99.5 percentiles, so one bright highlight
    # cannot decide the whole black point.
    lo = np.percentile(arr, 0.5, axis=(0, 1))
    hi = np.percentile(arr, 99.5, axis=(0, 1))
    arr = (arr - lo) * (255.0 / np.maximum(hi - lo, 1.0))
    arr = np.clip(arr, 0, 255)

    # Gentle S-curve for depth without crushing detail.
    x = arr / 255.0
    arr = (x + 0.16 * np.sin(2 * math.pi * x) / (2 * math.pi)) * 255.0
    out_img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

    out_img = ImageEnhance.Color(out_img).enhance(1.10)
    out_img = ImageEnhance.Sharpness(out_img).enhance(1.35)
    out.parent.mkdir(parents=True, exist_ok=True)
    out_img.save(out, quality=88, optimize=True, progressive=True)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("src", type=Path)
    ap.add_argument("--out", type=Path, default=Path("tools/curated"))
    ap.add_argument("--top", type=int, default=4)
    ap.add_argument("--report", type=Path, default=None)
    args = ap.parse_args()

    files = sorted(p for p in args.src.rglob("*") if p.suffix.lower() in SUPPORTED and not p.name.startswith("."))
    verdicts = [judge(p.name, measure(p)) for p in files]
    by_name = {p.name: p for p in files}

    passed = sorted((v for v in verdicts if v.ok), key=lambda v: -v.score)
    failed = [v for v in verdicts if not v.ok]

    print(f"scanned {len(verdicts)}  ·  passed {len(passed)}  ·  rejected {len(failed)}\n")
    print("TOP OF THE PASS LIST")
    for v in passed[: args.top]:
        m = v.measures
        print(f"  {v.score:5.1f}  {v.name:32s} focus {m.sharpness:6.0f}  contrast {m.contrast:5.1f}  cast {m.cast:5.1f}  blown {m.blown*100:4.1f}%")

    print("\nREJECTED")
    for v in sorted(failed, key=lambda v: v.name)[:14]:
        print(f"         {v.name:34s} {'; '.join(v.reasons)}")
    if len(failed) > 14:
        print(f"         … and {len(failed) - 14} more")

    args.out.mkdir(parents=True, exist_ok=True)
    for i, v in enumerate(passed[: args.top], 1):
        grade(by_name[v.name], args.out / f"{i:02d}-{Path(v.name).stem}.jpg")
    print(f"\ngraded {min(args.top, len(passed))} into {args.out}/")

    if args.report:
        args.report.write_text(json.dumps([asdict(v) for v in verdicts], indent=2))
        print(f"report written to {args.report}")


if __name__ == "__main__":
    main()
