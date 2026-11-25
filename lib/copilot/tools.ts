import { q, q1 } from "../db";
import { checkDate, listTasks, validateTask, InputError } from "../queries";
import { calculate } from "./calc";
import { runReadOnly } from "./sqlguard";

export type ToolCtx = { asOf: string };
type Json = Record<string, unknown>;
type Tool = {
  name: string;
  description: string;
  parameters: Json; // JSON-schema subset accepted by Gemini functionDeclarations
  run: (args: Json, ctx: ToolCtx) => Promise<unknown>;
};

const AS_OF = {
  type: "string",
  description: "Snapshot date YYYY-MM-DD (end of day, IST). Omit to use the date selected in the app.",
};
const CAMPAIGN = { type: "string", description: "Campaign id such as C01. Omit for all campaigns." };

function d(args: Json, ctx: ToolCtx, key = "as_of") {
  return args[key] ? checkDate(args[key], key) : ctx.asOf;
}

const SCHEMA_DOC = `Read-only SQL over these views (Postgres). Views are already de-duplicated.
- v_people(person_id, person_name, person_type['external'|'internal'|'staff'|'test'], first_seen_at timestamptz, first_touch_source, first_campaign_id)
- v_lead_interactions(interaction_id, person_id, campaign_id, occurred_at timestamptz, event_type['page_visit'|'registration_start'|'brochure_download'|'event_question_submitted'|'nurture_email_sent'|'nurture_email_opened'|'nurture_email_clicked'|'opted_out'], detail)
- v_registrations(registration_id, person_id, campaign_id, registered_at timestamptz)
- v_registration_history(history_id, registration_id, person_id, campaign_id, effective_at timestamptz, status['interested'|'confirmed'|'cancelled'|'waitlisted'])
- v_checkins(event_id, person_id, registration_id, campaign_id, occurred_at timestamptz, result['admitted'|'denied'|'pending'], verification['verified'|'unverified'], source['scanner'|'manual'])
- v_campaign_daily(activity_id, campaign_id, activity_date date, impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr, platform, origin)
- src_campaigns(campaign_id, campaign_name, channel, target_audience, objective, owner_name, status, planned_budget_inr, notes)
- src_targets(effective_at, target_version, identified_external_people_goal, registration_goal, unique_external_visitors_goal, marketing_budget_inr)
- app_tasks(id, title, description, campaign_id, owner_name, due_date, status, priority, created_by, evidence)
Helpers: f_cutoff('YYYY-MM-DD') = end of that IST day (use "ts < f_cutoff(date)"); f_ist_date(ts) = IST date;
f_registrations_asof(date) -> registration_id, person_id, person_type, campaign_id, registered_at, status (status in force at that date);
f_visitors_asof(date) -> person_id, person_type, first_admitted_at, admission_events, registration_id, attributed_campaign_id, is_walk_in.
Rules: count PEOPLE with count(distinct person_id); filter person_type = 'external' for target metrics;
attendance = result 'admitted' AND verification 'verified'. Max 200 rows returned.`;

