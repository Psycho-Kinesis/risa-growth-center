import { ok } from "@/lib/http";
import { dbStatus } from "@/lib/setup";
import { geminiGenerate, modelChain } from "@/lib/copilot/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * GET /api/health?ai=1 — database status and, optionally, a two-step Gemini check:
 * 1. list models (is Google reachable and is the key valid?), 2. a one-word reply from the configured model.
 */
export async function GET(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  const out: Record<string, unknown> = { model: modelChain().join(" → "), ai_key_set: !!key };
  try { out.db = await dbStatus(); } catch (e) { out.db = { error: errText(e) }; }
  if (!new URL(req.url).searchParams.get("ai")) return ok(out);

  if (key) {
    const t0 = Date.now();
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
        headers: { "x-goog-api-key": key },
        signal: AbortSignal.timeout(8000),
      });
      const text = await r.text();
      let flash: string[] = [];
      let error: string | undefined;
      try {
        const j = JSON.parse(text);
        if (r.ok) flash = (j.models ?? []).map((m: { name: string }) => m.name.replace("models/", "")).filter((n: string) => n.includes("flash"));
        else error = j?.error?.message ?? text.slice(0, 300);
      } catch { error = text.slice(0, 300); }
      out.ai_probe = { ok: r.ok, status: r.status, ms: Date.now() - t0, ...(error ? { error } : { flash_models: flash.slice(0, 15) }) };
    } catch (e) {
      out.ai_probe = { ok: false, ms: Date.now() - t0, error: `Could not reach Google: ${errText(e)}` };
    }
  }

  const t1 = Date.now();
  try {
    const r = await geminiGenerate({ contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }] }, { timeoutMs: 12000, deadline: t1 + 20000 });
    out.ai = { ok: true, ms: Date.now() - t1, model: r._model, reply: r.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text).join("").trim() };
  } catch (e) {
    out.ai = { ok: false, ms: Date.now() - t1, error: errText(e) };
  }
  return ok(out);
}
