import { formatDate, formatPages } from "@/lib/format";
import type { Source } from "@/lib/types";

interface Props {
  sources: Source[];
  selectedId?: string | null;
  onOpen: (s: Source) => void;
  /** Heading shown above the list (default "Sources"). */
  title?: string;
  /** Hide the heading (e.g. when a surrounding <details> summary already names the list). */
  hideTitle?: boolean;
  className?: string;
}

export default function Sources({
  sources,
  selectedId,
  onOpen,
  title = "Sources",
  hideTitle = false,
  className = "mt-4",
}: Props) {
  if (!sources.length) return null;
  return (
    <section className={className} aria-label={title}>
      {!hideTitle && (
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          {title}
        </h3>
      )}
      <ol className="grid gap-2 sm:grid-cols-2">
        {sources.map((s, i) => {
          const synopsis = s.source_type === "synopsis";
          const selected = selectedId === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onOpen(s)}
                aria-pressed={selected}
                className={`flex h-full w-full items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left text-sm transition duration-200 ${
                  selected
                    ? "border-accent-400 bg-accent-50 dark:border-accent-500 dark:bg-accent-900/30"
                    : "border-zinc-200 bg-white hover:-translate-y-0.5 hover:border-gold-400 hover:shadow-md active:translate-y-0 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:border-accent-500/60 dark:hover:bg-zinc-800"
                }`}
              >
                <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded bg-gold-400 text-[11px] font-bold text-zinc-950">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1">
                  {synopsis ? (
                    <span className="flex items-center font-medium">
                      <span className="truncate">Synopsis of Minutes · {s.topic || s.title}</span>
                    </span>
                  ) : (
                    <span className="flex items-center font-medium">
                      <span className="truncate">
                        {s.body} · {formatDate(s.meeting_date)}
                      </span>
                    </span>
                  )}
                  <span className="mt-0.5 block text-zinc-600 dark:text-zinc-300">
                    {synopsis ? (
                      <>
                        {s.item ? `Resolution ${s.item} · ` : ""}
                        {s.title}
                        {s.meeting_date ? ` · ${formatDate(s.meeting_date)}` : ""}
                      </>
                    ) : (
                      <>
                        Item {s.item} · {s.title}
                      </>
                    )}
                  </span>
                  {s.pages.length > 0 && (
                    <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                      Minute book {formatPages(s.pages)}
                    </span>
                  )}
                  {s.company && (
                    <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-500">{s.company}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
