"""Run Sarvam Document Intelligence (doc_ai.digitise, hosted by Sarvam) on the rendered pages.

Sending DCM's minutes to Sarvam was approved by the user on 25 Oct 2026.
Pages go up as ZIPs of at most 10 PNGs (Sarvam's limit). Each job's ZIP result is kept
under outputs/sarvam/jobs/, and per-page text is written to outputs/sarvam/pages/<meeting>/pNNN.txt.

Usage: python run_sarvam.py [meeting ...]
"""
import io
import json
import os
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

from dotenv import load_dotenv
from sarvamai import SarvamAI

HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
OUT = HERE / "outputs" / "sarvam"
TERMINAL = {"completed", "partially_completed", "failed", "rejected"}

load_dotenv(HERE.parent / ".env")
client = SarvamAI(api_subscription_key=os.environ["SARVAM_API_KEY"])


def block_text(page_json: dict) -> str:
    """Join the text blocks of one metadata/page_NNN.json in reading order."""
    blocks = page_json.get("blocks") or page_json.get("elements") or []
    blocks = sorted(blocks, key=lambda b: b.get("reading_order", b.get("order", 0)))
    return "\n".join(b.get("text", "") for b in blocks if b.get("text"))


def run_batch(meeting: str, imgs: list[Path]) -> None:
    tag = f"{meeting}_{imgs[0].stem}-{imgs[-1].stem}"
    result_zip = OUT / "jobs" / f"{tag}.zip"
    if not result_zip.exists():
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            for img in imgs:
                z.write(img, img.name)
        buf.seek(0)
        t0 = time.time()
        job = client.doc_ai.digitise(file=[(f"{tag}.zip", buf, "application/zip")], language="en-IN", output_format="md")
        while True:
            st = client.doc_ai.get_status(job_id=job.job_id)
            if str(st.status).lower() in TERMINAL:
                break
            time.sleep(5)
        if str(st.status).lower() not in ("completed", "partially_completed"):
            print(f"{tag}: {st.status}", flush=True)
            return
        dl = client.doc_ai.get_download_url(job_id=job.job_id)
        result_zip.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(dl.url) as r:
            result_zip.write_bytes(r.read())
        print(f"{tag}: {st.status}, {time.time() - t0:.0f}s", flush=True)

    out = OUT / "pages" / meeting
    out.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(result_zip) as z:
        metas = sorted(n for n in z.namelist() if n.startswith("metadata/page_") and n.endswith(".json"))
        for img, name in zip(imgs, metas):
            (out / f"{img.stem}.txt").write_text(block_text(json.loads(z.read(name))), encoding="utf-8")


if __name__ == "__main__":
    only = sys.argv[1:]
    for meeting in sorted(p for p in PAGES.iterdir() if p.is_dir()):
        if only and meeting.name not in only:
            continue
        imgs = sorted(meeting.glob("p*.png"))
        for i in range(0, len(imgs), 10):
            run_batch(meeting.name, imgs[i:i + 10])
