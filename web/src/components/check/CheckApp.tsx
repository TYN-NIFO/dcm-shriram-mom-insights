"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { AlertCircle, FileSearch, FileText, Loader2, RotateCcw, Square, Upload, X } from "lucide-react";
import { useRouter } from "next/navigation";
import SourcePanel from "../SourcePanel";
import Sidebar from "../Sidebar";
import TopBar from "../TopBar";
import CheckResultCard from "./CheckResultCard";
import { STATUS, sortBySeverity } from "./status";
import {
  ApiError,
  CHECK_EXTENSIONS,
  CHECK_MAX_BYTES,
  friendlyError,
  getMe,
  streamCheck,
} from "@/lib/api";
import {
  CHECK_STATUS_ORDER,
  type CheckItem,
  type CheckMeta,
  type CheckStatus,
  type CheckSummary,
  type Me,
  type Source,
} from "@/lib/types";

const primaryBtn =
  "inline-flex items-center gap-2 rounded-xl bg-gold-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:bg-gold-300 hover:shadow-md active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none";
const secondaryBtn =
  "inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium transition duration-200 hover:border-zinc-950 active:scale-95";

type Mode = "file" | "text";
type Phase = "input" | "running" | "done" | "error";

const NOTE =
  "Each proposed item is checked against past Board decisions and approved limits recorded in the minutes. " +
  "Results are flags for review, not a legal or compliance opinion.";

