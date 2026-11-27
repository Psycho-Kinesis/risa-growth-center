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
export type GenerateOpts = {
  /** Per-request time limit. */
  timeoutMs?: number;
  /** Use exactly this model (keeps one conversation on one model, so thought signatures stay valid). */
  model?: string;
  /** Absolute time (ms since epoch) after which no new request is started. */
  deadline?: number;
};
export type GenerateResult = {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  /** The model that produced this result (set by geminiGenerate). */
  _model?: string;
};
export type GenerateFn = (body: Record<string, unknown>, opts?: GenerateOpts) => Promise<GenerateResult>;

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type TraceItem = { tool: string; args: Record<string, unknown>; ok: boolean; error?: string; rows?: number };
export type PendingAction = { id: string; summary: string; kind: string };

export class LlmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const DEFAULT_MODEL = "gemini-2.5-flash";
const DEFAULT_FALLBACKS = "gemini-flash-latest,gemini-flash-lite-latest";
const DEFAULT_TIMEOUT_MS = () => Number(process.env.GEMINI_TIMEOUT_MS) || 25000;
const BUSY_MS = 120_000;
/** Failures where another model (or a later retry) may succeed: rate limit, overload, timeout, network, unknown model. */
const SKIPPABLE = new Set([404, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Models to try, in order: GEMINI_MODEL (or the stable default), then GEMINI_FALLBACK_MODELS. */
export function modelChain(): string[] {
  const primary = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? DEFAULT_FALLBACKS).split(",").map((m) => m.trim()).filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

/** Models that recently reported overload are tried last for a while (per warm server instance). */
const busyUntil = new Map<string, number>();
export function resetModelHealth() { busyUntil.clear(); }

async function callModel(model: string, body: Record<string, unknown>, key: string, timeoutMs: number): Promise<GenerateResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const err = e as Error;
    console.error(`[gemini] ${model} failed after ${Date.now() - started} ms: ${err.name}: ${err.message}`);
    if (err.name === "TimeoutError" || err.name === "AbortError") throw new LlmError(504, `${model} did not reply within ${Math.round(timeoutMs / 1000)} s.`);
    throw new LlmError(502, `Could not reach Gemini (${model}): ${err.message}`);
  }
  console.log(`[gemini] ${model} -> ${res.status} in ${Date.now() - started} ms`);
  if (res.ok) return { ...(await res.json()), _model: model };
  const text = await res.text();
  let msg = text;
  try { msg = JSON.parse(text)?.error?.message ?? text; } catch { /* keep raw */ }
  if (res.status === 404) msg = `Model "${model}" was not found (set GEMINI_MODEL to a model listed in Google AI Studio). ${msg}`;
  else if (res.status === 429) msg = `${model}: free-tier rate limit reached. ${msg}`;
  else msg = `${model}: ${msg}`;
  throw new LlmError(res.status, msg);
}

/**
 * Calls Gemini generateContent with a time limit. If a model is rate-limited, overloaded, slow or unknown,
 * it moves to the next model in modelChain(); with a single model it retries once after 2.5 s.
 */
export const geminiGenerate: GenerateFn = async (body, opts = {}) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new LlmError(503, "GEMINI_API_KEY is not set on the server, so the AI analyst is offline. Add it in your hosting settings.");
  const chain = opts.model ? [opts.model] : modelChain();
  const now = Date.now();
  const isBusy = (m: string) => (busyUntil.get(m) ?? 0) > now;
  const ordered = [...chain.filter((m) => !isBusy(m)), ...chain.filter(isBusy)];
  const attempts = ordered.length === 1 ? [ordered[0], ordered[0]] : ordered;
  const errors: LlmError[] = [];
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    if (i > 0 && model === attempts[i - 1]) await sleep(2500);
    const left = opts.deadline ? opts.deadline - Date.now() : Infinity;
    if (left < 3000) break;
    try {
      return await callModel(model, body, key, Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS(), left));
    } catch (e) {
      if (!(e instanceof LlmError) || !SKIPPABLE.has(e.status)) throw e;
      if (e.status !== 404) busyUntil.set(model, Date.now() + BUSY_MS);
      errors.push(e);
    }
  }
  if (!errors.length) throw new LlmError(504, "Ran out of time before Gemini could answer. Please try again.");
  const allRateLimited = errors.every((e) => e.status === 429);
  const head = allRateLimited
    ? "Gemini's free-tier rate limit is reached for every configured model. Wait a minute and try again."
    : "Gemini is busy or unavailable right now (Google-side). Please try again in a minute.";
  throw new LlmError(errors[errors.length - 1].status, `${head} Details: ${errors.map((e) => e.message).join(" | ")}`.slice(0, 1200));
};

function clip(value: unknown, max = 24000): unknown {
  const s = JSON.stringify(value ?? null);
  if (s.length <= max) return value;
  return { truncated: true, note: `Result was ${s.length} characters; showing the start. Narrow the query.`, preview: s.slice(0, max) };
}

export async function runCopilot(opts: { messages: ChatMessage[]; asOf?: string; generate?: GenerateFn; maxSteps?: number; budgetMs?: number }) {
  const generate = opts.generate ?? geminiGenerate;
  const deadline = Date.now() + (opts.budgetMs ?? 50_000);
  let model: string | undefined; // pinned after the first reply
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
    if (step > 0 && Date.now() > deadline - 3000) {
      return { reply: "I ran out of time before finishing this answer. Try a narrower question (for example one campaign or one date).", trace, pending, asOf, model };
    }
    const resp = await generate({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      tools: [{ functionDeclarations: functionDeclarations() }],
      toolConfig: { functionCallingConfig: { mode: "AUTO" } },
    }, { model, deadline });
    model = model ?? resp._model;
    if (resp.promptFeedback?.blockReason) {
      return { reply: `The model declined this request (${resp.promptFeedback.blockReason}). Try rephrasing.`, trace, pending, asOf, model };
    }
    const cand = resp.candidates?.[0];
    const content = cand?.content;
    if (!content?.parts?.length) {
      return { reply: `The model returned no answer (finish reason: ${cand?.finishReason ?? "unknown"}). Please try again.`, trace, pending, asOf, model };
    }
    // Keep the model turn exactly as returned: thought signatures must be sent back unchanged.
    contents.push({ role: "model", parts: content.parts });
    const calls = content.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      const reply = content.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
      return { reply: reply || "(no text returned)", trace, pending, asOf, model };
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
    trace, pending, asOf, model,
  };
}
