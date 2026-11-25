/**
 * End-to-end management flows over HTTP against a running app.
 *   BASE_URL=http://localhost:3000 DATABASE_URL=... ADMIN_TOKEN=... npx tsx tests/api-flows.test.ts
 * Proves that edits persist and immediately change the analytics, and that resets restore the original data.
 */
import assert from "node:assert/strict";
import { executeTool } from "../lib/copilot/tools";
import { getPool } from "../lib/db";

const BASE = process.env.BASE_URL || "http://localhost:3000";
let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log("✓", name); }
  catch (e) { console.error("✗", name, "\n  ", e instanceof Error ? e.message : e); process.exitCode = 1; }
}
async function call(method: string, path: string, json?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json" }, body: json ? JSON.stringify(json) : undefined });
  return { status: r.status, body: await r.json() };
}
const spend = async (d: string) => (await call("GET", `/api/dashboard?asOf=${d}`)).body.overview.spend_inr as number;

async function main() {
  const base = await spend("2025-04-20");
  await test("baseline spend is the dataset value", async () => assert.equal(base, 274000));

  let rowA = 0, rowB = 0, actId = "";
  await test("adding a daily entry updates spend from its date onward only", async () => {
    const s18 = await spend("2025-04-18");
    const r = await call("POST", "/api/campaigns/C02/daily", { activity_date: "2025-04-19", marketing_spend_inr: 5000, impressions: 1000, clicks: 40 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    rowA = r.body._row; actId = r.body.activity_id;
    assert.equal(await spend("2025-04-20"), base + 5000);
    assert.equal(await spend("2025-04-18"), s18); // an earlier snapshot is unchanged by the new row
    const perf = (await call("GET", "/api/campaigns/C02?asOf=2025-04-20")).body.perf;
    assert.equal(perf.spend_inr, 93000 + 5000);
  });

  await test("a correction (same activity id) replaces the value, history kept", async () => {
    const r = await call("POST", "/api/campaigns/C02/daily", { activity_id: actId, activity_date: "2025-04-19", marketing_spend_inr: 3000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    rowB = r.body._row;
    assert.equal(await spend("2025-04-20"), base + 3000);
  });

  await test("deleting the correction falls back to the previous version, then to the original", async () => {
    assert.equal((await call("DELETE", `/api/daily/${rowB}`)).status, 200);
    assert.equal(await spend("2025-04-20"), base + 5000);
    assert.equal((await call("DELETE", `/api/daily/${rowA}`)).status, 200);
    assert.equal(await spend("2025-04-20"), base);
  });

  await test("source rows cannot be deleted", async () => {
    const r = await call("DELETE", "/api/daily/1");
    assert.equal(r.status, 400);
  });

  await test("campaign edits persist and are logged", async () => {
    const r = await call("PATCH", "/api/campaigns/C02", { status: "paused", planned_budget_inr: 55000, notes: "Retarget only" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const d = (await call("GET", "/api/campaigns/C02?asOf=2025-04-20")).body;
    assert.equal(d.campaign.status, "paused");
    assert.equal(d.campaign.planned_budget_inr, 55000);
    const perf = (await call("GET", "/api/dashboard?asOf=2025-04-20")).body.campaigns.find((c: any) => c.campaign_id === "C02");
    assert.equal(perf.status, "paused");
    const log = (await call("GET", "/api/activity")).body;
    assert.ok(log.some((l: any) => l.entity === "campaign" && l.entity_id === "C02"));
  });

  await test("new campaign can be created and receives data", async () => {
    const c = await call("POST", "/api/campaigns", { campaign_name: "Squad Pass referrals", channel: "referrals", owner_name: "Dev Malhotra", planned_budget_inr: 20000 });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.match(c.body.campaign_id, /^C\d+$/);
    const e = await call("POST", `/api/campaigns/${c.body.campaign_id}/daily`, { activity_date: "2025-04-05", marketing_spend_inr: 1500, landing_page_sessions: 120 });
    assert.equal(e.status, 200);
    const d = (await call("GET", "/api/dashboard?asOf=2025-04-20")).body.campaigns.find((x: any) => x.campaign_id === c.body.campaign_id);
    assert.equal(d.spend_inr, 1500);
    assert.equal(d.sessions, 120);
  });

  let taskId = "";
  await test("task create / move / edit / delete", async () => {
    const t = await call("POST", "/api/tasks", { title: "Promote the waitlist after each cancellation", campaign_id: "C04", owner_name: "Meera Iyer", due_date: "2025-03-25", priority: "high" });
    assert.equal(t.status, 200, JSON.stringify(t.body));
    taskId = t.body.id;
    assert.equal((await call("PATCH", `/api/tasks/${taskId}`, { status: "in_progress" })).body.status, "in_progress");
    assert.equal((await call("PATCH", `/api/tasks/${taskId}`, { owner_name: "Dev Malhotra" })).body.owner_name, "Dev Malhotra");
    const list = (await call("GET", "/api/tasks?campaign_id=C04")).body;
    assert.ok(list.some((x: any) => x.id === taskId));
    assert.equal((await call("DELETE", `/api/tasks/${taskId}`)).status, 200);
  });

  await test("input validation returns 400 with a message", async () => {
    assert.equal((await call("POST", "/api/tasks", { title: "" })).status, 400);
    assert.equal((await call("POST", "/api/campaigns/C01/daily", { activity_date: "2025-04-01", impressions: 10, clicks: 50 })).status, 400);
    assert.equal((await call("GET", "/api/dashboard?asOf=31-12-2025")).status, 400);
    assert.equal((await call("PATCH", "/api/campaigns/C01", { status: "exploded" })).status, 400);
  });

  await test("a new target version applies only from its effective date", async () => {
    const r = await call("POST", "/api/targets", { target_version: "April stretch", effective_date: "2025-04-01", identified_external_people_goal: 3600, registration_goal: 3200, unique_external_visitors_goal: 2500, marketing_budget_inr: 300000 });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await call("GET", "/api/dashboard?asOf=2025-03-31")).body.overview.visitors_goal, 2200);
    assert.equal((await call("GET", "/api/dashboard?asOf=2025-04-02")).body.overview.visitors_goal, 2500);
  });

  await test("changing an assumption changes the projection, and is reversible", async () => {
    const before = (await call("GET", "/api/dashboard?asOf=2025-03-20")).body.projection.projected_visitors;
    assert.equal((await call("PATCH", "/api/assumptions/expected_show_rate", { value: 0.7 })).status, 200);
    const after = (await call("GET", "/api/dashboard?asOf=2025-03-20")).body.projection.projected_visitors;
    assert.ok(after > before, `${after} > ${before}`);
    await call("PATCH", "/api/assumptions/expected_show_rate", { value: 0.65 });
    assert.equal((await call("GET", "/api/dashboard?asOf=2025-03-20")).body.projection.projected_visitors, before);
  });

  await test("AI proposal changes nothing until confirmed; confirm creates it once", async () => {
    const p = await executeTool("propose_task", { title: "Shift ₹15,000 from Paid Social to Student Referrals", campaign_id: "C05", owner_name: "Dev Malhotra", priority: "high", evidence: "C02 CPV ₹274 vs C05 ₹69 (2025-04-20)" }, { asOf: "2025-04-20" });
    assert.ok(p.ok, p.error ?? "");
    const id = (p.result as any).pending_action_id;
    const before = (await call("GET", "/api/tasks")).body.length;
    const c = await call("POST", `/api/actions/${id}`, { decision: "confirm" });
    assert.equal(c.status, 200, JSON.stringify(c.body));
    assert.equal(c.body.result.created_by, "ai_copilot");
    assert.equal((await call("GET", "/api/tasks")).body.length, before + 1);
    assert.equal((await call("POST", `/api/actions/${id}`, { decision: "confirm" })).status, 400);
    const p2 = await executeTool("propose_campaign_update", { campaign_id: "C03", status: "stopped", reason: "CPV 2.37x blended" }, { asOf: "2025-04-20" });
    const id2 = (p2.result as any).pending_action_id;
    assert.equal((await call("POST", `/api/actions/${id2}`, { decision: "cancel" })).body.status, "cancelled");
    assert.equal((await call("GET", "/api/campaigns/C03?asOf=2025-04-20")).body.campaign.status, "active");
  });

  await test("reset requires the admin token and restores the original data (tasks kept)", async () => {
    assert.equal((await call("POST", "/api/admin/setup", { token: "wrong", action: "reset" })).status, 400);
    const tasksBefore = (await call("GET", "/api/tasks")).body.length;
    const r = await call("POST", "/api/admin/setup", { token: process.env.ADMIN_TOKEN, action: "reset" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = (await call("GET", "/api/dashboard?asOf=2025-04-20")).body;
    assert.equal(o.overview.spend_inr, 274000);
    assert.equal(o.overview.visitors_goal, 2200);
    assert.equal(o.campaigns.find((c: any) => c.campaign_id === "C02").status, "active");
    assert.equal((await call("GET", "/api/tasks")).body.length, tasksBefore);
  });

  await getPool().end();
  console.log(`\n${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
