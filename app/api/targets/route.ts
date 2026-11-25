import { handle, body } from "@/lib/http";
import { addTargetVersion } from "@/lib/queries";
import { q } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => q(`select * from src_targets order by effective_at, _row`));
}

export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => addTargetVersion(b, "user"));
}
