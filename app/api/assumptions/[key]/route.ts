import { handle, body } from "@/lib/http";
import { updateAssumption } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const b = await body(req);
  return handle(() => updateAssumption(key, b.value, "user"));
}
