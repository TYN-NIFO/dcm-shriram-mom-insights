import { categoryLabel, formatAmount, formatBasis } from "@/lib/checkFormat";
import { citeLong } from "@/lib/format";
import { statusStyle } from "./status";
import type { CheckItem, Source } from "@/lib/types";

interface Props {
  item: CheckItem;
  selectedSourceId: string | null;
  onOpenSource: (s: Source) => void;
}

const UNIT_BASE: Record<string, number> = { crore: 1e7, crores: 1e7, cr: 1e7, lakh: 1e5, lakhs: 1e5, rupees: 1, rs: 1, "usd million": 1e6, "usd mn": 1e6 };

/** The comparison as one sentence, from the numbers the backend calculated. */
function ruling(item: CheckItem): string | null {
  const a = item.amount, l = item.limit;
  const proposed = formatAmount(a), limit = formatAmount(l);
  if (!proposed || !limit || !a || !l) return null;
  const basis = formatBasis(l.basis);
  const against = `${proposed} against a limit of ${limit}${basis ? ` ${basis}` : ""}`;
  if (item.status === "changes_limit") return `Raises the limit from ${limit} to ${proposed}${basis ? ` ${basis}` : ""}.`;
  const ua = String(a.unit).toLowerCase(), ul = String(l.unit).toLowerCase();
  const ba = UNIT_BASE[ua], bl = UNIT_BASE[ul];
  if (!ba || !bl || ua.startsWith("usd") !== ul.startsWith("usd")) return `${against}.`;
  const diff = formatAmount({ value: Math.abs(a.value * ba - l.value * bl) / bl, unit: l.unit });
  if (item.status === "conflict") return `${against}: ${diff} over.`;
  if (item.status === "within_limit") return `${against}, leaving ${diff}.`;
  return `${against}.`;
}

function CiteLink({ s, selected, onOpen }: { s: Source; selected: boolean; onOpen: (s: Source) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(s)}
      aria-pressed={selected}
      className={`text-left underline decoration-accent-700/30 underline-offset-[3px] hover:decoration-accent-700 ${
        selected ? "text-zinc-900 decoration-accent-700" : "text-accent-700"
      }`}
    >
      {citeLong(s)}
    </button>
  );
}

/** Finding text; [n] refers to governing then superseded sources, in that order. */
function Finding({ text, cited, onOpen }: { text: string; cited: Source[]; onOpen: (s: Source) => void }) {
  return (
    <p className="max-w-[68ch] text-[13.5px] leading-6 text-zinc-500">
      {text.split(/(\[\d+\])/g).map((p, i) => {
        const m = /^\[(\d+)\]$/.exec(p);
        const src = m ? cited[Number(m[1]) - 1] : undefined;
        if (!m || !src) return <span key={i}>{p}</span>;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onOpen(src)}
            className="mx-px align-super text-[10px] font-semibold text-accent-700 hover:underline"
            aria-label={`Open cited decision ${m[1]}`}
          >
            {m[1]}
          </button>
        );
      })}
    </p>
  );
}

function CiteList({ label, sources, selectedId, onOpen }: { label: string; sources: Source[]; selectedId: string | null; onOpen: (s: Source) => void }) {
  if (!sources.length) return null;
  return (
    <p className="mt-2 text-[13px] text-zinc-500">
      {label}{" "}
      {sources.map((s, i) => (
        <span key={s.id}>
          {i > 0 && (i === sources.length - 1 ? " and " : "; ")}
          <CiteLink s={s} selected={selectedId === s.id} onOpen={onOpen} />
        </span>
      ))}
      .
    </p>
  );
}

/** One proposed decision, set out like an annotated minute: verdict in the margin, the governing resolution quoted. */
export default function CheckResultCard({ item, selectedSourceId, onOpenSource }: Props) {
  const st = statusStyle(item.status);
  const headingId = `check-item-${item.id}`;
  const draftNo = /(\d+)$/.exec(item.id)?.[1];
  const line = ruling(item);
  // Quote the governing decision that states the limit (its figure appears in the text); otherwise the first one.
  const figure = item.limit ? String(item.limit.value).replace(/\.0+$/, "") : null;
  const states = (s: Source) => !!figure && new RegExp(`(^|[^\\d,])${figure.replace(".", "\\.")}([^\\d]|$)`).test(s.title);
  const lead = item.governing.find(states) ?? item.governing[0];
  const others = item.governing.filter((s) => s !== lead);
  const category = categoryLabel(item.category);

  return (
    <article aria-labelledby={headingId} className="grid gap-x-8 gap-y-3 px-6 py-6 sm:grid-cols-[9.5rem_minmax(0,1fr)]">
      <div className="sm:pt-0.5">
        <p className={`flex items-center gap-1.5 text-[13px] font-semibold ${st.ink}`}>
          <st.Icon className="size-4 shrink-0" aria-hidden />
          {st.label}
        </p>
        <p className="mt-1 text-xs leading-5 text-zinc-500">
          {draftNo && <span className="block">Draft item {draftNo}</span>}
          {category}
        </p>
      </div>

      <div className="min-w-0">
        <h3 id={headingId} className=" text-[17px] leading-7 text-zinc-900">
          <span className="sr-only">{st.label}: </span>
          {item.proposal}
        </h3>

        {line && (
          <p className="mt-2 text-[14px] font-medium text-zinc-900 tabular-nums">
            {line}
            {item.comparison?.includes("calculated") && <span className="ml-2 text-xs font-normal text-zinc-500">Calculated</span>}
          </p>
        )}

        {lead && (
          <figure className="mt-4 border-l-2 border-gold-400 pl-4">
            <blockquote className="line-clamp-5 text-[15px] leading-7 text-zinc-700 " title={lead.title}>
              {lead.title}
            </blockquote>
            <figcaption className="mt-1.5 text-[13px]">
              <CiteLink s={lead} selected={selectedSourceId === lead.id} onOpen={onOpenSource} />
            </figcaption>
          </figure>
        )}

        <CiteList label="Also governed by" sources={others} selectedId={selectedSourceId} onOpen={onOpenSource} />
        <CiteList label="Replaces" sources={item.superseded} selectedId={selectedSourceId} onOpen={onOpenSource} />

        {item.finding && (
          <details className="group mt-3">
            <summary className="cursor-pointer list-none text-[13px] text-zinc-500 hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
              <span className="underline decoration-zinc-300 underline-offset-[3px] group-open:hidden">Show reasoning</span>
              <span className="hidden underline decoration-zinc-300 underline-offset-[3px] group-open:inline">Hide reasoning</span>
            </summary>
            <div className="mt-2">
              <Finding text={item.finding} cited={[...item.governing, ...item.superseded]} onOpen={onOpenSource} />
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
