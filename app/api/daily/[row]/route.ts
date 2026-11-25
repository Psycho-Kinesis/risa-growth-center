import { handle } from "@/lib/http";
import { deleteAppDailyRow, InputError } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ row: string }> }) {
  const { row } = await params;
  return handle(async () => {
    const n = Number(row);
    if (!Number.isInteger(n)) throw new InputError("bad row id");
    return deleteAppDailyRow(n, "user");
  });
}
