"""Answer test (Pipeline B): question step -> retrieval -> answer with citations -> scoring, on both search backends.

1. Question step (B3): gpt-4.1-mini rewrites the question in the minutes' wording and returns the filters
   (years, month) and whether it is a list question. Shared by both backends.
2. Retrieval:
     pg  Postgres + pgvector hybrid + identifier list + the step-1 date filter, top 20 -> gpt-4.1-mini rerank
     az  Azure AI Search hybrid + semantic ranker + the step-1 date filter
   Top 5 agenda items / Synopsis rows go to the answer (12 for list questions), each whole agenda item.
3. Answer: gpt-4.1-mini (Standard, South India), only from the numbered sources, citing [S1].., or "not found".
4. Scoring:
     context    a gold item is among the sources given to the model
     correct    judged by gpt-4.1-mini against the gold source text (correct / partial / wrong)
     cited      the answer cites a gold item (list questions: how many gold items it cites)
     numbers    every number in the answer appears in the sources it cites (deterministic check)
     faithful   judge: no claim in the answer that the cited sources don't support
     refusal    "not in the minutes" questions answered "not found"; false refusals counted on the rest
All model calls are cached in data/llm_cache.json, so a rerun costs nothing.
Usage: python answer.py pg az     Writes results/answers_<backend>.json and results/answers.md.
"""
import hashlib
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import dotenv_values

from compare import is_hit, load, norm_no
from embed import embed

HERE = Path(__file__).resolve().parent
env = dotenv_values(HERE.parent / ".env")
CACHE = HERE / "data" / "llm_cache.json"
TOP_SINGLE, TOP_LIST, MAX_WORDS = 5, 12, 1200
# GEN=luna: the answer step (only) uses gpt-6-luna on the testingresource account (Global, not India-processed;
# approved by the user 26 Oct 2026 for this comparison). Question step, rerank and judge stay gpt-4.1-mini.
GEN = os.environ.get("GEN", "mini")
QSET = os.environ.get("QSET", "")         # QSET=holdout: run only the frozen hold-out set (holdout_questions.json)
# FIX=1: round-8 fixes - every approval in the answer, totals summed in code, names re-spelled from the source,
# top 8 sources (20 for lists, with Synopsis rows searched separately)
FIX = os.environ.get("FIX") == "1"
if FIX:
    TOP_SINGLE, TOP_LIST = 8, 20
SUFFIX = ("" if GEN == "mini" else f"_{GEN}") + (f"_{QSET}" if QSET else "") + ("_fix" if FIX else "")
usage, usage_luna, lock = Counter(), Counter(), threading.Lock()
_cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}


def chat(messages, max_tokens=800, json_mode=True, luna=False):
    """gpt-4.1-mini, or gpt-6-luna with luna=True (JSON mode unless json_mode=False); cached on the full request."""
    if luna:       # reasoning model: default temperature only, and the token limit includes reasoning
        body = {"model": "gpt-6-luna", "messages": messages, "max_completion_tokens": max_tokens * 6}
        url, key = env["JUDGE_ENDPOINT"].rstrip("/") + "/chat/completions", env["JUDGE_KEY"]
    elif env.get("CHAT_VIA") == "testingresource":   # gpt-4.1-mini on the Global testingresource account (PoC, 26 Oct)
        body = {"model": "gpt-4.1-mini", "messages": messages, "temperature": 0, "max_tokens": max_tokens}
        url, key = env["JUDGE_ENDPOINT"].rstrip("/") + "/chat/completions", env["JUDGE_KEY"]
    else:
        body = {"messages": messages, "temperature": 0, "max_tokens": max_tokens}
        url = (f"{env['AZURE_OPENAI_ENDPOINT'].rstrip('/')}/openai/deployments/{env['AZURE_OPENAI_CHAT_DEPLOYMENT']}"
               f"/chat/completions?api-version=2024-10-21")
        key = env["AZURE_OPENAI_KEY"]
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    k = hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:32]
    if k in _cache:
        return _cache[k]
    data = json.dumps(body).encode()
    for attempt in range(8):
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", "api-key": key})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                res = json.load(r)
            break
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 503) and attempt < 7:
                time.sleep(int(e.headers.get("retry-after", 10))); continue
            raise
    content = res["choices"][0]["message"]["content"]
    try:
        out = json.loads(content) if json_mode else content
    except json.JSONDecodeError:
        out = {}
    with lock:
        (usage_luna if luna else usage).update({k2: v for k2, v in res["usage"].items() if isinstance(v, int)})
        if luna:
            usage_luna.update(cached=(res["usage"].get("prompt_tokens_details") or {}).get("cached_tokens", 0),
                              reasoning=(res["usage"].get("completion_tokens_details") or {}).get("reasoning_tokens", 0))
        _cache[k] = out
    return out


