// POST /mock-api/check: multipart/form-data with "file" or "text"; streams SSE results.
// All content is SYNTHETIC ("Sample Co Ltd", invented decisions and limits).
// Demo triggers in the pasted text / file name: "fail" -> SSE error event after the first item;
// "empty" -> no proposals found.

import { newId, pageUrl } from "@/lib/mock/store";
import type { CheckItem, CheckStatus, CheckSummary, Source } from "@/lib/types";

export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024;
const EXTENSIONS = [".docx", ".pdf", ".txt", ".png", ".jpg", ".jpeg", ".tif", ".tiff"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function minutes(
  id: string,
  meeting_date: string,
  item: string,
  title: string,
  pages: number[],
): Source {
  return {
    id,
    source_type: "minutes",
    company: "Sample Co Ltd",
    body: "Board",
    meeting_date,
    item,
    title,
    pages,
    page_image_urls: pages.map(pageUrl),
  };
}

function synopsis(id: string, topic: string, meeting_date: string, item: string, title: string): Source {
  return {
    id,
    source_type: "synopsis",
    company: "Sample Co Ltd",
    body: "Board",
    meeting_date,
    item,
    title,
    pages: [],
    page_image_urls: [],
    topic,
  };
}

/** Synthetic results, listed in proposal order. `delay` sets the (non-proposal) completion order. */
function sampleItems(): (CheckItem & { delay: number })[] {
  return [
    {
      id: "chk_item_1",
      delay: 1400,
      proposal: "To approve a term loan of Rs. 400 crore from Sample Bank Ltd (sample).",
      category: "Borrowing",
      amount: { value: 400, unit: "Rs. crore" },
      basis: "per bank",
      status: "conflict",
      finding:
        "The Board fixed the borrowing limit at Rs. 300 crore per bank [1]. The proposed loan exceeds it. " +
        "The same limit is recorded in the Synopsis of Minutes [2].",
      comparison: "Proposed Rs. 400 crore vs limit Rs. 300 crore per bank",
      limit: { value: 300, unit: "Rs. crore", basis: "per bank" },
      governing: [
        minutes("src_chk_1a", "2024-08-12", "5.1", "Borrowing limits per bank (sample)", [1310, 1311]),
        synopsis("src_chk_1b", "Borrowing Limit", "2024-08-12", "R-42", "Per-bank borrowing limit fixed (sample entry)"),
      ],
      superseded: [
        minutes("src_chk_1c", "2021-06-20", "3.4", "Borrowing limits per bank (sample, earlier)", [980]),
      ],
    },
    {
      id: "chk_item_2",
      delay: 600,
      proposal: "To grant an inter-corporate loan of Rs. 50 crore to Sample Subsidiary Pvt Ltd (sample).",
      category: "Loans to subsidiaries",
      amount: { value: 50, unit: "Rs. crore" },
      basis: "per subsidiary",
      status: "within_limit",
      finding: "The Board approved loans to Sample Subsidiary Pvt Ltd up to Rs. 100 crore [1]. The proposal is within it.",
      comparison: "Proposed Rs. 50 crore vs limit Rs. 100 crore per subsidiary",
      limit: { value: 100, unit: "Rs. crore", basis: "per subsidiary" },
      governing: [
        minutes("src_chk_2a", "2025-02-03", "6.2", "Loans to Sample Subsidiary Pvt Ltd (sample)", [1402, 1403]),
      ],
      superseded: [],
    },
    {
      id: "chk_item_3",
      delay: 900,
      proposal:
        "To increase the overall borrowing powers of the Board to Rs. 2,500 crore, subject to shareholders' approval (sample).",
      category: "Borrowing powers",
      amount: { value: 2500, unit: "Rs. crore" },
      basis: "overall",
      status: "changes_limit",
      finding:
        "The current overall borrowing limit is Rs. 2,000 crore [1]. The proposal raises it; the earlier approval " +
        "required shareholders' consent for any increase [1].",
      comparison: "Proposed Rs. 2,500 crore vs current limit Rs. 2,000 crore overall (+25%)",
      limit: { value: 2000, unit: "Rs. crore", basis: "overall" },
      governing: [
        minutes("src_chk_3a", "2023-07-28", "4.6", "Borrowing powers under the Act (sample)", [1188, 1189, 1190]),
      ],
      superseded: [
        minutes("src_chk_3b", "2019-05-10", "7.1", "Borrowing powers (sample, earlier)", [812]),
        minutes("src_chk_3c", "2016-08-02", "5.3", "Borrowing powers (sample, earliest)", [640, 641]),
      ],
    },
    {
      id: "chk_item_4",
      delay: 700,
      proposal: "To approve a contribution of Rs. 2 crore to Sample Foundation for a skilling programme (sample).",
      category: "Contributions",
      amount: { value: 2, unit: "Rs. crore" },
      basis: null,
      status: "no_limit_found",
      finding: "No Board decision setting a limit for contributions of this kind was found in the minutes searched.",
      comparison: null,
      limit: null,
      governing: [],
      superseded: [],
    },
  ];
}

async function readInput(req: Request): Promise<{ document: string; text: string } | Response> {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ detail: "Send the draft as multipart/form-data with a file or text." }, { status: 400 });
  }
  const file = form.get("file");
  const text = form.get("text");
  if (file && typeof file !== "string") {
    const name = file.name || "draft";
    if (!EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
      return Response.json({ detail: "Only .docx, .pdf and .txt files can be checked." }, { status: 400 });
    if (file.size > MAX_BYTES) return Response.json({ detail: "The file is larger than 10 MB." }, { status: 400 });
    if (file.size === 0) return Response.json({ detail: "The file is empty." }, { status: 400 });
    // The mock does not parse .docx/.pdf; a .txt is read so the demo triggers work.
    const body = name.toLowerCase().endsWith(".txt") ? await file.text() : "";
    return { document: name, text: `${name}\n${body}` };
  }
  if (typeof text === "string" && text.trim()) return { document: "Pasted draft", text };
  return Response.json({ detail: "Upload a file or paste the draft text." }, { status: 400 });
}

export async function POST(req: Request) {
  const input = await readInput(req);
  if (input instanceof Response) return input;

  const empty = /\bempty\b/i.test(input.text);
  const fail = /\bfail\b/i.test(input.text);
  const items = empty ? [] : sampleItems();
  const checkId = newId("chk");
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      await sleep(500); // pretend to read the draft
      send("meta", {
        check_id: checkId,
        document: input.document,
        items_found: items.length,
        proposals: items.map((i) => i.proposal),
      });

      const summary = Object.fromEntries(
        ["conflict", "changes_limit", "needs_review", "within_limit", "no_conflict", "no_limit_found"].map((s) => [s, 0]),
      ) as CheckSummary;

      // Emit in completion order (shortest delay first), as the real backend would.
      const order = [...items].sort((a, b) => a.delay - b.delay);
      let sent = 0;
      for (const { delay, ...item } of order) {
        await sleep(delay);
        if (req.signal.aborted || closed) return close();
        send("item", item);
        summary[item.status as CheckStatus] += 1;
        sent += 1;
        if (fail && sent === 1) {
          send("error", { message: "The check could not be completed (demo error). Please try again." });
          return close();
        }
      }
      send("done", { summary });
      close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
