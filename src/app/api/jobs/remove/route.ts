import { NextResponse } from "next/server";
import { isAuthorised, writeSecret } from "@/lib/auth";
import { removeJob, restoreJob } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Remove a posting that is no longer available, or put one back.
 *
 * This is the only route in the app that writes to the jobs table on behalf of
 * a click, so it is worth being explicit about the trust model: the page is
 * readable by anyone with the link, and this route holds the service-role key.
 * Without a gate, anyone who found the URL could empty the board.
 *
 * REMOVAL_SECRET is that gate, falling back to CRON_SECRET. When neither
 * carries a value the route refuses outright rather than defaulting to open -
 * an app that quietly ships a public delete endpoint because a variable was
 * missing is worse than one that returns 503 until it is configured.
 *
 * See src/lib/auth.ts for why "carries a value" is not the same as "is set".
 */

interface Body {
  id?: string;
  action?: "remove" | "restore";
  reason?: string;
}

export async function POST(req: Request) {
  if (!writeSecret()) {
    return NextResponse.json(
      { ok: false, error: "removal is not configured: set REMOVAL_SECRET" },
      { status: 503 },
    );
  }
  if (!isAuthorised(req)) {
    return NextResponse.json({ ok: false, error: "not authorised" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const id = body.id?.trim();
  if (!id) {
    return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  }

  try {
    const changed =
      body.action === "restore" ? await restoreJob(id) : await removeJob(id, body.reason);

    // A no-op is reported as such rather than as success: the row was already
    // in the requested state, or the id does not exist.
    return NextResponse.json({ ok: true, changed, action: body.action ?? "remove" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