def save_cache():
    CACHE.write_text(json.dumps(_cache, ensure_ascii=False), encoding="utf-8")


# ---------- 1. question step ----------

UNDERSTAND = """You prepare search queries over the Board minutes of DCM Shriram Ltd (formal Indian company-secretarial \
English, 2015-2025) and the company's Synopsis of Minutes register (topic, date, resolution number, one-line summary).
Return JSON with:
- "query": the question with every original word kept, plus the words the minutes would use for the same thing: \
abbreviations and formulas (e.g. hydrogen peroxide -> H2O2), formal terms (e.g. missed the meeting -> leave of absence; \
payout -> dividend; boss -> Managing Director), and "Rs." for rupee amounts. At most 12 added words.
- "years": calendar years the question limits itself to, only when stated: a year -> [2024]; financial year 2023-24 -> \
[2023, 2024]; "since 2015" -> 2015..2025; otherwise [].
- "month": 1-12 when a month of the meeting is stated, else null.
- "list": true when the question asks for all / every / several items, else false."""


def understand(q):
    out = chat([{"role": "system", "content": UNDERSTAND}, {"role": "user", "content": q}], 300)
    years = sorted({int(y) for y in out.get("years") or [] if str(y).isdigit() and 1985 <= int(y) <= 2030})
    month = out.get("month") if isinstance(out.get("month"), int) and 1 <= out["month"] <= 12 else None
    return {"query": out.get("query") or q, "years": years, "month": month, "list": bool(out.get("list"))}


def pg_filter(u):
    if not u["years"]:
        return ""
    return f" AND year IN ({','.join(map(str, u['years']))})" + (f" AND month = {u['month']}" if u["month"] else "")


def az_filter(u):
    if not u["years"]:
        return ""
    return "(" + " or ".join(f"year eq {y}" for y in u["years"]) + ")" + (f" and month eq {u['month']}" if u["month"] else "")


# ---------- 2. retrieval ----------

parents = {p["id"]: p for p in load("d_parents.jsonl")}
children = {c["id"]: c for c in load("d_children.jsonl")}
synd = {s["id"]: s for s in load("synopsis_chunks.jsonl")}
items = {(i["meeting"], i["item"]): i for i in load("v1_items.jsonl")}


def retrieve_pg(cur, q, u):
    from pgsearch import search
    import rerank
    rerank.chat = lambda m: chat(m, 200, json_mode=False)          # cache the rerank calls too
    cands, seen = [], set()
    for did, src, parent, _ in search(cur, u["query"], "hybrid+ids", flt=pg_filter(u)):
        unit = synd[did] if src == "synopsis" else parents[parent]
        if unit["id"] not in seen:
            seen.add(unit["id"])
            cands.append({"unit": unit, "text": synd[did]["text"] if src == "synopsis" else children[did]["text"]})
        if len(cands) == 20:
            break
    return [c["unit"] for c in rerank.rerank_llm(u["query"], cands)] if cands else []


def retrieve_az(q, u):
    from azsearch import search
    out, seen = [], set()
    hits = search(u["query"], "semantic", flt=az_filter(u))
    if FIX and u["list"]:
        # list route: the register row per resolution is the best index of "every X"; search it on its own too and
        # interleave, so the minutes pieces don't crowd the Synopsis rows out of the top 20
        f = az_filter(u)
        syn = search(u["query"], "semantic", flt=(f + " and " if f else "") + "source eq 'synopsis'")
        hits = [h for pair in zip(hits, syn) for h in pair] + hits[len(syn):] + syn[len(hits):]
    for h in hits:
        unit = synd[h["doc_id"]] if h["source"] == "synopsis" else parents[h["parent"]]
        if unit["id"] not in seen:
            seen.add(unit["id"]); out.append(unit)
    return out


