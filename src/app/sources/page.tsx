import { sourceHealth, isConfigured } from "@/lib/db";
import { sourceStats } from "@/lib/sources/registry";
import { sectorCounts, COMPANIES, type CompanySeed } from "@/lib/sources/companies";

export const dynamic = "force-dynamic";

const KIND_LABELS: Record<string, string> = {
  ats: "Employer applicant-tracking systems",
  "career-page": "Company career pages",
  "job-board": "Job boards",
  aggregator: "Multi-employer APIs",
  government: "Government portals",
  rss: "RSS feeds",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default async function SourcesPage() {
  const stats = sourceStats();
  const sectors = sectorCounts();

  let health: Awaited<ReturnType<typeof sourceHealth>> = [];
  let healthError: string | null = null;
  if (isConfigured()) {
    try {
      health = await sourceHealth();
    } catch (err) {
      healthError = err instanceof Error ? err.message : String(err);
    }
  }

  const working = health.filter((h) => h.ok);
  const failing = health.filter((h) => !h.ok);

  return (
    <div className="py-2">
      <h1 className="text-xl font-bold sm:text-2xl" style={{ color: "var(--ink)" }}>
        Sources
      </h1>
      <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {stats.total} live sources built from {COMPANIES.length} employers plus the public job APIs.
        Employer applicant-tracking systems are polled directly, which is where a role appears first
        — usually days to weeks before it is syndicated to LinkedIn or Bayt.
      </p>

      {/* registry composition */}
      <section className="mt-6">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Registry
        </h2>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(stats.byKind)
            .sort((a, b) => b[1] - a[1])
            .map(([kind, n]) => (
              <div key={kind} className="surface p-3.5" style={{ borderRadius: "var(--radius)" }}>
                <div className="text-xl font-bold" style={{ color: "var(--ink)" }}>
                  {n}
                </div>
                <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-2)" }}>
                  {KIND_LABELS[kind] ?? kind}
                </div>
              </div>
            ))}
        </div>
      </section>

      {/* adapters */}
      <section className="mt-6">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Platforms covered
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(stats.byAdapter)
            .sort((a, b) => b[1] - a[1])
            .map(([adapter, n]) => (
              <span
                key={adapter}
                className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
              >
                {adapter}
                <span className="ml-1.5 opacity-60">{n}</span>
              </span>
            ))}
        </div>
      </section>

      {/* sectors */}
      <section className="mt-6">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Employers by sector
        </h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(sectors)
            .sort((a, b) => b[1] - a[1])
            .map(([sector, n]) => (
              <span
                key={sector}
                className="rounded-full px-2.5 py-1 text-[12px] font-medium"
                style={{ background: "var(--surface-2)", color: "var(--ink-2)" }}
              >
                {sector.replace(/-/g, " ")}
                <span className="ml-1.5 opacity-60">{n}</span>
              </span>
            ))}
        </div>
      </section>

      {/* live health */}
      <section className="mt-8">
        <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          Last run
        </h2>

        {healthError || health.length === 0 ? (
          <p className="surface mt-2 p-4 text-[13px]" style={{ color: "var(--ink-2)", borderRadius: "var(--radius)" }}>
            {healthError
              ? `Could not read source health: ${healthError}`
              : "No ingest run recorded yet. Run npm run ingest to populate this."}
          </p>
        ) : (
          <>
            <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
              {working.length} healthy &middot; {failing.length} failing
            </p>
            <div className="surface mt-2 overflow-x-auto" style={{ borderRadius: "var(--radius)" }}>
              <table className="w-full min-w-[560px] border-collapse text-[13px]">
                <thead>
                  <tr style={{ color: "var(--ink-3)" }}>
                    <th className="px-3 py-2 text-left font-semibold">Source</th>
                    <th className="px-3 py-2 text-left font-semibold">Platform</th>
                    <th className="px-3 py-2 text-right font-semibold">Kept</th>
                    <th className="px-3 py-2 text-right font-semibold">Last run</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {health.slice(0, 200).map((h) => (
                    <tr key={h.sourceId} style={{ borderTop: "1px solid var(--border)" }}>
                      <td className="px-3 py-2 font-medium" style={{ color: "var(--ink)" }}>
                        {h.label}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--ink-3)" }}>
                        {h.adapter}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: "var(--ink-2)" }}>
                        {h.kept}
                      </td>
                      <td className="px-3 py-2 text-right" style={{ color: "var(--ink-3)" }}>
                        {timeAgo(h.lastRunAt)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={
                            h.ok
                              ? { background: "var(--accent-soft)", color: "var(--accent-ink)" }
                              : { background: "var(--warn-soft)", color: "var(--warn-ink)" }
                          }
                          title={h.error ?? undefined}
                        >
                          {h.ok ? "ok" : `failing x${h.consecutiveFailures}`}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <ApplyByEmail />
      <EmployerDirectory />
    </div>
  );
}

/**
 * Employers that publish no machine-readable board and take CVs by email.
 * Automation cannot reach these, so the address itself is the deliverable.
 */
function ApplyByEmail() {
  const withEmail = COMPANIES.filter((c) => c.careersEmail).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  if (withEmail.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
        Apply by email
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        {withEmail.length} employers publish no job board that can be polled — they accept CVs at an
        address instead. Nothing can scrape these, so send speculatively and re-send when you see
        them hiring elsewhere.
      </p>
      <ul className="mt-3 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {withEmail.map((c) => (
          <li key={c.name} className="surface p-3" style={{ borderRadius: "var(--radius)" }}>
            <div className="text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
              {c.name}
            </div>
            <a
              href={`mailto:${c.careersEmail}?subject=${encodeURIComponent("Application - technology role, Riyadh")}`}
              className="mt-1 block truncate text-[12.5px] font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {c.careersEmail}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Every monitored employer with a direct link to its careers page, so a manual
 * check never means hunting for the URL again.
 */
function EmployerDirectory() {
  const bySector = new Map<string, CompanySeed[]>();
  for (const c of COMPANIES) {
    const list = bySector.get(c.sector) ?? [];
    list.push(c);
    bySector.set(c.sector, list);
  }
  const sectors = [...bySector.entries()].sort((a, b) => b[1].length - a[1].length);

  return (
    <section className="mt-8">
      <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
        Every employer monitored
      </h2>
      <p className="mt-1 max-w-2xl text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
        All {COMPANIES.length} careers pages, verified and linked. Open one directly if you want to
        check a company by hand.
      </p>

      <div className="mt-3 grid gap-3">
        {sectors.map(([sector, list]) => (
          <details key={sector} className="surface px-4 py-3" style={{ borderRadius: "var(--radius)" }}>
            <summary className="cursor-pointer text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
              {sector.replace(/-/g, " ")}
              <span className="ml-2 font-normal" style={{ color: "var(--ink-3)" }}>
                {list.length}
              </span>
            </summary>
            <ul className="mt-3 grid list-none gap-1.5 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {list
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((c) => (
                  <li key={c.name} className="min-w-0">
                    <a
                      href={c.careersUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate text-[12.5px] underline-offset-2 hover:underline"
                      style={{ color: "var(--ink-2)" }}
                      title={c.careersUrl}
                    >
                      {c.name}
                    </a>
                  </li>
                ))}
            </ul>
          </details>
        ))}
      </div>
    </section>
  );
}
