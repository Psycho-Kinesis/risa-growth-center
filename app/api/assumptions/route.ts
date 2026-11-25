import { handle } from "@/lib/http";
import { listAssumptions } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => listAssumptions());
}
