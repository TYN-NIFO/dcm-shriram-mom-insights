"""Transcribe the rendered pages with an Azure OpenAI vision model (e.g. gpt-4.1 / gpt-4o).

Reads AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_DEPLOYMENT (and optional
AZURE_OPENAI_API_VERSION) from ../.env. Writes outputs/gpt_<deployment>/pages/<meeting>/pNNN.txt.

Usage: python run_gpt.py [meeting | meeting/pNNN ...]
"""
import base64
import os
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import AzureOpenAI

HERE = Path(__file__).resolve().parent
PAGES = HERE / "pages"
load_dotenv(HERE.parent / ".env")
DEPLOYMENT = os.environ["AZURE_OPENAI_DEPLOYMENT"]
OUT = HERE / "outputs" / f"gpt_{DEPLOYMENT}" / "pages"

client = AzureOpenAI(
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version=os.environ.get("AZURE_OPENAI_API_VERSION", "2025-04-01-preview"),
)

PROMPT = """Transcribe this scanned page of company board minutes exactly as printed.
Rules:
- Copy every character verbatim, including numbers, amounts, dates, names, punctuation and the page number at the top.
- Never correct spelling, grammar or apparent typos; never add, infer or summarise anything.
- Keep the reading order. Keep each printed line break.
- Write tables as Markdown tables, one row per printed row, with merged cells left empty.
- Omit the "MINUTE BOOK" header, the "CHAIRMAN'S INITIAL" box and handwritten initials.
- If a character is illegible, write [?] instead of guessing.
Output only the transcription."""


def transcribe(img: Path) -> tuple[str, object]:
    b64 = base64.b64encode(img.read_bytes()).decode()
    resp = client.chat.completions.create(
        model=DEPLOYMENT,
        temperature=0,
        max_tokens=8000,
        messages=[{"role": "user", "content": [
            {"type": "text", "text": PROMPT},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}", "detail": "high"}},
        ]}],
    )
    return resp.choices[0].message.content, resp.usage


if __name__ == "__main__":
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
            text, usage = transcribe(img)
            (out / f"{img.stem}.txt").write_text(text, encoding="utf-8")
            print(f"{key}: {usage.prompt_tokens} in / {usage.completion_tokens} out, {time.time() - t0:.1f}s", flush=True)
