"""Compare four chunking variants x five retrieval modes on the test questions (questions.json).

Chunking (all index the same 1,957 Synopsis rows as a separate source):
  A fixed 400-word windows (v2_direct.py)   B recursive (chunkers.py)
  C one chunk per agenda item (v1_structured.py)   D parent-child: search small pieces, return the agenda item
Retrieval: keyword (BM25), vector (text-embedding-3-large, Standard, South India; cached by embed.py),
hybrid (both merged by reciprocal rank fusion, k=60, as Azure AI Search does), and vector / hybrid with a
date filter taken from the question (year, financial year, month).

A minutes hit = right meeting, covers the right agenda item (C, D: item number; A, B: page overlap) and contains
the evidence phrase. A Synopsis hit = right meeting date and resolution number.
Writes results/comparison.md and results/comparison.json.
"""
import json
import math
import re
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from embed import embed, key

HERE = Path(__file__).resolve().parent
DATA, RESULTS = HERE / "data", HERE / "results"
STOP = set("a an and are as at be by did do does for from has have in is it of on or the this to was were what when "
           "which who with all any list how much".split())
MONTHS = {m: i for i, m in enumerate(["january", "february", "march", "april", "may", "june", "july", "august",
                                      "september", "october", "november", "december"], 1)}
POOL = 50


def load(name):
    return [json.loads(l) for l in open(DATA / name, encoding="utf-8")]


def toks(s):
    return [t for t in re.findall(r"[a-z0-9]+(?:\.[0-9]+)*", s.lower()) if t not in STOP]


def doc_date(d):
    return d.get("meeting") or d.get("date", "")


def date_filter(q):
    """Years / month named in the question -> predicate on a document's meeting date, or None."""
    years = set()
    for y, y2 in re.findall(r"\b((?:19|20)\d{2})-(\d{2})\b", q):        # financial year 2020-21 -> 2020, 2021
        years |= {int(y), int(y[:2] + y2)}
    years |= {int(y) for y in re.findall(r"\b((?:19|20)\d{2})\b(?!-\d)", q)}
    if not years:
        return None
    month = next((n for m, n in MONTHS.items() if re.search(rf"\b{m}\b", q, re.I)), None)
    return lambda d: int(doc_date(d)[:4] or 0) in years and (month is None or int(doc_date(d)[5:7] or 0) == month)


