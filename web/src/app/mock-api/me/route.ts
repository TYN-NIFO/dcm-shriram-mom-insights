import { MOCK_ME } from "@/lib/mock/store";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(MOCK_ME);
}
