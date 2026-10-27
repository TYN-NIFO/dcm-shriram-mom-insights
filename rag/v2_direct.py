"""Version 2 - direct chunking: cleaned ADI text cut into fixed-size, overlapping word windows.

No structure, normalisation or LLM. Each chunk keeps the meeting and the minute-book pages it spans.
Writes data/v2_chunks.jsonl.
"""
import json
import sys

from prep import OUT, prepared

SIZE, OVERLAP = 400, 80   # words


def chunks(meeting: str, prep: dict) -> list[dict]:
    words = [(w, b["page"]) for b in prep["blocks"] for w in b["text"].split()]
    out, start = [], 0
    while start < len(words):
        win = words[start:start + SIZE]
        pages = sorted({prep["pages"][p] for _, p in win})
        out.append({"id": f"v2:{meeting}:{len(out):03d}", "meeting": meeting, "pages": pages,
                    "text": " ".join(w for w, _ in win)})
        if start + SIZE >= len(words):
            break
        start += SIZE - OVERLAP
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(exist_ok=True)
    allc = [c for m, p in prepared().items() for c in chunks(m, p)]
    with open(OUT / "v2_chunks.jsonl", "w", encoding="utf-8") as f:
        for c in allc:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    print(f"{len(allc)} chunks of {SIZE} words ({OVERLAP} overlap) -> data/v2_chunks.jsonl")
