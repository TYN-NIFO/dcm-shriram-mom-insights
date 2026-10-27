import {
  NOT_FOUND_ANSWER,
  SAMPLE_ANSWER,
  newId,
  sampleSources,
  store,
} from "@/lib/mock/store";
import type { ChatFilters, ChatRequest, Source } from "@/lib/types";

export const dynamic = "force-dynamic";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describeFilters(f: ChatFilters): string {
  const parts: string[] = [];
  if (f.company) parts.push(f.company);
  if (f.body) parts.push(f.body);
  if (f.date_from || f.date_to) parts.push(`${f.date_from ?? "…"} to ${f.date_to ?? "…"}`);
  return parts.join(", ");
}

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return Response.json({ detail: "Invalid JSON" }, { status: 400 });
  }
  const question = (body.question ?? "").trim();
  if (!question) return Response.json({ detail: "Question is required" }, { status: 400 });
  const filters = body.filters ?? {};

  const s = store();
  const now = () => new Date().toISOString();

  // Continue the given conversation (follow-up) or start a new one.
  let conv = body.conversation_id ? s.conversations.get(body.conversation_id) : undefined;
  if (body.conversation_id && !conv)
    return Response.json({ detail: "Conversation not found" }, { status: 404 });
  if (!conv) {
    const id = newId("conv");
    conv = {
      id,
      title: question.length > 60 ? `${question.slice(0, 57)}…` : question,
      messages: [],
      updated_at: now(),
    };
    s.conversations.set(id, conv);
  }
  const previousQuestion = [...conv.messages].reverse().find((m) => m.role === "user")?.content;

  conv.messages.push({ id: newId("msg"), role: "user", content: question, created_at: now() });
  conv.updated_at = now();

  const notFound = /merger/i.test(question);
  let answer = notFound ? NOT_FOUND_ANSWER : SAMPLE_ANSWER;
  if (!notFound && previousQuestion) {
    // Show that the backend can see earlier turns of the same conversation.
    answer = `Following on from your earlier question ("${previousQuestion}"):\n\n${answer}`;
  }
  const f = describeFilters(filters);
  if (f) answer += `\n\nFilters applied: ${f}.`;
  const sources: Source[] = notFound ? [] : sampleSources();
  const messageId = newId("msg");

  const encoder = new TextEncoder();
  const conversation = conv;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      let streamed = "";
      send("meta", { conversation_id: conversation.id, message_id: messageId });
      await sleep(400); // pretend to retrieve
      // Stream word by word, keeping whitespace/newlines attached.
      for (const piece of answer.match(/\S+\s*/g) ?? []) {
        if (req.signal.aborted || closed) break;
        send("token", { text: piece });
        streamed += piece;
        await sleep(35);
      }
      const stopped = req.signal.aborted || closed;
      if (!stopped) {
        send("sources", sources);
        send("done", { found: !notFound });
      }
      conversation.messages.push({
        id: messageId,
        role: "assistant",
        content: stopped ? streamed : answer,
        sources: stopped ? [] : sources,
        found: !notFound,
        created_at: new Date().toISOString(),
      });
      conversation.updated_at = new Date().toISOString();
      if (!closed) {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
