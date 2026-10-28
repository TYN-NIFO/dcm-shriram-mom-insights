"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowUp, Plus, Square, X } from "lucide-react";
import type { ChatFilters, Scope } from "@/lib/types";

interface Props {
  scopes: Scope[];
  filters: ChatFilters;
  onFiltersChange: (f: ChatFilters) => void;
  busy: boolean;
  onSend: (question: string) => void;
  onStop: () => void;
  focusKey: unknown; // changes when the input should regain focus
  /** Larger card used on the landing screen. */
  hero?: boolean;
}

const fieldCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900";

export default function Composer({ scopes, filters, onFiltersChange, busy, onSend, onStop, focusKey, hero = false }: Props) {
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
    ta.style.height = `${Math.min(ta.scrollHeight, 220)}px`;
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
      {showFilters && (
        <fieldset
          id={`${ids}-filters`}
          className="animate-rise grid grid-cols-2 gap-2 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm sm:grid-cols-4 dark:border-zinc-800 dark:bg-zinc-900"
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

      <div className="spin-border rounded-3xl shadow-sm transition-shadow focus-within:shadow-lg focus-within:shadow-gold-400/20 hover:shadow-md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className={`flex flex-col rounded-[calc(1.5rem-2px)] bg-white p-3 ${hero ? "min-h-[9.5rem]" : ""}`}
      >
        <label htmlFor={`${ids}-q`} className="sr-only">
          Ask a question about the minutes
        </label>
        <textarea
          id={`${ids}-q`}
          ref={taRef}
          rows={hero ? 2 : 1}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={busy ? "Answering…" : "Ask about the minutes…"}
          className="max-h-[220px] min-h-[40px] w-full flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] placeholder:text-zinc-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
          style={{ outline: "none" }}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls={`${ids}-filters`}
            aria-label="Filters"
            title="Filters: company, meeting body, dates"
            className={`group inline-flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm transition-colors ${
              showFilters || activeCount > 0
                ? "bg-gold-400/30 text-zinc-900"
                : "bg-[#f4f4f4] text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            }`}
          >
            <Plus className={`size-4 transition-transform duration-300 ${showFilters ? "rotate-45" : "group-hover:rotate-90"}`} aria-hidden />
            <span className="hidden sm:inline">Filters{activeCount > 0 ? ` (${activeCount})` : ""}</span>
          </button>
          {activeCount > 0 && (
            <>
              <span className="min-w-0 flex-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
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
              <button
                type="button"
                onClick={() => onFiltersChange({})}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                <X className="size-3.5" aria-hidden /> Clear
              </button>
            </>
          )}
          <span className="flex-1" />
          <span className="hidden text-xs text-zinc-400 sm:inline">Enter to send · Shift+Enter for new line</span>
          {busy ? (
            <button
              type="button"
              onClick={onStop}
              className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-900 text-white transition hover:bg-zinc-700 active:scale-95 dark:bg-zinc-200 dark:text-zinc-900"
              aria-label="Stop answering"
              title="Stop"
            >
              <Square className="size-4 fill-current" aria-hidden />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!canSend}
              className="group grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-900 text-white transition hover:-translate-y-0.5 hover:bg-gold-400 hover:text-zinc-950 active:scale-95 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 dark:bg-gold-400 dark:text-zinc-950 dark:hover:bg-gold-300 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-600"
              aria-label="Send question"
              title="Send"
            >
              <ArrowUp className="size-5 transition-transform duration-300 group-hover:rotate-45" aria-hidden />
            </button>
          )}
        </div>
      </form>
      </div>
    </div>
  );
}
