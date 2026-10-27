"""Run Chandra OCR 2 (local, quantised GGUF on llama.cpp) on the rendered pages.

Starts llama-server on the local GPU, sends each page image with Chandra's own
ocr_layout prompt, and writes outputs/chandra/pages/<meeting>/pNNN.html (raw) and
pNNN.txt (layout blocks as plain text).

Usage: python run_chandra.py [meeting | meeting/pNNN ...]
"""
import base64
import html
import json
import re
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOLS = HERE.parent / "tools"
PAGES = HERE / "pages"
OUT = HERE / "outputs" / "chandra" / "pages"
PORT = 8089
MODEL = TOOLS / "models" / "chandra-ocr-2.Q6_K.gguf"
MMPROJ = TOOLS / "models" / "chandra-ocr-2.mmproj-f16.gguf"

sys.path.insert(0, str(TOOLS / "chandra_ref"))
from prompts import OCR_LAYOUT_PROMPT  # noqa: E402  (Datalab's reference prompt, unchanged)


def start_server() -> subprocess.Popen:
    log = open(HERE / "outputs" / "chandra" / "server.log", "w", encoding="utf-8")
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
            sys.exit("llama-server exited; see outputs/chandra/server.log")
        time.sleep(1)
    proc.kill()
    sys.exit("llama-server did not become ready")


def ocr(img: Path) -> tuple[str, dict]:
    b64 = base64.b64encode(img.read_bytes()).decode()
    body = {
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
            {"type": "text", "text": OCR_LAYOUT_PROMPT},
        ]}],
        "temperature": 0, "max_tokens": 8192,
        "chat_template_kwargs": {"enable_thinking": False},  # Qwen3.5 base: answer directly, no reasoning block
    }
    req = urllib.request.Request(f"http://127.0.0.1:{PORT}/v1/chat/completions",
                                 data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=1800) as r:
        data = json.load(r)
    msg = data["choices"][0]["message"]
    return msg.get("content") or msg.get("reasoning_content") or "", data.get("usage", {})


def html_to_text(raw: str) -> str:
    raw = re.sub(r"</?(div|p|tr|br|h\d|li)[^>]*>", "\n", raw)
    raw = re.sub(r"</t[dh]>", " | ", raw)
    text = html.unescape(re.sub(r"<[^>]+>", "", raw))
    return "\n".join(ln.strip(" |") for ln in text.splitlines() if ln.strip(" |"))


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
                raw, usage = ocr(img)
                (out / f"{img.stem}.html").write_text(raw, encoding="utf-8")
                (out / f"{img.stem}.txt").write_text(html_to_text(raw), encoding="utf-8")
                print(f"{key}: {usage.get('prompt_tokens')} in / {usage.get('completion_tokens')} out, "
                      f"{time.time() - t0:.1f}s", flush=True)
    finally:
        server.terminate()