# ---------- 3. answer ----------

def label(d):
    if d.get("source") == "synopsis":
        return f"Synopsis of Minutes, topic {d['topic']}, meeting {d['date']}, resolution {d['res_no']}"
    pages = json.loads(d["pages"]) if isinstance(d["pages"], str) else d["pages"]
    return f"Board meeting {d['meeting']}, item {d['item']}, minute-book page {', '.join(map(str, pages))}"


def source_block(units):
    return "\n\n".join(f"[S{i}] {label(d)}\n{' '.join(d['text'].split()[:MAX_WORDS])}" for i, d in enumerate(units, 1))


ANSWER = """You answer questions about the Board minutes of DCM Shriram Ltd using ONLY the numbered sources given \
(extracts of the minutes and rows of the company's Synopsis of Minutes register).
Rules:
- Use only facts stated in the sources; no outside knowledge, no guessing.
- Copy amounts, dates, names and resolution numbers exactly as the source writes them.
- Cite the source after every fact as [S1], [S2] ...
- If the sources do not answer the question, set "found" to false and "answer" to "Not found in the minutes."
- For a question asking for a list, give every matching item found in the sources, one per line, each with its \
meeting date and citation.
- Be brief: one to three sentences, or the list.
Return JSON: {"found": true or false, "answer": "...", "citations": ["S1", ...]}"""


ANSWER_FIX = """You answer questions about the Board minutes of DCM Shriram Ltd using ONLY the numbered sources given \
(extracts of the minutes and rows of the company's Synopsis of Minutes register).
Rules:
- Use only facts stated in the sources; no outside knowledge, no guessing.
- Copy amounts, dates, names and resolution numbers exactly as the source writes them, including unusual spellings.
- Give EVERY decision, approval, amount and date in the sources that answers the question: one agenda item often \
records several approvals (e.g. a capex amount and a separate investment), and the same matter may have been decided \
at different meetings or updated later. Give each one, oldest first, with its meeting date.
- Cite the source after every fact as [S1], [S2] ...
- If the sources do not answer the question, set "found" to false and "answer" to "Not found in the minutes."
- For a question asking for a list, give every matching item found in the sources, one per line, each with its \
meeting date and citation.
- A different or merely related matter (a related topic, a different kind of approval, or a different company) does not answer the question: if you would have to say "not explicitly", "however" or "no specific", set "found" to false.
- Never add up or convert amounts yourself. When the question asks for a total, list each amount in the answer and \
also return them in "amounts"; the total is calculated for you.
- Be brief: one to four sentences, or the list.
Return JSON: {"found": true or false, "answer": "...", "citations": ["S1", ...],
              "amounts": [{"what": "...", "value": number, "unit": "crore" | "lakh" | "rupees"}]  (only for totals, else [])}"""

UNIT = {"crore": 1e7, "crores": 1e7, "cr": 1e7, "lakh": 1e5, "lakhs": 1e5, "rupees": 1, "rs": 1}


ASKS_TOTAL = re.compile(r"\b(total|totals|combined|in all|altogether|aggregate|sum of|add up)\b", re.I)


def add_total(text, amounts, question=""):
    """Sum the amounts the model extracted (it never does arithmetic itself); state the total in crores or lakhs."""
    try:
        vals = [float(a["value"]) * UNIT[str(a.get("unit", "")).lower().strip(". ")] for a in amounts]
    except (KeyError, TypeError, ValueError):
        return text
    if len(vals) < 2 or not ASKS_TOTAL.search(question):    # only when the question asks for a total
        return text
    tot = sum(vals)
    if any(abs(2 * v - tot) < 0.005 * tot for v in vals):   # one amount is the sum of the others: the source states the total
        return text
    shown = f"Rs. {tot / 1e7:,.2f} Crores".replace(".00 ", " ") if tot >= 1e7 else (f"Rs. {tot / 1e5:,.2f} Lakhs" if tot >= 1e5 else f"Rs. {tot:,.2f}").replace(".00 ", " ")
    return text.rstrip() + f"\n\nTotal (calculated from the {len(vals)} amounts above): {shown}."


