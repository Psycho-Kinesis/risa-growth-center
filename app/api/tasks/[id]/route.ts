import { handle, body } from "@/lib/http";
import { updateTask, deleteTask } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await body(req);
  return handle(() => updateTask(id, b, "user"));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(() => deleteTask(id, "user"));
}
