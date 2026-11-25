import { handle, body } from "@/lib/http";
import { listCampaigns, createCampaign } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(() => listCampaigns());
}

export async function POST(req: Request) {
  const b = await body(req);
  return handle(() => createCampaign(b, "user"));
}
