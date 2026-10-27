"""Version 1 - structured: A8 agenda-item parsing + A6 normalisation, then one chunk per agenda item.

A8: an agenda item starts at an ADI heading with agenda numbering at the left margin:
    dotted (3.4.4), top-level (14.), or a lettered / roman sub-item (C., IV.) under the last numbered item.
    Bullets and lists inside an item sit further right and stay part of the item's text.
A6: dates -> ISO, amounts -> rupees, as extra fields; the original text is kept unchanged.
A9 (resolution records) runs separately (a9_records.py) because it needs an LLM.
Writes data/v1_items.jsonl and data/v1_chunks.jsonl.
"""
import json
import re
import sys
from datetime import date

from prep import OUT, prepared

AGENDA_X = 2.2          # inches; agenda headings start left of this, bullets and sub-lists further right
MAX_WORDS, PART_WORDS = 600, 400
ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8, "IX": 9, "X": 10, "XI": 11, "XII": 12}

DOTTED = re.compile(r"^(\d+(?:\.\d+)+)\.?\s*(?:\.\d+\s+)?(\S.*)$")      # "3.4.4 Title", ADI's "3.3.1 .1 Title"
TOP = re.compile(r"^(\d{1,2})\.\s+(\S.*)$")
LETTER = re.compile(r"^([A-H])\.\s+(\S.*)$")
ROMAN_RE = re.compile(r"^((?:I|Il|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII))\.\s+(\S.*)$")


def marker(b: dict, parent: str | None) -> tuple[str, str, str | None] | None:
    """(item id, title, parent id) if this block opens an agenda item."""
    if b["kind"] != "para" or b["x"] is None or b["x"] > AGENDA_X or len(b["text"]) > 220:
        return None
    t = b["text"]
    if m := DOTTED.match(t):
        return m.group(1), m.group(2), None
    if b["role"] not in ("sectionHeading", "title"):
        return None
    if m := TOP.match(t):
        return m.group(1), m.group(2), None
    if parent and (m := LETTER.match(t)):
        return f"{parent}{m.group(1)}", m.group(2), parent
    if parent and (m := ROMAN_RE.match(t)):
        r = m.group(1).replace("l", "I")   # ADI reads roman II as "Il"
        return f"{parent}({r})", m.group(2), parent
    return None


