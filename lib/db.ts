import { Pool, types, type PoolClient } from "pg";

// numeric / bigint come back as strings by default; the app wants numbers.
types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v))); // numeric
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10))); // int8
// Keep DATE as a plain 'YYYY-MM-DD' string (no timezone shifting).
types.setTypeParser(1082, (v) => v);

/**
 * DATABASE_URL, or POSTGRES_URL as set automatically by Vercel's Supabase integration.
 * `sslmode` in the URL would override the ssl option below (and make node-postgres verify
 * Supabase's pooler certificate chain), so TLS is configured here instead.
 */
function cleanUrl(u: string) {
  try {
    const x = new URL(u);
    for (const k of ["sslmode", "supa", "pgbouncer"]) x.searchParams.delete(k);
    return x.toString();
  } catch {
    return u;
  }
}
const connectionString = cleanUrl(process.env.DATABASE_URL || process.env.POSTGRES_URL || "");

function needsSsl(url: string) {
  return !!url && !/localhost|127\.0\.0\.1|sslmode=disable/.test(url);
}

const g = globalThis as unknown as { __pgPool?: Pool };

export function getPool(): Pool {
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set. Add it to your environment (see .env.example).");
  }
  if (!g.__pgPool) {
    g.__pgPool = new Pool({
      connectionString,
      ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
      max: 4,
      idleTimeoutMillis: 10_000,
    });
  }
  return g.__pgPool;
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params as never[]);
  return res.rows as T[];
}

export async function q1<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const out = await fn(client);
    await client.query("commit");
    return out;
  } catch (e) {
    await client.query("rollback").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export async function logActivity(
  actor: "user" | "ai_copilot" | "system",
  entity: string,
  entityId: string | null,
  action: string,
  details: unknown,
  client?: PoolClient,
) {
  const sql = `insert into app_activity_log (actor, entity, entity_id, action, details) values ($1,$2,$3,$4,$5)`;
  const params = [actor, entity, entityId, action, JSON.stringify(details ?? {})];
  if (client) await client.query(sql, params);
  else await q(sql, params);
}
