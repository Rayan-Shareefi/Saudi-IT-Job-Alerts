import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { queueFix } from "@/lib/source-fix";

export const dynamic = "force-dynamic";

/**
 * Re-check employer careers URLs: queued for the laptop.
 *
 * The check opens a real browser on every employer, and a Vercel function
 * has none - pressing the button failed with "browserType.launch: Executable
 * doesn't exist" (2026-10-21). The laptop now checks the next 25 employers,
 * then verifies every URL it proposes and uses the ones that work by itself
 * (scripts/fix-sources.ts). The Check URLs page calls /api/fixes directly;
 * this stays for anything that still calls the old address.
 */
export async function POST(req: Request) {
  if (!writeSecret()) return NextResponse.json({ ok: false, error: "not configured: set REMOVAL_SECRET" }, { status: 503 });
  if (!isAuthorised(req)) return NextResponse.json({ ok: false, error: "not authorised" }, { status: 401 });
  try {
    const fix = await queueFix({ company: "*", page: "urls", requestedBy: "user" });
    return NextResponse.json({ ok: true, queued: true, fix });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
