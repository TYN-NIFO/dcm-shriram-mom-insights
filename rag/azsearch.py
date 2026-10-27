"""Run the retrieval test on Azure AI Search (Free tier, Central India) instead of the local Python search.

Index = the production set: parent-child pieces (D) + Synopsis rows, with the vectors already embedded
(text-embedding-3-large, cached by embed.py), stored compressed to fit the Free tier's 50 MB:
half-precision field, int8 scalar quantization, full-precision originals discarded, vectors not retrievable.
A hit on a piece is mapped back to its whole agenda item (the parent), as in compare.py.

Modes: keyword, vector, hybrid (RRF inside AI Search), hybrid+date filter, semantic (hybrid + semantic
ranker), semantic+date.
Usage: python azsearch.py [--build]   (--build recreates the index and uploads; otherwise query only)
Writes results/azsearch.md.
"""
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

from dotenv import dotenv_values

from compare import MONTHS, is_hit, load
from embed import embed, key

HERE = Path(__file__).resolve().parent
SUF = "_" + Path(os.environ["QFILE"]).stem if os.environ.get("QFILE") else ""
env = dotenv_values(HERE.parent / ".env")
EP, KEY = env["AZURE_SEARCH_ENDPOINT"].rstrip("/"), env["AZURE_SEARCH_KEY"]
API = "2025-09-01"
INDEX = "dcm-minutes-poc"
DIMS = 3072


def call(method, path, body=None):
    req = urllib.request.Request(f"{EP}{path}{'&' if '?' in path else '?'}api-version={API}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", "api-key": KEY})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                raw = r.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as e:
            if e.code in (429, 503) and attempt < 4:
                time.sleep(5 * (attempt + 1)); continue
            raise RuntimeError(f"{method} {path}: {e.code} {e.read().decode()[:600]}") from None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))


SCHEMA = {
    "name": INDEX,
    "fields": [
        {"name": "id", "type": "Edm.String", "key": True, "filterable": True},
        {"name": "doc_id", "type": "Edm.String", "filterable": True},
        {"name": "source", "type": "Edm.String", "filterable": True, "facetable": True},
        {"name": "meeting_date", "type": "Edm.String", "filterable": True, "sortable": True},
        {"name": "year", "type": "Edm.Int32", "filterable": True},
        {"name": "month", "type": "Edm.Int32", "filterable": True},
        {"name": "item", "type": "Edm.String", "filterable": True},
        {"name": "parent", "type": "Edm.String", "filterable": True},
        {"name": "title", "type": "Edm.String", "searchable": True},
        {"name": "text", "type": "Edm.String", "searchable": True},
        {"name": "vector", "type": "Collection(Edm.Half)", "searchable": True, "retrievable": False, "stored": False,
         "dimensions": DIMS, "vectorSearchProfile": "p"},
    ],
    "vectorSearch": {
        "algorithms": [{"name": "hnsw", "kind": "hnsw", "hnswParameters": {"metric": "cosine", "m": 4, "efConstruction": 400, "efSearch": 500}}],
        "compressions": [{"name": "sq", "kind": "scalarQuantization", "scalarQuantizationParameters": {"quantizedDataType": "int8"},
                          "rescoringOptions": {"enableRescoring": False, "rescoreStorageMethod": "discardOriginals"}}],
        "profiles": [{"name": "p", "algorithm": "hnsw", "compression": "sq"}],
    },
    "semantic": {"defaultConfiguration": "sem", "configurations": [{"name": "sem", "prioritizedFields": {
        "titleField": {"fieldName": "title"}, "prioritizedContentFields": [{"fieldName": "text"}]}}]},
}


