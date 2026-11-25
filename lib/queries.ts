import { q, q1, tx, logActivity } from "./db";

export type Actor = "user" | "ai_copilot";

export class InputError extends Error {}

export function checkDate(d: unknown, name = "date"): string {
  if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d) || isNaN(Date.parse(d))) {
    throw new InputError(`${name} must be YYYY-MM-DD`);
  }
  return d;
}

function int(v: unknown, name: string, { min = -1e12, max = 1e12 } = {}): number {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : (v as number);
  if (typeof n !== "number" || !Number.isFinite(n) || Math.round(n) !== n || n < min || n > max) {
    throw new InputError(`${name} must be a whole number between ${min} and ${max}`);
  }
  return n;
}

function str(v: unknown, name: string, { max = 500, required = false } = {}): string | null {
  if (v === undefined || v === null || v === "") {
    if (required) throw new InputError(`${name} is required`);
    return null;
  }
  if (typeof v !== "string") throw new InputError(`${name} must be text`);
  const s = v.trim();
  if (s.length > max) throw new InputError(`${name} is too long (max ${max})`);
  if (required && !s) throw new InputError(`${name} is required`);
  return s || null;
}

function oneOf<T extends string>(v: unknown, name: string, options: readonly T[], fallback?: T): T {
  if ((v === undefined || v === null || v === "") && fallback) return fallback;
  if (typeof v !== "string" || !options.includes(v as T)) {
    throw new InputError(`${name} must be one of: ${options.join(", ")}`);
  }
  return v as T;
}

// ---------------------------------------------------------------- reads
export async function eventInfo() {
  return q1<{
    event_name: string; history_start: string; history_end: string;
    event_starts_at: string; event_ends_at: string; fictional: boolean;
  }>(`select event_name, history_start, history_end, event_starts_at, event_ends_at, fictional from src_event limit 1`);
}

/** Latest date that holds any data: the natural default for the as-of picker. */
export async function defaultAsOf(): Promise<string> {
  const r = await q1<{ d: string }>(`
    select greatest(
      (select max(activity_date) from v_campaign_daily),
      (select max(f_ist_date(occurred_at)) from v_checkins),
      (select history_end from src_event limit 1))::date::text as d`);
  return r?.d ?? "2025-04-20";
}

export async function dashboard(asOf: string) {
  checkDate(asOf, "asOf");
  const [overview, projection, funnel, campaigns, signals, daily, leading, targets, dq, ev] = await Promise.all([
    q1(`select * from f_overview($1)`, [asOf]),
    q1(`select * from f_projection($1)`, [asOf]),
    q(`select * from f_funnel($1)`, [asOf]),
    q(`select * from f_campaign_perf($1)`, [asOf]),
    q(`select * from f_campaign_signals($1)`, [asOf]),
    q(`select * from f_daily($1)`, [asOf]),
    q(`select * from f_leading_indicators($1)`, [asOf]),
    q(`select target_version, effective_at, identified_external_people_goal, registration_goal,
              unique_external_visitors_goal, marketing_budget_inr, origin
       from src_targets order by effective_at, _row`),
    q(`select * from v_data_quality`),
    eventInfo(),
  ]);
  return { asOf, overview, projection, funnel, campaigns, signals, daily, leading, targets, dataQuality: dq, event: ev };
}

export async function campaignDetail(id: string, asOf: string) {
  checkDate(asOf, "asOf");
  const campaign = await q1(`select * from src_campaigns where campaign_id = $1`, [id]);
  if (!campaign) throw new InputError(`Unknown campaign ${id}`);
  const [perf, funnel, daily, entries, tasks] = await Promise.all([
    q1(`select * from f_campaign_perf($1) where campaign_id = $2`, [asOf, id]),
    q(`select * from f_funnel($1, $2)`, [asOf, id]),
    q(`select * from f_daily($1, $2)`, [asOf, id]),
    q(`select _row, activity_id, activity_date, impressions, clicks, landing_page_sessions, registration_starts,
              marketing_spend_inr, platform, origin
       from v_campaign_daily where campaign_id = $1 order by activity_date desc, activity_id desc limit 60`, [id]),
    q(`select * from app_tasks where campaign_id = $1 order by status = 'done', due_date nulls last`, [id]),
  ]);
  return { campaign, perf, funnel, daily, entries, tasks };
}