def fix_names(text, cited):
    """Where the answer spells a name differently from the cited source (e.g. the question's spelling), use the
    source's: a capitalised word of 5+ letters missing from the sources but within one or two letters of a source word."""
    from rapidfuzz import fuzz, process
    src_words = set(re.findall(r"[A-Z][A-Za-z]{4,}", " ".join(d["text"] for d in cited)))
    if not src_words:
        return text
    low = {w.lower() for w in src_words}
    for w in set(re.findall(r"\b[A-Z][A-Za-z]{4,}\b", text)):
        if w.lower() in low:
            continue
        m = process.extractOne(w, src_words, scorer=fuzz.ratio, score_cutoff=88)
        if m and abs(len(m[0]) - len(w)) <= 2 and not (w.lower().startswith(m[0].lower()) or m[0].lower().startswith(w.lower())):
            text = re.sub(rf"\b{w}\b", m[0], text)
    return text


def answer(q, units):
    out = chat([{"role": "system", "content": ANSWER_FIX if FIX else ANSWER},
                {"role": "user", "content": f"Question: {q}\n\nSources:\n{source_block(units)}"}], 2500, luna=GEN == "luna")
    text = out.get("answer", "")
    nums = {int(n) for n in re.findall(r"\[?S(\d+)\]?", " ".join(out.get("citations") or []) + " " + text)}
    cited = [units[n - 1] for n in sorted(nums) if 0 < n <= len(units)]
    if FIX and cited:
        text = fix_names(add_total(text, out.get("amounts") or [], q), cited)
    return {"found": bool(out.get("found")) and bool(cited), "answer": text, "cited": cited}


# ---------- 4. scoring ----------

def gold_units(q):
    out = []
    for meeting, item in q["gold"]:
        out += [p for p in parents.values() if p["meeting"] == meeting and (p["item"] == item or p["item"].startswith(item + "."))]
        out += [s for s in synd.values() if s["date"] == meeting and norm_no(s["res_no"]) and
                (norm_no(s["res_no"]) == norm_no(item) or norm_no(s["res_no"]).startswith(norm_no(item)))]
    return out


def digits(s):
    return re.sub(r"(?<=\d),(?=\d)", "", s)


NUM = re.compile(r"\d[\d,]*(?:\.\d+)?")


def num_tokens(s):
    return {n.rstrip(".,") for n in NUM.findall(digits(s))}


def numbers_ok(text, cited):
    """Every number of 2+ characters in the answer must also occur as a number in the cited sources (labels
    included). Both sides are split the same way, so a dotted date like 1.4.21 matches itself."""
    src = num_tokens(" ".join(label(d) + " " + d["text"] for d in cited))
    src |= {p for t in list(src) for p in t.split(".")} | {t.lstrip("0") for t in src}     # 04.05.2021 -> 04, 05; 05 -> 5
    bad = [n for n in num_tokens(re.sub(r"\[?S\d+\]?", "", text)) if len(n) >= 2 and n not in src and n.lstrip("0") not in src]
    return not bad, bad


JUDGE = """You check an answer produced from company Board minutes.
Given the question, the answer, the REFERENCE text (the source that holds the right answer) and the CITED sources \
the answer relied on, return JSON:
- "verdict": "correct" if the answer gives the information the question asks for and agrees with the reference; \
"partial" if it is right but misses part of what was asked; "wrong" if it is wrong, contradicts the reference or \
says not found although the reference answers it.
- "unsupported": a list of statements in the answer (figures, dates, names, decisions) that the CITED sources do not \
support; [] if none.
- "reason": one short sentence."""


def judge(q, a, gold):
    ref = "\n\n".join(f"{label(d)}\n{' '.join(d['text'].split()[:MAX_WORDS])}" for d in gold[:4]) or "(none)"
    out = chat([{"role": "system", "content": JUDGE},
                {"role": "user", "content": f"Question: {q['q']}\n\nAnswer: {a['answer']}\n\nREFERENCE:\n{ref}\n\n"
                                            f"CITED sources:\n{source_block(a['cited']) or '(none)'}"}], 400)
    return {"verdict": out.get("verdict", "wrong"), "unsupported": out.get("unsupported") or [], "reason": out.get("reason", "")}


