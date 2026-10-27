"""Consistency check: a draft agenda / draft resolution against past Board decisions and approved limits.

1. Read the draft (Word .docx, PDF, image, .txt, or pasted text). Scanned / image-only PDFs and images are read
   with Azure Document Intelligence, as the minutes are.
2. Extract every proposed decision (gpt-4.1-mini, JSON): what is proposed, category, amount and what it is per.
3. For each proposal, search the minutes and the Synopsis register for the decisions that govern it (newest first;
   a separate register search, as for lists) - same Azure AI Search index as the chatbot.
4. Compare (gpt-4.1-mini, JSON): which source sets the limit or rule currently in force, the limit as a number and
   unit, what it applies to, and whether a later decision replaced it. The model never decides "above / below" for
   numbers: if proposal and limit are both amounts on the same basis, the comparison is done in code.
5. Result per proposal: conflict | within_limit | needs_review | no_limit_found, with an explanation and citations.
Flags are for review by the Secretarial team, not a compliance opinion.
"""
import asyncio
import html
import io
import json
import re
import zipfile

import pipeline as P

MAX_PROPOSALS = 15
UNIT = {"crore": 1e7, "crores": 1e7, "cr": 1e7, "lakh": 1e5, "lakhs": 1e5, "rupees": 1, "rs": 1,
        "usd million": 1e6, "usd mn": 1e6, "usd": 1, "percent": 1, "%": 1}


IMAGES = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp")
MIN_CHARS_PER_PAGE = 100          # a PDF with less text than this per page is treated as scanned
DI_API = "2024-11-30"


async def ocr(data):
    """Text of a scanned / image-only PDF or an image: Azure Document Intelligence prebuilt-layout (Central India),
    the same reader used for the minutes. REST: submit, then poll the operation."""
    url = (f"{P.env['AZURE_DI_ENDPOINT'].rstrip('/')}/documentintelligence/documentModels/prebuilt-layout:analyze"
           f"?api-version={DI_API}&outputContentFormat=markdown")
    head = {"Ocp-Apim-Subscription-Key": P.env["AZURE_DI_KEY"]}
    r = await P.client.post(url, content=data, headers=head | {"Content-Type": "application/octet-stream"})
    r.raise_for_status()
    op = r.headers["Operation-Location"]
    for _ in range(120):
        await asyncio.sleep(1)
        res = (await P.client.get(op, headers=head)).json()
        if res.get("status") == "succeeded":
            return res["analyzeResult"]["content"]
        if res.get("status") == "failed":
            raise RuntimeError(f"OCR failed: {res.get('error')}")
    raise TimeoutError("OCR took too long")


async def read_draft(filename, data):
    """Plain text from a .docx, a PDF (text layer, or OCR when scanned / image-only), an image, or a text file.
    Returns (text, how): how is "text" or "ocr"."""
    name = (filename or "").lower()
    if name.endswith(".docx"):
        xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
        paras = re.findall(r"<w:p[ >].*?</w:p>", xml, re.S)
        return "\n".join(t for t in (html.unescape(re.sub(r"<[^>]+>", "", p)) for p in paras) if t.strip()), "text"
    if name.endswith(".pdf"):
        from pypdf import PdfReader
        pages = PdfReader(io.BytesIO(data)).pages
        text = "\n".join(page.extract_text() or "" for page in pages)
        if len(text.strip()) >= MIN_CHARS_PER_PAGE * max(len(pages), 1):
            return text, "text"
        return await ocr(data), "ocr"
    if name.endswith(IMAGES):
        return await ocr(data), "ocr"
    return data.decode("utf-8", errors="ignore"), "text"


EXTRACT = """You read a draft agenda or draft resolution for a Board meeting of DCM Shriram Ltd and list every \
decision it proposes (approvals, limits, investments, borrowings, appointments, remuneration, contributions, \
dividends, authorisations, delegations). Return JSON {"proposals": [...]} where each proposal has:
- "text": the proposed decision in one sentence, using the draft's own figures and names;
- "category": one of borrowing | investment | surplus_funds | loan_guarantee | derivatives | dividend | remuneration | \
appointment | political_contribution | csr | delegation | capex | other;
- "subject": a short search phrase for the matter (e.g. "fixed deposit with a single bank", "political contribution");
- "amount": {"value": number, "unit": "crore" | "lakh" | "rupees" | "usd million" | "percent"} or null;
- "basis": what the amount is per - "per bank", "per dealer", "per financial year", "aggregate", "per share", \
"one-time" - or null;
- "sets_limit": true ONLY when the draft explicitly changes an existing limit or ceiling (words such as increase, \
enhance, revise, raise, reduce or modify the limit / ceiling / cap); false for an approval of a transaction, even when \
it says "up to Rs. X".
Only list decisions actually proposed in the draft, at most 15. If there are none, return {"proposals": []}."""

