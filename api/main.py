"""DCM MoM Insights PoC backend: FastAPI, implementing web/API.md.

No login yet (one demo user); conversations are kept in memory and dropped after 7 days; every answer is
written to logs/audit.jsonl (user, time, question, rewritten question, filters, cited sources). Page images are
the 200 dpi renders in ocr_eval/pages, looked up by minute-book page number.
Run:  ..\\.venv-api\\Scripts\\python -m uvicorn main:app --host 127.0.0.1 --port 8000   (from 04_PoC/api)
"""
import asyncio
import json
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel

import httpx

import check as C
import pipeline as P

HERE = Path(__file__).resolve().parent
PAGES = P.ROOT / "ocr_eval" / "pages"
AUDIT = HERE / "logs" / "audit.jsonl"
AUDIT.parent.mkdir(exist_ok=True)
RETENTION = timedelta(days=7)
USER = {"name": "Demo User", "email": "demo.user@example.com", "scopes": [{"company": P.COMPANY, "body": P.BODY}]}

app = FastAPI(title="DCM MoM Insights PoC API")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])

conversations: dict[str, dict] = {}       # id -> {id, title, updated_at, messages: [...]}


def now():
    return datetime.now(timezone.utc)


def iso(t):
    return t.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def prune():
    cut = now() - RETENTION
    for cid in [c for c, v in conversations.items() if v["updated_at"] < cut]:
        del conversations[cid]


class Filters(BaseModel):
    company: str | None = None
    body: str | None = None
    date_from: str | None = None
    date_to: str | None = None


class ChatIn(BaseModel):
    conversation_id: str | None = None
    question: str
    filters: Filters | None = None


@app.get("/me")
def me():
    return USER


def sse(event, data):
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@app.post("/chat")
async def chat(body: ChatIn, request: Request):
    prune()
    q = body.question.strip()
    if not q:
        raise HTTPException(400, "Empty question")
    if body.conversation_id:
        conv = conversations.get(body.conversation_id)
        if not conv:
            raise HTTPException(404, "Conversation not found")
    else:
        cid = "conv_" + uuid.uuid4().hex[:12]
        conv = conversations[cid] = {"id": cid, "title": q[:80], "updated_at": now(), "messages": []}
    filters = (body.filters or Filters()).model_dump(exclude_none=True)
    history = [{"q": m["question"], "a": m["content"]} for m in conv["messages"] if m["role"] == "assistant"]
    previous_ids = next((m["source_ids"] for m in reversed(conv["messages"]) if m["role"] == "assistant"), [])
    msg_id = "msg_" + uuid.uuid4().hex[:12]

    async def stream():
        t0 = time.time()
        yield sse("meta", {"conversation_id": conv["id"], "message_id": msg_id})
        conv["messages"].append({"id": "msg_" + uuid.uuid4().hex[:12], "role": "user", "content": q, "created_at": iso(now())})
        u = {"standalone": q, "query": q, "years": [], "conversation": True}
        steps_t = {}
        try:
            u = await P.understand(q, history)
            steps_t = {"question_step": round(time.time() - t0, 2)}
            if u["conversation"]:                    # greeting, off-topic, gibberish ...: no search
                steps = P.converse_stream(q, history)
            else:
                docs = await P.retrieve(u, filters, previous_ids)
                steps_t["search"] = round(time.time() - t0 - steps_t["question_step"], 2)
                steps = P.answer_stream(u, docs, history)
            a = None
            async for kind, val in steps:
                if kind == "token":
                    if await request.is_disconnected():
                        return
                    yield sse("token", {"text": val})
                else:
                    a = val
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 400 and "content_filter" in e.response.text:
                # Azure's own safety filter blocked the message before the model saw it (e.g. a jailbreak attempt)
                a = {"found": False, "answer": "I can't help with that request. I can answer questions about DCM "
                                               "Shriram's Board minutes.", "cited": []}
                yield sse("token", {"text": a["answer"]})
            else:
                yield sse("error", {"message": "The answer service failed. Please try again."})
                print("chat error:", e.response.status_code, e.response.text[:300])
                return
        except Exception as e:                       # never leak keys or stack traces to the browser
            yield sse("error", {"message": "The answer service failed. Please try again."})
            print("chat error:", type(e).__name__, str(e)[:300])
            return
        text = a["answer"]
        sources = [P.source_json(d, n) for n, d in enumerate(a["cited"], 1)]
        yield sse("sources", sources)
        yield sse("done", {"found": a["found"]})
        conv["messages"].append({"id": msg_id, "role": "assistant", "content": text, "sources": sources, "found": a["found"],
                                 "created_at": iso(now()), "question": u["standalone"], "source_ids": [d["id"] for d in a["cited"]]})
        conv["updated_at"] = now()
        with AUDIT.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"time": iso(now()), "user": USER["email"], "conversation_id": conv["id"], "question": q,
                                "standalone": u["standalone"], "search_query": u["query"], "filters": filters,
                                "years": u.get("years"), "route": "conversation" if u.get("conversation") else "minutes", "recency": u.get("recency"), "found": a["found"], "cited": [P.label(d) for d in a["cited"]],
                                "seconds": round(time.time() - t0, 2), "steps": steps_t}, ensure_ascii=False) + "\n")

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


