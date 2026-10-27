# DCM MoM Insights: frontend ↔ backend API contract

This is the contract the web frontend implements (`src/lib/api.ts`, `src/lib/types.ts`) and the
mock API reproduces (`src/app/mock-api/`). The FastAPI backend must match it.

- **Base URL:** `NEXT_PUBLIC_API_BASE`, e.g. `http://localhost:8000`. If it is empty or `/mock-api`,
  the frontend uses the built-in mock at `/mock-api` (same origin).
- **Auth:** none for now. The frontend sends **no** `Authorization` header. Entra ID sign-in
  (bearer token on every request, including page images) will be added later.
- **CORS:** if the backend runs on another origin (e.g. `:8000` vs the web app on `:3000`), it must
  allow the web app's origin, methods `GET, POST, DELETE`, and header `Content-Type`.
- **Errors:** non-2xx responses may carry JSON `{"detail": str}` (FastAPI default). The UI shows a
  friendly message by status: `0`/network, `401`, `403`, `404`, other.
- Dates are `YYYY-MM-DD`; timestamps are ISO 8601 (UTC, e.g. `2026-10-26T06:43:14.135Z`).

## GET /me

Current user and their access scope (shown as chips in the top bar and used to fill the filters).

```json
{
  "name": "Demo User",
  "email": "demo.user@example.com",
  "scopes": [
    { "company": "Sample Co Ltd", "body": "Board" },
    { "company": "Sample Co Ltd", "body": "Audit Committee" }
  ]
}
```

## POST /chat

Request (`Content-Type: application/json`, `Accept: text/event-stream`):

```json
{
  "conversation_id": "conv_123",
  "question": "And what record date was fixed?",
  "filters": { "company": "Sample Co Ltd", "body": "Board", "date_from": "2024-01-01", "date_to": "2025-12-31" }
}
```

- `conversation_id`: `null` starts a new conversation. For every follow-up question the UI sends
  the id of the conversation currently open (received in the first `meta` event or chosen in the
  sidebar), so the backend can load the earlier turns and resolve follow-ups.
  An unknown id should return `404`.
- `filters`: each key is optional and omitted when not set.

Response: `200`, `Content-Type: text/event-stream`. Each event is `event: <name>\ndata: <json>\n\n`
(the client also accepts `\r\n`, multi-line `data:`, and `:` comment / keep-alive lines).
The client reads it with `fetch` + `ReadableStream`, not `EventSource`.

| Order | Event | `data` |
|---|---|---|
| first | `meta` | `{"conversation_id": str, "message_id": str}` |
| repeated | `token` | `{"text": str}`: append to the answer as it arrives |
| once | `sources` | array of Source (below); `[]` when nothing was cited |
| last | `done` | `{"found": bool}`: `false` = not found in the minutes (UI shows a muted "Not found" style) |
| instead of done | `error` | `{"message": str}`: shown to the user under the partial answer |

Answer text may use simple markdown: paragraphs, `-` / `1.` lists, `**bold**`, `*italic*`.
If the stream ends without `done` or `error`, the UI marks the answer as cut off.
The user can press Stop: the client aborts the fetch, so the backend should stop generating when
the client disconnects (the mock saves the partial answer).

### Source

```json
{
  "id": "src_1",
  "source_type": "minutes",
  "company": "Sample Co Ltd",
  "body": "Board",
  "meeting_date": "2025-05-14",
  "item": "4.2",
  "title": "Recommendation of final dividend",
  "pages": [1201, 1202],
  "page_image_urls": ["/pages/1201.png", "/pages/1202.png"],
  "topic": "Dividends"
}
```

- `source_type`: `"minutes"` or `"synopsis"`. The UI shows minutes as
  "body · meeting date / Item item · title / Minute book pp. …" and Synopsis as
  "Synopsis of Minutes · topic". `topic` is optional (used for Synopsis).
