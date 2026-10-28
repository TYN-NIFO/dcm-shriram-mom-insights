"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import Composer from "./Composer";
import MessageView from "./MessageView";
import Sidebar from "./Sidebar";
import SourcePanel from "./SourcePanel";
import TopBar, { ScopeStrip } from "./TopBar";
import {
  ApiError,
  deleteConversation,
  friendlyError,
  getConversation,
  getMe,
  listConversations,
  streamChat,
} from "@/lib/api";
import type { ChatFilters, ChatMessage, ConversationSummary, Me, Source } from "@/lib/types";

let localSeq = 0;
const localId = (p: string) => `${p}_local_${Date.now().toString(36)}_${(localSeq++).toString(36)}`;

export default function ChatApp() {
  const [me, setMe] = useState<Me | null>(null);
  const [meError, setMeError] = useState<{ message: string; status?: number } | null>(null);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<string | null>(null);
  const loadSeq = useRef(0);

  const [filters, setFilters] = useState<ChatFilters>({});
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const [openSource, setOpenSource] = useState<Source | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const setActive = (id: string | null) => {
    activeIdRef.current = id;
    setActiveId(id);
  };

  // ---- loading ---------------------------------------------------------
  const loadMe = useCallback(async () => {
    setMeError(null);
    try {
      setMe(await getMe());
    } catch (e) {
      setMeError({ message: friendlyError(e), status: e instanceof ApiError ? e.status : undefined });
    }
  }, []);

  const refreshList = useCallback(async () => {
    try {
      setConversations(await listConversations());
      setListError(null);
    } catch (e) {
      setListError(friendlyError(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMe();
    void refreshList();
  }, [loadMe, refreshList]);

  // ---- conversation actions -------------------------------------------
  const stop = useCallback(() => abortRef.current?.abort(), []);

  const newChat = () => {
    stop();
    loadSeq.current++;
    setActive(null);
    setMessages([]);
    setConvError(null);
    setConvLoading(false);
    setOpenSource(null);
    setSidebarOpen(false);
  };

  const selectConversation = async (id: string) => {
    setSidebarOpen(false);
    if (id === activeIdRef.current && !convError) return;
    stop();
    const seq = ++loadSeq.current;
    setActive(id);
    setMessages([]);
    setOpenSource(null);
    setConvError(null);
    setConvLoading(true);
    try {
      const c = await getConversation(id);
      if (seq !== loadSeq.current) return;
      setMessages(c.messages.map((m) => ({ ...m, status: "done" })));
      stickToBottom.current = true;
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setConvError(friendlyError(e));
    } finally {
      if (seq === loadSeq.current) setConvLoading(false);
    }
  };

  const removeConversation = async (id: string) => {
    try {
      await deleteConversation(id);
      setConversations((cs) => cs.filter((c) => c.id !== id));
      if (id === activeIdRef.current) newChat();
    } catch (e) {
      setListError(friendlyError(e));
    }
  };

  const updateMsg = (id: string, patch: (m: ChatMessage) => Partial<ChatMessage>) =>
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch(m) } : m)));

  const send = async (question: string) => {
    if (busy) return;
    const now = new Date().toISOString();
    const userMsg: ChatMessage = { id: localId("u"), role: "user", content: question, created_at: now };
    const asstId = localId("a");
    const asstMsg: ChatMessage = {
      id: asstId,
      role: "assistant",
      content: "",
      created_at: now,
      status: "streaming",
    };
    setMessages((ms) => [...ms, userMsg, asstMsg]);
    stickToBottom.current = true;
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const seq = loadSeq.current;
    const live = () => seq === loadSeq.current; // ignore events after the user switched chats

    let gotDone = false;
    try {
      await streamChat(
        // Always send the current conversation id so the backend can use earlier turns.
        { conversation_id: activeIdRef.current, question, filters },
        {
          onMeta: ({ conversation_id }) => {
            if (live() && conversation_id) setActive(conversation_id);
          },
          onToken: (t) => live() && updateMsg(asstId, (m) => ({ content: m.content + t })),
          onSources: (s) => live() && updateMsg(asstId, () => ({ sources: s })),
          onDone: ({ found }) => {
            gotDone = true;
            if (live()) updateMsg(asstId, () => ({ found, status: "done" }));
          },
          onError: (message) =>
            live() &&
            updateMsg(asstId, () => ({
              status: "error",
              error: message || "The answer could not be completed. Please try again.",
            })),
        },
        ctrl.signal,
      );
      if (!gotDone && live())
        updateMsg(asstId, (m) =>
          m.status === "streaming"
            ? { status: "error", error: "The answer was cut off. Please try again." }
            : {},
        );
    } catch (e) {
      if (live()) {
        if (ctrl.signal.aborted) updateMsg(asstId, () => ({ status: "stopped" }));
        else updateMsg(asstId, () => ({ status: "error", error: friendlyError(e) }));
      }
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
      setBusy(false);
      void refreshList();
    }
  };

  // ---- scrolling -------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const closeSource = useCallback(() => setOpenSource(null), []);

  // ---- render ----------------------------------------------------------
  const empty = !convLoading && !convError && messages.length === 0;
  const composer = (hero: boolean) => (
    <Composer
      scopes={me?.scopes ?? []}
      filters={filters}
      onFiltersChange={setFilters}
      busy={busy}
      onSend={send}
      onStop={stop}
      focusKey={activeId}
      hero={hero}
    />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-950 md:p-3">
      <a
        href="#question"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to question
      </a>
      <Sidebar
        conversations={conversations}
        activeId={activeId}
        loading={listLoading}
        error={listError}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={newChat}
        onSelect={selectConversation}
        onDelete={removeConversation}
      />

      <div className="flex min-w-0 flex-1 flex-col bg-[#f7f7f7] md:rounded-3xl dark:bg-zinc-900">
        <TopBar me={me} onOpenSidebar={() => setSidebarOpen(true)} title="Ask the minutes" />
        <ScopeStrip me={me} />

        {meError && (
          <div
            role="alert"
            className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900 sm:mx-6 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="flex-1">
              {meError.status === 403
                ? "You don't have access to MoM Insights. Contact the Company Secretary's office if you need access."
                : `Couldn't load your profile and access scope. ${meError.message}`}
            </span>
            <button
              type="button"
              onClick={() => void loadMe()}
              className="inline-flex items-center gap-1 rounded px-2 py-0.5 font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40"
            >
              <RefreshCw className="size-3.5" aria-hidden /> Retry
            </button>
          </div>
        )}

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6">
                {convLoading && (
                  <p role="status" className="text-center text-sm text-zinc-500">
                    Loading conversation…
                  </p>
                )}
                {convError && (
                  <p role="alert" className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
                    {convError}
                  </p>
                )}
                {empty && (
                  <EmptyState name={me?.name} disabled={busy} onPick={send}>
                    <div id="question">{composer(true)}</div>
                  </EmptyState>
                )}
                <div className="space-y-6" aria-live="polite" aria-relevant="additions">
                  {messages.map((m) => (
                    <div key={m.id} className="animate-rise">
                      <MessageView
                        message={m}
                        selectedSourceId={openSource?.id ?? null}
                        onOpenSource={setOpenSource}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {!empty && (
              <div id="question" className="shrink-0 bg-gradient-to-t from-[#f7f7f7] via-[#f7f7f7] to-transparent dark:from-zinc-900 dark:via-zinc-900">
                <div className="mx-auto w-full max-w-3xl px-3 pt-1 pb-3 sm:px-6">
                  {composer(false)}
                  <p className="mt-2 text-center text-xs text-zinc-500 dark:text-zinc-400">
                    Answers come only from the minutes. Always check the cited page.
                  </p>
                </div>
              </div>
            )}
          </main>

          {openSource && <SourcePanel source={openSource} onClose={closeSource} />}
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  name,
  onPick,
  disabled,
  children,
}: {
  name?: string;
  onPick: (q: string) => void;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const first = name?.split(" ")[0];
  return (
    <div className="py-6 sm:py-14">
      <div className="text-center">
        <h2 className="animate-rise text-3xl font-semibold tracking-tight sm:text-5xl">
          {first ? `Hello, ${first}` : "Hello"}
        </h2>
        <p
          className="animate-rise text-shimmer mt-1 text-2xl font-semibold tracking-tight sm:text-4xl"
          style={{ animationDelay: "90ms" }}
        >
          Let’s explore your Board minutes.
        </p>
        <p className="animate-rise mx-auto mt-4 max-w-xl text-sm text-zinc-500 sm:text-[15px] dark:text-zinc-400" style={{ animationDelay: "180ms" }}>
          Ask in plain language. Every answer cites the meeting, item and minute-book page, so you can check the signed original.
        </p>
      </div>

      <div className="animate-rise mt-8" style={{ animationDelay: "260ms" }}>
        {children}
      </div>

      <ul className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="Example questions">
        {TOPICS.map(({ title, text, question }, i) => (
          <li key={title} className="animate-rise" style={{ animationDelay: `${340 + i * 80}ms` }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(question)}
              className="group flex h-full w-full flex-col items-start rounded-2xl border border-transparent bg-white p-4 text-left shadow-sm transition duration-200 hover:-translate-y-1 hover:border-gold-400 hover:shadow-lg disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-800/70 dark:hover:border-accent-400/60 dark:hover:bg-zinc-800"
            >
              <span className="text-[15px] font-semibold">{title}</span>
              <span className="mt-1 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{text}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const TOPICS = [
  {
    title: "Dividends & capital",
    text: "What the Board recommended, the record dates and the amounts.",
    question: "What dividend did the Board recommend last year?",
  },
  {
    title: "People & governance",
    text: "Appointments, committee changes and who chairs what.",
    question: "Who was appointed as an independent director, and when?",
  },
  {
    title: "Limits & approvals",
    text: "Borrowing limits, capex and investment approvals over time.",
    question: "List the borrowing limits approved by the Board since 2022.",
  },
];
