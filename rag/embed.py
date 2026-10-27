"""A11 embedding: text-embedding-3-large (Azure OpenAI, Standard deployment, South India) via the REST API.

Embeds every chunk of both versions, the Synopsis rows and the test questions; caches vectors in
data/embeddings.json keyed by a hash of the text, so nothing is sent twice.
"""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import dotenv_values

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
CACHE = DATA / "embeddings.json"
env = dotenv_values(HERE.parent / ".env")
URL = (f"{env['AZURE_OPENAI_ENDPOINT'].rstrip('/')}/openai/deployments/{env['AZURE_OPENAI_EMBED_DEPLOYMENT']}"
       f"/embeddings?api-version=2024-10-21")
BATCH = 32


def key(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:24]


def _call(texts: list[str]) -> tuple[list[list[float]], int]:
    body = json.dumps({"input": texts}).encode()
    for attempt in range(6):
        req = urllib.request.Request(URL, data=body, headers={"Content-Type": "application/json", "api-key": env["AZURE_OPENAI_KEY"]})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.load(r)
            return [d["embedding"] for d in sorted(data["data"], key=lambda d: d["index"])], data["usage"]["total_tokens"]
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < 5:
                time.sleep(int(e.headers.get("retry-after", 10)))
                continue
            raise
    raise RuntimeError("embedding failed")


_MEM: dict = {}


def embed(texts: list[str]) -> dict[str, list[float]]:
    if not _MEM and CACHE.exists():                  # load the on-disk cache once per run
        _MEM.update(json.loads(CACHE.read_text(encoding="utf-8")))
    cache = _MEM
    todo = list({key(t): t for t in texts if key(t) not in cache}.items())
    tokens = 0
    for i in range(0, len(todo), BATCH):
        part = todo[i:i + BATCH]
        vecs, n = _call([t[:30000] for _, t in part])
        tokens += n
        cache.update({k: v for (k, _), v in zip(part, vecs)})
        print(f"  embedded {min(i + BATCH, len(todo))}/{len(todo)}", flush=True)
    if todo:
        CACHE.write_text(json.dumps(cache), encoding="utf-8")
    if todo:
        print(f"{len(todo)} new texts, {tokens} tokens")
    return {k: cache[k] for k in (key(t) for t in texts)}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    texts = [json.loads(l)["text"] for f in ("v1_chunks.jsonl", "v2_chunks.jsonl", "synopsis_chunks.jsonl")
             for l in open(DATA / f, encoding="utf-8")]
    texts += [q["q"] for q in json.load(open(HERE / "questions.json", encoding="utf-8"))]
    embed(texts)
