# DCM Shriram MoM Insights - PoC

Proof of concept for DCM Shriram Ltd (The Yellow Network): a chatbot that answers questions from Board minutes
with citations to the minute-book page, plus a consistency check of draft agenda items / resolutions against past
Board decisions and approved limits.

**Confidential.** Client documents and everything derived from them (OCR text, page images, indexed data, answer
logs, evaluation results) are deliberately not in this repository - see `.gitignore`. Keys live in `.env`, never here.

## Layout

| Folder | What |
|---|---|
| `ocr_eval/` | OCR bake-off on the sample minutes (Azure Document Intelligence, Mistral, PaddleOCR, Chandra, GLM-OCR, Sarvam, GPT) and the scorer |
| `rag/` | Chunking, embeddings, search tests (Azure AI Search, Postgres + pgvector), answer tests, question sets (`holdout_questions.json` is frozen: check its sha256) |
| `api/` | FastAPI backend: `pipeline.py` (chat), `check.py` (consistency check), `pg_search.py` (pgvector search), tests, synthetic test drafts in `api/test_drafts/` |
| `web/` | Next.js 15 frontend: chat screen and "Check a draft" screen (`web/API.md` is the API contract) |
| `demo_script.md` | Demo walkthrough |

## Run locally

1. `.env` in this folder with the Azure endpoints and keys (names only, ask the team for values):
   `AZURE_DI_ENDPOINT, AZURE_DI_KEY, AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY, AZURE_OPENAI_EMBED_DEPLOYMENT,
   AZURE_OPENAI_CHAT_DEPLOYMENT, AZURE_SEARCH_ENDPOINT, AZURE_SEARCH_KEY, PGVECTOR_DSN, SEARCH_BACKEND=pgvector`
   (optional `CHAT_VIA`, `JUDGE_ENDPOINT`, `JUDGE_KEY`).
2. Data: `rag/data/` (built by `rag/prep.py` etc. from the minutes) and the Postgres table `docs`
   (`rag/pgsearch.py --build`, Docker image `pgvector/pgvector:0.8.0-pg17`). Not in the repo.
3. Backend: `python -m venv .venv-api`, install `fastapi uvicorn httpx python-dotenv rapidfuzz python-multipart pypdf
   psycopg2-binary`, then from `api/`: `..\.venv-api\Scripts\python -m uvicorn main:app --port 8000`.
4. Frontend: `cd web && npm install`, copy `.env.example` to `.env.local` and set `NEXT_PUBLIC_API_BASE`, `npm run dev`.

## Tests (backend running)

- `api/test_check.py` - consistency check on the synthetic drafts vs `api/test_drafts/expected.json`
- `api/test_followups.py` - multi-turn follow-up questions
- `api/test_conversations.py [fresh_conversations.json]` - conversation robustness (answers for manual / blind review)

Set `DCM_API` to point the tests at another port.
