"""Run PaddleOCR (PP-OCRv5, local CPU) on the rendered pages.

Writes outputs/paddle/pages/<meeting>/pNNN.txt (reading-order lines) and pNNN.json
(raw boxes, texts, scores). Run with the .venv-paddle interpreter.
"""
import json
import sys
import time
from pathlib import Path

from paddleocr import PaddleOCR

HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
OUT = HERE / "outputs" / "paddle" / "pages"


def to_lines(polys, texts, scores):
    """Group word boxes into text lines: sort by vertical centre, merge boxes that overlap vertically."""
    items = []
    for poly, text, score in zip(polys, texts, scores):
        ys = [p[1] for p in poly]
        xs = [p[0] for p in poly]
        items.append({"y0": min(ys), "y1": max(ys), "x0": min(xs), "text": text, "score": float(score)})
    items.sort(key=lambda b: (b["y0"] + b["y1"]) / 2)
    lines = []
    for b in items:
        cy = (b["y0"] + b["y1"]) / 2
        if lines:
            last = lines[-1]
            if last["y0"] <= cy <= last["y1"]:
                last["items"].append(b)
                last["y0"] = min(last["y0"], b["y0"])
                last["y1"] = max(last["y1"], b["y1"])
                continue
        lines.append({"y0": b["y0"], "y1": b["y1"], "items": [b]})
    return [" ".join(i["text"] for i in sorted(ln["items"], key=lambda i: i["x0"])) for ln in lines]


if __name__ == "__main__":
    ocr = PaddleOCR(
        lang="en",
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    only = sys.argv[1:]  # optional: meeting folders or meeting/pNNN to restrict the run
    for meeting in sorted(p for p in PAGES.iterdir() if p.is_dir()):
        out = OUT / meeting.name
        out.mkdir(parents=True, exist_ok=True)
        for img in sorted(meeting.glob("p*.png")):
            key = f"{meeting.name}/{img.stem}"
            if only and meeting.name not in only and key not in only:
                continue
            if (out / f"{img.stem}.txt").exists():
                continue
            t0 = time.time()
            res = ocr.predict(str(img))[0]
            polys = [p.tolist() for p in res["rec_polys"]]
            texts, scores = list(res["rec_texts"]), [float(s) for s in res["rec_scores"]]
            (out / f"{img.stem}.json").write_text(
                json.dumps({"polys": polys, "texts": texts, "scores": scores}, ensure_ascii=False), encoding="utf-8")
            (out / f"{img.stem}.txt").write_text("\n".join(to_lines(polys, texts, scores)), encoding="utf-8")
            print(f"{key}: {len(texts)} boxes, {time.time() - t0:.1f}s", flush=True)
