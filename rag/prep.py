"""Shared preparation for both chunking versions, from cached Azure DI (prebuilt-layout) JSON.

- Cleans each meeting into an ordered list of blocks (paragraphs and tables) with their PDF page.
  Drops page headers/footers/page numbers, the Chairman's initials box (ADI `figures`) and
  low-confidence handwriting (signatures, signing dates).
- A7 page mapping: PDF page -> printed minute-book page, checked against the file-name range.

Usage: python prep.py   (prints the page map check for every meeting)
"""
import bisect
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
ADI = HERE.parent / "ocr_eval" / "outputs" / "azure_di"
SAMPLES = ROOT / "01_Client_Inputs" / "Sample_Minutes"
OUT = HERE / "data"

BOILERPLATE = re.compile(r"^(?:[Vv✓]\s+)?(MINUTE BOOK|CHAIRMAN'?S?'?( INITIAL)?|INI.IAL|CHAIRMAN|:(?:un)?selected:)$", re.I)
HANDWRITING_CONF = 0.5   # mean word confidence below this on a short paragraph = handwriting / pen marks
LAYOUT_CELL = 400        # chars; a "table cell" longer than this is a whole page ADI boxed as a table


def meetings() -> dict[str, tuple[int, int]]:
    """meeting date (YYYY-MM-DD) -> (first, last) minute-book page from the PDF file name."""
    out = {}
    for pdf in SAMPLES.glob("*.pdf"):
        dd, mm, yyyy = pdf.stem.split(" - ")[1].split(" ")[0].split(".")
        first, last = re.search(r"Page (\d+)\s*-\s*(\d+)", pdf.stem).groups()
        out[f"{yyyy}-{mm}-{dd}"] = (int(first), int(last))
    return dict(sorted(out.items()))


def load(meeting: str) -> dict:
    return json.loads((ADI / f"{meeting}.json").read_text(encoding="utf-8"))


def _word_conf(doc: dict):
    words = sorted((w["span"]["offset"], w["confidence"]) for p in doc["pages"] for w in p["words"])
    offsets = [o for o, _ in words]

    def conf(spans: list[dict]) -> float:
        cs = [c for s in spans for c in (words[i][1] for i in range(
            bisect.bisect_left(offsets, s["offset"]), bisect.bisect_left(offsets, s["offset"] + s["length"])))]
        return sum(cs) / len(cs) if cs else 1.0
    return conf


def page_map(doc: dict, first: int, last: int) -> tuple[dict[int, int], list[str]]:
    """A7: PDF page -> minute-book page. The printed number is the bare number nearest the top of the page
    (ADI usually tags it `pageNumber`, sometimes `sectionHeading` or nothing)."""
    found = {}
    for p in doc["paragraphs"]:
        if re.fullmatch(r"\d{3,5}", p["content"].strip()):
            br = p["boundingRegions"][0]
            y = min(br["polygon"][1::2])
            if y > 2.0:   # inches from the top; the minute-book number sits in the header band (lower on even pages)
                continue
            if br["pageNumber"] not in found or y < found[br["pageNumber"]][0]:
                found[br["pageNumber"]] = (y, int(p["content"]))
    n = len(doc["pages"])
    mapping, issues = {}, []
    for pg in range(1, n + 1):
        expected = first + pg - 1
        printed = found.get(pg, (None, None))[1]
        if printed is None:
            issues.append(f"PDF p{pg}: no printed page number, using {expected} from the file-name range")
        elif printed != expected:
            issues.append(f"PDF p{pg}: printed {printed} but sequence expects {expected}")
        mapping[pg] = printed if printed is not None else expected
    if first + n - 1 != last:
        issues.append(f"file name says {first}-{last} ({last - first + 1} pages) but the PDF has {n}")
    return mapping, issues


def blocks(doc: dict) -> list[dict]:
    """Ordered blocks: {'kind': 'para'|'table', 'page', 'text', 'role', 'x'} with noise removed."""
    conf = _word_conf(doc)
    paras = doc["paragraphs"]
    drop = {int(e.split("/")[-1]) for f in doc.get("figures", []) for e in f.get("elements", [])}
    in_table, table_at = set(), {}
    for t in doc.get("tables", []):
        if any(len(c["content"]) > LAYOUT_CELL for c in t["cells"]):
            continue   # a page border mistaken for a table: read its paragraphs as normal text
        idx = [int(e.split("/")[-1]) for c in t["cells"] for e in c.get("elements", [])]
        if idx:
            in_table.update(idx)
            table_at[min(idx)] = t
    out = []
    for i, p in enumerate(paras):
        if i in table_at:
            t = table_at[i]
            rows = {}
            for c in t["cells"]:
                rows.setdefault(c["rowIndex"], {})[c["columnIndex"]] = c["content"].replace("\n", " ").replace("|", "/")
            text = "\n".join("| " + " | ".join(r.get(j, "") for j in range(t["columnCount"])) + " |"
                             for _, r in sorted(rows.items()))
            out.append({"kind": "table", "page": t["boundingRegions"][0]["pageNumber"], "text": text, "role": None, "x": None})
        if i in in_table or i in drop or p.get("role") in ("pageHeader", "pageFooter", "pageNumber"):
            continue
        text = p["content"].strip()
        br = p["boundingRegions"][0]
        if not text or BOILERPLATE.match(text):
            continue
        if re.fullmatch(r"\d{3,5}", text) and min(br["polygon"][1::2]) <= 2.0:   # untagged page number
            continue
        if len(text) <= 15 and conf(p["spans"]) < HANDWRITING_CONF:
            continue
        if len(text) <= 3 and min(br["polygon"][0::2]) < 1.0:   # stray mark in the left margin
            continue
        out.append({"kind": "para", "page": br["pageNumber"], "text": text, "role": p.get("role"),
                    "x": min(br["polygon"][0::2])})
    return out


def prepared() -> dict[str, dict]:
    """meeting -> {'blocks': [...], 'pages': {pdf_page: minute_book_page}, 'issues': [...]}"""
    res = {}
    for m, (first, last) in meetings().items():
        doc = load(m)
        mapping, issues = page_map(doc, first, last)
        res[m] = {"blocks": blocks(doc), "pages": mapping, "issues": issues}
    return res


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for m, r in prepared().items():
        pages = r["pages"]
        print(f"{m}: {len(r['blocks'])} blocks, PDF p1-{len(pages)} -> minute-book {pages[1]}-{pages[len(pages)]}")
        for i in r["issues"]:
            print("   !", i)
