"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowUpRight,
  FileSearch,
  MessageSquare,
  PanelLeft,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { relativeDay } from "@/lib/format";
import type { ConversationSummary } from "@/lib/types";

interface Props {
  conversations: ConversationSummary[];
  activeId: string | null;
  loading: boolean;
  error: string | null;
  open: boolean;
  onClose: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

const row = (active = false) =>
  `flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
    active ? "bg-white/10 font-medium text-white" : "text-zinc-300 hover:bg-white/5 hover:text-white"
  }`;

const ICON = "size-[18px] shrink-0";
const STROKE = 1.75;

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="grid h-5 min-w-5 place-items-center rounded bg-white/10 px-1 text-[11px] font-medium text-zinc-300">
      {children}
    </kbd>
  );
}

export default function Sidebar({
  conversations,
  activeId,
  loading,
  error,
  open,
  onClose,
  onNew,
  onSelect,
  onDelete,
}: Props) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false); // desktop icon rail
  const pathname = usePathname();
  const onCheck = pathname.startsWith("/check");

  // Ctrl/Cmd + K starts a new chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onNew();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNew]);

  const q = query.trim().toLowerCase();
  const shown = q ? conversations.filter((c) => c.title.toLowerCase().includes(q)) : conversations;
  /** Hidden on desktop when the sidebar is collapsed to its icon rail. */
  const hc = collapsed ? "md:hidden" : "";
  const railRow = collapsed ? "md:justify-center md:px-0" : "";

  return (
    <>
      {open && <div className="fixed inset-0 z-30 bg-black/50 md:hidden" onClick={onClose} aria-hidden />}
      <nav
        aria-label="Main"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-zinc-950 px-3 pt-4 pb-3 text-zinc-200 transition-[transform,width] duration-300 md:static md:z-auto md:translate-x-0 ${
          collapsed ? "md:w-[4.75rem]" : "md:w-72"
        } ${open ? "translate-x-0" : "invisible -translate-x-full md:visible"}`}
      >
        <div className={`flex items-center gap-2.5 px-2 pb-4 ${collapsed ? "md:flex-col md:gap-3 md:px-0" : ""}`}>
          {/* DCM Shriram's own logo (white, for dark backgrounds) from dcmshriram.com; the diamond mark when collapsed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/dcm-shriram-logo-white.svg" alt="DCM Shriram" className={`h-12 w-auto shrink-0 ${hc}`} />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/dcm-shriram-mark.png"
            alt="DCM Shriram"
            className={`size-10 shrink-0 ${collapsed ? "hidden md:block" : "hidden"}`}
          />
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="hidden rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white md:block"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-pressed={collapsed}
          >
            <PanelLeft className={ICON} strokeWidth={STROKE} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 md:hidden"
            aria-label="Close menu"
          >
            <X className="size-5" strokeWidth={STROKE} aria-hidden />
          </button>
        </div>

        <button
          type="button"
          onClick={onNew}
          title="New chat (Ctrl K)"
          className={`flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 active:scale-[0.98] ${railRow}`}
        >
          <SquarePen className={ICON} strokeWidth={STROKE} aria-hidden />
          <span className={`flex-1 text-left ${hc}`}>New chat</span>
          <span className={`flex gap-1 ${hc}`} aria-hidden>
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>

        <ul className="mt-2 space-y-0.5">
          <li>
            <label className={`${row()} cursor-text focus-within:bg-white/5 ${railRow}`}>
              <Search className={ICON} strokeWidth={STROKE} aria-hidden />
              <span className="sr-only">Search chats</span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chat"
                className={`w-full bg-transparent placeholder:text-zinc-300 focus:outline-none ${hc}`}
                style={{ outline: "none" }}
              />
            </label>
          </li>
          <li>
            <Link
              href="/"
              onClick={onClose}
              title="Ask the minutes"
              aria-current={!onCheck ? "page" : undefined}
              className={`${row(!onCheck)} ${railRow}`}
            >
              <MessageSquare className={ICON} strokeWidth={STROKE} aria-hidden />
              <span className={hc}>Ask the minutes</span>
            </Link>
          </li>
          <li>
            <Link
              href="/check"
              onClick={onClose}
              title="Check a draft"
              aria-current={onCheck ? "page" : undefined}
              className={`${row(onCheck)} ${railRow}`}
            >
              <FileSearch className={ICON} strokeWidth={STROKE} aria-hidden />
              <span className={hc}>Check a draft</span>
            </Link>
          </li>
        </ul>

        <div className={`flex min-h-0 flex-1 flex-col ${hc}`}>
          {!onCheck ? (
            <>
              <h2 className="px-3 pt-6 pb-2 text-sm text-zinc-500">Recent</h2>
              <div className="scroll-dark min-h-0 flex-1 overflow-y-auto">
                {loading && <p className="px-3 py-2 text-sm text-zinc-500">Loading…</p>}
                {error && (
                  <p role="alert" className="px-3 py-2 text-sm text-red-400">
                    {error}
                  </p>
                )}
                {!loading && !error && shown.length === 0 && (
                  <p className="px-3 py-2 text-sm text-zinc-500">{q ? "No matching chats." : "No conversations yet."}</p>
                )}
                <ul className="space-y-0.5">
                  {shown.map((c, i) => {
                    const active = c.id === activeId;
                    const confirming = confirmId === c.id;
                    return (
                      <li key={c.id} className="group animate-rise relative" style={{ animationDelay: `${i * 40}ms` }}>
                        {confirming ? (
                          <div
                            className="flex items-center gap-2 rounded-xl bg-red-950/60 px-3 py-2 text-sm"
                            role="group"
                            aria-label={`Delete “${c.title}”?`}
                          >
                            <span className="flex-1 truncate text-red-300">Delete chat?</span>
                            <button
                              type="button"
                              autoFocus
                              onClick={() => {
                                setConfirmId(null);
                                onDelete(c.id);
                              }}
                              className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-500"
                            >
                              Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(null)}
                              className="rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/10"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onSelect(c.id)}
                              aria-current={active ? "true" : undefined}
                              className={`block w-full rounded-xl py-2 pr-9 pl-3 text-left text-sm transition-colors ${
                                active ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5 hover:text-white"
                              }`}
                            >
                              <span className="block truncate">{c.title}</span>
                              <span className="block text-xs text-zinc-500">{relativeDay(c.updated_at)}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmId(c.id)}
                              className="absolute top-2 right-2 rounded-md p-1.5 text-zinc-500 hover:bg-white/10 hover:text-red-400 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
                              aria-label={`Delete conversation “${c.title}”`}
                            >
                              <Trash2 className="size-4" strokeWidth={STROKE} aria-hidden />
                            </button>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          ) : (
            <div className="flex-1" />
          )}

          <div className="mt-3 rounded-2xl bg-white/5 p-4">
            <p className="text-[15px] font-medium text-white">{onCheck ? "Back to the minutes" : "Check a draft"}</p>
            <p className="mt-1.5 text-sm leading-snug text-zinc-400">
              {onCheck
                ? "Ask a question and open the cited minute-book page."
                : "Test a draft agenda or resolution against past Board decisions and limits."}
            </p>
            <Link
              href={onCheck ? "/" : "/check"}
              onClick={onClose}
              className="mt-4 flex items-center justify-center gap-2 rounded-xl bg-gold-400 px-3 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-gold-300 active:scale-[0.98]"
            >
              <ArrowUpRight className={ICON} strokeWidth={2} aria-hidden /> {onCheck ? "Ask the minutes" : "Try it"}
            </Link>
          </div>
        </div>

      
      </nav>
    </>
  );
}