# ---------- A6 normalisation ----------
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
D_NUM = re.compile(r"\b(\d{1,2})[./](\d{1,2})[./](\d{4}|\d{2})\b")
D_MDY = re.compile(r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b", re.I)
D_DMY = re.compile(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s+(\d{4})\b", re.I)
AMOUNT = re.compile(r"(?:Rs\.?|Re\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)\s*(?:/-)?\s*(crores?|cr\.?|lakhs?|lacs?|lac|million|mn)?", re.I)
UNIT = {"crore": 1e7, "cr": 1e7, "lakh": 1e5, "lac": 1e5, "million": 1e6, "mn": 1e6}


def _iso(d: int, m: int, y: int) -> str | None:
    y = y + 2000 if y < 100 else y
    try:
        return date(y, m, d).isoformat()
    except ValueError:
        return None


def dates(text: str) -> list[str]:
    found = [_iso(int(d), int(m), int(y)) for d, m, y in D_NUM.findall(text)]
    found += [_iso(int(d), MONTHS[mo[:3].lower()], int(y)) for mo, d, y in D_MDY.findall(text)]
    found += [_iso(int(d), MONTHS[mo[:3].lower()], int(y)) for d, mo, y in D_DMY.findall(text)]
    return sorted({d for d in found if d})


def amounts(text: str) -> list[dict]:
    out = []
    for m in AMOUNT.finditer(text):
        num, unit = m.group(1).replace(",", "").rstrip("."), (m.group(2) or "").lower().rstrip(".s")
        try:
            val = float(num) * UNIT.get(unit, 1)
        except ValueError:
            continue
        out.append({"text": m.group(0).strip(), "value_inr": val})
    return out


# ---------- A8 parsing ----------
def join_split_numbers(blocks: list[dict]) -> list[dict]:
    """ADI sometimes puts an agenda number ("2.2.4") and its title in separate paragraphs; join them."""
    out = []
    for b in blocks:
        prev = out[-1] if out else None
        if (prev and prev["kind"] == "para" and b["kind"] == "para" and prev["x"] is not None
                and prev["x"] <= AGENDA_X and re.fullmatch(r"\d+(?:\.\d+)+\.?", prev["text"])):
            out[-1] = {**b, "text": f"{prev['text']} {b['text']}", "x": prev["x"], "page": prev["page"]}
        else:
            out.append(b)
    return out


def items(meeting: str, prep: dict) -> list[dict]:
    pages = prep["pages"]
    out, cur, top = [], None, None
    last_top, sub_of, last_sub = 0, None, 0   # numbered sub-list "1. 2. 3." under a dotted item, e.g. 4.4 -> 4.4.1
    head = {"id": "header", "title": "Meeting header", "parent": None, "blocks": []}
    for b in join_split_numbers(prep["blocks"]):
        mk = marker(b, top)
        if mk:
            iid, title, parent = mk
            title = title.lstrip(". ")
            if parent is None and iid.isdigit():
                n = int(iid)
                if sub_of and n == last_sub + 1:
                    iid, parent, last_sub = f"{sub_of}.{n}", sub_of, n
                elif n <= last_top and top and "." in top:
                    sub_of, last_sub = top, n
                    iid, parent = f"{top}.{n}", top
                else:
                    last_top, sub_of = n, None
            elif parent is None:
                sub_of = None
            if parent is None:
                top = iid
            cur = {"id": iid, "title": title, "parent": parent, "blocks": [b]}
            out.append(cur)
        else:
            (cur or head)["blocks"].append(b)
    res = []
    for it in [head] + out:
        text = "\n".join(b["text"] for b in it["blocks"])
        res.append({
            "meeting": meeting, "item": it["id"], "title": it["title"], "parent": it["parent"],
            "pages": sorted({pages[b["page"]] for b in it["blocks"]}),
            "dates": dates(text), "amounts": amounts(text),
            "has_resolution": "RESOLVED" in text.upper(),
            "blocks": [{"page": pages[b["page"]], "kind": b["kind"], "text": b["text"]} for b in it["blocks"]],
        })
    return res


def body_of(item0: dict) -> str:
    """Meeting body from the header, e.g. 'MINUTES OF BOARD MEETING NO. 01/2024-25'."""
    t = " ".join(b["text"] for b in item0["blocks"]).upper()
    m = re.search(r"MINUTES OF (?:THE )?(.+?) MEETING", t)
    return m.group(1).title() if m else "Board"


def chunks(its: list[dict]) -> list[dict]:
    body = body_of(its[0])
    out = []
    for it in its:
        parts, cur, n = [], [], 0
        for b in it["blocks"]:                      # blocks are never split: a table or RESOLVED paragraph stays whole
            w = len(b["text"].split())
            if cur and n + w > PART_WORDS and sum(len(x["text"].split()) for x in it["blocks"]) > MAX_WORDS:
                parts.append(cur); cur, n = [], 0
            cur.append(b); n += w
        if cur:
            parts.append(cur)
        for k, part in enumerate(parts):
            pg = sorted({b["page"] for b in part})
            pr = f"p. {pg[0]}" if len(pg) == 1 else f"pp. {pg[0]}-{pg[-1]}"
            header = f"DCM Shriram Ltd · {body} · {it['meeting']} · Item {it['item']} {it['title']} · {pr}"
            out.append({"id": f"v1:{it['meeting']}:{it['item']}:{k}", "meeting": it["meeting"], "body": body,
                        "item": it["item"], "title": it["title"], "pages": pg,
                        "dates": it["dates"], "amounts": it["amounts"],
                        "text": header + "\n" + "\n".join(b["text"] for b in part)})
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(exist_ok=True)
    all_items, all_chunks = [], []
    for m, p in prepared().items():
        its = items(m, p)
        all_items += its
        all_chunks += chunks(its)
        print(f"{m}: {len(its) - 1} agenda items")
        for it in its[1:]:
            print(f"   {it['item']:<10} pp.{it['pages'][0]}-{it['pages'][-1]}  {it['title'][:70]}")
    for name, rows in (("v1_items.jsonl", all_items), ("v1_chunks.jsonl", all_chunks)):
        with open(OUT / name, "w", encoding="utf-8") as f:
            for r in rows:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
    print(f"{len(all_items)} items, {len(all_chunks)} chunks -> data/")
