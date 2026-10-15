import type { SourceReport } from "@/lib/db";

/**
 * Every employer site that could not be read, why, and what fixes it.
 *
 * The user asked to be told about every site the collector failed on and how
 * to fix each. Sites are grouped by the kind of problem, because the fix is
 * the same within a group; within a group, priority employers come first.
 */

const GROUPS: Array<{ verdict: string; title: string; blurb: string }> = [
  {
    verdict: "blocked",
    title: "Blocked to automated readers",
    blurb:
      "The site refuses scripted visitors (Cloudflare / Akamai). We do not try to get around that. The fix is another route to the same jobs: the company's LinkedIn page and JSearch are searched for it instead, and the link below opens the site for you.",
  },
  {
    verdict: "login-required",
    title: "Needs a personal login",
    blurb:
      "Portals like Jadarat need Nafath approval on your phone for every sign-in, so no program can read them. Check these by hand.",
  },
  {
    verdict: "wrong-url",
    title: "The careers link is wrong",
    blurb: "The page loads but is not a job list. Where a better URL was found it is shown; Check URLs can accept it in one click.",
  },
  {
    verdict: "unreachable",
    title: "No working careers page found",
    blurb: "The domain does not resolve or every candidate page fails. Usually a rebrand or move - the employer is still searched on LinkedIn and JSearch.",
  },
  {
    verdict: "needs-navigation",
    title: "Jobs are behind a button or search",
    blurb:
      "The careers page opens but the openings appear only after clicking something like \"Search jobs\". A navigation recipe is tried automatically; the ones still here need one added.",
  },
  {
    verdict: "email-only",
    title: "No job board - apply by email",
    blurb: "These employers publish an email address instead of a job list. See the Apply by email tab.",
  },
  {
    verdict: "no-postings-read",
    title: "Opened, but no postings could be read",
    blurb: "The page loaded without error and nothing came off it: either nothing is open, or the list is built in a way the reader cannot see yet.",
  },
];

export function SiteReport({ rows }: { rows: SourceReport[] }) {
  if (rows.length === 0) {
    return (
      <p className="surface px-6 py-12 text-center text-[13px]" style={{ borderRadius: "var(--radius-lg)", color: "var(--ink-2)" }}>
        No site report yet. It is written by <code>npm run sites:diagnose</code>, which the nightly run calls.
      </p>
    );
  }
  const known = new Set(GROUPS.map((g) => g.verdict));
  const other = rows.filter((r) => !known.has(r.verdict));
  return (
    <div className="space-y-6">
      <p className="text-[13px]" style={{ color: "var(--ink-2)" }}>
        <strong style={{ color: "var(--ink)" }}>{rows.length}</strong> employer sites could not be read completely. Each one says why and what fixes it.
      </p>
      {GROUPS.map((g) => {
        const list = rows.filter((r) => r.verdict === g.verdict);
        if (list.length === 0) return null;
        return (
          <section key={g.verdict}>
            <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>
              {g.title} <span className="nums text-[12px] font-semibold" style={{ color: "var(--ink-3)" }}>{list.length}</span>
            </h2>
            <p className="mb-2 mt-1 max-w-3xl text-[12.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{g.blurb}</p>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((r) => (
                <li key={r.company} className="surface p-3" style={{ borderRadius: "var(--radius)" }}>
                  <p className="text-[13.5px] font-semibold" style={{ color: "var(--ink)" }}>{r.company}</p>
                  <p className="mt-1 text-[12px] leading-relaxed" style={{ color: "var(--ink-2)" }}>{r.reason}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: "var(--accent-ink)" }}>Fix: {r.fix}</p>
                  <div className="mt-1.5 flex flex-wrap gap-3 text-[12px]">
                    {r.careers_url && (
                      <a href={r.careers_url} target="_blank" rel="noopener noreferrer">Open careers page</a>
                    )}
                    {r.suggested_url && (
                      <a href={r.suggested_url} target="_blank" rel="noopener noreferrer">Suggested URL</a>
                    )}
                    {r.emails.slice(0, 1).map((e) => (
                      <a key={e} href={`mailto:${e}`}>{e}</a>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {other.length > 0 && (
        <section>
          <h2 className="text-[15px] font-bold" style={{ color: "var(--ink)" }}>Other</h2>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {other.map((r) => (
              <li key={r.company} className="surface p-3 text-[12px]" style={{ borderRadius: "var(--radius)", color: "var(--ink-2)" }}>
                <strong style={{ color: "var(--ink)" }}>{r.company}</strong> - {r.reason} <span style={{ color: "var(--accent-ink)" }}>Fix: {r.fix}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
