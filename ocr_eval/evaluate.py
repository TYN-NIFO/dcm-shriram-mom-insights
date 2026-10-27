"""Score every OCR engine against the reference pages and the Synopsis facts.

Engines are discovered from outputs/<engine>/pages/<meeting>/pNNN.txt.

Tier 1 - reference pages (gold/<meeting>_pNNN.txt, visually verified):
  CER / WER     character / word error rate on normalised text (order-sensitive)
  Word F1       bag-of-words match, ignores reading order (fair to table layouts)
  Critical      recall of numbers, amounts, dates, percentages (must be 100%)
Tier 2 - all 132 pages:
  Synopsis      share of figures quoted in DCM's Synopsis register found in the meeting's OCR text
  Num. agree    share of numeric tokens per page that match the Azure DI baseline

Writes results/summary.md and results/details.json.
"""
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path

import pandas as pd
from rapidfuzz.distance import Levenshtein

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUTPUTS = HERE / "outputs"
GOLD = HERE / "gold"
RESULTS = HERE / "results"
SYNOPSIS = ROOT / "01_Client_Inputs" / "Synopsis of Minutes updated upto26.10.2012 - Being updated.xls"
MEETINGS = {(2, 8, 2015), (4, 5, 2021), (6, 5, 2024), (30, 10, 2024), (18, 1, 2025)}

BOILERPLATE = re.compile(r"^\s*(MINUTE BOOK|CHAIRMAN'?S( INITIAL)?|INITIAL)\s*$", re.I | re.M)
BULLETS = re.compile(r"[·•▪■◦●✓✔√→]")
NUMBER = re.compile(r"\d+(?:[.,/:]\d+)*%?")
# A person's name: title + capitalised words / initials, e.g. "Mr. Ajay S. Shriram", "Justice (Retd.) Vikramajit Sen"
NAME = re.compile(r"\b(?:Mr|Ms|Mrs|Dr|Justice)\.?(?: \(Retd\.\))?(?: (?!(?:Mr|Ms|Mrs|Dr)\b)[A-Z][A-Za-z]*\.?){1,4}")
COMPANY = re.compile(r"\b(?:[A-Z][A-Za-z]+ ){1,4}(?:Ltd|LLP|Limited)\b\.?")


def names(gold_text: str) -> Counter:
    """Names in a reference page; table cells (|) and lines bound a name so neighbouring cells aren't swallowed."""
    found = Counter()
    for seg in re.split(r"[|\n]", gold_text):
        seg = normalise(seg)
        found.update(n.strip() for n in NAME.findall(seg) + COMPANY.findall(seg))
    return found


def normalise(text: str) -> str:
    text = html.unescape(re.sub(r"<[^>]+>", " ", text))  # strip HTML (VLM outputs)
    text = re.sub(r"\\[()\[\]]", "", text).replace("\\%", "%").replace("\\sim", "~")  # inline LaTeX (Mistral OCR 4)
    text = re.sub(r"[*_#`]+", " ", text)                    # strip markdown emphasis/headings
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    text = text.replace("–", "-").replace("—", "-").replace("−", "-")
    text = BOILERPLATE.sub(" ", text)
    text = BULLETS.sub(" ", text).replace("|", " ")
    return re.sub(r"\s+", " ", text).strip()


def numbers(text: str) -> Counter:
    return Counter(NUMBER.findall(text))


def recall(gold: Counter, hyp: Counter) -> tuple[int, int]:
    return sum((gold & hyp).values()), sum(gold.values())


def engines() -> list[str]:
    return sorted(p.parent.name for p in OUTPUTS.glob("*/pages") if p.is_dir())


def page_text(engine: str, meeting: str, page: str) -> str | None:
    f = OUTPUTS / engine / "pages" / meeting / f"{page}.txt"
    return f.read_text(encoding="utf-8") if f.exists() else None


def tier1(engine: str) -> dict:
    rows = []
    for g in sorted(GOLD.glob("*.txt")):
        meeting, page = g.stem.split("_")
        hyp = page_text(engine, meeting, page)
        if hyp is None:
            continue
        ref, out = normalise(g.read_text(encoding="utf-8")), normalise(hyp)
        rw, ow = ref.split(), out.split()
        common = sum((Counter(rw) & Counter(ow)).values())
        p, r = common / max(len(ow), 1), common / max(len(rw), 1)
        hit, total = recall(numbers(ref), numbers(out))
        missed = sorted((numbers(ref) - numbers(out)).elements())
        # names are checked as a whole phrase against the engine's full text, so line layout doesn't matter
        ref_names = names(g.read_text(encoding="utf-8"))
        name_missed = sorted(n for n in ref_names.elements() if n not in out)
        rows.append({
            "name_hit": sum(ref_names.values()) - len(name_missed), "name_total": sum(ref_names.values()),
            "name_missed": name_missed,
            "page": g.stem,
            "cer": Levenshtein.distance(ref, out) / max(len(ref), 1),
            "wer": Levenshtein.distance(rw, ow) / max(len(rw), 1),
            "word_f1": 2 * p * r / max(p + r, 1e-9),
            "crit_hit": hit, "crit_total": total, "crit_missed": missed,
        })
    return {"pages": rows}


