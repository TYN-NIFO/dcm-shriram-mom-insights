"""Run Mistral Document AI (Azure AI Foundry, Global Standard) on the rendered pages.

Reads MISTRAL_ENDPOINT, MISTRAL_KEY (and optional MISTRAL_MODEL, also read from the environment) from ../.env. Writes
outputs/mistral[_<model>]/pages/<meeting>/pNNN.md (raw markdown) and pNNN.txt (same, for scoring).

Usage: python run_mistral.py [meeting | meeting/pNNN ...]
"""
import base64
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

from dotenv import dotenv_values

HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
env = dotenv_values(HERE.parent / ".env")
MODEL = os.environ.get("MISTRAL_MODEL") or env.get("MISTRAL_MODEL") or "mistral-document-ai-2512"
TAG = "mistral" if MODEL == "mistral-document-ai-2512" else MODEL.replace("-", "_")
OUT = HERE / "outputs" / TAG / "pages"


def ocr(img: Path) -> tuple[str, dict]:
    b64 = base64.b64encode(img.read_bytes()).decode()
    body = {"model": MODEL, "include_image_base64": False,
            "document": {"type": "image_url", "image_url": f"data:image/png;base64,{b64}"}}
    req = urllib.request.Request(env["MISTRAL_ENDPOINT"], data=json.dumps(body).encode(), headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {env['MISTRAL_KEY']}"})
    with urllib.request.urlopen(req, timeout=300) as r:
        data = json.load(r)
    return "\n\n".join(p.get("markdown", "") for p in data.get("pages", [])), data.get("usage_info", {})


def run_pdfs(chunk: int = 10) -> None:
    """--pdf mode: send the original scans (≈300 dpi) in lossless 10-page slices to outputs/mistral_pdf."""
    import pymupdf

    sys.path.insert(0, str(HERE))
    from render_pages import SAMPLES, stem
    out_root = HERE / "outputs" / f"{TAG}_pdf" / "pages"
    for pdf in sorted(SAMPLES.glob("*.pdf")):
        src, meeting = pymupdf.open(pdf), stem(pdf)
        out = out_root / meeting
        out.mkdir(parents=True, exist_ok=True)
        for start in range(0, src.page_count, chunk):
            end = min(start + chunk, src.page_count)
            if all((out / f"p{i + 1:03d}.txt").exists() for i in range(start, end)):
                continue
            part = pymupdf.open()
            part.insert_pdf(src, from_page=start, to_page=end - 1)
            b64 = base64.b64encode(part.tobytes()).decode()
            body = {"model": MODEL, "include_image_base64": False,
                    "document": {"type": "document_url", "document_url": f"data:application/pdf;base64,{b64}"}}
            req = urllib.request.Request(env["MISTRAL_ENDPOINT"], data=json.dumps(body).encode(), headers={
                "Content-Type": "application/json", "Authorization": f"Bearer {env['MISTRAL_KEY']}"})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=600) as r:
                data = json.load(r)
            for p in data.get("pages", []):
                n = start + p["index"] + 1
                (out / f"p{n:03d}.md").write_text(p.get("markdown", ""), encoding="utf-8")
                (out / f"p{n:03d}.txt").write_text(p.get("markdown", ""), encoding="utf-8")
            print(f"{meeting} p{start + 1}-{end}: {len(data.get('pages', []))} pages, {time.time() - t0:.1f}s", flush=True)


if __name__ == "__main__":
    if sys.argv[1:] == ["--pdf"]:
        run_pdfs()
        sys.exit()
    only = sys.argv[1:]
    for meeting in sorted(p for p in PAGES.iterdir() if p.is_dir()):
        for img in sorted(meeting.glob("p*.png")):
            key = f"{meeting.name}/{img.stem}"
            if only and meeting.name not in only and key not in only:
                continue
            out = OUT / meeting.name
            out.mkdir(parents=True, exist_ok=True)
            if (out / f"{img.stem}.txt").exists():
                continue
            t0 = time.time()
            text, usage = ocr(img)
            (out / f"{img.stem}.md").write_text(text, encoding="utf-8")
            (out / f"{img.stem}.txt").write_text(text, encoding="utf-8")
            print(f"{key}: {usage.get('pages_processed')} page, {time.time() - t0:.1f}s", flush=True)
