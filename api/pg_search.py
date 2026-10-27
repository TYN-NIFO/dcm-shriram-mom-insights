"""Postgres 17 + pgvector search for the PoC (local Docker container `dcm-pgvector`, table `docs`, built by
rag/pgsearch.py --build): the round-5 setup - hybrid (full-text + vector, RRF k=60) + identifier list (DINs, amounts,
item numbers that must all match) + rare-word list (query words found in under 1% of records, weight 2: Postgres
full-text ranking has no IDF, so a rare telling word such as "H2O2" otherwise counts no more than "plant")
-> up to 20 distinct candidates -> gpt-4.1-mini rerank.
Returns hits in the same shape as the Azure AI Search results ({"doc_id", "source", "parent"}), so pipeline.retrieve
works unchanged. Filters arrive in the pipeline's OData form and are translated to SQL.
"""
import asyncio
import re

from psycopg2.pool import ThreadedConnectionPool

CANDIDATES = 20
RARE_SHARE, RARE_WEIGHT = 0.01, 2.0

SQL = """
WITH q AS (SELECT to_tsquery('english', replace(plainto_tsquery('english', %(q)s)::text, '&', '|')) AS tq,
                  %(v)s::halfvec(3072) AS v),
kw AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, q.tq, 32) DESC) AS r
       FROM docs, q WHERE tsv @@ q.tq {flt} ORDER BY ts_rank_cd(tsv, q.tq, 32) DESC LIMIT 50),
vc AS (SELECT id, row_number() OVER (ORDER BY emb <=> q.v) AS r
       FROM docs, q WHERE true {flt} ORDER BY emb <=> q.v LIMIT 50),
ex AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, to_tsquery('english', %(ex)s), 32) DESC) AS r
       FROM docs WHERE %(use_ex)s AND tsv @@ to_tsquery('english', %(ex)s) {flt} LIMIT 50),
rare AS (SELECT id, row_number() OVER (ORDER BY ts_rank_cd(tsv, to_tsquery('simple', %(rare)s), 32) DESC) AS r
       FROM docs WHERE %(use_rare)s AND tsv @@ to_tsquery('simple', %(rare)s) {flt} LIMIT 50)
SELECT d.id, d.source, d.parent, sum(x.w / (60 + x.r)) AS score
FROM (SELECT id, r, 1.0 AS w FROM kw UNION ALL SELECT id, r, 1.0 FROM vc UNION ALL SELECT id, r, 1.0 FROM ex
      UNION ALL SELECT id, r, %(rare_w)s FROM rare) x JOIN docs d USING (id)
GROUP BY d.id, d.source, d.parent ORDER BY score DESC LIMIT 50;
"""

IDENT = re.compile(r"\b(?:DIN[: ]*)?\d{5,}\b|(?:Rs\.?|₹)\s*[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)+[A-Z]?\b|\b\d+\s*\([IVXivx]+\)")


def identifiers(q):
    """Exact identifiers in the question (DIN, amount, item number) -> an AND tsquery over just those tokens."""
    toks = []
    for m in IDENT.findall(q):
        toks += re.findall(r"[A-Za-z]*\.?\d[\d,.]*|[IVXivx]+", m.replace("DIN", ""))
    toks = [t.strip(".,").replace(",", "").lower() for t in toks if t.strip(".,")]
    return " & ".join(dict.fromkeys(re.sub(r"[^a-z0-9.]", "", t) for t in toks)) if toks else ""


# the only OData the pipeline writes: (year eq 2024 or year eq 2025), month eq 5, meeting_date ge|le|eq 'YYYY-MM-DD',
# source eq 'minutes'|'synopsis', joined by and / or
ODATA_TOKEN = re.compile(r"\s+|[()]|and|or|year|month|meeting_date|source|eq|ge|le|\d{1,4}|'\d{4}-\d{2}-\d{2}'|'minutes'|'synopsis'")


def sql_filter(flt):
    if not flt:
        return ""
    assert "".join(ODATA_TOKEN.findall(flt)) == flt, f"unexpected filter: {flt}"     # nothing else reaches SQL
    return " AND (" + re.sub(r"\b(eq|ge|le)\b", lambda m: {"eq": "=", "ge": ">=", "le": "<="}[m.group(1)], flt) + ")"


class PgSearch:
    def __init__(self, dsn, children, synd, parents, rerank_chat):
        self.pool = ThreadedConnectionPool(1, 4, dsn)
        self.free = asyncio.Semaphore(4)             # wait for a connection instead of failing (the check runs items in parallel)
        self.children, self.synd, self.parents, self.chat = children, synd, parents, rerank_chat
        conn = self.pool.getconn()
        try:
            with conn.cursor() as cur:                # document frequency of every word in the index
                cur.execute("SELECT count(*) FROM docs")
                n = cur.fetchone()[0]
                cur.execute("SELECT word, ndoc FROM ts_stat('SELECT tsv FROM docs')")
                self.df, self.rare_max = dict(cur.fetchall()), max(int(n * RARE_SHARE), 1)
        finally:
            conn.rollback()
            self.pool.putconn(conn)

    def _query(self, query, flt, vector):
        conn = self.pool.getconn()
        try:
            with conn.cursor() as cur:
                cur.execute("SET hnsw.ef_search = 100")
                ex = identifiers(query)
                cur.execute("SELECT plainto_tsquery('english', %s)::text", (query,))
                words = dict.fromkeys(re.findall(r"'((?:[^']|'')+)'", cur.fetchone()[0]))
                rare = [w for w in words if 0 < self.df.get(w.replace("''", "'"), 0) <= self.rare_max]
                cur.execute(SQL.format(flt=sql_filter(flt)), {"q": query, "v": "[" + ",".join(f"{x:.6f}" for x in vector) + "]",
                                                             "use_ex": bool(ex), "ex": ex or "x", "use_rare": bool(rare),
                                                             "rare": " | ".join(f"'{w}'" for w in rare) or "x",
                                                             "rare_w": RARE_WEIGHT})
                return cur.fetchall()
        finally:
            conn.rollback()
            self.pool.putconn(conn)

    async def rerank(self, query, cands):
        passages = "\n\n".join(f"[{i}] {' '.join(c['text'].split()[:180])}" for i, c in enumerate(cands, 1))
        out = await self.chat([
            {"role": "system", "content": "You rank passages from company board minutes and a resolution register by how "
                                          "directly they answer the question. Exact matches on numbers, DINs, item numbers, "
                                          "names and dates matter most. Return JSON {\"order\": [passage numbers, most "
                                          "relevant first, at most 10]}."},
            {"role": "user", "content": f"Question: {query}\n\nPassages:\n{passages}"}], 120, timeout=15)
        order = [int(x) - 1 for x in re.findall(r"\d+", str(out.get("order"))) if 0 < int(x) <= len(cands)]
        order = list(dict.fromkeys(order))
        return [cands[i] for i in order] + [c for i, c in enumerate(cands) if i not in order]

    async def search(self, query, flt, vector):
        async with self.free:
            rows = await asyncio.to_thread(self._query, query, flt, vector)
        cands, seen = [], set()                      # one candidate per agenda item / register row: its best piece
        for did, src, parent, _ in rows:
            unit = did if src == "synopsis" else parent
            if unit in seen:
                continue
            seen.add(unit)
            text = self.synd[did]["text"] if src == "synopsis" else self.children[did]["text"]
            cands.append({"hit": {"doc_id": did, "source": src, "parent": parent}, "text": text})
            if len(cands) == CANDIDATES:
                break
        if len(cands) > 1:
            cands = await self.rerank(query, cands)
        return [c["hit"] for c in cands]
