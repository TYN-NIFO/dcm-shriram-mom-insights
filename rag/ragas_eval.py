"""Ragas evaluation of the answer test (answer.py output), with gpt-6-luna as the judge.

Judge: gpt-6-luna on the testingresource Foundry account (Global deployment, NOT India-processed). The user
approved sending minutes text to it on 26 Oct 2026 for this evaluation only. Embeddings for answer relevancy:
text-embedding-3-large, Standard, South India.

Per backend (pg, az), on the 71 questions that have an answer in the minutes:
  ID context precision  share of the sources given to the model that are gold items (no LLM)
  ID context recall     share of gold items that reached the model (no LLM)
  context recall        Ragas: share of the reference answer's claims supported by the retrieved sources
  faithfulness          Ragas: share of the answer's claims supported by the retrieved sources
  answer relevancy      Ragas: does the answer address the question
  factual correctness   Ragas F1 of the answer's claims against the reference answer
Reference answers are written once by gpt-6-luna from the gold source text only and saved to
reference_answers.json for review. The 4 'not in the minutes' questions are scored on refusal only.
Run with the .venv-ragas interpreter:  ..\\.venv-ragas\\Scripts\\python ragas_eval.py
Writes results/ragas.md and results/ragas_<backend>.json.
"""
import asyncio
import json
import os
import sys
from collections import Counter
from pathlib import Path
from statistics import mean

import httpx
from dotenv import dotenv_values
from openai import AsyncAzureOpenAI, AsyncOpenAI
from ragas.cache import DiskCacheBackend
from ragas.embeddings import OpenAIEmbeddings
from ragas.llms import llm_factory
from ragas.metrics.collections import AnswerRelevancy, ContextRecall, FactualCorrectness, Faithfulness

HERE = Path(__file__).resolve().parent
env = dotenv_values(HERE.parent / ".env")
# JUDGE_MODEL=mini: judge with gpt-4.1-mini (Standard, South India) instead; ANSWERS=_luna reads answers_<b>_luna.json
JUDGE_MODEL = os.environ.get("JUDGE_MODEL", "luna")
ANSWERS = os.environ.get("ANSWERS", "")
TAG = f"{ANSWERS}_judge-{JUDGE_MODEL}" if (ANSWERS or JUDGE_MODEL != "luna") else ""
JUDGE = "gpt-6-luna"
MAX_WORDS = 1200
REFS = HERE / "reference_answers.json"

# Cost metering: every API response's token usage is added up (Ragas cache hits make no call and cost nothing).
# Azure retail list prices, INR per 1M tokens, fetched 26 Oct 2026 from prices.azure.com.
PRICE = ({"judge_in": 9.5989, "judge_cached": 0.9599, "judge_out": 47.9947}     # gpt-6-luna Global Standard, short context
         if JUDGE_MODEL == "luna" else
         {"judge_in": 42.2, "judge_cached": 10.6, "judge_out": 168.9})         # gpt-4.1-mini regional Standard
PRICE["emb"] = 12.0                                                            # text-embedding-3-large regional (approx.)                                                          # text-embedding-3-large regional (approx.)
usage = Counter()


def meter(kind):
    async def hook(resp):
        await resp.aread()
        try:
            u = resp.json().get("usage") or {}
        except Exception:
            return
        if kind == "judge":
            cached = (u.get("prompt_tokens_details") or {}).get("cached_tokens", 0)
            usage.update(judge_calls=1, judge_in=u.get("prompt_tokens", 0) - cached, judge_cached=cached,
                         judge_out=u.get("completion_tokens", 0),
                         judge_reasoning=(u.get("completion_tokens_details") or {}).get("reasoning_tokens", 0))
        else:
            usage.update(emb=u.get("total_tokens", 0))
    return hook


judge_client = AsyncOpenAI(base_url=env["JUDGE_ENDPOINT"], api_key=env["JUDGE_KEY"], max_retries=8, timeout=300,
                           http_client=httpx.AsyncClient(timeout=300, event_hooks={"response": [meter("judge")]}))
emb_client = AsyncAzureOpenAI(azure_endpoint=env["AZURE_OPENAI_ENDPOINT"], api_key=env["AZURE_OPENAI_KEY"], api_version="2024-10-21",
                              http_client=httpx.AsyncClient(timeout=120, event_hooks={"response": [meter("emb")]}))


def cost():
    c = {k: usage[k] * PRICE[k] / 1e6 for k in PRICE}
    return c, sum(c.values())
cache = DiskCacheBackend(str(HERE / "data" / f"ragas_cache{'' if JUDGE_MODEL == 'luna' else '_' + JUDGE_MODEL}"))
if JUDGE_MODEL == "luna":
    llm = llm_factory(JUDGE, client=judge_client, cache=cache, temperature=1.0, max_tokens=16000)
