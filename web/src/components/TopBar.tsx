"use client";

import { Menu } from "lucide-react";
import ThemeSwitch from "./ThemeSwitch";
import type { Me } from "@/lib/types";

interface Props {
  me: Me | null;
  /** Opens the sidebar drawer on small screens. */
  onOpenSidebar?: () => void;
  /** Page title shown on the left, e.g. "Ask the minutes". */
  title?: string;
}

export default function TopBar({ onOpenSidebar, title = "MoM Insights" }: Props) {
  return (
    <header className="flex shrink-0 items-center gap-3 px-3 py-3 sm:px-6">
      {onOpenSidebar && (
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-lg p-2 text-zinc-600 hover:bg-zinc-200/70 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="Open menu"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      )}

      <h1 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
        {title}
        <span className="rounded-md bg-zinc-200/70 px-1.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          PoC
        </span>
      </h1>

      <div className="ml-auto">
        <ThemeSwitch />
      </div>
     
    </header>
  );
}

/** Access-scope chips for small screens (shown under the top bar). */
export function ScopeStrip({ me }: { me: Me | null }) {
  if (!me?.scopes.length) return null;
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pb-2 xl:hidden">
      <span className="shrink-0 self-center text-xs text-zinc-500 dark:text-zinc-400">Access:</span>
      {me.scopes.map((s) => (
        <span
          key={`${s.company}|${s.body}`}
          className="shrink-0 rounded-full border border-zinc-200 bg-white px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          {s.company} · {s.body}
        </span>
      ))}
    </div>
  );
}
