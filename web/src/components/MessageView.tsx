import Markdown from "./Markdown";
import Sources from "./Sources";
import type { ChatMessage, Source } from "@/lib/types";

interface Props {
  message: ChatMessage;
  selectedSourceId: string | null;
  onOpenSource: (s: Source) => void;
}


/**
 * Answer text as shown: source markers ([S1], [S1, S2]) removed, since the sources are listed under the answer,
 * and a list written inline as "1) ... 2) ..." split onto separate lines.
 */
function readable(text: string): string {
  let t = text.replace(/\s*\[S?\d+(?:\s*,\s*S?\d+)*\]/g, "");
  if ((t.match(/(?:^|\s)\d+\)\s/g) ?? []).length >= 2) t = t.replace(/(?:^|\s)(\d+)\)\s/g, "\n$1. ");
  return t.trim();
}

export default function MessageView({ message: m, selectedSourceId, onOpenSource }: Props) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-gold-400 px-4 py-2.5 text-[15px] font-medium whitespace-pre-wrap text-zinc-950 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-gold-400/40">
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
    <article aria-label="Answer" aria-busy={streaming} className="flex items-start">
      <div className="min-w-0 flex-1">
      {notFound ? (
        <div className="flex rounded-xl border border-dashed border-zinc-300 bg-zinc-100/70 transition duration-200 hover:-translate-y-0.5 hover:border-zinc-400 hover:shadow-md px-4 py-3 text-[15px] text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-400">
          <div>
            <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Not found in the minutes</p>
            <Markdown text={m.content} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl rounded-tl-md border border-zinc-200 bg-white px-5 py-4 text-[15px] leading-relaxed shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-gold-400 hover:shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {waiting ? (
            <p className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400" role="status">
              <span className="flex gap-1" aria-hidden>
                <span className="size-1.5 animate-bounce rounded-full bg-gold-500 [animation-delay:-0.3s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-gold-500 [animation-delay:-0.15s]" />
                <span className="size-1.5 animate-bounce rounded-full bg-gold-500" />
              </span>
              Searching the minutes…
            </p>
          ) : (
            <div className={streaming ? "caret" : undefined}>
              <Markdown text={readable(m.content)} />
            </div>
          )}
          {m.status === "stopped" && (
            <p className="mt-2 text-xs text-zinc-500 italic dark:text-zinc-400">Stopped. This answer is incomplete.</p>
          )}
          {m.status === "error" && (
            <p
              role="alert"
              className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300"
            >
              {m.error}
            </p>
          )}
          {!streaming && m.sources && (
            <Sources sources={m.sources} selectedId={selectedSourceId} onOpen={onOpenSource} />
          )}
        </div>
      )}
      </div>
    </article>
  );
}