COMPARE = """You check one proposed Board decision of DCM Shriram Ltd against the numbered sources: extracts of past \
Board minutes and rows of the company's Synopsis of Minutes register. Find the past decision(s) that GOVERN the \
proposal: an approved limit, ceiling or authority for the same kind of transaction, or an earlier decision on the \
same matter that the proposal would contradict or repeat. Where a later resolution modified or superseded an earlier \
one, the latest one is in force. \
A past amount (an earlier dividend, an earlier approval of a specific sum) is precedent, not a limit: only an explicit \
ceiling, maximum, "not exceeding" or standing authority "up to" an amount counts as a limit. When several limits \
apply (e.g. per transaction and per dealer), use the one on the same basis as the proposal. If the proposal reverses \
something the sources record as ended or completed (e.g. a term completed), assess it as "unclear" so a person \
reviews it. Use only the sources; no outside knowledge. Return JSON:
{"governing": ["S1", ...] (the sources in force, latest first; [] if none),
 "dates": {"S1": "YYYY-MM-DD", ...} (the meeting date of each governing source, copied from its header),
 "superseded": ["S3", ...] (earlier sources on the same matter that were replaced),
 "limit": {"value": number, "unit": "crore" | "lakh" | "rupees" | "usd million" | "percent", "basis": "per bank" | \
"per dealer" | "per financial year" | "aggregate" | "per share" | ...} or null (only if a source states a numeric limit \
that applies to this proposal),
 "compare_directly": true when the proposed amount should be compared directly with that limit (same kind of \
transaction, same basis, e.g. a deposit with one bank against a per-bank limit), else false,
 "assessment": "limit_applies" (a numeric limit applies), "contradiction" (a past decision conflicts in substance, \
e.g. the same person's term already ended, a policy forbids it), "consistent" (a past decision governs it and nothing conflicts), "no_conflict" (only general precedent, e.g. \
earlier dividends, and no limit or rule restricts it), \
"unclear" (related decisions exist but it is not clear whether they apply), or "none" (nothing in the sources governs it),
 "explanation": one or two sentences citing the sources as [S1], quoting the limit exactly as the source writes it}"""


LIMIT_WORDS = re.compile(r"\b(limits?|maximum|not exceeding|up to|upto|ceiling|cap|aggregate|per (bank|dealer|nbfc|amc|annum|financial year))\b", re.I)


def excerpt(text, words=700):
    """A long agenda item cut to about `words`, by clause ("RESOLVED FURTHER THAT ..."): the opening and the clauses
    that state a limit first, then the other clauses in order while they fit; printed in document order. A limit is
    often in a late clause and would be lost by keeping only the first words."""
    w = text.split()
    if len(w) <= words:
        return " ".join(w)
    clauses = [c.split() for c in re.split(r"(?=RESOLVED)", " ".join(w))]
    order = [0] + [i for i in range(1, len(clauses)) if LIMIT_WORDS.search(" ".join(clauses[i]))]
    order += [i for i in range(1, len(clauses)) if i not in order]
    keep, n = set(), 0
    for i in order:
        if n + len(clauses[i]) <= words:
            keep.add(i); n += len(clauses[i])
    out, gap = [], False
    for i, c in enumerate(clauses):
        if i in keep:
            out.append((" … " if gap and out else "") + " ".join(c)); gap = False
        else:
            gap = True
    return " ".join(out)


CHANGES_LIMIT = re.compile(r"\b(increase|enhanc|revis|rais|reduc|modif|amend)\w*\b.*\b(limit|ceiling|cap|maximum|aggregate|overall)", re.I)


def to_base(v, unit):
    try:
        return float(v) * UNIT[str(unit).lower().strip(". ")]
    except (KeyError, TypeError, ValueError):
        return None


def same_basis(a, b):
    a, b = (a or "").lower(), (b or "").lower()
    if not a or not b:
        return False
    keys = ("bank", "dealer", "financial year", "aggregate", "share", "nbfc", "amc")
    return any(k in a and k in b for k in keys) or a == b


async def extract(text):
    out = await P.chat([{"role": "system", "content": EXTRACT},
                        {"role": "user", "content": f"Draft:\n{text[:12000]}"}], 2500)
    return [p for p in out.get("proposals") or [] if p.get("text")][:MAX_PROPOSALS]