class BM25:
    def __init__(self, docs, k1=1.5, b=0.75):
        self.docs, self.k1, self.b = docs, k1, b
        self.tf = [Counter(toks(d["text"])) for d in docs]
        self.len = np.array([sum(t.values()) for t in self.tf])
        self.avg = self.len.mean()
        df = Counter(w for t in self.tf for w in t)
        self.idf = {w: math.log(1 + (len(docs) - n + 0.5) / (n + 0.5)) for w, n in df.items()}

    def rank(self, q):
        qs = toks(q)
        s = np.zeros(len(self.docs))
        for i, tf in enumerate(self.tf):
            s[i] = sum(self.idf[w] * tf[w] * (self.k1 + 1) / (tf[w] + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
                       for w in qs if w in tf)
        return [i for i in np.argsort(-s) if s[i] > 0]


class Vector:
    def __init__(self, docs):
        self.docs = docs
        vecs = embed([d["text"] for d in docs])
        self.m = np.array([vecs[key(d["text"])] for d in docs], dtype="float32")
        self.m /= np.linalg.norm(self.m, axis=1, keepdims=True)

    def rank(self, q):
        v = np.array(embed([q])[key(q)], dtype="float32")
        return list(np.argsort(-(self.m @ (v / np.linalg.norm(v)))))


class Engine:
    """Ranks documents by one mode, applies the optional date filter, and (for D) maps children to parents."""

    def __init__(self, docs, parents=None):
        self.docs, self.parents = docs, parents or {}
        self.bm25, self.vec = BM25(docs), Vector(docs)

    def search(self, q, k, mode):
        flt = date_filter(q) if mode.endswith("+date") else None
        keep = (lambda i: flt(self.docs[i])) if flt else (lambda i: True)
        lists = {"keyword": [self.bm25.rank(q)], "vector": [self.vec.rank(q)],
                 "hybrid": [self.bm25.rank(q), self.vec.rank(q)]}[mode.split("+")[0]]
        score = {}
        for ranked in lists:
            for r, i in enumerate([i for i in ranked if keep(i)][:POOL], 1):
                score[i] = score.get(i, 0) + 1 / (60 + r)              # RRF; a single list keeps its own order
        out, seen = [], set()
        for i in sorted(score, key=lambda i: -score[i]):
            d = self.docs[i]
            d = self.parents.get(d.get("parent"), d)                    # D: a child hit returns its agenda item
            if d["id"] not in seen:
                seen.add(d["id"]); out.append(d)
            if len(out) == k:
                break
        return out


def norm_no(s):
    return re.sub(r"[\s().]", "", s).lower()


def is_hit(d, meeting, item, q, items, by_item):
    if d.get("source") == "synopsis":
        a, b = norm_no(d["res_no"]), norm_no(item)
        return "synopsis" if d["date"] == meeting and a and (a == b or a.startswith(b) or b.startswith(a)) else None
    if (meeting, item) not in items or d["meeting"] != meeting:
        return None
    if not any(e.lower() in d["text"].lower() for e in q["evidence"]):
        return None
    if by_item:
        return "minutes" if d["item"] == item or d["item"].startswith(item + ".") else None
    return "minutes" if set(items[(meeting, item)]["pages"]) & set(d["pages"]) else None


MODES = ["keyword", "vector", "hybrid", "vector+date", "hybrid+date"]


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    RESULTS.mkdir(exist_ok=True)
    qs = json.load(open(HERE / "questions.json", encoding="utf-8"))
    items = {(i["meeting"], i["item"]): i for i in load("v1_items.jsonl")}
    syn = load("synopsis_chunks.jsonl")
    parents = {p["id"]: p for p in load("d_parents.jsonl")}
    variants = {"A fixed": (load("v2_chunks.jsonl"), None, False), "B recursive": (load("b_chunks.jsonl"), None, False),
                "C agenda item": (load("v1_chunks.jsonl"), None, True), "D parent-child": (load("d_children.jsonl"), parents, True)}
    scored = [q for q in qs if q["type"] != "negative"]
    res = {}
    for vname, (docs, par, by_item) in variants.items():
        eng = Engine(docs + syn, par)
        for mode in MODES:
            rows = []
            for q in scored:
                k = 10 if q.get("kind") == "list" else 5
                hits = eng.search(q["q"], k, mode)
                found, first, via = set(), None, set()
                for r, d in enumerate(hits, 1):
                    for g in q["gold"]:
                        h = is_hit(d, g[0], g[1], q, items, by_item)
                        if h:
                            found.add(tuple(g)); via.add(h)
                            first = first or r
                rows.append({"q": q["q"], "type": q["type"], "found": len(found), "of": len(q["gold"]),
                             "first": first, "minutes": "minutes" in via})
            res[(vname, mode)] = rows
            print(f"done {vname} / {mode}", flush=True)

    single = ("lookup", "exact", "date")
    n = Counter(q["type"] for q in scored)
    n_single, n_list = sum(n[t] for t in single), sum(len(q["gold"]) for q in scored if q["type"] in ("list", "cross"))
    L = ["# Chunking x retrieval comparison", "",
         f"{len(qs)} test questions ({len(scored)} scored for retrieval; {len(qs) - len(scored)} 'not in the minutes' "
         "questions are kept for the answer test). Every variant also indexes DCM's Synopsis (1,957 rows). "
         "Top 5 for single answers, top 10 for lists.", "",
         f"| Chunking | Search | Single answers found ({n_single}) | Ranked 1st ({n_single}) | Found in minutes text ({n_single}) | "
         f"Exact numbers ({n['exact']}) | Date questions ({n['date']}) | List items found ({n_list}) | Synopsis-only ({n['synopsis']}) |",
         "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for (v, m), rows in res.items():
        s = [r for r in rows if r["type"] in single]
        cells = [sum(r["found"] > 0 for r in s), sum(r["first"] == 1 for r in s), sum(r["minutes"] for r in s),
                 sum(r["found"] > 0 for r in rows if r["type"] == "exact"), sum(r["found"] > 0 for r in rows if r["type"] == "date"),
                 sum(r["found"] for r in rows if r["type"] in ("list", "cross")), sum(r["found"] > 0 for r in rows if r["type"] == "synopsis")]
        L.append(f"| {v} | {m} | " + " | ".join(str(c) for c in cells) + " |")
    L += ["", "## Questions missed by C and D with hybrid + date filter", ""]
    for v in ("C agenda item", "D parent-child"):
        for r in res[(v, "hybrid+date")]:
            if r["found"] < r["of"]:
                L.append(f"- {v}: {r['q']} ({r['found']}/{r['of']})")
    (RESULTS / "comparison.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    (RESULTS / "comparison.json").write_text(json.dumps({f"{v} / {m}": rows for (v, m), rows in res.items()}, indent=1, ensure_ascii=False), encoding="utf-8")
    print("\n".join(L))
