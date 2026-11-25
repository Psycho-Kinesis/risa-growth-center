import { getPool } from "../db";

const FORBIDDEN =
  /\b(insert|update|delete|merge|upsert|drop|alter|create|grant|revoke|truncate|copy|call|do|execute|prepare|deallocate|listen|notify|unlisten|vacuum|analyze|cluster|reindex|comment|security|refresh|lock|set|reset|discard|into|begin|commit|rollback|savepoint|pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_import|lo_export|dblink|pg_terminate_backend|pg_cancel_backend|set_config)\b/i;

/** Validate that a query is a single read-only SELECT / WITH statement. Returns the cleaned SQL. */
export function checkReadOnlySql(sql: string): string {
  if (typeof sql !== "string" || !sql.trim()) throw new Error("sql is required");
  if (sql.length > 4000) throw new Error("sql is too long");
  let s = sql.trim().replace(/;+\s*$/, "");
  const noStrings = s.replace(/'(?:[^']|'')*'/g, "''").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  if (noStrings.includes(";")) throw new Error("Only one statement is allowed");
  if (!/^\s*(select|with)\b/i.test(noStrings)) throw new Error("Only SELECT / WITH queries are allowed");
  const bad = noStrings.match(FORBIDDEN);
  if (bad) throw new Error(`Keyword not allowed in read-only queries: ${bad[0]}`);
  s = s.replace(/--[^\n]*$/g, "");
  return s;
}

/** Run inside a READ ONLY transaction with a timeout and a row cap; always rolled back. */
export async function runReadOnly(sql: string, maxRows = 200) {
  const clean = checkReadOnlySql(sql);
  const client = await getPool().connect();
  try {
    await client.query("begin transaction read only");
    await client.query("set local statement_timeout = '5s'");
    const res = await client.query(`select * from (${clean}\n) as _q limit ${maxRows + 1}`);
    const rows = res.rows.slice(0, maxRows);
    return { rows, row_count: rows.length, truncated: res.rows.length > maxRows, columns: res.fields.map((f) => f.name) };
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}
