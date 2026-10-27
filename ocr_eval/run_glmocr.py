"""Run GLM-OCR (0.9B, MIT licence; f16 GGUF on llama.cpp, local GPU) on whole rendered pages.

Uses the model's own "Text Recognition:" prompt on the full page (the official SDK crops
layout regions first; this tests the simpler whole-page mode). Writes
outputs/glmocr/pages/<meeting>/pNNN.txt.

Usage: python run_glmocr.py [meeting | meeting/pNNN ...]
"""
import base64
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent / "tools"
PAGES = HERE / "pages"
OUT = HERE / "outputs" / "glmocr" / "pages"
PORT = 8090
MODEL = TOOLS / "models" / "GLM-OCR-f16.gguf"
MMPROJ = TOOLS / "models" / "mmproj-GLM-OCR-Q8_0.gguf"
PROMPT = "Text Recognition:"


def start_server() -> subprocess.Popen:
    log = open(OUT.parent / "server.log", "w", encoding="utf-8")
    proc = subprocess.Popen(
        [str(TOOLS / "llama" / "llama-server.exe"), "-m", str(MODEL), "--mmproj", str(MMPROJ),
         "-ngl", "99", "-c", "16384", "--port", str(PORT), "--temp", "0", "--no-webui"],
        stdout=log, stderr=subprocess.STDOUT)
    for _ in range(180):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{PORT}/health", timeout=2) as r:
                if json.load(r).get("status") == "ok":
                    return proc
        except Exception:
            pass
        if proc.poll() is not None:
            sys.exit("llama-server exited; see outputs/glmocr/server.log")
        time.sleep(1)
    proc.kill()
    sys.exit("llama-server did not become ready")


def ocr(img: Path) -> tuple[str, dict]:
    b64 = base64.b64encode(img.read_bytes()).decode()
    body = {
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": PROMPT},
        ]}],
        "temperature": 0, "max_tokens": 8192,
    }
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        data = json.load(r)
    msg = data["choices"][0]["message"]
    return msg.get("content") or msg.get("reasoning_content") or "", data.get("usage", {})


if __name__ == "__main__":
    only = sys.argv[1:]
    OUT.mkdir(parents=True, exist_ok=True)
    server = start_server()
    try:
        for meeting in sorted(p for p in PAGES.iterdir() if p.is_dir()):
            for img in sorted(meeting.glob("p*.png")):
                key = f"{meeting.name}/{img.stem}"
                if only and meeting.name not in only and key not in only:
                    continue
                out = OUT / meeting.name
                out.mkdir(exist_ok=True)
                if (out / f"{img.stem}.txt").exists():
                    continue
                t0 = time.time()
                text, usage = ocr(img)
                (out / f"{img.stem}.txt").write_text(text, encoding="utf-8")
                print(f"{key}: {usage.get('prompt_tokens')} in / {usage.get('completion_tokens')} out, "
                      f"{time.time() - t0:.1f}s", flush=True)
    finally:
        server.terminate()
