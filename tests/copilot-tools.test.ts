/**
 * Copilot tests against a real database (no LLM needed).
 *   DATABASE_URL=... npm run test:copilot
 * 1. every tool runs on live data and returns sensible values
 * 2. the read-only SQL guard blocks writes / multiple statements / dangerous functions
 * 3. the calculator is exact and refuses anything but arithmetic
 * 4. the agent loop, driven by a scripted model, preserves thought signatures and
 *    function-call ids, executes tools, and returns proposals that need confirmation
 */
import assert from "node:assert/strict";
import { executeTool, TOOLS } from "../lib/copilot/tools";
import { checkReadOnlySql } from "../lib/copilot/sqlguard";
import { calculate } from "../lib/copilot/calc";
import { runCopilot, type GenerateFn } from "../lib/copilot/agent";
import { getPool, q } from "../lib/db";

let passed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try { await fn(); passed++; console.log("✓", name); }
  catch (e) { console.error("✗", name, "\n  ", e instanceof Error ? e.message : e); process.exitCode = 1; }
}

const ctx = { asOf: "2025-04-20" };

async function main() {
  await test("get_overview matches verified numbers", async () => {
    const r = await executeTool("get_overview", {}, ctx);
    assert.ok(r.ok, r.error ?? "");
    const o = r.result as Record<string, number | string>;
    assert.equal(o.unique_external_visitors, 2050);
    assert.equal(o.registered_external_people, 2800);
    assert.equal(o.visitors_goal, 2200);
  });

  await test("as_of argument overrides the app date (no leakage)", async () => {
    const r = await executeTool("get_overview", { as_of: "2025-03-14" }, ctx);
    const o = r.result as Record<string, number | string>;
    assert.equal(o.unique_external_visitors, 0);
    assert.equal(o.target_version, "Attendee launch plan");
  });

  for (const name of ["get_campaign_performance", "get_campaign_signals", "get_leading_indicators", "get_funnel",
    "get_daily_trend", "get_projection", "get_targets_and_assumptions", "list_campaigns", "list_tasks"]) {
    await test(`${name} runs`, async () => {
      const r = await executeTool(name, {}, ctx);
      assert.ok(r.ok, r.error ?? "");
      assert.ok(r.result !== null && r.result !== undefined);
    });
  }

  await test("get_funnel for one campaign", async () => {
    const r = await executeTool("get_funnel", { campaign_id: "C04" }, ctx);
    const rows = r.result as { stage: string; value: number }[];
    assert.equal(rows.find((x) => x.stage === "Attended (verified)")!.value, 385);
  });

  await test("compare_dates returns change", async () => {
    const r = await executeTool("compare_dates", { date_a: "2025-03-13", date_b: "2025-03-20" }, ctx);
    assert.ok(r.ok, r.error ?? "");
    const c = (r.result as { change_b_minus_a: Record<string, number> }).change_b_minus_a;
    assert.ok(c.registered_external_people > 0);
  });

  await test("query_data answers an ad-hoc question", async () => {
    const r = await executeTool("query_data", {
      sql: `select c.source, count(distinct c.person_id) people from v_checkins c join v_people p using (person_id)
            where p.person_type = 'external' and c.result = 'admitted' and c.verification = 'verified'
              and c.occurred_at < f_cutoff('2025-04-20') group by 1 order by 1`,
    }, ctx);
    assert.ok(r.ok, r.error ?? "");
    assert.ok((r.result as { rows: unknown[] }).rows.length >= 1);
  });

  await test("query_data cannot write (guard)", () => {
    for (const bad of [
      "delete from app_tasks",
      "select 1; drop table app_tasks",
      "with x as (delete from app_tasks returning *) select * from x",
      "select pg_sleep(10)",
      "update src_campaigns set status='stopped'",
      "select * into t2 from app_tasks",
    ]) assert.throws(() => checkReadOnlySql(bad), `should reject: ${bad}`);
    assert.doesNotThrow(() => checkReadOnlySql("select status, count(*) from app_tasks where title like '%update%' group by 1"));
  });

  await test("query_data runs read-only even if the guard were bypassed", async () => {
    const client = await getPool().connect();
    try {
      await client.query("begin transaction read only");
      await assert.rejects(client.query("insert into app_assumptions(key,value,description,basis) values ('x',1,'x','x')"));
    } finally { await client.query("rollback"); client.release(); }
  });

  await test("calculate is exact and safe", () => {
    assert.equal(calculate("(2200 - 2050) / 2200"), 0.068182);
    assert.equal(calculate("93000 / 340"), 273.529412);
    assert.equal(calculate("1,00,000 * 0.12"), 12000);
    assert.throws(() => calculate("process.exit()"));
    assert.throws(() => calculate("2 ** constructor"));
  });

  await test("propose_task creates a pending action, not a task", async () => {
    const before = (await q<{ n: number }>(`select count(*)::int n from app_tasks`))[0].n;
    const r = await executeTool("propose_task", {
      title: "Promote waitlisted registrants", campaign_id: "C04", owner_name: "Meera Iyer",
      due_date: "2025-03-25", priority: "high", evidence: "54 waitlisted while 119 cancelled as of 2025-03-20",
    }, ctx);
    assert.ok(r.ok, r.error ?? "");
    const after = (await q<{ n: number }>(`select count(*)::int n from app_tasks`))[0].n;
    assert.equal(after, before);
    const id = (r.result as { pending_action_id: string }).pending_action_id;
    const p = await q<{ status: string }>(`select status from app_pending_actions where id = $1`, [id]);
    assert.equal(p[0].status, "pending");
  });

  await test("propose_campaign_update validates input", async () => {
    const bad = await executeTool("propose_campaign_update", { campaign_id: "C99", status: "paused", reason: "x" }, ctx);
    assert.equal(bad.ok, false);
    const none = await executeTool("propose_campaign_update", { campaign_id: "C02", reason: "x" }, ctx);
    assert.equal(none.ok, false);
    const good = await executeTool("propose_campaign_update", { campaign_id: "C02", planned_budget_inr: 55000, reason: "CPV 1.92x blended" }, ctx);
    assert.ok(good.ok, good.error ?? "");
  });

  await test("unknown tool and bad args return errors, not crashes", async () => {
    assert.equal((await executeTool("drop_everything", {}, ctx)).ok, false);
    assert.equal((await executeTool("get_overview", { as_of: "yesterday" }, ctx)).ok, false);
  });

  await test("every tool has a description and object parameters", () => {
    for (const t of TOOLS) {
      assert.ok(t.description.length > 20, t.name);
      assert.equal((t.parameters as { type: string }).type, "object");
    }
  });

  // ---- agent loop with a scripted model ---------------------------------
  await test("agent loop: tools run, signatures and ids are sent back, proposal surfaced", async () => {
    const seen: Record<string, unknown>[] = [];
    let step = 0;
    const fake: GenerateFn = async (body) => {
      seen.push(JSON.parse(JSON.stringify(body)));
      step++;
      if (step === 1) return { candidates: [{ content: { role: "model", parts: [
        { functionCall: { name: "get_overview", args: { as_of: "2025-03-20" }, id: "call-1" }, thoughtSignature: "SIG-A" },
        { functionCall: { name: "get_leading_indicators", args: { as_of: "2025-03-20" }, id: "call-2" } },
      ] } }] };
      if (step === 2) return { candidates: [{ content: { role: "model", parts: [
        { functionCall: { name: "propose_task", id: "call-3", args: { title: "Promote the waitlist", owner_name: "Meera Iyer", priority: "high", evidence: "54 waitlisted on 2025-03-20" } }, thoughtSignature: "SIG-B" },
      ] } }] };
      return { candidates: [{ content: { role: "model", parts: [{ text: "Thinking...", thought: true }, { text: "We are behind. I proposed a task; please confirm it.\nData: get_overview(2025-03-20)" }] } }] };
    };
    const out = await runCopilot({ messages: [{ role: "user", content: "Are we on track?" }], asOf: "2025-03-20", generate: fake });
    assert.equal(step, 3);
    assert.equal(out.trace.length, 3);
    assert.ok(out.trace.every((t) => t.ok), JSON.stringify(out.trace));
    assert.equal(out.pending.length, 1);
    assert.ok(!out.reply.includes("Thinking..."), "thought parts must not leak into the reply");
    // second request must contain the first model turn unchanged (signature) + function responses with ids
    const c2 = seen[1].contents as { role: string; parts: Record<string, any>[] }[];
    const modelTurn = c2.find((c) => c.role === "model")!;
    assert.equal(modelTurn.parts[0].thoughtSignature, "SIG-A");
    const fr = c2[c2.length - 1].parts.map((p) => p.functionResponse);
    assert.deepEqual(fr.map((f) => f.id), ["call-1", "call-2"]);
    assert.equal(fr[0].response.result.registered_external_people, 1778);
    // the system prompt carries the selected date and the honesty rules
    const sys = (seen[0].systemInstruction as { parts: { text: string }[] }).parts[0].text;
    assert.ok(sys.includes("2025-03-20") && /cannot answer/i.test(sys));
    // tools declared; parameter-less tools omit `parameters`
    const decl = (seen[0].tools as { functionDeclarations: Record<string, unknown>[] }[])[0].functionDeclarations;
    assert.equal(decl.length, TOOLS.length);
    assert.ok(!("parameters" in decl.find((d) => d.name === "list_campaigns")!));
    assert.ok(!("temperature" in ((seen[0].generationConfig as object) || {})), "no deprecated sampling params");
  });

  await test("agent loop: tool errors are reported back to the model", async () => {
    let step = 0;
    let errSeen = "";
    const fake: GenerateFn = async (body) => {
      step++;
      if (step === 1) return { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "query_data", args: { sql: "delete from app_tasks" } } }] } }] };
      const c = body.contents as { parts: Record<string, any>[] }[];
      errSeen = c[c.length - 1].parts[0].functionResponse.response.error;
      return { candidates: [{ content: { role: "model", parts: [{ text: "I can't change data that way." }] } }] };
    };
    const out = await runCopilot({ messages: [{ role: "user", content: "delete all tasks" }], generate: fake });
    assert.match(errSeen, /not allowed|Only SELECT/);
    assert.equal(out.trace[0].ok, false);
  });

  await getPool().end();
  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
