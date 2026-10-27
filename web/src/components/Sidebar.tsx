"use client";

import { useState } from "react";
import { Clock, MessageSquare, Plus, Trash2, X } from "lucide-react";
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

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} aria-hidden />
      )}
      <nav
        aria-label="Conversations"
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-200 bg-zinc-100 transition-transform md:static md:z-auto md:translate-x-0 dark:border-zinc-800 dark:bg-zinc-900/60 ${
          open ? "translate-x-0" : "invisible -translate-x-full md:visible"
        }`}
      >
        <div className="flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={onNew}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent-600 px-3 py-2 text-sm font-medium text-white hover:bg-accent-700 dark:bg-accent-500 dark:hover:bg-accent-600"
          >
            <Plus className="size-4" aria-hidden /> New chat
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-zinc-600 hover:bg-zinc-200 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
            aria-label="Close conversation list"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <h2 className="px-4 pt-1 pb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
          Last 7 days
        </h2>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {loading && <p className="px-2 py-2 text-sm text-zinc-500">Loading…</p>}
          {error && (
            <p role="alert" className="px-2 py-2 text-sm text-red-700 dark:text-red-400">
              {error}
            </p>
          )}
          {!loading && !error && conversations.length === 0 && (
            <p className="px-2 py-2 text-sm text-zinc-500 dark:text-zinc-400">No conversations yet.</p>
          )}
          <ul className="space-y-0.5">
            {conversations.map((c) => {
              const active = c.id === activeId;
              const confirming = confirmId === c.id;
              return (
                <li key={c.id} className="group relative">
                  {confirming ? (
                    <div
                      className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-2 text-sm dark:bg-red-950/40"
                      role="group"
                      aria-label={`Delete “${c.title}”?`}
                    >
                      <span className="flex-1 truncate text-red-800 dark:text-red-300">Delete chat?</span>
                      <button
                        type="button"
                        autoFocus
                        onClick={() => {
                          setConfirmId(null);
                          onDelete(c.id);
                        }}
                        className="rounded px-2 py-0.5 text-xs font-medium text-white bg-red-700 hover:bg-red-800"
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(null)}
                        className="rounded px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-200 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
                        className={`flex w-full items-start gap-2 rounded-lg py-2 pr-9 pl-2.5 text-left text-sm ${
                          active
                            ? "bg-white font-medium shadow-sm dark:bg-zinc-800"
                            : "text-zinc-700 hover:bg-zinc-200/70 dark:text-zinc-300 dark:hover:bg-zinc-800/60"
                        }`}
                      >
                        <MessageSquare className="mt-0.5 size-4 shrink-0 text-zinc-400" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate">{c.title}</span>
                          <span className="block text-xs font-normal text-zinc-500 dark:text-zinc-400">
                            {relativeDay(c.updated_at)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(c.id)}
                        className="absolute top-1.5 right-1.5 rounded-md p-1.5 text-zinc-400 opacity-100 hover:bg-zinc-200 hover:text-red-700 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-zinc-700 dark:hover:text-red-400"
                        aria-label={`Delete conversation “${c.title}”`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <p className="flex items-center gap-1.5 border-t border-zinc-200 px-4 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <Clock className="size-3.5" aria-hidden /> Chat history is kept for 7 days
        </p>
      </nav>
    </>
  );
}