const ACCEPT = [
  ...CHECK_EXTENSIONS,
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/tiff",
  "text/plain",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Returns an error message, or null if the file can be sent. */
function validateFile(f: File): string | null {
  const name = f.name.toLowerCase();
  if (!CHECK_EXTENSIONS.some((ext) => name.endsWith(ext)))
    return "Only Word (.docx), PDF, image (PNG, JPG, TIFF) and .txt files can be checked.";
  if (f.size > CHECK_MAX_BYTES) return `This file is ${formatBytes(f.size)}. The limit is 10 MB.`;
  if (f.size === 0) return "This file is empty.";
  return null;
}

function checkError(e: unknown): string {
  // 400 carries a specific reason (e.g. unreadable file, no proposals found): show it.
  if (e instanceof ApiError && e.status === 400 && e.message) return e.message;
  if (e instanceof ApiError && e.status === 413) return "This file is too large. The limit is 10 MB.";
  return friendlyError(e);
}

export default function CheckApp() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    getMe()
      .then(setMe)
      .catch(() => {
        /* the top bar just shows a placeholder; the check itself reports its own errors */
      });
  }, []);

  const [mode, setMode] = useState<Mode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const [phase, setPhase] = useState<Phase>("input");
  const [meta, setMeta] = useState<CheckMeta | null>(null);
  const [items, setItems] = useState<CheckItem[]>([]);
  const [summary, setSummary] = useState<CheckSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentName, setSentName] = useState<string>("");

  const [openSource, setOpenSource] = useState<Source | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runSeq = useRef(0); // bumped on reset so a cancelled run cannot update the screen
  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultsHeadingRef = useRef<HTMLHeadingElement>(null);
  const ids = useId();

  useEffect(() => () => abortRef.current?.abort(), []);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    const err = validateFile(f);
    setFileError(err);
    setFile(err ? null : f);
  };

  const canCheck =
    phase !== "running" && (mode === "file" ? file !== null : text.trim().length > 0);

  const run = async () => {
    if (!canCheck) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const seq = ++runSeq.current;
    const live = () => seq === runSeq.current;
    setPhase("running");
    setMeta(null);
    setItems([]);
    setSummary(null);
    setError(null);
    setOpenSource(null);
    setSentName(mode === "file" && file ? file.name : "Pasted draft");

    let finished = false;
    let streamError: string | null = null;
    try {
      await streamCheck(
        mode === "file" && file ? { file } : { text: text.trim() },
        {
          onMeta: (m) => live() && setMeta(m),
          onItem: (it) =>
            live() &&
            setItems((xs) => [
              ...xs,
              { ...it, governing: it.governing ?? [], superseded: it.superseded ?? [] },
            ]),
          onDone: ({ summary: s }) => {
            finished = true;
            if (live()) setSummary(s ?? null);
          },
          onError: (message) => {
            streamError = message || "The check could not be completed. Please try again.";
          },
        },
        ctrl.signal,
      );
      if (!live()) return;
      if (streamError) {
        setError(streamError);
        setPhase("error");
      } else if (!finished) {
        setError("The check was cut off before it finished. Please try again.");
        setPhase("error");
      } else {
        setPhase("done");
      }
    } catch (e) {
      if (!live()) return;
      if (ctrl.signal.aborted) {
        setError("Check cancelled. Results so far are shown below.");
      } else {
        setError(checkError(e));
      }
      setPhase("error");
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  };

  const cancel = () => abortRef.current?.abort();

  const reset = () => {
    runSeq.current++;
    abortRef.current?.abort();
    setPhase("input");
    setMeta(null);
    setItems([]);
    setSummary(null);
    setError(null);
    setOpenSource(null);
    setFile(null);
    setFileError(null);
    setText("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Move focus to the results heading when a check finishes, for keyboard / screen-reader users.
  useEffect(() => {
    if (phase === "done") resultsHeadingRef.current?.focus();
  }, [phase]);

  const sorted = useMemo(() => sortBySeverity(items), [items]);

  // Counts: use the server summary once done, otherwise count what has arrived.
  const counts = useMemo<CheckSummary>(() => {
    const c = Object.fromEntries(CHECK_STATUS_ORDER.map((s) => [s, 0])) as CheckSummary;
    if (summary) {
      for (const s of CHECK_STATUS_ORDER) c[s] = summary[s] ?? 0;
      return c;
    }
    for (const it of items) if (it.status in c) c[it.status as CheckStatus] += 1;
    return c;
  }, [items, summary]);

  // Proposals announced in `meta` that have no result yet.
  const pending = useMemo(() => {
    if (!meta || phase !== "running") return [];
    const left = [...meta.proposals];
    for (const it of items) {
      const i = left.indexOf(it.proposal);
      if (i !== -1) left.splice(i, 1);
      else left.pop(); // text differs slightly: still one fewer outstanding
    }
    return left;
  }, [meta, items, phase]);

  const closeSource = useCallback(() => setOpenSource(null), []);

  const total = meta?.items_found ?? 0;
  const showResults = phase !== "input";

  return (
    <div className="flex h-dvh overflow-hidden bg-zinc-950 md:p-3">
      <a
        href="#check-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>
      <Sidebar
        conversations={[]}
        activeId={null}
        loading={false}
        error={null}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onNew={() => router.push("/")}
        onSelect={() => {}}
        onDelete={() => {}}
      />
      <div className="flex min-w-0 flex-1 flex-col bg-[#f7f7f7] md:rounded-3xl dark:bg-zinc-900">
        <TopBar me={me} onOpenSidebar={() => setSidebarOpen(true)} title="Check a draft" />

        <div className="flex min-h-0 flex-1">
          <main id="check-main" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-6">
              {!showResults && (
                <div className="text-center">
                  <h2 className="animate-rise text-3xl font-semibold tracking-tight sm:text-5xl">Check a draft</h2>
                  <p
                    className="animate-rise text-shimmer mt-1 text-2xl font-semibold tracking-tight sm:text-4xl"
                    style={{ animationDelay: "90ms" }}
                  >
                    before it reaches the Board.
                  </p>
                  <p
                    className="animate-rise mx-auto mt-4 max-w-xl text-sm text-zinc-500 sm:text-[15px]"
                    style={{ animationDelay: "180ms" }}
                  >
                    {NOTE}
                  </p>
                </div>
              )}

              {!showResults && (
                <form
                  className="animate-rise mt-8 space-y-4 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"
                  style={{ animationDelay: "260ms" }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run();
                  }}
                >
                  <div
                    role="radiogroup"
                    aria-label="How to provide the draft"
                    className="inline-flex rounded-xl bg-[#f4f4f4] p-1"
                  >
                    {(
                      [
                        { m: "file", label: "Upload a file" },
                        { m: "text", label: "Paste text" },
                      ] as const
                    ).map(({ m, label }) => (
                      <button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={mode === m}
                        onClick={() => setMode(m)}
                        className={`rounded-lg px-4 py-1.5 text-sm transition ${
                          mode === m
                            ? "bg-gold-400 font-semibold text-zinc-950 shadow-sm"
                            : "text-zinc-600 hover:text-zinc-950"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  {mode === "file" ? (
                    <div>
                      <label
                        htmlFor={`${ids}-file`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDragOver(true);
                        }}
                        onDragLeave={() => setDragOver(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDragOver(false);
                          pickFile(e.dataTransfer.files?.[0]);
                        }}
                        className={`group flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-12 text-center transition duration-200 focus-within:border-gold-500 ${
                          dragOver
                            ? "scale-[1.01] border-gold-500 bg-gold-400/20"
                            : "border-zinc-300 bg-[#fafafa] hover:border-gold-500 hover:bg-gold-400/10"
                        }`}
                      >
                        <span className="upload-badge grid size-12 place-items-center rounded-full bg-zinc-950 text-gold-400 transition-transform duration-200 group-hover:-translate-y-1">
                          <Upload className="size-6" aria-hidden />
                        </span>
                        <span className="mt-1 text-[15px] font-medium">
                          Drop the draft agenda or resolution here, or{" "}
                          <span className="font-semibold underline decoration-gold-500 decoration-2 underline-offset-4">
                            choose a file
                          </span>
                        </span>
                        <span className="text-xs text-zinc-500">
                          .docx, .pdf (incl. scanned), image or .txt · up to 10 MB
                        </span>
                        <input
                          ref={fileInputRef}
                          id={`${ids}-file`}
                          type="file"
                          accept={ACCEPT}
                          className="sr-only"
                          aria-describedby={fileError ? `${ids}-file-err` : undefined}
                          onChange={(e) => pickFile(e.target.files?.[0])}
                        />
                      </label>
                      {file && (
                        <div className="animate-rise mt-3 flex items-center gap-3 rounded-xl border border-gold-400 bg-gold-400/10 px-3 py-2.5 text-sm">
                          <FileText className="size-5 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                          <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{formatBytes(file.size)}</span>
                          <button
                            type="button"
                            onClick={() => {
                              setFile(null);
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="rounded-lg p-1.5 text-zinc-600 transition hover:bg-zinc-950 hover:text-white"
                            aria-label={`Remove ${file.name}`}
                          >
                            <X className="size-4" aria-hidden />
                          </button>
                        </div>
                      )}
                      {fileError && (
                        <p id={`${ids}-file-err`} role="alert" className="mt-2 text-sm text-red-700">
                          {fileError}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div>
                      <label htmlFor={`${ids}-text`} className="mb-1.5 block text-sm font-medium">
                        Draft agenda or resolution text
                      </label>
                      <textarea
                        id={`${ids}-text`}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        rows={12}
                        placeholder={"Paste the draft here, e.g.\n\nItem 5: To approve borrowing of Rs. 400 crore from Sample Bank Ltd…"}
                        className="w-full resize-y rounded-2xl border border-zinc-300 bg-[#fafafa] px-4 py-3 text-[15px] transition placeholder:text-zinc-400 focus:border-gold-500 focus:bg-white focus:shadow-lg focus:shadow-gold-400/20 focus:outline-none"
                      />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <button type="submit" disabled={!canCheck} className={primaryBtn}>
                      <FileSearch className="size-4" aria-hidden />
                      Check draft
                    </button>
                    <span className="text-xs text-zinc-500">
                      {mode === "file" ? (file ? "Ready to check." : "Add a file to continue.") : "Paste your draft to continue."}
                    </span>
                  </div>
                </form>
              )}

           

              {showResults && (
                <section aria-labelledby={`${ids}-results`}>
                  <div className="animate-rise flex flex-wrap items-center gap-3 rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-zinc-950 text-gold-400">
                      <FileText className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-zinc-500">
                        {phase === "running" ? "Checking" : phase === "done" ? "Check complete" : "Check stopped"}
                      </p>
                      <h3
                        id={`${ids}-results`}
                        ref={resultsHeadingRef}
                        tabIndex={-1}
                        className="truncate text-base font-semibold focus:outline-none"
                      >
                        {meta?.document || sentName}
                      </h3>
                    </div>
                    {phase === "running" ? (
                      <button type="button" onClick={cancel} className={secondaryBtn}>
                        <Square className="size-3.5 fill-current" aria-hidden /> Cancel
                      </button>
                    ) : (
                      <button type="button" onClick={reset} className={primaryBtn}>
                        <RotateCcw className="size-4" aria-hidden /> Check another draft
                      </button>
                    )}
                  </div>

                  <Progress phase={phase} meta={meta} done={items.length} total={total} />

                  {meta?.read_with === "ocr" && (
                    <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      This draft is a scanned or image-only file and was read with OCR. Check the amounts and names in
                      the proposed items against the draft.
                    </p>
                  )}

                  {(items.length > 0 || summary) && <SummaryBar counts={counts} />}

                  {error && (
                    <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                      {error}
                    </p>
                  )}

                  {phase === "done" && meta && meta.items_found === 0 && (
                    <p className="mt-4 rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-600">
                      No proposed decisions were found in this draft. Check that it contains agenda items or
                      resolutions (e.g. &ldquo;RESOLVED THAT…&rdquo;).
                    </p>
                  )}

                  <ol className="mt-4 space-y-3" aria-label="Results" aria-live="polite" aria-relevant="additions">
                    {sorted.map((it, i) => (
                      <li key={it.id} className="animate-rise">
                        <CheckResultCard
                          item={it}
                          index={i}
                          selectedSourceId={openSource?.id ?? null}
                          onOpenSource={setOpenSource}
                        />
                      </li>
                    ))}
                  </ol>

                  {pending.length > 0 && (
                    <ul className="mt-3 space-y-2" aria-label="Still checking">
                      {pending.map((p, i) => (
                        <li
                          key={`${i}-${p}`}
                          className="flex items-start gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white px-4 py-3 text-sm text-zinc-500"
                        >
                          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" aria-hidden />
                          <span className="min-w-0">
                            <span className="sr-only">Checking: </span>
                            {p}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {phase !== "running" && items.length > 0 && (
                    <p className="mt-6 text-center text-xs text-zinc-500">{NOTE}</p>
                  )}
                </section>
              )}
            </div>
          </main>

          {openSource && <SourcePanel source={openSource} onClose={closeSource} />}
        </div>
      </div>
    </div>
  );
}

function Progress({
  phase,
  meta,
  done,
  total,
}: {
  phase: Phase;
  meta: CheckMeta | null;
  done: number;
  total: number;
}) {
  if (phase !== "running") return null;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="animate-rise mt-3 rounded-2xl bg-white px-4 py-3 shadow-sm" role="status" aria-live="polite">
      <p className="flex items-center gap-2 text-sm text-zinc-600">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {meta
          ? `Found ${meta.items_found} proposed item${meta.items_found === 1 ? "" : "s"} · checked ${done} of ${total}`
          : "Reading the draft…"}
      </p>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#eef0e6]"
        role="progressbar"
        aria-label="Check progress"
        aria-valuemin={0}
        aria-valuemax={total || undefined}
        aria-valuenow={meta ? done : undefined}
      >
        {meta ? (
          <div className="h-full rounded-full bg-gold-400 transition-[width] duration-500" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-gold-400" />
        )}
      </div>
    </div>
  );
}

function SummaryBar({ counts }: { counts: CheckSummary }) {
  return (
    <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Summary by status">
      {CHECK_STATUS_ORDER.map((s, i) => {
        const st = STATUS[s];
        const n = counts[s] ?? 0;
        return (
          <li
            key={s}
            className={`animate-rise flex items-center gap-3 rounded-2xl border px-3.5 py-3 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${
              n > 0 ? st.chip : "border-zinc-200 bg-white text-zinc-400"
            }`}
            style={{ animationDelay: `${i * 50}ms` }}
          >
            <span className="text-2xl font-semibold tabular-nums">{n}</span>
            <span className="text-xs leading-tight font-medium">{st.label}</span>
          </li>
        );
      })}
    </ul>
  );
}
