"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { fetchPageImage, friendlyError } from "@/lib/api";
import { citationText } from "@/lib/format";
import type { Source } from "@/lib/types";

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
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-xl lg:static lg:z-auto lg:w-[28rem] lg:max-w-none lg:shadow-none xl:w-[34rem] dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex items-start gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
              Source
            </p>
            <p className="mt-0.5 text-sm font-medium">{citationText(source)}</p>
            {source.company && <p className="text-xs text-zinc-500 dark:text-zinc-400">{source.company}</p>}
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

        {hasPages ? (
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
              ? "This source is an entry in the Synopsis of Minutes register. It has no scanned page."
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
