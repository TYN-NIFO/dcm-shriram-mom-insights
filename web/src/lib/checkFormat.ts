import type { CheckAmount, CheckItem, CheckLimit } from "./types";

/** Draft categories from the backend -> plain labels. */
const CATEGORY: Record<string, string> = {
  borrowing: "Borrowing",
  investment: "Investment",
  surplus_funds: "Investment of surplus funds",
  loan_guarantee: "Loans and guarantees",
  derivatives: "Derivatives",
  dividend: "Dividend",
  remuneration: "Remuneration",
  appointment: "Appointment",
  political_contribution: "Political contribution",
  csr: "CSR",
  delegation: "Delegation of authority",
  capex: "Capital expenditure",
  other: "Other",
};

export function categoryLabel(c: string | null | undefined): string | null {
  if (!c) return null;
  return CATEGORY[c] ?? c.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());
}

const UNIT: Record<string, { pre: string; post: string; base: number }> = {
  crore: { pre: "Rs. ", post: " crore", base: 1e7 },
  crores: { pre: "Rs. ", post: " crore", base: 1e7 },
  cr: { pre: "Rs. ", post: " crore", base: 1e7 },
  lakh: { pre: "Rs. ", post: " lakh", base: 1e5 },
  lakhs: { pre: "Rs. ", post: " lakh", base: 1e5 },
  rupees: { pre: "Rs. ", post: "", base: 1 },
  rs: { pre: "Rs. ", post: "", base: 1 },
  "usd million": { pre: "USD ", post: " million", base: 1e6 },
  "usd mn": { pre: "USD ", post: " million", base: 1e6 },
  percent: { pre: "", post: "%", base: 1 },
  "%": { pre: "", post: "%", base: 1 },
};

const num = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/** {value: 350, unit: "crore"} -> "Rs. 350 crore"; {450, "usd million"} -> "USD 450 million". */
export function formatAmount(a: CheckAmount | CheckLimit | null | undefined): string | null {
  if (!a || typeof a.value !== "number") return null;
  const u = UNIT[String(a.unit ?? "").toLowerCase().trim()];
  return u ? `${u.pre}${num(a.value)}${u.post}` : `${num(a.value)} ${a.unit ?? ""}`.trim();
}

/** "per bank" / "per financial year" kept; "one-time" and empty dropped. */
export function formatBasis(b: string | null | undefined): string | null {
  if (!b) return null;
  const t = b.trim();
  if (!t || /^one[- ]?time$/i.test(t)) return null;
  return t;
}

/** Difference between proposal and limit, in the limit's unit, when both are on a known currency scale. */
export function difference(item: CheckItem): string | null {
  const a = item.amount, l = item.limit;
  if (!a || !l) return null;
  const ua = UNIT[String(a.unit).toLowerCase().trim()], ul = UNIT[String(l.unit).toLowerCase().trim()];
  if (!ua || !ul || ua.pre !== ul.pre || ua.post === "%") return null;
  const diff = (a.value * ua.base - l.value * ul.base) / ul.base;
  if (Math.abs(diff) < 1e-9) return "Equal to the limit";
  const amt = formatAmount({ value: Math.abs(diff), unit: l.unit });
  return diff > 0 ? `${amt} above` : `${amt} headroom`;
}
