import { store } from "@/lib/mock/store";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const c = store().conversations.get(id);
  if (!c) return Response.json({ detail: "Conversation not found" }, { status: 404 });
  return Response.json({ id: c.id, title: c.title, messages: c.messages });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = store();
  if (!s.conversations.has(id))
    return Response.json({ detail: "Conversation not found" }, { status: 404 });
  s.conversations.delete(id);
  return new Response(null, { status: 204 });
}
