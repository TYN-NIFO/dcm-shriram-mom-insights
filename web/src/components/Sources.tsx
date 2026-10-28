"use client";

import { citeLong, formatDate } from "@/lib/format";
import { fontVars } from "@/lib/fonts";
import type { Source } from "@/lib/types";

interface Props {
  sources: Source[];
  selectedId?: string | null;
  onOpen: (s: Source) => void;
  /** Accessible name of the list (default "Sources"). */
  title?: string;
  hideTitle?: boolean;
  className?: string;
  /** Kept for callers; unused. */
  initial?: number;
  start?: number;
}

const newestFirst = (a: Source, b: Source) => (b.meeting_date || "").localeCompare(a.meeting_date || "");

function Group({ label, items, selectedId, onOpen }: { label: string; items: Source[]; selectedId?: string | null; onOpen: (s: Source) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1.5">
      <span className="w-[8.5rem] shrink-0 text-[12.5px] text-note">{label}</span>
      {items.map((s) => {
        const selected = selectedId === s.id;
        const ref = s.source_type === "synopsis" ? `res. ${s.item}` : `item ${s.item}${s.pages[0] ? `, p. ${s.pages[0]}` : ""}`;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onOpen(s)}
            aria-pressed={selected}
            title={`${citeLong(s)}${s.title ? `\n${s.title}` : ""}`}
            className={`rounded-[4px] border px-2 py-0.5 text-[12.5px] tabular-nums ${
              selected ? "border-minute bg-minute text-white" : "border-rule bg-white text-ink hover:border-minute hover:text-minute"
            }`}
          >
            {formatDate(s.meeting_date)}
            <span className={selected ? "text-white/80" : "text-note"}>, {ref}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Where the answer comes from: the minute-book items and register entries, newest first. Click to open. */
export default function Sources({ sources, selectedId, onOpen, title = "Sources", className = "mt-4" }: Props) {
  if (!sources.length) return null;
  const minutes = sources.filter((s) => s.source_type !== "synopsis").sort(newestFirst);
  const register = sources.filter((s) => s.source_type === "synopsis").sort(newestFirst);
  return (
    <section className={`${fontVars} font-ui space-y-1.5 border-t border-rule pt-3 ${className}`} aria-label={title}>
      <Group label="Minute book" items={minutes} selectedId={selectedId} onOpen={onOpen} />
      <Group label="Synopsis register" items={register} selectedId={selectedId} onOpen={onOpen} />
    </section>
  );
}
