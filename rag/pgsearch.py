"""Same retrieval test as azsearch.py, on Postgres 17 + pgvector 0.8.0 (local Docker container, port 55432).

Table = the production set: parent-child pieces (D) + Synopsis rows, vectors from the embed.py cache stored as
halfvec(3072) with an HNSW cosine index. Keyword = Postgres full-text search (English stemming, words OR-ed,
ranked by ts_rank_cd). Hybrid = both top-50 lists merged by RRF (k=60) in SQL. No reranker exists here.
Modes: keyword, vector, hybrid, hybrid+date.
Usage: python pgsearch.py [--build]
Writes results/pgsearch.md.
"""
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import psycopg2
from dotenv import dotenv_values

from compare import MONTHS, is_hit, load
from embed import embed, key

HERE = Path(__file__).resolve().parent
SUF = "_" + Path(os.environ["QFILE"]).stem if os.environ.get("QFILE") else ""
DSN = dotenv_values(HERE.parent / ".env")["PGVECTOR_DSN"]

DDL = """
DROP TABLE IF EXISTS docs;
CREATE TABLE docs (
  id text PRIMARY KEY, source text, meeting_date text, year int, month int, item text, parent text,
  title text, text text, tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(title,'') || ' ' || text)) STORED,
  emb halfvec(3072));
"""
INDEXES = """
CREATE INDEX ON docs USING gin (tsv);
CREATE INDEX ON docs USING hnsw (emb halfvec_cosine_ops);
CREATE INDEX ON docs (year, month);
ANALYZE docs;
"""

SQL = """
WITH q AS (SELECT to_tsquery('english', replace(plainto_tsquery('english', %(q)s)::text, '&', '|')) AS tq,
                  %(v)s::halfvec(3072) AS v),
kw AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q.tq, 32) DESC) AS r
       FROM docs, q WHERE %(use_kw)s AND tsv @@ q.tq {flt} ORDER BY ts_rank_cd(tsv, q.tq, 32) DESC LIMIT 50),
vc AS (SELECT id, row_number() OVER (ORDER BY emb <=> q.v) AS r
       FROM docs, q WHERE %(use_vec)s {flt} ORDER BY emb <=> q.v LIMIT 50),
ex AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, to_tsquery('english', %(ex)s), 32) DESC) AS r
       FROM docs WHERE %(use_ex)s AND tsv @@ to_tsquery('english', %(ex)s) {flt} LIMIT 50)
SELECT d.id, d.source, d.parent, sum(1.0 / (60 + x.r)) AS score
FROM (SELECT * FROM kw UNION ALL SELECT * FROM vc UNION ALL SELECT * FROM ex) x JOIN docs d USING (id)
GROUP BY d.id, d.source, d.parent ORDER BY score DESC LIMIT 50;
"""


def vec(t):
    return "[" + ",".join(f"{x:.6f}" for x in embed([t])[key(t)]) + "]"


def build(cur):
    cur.execute(DDL)
    children, syn = load("d_children.jsonl"), load("synopsis_chunks.jsonl")
    vecs = embed([d["text"] for d in children + syn])
    rows = [(c["id"], "minutes", c["meeting"], int(c["meeting"][:4]), int(c["meeting"][5:7]), c["item"], c["parent"],
             c["text"].split("\n", 1)[0], c["text"], c["text"]) for c in children]
    rows += [(s["id"], "synopsis", s["date"], int(s["date"][:4]), int(s["date"][5:7]), s["res_no"], "",
              f"Synopsis: {s['topic']}" + (f" / {s['section']}" if s.get("section") else ""), s["text"], s["text"]) for s in syn]
    for r in rows:
        v = "[" + ",".join(f"{x:.6f}" for x in vecs[key(r[-1])]) + "]"
        cur.execute("INSERT INTO docs (id, source, meeting_date, year, month, item, parent, title, text, emb) "
                    "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::halfvec(3072))", r[:-1] + (v,))
    cur.execute(INDEXES)
    cur.execute("SELECT count(*), pg_size_pretty(pg_total_relation_size('docs')) FROM docs")
    print("loaded %s rows, table + indexes %s" % cur.fetchone())


