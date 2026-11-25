import { handle, body } from "@/lib/http";
import { campaignDetail, updateCampaign, defaultAsOf } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(async () => {
    const asOf = new URL(req.url).searchParams.get("asOf") || (await defaultAsOf());
    return campaignDetail(id, asOf);
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = await body(req);
  return handle(() => updateCampaign(id, b, "user"));
}
