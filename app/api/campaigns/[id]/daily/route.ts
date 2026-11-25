import { handle, body } from "@/lib/http";
import { addDailyEntry } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await body(req);
  return handle(() => addDailyEntry(id, b, "user"));
}