export const TOOLS: Tool[] = [
  {
    name: "get_overview",
    description:
      "Headline KPIs vs the targets in force on a date: identified people, registrations (and latest-status breakdown), unique verified visitors, walk-ins, spend vs budget, cost per registration/visitor, show rate, event phase, days to event.",
    parameters: { type: "object", properties: { as_of: AS_OF } },
    run: async (a, c) => q1(`select * from f_overview($1)`, [d(a, c)]),
  },
  {
    name: "get_campaign_performance",
    description:
      "Per-campaign table on a date: status, planned budget, impressions, clicks, sessions, spend, identified people (first touch), registered/confirmed/cancelled people, attributed visitors, opt-outs, emails, CTR, session->registration, registration->visit (show rate), cancel rate, opt-out rate, cost per registration, cost per visitor, shares of spend/registrations/visitors. Includes a 'Walk-in / unattributed' row.",
    parameters: { type: "object", properties: { as_of: AS_OF } },
    run: async (a, c) => q(`select * from f_campaign_perf($1)`, [d(a, c)]),
  },
  {
    name: "get_campaign_signals",
    description:
      "Scale / fix / stop / hold / insufficient-data signal per campaign with the reason. Uses cost per registration before the event and cost per verified visitor after, versus the blended value, plus opt-out and cancellation guardrails. Thresholds are assumptions.",
    parameters: { type: "object", properties: { as_of: AS_OF } },
    run: async (a, c) => q(`select * from f_campaign_signals($1)`, [d(a, c)]),
  },
  {
    name: "get_leading_indicators",
    description:
      "Early-warning indicators with targets, alert levels and status (good/watch/alert): registrations last 7 days vs previous 7, engaged share of registrants, referral share of new registrations, opt-out rate, cancellation rate, people stuck on the waitlist, projected visitors vs goal, budget pace. Each is linked to a strategic bet.",
    parameters: { type: "object", properties: { as_of: AS_OF } },
    run: async (a, c) => q(`select * from f_leading_indicators($1)`, [d(a, c)]),
  },
  {
    name: "get_funnel",
    description:
      "Funnel stages with conversion from the previous stage: impressions, clicks, landing-page sessions (anonymous counts), identified people, registered, confirmed, attended (verified). Overall or for one campaign.",
    parameters: { type: "object", properties: { as_of: AS_OF, campaign_id: CAMPAIGN } },
    run: async (a, c) => q(`select * from f_funnel($1, $2)`, [d(a, c), a.campaign_id || null]),
  },
  {
    name: "get_daily_trend",
    description:
      "Daily series (spend, impressions, clicks, sessions, new identified people, new registrations, new visitors) and cumulative totals, overall or for one campaign. Returns the last N days up to the as-of date (default 21).",
    parameters: {
      type: "object",
      properties: { as_of: AS_OF, campaign_id: CAMPAIGN, last_n_days: { type: "integer", description: "1-120, default 21" } },
    },
    run: async (a, c) => {
      const n = Math.min(Math.max(Number(a.last_n_days) || 21, 1), 120);
      const rows = await q(`select * from f_daily($1, $2)`, [d(a, c), a.campaign_id || null]);
      return rows.slice(-n);
    },
  },
  {
    name: "get_projection",
    description:
      "Projection to event day: registration run-rate (trailing window) x days left, x expected show rate (assumption) + expected walk-ins (assumption) vs the visitor goal; projected spend vs budget. After the event it returns actuals.",
    parameters: { type: "object", properties: { as_of: AS_OF } },
    run: async (a, c) => q1(`select * from f_projection($1)`, [d(a, c)]),
  },
  {
    name: "compare_dates",
    description:
      "Compare headline KPIs at two dates and return both snapshots plus the change. Use for 'what changed', week-over-week, or trend questions.",
    parameters: {
      type: "object",
      properties: {
        date_a: { type: "string", description: "Earlier date YYYY-MM-DD" },
        date_b: { type: "string", description: "Later date YYYY-MM-DD" },
      },
      required: ["date_a", "date_b"],
    },
    run: async (a) => {
      const [x, y] = await Promise.all([
        q1<Json>(`select * from f_overview($1)`, [checkDate(a.date_a, "date_a")]),
        q1<Json>(`select * from f_overview($1)`, [checkDate(a.date_b, "date_b")]),
      ]);
      const change: Json = {};
      for (const k of Object.keys(y || {})) {
        if (typeof y![k] === "number" && typeof x![k] === "number") change[k] = Math.round(((y![k] as number) - (x![k] as number)) * 1e4) / 1e4;
      }
      return { date_a: x, date_b: y, change_b_minus_a: change };
    },
  },
  {
    name: "get_targets_and_assumptions",
    description:
      "All target versions (with effective dates) and every model assumption with its value, unit, description and basis (sourced / derived from dataset / assumption). Use this to separate evidence from assumptions.",
    parameters: { type: "object", properties: {} },
    run: async () => ({
      targets: await q(`select target_version, effective_at, identified_external_people_goal, registration_goal,
                               unique_external_visitors_goal, marketing_budget_inr, origin from src_targets order by effective_at, _row`),
      assumptions: await q(`select key, value, unit, description, basis from app_assumptions order by key`),
    }),
  },
  {
    name: "list_campaigns",
    description: "Campaign records: id, name, channel, audience, objective, owner, planned dates, management status, planned budget and notes.",
    parameters: { type: "object", properties: {} },
    run: async () =>
      q(`select campaign_id, campaign_name, channel, target_audience, objective, owner_name, planned_start_at, planned_end_at,
                status, planned_budget_inr, notes, origin from src_campaigns order by campaign_id`),
  },
  {
    name: "list_tasks",
    description: "Tasks in the management tool, optionally filtered by status (todo, in_progress, blocked, done), campaign id or owner name.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", description: "todo | in_progress | blocked | done" },
        campaign_id: CAMPAIGN,
        owner: { type: "string", description: "Part of the owner's name" },
      },
    },
    run: async (a) =>
      listTasks({ status: (a.status as string) || undefined, campaign_id: (a.campaign_id as string) || undefined, owner: (a.owner as string) || undefined }),
  },
  {
    name: "query_data",
    description: `Run ONE read-only SQL query when no other tool answers the question. ${SCHEMA_DOC}`,
    parameters: {
      type: "object",
      properties: {
        sql: { type: "string", description: "A single SELECT or WITH query" },
        purpose: { type: "string", description: "One line: what this query answers" },
      },
      required: ["sql"],
    },
    run: async (a) => runReadOnly(String(a.sql)),
  },
  {
    name: "calculate",
    description:
      "Evaluate an arithmetic expression exactly (numbers, + - * / ** and parentheses; write 12% as 0.12). Use for every difference, ratio, share, what-if or reallocation.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "e.g. (2200 - 2050) / 2200" },
        label: { type: "string", description: "What the number means" },
      },
      required: ["expression"],
    },
    run: async (a) => ({ expression: a.expression, label: a.label ?? null, result: calculate(String(a.expression)) }),
  },
  {
    name: "propose_task",
    description:
      "Propose a new task in the management tool. It is NOT created until the user presses Confirm on the card shown in the chat. Include the evidence (specific numbers and date) that justifies it.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative title" },
        description: { type: "string", description: "What to do and how success is measured" },
        campaign_id: CAMPAIGN,
        owner_name: { type: "string", description: "Owner (use the campaign owner unless the user names someone)" },
        due_date: { type: "string", description: "YYYY-MM-DD" },
        priority: { type: "string", description: "low | medium | high" },
        evidence: { type: "string", description: "The data behind this task, with numbers and the as-of date" },
      },
      required: ["title", "evidence"],
    },
    run: async (a) => {
      const payload = validateTask({ ...a, status: "todo" });
      if (payload.campaign_id) {
        const ok = await q1(`select campaign_name from src_campaigns where campaign_id = $1`, [payload.campaign_id]);
        if (!ok) throw new InputError(`Unknown campaign ${payload.campaign_id}`);
      }
      const summary = `Create task "${payload.title}"${payload.owner_name ? ` for ${payload.owner_name}` : ""}${
        payload.due_date ? `, due ${payload.due_date}` : ""}${payload.campaign_id ? ` (${payload.campaign_id})` : ""}, priority ${payload.priority}`;
      const row = await q1<{ id: string }>(
        `insert into app_pending_actions (kind, payload, summary) values ('create_task', $1, $2) returning id`,
        [JSON.stringify(payload), summary]);
      return { pending_action_id: row!.id, summary, payload, needs_user_confirmation: true };
    },
  },
  {
    name: "propose_campaign_update",
    description:
      "Propose a change to a campaign: status (planned, active, paused, stopped, completed), planned_budget_inr, owner_name or notes. NOT applied until the user presses Confirm. Give the reason with numbers.",
    parameters: {
      type: "object",
      properties: {
        campaign_id: { type: "string", description: "Campaign id such as C02" },
        status: { type: "string", description: "planned | active | paused | stopped | completed" },
        planned_budget_inr: { type: "integer", description: "New planned budget in INR" },
        owner_name: { type: "string" },
        notes: { type: "string" },
        reason: { type: "string", description: "Why, with the supporting numbers" },
      },
      required: ["campaign_id", "reason"],
    },
    run: async (a) => {
      const id = String(a.campaign_id || "");
      const cur = await q1<Json>(`select campaign_id, campaign_name, status, planned_budget_inr, owner_name, notes from src_campaigns where campaign_id = $1`, [id]);
      if (!cur) throw new InputError(`Unknown campaign ${id}`);
      const patch: Json = {};
      for (const k of ["status", "planned_budget_inr", "owner_name", "notes"]) if (a[k] !== undefined && a[k] !== null && a[k] !== "") patch[k] = a[k];
      if (!Object.keys(patch).length) throw new InputError("Nothing to change: give status, planned_budget_inr, owner_name or notes");
      if (patch.status && !["planned", "active", "paused", "stopped", "completed"].includes(String(patch.status))) throw new InputError("bad status");
      if (patch.planned_budget_inr !== undefined && !(Number.isInteger(Number(patch.planned_budget_inr)) && Number(patch.planned_budget_inr) >= 0)) throw new InputError("planned_budget_inr must be a whole number >= 0");
      const parts = Object.entries(patch).map(([k, v]) => `${k}: ${cur[k] ?? "—"} → ${v}`);
      const summary = `Update ${cur.campaign_name} (${id}): ${parts.join("; ")}`;
      const row = await q1<{ id: string }>(
        `insert into app_pending_actions (kind, payload, summary) values ('update_campaign', $1, $2) returning id`,
        [JSON.stringify({ campaign_id: id, patch, reason: a.reason ?? null }), summary]);
      return { pending_action_id: row!.id, summary, before: cur, patch, needs_user_confirmation: true };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export async function executeTool(name: string, args: Json, ctx: ToolCtx): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  const tool = TOOL_MAP.get(name);
  if (!tool) return { ok: false, error: `Unknown tool ${name}` };
  try {
    return { ok: true, result: await tool.run(args || {}, ctx) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function functionDeclarations() {
  // Gemini rejects OBJECT schemas with empty `properties`, so parameter-less tools omit `parameters`.
  return TOOLS.map((t) => {
    const props = (t.parameters as { properties?: Json }).properties || {};
    return Object.keys(props).length
      ? { name: t.name, description: t.description, parameters: t.parameters }
      : { name: t.name, description: t.description };
  });
}
