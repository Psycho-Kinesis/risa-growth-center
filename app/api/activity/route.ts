import { handle } from "@/lib/http";
import { recentActivity } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => recentActivity(80));
}
