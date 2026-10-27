"""Render every page of the sample minutes to PNG so all OCR engines read identical input.

pages/<meeting-date>/p001.png ... at 200 dpi (grayscale).
"""
import sys
from pathlib import Path

import pymupdf as fitz

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "01_Client_Inputs" / "Sample_Minutes"
OUT = Path(__file__).resolve().parent / "pages"
DPI = 200


def stem(pdf: Path) -> str:
    d = pdf.stem.split(" - ")[1].split(" ")[0]
    dd, mm, yyyy = d.split(".")
    return f"{yyyy}-{mm}-{dd}"


if __name__ == "__main__":
    total = 0
    for pdf in sorted(SAMPLES.glob("*.pdf")):
        out = OUT / stem(pdf)
        out.mkdir(parents=True, exist_ok=True)
        with fitz.open(pdf) as doc:
            for i, page in enumerate(doc, 1):
                target = out / f"p{i:03d}.png"
                if not target.exists():
                    page.get_pixmap(dpi=DPI, colorspace=fitz.csGRAY).save(target)
                total += 1
        print(stem(pdf), len(list(out.glob("*.png"))))
    print("pages:", total)
    sys.exit(0)