def public(m):
    return {k: v for k, v in m.items() if k not in ("question", "source_ids")}


MAX_UPLOAD = 10 * 1024 * 1024


@app.post("/check")
async def check_draft(request: Request, file: UploadFile | None = File(None), text: str | None = Form(None)):
    """Check a draft agenda / resolution (upload .docx, PDF - scanned ones are OCR'd -, image or .txt, or pasted text)
    against past decisions."""
    draft, name, how = (text or "").strip(), "pasted text", "text"
    if file is not None and file.filename:
        if not file.filename.lower().endswith((".docx", ".pdf", ".txt") + C.IMAGES):
            raise HTTPException(400, "Upload a Word (.docx), PDF, image (PNG, JPG, TIFF) or text file")
        data = await file.read()
        if len(data) > MAX_UPLOAD:
            raise HTTPException(400, "File is larger than 10 MB")
        try:
            (draft, how), name = await C.read_draft(file.filename, data), file.filename
        except Exception as e:
            print("read error:", type(e).__name__, str(e)[:300])
            raise HTTPException(400, "Could not read the file")
    if len(draft) < 20:
        raise HTTPException(400, "No readable text was found in the draft")
    check_id = "chk_" + uuid.uuid4().hex[:12]

    async def stream():
        t0, items = time.time(), []
        try:
            async for kind, val in C.run(draft):
                if await request.is_disconnected():
                    return
                if kind == "meta":
                    val = {"check_id": check_id, "document": name, "read_with": how, **val}
                if kind == "item":
                    items.append(val)
                    val = {k: v for k, v in val.items() if not k.startswith("_")}
                yield sse(kind, val)
        except httpx.HTTPStatusError as e:
            msg = ("The draft was blocked by the AI service's content filter." if e.response.status_code == 400
                   and "content_filter" in e.response.text else "The check failed. Please try again.")
            print("check error:", e.response.status_code, e.response.text[:300])
            yield sse("error", {"message": msg})
            return
        except Exception as e:
            print("check error:", type(e).__name__, str(e)[:300])
            yield sse("error", {"message": "The check failed. Please try again."})
            return
        with AUDIT.open("a", encoding="utf-8") as f:
            f.write(json.dumps({"time": iso(now()), "user": USER["email"], "type": "draft_check", "check_id": check_id,
                                "document": name, "read_with": how, "draft_chars": len(draft),
                                "items": [{"proposal": i["proposal"], "status": i["status"], "governing": i["_labels"]}
                                          for i in items], "seconds": round(time.time() - t0, 2)}, ensure_ascii=False) + "\n")

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})


@app.get("/conversations")
def list_conversations():
    prune()
    return [{"id": c["id"], "title": c["title"], "updated_at": iso(c["updated_at"])}
            for c in sorted(conversations.values(), key=lambda c: c["updated_at"], reverse=True)]


@app.get("/conversations/{cid}")
def get_conversation(cid: str):
    prune()
    c = conversations.get(cid)
    if not c:
        raise HTTPException(404, "Conversation not found")
    return {"id": c["id"], "title": c["title"], "messages": [public(m) for m in c["messages"]]}


@app.delete("/conversations/{cid}", status_code=204)
def delete_conversation(cid: str):
    if conversations.pop(cid, None) is None:
        raise HTTPException(404, "Conversation not found")
    return Response(status_code=204)


@app.get("/pages/{page}.png")
def page_image(page: int):
    m = P.page_map.get(str(page))
    if not m:
        raise HTTPException(404, "Page not found")
    f = PAGES / m["meeting"] / f"p{m['pdf_page']:03d}.png"
    if not f.exists():
        raise HTTPException(404, "Page image missing")
    return FileResponse(f, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})
