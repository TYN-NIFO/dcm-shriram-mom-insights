import { AlertCircle, SearchX } from "lucide-react";
import Markdown from "./Markdown";
import Sources from "./Sources";
import type { ChatMessage, Source } from "@/lib/types";

interface Props {
  message: ChatMessage;
  selectedSourceId: string | null;
  onOpenSource: (s: Source) => void;
}

export default function MessageView({ message: m, selectedSourceId, onOpenSource }: Props) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-600 px-4 py-2.5 text-[15px] whitespace-pre-wrap text-white dark:bg-accent-700">
          <span className="sr-only">You asked: </span>
          {m.content}
        </div>
      </div>
    );
  }

  const streaming = m.status === "streaming";
  const notFound = m.found === false && !streaming;
  const waiting = streaming && !m.content;

  return (
    <article aria-label="Answer" aria-busy={streaming} className="flex flex-col">
      {notFound ? (
        <div className="flex gap-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-100/70 px-4 py-3 text-[15px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
          <SearchX className="mt-0.5 size-5 shrink-0 text-zinc-400" aria-hidden />
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Not found in the minutes</p>
            <Markdown text={m.content} />
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          {waiting ? (
            <p className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400" role="status">
              <span className="flex gap-1" aria-hidden>
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-zinc-400" />
              </span>
              Searching the minutes…
            </p>
          ) : (
            <div className={streaming ? "caret" : undefined}>
              <Markdown text={m.content} />
            </div>
          )}
          {m.status === "stopped" && (
            <p className="mt-2 text-xs text-zinc-500 italic dark:text-zinc-400">Stopped. This answer is incomplete.</p>
          )}
          {m.status === "error" && (
            <p
              role="alert"
              className="mt-2 flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {m.error}
            </p>
          )}
          {!streaming && m.sources && (
            <Sources sources={m.sources} selectedId={selectedSourceId} onOpen={onOpenSource} />
          )}
        </div>
      )}
    </article>
  );
}