else:
    mini_client = AsyncAzureOpenAI(azure_endpoint=env["AZURE_OPENAI_ENDPOINT"], api_key=env["AZURE_OPENAI_KEY"], api_version="2024-10-21",
                                   max_retries=8, http_client=httpx.AsyncClient(timeout=300, event_hooks={"response": [meter("judge")]}))
    llm = llm_factory(env["AZURE_OPENAI_CHAT_DEPLOYMENT"], client=mini_client, cache=cache, temperature=0.0, max_tokens=4000)
emb = OpenAIEmbeddings(client=emb_client, model=env["AZURE_OPENAI_EMBED_DEPLOYMENT"])
sem = asyncio.Semaphore(8)


def load(name):
    return [json.loads(l) for l in open(HERE / "data" / name, encoding="utf-8")]


units = {p["id"]: p for p in load("d_parents.jsonl")} | {s["id"]: s for s in load("synopsis_chunks.jsonl")}
text = lambda i: " ".join(units[i]["text"].split()[:MAX_WORDS])


REF_PROMPT = """Write the reference answer to the question below, using ONLY the source text given (extracts of DCM \
Shriram Ltd Board minutes and rows of its Synopsis of Minutes register). Copy amounts, dates, names and resolution \
numbers exactly as written. For a question asking for a list, give every matching item in the sources with its \
meeting date. One to four sentences, or the list. No preamble."""


async def reference(q, gold_ids):
    async with sem:
        src = "\n\n".join(text(i) for i in gold_ids[:8])
        r = await judge_client.chat.completions.create(model=JUDGE, messages=[
            {"role": "system", "content": REF_PROMPT}, {"role": "user", "content": f"Question: {q}\n\nSources:\n{src}"}])
        return r.choices[0].message.content.strip()


class ReferenceRecall:
    """Share of the reference answer's facts that the answer states (Ragas claim split + NLI, reference -> answer).
    Ragas's own recall mode also counts answer claims missing from the short reference, so it punishes detail."""
    name = "factual_recall"

    def __init__(self, llm):
        self.fc = FactualCorrectness(llm=llm, mode="recall", atomicity="high", coverage="high")

    async def ascore(self, response, reference):
        v = await self.fc._decompose_and_verify_claims(reference, response)
        return type("R", (), {"value": float(v.mean()) if len(v) else None})


async def safe(metric, **kw):
    async with sem:
        try:
            return (await metric.ascore(**kw)).value
        except Exception as e:                                  # one failed judgement must not stop the run
            print(f"  {metric.name} failed: {str(e)[:160]}", flush=True)
            return None


FC_ONLY = os.environ.get("FC_ONLY") == "1"      # recompute only the factual metrics, keep the rest from the last run


async def evaluate(rows, refs, prev=None):
    # the reference answers are short and don't restate the question, so a strict judge can't confirm
    # "X chairs the Audit Committee as of May 2024" from "X as Chairperson": give it the question too
    ref_ctx = lambda r: f"Question: {r['q']}\nReference answer: {refs[r['q']]}"
    faith, rel, fc, cr = Faithfulness(llm=llm), AnswerRelevancy(llm=llm, embeddings=emb), FactualCorrectness(llm=llm, atomicity="high", coverage="high"), ContextRecall(llm=llm)
    # default atomicity="low" makes the whole answer one claim, so one extra detail scores 0; "high" splits it into facts
    fcr = ReferenceRecall(llm)
    out = []

    async def one(r):
        ctx = [text(i) for i in r["retrieved_ids"]]
        gold = set(r["gold_ids"])
        s = {"q": r["q"], "set": r["set"], "type": r["type"],
             "id_precision": sum(i in gold for i in r["retrieved_ids"]) / max(len(r["retrieved_ids"]), 1),
             "id_recall": r["context"] / r["of"]}
        if FC_ONLY and prev and r["q"] in prev:
            s.update({k: v for k, v in prev[r["q"]].items() if k not in ("factual_correctness", "factual_recall")})
            if r["found"]:
                s["factual_correctness"], s["factual_recall"] = await asyncio.gather(
                    safe(fc, response=r["answer"], reference=ref_ctx(r)), safe(fcr, response=r["answer"], reference=refs[r["q"]]))
            else:
                s.update(factual_correctness=0.0, factual_recall=0.0)
        elif r["found"]:
            s["faithfulness"], s["answer_relevancy"], s["factual_correctness"], s["factual_recall"], s["context_recall"] = await asyncio.gather(
                safe(faith, user_input=r["q"], response=r["answer"], retrieved_contexts=ctx),
                safe(rel, user_input=r["q"], response=r["answer"]),
                safe(fc, response=r["answer"], reference=ref_ctx(r)),
                safe(fcr, response=r["answer"], reference=refs[r["q"]]),
                safe(cr, user_input=r["q"], retrieved_contexts=ctx, reference=refs[r["q"]]))
        else:
            s.update(faithfulness=None, answer_relevancy=0.0, factual_correctness=0.0, factual_recall=0.0,
                     context_recall=await safe(cr, user_input=r["q"], retrieved_contexts=ctx, reference=refs[r["q"]]))
        out.append(s)
        if len(out) % 10 == 0:
            print(f"  {len(out)}/{len(rows)}  cost so far Rs {cost()[1]:.2f}", flush=True)

    await asyncio.gather(*(one(r) for r in rows))
    return sorted(out, key=lambda s: [r["q"] for r in rows].index(s["q"]))


