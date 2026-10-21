import { NextResponse } from "next/server";
import { cronAuthorised } from "@/lib/auth";
import { sendDigest } from "@/lib/digest";
import { envStr } from "@/lib/env";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sends the digest. Same implementation as scripts/digest.ts, callable over HTTP. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!cronAuthorised(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const days = Number(url.searchParams.get("days") ?? 3);
  try {
    const outcome = await sendDigest({ days, appUrl: envStr("APP_URL") ?? url.origin });
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 500 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
