import { NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";
import { enabledSources } from "@/lib/sources/registry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * On-demand ingest, for triggering a refresh from the phone.
 *
 * The scheduled full run lives in GitHub Actions: a serverless function cannot
 * hold open the several hundred requests a complete pass makes, so this route
 * deliberately handles a bounded slice - fast adapters only, capped count.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = process.env.CRON_SECRET;
  const provided =
    url.searchParams.get("secret") ?? request.headers.get("authorization")?.replace("Bearer ", "");

  if (!secret || provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limit = Math.min(Number(url.searchParams.get("limit") ?? 40), 80);
  const kind = url.searchParams.get("kind");

  let sources = enabledSources({ includeBrowser: false });
  if (kind) sources = sources.filter((s) => s.kind === kind);
  sources = sources.slice(0, limit);

  try {
    const summary = await runIngest(sources, { concurrency: 8, recordHealth: true });
    return NextResponse.json({
      ok: true,
      sourcesRun: sources.length,
      fetched: summary.totalFetched,
      kept: summary.totalKept,
      inserted: summary.totalInserted,
      failed: summary.failed,
      skipped: summary.skipped,
      durationMs: summary.durationMs,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
