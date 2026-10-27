import {
  CircleCheck,
  CircleCheckBig,
  CircleDashed,
  CircleX,
  TrendingUp,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { CHECK_STATUS_ORDER, type CheckItem, type CheckStatus } from "@/lib/types";

export interface StatusStyle {
  label: string;
  Icon: LucideIcon;
  /** Chip: background, border and text. */
  chip: string;
  /** Left accent stripe on the result card. */
  stripe: string;
}

export const STATUS: Record<CheckStatus, StatusStyle> = {
  conflict: {
    label: "Conflict",
    Icon: CircleX,
    chip: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300",
    stripe: "border-l-red-500 dark:border-l-red-500",
  },
  changes_limit: {
    label: "Changes a limit",
    Icon: TrendingUp,
    chip: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-300",
    stripe: "border-l-amber-500 dark:border-l-amber-500",
  },
  needs_review: {
    label: "Needs review",
    Icon: TriangleAlert,
    chip: "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/60 dark:bg-yellow-950/40 dark:text-yellow-200",
    stripe: "border-l-yellow-400 dark:border-l-yellow-500",
  },
  within_limit: {
    label: "Within limit",
    Icon: CircleCheckBig,
    chip: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300",
    stripe: "border-l-emerald-500 dark:border-l-emerald-500",
  },
  no_conflict: {
    label: "No conflict found",
    Icon: CircleCheck,
    chip: "border-accent-100 bg-accent-50 text-accent-700 dark:border-accent-900 dark:bg-accent-900/40 dark:text-accent-300",
    stripe: "border-l-accent-400 dark:border-l-accent-500",
  },
  no_limit_found: {
    label: "No governing decision found",
    Icon: CircleDashed,
    chip: "border-zinc-200 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    stripe: "border-l-zinc-300 dark:border-l-zinc-600",
  },
};

const RANK = new Map(CHECK_STATUS_ORDER.map((s, i) => [s, i]));

/** Most severe first; unknown statuses last; arrival order kept within a status. */
export function sortBySeverity(items: CheckItem[]): CheckItem[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (RANK.get(a.item.status) ?? 99) - (RANK.get(b.item.status) ?? 99) || a.i - b.i)
    .map((x) => x.item);
}

export function statusStyle(s: string): StatusStyle {
  return STATUS[s as CheckStatus] ?? STATUS.no_limit_found;
}
