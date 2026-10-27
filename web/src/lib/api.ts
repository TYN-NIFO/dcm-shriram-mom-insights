import type {
  ChatRequest,
  CheckItem,
  CheckMeta,
  CheckSummary,
  Conversation,
  ConversationSummary,
  Me,
  Source,
} from "./types";

const MOCK_BASE = "/mock-api";

/** API base URL. Unset or "/mock-api" uses the built-in mock API. */
export const API_BASE: string = (() => {
  const v = (process.env.NEXT_PUBLIC_API_BASE ?? "").trim();
  return (v === "" ? MOCK_BASE : v).replace(/\/+$/, "");
})();

export const IS_MOCK = API_BASE === MOCK_BASE;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Absolute URLs are used as-is; relative ones are joined to API_BASE. */
export function resolveApiUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE}/${pathOrUrl.replace(/^\/+/, "")}`;
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(path), { ...init, cache: "no-store" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiError(0, "Network error");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.message ?? detail;
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, String(detail || "Request failed"));
  }
  return res;
}

/** Friendly, non-technical message for an error from any API call. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0)
      return "Can't reach the MoM Insights service. Check your connection and try again.";
    if (e.status === 401)
      return "Your session isn't recognised by the service. Reload the page and try again.";
    if (e.status === 403)
      return "You don't have access to this. If you think you should, contact the Company Secretary's office.";
    if (e.status === 404) return "That item could not be found. It may have been deleted.";
    return "Something went wrong on our side. Please try again in a moment.";
  }
  return "Something went wrong. Please try again.";
}

export async function getMe(): Promise<Me> {
  return (await request("/me")).json();
}

export async function listConversations(): Promise<ConversationSummary[]> {
  return (await request("/conversations")).json();
}

export async function getConversation(id: string): Promise<Conversation> {
  return (await request(`/conversations/${encodeURIComponent(id)}`)).json();
}

export async function deleteConversation(id: string): Promise<void> {
  await request(`/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function fetchPageImage(url: string, signal?: AbortSignal): Promise<Blob> {
  return (await request(url, { signal })).blob();
}

export interface ChatStreamHandlers {
  onMeta?: (m: { conversation_id: string; message_id: string }) => void;
  onToken?: (text: string) => void;
  onSources?: (s: Source[]) => void;
  onDone?: (d: { found: boolean }) => void;
  onError?: (message: string) => void;
}

/**
 * POST /chat and parse the text/event-stream response with fetch + ReadableStream.
 * Resolves when the stream ends; rejects with AbortError if `signal` aborts.
 */
export async function streamChat(
  body: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request("/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(body),
    signal,
  });
  await readEventStream(res, (event, payload) => {
    switch (event) {
      case "meta":
        handlers.onMeta?.(payload as { conversation_id: string; message_id: string });
        break;
      case "token":
        handlers.onToken?.((payload as { text: string }).text ?? "");
        break;
      case "sources":
        handlers.onSources?.(Array.isArray(payload) ? (payload as Source[]) : []);
        break;
      case "done":
        handlers.onDone?.(payload as { found: boolean });
        break;
      case "error":
        handlers.onError?.((payload as { message: string }).message ?? "Error");
        break;
    }
  });
}

/**
 * Read a text/event-stream body and call `onEvent(name, parsedJson)` for each event.
 * Handles \r\n, multi-line data and comment / keep-alive lines; skips non-JSON data.
 */
async function readEventStream(res: Response, onEvent: (event: string, payload: unknown) => void): Promise<void> {
  if (!res.body) throw new ApiError(500, "Empty response");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const dispatch = (raw: string) => {
    let event = "message";
    const data: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith(":")) continue; // comment / keep-alive
      const idx = line.indexOf(":");
      const field = idx === -1 ? line : line.slice(0, idx);
      let value = idx === -1 ? "" : line.slice(idx + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length === 0) return;
    let payload: unknown;
    try {
      payload = JSON.parse(data.join("\n"));
    } catch {
      return;
    }
    onEvent(event, payload);
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      dispatch(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) dispatch(buffer);
}

// ---- Check a draft -------------------------------------------------------

export const CHECK_MAX_BYTES = 10 * 1024 * 1024;
export const CHECK_EXTENSIONS = [".docx", ".pdf", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff"] as const;

export interface CheckStreamHandlers {
  onMeta?: (m: CheckMeta) => void;
  onItem?: (item: CheckItem) => void;
  onDone?: (d: { summary: CheckSummary }) => void;
  onError?: (message: string) => void;
}

/**
 * POST /check as multipart/form-data with either `file` or `text`, then parse the SSE response.
 * Content-Type is left to the browser so it can add the multipart boundary.
 * A 400 rejects with ApiError(400, detail).
 */
export async function streamCheck(
  input: { file: File } | { text: string },
  handlers: CheckStreamHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData();
  if ("file" in input) form.append("file", input.file, input.file.name);
  else form.append("text", input.text);

  const res = await request("/check", {
    method: "POST",
    headers: { Accept: "text/event-stream" },
    body: form,
    signal,
  });

  await readEventStream(res, (event, payload) => {
    switch (event) {
      case "meta":
        handlers.onMeta?.(payload as CheckMeta);
        break;
      case "item":
        handlers.onItem?.(payload as CheckItem);
        break;
      case "done":
        handlers.onDone?.(payload as { summary: CheckSummary });
        break;
      case "error":
        handlers.onError?.((payload as { message: string }).message ?? "Error");
        break;
    }
  });
}
