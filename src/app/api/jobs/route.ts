import { NextResponse } from "next/server";
import { queryJobs } from "@/lib/db";

export const dynamic = "force-dynamic";

/** JSON feed of the same data the dashboard shows. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const list = (k: string) => (url.searchParams.get(k) ?? "").split(",").filter(Boolean);

  try {
    const { jobs, total } = await queryJobs({
      city: url.searchParams.get("city") ?? "riyadh",
      tracks: list("tracks"),
      bands: list("bands"),
      sourceKind: url.searchParams.get("kind") ?? undefined,
      sourceId: url.searchParams.get("source") ?? undefined,
      search: url.searchParams.get("q") ?? undefined,
      sinceDays: url.searchParams.get("sinceDays")
        ? Number(url.searchParams.get("sinceDays"))
        : undefined,
      limit: Number(url.searchParams.get("limit") ?? 50),
      offset: Number(url.searchParams.get("offset") ?? 0),
      sort: (url.searchParams.get("sort") as "newest" | "posted" | "company") ?? "newest",
    });

    return NextResponse.json(
      { total, count: jobs.length, jobs },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
