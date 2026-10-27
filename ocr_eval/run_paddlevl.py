"""Run PaddleOCR-VL 1.6 (layout model + 0.9B VLM, local GPU) on the rendered pages.

Writes outputs/paddlevl/pages/<meeting>/pNNN.md (markdown with tables), pNNN.json (layout
blocks) and pNNN.txt (same markdown, for scoring). Run with the .venv-paddlevl interpreter.

Usage: python run_paddlevl.py [meeting | meeting/pNNN ...]
"""
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path

from paddleocr import PaddleOCRVL

HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
OUT = HERE / "outputs" / "paddlevl" / "pages"

if __name__ == "__main__":
    only = sys.argv[1:]
    pipeline = PaddleOCRVL(pipeline_version="v1.6")
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
            with tempfile.TemporaryDirectory() as tmp:
                for res in pipeline.predict(str(img)):
                    res.save_to_markdown(save_path=tmp)
                    res.save_to_json(save_path=tmp)
                md = next(Path(tmp).glob("*.md"))
                shutil.copy(md, out / f"{img.stem}.md")
                js = next(Path(tmp).glob("*.json"))
                shutil.copy(js, out / f"{img.stem}.json")
                # The markdown drops header/number blocks (incl. the minute-book page number), so score the full block list
                blocks = json.loads(js.read_text(encoding="utf-8")).get("parsing_res_list", [])
                (out / f"{img.stem}.txt").write_text(
                    "\n".join(str(b.get("block_content", "")) for b in blocks), encoding="utf-8")
            print(f"{key}: {time.time() - t0:.1f}s", flush=True)
