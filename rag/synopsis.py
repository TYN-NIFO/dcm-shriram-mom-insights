"""DCM's Synopsis of Minutes (.xls) as its own source: one chunk per resolution row, shared by both versions.

Read-only: the workbook is DCM's document and is never written. Each row (sheet = topic) gives
day, month, year, resolution no. and a short description.
Writes data/synopsis_chunks.jsonl.
"""
import json
import re
import sys
from datetime import date

import pandas as pd

from prep import OUT, ROOT

SYNOPSIS = ROOT / "01_Client_Inputs" / "Synopsis of Minutes updated upto26.10.2012 - Being updated.xls"
MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _date(d, m, y) -> str | None:
    try:
        d, y = int(float(d)), int(float(y))
        m = str(m).strip()
        m = int(float(m)) if m.replace(".", "").isdigit() else MONTHS.get(m.lower()[:3])
        return date(y, m, d).isoformat()
    except (ValueError, TypeError):
        return None


def rows() -> list[dict]:
    out = []
    for sheet, df in pd.read_excel(SYNOPSIS, sheet_name=None, header=None).items():
        if sheet.lower().startswith("index"):
            continue
        topic = re.sub(r"^\d+\.\s*", "", sheet).strip()
        prev, section = None, ""
        for i, r in df.iterrows():
            v = list(r.values) + [None] * 5
            iso = _date(v[0], v[1], v[2])
            desc = " ".join(str(x).strip() for x in v[4:] if x is not None and str(x).strip() not in ("", "nan"))
            label = str(v[0]).strip()
            if not desc and not iso and label not in ("", "nan", "BACK") and not label.startswith(("Day", "Date")):
                section = label   # sub-section title inside a sheet, e.g. "Audit Committee" in Board Committees
                continue
            if not desc or desc.startswith("Particulars"):   # blank or column-header row
                prev = None if desc else prev
                continue
            if not iso:
                if prev is not None:                         # continuation line of the resolution above
                    prev["text"] += "\n" + desc
                continue
            res_no = "" if str(v[3]) == "nan" else str(v[3]).strip()
            full = f"{topic} / {section}" if section else topic
            out.append({"id": f"syn:{sheet}:{i}", "source": "synopsis", "topic": topic, "section": section, "date": iso,
                        "res_no": res_no, "row": int(i) + 1,
                        "text": f"Synopsis of Minutes · Topic: {full} · Meeting date: {iso} · "
                                f"Resolution no.: {res_no or '-'}\n{desc}"})
            prev = out[-1]
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(exist_ok=True)
    rs = rows()
    with open(OUT / "synopsis_chunks.jsonl", "w", encoding="utf-8") as f:
        for r in rs:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    years = sorted(r["date"][:4] for r in rs)
    print(f"{len(rs)} Synopsis rows from {len({r['topic'] for r in rs})} topics, {years[0]}-{years[-1]} -> data/synopsis_chunks.jsonl")
    print("example:", rs[0]["text"][:200])