def synopsis_facts() -> list[dict]:
    """Figures quoted in Synopsis rows for the sample meetings (read-only use of DCM's register)."""
    mon = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}
    facts = []
    for sheet, df in pd.read_excel(SYNOPSIS, sheet_name=None, header=None).items():
        if sheet.lower().startswith("index"):
            continue
        for _, r in df.iterrows():
            v = list(r.values)
            try:
                d, y = int(float(v[0])), int(float(v[2]))
                m = str(v[1]).strip()
                m = int(float(m)) if m.replace(".", "").isdigit() else mon.get(m.lower()[:3])
            except (ValueError, TypeError):
                continue
            if (d, m, y) not in MEETINGS:
                continue
            meeting = f"{y}-{m:02d}-{d:02d}"
            for tok in NUMBER.findall(str(v[4])):
                if len(tok.replace(",", "").replace(".", "")) >= 3 or tok.endswith("%"):
                    facts.append({"meeting": meeting, "sheet": sheet, "res_no": str(v[3]), "token": tok})
    return facts


def meeting_text(engine: str, meeting: str) -> str:
    d = OUTPUTS / engine / "pages" / meeting
    return " ".join(normalise(f.read_text(encoding="utf-8")) for f in sorted(d.glob("p*.txt"))) if d.exists() else ""


def tier2(engine: str, facts: list[dict], baseline: str = "azure_di") -> dict:
    texts = {m: meeting_text(engine, m) for m in {f["meeting"] for f in facts}}
    found = [f for f in facts if texts[f["meeting"]] and f["token"] in texts[f["meeting"]]]
    covered = [f for f in facts if texts[f["meeting"]]]
    agree = total = 0
    base_dir = OUTPUTS / baseline / "pages"
    for meeting_dir in base_dir.iterdir():
        for f in meeting_dir.glob("p*.txt"):
            hyp = page_text(engine, meeting_dir.name, f.stem)
            if hyp is None:
                continue
            h, t = recall(numbers(normalise(f.read_text(encoding="utf-8"))), numbers(normalise(hyp)))
            agree, total = agree + h, total + t
    pages = sum(1 for _ in (OUTPUTS / engine / "pages").glob("*/p*.txt"))
    return {"pages": pages, "syn_found": len(found), "syn_total": len(covered),
            "syn_missed": [f for f in covered if f not in found], "num_agree": agree, "num_total": total}


def pct(a: float) -> str:
    return f"{100 * a:.1f}%"


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    RESULTS.mkdir(exist_ok=True)
    facts = synopsis_facts()
    details, lines = {}, []
    lines.append("| Engine | Pages run | CER | WER | Word F1 | Critical figures | Names | Synopsis figures | Numbers agree w/ Azure |")
    lines.append("| --- | --- | --- | --- | --- | --- | --- | --- | --- |")
    for e in engines():
        t1, t2 = tier1(e), tier2(e, facts)
        details[e] = {"tier1": t1, "tier2": t2}
        rows = t1["pages"]
        if rows:
            ch, ct = sum(r["crit_hit"] for r in rows), sum(r["crit_total"] for r in rows)
            nh, nt = sum(r["name_hit"] for r in rows), sum(r["name_total"] for r in rows)
            agg = (pct(sum(r["cer"] for r in rows) / len(rows)), pct(sum(r["wer"] for r in rows) / len(rows)),
                   pct(sum(r["word_f1"] for r in rows) / len(rows)), f"{ch}/{ct} ({pct(ch / ct)})",
                   f"{nh}/{nt} ({pct(nh / nt)})")
        else:
            agg = ("-",) * 5
        syn = f"{t2['syn_found']}/{t2['syn_total']}" if t2["syn_total"] else "-"
        num = pct(t2["num_agree"] / t2["num_total"]) if t2["num_total"] else "-"
        lines.append(f"| {e} | {t2['pages']} | " + " | ".join(agg) + f" | {syn} | {num} |")

    lines += ["", "## Per reference page (CER / critical figures)", "",
              "| Page | " + " | ".join(details) + " |", "| --- |" + " --- |" * len(details)]
    for g in sorted(GOLD.glob("*.txt")):
        cells = []
        for e in details:
            r = next((r for r in details[e]["tier1"]["pages"] if r["page"] == g.stem), None)
            cells.append(f"{pct(r['cer'])} / {r['crit_hit']}/{r['crit_total']}" if r else "-")
        lines.append(f"| {g.stem} | " + " | ".join(cells) + " |")

    lines += ["", "## Critical figures missed on reference pages", ""]
    for e in details:
        for r in details[e]["tier1"]["pages"]:
            if r["crit_missed"]:
                lines.append(f"- **{e}** {r['page']}: {', '.join(r['crit_missed'])}")

    lines += ["", "## Names missed on reference pages", ""]
    for e in details:
        for r in details[e]["tier1"]["pages"]:
            if r["name_missed"]:
                lines.append(f"- **{e}** {r['page']}: {'; '.join(r['name_missed'])}")

    (RESULTS / "summary.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (RESULTS / "details.json").write_text(json.dumps(details, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    print("\n".join(lines))