def score(q, u, units, a):
    gold, negative = q["gold"], q["type"] == "negative"
    hit = lambda d, g: is_hit(d, g[0], g[1], q, items, True) or (
        d.get("source") != "synopsis" and d["meeting"] == g[0] and (d["item"] == g[1] or d["item"].startswith(g[1] + ".")))
    ok, bad = numbers_ok(a["answer"], a["cited"]) if a["found"] else (True, [])
    row = {"q": q["q"], "set": q["set"], "type": q["type"], "query": u["query"], "filter": [u["years"], u["month"]],
           "answer": a["answer"], "found": a["found"], "cited": [label(d) for d in a["cited"]],
           "context": sum(any(hit(d, g) for d in units) for g in gold), "cited_gold": sum(any(hit(d, g) for d in a["cited"]) for g in gold),
           "of": len(gold), "numbers_ok": ok, "bad_numbers": bad,
           "retrieved_ids": [d["id"] for d in units], "cited_ids": [d["id"] for d in a["cited"]],
           "gold_ids": [d["id"] for d in gold_units(q)]}                      # for ragas_eval.py
    if negative:
        row.update(verdict="correct" if not a["found"] else "wrong", unsupported=[], reason="")
    elif q["type"] in ("list", "cross"):
        j = judge(q, a, gold_units(q)) if a["found"] else {"verdict": "wrong", "unsupported": [], "reason": "not found"}
        row.update(j, verdict=("correct" if row["cited_gold"] == len(gold) else "partial" if row["cited_gold"] else "wrong"))
    else:
        row.update(judge(q, a, gold_units(q)) if a["found"] else {"verdict": "wrong", "unsupported": [], "reason": "said not found"})
    return row


# ---------- run ----------

def run(backend, qs, und):
    if backend == "pg":
        import psycopg2
        from pgsearch import DSN
        conn = psycopg2.connect(DSN)
        cur = conn.cursor()
        cur.execute("SET hnsw.ef_search = 100")
        get = lambda q, u: retrieve_pg(cur, q, u)       # Postgres retrieval stays in this thread; the rerank call is cached
    else:
        get = retrieve_az
    t0 = time.time()
    ctx = []
    for q in qs:
        u = und[q["q"]]
        is_list = u["list"] if FIX else (u["list"] or q.get("kind") == "list")   # FIX: only the question step decides, as in production
        units = get(q["q"], u)[:TOP_LIST if is_list else TOP_SINGLE]
        ctx.append(units)
    t_ret = (time.time() - t0) / len(qs)
    with ThreadPoolExecutor(6) as ex:
        ans = list(ex.map(lambda x: answer(x[0]["q"], x[1]), zip(qs, ctx)))
        rows = list(ex.map(lambda x: score(x[0], und[x[0]["q"]], x[1], x[2]), zip(qs, ctx, ans)))
    save_cache()
    (HERE / "results" / f"answers_{backend}{SUFFIX}.json").write_text(json.dumps(rows, indent=1, ensure_ascii=False), encoding="utf-8")
    return rows, t_ret


