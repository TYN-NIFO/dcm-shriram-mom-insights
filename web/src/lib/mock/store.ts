// In-memory mock data for the /mock-api route handlers.
// Everything here is SYNTHETIC placeholder content: invented companies,
// meetings and resolutions. Nothing is taken from any real minutes.

import type { Conversation, Me, Source, StoredMessage } from "@/lib/types";

export const RETENTION_DAYS = 7;

export const MOCK_ME: Me = {
  name: "Demo User",
  email: "demo.user@example.com",
  scopes: [
    { company: "Sample Co Ltd", body: "Board" },
    { company: "Sample Co Ltd", body: "Audit Committee" },
    { company: "Sample Co Ltd", body: "CSR Committee" },
    { company: "Sample Subsidiary Pvt Ltd", body: "Board" },
  ],
};

interface Store {
  conversations: Map<string, Conversation & { updated_at: string }>;
  seq: number;
}

// Keep state on globalThis so it survives module reloads in `next dev`.
const g = globalThis as unknown as { __momMockStore?: Store };

export function store(): Store {
  if (!g.__momMockStore) {
    g.__momMockStore = { conversations: new Map(), seq: 1 };
    seed(g.__momMockStore);
  }
  prune(g.__momMockStore);
  return g.__momMockStore;
}

export function newId(prefix: string): string {
  const s = store();
  s.seq += 1;
  return `${prefix}_${Date.now().toString(36)}${s.seq.toString(36)}`;
}

function prune(s: Store) {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  for (const [id, c] of s.conversations) {
    if (new Date(c.updated_at).getTime() < cutoff) s.conversations.delete(id);
  }
}

export function pageUrl(page: number): string {
  // Relative to the API base, exactly as a real backend would return it.
  return `/pages/${page}.png`;
}

export function sampleSources(): Source[] {
  return [
    {
      id: "src_minutes_1",
      source_type: "minutes",
      company: "Sample Co Ltd",
      body: "Board",
      meeting_date: "2025-05-14",
      item: "4.2",
      title: "Recommendation of final dividend (sample)",
      pages: [1201, 1202],
      page_image_urls: [pageUrl(1201), pageUrl(1202)],
    },
    {
      id: "src_synopsis_1",
      source_type: "synopsis",
      company: "Sample Co Ltd",
      body: "Board",
      meeting_date: "2025-05-14",
      item: "R-17",
      title: "Final dividend recommended (sample entry)",
      pages: [],
      page_image_urls: [],
      topic: "Dividends",
    },
  ];
}

export const SAMPLE_ANSWER =
  "According to the minutes of the **Board meeting held on 14 May 2025** (Sample Co Ltd), the Board:\n\n" +
  "- recommended a **final dividend of ₹2.50 per equity share** (sample figure) for the financial year, subject to shareholders' approval at the AGM;\n" +
  "- fixed the record date for the dividend as **1 August 2025** (sample date).\n\n" +
  "The same resolution is listed in the Synopsis of Minutes under *Dividends*. This is placeholder text from the demo mock API.";

export const NOT_FOUND_ANSWER =
  "I couldn't find anything about this in the minutes you have access to. " +
  "Try different wording, widen the date range, or check whether the matter was taken up by a committee you don't have access to.";

function seed(s: Store) {
  const day = 86_400_000;
  const t1 = new Date(Date.now() - 1 * day).toISOString();
  const t3 = new Date(Date.now() - 3 * day).toISOString();
  const mk = (
    id: string,
    title: string,
    when: string,
    question: string,
  ): Conversation & { updated_at: string } => {
    const msgs: StoredMessage[] = [
      { id: `${id}_u`, role: "user", content: question, created_at: when },
      {
        id: `${id}_a`,
        role: "assistant",
        content: SAMPLE_ANSWER,
        sources: sampleSources(),
        found: true,
        created_at: when,
      },
    ];
    return { id, title, messages: msgs, updated_at: when };
  };
  s.conversations.set(
    "conv_seed_1",
    mk("conv_seed_1", "Final dividend recommended last year", t1, "What final dividend did the Board recommend last year?"),
  );
  s.conversations.set(
    "conv_seed_2",
    mk("conv_seed_2", "Record date for the sample dividend", t3, "What record date was fixed for the dividend?"),
  );
}