async def check_one(n, prop):
    u = {"standalone": prop["text"], "query": f"{prop.get('subject', '')} {prop.get('category', '')} limit approved "
                                              f"authorised {prop['text']}",
         "years": [], "month": None, "list": True, "about_previous": False, "conversation": False, "recency": "latest"}
    docs = (await P.retrieve(u, {}, []))[:12]
    src = "\n\n".join(f"[S{i}] {P.label(d)}\n{excerpt(d['text'])}" for i, d in enumerate(docs, 1))
    out = await P.chat([{"role": "system", "content": COMPARE},
                        {"role": "user", "content": f"Proposed decision: {prop['text']}\n"
                                                    f"Amount: {json.dumps(prop.get('amount'))}, basis: {prop.get('basis')}\n\n"
                                                    f"Sources:\n{src}"}], 900)
    pick = lambda key: [docs[int(s) - 1] for s in re.findall(r"\d+", " ".join(out.get(key) or [])) if 0 < int(s) <= len(docs)]
    governing, superseded = pick("governing"), pick("superseded")
    assess, explanation = out.get("assessment", "none"), out.get("explanation", "")
    status, comparison = {"contradiction": "conflict", "consistent": "within_limit", "unclear": "needs_review",
                          "no_conflict": "no_conflict"}.get(assess, "no_limit_found"), None
    lim, amt = out.get("limit") or None, prop.get("amount") or None
    a = to_base(amt.get("value"), amt.get("unit")) if amt else None
    l = to_base(lim.get("value"), lim.get("unit")) if lim else None
    shown = lambda x, b: f"{x.get('value')} {x.get('unit')}{' ' + b if b else ''}"
    if lim and assess in ("limit_applies", "contradiction", "consistent"):
        status = "needs_review"                       # the numbers decide below; the model never does
        if a is not None and l is not None and prop.get("sets_limit") and CHANGES_LIMIT.search(prop["text"]):
            status = "changes_limit"
            comparison = (f"Proposes {shown(amt, prop.get('basis'))}; the current limit is {shown(lim, lim.get('basis'))}"
                          f" ({'an increase' if a > l else 'a reduction' if a < l else 'no change'}, calculated).")
        elif a is not None and l is not None and (out.get("compare_directly") or same_basis(lim.get("basis"), prop.get("basis"))):
            status = "conflict" if a > l else "within_limit"
            comparison = (f"Proposed {shown(amt, prop.get('basis'))} vs limit {shown(lim, lim.get('basis'))}: "
                          + ("exceeds the limit (calculated)." if a > l else "within the limit (calculated)."))
    if status != "no_limit_found" and not governing:
        status = "needs_review"
    # renumber the model's [S#] (position among all retrieved sources) to the order of the governing sources shown
    pos = {docs.index(d) + 1: i for i, d in enumerate(governing + [d for d in superseded if d not in governing], 1)}
    explanation = re.sub(r"\[([S\d,\s]+)\]", lambda m: "[" + ", ".join(
        str(pos[int(n)]) for n in re.findall(r"\d+", m.group(1)) if int(n) in pos) + "]", explanation).replace("[]", "")
    explanation = re.sub(r"\bS(\d+)\b", lambda m: f"[{pos[int(m.group(1))]}]" if int(m.group(1)) in pos else "an earlier source",
                         explanation)
    # dates the model writes must be dates of the sources it was given (catches misread years)
    known = {x for d in docs for x in re.findall(r"\d{4}-\d{2}-\d{2}", P.label(d))}
    if any(x not in known for x in re.findall(r"\b(?:19|20)\d{2}-\d{2}-\d{2}\b", explanation)):
        explanation += " (Check the dates against the cited pages.)"
    superseded = [d for d in superseded if d not in governing]
    return {"id": f"item_{n}", "proposal": prop["text"], "category": prop.get("category"), "amount": amt,
            "basis": prop.get("basis"), "status": status, "finding": explanation, "comparison": comparison,
            "limit": lim, "governing": [P.source_json(d, i) for i, d in enumerate(governing, 1)],
            "superseded": [P.source_json(d, i) for i, d in enumerate(superseded, len(governing) + 1)],
            "_labels": [P.label(d) for d in governing]}


async def run(text):
    """Yields ("meta", {...}), then ("item", {...}) per proposal as each is checked, then ("done", {...})."""
    props = await extract(text)
    yield "meta", {"items_found": len(props), "proposals": [p["text"] for p in props]}
    tasks = [asyncio.create_task(check_one(n, p)) for n, p in enumerate(props, 1)]
    counts = {"conflict": 0, "changes_limit": 0, "needs_review": 0, "within_limit": 0, "no_conflict": 0,
              "no_limit_found": 0}
    for t in asyncio.as_completed(tasks):
        item = await t
        counts[item["status"]] += 1
        yield "item", item
    yield "done", {"summary": counts}
