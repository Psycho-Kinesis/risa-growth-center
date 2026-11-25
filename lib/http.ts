import { NextResponse } from "next/server";
import { InputError } from "./queries";

export function ok(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function handle(fn: () => Promise<unknown>) {
  try {
    return ok(await fn());
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (e instanceof InputError) return ok({ error: msg }, 400);
    console.error(e);
    const hint = /DATABASE_URL|ECONNREFUSED|does not exist|relation .* does not exist|function .* does not exist/i.test(msg)
      ? " — is the database set up? Open /setup."
      : "";
    return ok({ error: msg + hint }, 500);
  }
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : {};
  } catch {
    return {};
  }
}
