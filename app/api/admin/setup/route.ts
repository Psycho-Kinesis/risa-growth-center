import { handle, body } from "@/lib/http";
import { runSchema, loadSource, dbStatus } from "@/lib/setup";
import { InputError } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  return handle(() => dbStatus());
}

/**
 * POST { token, action: "init" | "reset" }
 *  init  — create/upgrade schema; load the original data if the tables are empty.
 *          On an EMPTY database no token is needed (first-time setup can't destroy anything).
 *  reset — create/upgrade schema and reload the ORIGINAL data (rows added in the app are removed; tasks are kept).
 *          Always needs ADMIN_TOKEN.
 */
export async function POST(req: Request) {
  const b = await body(req);
  return handle(async () => {
    const expected = process.env.ADMIN_TOKEN;
    const before = await dbStatus();
    const empty = !before.schema || !before.rows["src_checkins"];
    const tokenOk = !!expected && b.token === expected;
    if (!tokenOk && !(b.action === "init" && empty)) {
      throw new InputError(expected ? "Wrong admin token." : "ADMIN_TOKEN is not set on the server, so only first-time setup is allowed.");
    }
    await runSchema();
    if (b.action === "reset" || empty) {
      const res = await loadSource({ reset: true });
      return { ok: true, action: b.action === "reset" ? "reset" : "initial_load", ...res, status: await dbStatus() };
    }
    return { ok: true, action: "schema_upgraded", status: await dbStatus() };
  });
}
