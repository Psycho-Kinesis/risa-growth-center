/**
 * Model fallback tests with a mocked network (no Google access needed).
 *   DATABASE_URL=... npm run test:gemini
 * - a busy, rate-limited, slow or unknown model hands over to the next one
 * - a model that was just busy is tried last on the next request
 * - real request errors (400) are not hidden by the fallback
 * - one conversation stays on the model that first answered
 */
import assert from "node:assert/strict";
import { geminiGenerate, modelChain, resetModelHealth, runCopilot, LlmError, type GenerateFn } from "../lib/copilot/agent";
import { getPool } from "../lib/db";

process.env.GEMINI_API_KEY = "test-key";
delete process.env.GEMINI_MODEL;
delete process.env.GEMINI_FALLBACK_MODELS;

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log("✓", name); }
  catch (e) { console.error("✗", name, "\n  ", e instanceof Error ? e.message : e); process.exitCode = 1; }
}

type Behaviour = number | "ok" | "hang";
const calls: string[] = [];
function mockFetch(byModel: Record<string, Behaviour[]>) {
  const used: Record<string, number> = {};
  calls.length = 0;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const model = decodeURIComponent(String(url).match(/models\/([^:]+):/)![1]);
    calls.push(model);
    const i = (used[model] = (used[model] ?? -1) + 1);
    const list = byModel[model] ?? ["ok"];
    const b = list[Math.min(i, list.length - 1)];
    if (b === "hang") {
      return new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "TimeoutError" }))));
    }
    if (b === "ok") {
      return new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: `hi from ${model}` }] } }] }), { status: 200 });
    }
    return new Response(JSON.stringify({ error: { message: `status ${b}` } }), { status: b });
  }) as typeof fetch;
}
const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };

async function main() {
  // A fake request that never resolves doesn't hold the event loop open the way a socket does; keep it alive.
  const keepAlive = setInterval(() => {}, 1000);
  await test("default chain is stable model first, then fallbacks", () => {
    assert.deepEqual(modelChain(), ["gemini-2.5-flash", "gemini-flash-latest", "gemini-flash-lite-latest"]);
  });

  await test("busy primary (503) hands over to the next model", async () => {
    resetModelHealth();
    mockFetch({ "gemini-2.5-flash": [503] });
    const r = await geminiGenerate(body);
    assert.equal(r._model, "gemini-flash-latest");
    assert.deepEqual(calls, ["gemini-2.5-flash", "gemini-flash-latest"]);
  });

  await test("a model that was just busy is tried last on the next request", async () => {
    mockFetch({});
    const r = await geminiGenerate(body);
    assert.equal(r._model, "gemini-flash-latest");
    assert.deepEqual(calls, ["gemini-flash-latest"]);
  });

  await test("slow model is cut off by the time limit and the next one answers", async () => {
    resetModelHealth();
    mockFetch({ "gemini-2.5-flash": ["hang"] });
    const t0 = Date.now();
    const r = await geminiGenerate(body, { timeoutMs: 300 });
    assert.equal(r._model, "gemini-flash-latest");
    assert.ok(Date.now() - t0 < 2000);
  });

  await test("rate limit (429) and unknown model (404) also hand over", async () => {
    resetModelHealth();
    mockFetch({ "gemini-2.5-flash": [429], "gemini-flash-latest": [404] });
    const r = await geminiGenerate(body);
    assert.equal(r._model, "gemini-flash-lite-latest");
  });

  await test("a bad request (400) is reported, not hidden by the fallback", async () => {
    resetModelHealth();
    mockFetch({ "gemini-2.5-flash": [400] });
    await assert.rejects(geminiGenerate(body), (e: unknown) => e instanceof LlmError && e.status === 400);
    assert.deepEqual(calls, ["gemini-2.5-flash"]);
  });

  await test("all models rate-limited gives a clear message", async () => {
    resetModelHealth();
    mockFetch({ "gemini-2.5-flash": [429], "gemini-flash-latest": [429], "gemini-flash-lite-latest": [429] });
    await assert.rejects(geminiGenerate(body), /rate limit is reached for every configured model/);
  });

  await test("a pinned model is retried once, never swapped", async () => {
    resetModelHealth();
    mockFetch({ "gemini-flash-latest": [503, "ok"] });
    const r = await geminiGenerate(body, { model: "gemini-flash-latest" });
    assert.equal(r._model, "gemini-flash-latest");
    assert.deepEqual(calls, ["gemini-flash-latest", "gemini-flash-latest"]);
  });

  await test("a conversation stays on the model that first answered", async () => {
    const seen: (string | undefined)[] = [];
    let step = 0;
    const fake: GenerateFn = async (_b, opts) => {
      seen.push(opts?.model);
      step++;
      if (step === 1) return { _model: "gemini-flash-latest", candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_overview", args: {} } }] } }] };
      return { _model: "gemini-flash-latest", candidates: [{ content: { role: "model", parts: [{ text: "done" }] } }] };
    };
    const out = await runCopilot({ messages: [{ role: "user", content: "how are we doing?" }], generate: fake });
    assert.deepEqual(seen, [undefined, "gemini-flash-latest"]);
    assert.equal(out.model, "gemini-flash-latest");
  });

  clearInterval(keepAlive);
  await getPool().end();
  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
