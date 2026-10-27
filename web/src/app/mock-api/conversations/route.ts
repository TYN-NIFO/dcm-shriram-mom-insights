import { store } from "@/lib/mock/store";
import type { ConversationSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export function GET() {
  const list: ConversationSummary[] = [...store().conversations.values()]
    .map(({ id, title, updated_at }) => ({ id, title, updated_at }))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return Response.json(list);
}