def summary(rows):
    single = [r for r in rows if r["type"] not in ("negative", "list", "cross")]
    lists = [r for r in rows if r["type"] in ("list", "cross")]
    neg = [r for r in rows if r["type"] == "negative"]
    answered = [r for r in rows if r["found"]]
    v = Counter(r["verdict"] for r in single)
    return {"single": len(single), "correct": v["correct"], "partial": v["partial"], "wrong": v["wrong"],
            "context": sum(r["context"] > 0 for r in single), "cited": sum(r["cited_gold"] > 0 for r in single),
            "false_refusal": sum(not r["found"] for r in single + lists),
            "list_items": sum(r["cited_gold"] for r in lists), "list_of": sum(r["of"] for r in lists),
            "neg_ok": sum(not r["found"] for r in neg), "neg": len(neg),
            "numbers_ok": sum(r["numbers_ok"] for r in answered), "answered": len(answered),
            "faithful": sum(not r["unsupported"] for r in answered)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    backends = sys.argv[1:] or ["pg", "az"]
    if QSET:
        qs = [dict(q, set=QSET) for q in json.load(open(HERE / f"{QSET}_questions.json", encoding="utf-8"))]
    else:
        qs = [dict(q, set="main") for q in json.load(open(HERE / "questions.json", encoding="utf-8"))]
        qs += [dict(q, set="hard") for q in json.load(open(HERE / "hard_questions.json", encoding="utf-8"))]
    with ThreadPoolExecutor(6) as ex:
        und = dict(zip([q["q"] for q in qs], ex.map(understand, [q["q"] for q in qs])))
    save_cache()
    embed([u["query"] for u in und.values()])           # one batch, so the vector cache is written once
    res = {}
    for b in backends:
        res[b] = run(b, qs, und)
        print(f"done {b}", flush=True)
    names = {"pg": "Postgres + ids + gpt-4.1-mini rerank", "az": "Azure AI Search + semantic ranker"}
    L = [f"# Answer test: {'gpt-6-luna' if GEN == 'luna' else 'gpt-4.1-mini'} answers on both search backends", "",
         f"{len(qs)} questions (55 main + 20 hard). Question step (rewrite + filters) shared by both backends. "
         f"Top {TOP_SINGLE} sources per answer ({TOP_LIST} for list questions).", "",
         "| Backend | Single answers correct | Partial | Wrong | Right source given | Right source cited | "
         "List items cited | 'Not in minutes' refused | False 'not found' | Numbers in cited source | Judge: fully supported | Retrieval s/q |",
         "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    for b, (rows, t) in res.items():
        for part in ("all", "main", "hard"):
            s = summary([r for r in rows if part == "all" or r["set"] == part])
            L.append(f"| {names[b]} ({part}) | {s['correct']}/{s['single']} | {s['partial']} | {s['wrong']} | {s['context']}/{s['single']} | "
                     f"{s['cited']}/{s['single']} | {s['list_items']}/{s['list_of']} | {s['neg_ok']}/{s['neg']} | {s['false_refusal']} | "
                     f"{s['numbers_ok']}/{s['answered']} | {s['faithful']}/{s['answered']} | {t:.1f} |" if part == "all" else
                     f"| … {part} | {s['correct']}/{s['single']} | {s['partial']} | {s['wrong']} | {s['context']}/{s['single']} | "
                     f"{s['cited']}/{s['single']} | {s['list_items']}/{s['list_of']} | {s['neg_ok']}/{s['neg']} | {s['false_refusal']} | "
                     f"{s['numbers_ok']}/{s['answered']} | {s['faithful']}/{s['answered']} | |")
    for b, (rows, _) in res.items():
        L += ["", f"## {names[b]}: answers not judged correct, or with unsupported claims / numbers", ""]
        for r in rows:
            if r["verdict"] != "correct" or r["unsupported"] or not r["numbers_ok"]:
                L.append(f"- **{r['q']}** ({r['set']}, {r['type']}; {r['verdict']}) — {r['answer'][:300]!r}"
                         + (f" — unsupported: {r['unsupported']}" if r["unsupported"] else "")
                         + (f" — numbers not in source: {r['bad_numbers']}" if not r["numbers_ok"] else "")
                         + (f" — judge: {r['reason']}" if r["reason"] else ""))
    L += ["", f"gpt-4.1-mini tokens this run (cache misses only): {usage['prompt_tokens']} in, {usage['completion_tokens']} out"]
    if usage_luna:
        inr = ((usage_luna["prompt_tokens"] - usage_luna["cached"]) * 9.5989 + usage_luna["cached"] * 0.9599
               + usage_luna["completion_tokens"] * 47.9947) / 1e6           # Azure list prices, INR per 1M, gpt-6-luna Global
        L.append(f"gpt-6-luna answer tokens: {usage_luna['prompt_tokens']} in ({usage_luna['cached']} cached), "
                 f"{usage_luna['completion_tokens']} out ({usage_luna['reasoning']} reasoning) = Rs {inr:.2f}")
    (HERE / "results" / f"answers{SUFFIX}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:13]))
    print(L[-1])