- `pages`: minute-book page numbers (not PDF page numbers), same order as `page_image_urls`.
- `page_image_urls`: absolute URLs, or paths relative to the API base (`/pages/1201.png` is fetched
  as `${API_BASE}/pages/1201.png`). May be `[]` (e.g. Synopsis entries have no scan).

## POST /check

"Check a draft": the Company Secretary's team uploads a draft Board agenda or draft resolution; each
proposed decision in it is checked against past Board decisions and the currently approved limits.

Request: `multipart/form-data` with either `file` (the upload: `.docx`, `.pdf` - scanned / image-only PDFs
are read with OCR -, `.png` / `.jpg` / `.tif` image, or `.txt`, max 10 MB) or `text` (pasted draft). The client does **not** set `Content-Type` manually, so the
browser adds the multipart boundary. It sends `Accept: text/event-stream`.

Response: `200`, `Content-Type: text/event-stream`, same SSE framing as `/chat`:

```
event: meta   data: {"check_id": str, "document": str, "read_with": "text" | "ocr", "items_found": int, "proposals": [str]}
event: item   data: {"id": str, "proposal": str, "category": str|null, "amount": {"value": number, "unit": str}|null, "basis": str|null,
                     "status": "conflict"|"changes_limit"|"needs_review"|"within_limit"|"no_conflict"|"no_limit_found",
                     "finding": str, "comparison": str|null, "limit": {"value", "unit", "basis"}|null,
                     "governing": [Source], "superseded": [Source]}     (one per proposal, in completion order)
event: done   data: {"summary": {"conflict": n, "changes_limit": n, "needs_review": n, "within_limit": n, "no_conflict": n, "no_limit_found": n}}
event: error  data: {"message": str}
```

- `400` responses carry `{"detail": str}`; the UI shows the `detail` text as is.
- `Source` is the same type as in `/chat` sources (below). In `finding`, `[1]`, `[2]` refer to
  `governing` in order.
- `comparison` is calculated in code (not by the model), e.g. "Proposed Rs. 400 crore vs limit Rs. 300 crore per bank".
- The UI sorts results by severity: `conflict`, `changes_limit`, `needs_review`, `within_limit`,
  `no_conflict`, `no_limit_found`.
- If the stream ends without `done` or `error`, the UI reports the check as cut off. Cancelling aborts
  the fetch, so the backend should stop work when the client disconnects.
- CORS: `multipart/form-data` is a simple content type; the backend must still allow the web app's origin.

**Mock:** `/mock-api/check` returns 4 synthetic items (conflict, changes a limit, within limit, no
governing decision found). Pasted text or a `.txt` file containing the word `fail` gets an `error`
event after the first item; `empty` gets `items_found: 0`. `.docx` / `.pdf` contents are not parsed.

## GET /conversations

The user's conversations from the last 7 days, newest first.

```json
[{ "id": "conv_123", "title": "Final dividend recommended last year", "updated_at": "2026-10-25T06:43:04.957Z" }]
```

## GET /conversations/{id}

```json
{
  "id": "conv_123",
  "title": "Final dividend recommended last year",
  "messages": [
    { "id": "m1", "role": "user", "content": "What final dividend…?", "created_at": "…" },
    { "id": "m2", "role": "assistant", "content": "According to…", "sources": [], "found": true, "created_at": "…" }
  ]
}
```

`sources` and `found` are present on assistant messages. `404` if not found or older than 7 days.

## DELETE /conversations/{id}

`204 No Content`. `404` if it does not exist.

## GET /pages/{minute_book_page}.png

The scanned page image (`image/png`). The backend checks the user may see that page and returns
`403` otherwise. The frontend fetches it with `fetch` and shows it from a blob URL, so a bearer
token can be added later without changing the viewer.

**Mock difference:** `/mock-api/pages/{n}.png` returns a synthetic **SVG** placeholder
(`Content-Type: image/svg+xml`) at the `.png` path.
