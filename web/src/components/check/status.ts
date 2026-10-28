import { CircleCheck, CircleDashed, CircleX, MinusCircle, TrendingUp, TriangleAlert, type LucideIcon } from "lucide-react";
import { CHECK_STATUS_ORDER, type CheckItem, type CheckStatus } from "@/lib/types";

export interface StatusStyle {
  /** Verdict as written in the margin. */
  label: string;
  /** What it means, in one line. */
  hint: string;
  Icon: LucideIcon;
  /** Text colour of the verdict. */
  ink: string;
  /** Solid colour for the small key mark. */
  dot: string;
  /** Kept for callers that show a compact badge. */
  chip: string;
  stripe: string;
}

export const STATUS: Record<CheckStatus, StatusStyle> = {
  conflict: {
    label: "Conflict",
    hint: "Exceeds or contradicts a decision in force",
    Icon: CircleX,
    ink: "text-breach",
    dot: "bg-breach",
    chip: "text-breach",
    stripe: "before:bg-breach",
  },
  changes_limit: {
    label: "Changes a limit",
    hint: "Proposes to revise an approved limit",
    Icon: TrendingUp,
    ink: "text-revision",
    dot: "bg-revision",
    chip: "text-revision",
    stripe: "before:bg-revision",
  },
  needs_review: {
    label: "Needs review",
    hint: "Related decisions exist; check whether they apply",
    Icon: TriangleAlert,
    ink: "text-revision",
    dot: "bg-[#c99a2e]",
    chip: "text-revision",
    stripe: "before:bg-[#c99a2e]",
  },
  within_limit: {
    label: "Within limit",
    hint: "Inside the approved limit",
    Icon: CircleCheck,
    ink: "text-clear",
    dot: "bg-clear",
    chip: "text-clear",
    stripe: "before:bg-clear",
  },
  no_conflict: {
    label: "No conflict",
    hint: "Earlier decisions are precedent only",
    Icon: MinusCircle,
    ink: "text-note",
    dot: "bg-note",
    chip: "text-note",
    stripe: "before:bg-note",
  },
  no_limit_found: {
    label: "Nothing on record",
    hint: "No decision in the minutes governs it",
    Icon: CircleDashed,
    ink: "text-note",
    dot: "bg-rule",
    chip: "text-note",
    stripe: "before:bg-rule",
  },
};

const RANK = new Map(CHECK_STATUS_ORDER.map((s, i) => [s, i]));

/** Position in the draft, from the item id ("item_3" -> 3); items arrive in the order they finish checking. */
const draftOrder = (it: CheckItem) => Number(/(\d+)$/.exec(it.id)?.[1] ?? 999);

/** Most severe first; unknown statuses last; within a status, in the order of the draft. */
export function sortBySeverity(items: CheckItem[]): CheckItem[] {
  return [...items].sort(
    (a, b) => (RANK.get(a.status) ?? 99) - (RANK.get(b.status) ?? 99) || draftOrder(a) - draftOrder(b),
  );
}

export function statusStyle(s: string): StatusStyle {
  return STATUS[s as CheckStatus] ?? STATUS.no_limit_found;
}
