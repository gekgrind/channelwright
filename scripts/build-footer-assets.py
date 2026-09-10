#!/usr/bin/env python3
"""Derive the web-delivery variants of the cinematic audience footer plates.

The four source plates in `public/footer/` are the production truth and are
never modified: they are 2560x1440 stills, one of which (`3.png`) is a 5.9 MB
lossless PNG. Shipping them raw would cost ~7.2 MB for a footer.

This script derives WebP variants at the two widths the footer actually paints
at. Both qualities were chosen by measuring high-pass energy (a proxy for film
grain) against the source rather than picked by eye.

At 1920 the desktop plates are written at quality 88, which retains 95-108% of
the source's grain and drops the sequence to roughly 0.85 MB.

At 1100 the phone plates are written at quality 86, which is deliberate and not
a slip: measured at that width, 86 and 88 retain grain identically (6.72 vs 6.73
on plate 1, 8.37 vs 8.37 on plate 3) while 88 costs 17% more bytes — about 40 KB
across the four plates, on the connection least able to spare it. Raising it
would buy nothing.

Run from the repository root:  python3 scripts/build-footer-assets.py
"""
from PIL import Image
from pathlib import Path

SOURCES = {
    "1": "1-master-reference.jpg",
    "2": "2.jpg",
    "3": "3.png",
    "4": "4.jpg",
}
# (suffix, width, quality) — 1920 serves desktop, 1100 serves phones. See the
# note above before changing a quality: both are measured, not preferences.
VARIANTS = [("1920", 1920, 88), ("1100", 1100, 86)]

root = Path(__file__).resolve().parent.parent
footer = root / "public" / "footer"

for key, filename in SOURCES.items():
    source = Image.open(footer / filename).convert("RGB")
    for suffix, width, quality in VARIANTS:
        height = round(width * source.height / source.width)
        out = footer / f"{key}-{suffix}.webp"
        source.resize((width, height), Image.LANCZOS).save(
            out, "WEBP", quality=quality, method=6
        )
        print(f"{out.relative_to(root)}  {out.stat().st_size / 1e6:.2f} MB")
