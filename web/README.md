# DCM MoM Insights: web frontend (PoC)

Chat UI for asking questions about Board and Committee minutes. Every answer lists its sources
(meeting, item, minute-book pages), and clicking a source opens the scanned page beside the chat.

A second screen, **Check a draft** (`/check`), takes a draft Board agenda or resolution (upload
`.docx` / text `.pdf` / `.txt` up to 10 MB, or paste text) and shows, for each proposed decision,
whether it is consistent with past Board decisions and approved limits, with the governing decisions
as citations that open the scanned page. Switch screens with the "Chat / Check a draft" control in
the top bar.

Built by The Yellow Network. All data in the built-in mock is **synthetic placeholder text**
("Sample Co Ltd", invented resolutions). No client content is included.

## Run

Requires Node 22 and npm 11.

```bash
npm install
npm run dev            # http://localhost:3000
```

### With the mock API (default)

Leave `NEXT_PUBLIC_API_BASE` unset (or set it to `/mock-api`). The app talks to route handlers under
`src/app/mock-api/`, which stream a canned answer word by word with 2 sources. Try:

- any question: an answer with a minutes source and a Synopsis source;
- a question containing "merger": a "not found" answer;
- a follow-up in the same chat: the mock prefixes "Following on from your earlier question…",
  showing that the conversation id is sent and earlier turns are visible to the backend.
- **Check a draft**: any upload or pasted text returns 4 synthetic results (conflict, changes a
  limit, within limit, no governing decision found), streamed one by one. Pasted text containing
  `fail` shows the stream-error state; `empty` shows "no proposed decisions found"; an empty paste or
  a wrong file type shows the 400 `detail` message.

Conversations are kept in server memory only (lost when the dev server restarts) and pruned after 7 days.

### With the real backend

```bash
cp .env.example .env.local
# set NEXT_PUBLIC_API_BASE=http://localhost:8000
npm run dev
```

The backend must implement [API.md](./API.md) and allow CORS from the web app's origin.
`NEXT_PUBLIC_*` values are compiled into the bundle, so restart `npm run dev` / rebuild after changing them.

### Production build

```bash
npm run lint
npm run build
npm start
```

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | empty → `/mock-api` | Backend base URL, e.g. `http://localhost:8000`. Empty or `/mock-api` uses the built-in mock. |

No secrets belong in this app. See `.env.example`.

## Folder structure

```
web/
  API.md                     API contract (as implemented)
  .env.example               environment template
  src/
    app/
      layout.tsx, page.tsx   root layout; the chat page is the home page
      check/page.tsx         "Check a draft" screen (/check)
      globals.css            Tailwind v4 theme (neutral greys + teal accent, light/dark)
      mock-api/              mock backend (synthetic data)
        me/route.ts                    GET  /me
        chat/route.ts                  POST /chat (SSE stream)
        check/route.ts                 POST /check (multipart in, SSE stream out)
        conversations/route.ts         GET  /conversations
        conversations/[id]/route.ts    GET / DELETE /conversations/{id}
        pages/[page]/route.ts          GET  /pages/{n}.png (SVG placeholder)
    components/
      ChatApp.tsx            page state: conversations, streaming, follow-ups, errors
      TopBar.tsx             product name, Chat / Check a draft switch, user, access-scope chips
      Sidebar.tsx            last-7-days conversations: new / select / delete
      Composer.tsx           filters (company, body, date range) + question input / stop
      MessageView.tsx        question and answer bubbles, not-found and error styles
      Markdown.tsx           minimal safe markdown (paragraphs, lists, bold, italic)
      Sources.tsx            source list under each answer
      SourcePanel.tsx        page-image viewer (zoom, prev/next); drawer on mobile
      check/CheckApp.tsx     Check a draft: input (upload / paste), progress, summary, results
      check/CheckResultCard.tsx  one result: status chip, comparison, finding, governing / superseded
      check/status.ts        status labels, colours, icons, severity sort
    lib/
      api.ts                 API client, SSE parser, friendly error messages
      types.ts               shared types
      format.ts              date / page / citation formatting
      mock/store.ts          in-memory mock data
```

## Behaviour notes

- Enter sends, Shift+Enter adds a new line; the input is disabled while an answer streams, and
  Stop aborts the request.
- Each question is sent with the open conversation's id (`null` for a new chat), so follow-ups work.
- Page images are fetched with `fetch` and shown from blob URLs, ready for authenticated requests.
- Light/dark mode follows the OS setting. Layout works down to phone width (sidebar and source
  viewer become drawers).

## TODO

- **Entra ID sign-in comes later.** No login for now: the app opens straight on the chat page and
  shows the user returned by `GET /me`; no `Authorization` header is sent. When added: Entra app
  registration (SPA redirect URI, exposed API scope), MSAL in the frontend, bearer token on all API
  calls including page images (`src/lib/api.ts` `request()` is the single place to add it), and
  401 handling that prompts the user to sign in again.
- Conversations in the real backend: persistence and 7-day deletion are the backend's job.
- Check a draft: results are not saved or listed (no history); the backend's `POST /check` is still to
  be built. Image-only (scanned) PDFs are not supported as drafts.