export async function listCampaigns() {
  return q(`select * from src_campaigns order by campaign_id`);
}

// ---------------------------------------------------------------- campaigns
const CAMPAIGN_STATUS = ["planned", "active", "paused", "stopped", "completed"] as const;

export async function updateCampaign(id: string, patch: Record<string, unknown>, actor: Actor) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  const changed: Record<string, unknown> = {};
  if ("status" in patch) { vals.push(oneOf(patch.status, "status", CAMPAIGN_STATUS)); sets.push(`status = $${vals.length}`); changed.status = vals.at(-1); }
  if ("planned_budget_inr" in patch) {
    const v = patch.planned_budget_inr === null || patch.planned_budget_inr === "" ? null : int(patch.planned_budget_inr, "planned_budget_inr", { min: 0, max: 1e8 });
    vals.push(v); sets.push(`planned_budget_inr = $${vals.length}`); changed.planned_budget_inr = v;
  }
  if ("owner_name" in patch) { vals.push(str(patch.owner_name, "owner_name", { max: 80 })); sets.push(`owner_name = $${vals.length}`); changed.owner_name = vals.at(-1); }
  if ("notes" in patch) { vals.push(str(patch.notes, "notes", { max: 2000 })); sets.push(`notes = $${vals.length}`); changed.notes = vals.at(-1); }
  if (!sets.length) throw new InputError("Nothing to update");
  return tx(async (c) => {
    const before = (await c.query(`select status, planned_budget_inr, owner_name, notes from src_campaigns where campaign_id = $1`, [id])).rows[0];
    if (!before) throw new InputError(`Unknown campaign ${id}`);
    vals.push(id);
    const after = (await c.query(`update src_campaigns set ${sets.join(", ")}, updated_at = now() where campaign_id = $${vals.length} returning *`, vals)).rows[0];
    await logActivity(actor, "campaign", id, "update", { before, changed }, c);
    return after;
  });
}

export async function createCampaign(input: Record<string, unknown>, actor: Actor) {
  const name = str(input.campaign_name, "campaign_name", { required: true, max: 80 })!;
  const channel = str(input.channel, "channel", { required: true, max: 40 })!;
  return tx(async (c) => {
    const next = (await c.query(`select 'C' || lpad((coalesce(max(substring(campaign_id from 2)::int), 0) + 1)::text, 2, '0') id
                                 from src_campaigns where campaign_id ~ '^C[0-9]+$'`)).rows[0].id;
    const row = (await c.query(
      `insert into src_campaigns (campaign_id, campaign_name, channel, target_audience, objective, owner_name,
                                  created_at, planned_start_at, planned_end_at, status, planned_budget_inr, notes, origin)
       values ($1,$2,$3,$4,$5,$6, now(), $7::date, $8::date, $9, $10, $11, 'app') returning *`,
      [next, name, channel, str(input.target_audience, "target_audience"), str(input.objective, "objective"),
       str(input.owner_name, "owner_name", { max: 80 }),
       input.planned_start_at ? checkDate(input.planned_start_at, "planned_start_at") : null,
       input.planned_end_at ? checkDate(input.planned_end_at, "planned_end_at") : null,
       oneOf(input.status, "status", CAMPAIGN_STATUS, "planned"),
       input.planned_budget_inr ? int(input.planned_budget_inr, "planned_budget_inr", { min: 0, max: 1e8 }) : null,
       str(input.notes, "notes", { max: 2000 })])).rows[0];
    await logActivity(actor, "campaign", next, "create", row, c);
    return row;
  });
}

