import { ok } from "@/lib/http";
import { dbStatus } from "@/lib/setup";
import { geminiGenerate } from "@/lib/copilot/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/health?ai=1 — database status, and optionally a one-word Gemini round trip. */
export async function GET(req: Request) {
  const out: Record<string, unknown> = { model: process.env.GEMINI_MODEL || "gemini-flash-latest", ai_key_set: !!process.env.GEMINI_API_KEY };
  try { out.db = await dbStatus(); } catch (e) { out.db = { error: e instanceof Error ? e.message : String(e) }; }
  if (new URL(req.url).searchParams.get("ai")) {
    try {
      const r = await geminiGenerate({ contents: [{ role: "user", parts: [{ text: "Reply with the single word: ready" }] }] });
      out.ai = { ok: true, reply: r.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim() };
    } catch (e) {
      out.ai = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  return ok(out);
}
