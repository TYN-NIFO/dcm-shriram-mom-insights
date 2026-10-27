"""Chunking variants B (recursive) and D (parent-child), alongside A (v2_direct.py) and C (v1_structured.py).

B recursive: pack whole paragraphs/tables up to 400 words; a paragraph that is too long is split at sentence
  ends, then at words. About 60 words of overlap are carried from the end of the previous chunk.
D parent-child: search small "child" pieces of each agenda item (one or a few paragraphs, ~60-250 words, each
  prefixed with the item's header line); a hit returns the whole agenda item (the "parent") for the answer.
Writes data/b_chunks.jsonl, data/d_children.jsonl, data/d_parents.jsonl.
"""
import json
import re
import sys

from prep import OUT, prepared

SIZE, OVERLAP = 400, 60          # B, words
CHILD_MIN, CHILD_MAX = 60, 250   # D, words
SENT = re.compile(r"(?<=[.;:])\s+(?=[A-Z(\"'0-9])")


def _pieces(text: str, limit: int) -> list[str]:
    """Split one paragraph that is over the limit: sentences first, then plain word windows."""
    out, cur = [], []
    for s in SENT.split(text):
        w = s.split()
        if len(w) > limit:
            out += [" ".join(w[i:i + limit]) for i in range(0, len(w), limit)]
            continue
        if cur and len(cur) + len(w) > limit:
            out.append(" ".join(cur)); cur = []
        cur += w
    if cur:
        out.append(" ".join(cur))
    return out


def recursive(meeting: str, prep: dict) -> list[dict]:
    units = []                                   # (text, minute-book page) at paragraph level, long ones split
    for b in prep["blocks"]:
        for p in ([b["text"]] if len(b["text"].split()) <= SIZE else _pieces(b["text"], SIZE)):
            units.append((p, prep["pages"][b["page"]]))
    chunks, cur = [], []
    count = lambda us: sum(len(t.split()) for t, _ in us)
    for u in units:
        if cur and count(cur) + len(u[0].split()) > SIZE:
            chunks.append(cur)
            tail = []
            for x in reversed(cur):              # overlap: whole trailing paragraphs up to OVERLAP words
                if count(tail) + len(x[0].split()) > OVERLAP:
                    break
                tail.insert(0, x)
            cur = tail
        cur.append(u)
    if cur:
        chunks.append(cur)
    return [{"id": f"b:{meeting}:{i:03d}", "meeting": meeting, "pages": sorted({p for _, p in c}),
             "text": "\n".join(t for t, _ in c)} for i, c in enumerate(chunks)]


def parent_child(items: list[dict], v1_chunks: list[dict]) -> tuple[list[dict], list[dict]]:
    header = {}
    for c in v1_chunks:                          # reuse Version 1's header line (company · body · date · item · pages)
        header.setdefault((c["meeting"], c["item"]), c["text"].split("\n", 1)[0])
    parents, children = [], []
    for it in items:
        key = (it["meeting"], it["item"])
        if key not in header:
            continue
        pid = f"d:{it['meeting']}:{it['item']}"
        parents.append({"id": pid, "meeting": it["meeting"], "item": it["item"], "title": it["title"],
                        "pages": it["pages"], "text": header[key] + "\n" + "\n".join(b["text"] for b in it["blocks"])})
        cur, cur_pages = [], set()
        flush = lambda: children.append({"id": f"{pid}#{len([c for c in children if c['parent'] == pid])}",
                                         "parent": pid, "meeting": it["meeting"], "item": it["item"],
                                         "pages": sorted(cur_pages), "text": header[key] + "\n" + " ".join(cur)})
        for b in it["blocks"]:
            for p in ([b["text"]] if len(b["text"].split()) <= CHILD_MAX else _pieces(b["text"], CHILD_MAX)):
                if cur and len(cur) + len(p.split()) > CHILD_MAX:
                    flush(); cur, cur_pages = [], set()
                cur += p.split(); cur_pages.add(b["page"])
                if len(cur) >= CHILD_MIN:
                    flush(); cur, cur_pages = [], set()
        if cur:
            flush()
    return parents, children


def write(name: str, rows: list[dict]) -> None:
    with open(OUT / name, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    b = [c for m, p in prepared().items() for c in recursive(m, p)]
    write("b_chunks.jsonl", b)
    items = [json.loads(l) for l in open(OUT / "v1_items.jsonl", encoding="utf-8")]
    v1 = [json.loads(l) for l in open(OUT / "v1_chunks.jsonl", encoding="utf-8")]
    parents, children = parent_child(items, v1)
    write("d_parents.jsonl", parents)
    write("d_children.jsonl", children)
    avg = lambda cs: sum(len(c["text"].split()) for c in cs) / len(cs)
    print(f"B recursive: {len(b)} chunks, avg {avg(b):.0f} words")
    print(f"D parent-child: {len(children)} children (avg {avg(children):.0f} words) -> {len(parents)} parents (avg {avg(parents):.0f} words)")
