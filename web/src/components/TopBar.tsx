"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileSearch, Menu, MessageSquare, ShieldCheck, UserRound } from "lucide-react";
import type { Me } from "@/lib/types";

interface Props {
  me: Me | null;
  /** Shows the mobile menu button (chat page only). */
  onOpenSidebar?: () => void;
}

const SECTIONS = [
  { href: "/", label: "Chat", Icon: MessageSquare },
  { href: "/check", label: "Check a draft", Icon: FileSearch },
] as const;

/** Switch between the Chat and Check a draft screens. */
function SectionSwitch() {
  const pathname = usePathname();
  return (
    <nav aria-label="Sections" className="shrink-0">
      <ul className="flex rounded-lg bg-zinc-100 p-0.5 dark:bg-zinc-800">
        {SECTIONS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap ${
                  active
                    ? "bg-white font-medium text-accent-700 shadow-sm dark:bg-zinc-900 dark:text-accent-300"
                    : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
                }`}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                <span>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default function TopBar({ me, onOpenSidebar }: Props) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-3 py-2.5 sm:px-4 dark:border-zinc-800 dark:bg-zinc-900">
      {onOpenSidebar && (
        <button
          type="button"
          onClick={onOpenSidebar}
          className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 md:hidden dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="Open conversation list"
        >
          <Menu className="size-5" aria-hidden />
        </button>
      )}

      <div className="flex min-w-0 items-center gap-2">
        <span
          className="grid size-8 shrink-0 place-items-center rounded-md bg-accent-600 text-white dark:bg-accent-500"
          aria-hidden
        >
          <ShieldCheck className="size-4.5" />
        </span>
        <div className="min-w-0 max-[519px]:sr-only">
          <h1 className="truncate text-[15px] font-semibold tracking-tight">DCM MoM Insights</h1>
          <p className="hidden truncate text-xs text-zinc-500 sm:block dark:text-zinc-400">
            Board &amp; Committee minutes assistant
          </p>
        </div>
      </div>

      <SectionSwitch />

      <div className="ml-auto flex min-w-0 items-center gap-3">
        {me && (
          <ul
            className="hidden max-w-[40vw] flex-wrap justify-end gap-1.5 xl:flex"
            aria-label="Your access scope"
          >
            {me.scopes.map((s) => (
              <li
                key={`${s.company}|${s.body}`}
                className="rounded-full border border-accent-100 bg-accent-50 px-2.5 py-0.5 text-xs text-accent-700 dark:border-accent-900 dark:bg-accent-900/40 dark:text-accent-300"
              >
                {s.company} · {s.body}
              </li>
            ))}
          </ul>
        )}
        <div className="flex min-w-0 items-center gap-2" title={me?.email}>
          <span
            className="grid size-8 shrink-0 place-items-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-200"
            aria-hidden
          >
            <UserRound className="size-4" />
          </span>
          <div className="hidden min-w-0 text-right sm:block">
            <p className="truncate text-sm font-medium">{me?.name ?? "…"}</p>
            <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{me?.email}</p>
          </div>
          <span className="sr-only">Signed in as {me?.name}</span>
        </div>
      </div>
    </header>
  );
}

/** Access-scope chips for small screens (shown under the top bar). */
export function ScopeStrip({ me }: { me: Me | null }) {
  if (!me?.scopes.length) return null;
  return (
    <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-zinc-200 bg-white px-3 py-1.5 xl:hidden dark:border-zinc-800 dark:bg-zinc-900">
      <span className="shrink-0 self-center text-xs text-zinc-500 dark:text-zinc-400">Access:</span>
      {me.scopes.map((s) => (
        <span
          key={`${s.company}|${s.body}`}
          className="shrink-0 rounded-full border border-accent-100 bg-accent-50 px-2 py-0.5 text-xs text-accent-700 dark:border-accent-900 dark:bg-accent-900/40 dark:text-accent-300"
        >
          {s.company} · {s.body}
        </span>
      ))}
    </div>
  );
}
