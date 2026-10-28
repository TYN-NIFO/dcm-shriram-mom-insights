import type { Source } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-05-14" -> "14 May 2025" (no timezone shifts). */
export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

export function formatPages(pages: number[]): string {
  if (!pages.length) return "";
  const sorted = [...pages].sort((a, b) => a - b);
  const contiguous = sorted.every((p, i) => i === 0 || p === sorted[i - 1] + 1);
  if (sorted.length === 1) return `p. ${sorted[0]}`;
  if (contiguous) return `pp. ${sorted[0]}–${sorted[sorted.length - 1]}`;
  return `pp. ${sorted.join(", ")}`;
}

/** One-line citation, e.g. "Board · 14 May 2025 · Item 4.2 Final dividend · p. 1201". */
export function citationText(s: Source): string {
  if (s.source_type === "synopsis") {
    const parts = [`Synopsis of Minutes · ${s.topic || s.title}`];
    if (s.meeting_date) parts.push(formatDate(s.meeting_date));
    if (s.item) parts.push(`Resolution ${s.item}`);
    return parts.join(" · ");
  }
  const parts = [`${s.body} · ${formatDate(s.meeting_date)}`];
  parts.push(`Item ${s.item}${s.title ? ` ${s.title}` : ""}`);
  const pages = formatPages(s.pages);
  if (pages) parts.push(`Minute book ${pages}`);
  return parts.join(" · ");
}

/** Citation written out as a sentence: "Board minutes, 6 May 2024, item 3.4.4, page 2310". */
export function citeLong(s: Source): string {
  if (s.source_type === "synopsis") {
    const topic = (s.topic || "").split(" / ")[0];
    return [`Synopsis of Minutes${topic ? `, ${topic}` : ""}`, s.item && `resolution ${s.item}`, s.meeting_date && formatDate(s.meeting_date)]
      .filter(Boolean)
      .join(", ");
  }
  const pages = s.pages.length ? formatPages(s.pages).replace(/^pp?\. /, s.pages.length > 1 ? "pages " : "page ") : "";
  return [`${s.body} minutes, ${formatDate(s.meeting_date)}`, `item ${s.item}`, pages].filter(Boolean).join(", ");
}

export function relativeDay(iso: string, now = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}