// ---------------------------------------------------------------- daily marketing
export async function addDailyEntry(campaignId: string, input: Record<string, unknown>, actor: Actor) {
  const date = checkDate(input.activity_date, "activity_date");
  const nums = Object.fromEntries(
    ["impressions", "clicks", "reported_reach", "landing_page_sessions", "registration_starts"].map((k) => [
      k, input[k] === undefined || input[k] === "" ? 0 : int(input[k], k, { min: 0, max: 1e9 }),
    ]),
  );
  const spend = input.marketing_spend_inr === undefined || input.marketing_spend_inr === "" ? 0
    : int(input.marketing_spend_inr, "marketing_spend_inr", { min: -1e7, max: 1e7 });
  if ((nums.clicks as number) > (nums.impressions as number) && (nums.impressions as number) > 0) {
    throw new InputError("clicks cannot exceed impressions");
  }
  return tx(async (c) => {
    const camp = (await c.query(`select campaign_name, owner_name, owner_id from src_campaigns where campaign_id = $1`, [campaignId])).rows[0];
    if (!camp) throw new InputError(`Unknown campaign ${campaignId}`);
    const activityId = input.activity_id ? str(input.activity_id, "activity_id", { max: 60 }) : `APP-${campaignId}-${date}-${Date.now().toString(36)}`;
    const row = (await c.query(
      `insert into src_campaign_daily (activity_id, campaign_id, campaign_name, owner_name, owner_id, activity_date,
        impressions, clicks, reported_reach, landing_page_sessions, registration_starts, marketing_spend_inr, platform, origin)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'app') returning *`,
      [activityId, campaignId, camp.campaign_name, camp.owner_name, camp.owner_id, date,
       nums.impressions, nums.clicks, nums.reported_reach, nums.landing_page_sessions, nums.registration_starts,
       spend, str(input.platform, "platform", { max: 60 }) ?? "manual entry"])).rows[0];
    await logActivity(actor, "daily_marketing", activityId, input.activity_id ? "correct" : "create", row, c);
    return row;
  });
}

export async function deleteAppDailyRow(rowId: number, actor: Actor) {
  return tx(async (c) => {
    const row = (await c.query(`delete from src_campaign_daily where _row = $1 and origin = 'app' returning *`, [rowId])).rows[0];
    if (!row) throw new InputError("Only rows added in the app can be deleted (source rows are kept as evidence; add a correction instead).");
    await logActivity(actor, "daily_marketing", row.activity_id, "delete", row, c);
    return row;
  });
}

// ---------------------------------------------------------------- tasks
const TASK_STATUS = ["todo", "in_progress", "blocked", "done"] as const;
const PRIORITY = ["low", "medium", "high"] as const;

export async function listTasks(filters: { status?: string; campaign_id?: string; owner?: string } = {}) {
  const where: string[] = [];
  const vals: unknown[] = [];
  if (filters.status) { vals.push(filters.status); where.push(`t.status = $${vals.length}`); }
  if (filters.campaign_id) { vals.push(filters.campaign_id); where.push(`t.campaign_id = $${vals.length}`); }
  if (filters.owner) { vals.push(`%${filters.owner}%`); where.push(`t.owner_name ilike $${vals.length}`); }
  return q(`select t.*, c.campaign_name from app_tasks t left join src_campaigns c using (campaign_id)
            ${where.length ? "where " + where.join(" and ") : ""}
            order by case t.status when 'blocked' then 0 when 'in_progress' then 1 when 'todo' then 2 else 3 end,
                     t.due_date nulls last, t.created_at desc`, vals);
}

export function validateTask(input: Record<string, unknown>, partial = false) {
  const out: Record<string, unknown> = {};
  if (!partial || "title" in input) out.title = str(input.title, "title", { required: true, max: 160 });
  if (!partial || "description" in input) out.description = str(input.description, "description", { max: 2000 });
  if (!partial || "campaign_id" in input) out.campaign_id = str(input.campaign_id, "campaign_id", { max: 10 });
  if (!partial || "owner_name" in input) out.owner_name = str(input.owner_name, "owner_name", { max: 80 });
  if (!partial || "due_date" in input) out.due_date = input.due_date ? checkDate(input.due_date, "due_date") : null;
  if (!partial || "status" in input) out.status = oneOf(input.status, "status", TASK_STATUS, "todo");
  if (!partial || "priority" in input) out.priority = oneOf(input.priority, "priority", PRIORITY, "medium");
  if (!partial || "evidence" in input) out.evidence = str(input.evidence, "evidence", { max: 2000 });
  return out;
}

