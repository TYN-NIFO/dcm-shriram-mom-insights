"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, SlidersHorizontal, Square, X } from "lucide-react";
import type { ChatFilters, Scope } from "@/lib/types";

interface Props {
  scopes: Scope[];
  filters: ChatFilters;
  onFiltersChange: (f: ChatFilters) => void;
  busy: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
  focusKey: unknown; // changes when the input should regain focus
}

const fieldCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default function Composer({ scopes, filters, onFiltersChange, busy, onSend, onStop, focusKey }: Props) {
  const [text, setText] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const ids = useId();

  const companies = useMemo(() => [...new Set(scopes.map((s) => s.company))], [scopes]);
  const bodies = useMemo(
    () => [
      ...new Set(scopes.filter((s) => !filters.company || s.company === filters.company).map((s) => s.body)),
    ],
    [scopes, filters.company],
  );

  const activeCount = [filters.company, filters.body, filters.date_from, filters.date_to].filter(Boolean).length;
  const dateError =
    filters.date_from && filters.date_to && filters.date_from > filters.date_to
      ? "The ‘From’ date is after the ‘To’ date."
      : null;

  // Auto-grow the textarea up to a limit.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  useEffect(() => {
    if (!busy) taRef.current?.focus();
  }, [busy, focusKey]);

  const canSend = !busy && text.trim().length > 0 && !dateError;

  const submit = () => {
    if (!canSend) return;
    onSend(text.trim());
    setText("");
  };

  const set = (patch: Partial<ChatFilters>) => {
    const next = { ...filters, ...patch };
    for (const k of Object.keys(next) as (keyof ChatFilters)[]) if (!next[k]) delete next[k];
    onFiltersChange(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          aria-controls={`${ids}-filters`}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <SlidersHorizontal className="size-4" aria-hidden />
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </button>
        {!showFilters && activeCount > 0 && (
          <span className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {[
              filters.company,
              filters.body,
              filters.date_from || filters.date_to
                ? `${filters.date_from ?? "…"} → ${filters.date_to ?? "…"}`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        {activeCount > 0 && (
          <button
            type="button"
            onClick={() => onFiltersChange({})}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-200/70 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            <X className="size-3.5" aria-hidden /> Clear filters
          </button>
        )}
      </div>

      {showFilters && (
        <fieldset
          id={`${ids}-filters`}
          className="grid grid-cols-2 gap-2 rounded-lg border border-zinc-200 bg-white p-3 sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <legend className="sr-only">Limit the search</legend>
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span>Company</span>
            <select
              className={fieldCls}
              value={filters.company ?? ""}
              onChange={(e) => {
                const company = e.target.value || undefined;
                const keepBody =
                  filters.body && scopes.some((s) => s.company === company && s.body === filters.body);
                set({ company, body: company && !keepBody ? undefined : filters.body });
              }}
            >
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span>Meeting body</span>
            <select className={fieldCls} value={filters.body ?? ""} onChange={(e) => set({ body: e.target.value })}>
              <option value="">All bodies</option>
              {bodies.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span>From</span>
            <input
              type="date"
              className={fieldCls}
              value={filters.date_from ?? ""}
              max={filters.date_to}
              onChange={(e) => set({ date_from: e.target.value })}
            />
          </label>
          <label className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span>To</span>
            <input
              type="date"
              className={fieldCls}
              value={filters.date_to ?? ""}
              min={filters.date_from}
              onChange={(e) => set({ date_to: e.target.value })}
            />
          </label>
          {dateError && (
            <p role="alert" className="col-span-full text-xs text-red-700 dark:text-red-400">
              {dateError}
            </p>
          )}
        </fieldset>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 rounded-xl border border-zinc-300 bg-white p-2 shadow-sm focus-within:border-accent-500 focus-within:ring-2 focus-within:ring-accent-500/20 dark:border-zinc-700 dark:bg-zinc-900"
      >
        <label htmlFor={`${ids}-q`} className="sr-only">
          Ask a question about the minutes
        </label>
        <textarea
          id={`${ids}-q`}
          ref={taRef}
          rows={1}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? "Answering…" : "Ask about the minutes…  (Enter to send, Shift+Enter for a new line)"}
          className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-[15px] placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{ outline: "none" }}
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-zinc-800 text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-zinc-300"
            aria-label="Stop answering"
            title="Stop"
          >
            <Square className="size-4 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canSend}
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent-600 text-white hover:bg-accent-700 disabled:cursor-not-allowed disabled:bg-zinc-300 dark:bg-accent-500 dark:hover:bg-accent-600 dark:disabled:bg-zinc-700"
            aria-label="Send question"
            title="Send"
          >
            <ArrowUp className="size-5" aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}
