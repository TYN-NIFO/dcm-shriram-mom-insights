import { ChevronRight, Scale } from "lucide-react";
import Sources from "../Sources";
import { statusStyle } from "./status";
import type { CheckItem, Source } from "@/lib/types";

interface Props {
  item: CheckItem;
  index: number;
  selectedSourceId: string | null;
  onOpenSource: (s: Source) => void;
}

export function StatusChip({ status }: { status: string }) {
  const st = statusStyle(status);
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${st.chip}`}
    >
      <st.Icon className="size-3.5" aria-hidden />
      {st.label}
    </span>
  );
}

/** Finding text with [1], [2] … turned into buttons that open the matching governing source. */
function Finding({
  text,
  governing,
  onOpenSource,
}: {
  text: string;
  governing: Source[];
  onOpenSource: (s: Source) => void;
}) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="text-[15px] leading-relaxed text-zinc-700 dark:text-zinc-300">
      {parts.map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        const src = m ? governing[Number(m[1]) - 1] : undefined;
        if (!m || !src) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpenSource(src)}
            className="mx-0.5 rounded bg-gold-400 px-1.5 align-baseline text-xs font-bold text-zinc-950 transition hover:bg-zinc-950 hover:text-gold-400"
            aria-label={`Open governing decision ${m[1]}`}
          >
            {p}
          </button>
        );
      })}
    </p>
  );
}

export default function CheckResultCard({ item, index, selectedSourceId, onOpenSource }: Props) {
  const st = statusStyle(item.status);
  const headingId = `check-item-${index}`;
  return (
    <article
      aria-labelledby={headingId}
      className={`rounded-2xl border border-l-4 border-zinc-200 bg-white px-5 py-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-lg ${st.stripe}`}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
        <StatusChip status={item.status} />
        {item.category && (
          <span className="text-xs tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{item.category}</span>
        )}
      </div>

      <h3 id={headingId} className="mt-2 text-[15px] font-medium text-zinc-900 dark:text-zinc-100">
        <span className="sr-only">{st.label}: </span>
        {item.proposal}
      </h3>

      {item.comparison && (
        <p className="mt-2 flex items-start gap-2 rounded-xl bg-gold-400/25 px-3 py-2.5 text-sm font-semibold text-zinc-950 tabular-nums">
          <Scale className="mt-0.5 size-4 shrink-0 text-zinc-500 dark:text-zinc-400" aria-hidden />
          <span>{item.comparison}</span>
        </p>
      )}

      {item.finding && (
        <div className="mt-2">
          <Finding text={item.finding} governing={item.governing} onOpenSource={onOpenSource} />
        </div>
      )}

      <Sources
        title="Governing decisions"
        className="mt-3"
        sources={item.governing}
        selectedId={selectedSourceId}
        onOpen={onOpenSource}
      />

      {item.superseded.length > 0 && (
        <details className="group mt-3">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" aria-hidden />
            Earlier decisions (superseded) ({item.superseded.length})
          </summary>
          <Sources
            title="Earlier decisions (superseded)"
            hideTitle
            className="mt-2"
            sources={item.superseded}
            selectedId={selectedSourceId}
            onOpen={onOpenSource}
          />
        </details>
      )}
    </article>
  );
}
