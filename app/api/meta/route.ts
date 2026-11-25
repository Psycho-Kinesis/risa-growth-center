import { handle } from "@/lib/http";
import { defaultAsOf, eventInfo } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Light call for the app shell: latest date with data and the event record. */
export async function GET() {
  return handle(async () => ({ asOf: await defaultAsOf(), event: await eventInfo() }));
}
