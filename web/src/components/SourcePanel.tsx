"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, FileSpreadsheet, ImageOff, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { fetchPageImage, friendlyError, getRegisterSheet, resolveApiUrl } from "@/lib/api";
import { citeLong } from "@/lib/format";
import { fontVars } from "@/lib/fonts";
import type { RegisterSheet, Source } from "@/lib/types";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

interface Props {
  source: Source;
  onClose: () => void;
}

export default function SourcePanel({ source, onClose }: Props) {
  const urls = source.page_image_urls;
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Reset when a different source is opened.
  useEffect(() => {
    setIndex(0);
    setZoom(1);
    closeRef.current?.focus();
  }, [source.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pageNo = source.pages[index];
  const hasPages = urls.length > 0;

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden />
      <aside
        aria-label="Source page viewer"
        className={`${fontVars} font-ui fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl lg:static lg:z-auto lg:w-[28rem] lg:max-w-none lg:shadow-none xl:w-[34rem] dark:border-zinc-800 dark:bg-zinc-900`}
      >
        <div className="flex items-start gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] leading-6 font-semibold text-ink">{citeLong(source)}</p>
            {source.company && <p className="text-[13px] text-note">{source.company}</p>}
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label="Close source viewer"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        {source.source_type === "synopsis" && source.register_url ? (
          <RegisterView url={source.register_url} />
        ) : hasPages ? (
          <>
            <div className="flex items-center gap-1 border-b border-zinc-200 px-2 py-1.5 text-sm dark:border-zinc-800">
              <IconButton
                label="Previous page"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(0, i - 1))}
              >
                <ChevronLeft className="size-4" aria-hidden />
              </IconButton>
              <span className="min-w-0 flex-1 text-center text-zinc-600 tabular-nums dark:text-zinc-300" aria-live="polite">
                {pageNo !== undefined ? `Minute book p. ${pageNo}` : `Page`} ({index + 1} of {urls.length})
              </span>
              <IconButton
                label="Next page"
                disabled={index >= urls.length - 1}
                onClick={() => setIndex((i) => Math.min(urls.length - 1, i + 1))}
              >
                <ChevronRight className="size-4" aria-hidden />
              </IconButton>
              <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-700" aria-hidden />
              <IconButton
                label="Zoom out"
                disabled={zoom <= ZOOM_MIN}
                onClick={() => setZoom((z) => Math.max(ZOOM_MIN, z - ZOOM_STEP))}
              >
                <ZoomOut className="size-4" aria-hidden />
              </IconButton>
              <button
                type="button"
                onClick={() => setZoom(1)}
                className="w-12 rounded px-1 py-1 text-center text-xs text-zinc-600 tabular-nums hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                aria-label="Reset zoom"
              >
                {Math.round(zoom * 100)}%
              </button>
              <IconButton
                label="Zoom in"
                disabled={zoom >= ZOOM_MAX}
                onClick={() => setZoom((z) => Math.min(ZOOM_MAX, z + ZOOM_STEP))}
              >
                <ZoomIn className="size-4" aria-hidden />
              </IconButton>
            </div>
            <PageImage url={urls[index]} alt={`Scanned minute book page ${pageNo ?? index + 1}`} zoom={zoom} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <ImageOff className="size-8 text-zinc-300 dark:text-zinc-600" aria-hidden />
            {source.source_type === "synopsis"
              ? "This answer was created before the register view was added. Ask the question again to open the entry in the Synopsis of Minutes workbook."
              : "No scanned page is available for this source."}
          </div>
        )}
      </aside>
    </>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-zinc-600 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      {children}
    </button>
  );
}

/** Loads the page through the API client (so auth headers can be added later) and shows it. */
function PageImage({ url, alt, zoom }: { url: string; alt: string; zoom: number }) {
  const [state, setState] = useState<{ url: string; src?: string; error?: string }>({ url });

  useEffect(() => {
    const ctrl = new AbortController();
    let objectUrl: string | undefined;
    setState({ url });
    fetchPageImage(url, ctrl.signal)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        setState({ url, src: objectUrl });
      })
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setState({ url, error: friendlyError(e) });
      });
    return () => {
      ctrl.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-zinc-100 p-3 dark:bg-zinc-950">
      {state.error ? (
        <p role="alert" className="p-4 text-center text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : state.src ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob URL of an authenticated image
        <img
          src={state.src}
          alt={alt}
          style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          className="mx-auto block rounded border border-zinc-300 bg-white shadow-sm dark:border-zinc-700"
        />
      ) : (
        <div className="flex h-full items-center justify-center text-zinc-400" role="status">
          <Loader2 className="size-6 animate-spin" aria-hidden />
          <span className="sr-only">Loading page image</span>
        </div>
      )}
    </div>
  );
}

const COLS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const COL_WIDTH = [52, 78, 56, 92, 420, 120, 120, 120];

