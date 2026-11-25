/**
 * Initialise (or reset) the database from the command line.
 *   DATABASE_URL=... npm run db:setup          # create schema + load original data (first time)
 *   DATABASE_URL=... npm run db:reset          # wipe source rows and reload the original data
 */
import { runSchema, loadSource, dbStatus } from "../lib/setup";
import { getPool } from "../lib/db";

async function main() {
  const reset = process.argv.includes("--reset");
  const before = await dbStatus();
  await runSchema();
  const needLoad = reset || !before.schema || !before.rows["src_checkins"];
  if (needLoad) {
    const res = await loadSource({ reset: true });
    console.log("Loaded original data:", res.loaded);
  } else {
    console.log("Schema updated. Source data already present (use --reset to reload).");
  }
  console.log("Status:", await dbStatus());
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