METRICS = ["id_precision", "id_recall", "context_recall", "faithfulness", "answer_relevancy", "factual_correctness", "factual_recall"]


def avg(rows, m):
    v = [r[m] for r in rows if r.get(m) is not None]
    return f"{mean(v):.2f}" if v else "–"


async def main():
    backends = sys.argv[1:] or ["pg", "az"]
    data = {b: json.loads((HERE / "results" / f"answers_{b}{ANSWERS}.json").read_text(encoding="utf-8")) for b in backends}
    scored = [r for r in data[backends[0]] if r["type"] != "negative"]
    refs = json.loads(REFS.read_text(encoding="utf-8")) if REFS.exists() else {}
    todo = [r for r in scored if r["q"] not in refs]
    if todo:
        print(f"writing {len(todo)} reference answers", flush=True)
        for r, ans in zip(todo, await asyncio.gather(*(reference(r["q"], r["gold_ids"]) for r in todo))):
            refs[r["q"]] = ans
        REFS.write_text(json.dumps(refs, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"reference answers done; cost so far Rs {cost()[1]:.2f}", flush=True)
    names = {"pg": "Postgres + ids + gpt-4.1-mini rerank", "az": "Azure AI Search + semantic ranker"}
    who = lambda m: "gpt-6-luna" if m == "luna" else "gpt-4.1-mini"
    L = [f"# Ragas evaluation (judge: {who(JUDGE_MODEL)}; answers: {who(ANSWERS.strip('_') or 'mini')})", "",
         f"{len(scored)} questions with an answer in the minutes (main + hard). Scores are 0-1 averages. "
         "ID precision/recall need no LLM; the rest are judged by the judge model against the retrieved sources "
         "and reference answers in reference_answers.json.", "",
         "| Backend | Set | ID context precision | ID context recall | Context recall (Ragas) | Faithfulness | Answer relevancy | Factual correctness (F1) | Factual recall |",
         "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
    res = {}
    for b in backends:
        print(f"evaluating {b}", flush=True)
        pf = HERE / "results" / f"ragas_{b}{TAG}.json"
        prev = {x["q"]: x for x in json.loads(pf.read_text(encoding="utf-8"))} if pf.exists() else None
        res[b] = await evaluate([r for r in data[b] if r["type"] != "negative"], refs, prev)
        (HERE / "results" / f"ragas_{b}{TAG}.json").write_text(json.dumps(res[b], indent=1, ensure_ascii=False), encoding="utf-8")
        for part in ("all", "main", "hard"):
            rows = [r for r in res[b] if part == "all" or r["set"] == part]
            L.append(f"| {names[b] if part == 'all' else ''} | {part} | " + " | ".join(avg(rows, m) for m in METRICS) + " |")
    L += ["", "## Lowest faithfulness / factual correctness", ""]
    for b in backends:
        for r in res[b]:
            low = [m for m in ("faithfulness", "factual_correctness") if r.get(m) is not None and r[m] < 0.5]
            if low:
                L.append(f"- {b}: {r['q']} — " + ", ".join(f"{m} {r[m]:.2f}" for m in low))
    c, total = cost()
    L += ["", "## Cost of this run (metered from API responses; Ragas cache hits cost nothing)", "",
          "| Item | Tokens | INR |", "| --- | --- | --- |",
          f"| {who(JUDGE_MODEL)} input ({usage['judge_calls']} calls) | {usage['judge_in']:,} | {c['judge_in']:.2f} |",
          f"| {who(JUDGE_MODEL)} cached input | {usage['judge_cached']:,} | {c['judge_cached']:.2f} |",
          f"| {who(JUDGE_MODEL)} output (incl. {usage['judge_reasoning']:,} reasoning) | {usage['judge_out']:,} | {c['judge_out']:.2f} |",
          f"| text-embedding-3-large | {usage['emb']:,} | {c['emb']:.2f} |", f"| **Total** | | **{total:.2f}** |"]
    (HERE / "results" / f"ragas_cost{TAG}.json").write_text(json.dumps({"usage": usage, "inr": c, "total_inr": total}, indent=1), encoding="utf-8")
    (HERE / "results" / f"ragas{TAG}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(main())