/** The register entry shown as it is in DCM's Excel workbook: the real sheet, the cited row selected. */
function RegisterView({ url }: { url: string }) {
  const [state, setState] = useState<{ url: string; sheet?: RegisterSheet; error?: string }>({ url });
  const citedRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setState({ url });
    getRegisterSheet(url, ctrl.signal)
      .then((sheet) => setState({ url, sheet }))
      .catch((e) => {
        if (!ctrl.signal.aborted) setState({ url, error: friendlyError(e) });
      });
    return () => ctrl.abort();
  }, [url]);

  useEffect(() => {
    citedRef.current?.scrollIntoView({ block: "center" });
  }, [state.sheet]);

  if (state.error)
    return (
      <p role="alert" className="p-6 text-center text-sm text-red-700">
        {state.error}
      </p>
    );
  if (!state.sheet)
    return (
      <div className="flex flex-1 items-center justify-center text-zinc-400" role="status">
        <Loader2 className="size-6 animate-spin" aria-hidden />
        <span className="sr-only">Loading the register</span>
      </div>
    );

  const { sheet } = state;
  const ncols = Math.max(1, ...sheet.rows.map((r) => r.length));
  const cited = sheet.rows[sheet.cited_row - 1] ?? [];
  const descCol = cited.reduce((best, v, i) => (v.length > (cited[best] ?? "").length ? i : best), 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white" style={{ fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif" }}>
      {/* title bar */}
      <div className="flex items-center gap-2 bg-[#217346] px-3 py-1.5 text-white">
        <FileSpreadsheet className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-[12px]">{sheet.workbook}</span>
        <span className="shrink-0 rounded-sm bg-white/15 px-1.5 py-0.5 text-[10px] tracking-wide uppercase">Read-only</span>
        <a
          href={resolveApiUrl("/register/file")}
          download
          className="inline-flex shrink-0 items-center gap-1 rounded-sm bg-white px-2 py-0.5 text-[12px] font-medium text-[#217346] hover:bg-zinc-100"
        >
          <Download className="size-3.5" aria-hidden /> Open in Excel
        </a>
      </div>
      {/* name box + formula bar */}
      <div className="flex items-stretch border-b border-[#d4d4d4] bg-[#f3f3f3] text-[12px]">
        <span className="w-16 shrink-0 border-r border-[#d4d4d4] bg-white px-2 py-1 text-zinc-700 tabular-nums">
          {COLS[descCol] ?? "A"}
          {sheet.cited_row}
        </span>
        <span className="shrink-0 border-r border-[#d4d4d4] px-2 py-1 font-serif text-zinc-500 italic">fx</span>
        <span className="min-w-0 flex-1 truncate bg-white px-2 py-1 text-zinc-800" title={cited[descCol]}>
          {cited[descCol]}
        </span>
      </div>
      {/* grid */}
      <div className="min-h-0 flex-1 overflow-auto bg-white">
        <table className="border-separate border-spacing-0 text-[12px] text-zinc-900" style={{ tableLayout: "fixed" }}>
          <colgroup>
            <col style={{ width: 36 }} />
            {Array.from({ length: ncols }, (_, c) => (
              <col key={c} style={{ width: COL_WIDTH[c] ?? 120 }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="border-r border-b border-[#d4d4d4] bg-[#e6e6e6]" />
              {Array.from({ length: ncols }, (_, c) => (
                <th
                  key={c}
                  scope="col"
                  className={`border-r border-b border-[#d4d4d4] py-0.5 text-center font-normal ${
                    c === descCol ? "bg-[#d2e9dc] text-[#217346]" : "bg-[#efefef] text-zinc-600"
                  }`}
                >
                  {COLS[c]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((r, i) => {
              const n = i + 1;
              const isCited = n === sheet.cited_row;
              return (
                <tr key={n} ref={isCited ? citedRef : undefined} aria-current={isCited ? "true" : undefined}>
                  <th
                    scope="row"
                    className={`sticky left-0 border-r border-b border-[#d4d4d4] px-1 text-center align-top font-normal tabular-nums ${
                      isCited ? "bg-[#d2e9dc] font-semibold text-[#217346]" : "bg-[#efefef] text-zinc-500"
                    }`}
                  >
                    {n}
                  </th>
                  {Array.from({ length: ncols }, (_, c) => {
                    const v = r[c] ?? "";
                    return (
                      <td
                        key={c}
                        className={`border-r border-b px-1.5 py-0.5 align-top ${
                          c === descCol ? "whitespace-normal" : "truncate whitespace-nowrap"
                        } ${isCited ? "border-b-[#217346] bg-[#e8f3ec]" : "border-[#e1e1e1]"} ${n <= 2 ? "font-semibold" : ""}`}
                        title={v.length > 20 ? v : undefined}
                      >
                        {v.startsWith("#Index!") ? "" : v}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* sheet tab */}
      <div className="flex items-center gap-2 border-t border-[#d4d4d4] bg-[#f3f3f3] px-2 text-[12px]">
        <span className="-mt-px border-x border-b-2 border-x-[#d4d4d4] border-b-[#217346] bg-white px-3 py-1 font-semibold text-[#217346]">
          {sheet.sheet}
        </span>
        <span className="ml-auto py-1 text-zinc-500">
          Row {sheet.cited_row} of {sheet.rows.length} · {sheet.sheet_count} sheets in the workbook
        </span>
      </div>
    </div>
  );
}
