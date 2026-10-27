"""Reranking on top of Postgres + pgvector hybrid search (pgsearch.py), to compare with Azure's semantic ranker.

Candidates: Postgres hybrid + date filter + identifier list, top 50 pieces -> up to 20 distinct candidates (agenda item or Synopsis
row), each represented by the piece that matched (header line + ~100 words). A reranker reorders them; the
reordered items are scored exactly as in pgsearch.py.
Rerankers:
  llm     gpt-4.1-mini (Azure OpenAI, Standard, South India) returns the passages in order of relevance
  minilm  cross-encoder/ms-marco-MiniLM-L-6-v2 (open source, runs locally)
  bge     BAAI/bge-reranker-v2-m3 (open source, runs locally)
Usage: python rerank.py llm [minilm bge]   (open-source models need the .venv-rerank interpreter)
Writes results/rerank_<name>.json and prints the summary table.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

from compare import is_hit, load
from pgsearch import DSN, search

HERE = Path(__file__).resolve().parent
SUF = "_" + Path(os.environ["QFILE"]).stem if os.environ.get("QFILE") else ""
env = dotenv_values(HERE.parent / ".env")
CANDIDATES = 20
OSS = {"minilm": "cross-encoder/ms-marco-MiniLM-L-6-v2", "bge": "BAAI/bge-reranker-v2-m3"}
usage = Counter()


def chat(messages):
    url = (f"{env['AZURE_OPENAI_ENDPOINT'].rstrip('/')}/openai/deployments/{env['AZURE_OPENAI_CHAT_DEPLOYMENT']}"
           f"/chat/completions?api-version=2024-10-21")
    body = json.dumps({"messages": messages, "temperature": 0, "max_tokens": 200}).encode()
    for attempt in range(6):
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", "api-key": env["AZURE_OPENAI_KEY"]})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            usage.update({k: v for k, v in data["usage"].items() if isinstance(v, int)})
            return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(int(e.headers.get("retry-after", 10))); continue
            raise


def rerank_llm(q, cands):
    passages = "\n\n".join(f"[{i}] {' '.join(c['text'].split()[:180])}" for i, c in enumerate(cands, 1))
    out = chat([
        {"role": "system", "content": "You rank passages from company board minutes and a resolution register by how "
                                      "directly they answer the question. Exact matches on numbers, DINs, item numbers, "
                                      "names and dates matter most. Reply with the passage numbers only, most relevant "
                                      "first, comma-separated, at most 10."},
        {"role": "user", "content": f"Question: {q}\n\nPassages:\n{passages}"}])
    order = [int(x) - 1 for x in re.findall(r"\d+", out) if 0 < int(x) <= len(cands)]
    order = list(dict.fromkeys(order))
    return [cands[i] for i in order] + [c for i, c in enumerate(cands) if i not in order]


_models = {}


def rerank_oss(name, q, cands):
    from sentence_transformers import CrossEncoder
    if name not in _models:
        _models[name] = CrossEncoder(OSS[name], max_length=512)
    scores = _models[name].predict([(q, c["text"]) for c in cands])
    return [c for _, c in sorted(zip(scores, cands), key=lambda x: -x[0])]


def candidates(cur, q, children, synd, parents):
    out, seen = [], set()
    for did, src, parent, _ in search(cur, q, "hybrid+date+ids"):
        unit = synd[did] if src == "synopsis" else parents[parent]
        if unit["id"] in seen:
            continue
        seen.add(unit["id"])
        out.append({"unit": unit, "text": synd[did]["text"] if src == "synopsis" else children[did]["text"]})
        if len(out) == CANDIDATES:
            break
    return out


def score(rows_in, qs, items):
    rows = []
    for q, ranked in zip(qs, rows_in):
        k = 10 if q.get("kind") == "list" else 5
        found, first, via = set(), None, set()
        for r, d in enumerate(ranked[:k], 1):
            for g in q["gold"]:
                if h := is_hit(d, g[0], g[1], q, items, True):
                    found.add(tuple(g)); via.add(h); first = first or r
        rows.append({"q": q["q"], "type": q["type"], "found": len(found), "of": len(q["gold"]), "first": first})
    return rows


def summary(name, rows):
    single = [r for r in rows if r["type"] in ("lookup", "exact", "date")]
    return (f"| {name} | {sum(r['found'] > 0 for r in single)} | {sum(r['first'] == 1 for r in single)} | "
            f"{sum(r['found'] > 0 for r in rows if r['type'] == 'exact')} | "
            f"{sum(r['found'] for r in rows if r['type'] in ('list', 'cross'))} |")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    which = sys.argv[1:] or ["llm"]
    cur = psycopg2.connect(DSN).cursor()
    cur.execute("SET hnsw.ef_search = 100")
    qs = [q for q in json.load(open(HERE / os.environ.get("QFILE", "questions.json"), encoding="utf-8")) if q["type"] != "negative"]
    items = {(i["meeting"], i["item"]): i for i in load("v1_items.jsonl")}
    parents = {p["id"]: p for p in load("d_parents.jsonl")}
    children = {c["id"]: c for c in load("d_children.jsonl")}
    synd = {s["id"]: s for s in load("synopsis_chunks.jsonl")}
    cands = [candidates(cur, q["q"], children, synd, parents) for q in qs]
    L = ["| Setup | Single answers found (36) | Ranked 1st (36) | Exact numbers (8) | List items (33) |", "| --- | --- | --- | --- | --- |",
         summary("Postgres hybrid + date + identifiers (no reranker)", score([[c["unit"] for c in cs] for cs in cands], qs, items))]
    for name in which:
        t0 = time.time()
        if name == "llm":
            ranked = [[c["unit"] for c in rerank_llm(q["q"], cs)] for q, cs in zip(qs, cands)]
        else:
            ranked = [[c["unit"] for c in rerank_oss(name, q["q"], cs)] for q, cs in zip(qs, cands)]
        rows = score(ranked, qs, items)
        secs = (time.time() - t0) / len(qs)
        label = {"llm": "gpt-4.1-mini"}.get(name, OSS.get(name, name))
        L.append(summary(f"+ {label} reranker ({secs:.1f} s/question)", rows))
        (HERE / "results" / f"rerank_{name}{SUF}.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    L.append("| Azure AI Search hybrid + semantic ranker (reference) | 36 | 35 | 8 | 28 |")
    print("\n".join(L))
    if usage:
        print(f"gpt-4.1-mini tokens: {usage['prompt_tokens']} in, {usage['completion_tokens']} out")
