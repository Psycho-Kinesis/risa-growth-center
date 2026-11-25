import { handle, body } from "@/lib/http";
import { q1 } from "@/lib/db";
import { createTask, updateCampaign, InputError } from "@/lib/queries";

export const dynamic = "force-dynamic";

type Pending = { id: string; kind: string; payload: Record<string, unknown>; status: string; summary: string };

/** POST { decision: "confirm" | "cancel" } — the only way a copilot proposal changes data. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await body(req);
  return handle(async () => {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new InputError("bad id");
    const act = await q1<Pending>(`select * from app_pending_actions where id = $1`, [id]);
    if (!act) throw new InputError("Proposal not found");
    if (act.status !== "pending") throw new InputError(`This proposal is already ${act.status}.`);
    if (b.decision === "cancel") {
      await q1(`update app_pending_actions set status = 'cancelled', decided_at = now() where id = $1`, [id]);
      return { status: "cancelled", summary: act.summary };
    }
    if (b.decision !== "confirm") throw new InputError("decision must be confirm or cancel");
    try {
      const result = act.kind === "create_task"
        ? await createTask(act.payload, "ai_copilot")
        : await updateCampaign(String(act.payload.campaign_id), act.payload.patch as Record<string, unknown>, "ai_copilot");
      await q1(`update app_pending_actions set status = 'confirmed', decided_at = now(), result = $2 where id = $1`, [id, JSON.stringify(result)]);
      return { status: "confirmed", summary: act.summary, result };
    } catch (e) {
      await q1(`update app_pending_actions set status = 'failed', decided_at = now(), result = $2 where id = $1`,
        [id, JSON.stringify({ error: e instanceof Error ? e.message : String(e) })]);
      throw e;
    }
  });
}
