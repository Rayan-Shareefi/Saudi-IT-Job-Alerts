import coverage from "../../data/coverage.json";

interface CoverageRow {
  company: string;
  sector: string;
  priority: number;
  careersUrl: string;
  careersEmail?: string;
  careersEmails?: Array<{ address: string; purpose?: string }>;
  verdict: string;
  reason: string;
  suggestedUrl?: string;
  needsHuman: boolean;
}

const GROUPS: Array<{ verdict: string; title: string; blurb: string; tone: "warn" | "info" }> = [
  {
    verdict: "blocked",
    title: "Blocked to automation",
    blurb:
      "The URL is correct and opens normally in your browser — Cloudflare or Akamai simply refuses anything scripted. Nothing can be done from this side without impersonating a signed-in session, so these are worth checking by hand.",
    tone: "warn",
  },
  {
    verdict: "email-only",
    title: "No board — apply by email",
    blurb:
      "These employers publish no job board at all. The address was harvested from the page linked beside it.",
    tone: "info",
  },
  {
    verdict: "no-postings-read",
    title: "Reached, but nothing could be read",
    blurb:
      "The page opened without error and no postings came off it. That means one of two things and the collector cannot tell which: the employer genuinely has nothing open, or their listing is built in a way the extractor cannot see. Worth a look — if you find roles on one of these, the page is the bug.",
    tone: "info",
  },
  {
    verdict: "unreachable",
    title: "No working careers URL found",
    blurb:
      "The domain does not resolve, or every candidate page 404s. Usually the company moved or rebranded — if you know the right URL, paste it into src/lib/sources/companies.ts.",
    tone: "warn",
  },
];

function Row({ row }: { row: CoverageRow }) {
  return (
    <li>
      <article className="surface p-4" style={{ borderRadius: "var(--radius-lg)" }}>
        <h3 className="text-[14px] font-semibold leading-snug" style={{ color: "var(--ink)" }}>
          {row.company}
        </h3>
        <p className="mt-0.5 text-[11.5px] uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
          {row.sector.replace(/-/g, " ")}
        </p>

        <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
          {row.reason}
        </p>

        {/* Every inbox, not just the first: a co-op application sent to the
            general careers address is one that gets ignored. */}
        {[
          ...(row.careersEmail ? [{ address: row.careersEmail, purpose: undefined as string | undefined }] : []),
          ...(row.careersEmails ?? []),
        ].map((e) => (
          <div key={e.address} className="mt-2">
            <a
              href={`mailto:${e.address}?subject=${encodeURIComponent(
                /co-?op|train|intern|student|graduate/i.test(e.address)
                  ? "Co-op / internship application - Riyadh"
                  : "Application - technology role, Riyadh",
              )}`}
              className="block truncate text-[12.5px] font-semibold underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {e.address}
            </a>
            {e.purpose && (
              <span className="text-[11px]" style={{ color: "var(--ink-3)" }}>
                {e.purpose}
              </span>
            )}
          </div>
        ))}

        {/* A domain found by probing and verified to carry this company's own
            name. Offered rather than applied: picking the right domain for an
            ambiguous name is a judgement call. */}
        {row.suggestedUrl && (
          <a
            href={row.suggestedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 block truncate text-[12.5px] font-semibold underline-offset-2 hover:underline"
            style={{ color: "var(--accent)" }}
            title={row.suggestedUrl}
          >
            Try {row.suggestedUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 40)} &rarr;
          </a>
        )}

        <a
          href={row.careersUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 block truncate text-[12px] font-semibold underline-offset-2 hover:underline"
          style={{ color: "var(--accent)" }}
          title={row.careersUrl}
        >
          Open {row.careersUrl.replace(/^https?:\/\/(www\.)?/, "").slice(0, 46)} &rarr;
        </a>
      </article>
    </li>
  );
}

/**
 * Employers no scraper will ever reach, grouped by why.
 *
 * They are listed rather than dropped because "we cannot read this site" is not
 * the same as "this employer is not hiring" — several of these are among the
 * largest tech employers in Riyadh. The link is the deliverable.
 */
export function HumanIntervene() {
  const rows = (coverage as { rows: CoverageRow[] }).rows ?? [];
  const needing = rows.filter((r) => r.needsHuman);

  return (
    <section>
      <div
        className="mb-4 px-4 py-3 text-[13px] leading-relaxed"
        style={{ background: "var(--warn-soft)", color: "var(--warn-ink)", borderRadius: "var(--radius)" }}
        role="note"
      >
        <strong>{needing.length} employers need you to look yourself.</strong> Every one has been
        tried repeatedly and cannot be read automatically. They are grouped by the reason, with a
        working link each — several are major Riyadh tech employers, so they are worth a manual
        check rather than being written off as not hiring.
      </div>

      {needing.length === 0 ? (
        <div className="surface px-6 py-12 text-center" style={{ borderRadius: "var(--radius-lg)" }}>
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            Nothing needs manual attention
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px]" style={{ color: "var(--ink-2)" }}>
            Run <code>npm run coverage</code> to rebuild this list after the next collection pass.
          </p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const list = needing
            .filter((r) => r.verdict === g.verdict)
            .sort((a, b) => a.priority - b.priority || a.company.localeCompare(b.company));
          if (list.length === 0) return null;
          return (
            <div key={g.verdict} className="mb-7">
              <h2 className="text-[13px] font-bold uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
                {g.title} <span style={{ color: "var(--ink-3)" }}>({list.length})</span>
              </h2>
              <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                {g.blurb}
              </p>
              <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
                {list.map((r) => (
                  <Row key={r.company} row={r} />
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