export async function createTask(input: Record<string, unknown>, actor: Actor) {
  const t = validateTask(input);
  return tx(async (c) => {
    if (t.campaign_id) {
      const ok = (await c.query(`select 1 from src_campaigns where campaign_id = $1`, [t.campaign_id])).rowCount;
      if (!ok) throw new InputError(`Unknown campaign ${t.campaign_id}`);
    }
    const row = (await c.query(
      `insert into app_tasks (title, description, campaign_id, owner_name, due_date, status, priority, created_by, evidence)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [t.title, t.description, t.campaign_id, t.owner_name, t.due_date, t.status, t.priority, actor, t.evidence])).rows[0];
    await logActivity(actor, "task", row.id, "create", row, c);
    return row;
  });
}

export async function updateTask(id: string, patch: Record<string, unknown>, actor: Actor) {
  const t = validateTask(patch, true);
  const keys = Object.keys(t);
  if (!keys.length) throw new InputError("Nothing to update");
  return tx(async (c) => {
    const vals = keys.map((k) => t[k]);
    vals.push(id);
    const row = (await c.query(
      `update app_tasks set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}, updated_at = now()
       where id = $${vals.length} returning *`, vals)).rows[0];
    if (!row) throw new InputError("Task not found");
    await logActivity(actor, "task", id, "update", t, c);
    return row;
  });
}

export async function deleteTask(id: string, actor: Actor) {
  return tx(async (c) => {
    const row = (await c.query(`delete from app_tasks where id = $1 returning *`, [id])).rows[0];
    if (!row) throw new InputError("Task not found");
    await logActivity(actor, "task", id, "delete", row, c);
    return row;
  });
}

// ---------------------------------------------------------------- targets & assumptions
export async function addTargetVersion(input: Record<string, unknown>, actor: Actor) {
  const eff = checkDate(input.effective_date, "effective_date");
  const row = await tx(async (c) => {
    const r = (await c.query(
      `insert into src_targets (effective_at, identified_external_people_goal, registration_goal,
                                unique_external_visitors_goal, marketing_budget_inr, target_version, origin)
       values (($1::date)::timestamp at time zone 'Asia/Kolkata', $2, $3, $4, $5, $6, 'app') returning *`,
      [eff, int(input.identified_external_people_goal, "identified goal", { min: 0, max: 1e7 }),
       int(input.registration_goal, "registration goal", { min: 0, max: 1e7 }),
       int(input.unique_external_visitors_goal, "visitor goal", { min: 0, max: 1e7 }),
       int(input.marketing_budget_inr, "budget", { min: 0, max: 1e9 }),
       str(input.target_version, "target_version", { required: true, max: 80 })])).rows[0];
    await logActivity(actor, "target", r.target_version, "create", r, c);
    return r;
  });
  return row;
}

export async function listAssumptions() {
  return q(`select * from app_assumptions order by key`);
}

export async function updateAssumption(key: string, value: unknown, actor: Actor) {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) throw new InputError("value must be a number");
  return tx(async (c) => {
    const before = (await c.query(`select value from app_assumptions where key = $1`, [key])).rows[0];
    if (!before) throw new InputError(`Unknown assumption ${key}`);
    const row = (await c.query(`update app_assumptions set value = $1, updated_at = now() where key = $2 returning *`, [n, key])).rows[0];
    await logActivity(actor, "assumption", key, "update", { from: before.value, to: n }, c);
    return row;
  });
}

export async function recentActivity(limit = 50) {
  return q(`select * from app_activity_log order by at desc, id desc limit $1`, [Math.min(limit, 200)]);
}