def safe_id(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip("=")


def docs():
    children, syn = load("d_children.jsonl"), load("synopsis_chunks.jsonl")
    vecs = embed([d["text"] for d in children + syn])
    out = []
    for c in children:
        y, m = int(c["meeting"][:4]), int(c["meeting"][5:7])
        out.append({"id": safe_id(c["id"]), "doc_id": c["id"], "source": "minutes", "meeting_date": c["meeting"],
                    "year": y, "month": m, "item": c["item"], "parent": c["parent"],
                    "title": c["text"].split("\n", 1)[0], "text": c["text"], "vector": vecs[key(c["text"])]})
    for s in syn:
        out.append({"id": safe_id(s["id"]), "doc_id": s["id"], "source": "synopsis", "meeting_date": s["date"],
                    "year": int(s["date"][:4]), "month": int(s["date"][5:7]), "item": s["res_no"], "parent": "",
                    "title": f"Synopsis: {s['topic']}" + (f" / {s['section']}" if s.get("section") else ""),
                    "text": s["text"], "vector": vecs[key(s["text"])]})
    return out


def build():
    try:
        call("DELETE", f"/indexes/{INDEX}")
    except RuntimeError:
        pass
    call("PUT", f"/indexes/{INDEX}", SCHEMA)
    ds = docs()
    for i in range(0, len(ds), 100):
        res = call("POST", f"/indexes/{INDEX}/docs/index", {"value": [{"@search.action": "upload", **d} for d in ds[i:i + 100]]})
        bad = [r for r in res["value"] if not r["status"]]
        if bad:
            raise RuntimeError(f"upload failed: {bad[:3]}")
        print(f"  uploaded {min(i + 100, len(ds))}/{len(ds)}", flush=True)
    time.sleep(5)
    st = call("GET", f"/indexes/{INDEX}/stats")
    print(f"index: {st['documentCount']} docs, storage {st['storageSize'] / 1e6:.1f} MB, vectors {st['vectorIndexSize'] / 1e6:.1f} MB")


def odata_date(q):
    import re
    years = set()
    for y, y2 in re.findall(r"\b((?:19|20)\d{2})-(\d{2})\b", q):
        years |= {int(y), int(y[:2] + y2)}
    years |= {int(y) for y in re.findall(r"\b((?:19|20)\d{2})\b(?!-\d)", q)}
    if not years:
        return None
    f = "(" + " or ".join(f"year eq {y}" for y in sorted(years)) + ")"
    month = next((n for m, n in MONTHS.items() if re.search(rf"\b{m}\b", q, re.I)), None)
    return f + (f" and month eq {month}" if month else "")


def search(q, mode, top=50, flt=None):
    """flt: an OData filter that replaces the regex date filter, e.g. from answer.py's question step."""
    body = {"top": top, "select": "doc_id,source,parent"}
    if flt:
        body["filter"] = flt
    base = mode.split("+")[0]
    if base in ("keyword", "hybrid", "semantic"):
        body["search"] = q
    if base in ("vector", "hybrid", "semantic"):
        body["vectorQueries"] = [{"kind": "vector", "vector": embed([q])[key(q)], "fields": "vector", "k": top}]
    if base == "semantic":
        body.update({"queryType": "semantic", "semanticConfiguration": "sem"})
    if flt is None and mode.endswith("+date") and (f := odata_date(q)):
        body["filter"] = f
    return call("POST", f"/indexes/{INDEX}/docs/search", body)["value"]


MODES = ["keyword", "vector", "hybrid", "hybrid+date", "semantic", "semantic+date"]

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if "--build" in sys.argv:
        build()
    qs = [q for q in json.load(open(HERE / os.environ.get("QFILE", "questions.json"), encoding="utf-8")) if q["type"] != "negative"]
    items = {(i["meeting"], i["item"]): i for i in load("v1_items.jsonl")}
    parents = {p["id"]: p for p in load("d_parents.jsonl")}
    synd = {s["id"]: s for s in load("synopsis_chunks.jsonl")}
    res = {}
    for mode in MODES:
        rows = []
        for q in qs:
            k = 10 if q.get("kind") == "list" else 5
            out, seen = [], set()
            for h in search(q["q"], mode):
                d = synd[h["doc_id"]] if h["source"] == "synopsis" else parents[h["parent"]]
                if d["id"] not in seen:
                    seen.add(d["id"]); out.append(d)
                if len(out) == k:
                    break
            found, first, via = set(), None, set()
            for r, d in enumerate(out, 1):
                for g in q["gold"]:
                    if h := is_hit(d, g[0], g[1], q, items, True):
                        found.add(tuple(g)); via.add(h); first = first or r
            rows.append({"q": q["q"], "type": q["type"], "found": len(found), "of": len(q["gold"]), "first": first, "minutes": "minutes" in via})
        res[mode] = rows
        print(f"done {mode}", flush=True)
    single = ("lookup", "exact", "date")
    n = Counter(q["type"] for q in qs)
    n_single, n_list = sum(n[t] for t in single), sum(len(q["gold"]) for q in qs if q["type"] in ("list", "cross"))
    L = ["# Azure AI Search (Free, Central India): parent-child pieces + Synopsis", "",
         f"| Search | Single answers found ({n_single}) | Ranked 1st ({n_single}) | Found in minutes text ({n_single}) | "
         f"Exact numbers ({n['exact']}) | Date questions ({n['date']}) | List items ({n_list}) | Synopsis-only ({n['synopsis']}) |",
         "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for mode, rows in res.items():
        s = [r for r in rows if r["type"] in single]
        cells = [sum(r["found"] > 0 for r in s), sum(r["first"] == 1 for r in s), sum(r["minutes"] for r in s),
                 sum(r["found"] > 0 for r in rows if r["type"] == "exact"), sum(r["found"] > 0 for r in rows if r["type"] == "date"),
                 sum(r["found"] for r in rows if r["type"] in ("list", "cross")), sum(r["found"] > 0 for r in rows if r["type"] == "synopsis")]
        L.append(f"| {mode} | " + " | ".join(map(str, cells)) + " |")
    L += ["", "## Single-answer questions missed (semantic+date)", ""]
    L += [f"- {r['q']}" for r in res["semantic+date"] if r["type"] in single and not r["found"]]
    (HERE / "results" / f"azsearch{SUF}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    (HERE / "results" / f"azsearch{SUF}.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print("\n".join(L))
