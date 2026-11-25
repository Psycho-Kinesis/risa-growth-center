import { ok, body } from "@/lib/http";
import { runCopilot, LlmError, type ChatMessage } from "@/lib/copilot/agent";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  const b = await body(req);
  const messages = Array.isArray(b.messages) ? (b.messages as ChatMessage[]) : [];
  const asOf = typeof b.asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.asOf) ? b.asOf : undefined;
  try {
    const out = await runCopilot({ messages, asOf });
    // keep pending-action status fresh for the UI
    const ids = out.pending.map((p) => p.id);
    const status = ids.length ? await q(`select id, status from app_pending_actions where id = any($1::uuid[])`, [ids]) : [];
    return ok({ ...out, pendingStatus: status });
  } catch (e) {
    const status = e instanceof LlmError ? e.status : 500;
    const msg = e instanceof Error ? e.message : String(e);
    console.error("chat error", msg);
    return ok({ error: msg }, status >= 400 && status < 600 ? status : 500);
  }
}
