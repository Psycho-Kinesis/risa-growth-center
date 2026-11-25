import { executeTool, functionDeclarations, type ToolCtx } from "./tools";
import { systemPrompt } from "./prompt";
import { defaultAsOf, eventInfo } from "../queries";

type Part = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
};
type Content = { role: "user" | "model"; parts: Part[] };
export type GenerateFn = (body: Record<string, unknown>) => Promise<{
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
}>;

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type TraceItem = { tool: string; args: Record<string, unknown>; ok: boolean; error?: string; rows?: number };
export type PendingAction = { id: string; summary: string; kind: string };

export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MODEL = () => process.env.GEMINI_MODEL || "gemini-flash-latest";

/** Calls the Gemini generateContent REST endpoint, with one retry on rate limits / overload. */
export const geminiGenerate: GenerateFn = async (body) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LlmError(503, "GEMINI_API_KEY is not set on the server, so the AI analyst is offline. Add it in your hosting settings.");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();
    const text = await res.text();
    if ((res.status === 429 || res.status === 503) && attempt === 0) {
      await new Promise((r) => setTimeout(r, 2500));
      continue;
    }
    let msg = text;
    try { msg = JSON.parse(text)?.error?.message ?? text; } catch { /* keep raw */ }
    if (res.status === 404) msg = `Model "${MODEL()}" was not found. Set GEMINI_MODEL to a model listed in Google AI Studio. (${msg})`;
    if (res.status === 429) msg = `Gemini rate limit reached (free tier). Wait a minute and try again. (${msg})`;
    throw new LlmError(res.status, msg);
  }
  throw new LlmError(500, "unreachable");
};

function clip(value: unknown, max = 24000): unknown {
  const s = JSON.stringify(value ?? null);
  if (s.length <= max) return value;
  return { truncated: true, note: `Result was ${s.length} characters; showing the start. Narrow the query.`, preview: s.slice(0, max) };
}

export async function runCopilot(opts: { messages: ChatMessage[]; asOf?: string; generate?: GenerateFn; maxSteps?: number }) {
  const generate = opts.generate ?? geminiGenerate;
  const latest = await defaultAsOf();
  const asOf = opts.asOf || latest;
  const ev = await eventInfo();
  const fmt = (t?: string) => (t ? new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) : "?");
  const system = systemPrompt({
    asOf, latest,
    eventName: ev?.event_name ?? "CampusFest",
    eventStart: fmt(ev?.event_starts_at), eventEnd: fmt(ev?.event_ends_at),
    historyStart: ev?.history_start ?? "?", historyEnd: ev?.history_end ?? "?",
  });
  const ctx: ToolCtx = { asOf };

  const history = opts.messages.filter((m) => m.content?.trim()).slice(-16);
  const contents: Content[] = history.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user") throw new LlmError(400, "The last message must come from the user.");

  const trace: TraceItem[] = [];
  const pending: PendingAction[] = [];
  const maxSteps = opts.maxSteps ?? 10;

  for (let step = 0; step < maxSteps; step++) {
    const resp = await generate({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: functionDeclarations() }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    });
    if (resp.promptFeedback?.blockReason) {
      return { reply: `The model declined this request (${resp.promptFeedback.blockReason}). Try rephrasing.`, trace, pending, asOf };
    }
    const cand = resp.candidates?.[0];
    const content = cand?.content;
    if (!content?.parts?.length) {
      return { reply: `The model returned no answer (finish reason: ${cand?.finishReason ?? "unknown"}). Please try again.`, trace, pending, asOf };
    }
    // Keep the model turn exactly as returned: thought signatures must be sent back unchanged.
    contents.push({ role: "model", parts: content.parts });
    const calls = content.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const reply = content.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
      return { reply: reply || "(no text returned)", trace, pending, asOf };
    }
    const responses: Part[] = [];
    for (const p of calls) {
      const { name, args = {}, id } = p.functionCall!;
      const out = await executeTool(name, args, ctx);
      const res = out.result as { pending_action_id?: string; summary?: string } | unknown[] | undefined;
      trace.push({
        tool: name, args, ok: out.ok, error: out.error,
        rows: Array.isArray(res) ? res.length : (res as { rows?: unknown[] })?.rows?.length,
      });
      if (out.ok && res && !Array.isArray(res) && (res as { pending_action_id?: string }).pending_action_id) {
        const r = res as { pending_action_id: string; summary: string };
        pending.push({ id: r.pending_action_id, summary: r.summary, kind: name === "propose_task" ? "create_task" : "update_campaign" });
      }
      const response = out.ok ? { result: clip(out.result) } : { error: out.error };
      responses.push({ functionResponse: id ? { name, id, response } : { name, response } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return {
    reply: "I needed more steps than allowed to answer this. Try a narrower question (for example one campaign or one date).",
    trace, pending, asOf,
  };
}
