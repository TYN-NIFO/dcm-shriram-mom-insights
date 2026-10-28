"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
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
  "inline-flex items-center gap-2 rounded-xl bg-gold-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 shadow-sm transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400 disabled:shadow-none";
const secondaryBtn =
  "inline-flex items-center gap-2 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 transition hover:border-zinc-500";

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
  const [filter, setFilter] = useState<CheckStatus | "all">("all");

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
    setFilter("all");
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

  const visible = filter === "all" ? sorted : sorted.filter((it) => it.status === filter);

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
      <div className={"flex min-w-0 flex-1 flex-col bg-[#f7f7f7] text-zinc-900 md:rounded-3xl"}>
        <TopBar me={me} onOpenSidebar={() => setSidebarOpen(true)} title="Check a draft" />

        <div className="flex min-h-0 flex-1">
          <main id="check-main" className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-[60rem] px-4 pt-6 pb-12 sm:px-8">
              {!showResults ? (
                <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
                  <div>
                    <h2 className="text-3xl font-semibold tracking-tight">Check a draft resolution</h2>
                    <p className="mt-2 max-w-[60ch] text-[15px] leading-7 text-zinc-500">
                      Add the draft agenda note or resolution. Each decision it proposes is compared with the
                      resolutions in force in the minute book and the Synopsis register.
                    </p>

                    <form
                      className="mt-7 rounded-2xl border border-zinc-200 bg-white shadow-sm"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void run();
                      }}
                    >
                      <div role="tablist" aria-label="How to add the draft" className="flex gap-1 border-b border-zinc-100 p-2.5">
                        {(
                          [
                            { m: "file", label: "Upload a file" },
                            { m: "text", label: "Paste the text" },
                          ] as const
                        ).map(({ m, label }) => (
                          <button
                            key={m}
                            type="button"
                            role="tab"
                            aria-selected={mode === m}
                            onClick={() => setMode(m)}
                            className={`rounded-xl px-4 py-1.5 text-sm transition ${
                              mode === m ? "bg-gold-400 font-semibold text-zinc-950 shadow-sm" : "text-zinc-600 hover:bg-zinc-100"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>

                      <div className="p-5">
                        {mode === "file" ? (
                          <>
                            {!file ? (
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
                                className={`flex cursor-pointer items-center gap-4 rounded-xl border border-dashed px-5 py-6 focus-within:border-gold-500 ${
                                  dragOver ? "border-gold-500 bg-gold-400/10" : "border-zinc-300 hover:border-gold-500"
                                }`}
                              >
                                <FileText className="size-8 shrink-0 text-zinc-400" strokeWidth={1.25} aria-hidden />
                                <span className="min-w-0 flex-1">
                                  <span className="block text-[15px] text-zinc-900">Drop the file here, or choose one from your computer</span>
                                  <span className="mt-0.5 block text-[13px] text-zinc-500">
                                    Word, PDF (scanned is fine), an image or a text file, up to 10 MB
                                  </span>
                                </span>
                                <span className="hidden shrink-0 rounded-xl border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-900 sm:block">
                                  Choose file
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
                            ) : (
                              <div className="flex items-center gap-4 rounded-xl border border-zinc-200 px-5 py-4">
                                <FileText className="size-8 shrink-0 text-accent-700" strokeWidth={1.25} aria-hidden />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-[15px] font-medium text-zinc-900">{file.name}</span>
                                  <span className="text-[13px] text-zinc-500 tabular-nums">{formatBytes(file.size)}</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFile(null);
                                    if (fileInputRef.current) fileInputRef.current.value = "";
                                  }}
                                  className="text-sm text-zinc-500 underline decoration-zinc-300 underline-offset-[3px] hover:text-zinc-900"
                                >
                                  Remove
                                </button>
                              </div>
                            )}
                            {fileError && (
                              <p id={`${ids}-file-err`} role="alert" className="mt-2 text-sm text-breach">
                                {fileError}
                              </p>
                            )}
                          </>
                        ) : (
                          <>
                            <label htmlFor={`${ids}-text`} className="sr-only">
                              Draft agenda or resolution text
                            </label>
                            <textarea
                              id={`${ids}-text`}
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                              rows={11}
                              placeholder="RESOLVED THAT the consent of the Board be and is hereby accorded to…"
                              className="w-full resize-y rounded-xl border border-zinc-200 bg-white px-4 py-3 text-[15px] leading-7 placeholder:text-zinc-400 focus:border-gold-500 focus:ring-2 focus:ring-gold-400/20 focus:outline-none"
                            />
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-end gap-4 border-t border-zinc-200 px-5 py-3">
                        <button type="submit" disabled={!canCheck} className={primaryBtn}>
                          Check against the minutes
                        </button>
                      </div>
                    </form>
                  </div>

                  <aside className="text-[13.5px] leading-6 text-zinc-500 lg:pt-2">
                    <h3 className="font-semibold text-zinc-900">What the check looks for</h3>
                    <p className="mt-1.5">
                      Approved limits on deposits, borrowing, derivatives, political contributions and remuneration;
                      the latest resolution where an earlier one was revised; and earlier decisions on the same matter.
                    </p>
                    <h3 className="mt-5 font-semibold text-zinc-900">What you get back</h3>
                    <dl className="mt-1.5 space-y-1.5">
                      {CHECK_STATUS_ORDER.map((s) => (
                        <div key={s}>
                          <dt className={`inline font-medium ${STATUS[s].ink}`}>{STATUS[s].label}</dt>
                          <dd className="inline">: {STATUS[s].hint.charAt(0).toLowerCase() + STATUS[s].hint.slice(1)}.</dd>
                        </div>
                      ))}
                    </dl>
                    <p className="mt-5 border-t border-zinc-200 pt-4 text-xs">
                      Results are for review by the Secretarial team. They are not a legal or compliance opinion.
                    </p>
                  </aside>
                </div>
              ) : (
                <section aria-labelledby={`${ids}-results`}>
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <h2
                        id={`${ids}-results`}
                        ref={resultsHeadingRef}
                        tabIndex={-1}
                        className="truncate text-2xl font-semibold tracking-tight focus:outline-none"
                      >
                        {meta?.document || sentName}
                      </h2>
                      <p className="mt-1.5 max-w-[70ch] text-[15px] leading-7 text-zinc-500">
                        <Verdict phase={phase} meta={meta} counts={counts} done={items.length} />
                      </p>
                    </div>
                    {phase === "running" ? (
                      <button type="button" onClick={cancel} className={secondaryBtn}>
                        Stop
                      </button>
                    ) : (
                      <button type="button" onClick={reset} className={secondaryBtn}>
                        Check another draft
                      </button>
                    )}
                  </div>

                  {phase === "running" && (
                    <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-zinc-200" role="progressbar" aria-label="Check progress" aria-valuemin={0} aria-valuemax={total || undefined} aria-valuenow={meta ? items.length : undefined}>
                      <div
                        className={`h-full bg-gold-400 transition-[width] duration-500 ${meta ? "" : "w-1/5 animate-pulse"}`}
                        style={meta ? { width: `${total ? Math.round((items.length / total) * 100) : 0}%` } : undefined}
                      />
                    </div>
                  )}

                  {meta?.read_with === "ocr" && (
                    <p className="mt-4 border-l-2 border-revision bg-white px-4 py-2.5 text-sm text-zinc-900">
                      This draft is a scanned or image-only file and was read with OCR. Confirm the amounts and names
                      against the draft before relying on them.
                    </p>
                  )}

                  {error && (
                    <p role="alert" className="mt-4 border-l-2 border-breach bg-white px-4 py-2.5 text-sm text-zinc-900">
                      {error}
                    </p>
                  )}

                  {(items.length > 0 || pending.length > 0) && (
                    <div className="mt-6 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
                      {items.length > 0 && (
                        <div role="tablist" aria-label="Show results" className="flex gap-1 overflow-x-auto border-b border-zinc-100 p-2.5 whitespace-nowrap">
                          {(["all", ...CHECK_STATUS_ORDER] as const).map((s) => {
                            const n = s === "all" ? items.length : counts[s] ?? 0;
                            if (s !== "all" && n === 0) return null;
                            const active = filter === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                role="tab"
                                aria-selected={active}
                                onClick={() => setFilter(s)}
                                className={`rounded-xl px-3 py-1.5 text-[13.5px] transition ${
                                  active ? "bg-zinc-900 font-semibold text-white" : "text-zinc-600 hover:bg-zinc-100"
                                }`}
                              >
                                {s === "all" ? "All items" : STATUS[s].label}{" "}
                                <span className="font-normal opacity-60 tabular-nums">{n}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      <ol className="divide-y divide-zinc-100" aria-label="Results" aria-live="polite" aria-relevant="additions">
                        {visible.map((it) => (
                          <li key={it.id}>
                            <CheckResultCard item={it} selectedSourceId={openSource?.id ?? null} onOpenSource={setOpenSource} />
                          </li>
                        ))}
                        {filter === "all" &&
                          pending.map((p, i) => (
                            <li
                              key={`p-${i}-${p}`}
                              className="grid gap-x-8 px-6 py-5 text-zinc-500 sm:grid-cols-[9.5rem_minmax(0,1fr)]"
                            >
                              <span className="flex items-center gap-1.5 text-[13px]">
                                <Loader2 className="size-4 animate-spin" aria-hidden /> Checking
                              </span>
                              <span className=" text-[16px] leading-7">{p}</span>
                            </li>
                          ))}
                      </ol>
                    </div>
                  )}

                  {phase === "done" && meta && meta.items_found === 0 && (
                    <p className="mt-6 rounded-2xl border border-zinc-200 bg-white px-6 py-6 text-[15px] text-zinc-500">
                      No proposed decisions were found. A draft should contain agenda items or resolutions, for example
                      text beginning &ldquo;RESOLVED THAT&rdquo;.
                    </p>
                  )}

                  {phase !== "running" && items.length > 0 && (
                    <p className="mt-5 text-xs leading-5 text-zinc-500">{NOTE}</p>
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

/** The report's opening sentence: what was found, in words. */
function Verdict({ phase, meta, counts, done }: { phase: Phase; meta: CheckMeta | null; counts: CheckSummary; done: number }) {
  if (!meta) return <>Reading the draft and finding the decisions it proposes…</>;
  const n = meta.items_found;
  const source = meta.read_with === "ocr" ? "a scanned copy" : "the document";
  if (phase === "running") return <>Read {n} proposed decision{n === 1 ? "" : "s"} from {source}. Checked {done} so far.</>;
  const parts: string[] = [];
  if (counts.conflict) parts.push(`${counts.conflict} conflict${counts.conflict === 1 ? "s" : ""} with a decision in force`);
  if (counts.changes_limit) parts.push(`${counts.changes_limit} change${counts.changes_limit === 1 ? "s" : ""} an approved limit`);
  if (counts.needs_review) parts.push(`${counts.needs_review} need${counts.needs_review === 1 ? "s" : ""} a closer look`);
  const clear = counts.within_limit + counts.no_conflict + counts.no_limit_found;
  if (clear) parts.push(`${clear} raise${clear === 1 ? "s" : ""} no issue`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? "";
  return (
    <>
      {n} proposed decision{n === 1 ? "" : "s"} read from {source}. {list ? `${list.charAt(0).toUpperCase()}${list.slice(1)}.` : ""}
    </>
  );
}
