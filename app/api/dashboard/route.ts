import { handle } from "@/lib/http";
import { dashboard, defaultAsOf } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return handle(async () => {
    const url = new URL(req.url);
    const asOf = url.searchParams.get("asOf") || (await defaultAsOf());
    return dashboard(asOf);
  });
}
