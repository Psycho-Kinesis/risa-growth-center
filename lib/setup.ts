import fs from "node:fs";
import path from "node:path";
import { getPool, logActivity } from "./db";

const SQL_FILES = ["01_schema.sql", "02_views.sql", "03_metrics.sql", "04_seed_assumptions.sql"];
const LOAD_ORDER = [
  "src_event",
  "src_targets",
  "src_campaigns",
  "src_campaign_daily",
  "src_people",
  "src_lead_interactions",
  "src_registrations",
  "src_registration_history",
  "src_checkins",
];
const CHUNK = 2500;

function root() {
  return process.cwd();
}

export async function runSchema() {
  const pool = getPool();
  for (const f of SQL_FILES) {
    const sql = fs.readFileSync(path.join(root(), "db", f), "utf8");
    await pool.query(sql);
  }
  return { ran: SQL_FILES };
}

type Seed = { table: string; columns: string[]; rows: unknown[][] };

function readSeed(table: string): Seed {
  return JSON.parse(fs.readFileSync(path.join(root(), "data", "seed", `${table}.json`), "utf8"));
}

/**
 * Load the ORIGINAL supplied rows (duplicates included).
 * reset=true first removes every source row, including rows added in the app,
 * and puts campaign management fields back to their defaults.
 */
export async function loadSource({ reset }: { reset: boolean }) {
  const client = await getPool().connect();
  const loaded: Record<string, number> = {};
  try {
    await client.query("begin");
    if (reset) {
      await client.query(`truncate src_checkins, src_registration_history, src_registrations,
                          src_lead_interactions, src_people, src_campaign_daily, src_targets restart identity`);
      await client.query("delete from src_event");
    }
    for (const table of LOAD_ORDER) {
      const seed = readSeed(table);
      const cols = seed.columns;
      const colList = cols.join(", ");
      for (let i = 0; i < seed.rows.length; i += CHUNK) {
        const objs = seed.rows.slice(i, i + CHUNK).map((r) => Object.fromEntries(cols.map((c, j) => [c, r[j]])));
        let sql = `insert into ${table} (${colList}) select ${colList} from json_populate_recordset(null::${table}, $1::json)`;
        if (table === "src_campaigns") {
          const sets = cols.filter((c) => c !== "campaign_id").map((c) => `${c} = excluded.${c}`);
          if (reset) sets.push("status = 'active'", "planned_budget_inr = null", "notes = null", "origin = 'source'");
          sets.push("updated_at = now()");
          sql += ` on conflict (campaign_id) do update set ${sets.join(", ")}`;
        } else if (table === "src_event") {
          sql += " on conflict (event_name) do nothing";
        }
        await client.query(sql, [JSON.stringify(objs)]);
      }
      loaded[table] = seed.rows.length;
    }
    if (reset) {
      // campaigns created in the app are removed only if no task points at them
      await client.query(`delete from src_campaigns c where c.origin = 'app'
                          and not exists (select 1 from app_tasks t where t.campaign_id = c.campaign_id)`);
    }
    await logActivity("system", "dataset", null, reset ? "reset_to_original" : "initial_load", loaded, client);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  return { loaded };
}

export async function dbStatus() {
  const pool = getPool();
  const exists = await pool.query(`select to_regclass('public.src_checkins') is not null as ok,
                                          to_regprocedure('f_leading_indicators(date)') is not null as fn`);
  if (!exists.rows[0].ok) return { schema: false, functions: false, rows: {} };
  const r = await pool.query(`select 'src_checkins' t, count(*)::int n from src_checkins
                              union all select 'src_registrations', count(*)::int from src_registrations
                              union all select 'src_people', count(*)::int from src_people
                              union all select 'src_campaign_daily', count(*)::int from src_campaign_daily
                              union all select 'app_tasks', count(*)::int from app_tasks`);
  return {
    schema: true,
    functions: !!exists.rows[0].fn,
    rows: Object.fromEntries(r.rows.map((x: { t: string; n: number }) => [x.t, x.n])),
  };
}