def date_sql(q):
    years = set()
    for y, y2 in re.findall(r"\b((?:19|20)\d{2})-(\d{2})\b", q):
        years |= {int(y), int(y[:2] + y2)}
    years |= {int(y) for y in re.findall(r"\b((?:19|20)\d{2})\b(?!-\d)", q)}
    if not years:
        return ""
    month = next((n for m, n in MONTHS.items() if re.search(rf"\b{m}\b", q, re.I)), None)
    return f" AND year IN ({','.join(map(str, sorted(years)))})" + (f" AND month = {month}" if month else "")


IDENT = re.compile(r"\b(?:DIN[: ]*)?\d{5,}\b|(?:Rs\.?|₹)\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)+[A-Z]?\b|\b\d+\s*\([IVXivx]+\)")


def identifiers(q):
    """Exact identifiers in the question (DIN, amount, item number) -> an AND tsquery over just those tokens."""
    toks = []
    for m in IDENT.findall(q):
        toks += re.findall(r"[A-Za-z]*\.?\d[\d,.]*|[IVXivx]+", m.replace("DIN", ""))
    toks = [t.strip(".,").replace(",", "").lower() for t in toks if t.strip(".,")]
    return " & ".join(dict.fromkeys(re.sub(r"[^a-z0-9.]", "", t) for t in toks)) if toks else ""


def search(cur, q, mode, flt=None):
    """flt: an SQL filter (" AND year IN (...)") that replaces the regex date filter, e.g. from answer.py's question step."""
    base = mode.split("+")[0]
    if flt is None:
        flt = date_sql(q) if mode.endswith("+date") else ""   # note: "hybrid+date+ids" (round 5) ran with no date filter
    ex = identifiers(q) if "+ids" in mode else ""
    cur.execute(SQL.format(flt=flt), {"q": q, "v": vec(q), "use_kw": base in ("keyword", "hybrid"),
                                       "use_vec": base in ("vector", "hybrid"), "use_ex": bool(ex), "ex": ex or "x"})
    return cur.fetchall()


MODES = ["keyword", "vector", "hybrid", "hybrid+date", "hybrid+date+ids"]

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    conn = psycopg2.connect(DSN)
    conn.autocommit = True
    cur = conn.cursor()
    if "--build" in sys.argv:
        build(cur)
    cur.execute("SET hnsw.ef_search = 100")
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
            for did, src, parent, _ in search(cur, q["q"], mode):
                d = synd[did] if src == "synopsis" else parents[parent]
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
    single = ("lookup", "exact", "date")
    n = Counter(q["type"] for q in qs)
    n_single, n_list = sum(n[t] for t in single), sum(len(q["gold"]) for q in qs if q["type"] in ("list", "cross"))
    L = ["# Postgres 17 + pgvector 0.8.0 (local Docker): parent-child pieces + Synopsis", "",
         f"| Search | Single answers found ({n_single}) | Ranked 1st ({n_single}) | Found in minutes text ({n_single}) | "
         f"Exact numbers ({n['exact']}) | Date questions ({n['date']}) | List items ({n_list}) | Synopsis-only ({n['synopsis']}) |",
         "| --- | --- | --- | --- | --- | --- | --- | --- |"]
    for mode, rows in res.items():
        s = [r for r in rows if r["type"] in single]
        cells = [sum(r["found"] > 0 for r in s), sum(r["first"] == 1 for r in s), sum(r["minutes"] for r in s),
                 sum(r["found"] > 0 for r in rows if r["type"] == "exact"), sum(r["found"] > 0 for r in rows if r["type"] == "date"),
                 sum(r["found"] for r in rows if r["type"] in ("list", "cross")), sum(r["found"] > 0 for r in rows if r["type"] == "synopsis")]
        L.append(f"| {mode} | " + " | ".join(map(str, cells)) + " |")
    L += ["", "## Single-answer questions missed (hybrid+date)", ""]
    L += [f"- {r['q']}" for r in res["hybrid+date"] if r["type"] in single and not r["found"]]
    (HERE / "results" / f"pgsearch{SUF}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    (HERE / "results" / f"pgsearch{SUF}.json").write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
    print("\n".join(L))
