import { handle, body } from "@/lib/http";
import { listTasks, createTask } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  return handle(() => listTasks({
    status: u.get("status") || undefined,
    campaign_id: u.get("campaign_id") || undefined,
    owner: u.get("owner") || undefined,
  }));
}

export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => createTask(b, "user"));
}
