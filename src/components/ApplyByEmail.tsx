import { COMPANIES, allCareersEmails } from "@/lib/sources/companies";

/**
 * Employers with no pollable board that publish a careers address instead.
 *
 * Nothing can scrape these, so the address *is* the deliverable — together with
 * the page it came from, so the claim is checkable rather than something you
 * have to take on trust.
 */
export function ApplyByEmail() {
  const withEmail = COMPANIES.map((c) => ({ company: c, emails: allCareersEmails(c) }))
    .filter((x) => x.emails.length > 0)
    .sort((a, b) => a.company.name.localeCompare(b.company.name));
  const addressCount = withEmail.reduce((n, x) => n + x.emails.length, 0);

  return (
    <section>
      <div
        className="mb-4 px-4 py-3 text-[13px] leading-relaxed"
        style={{ background: "var(--info-soft)", color: "var(--info-ink)", borderRadius: "var(--radius)" }}
        role="note"
      >
        <strong>
          {withEmail.length} employers take CVs by email, across {addressCount} addresses.
        </strong>{" "}
        No job board exists to poll, so these will never appear in the job list. Several employers
        run more than one inbox — SITE takes co-op and trainee applications separately from
        permanent roles — so every address is listed with what it is for, and with the page it came
        from so you can check it before sending.
      </div>

      {withEmail.length === 0 ? (
        <div className="surface px-6 py-12 text-center" style={{ borderRadius: "var(--radius-lg)" }}>
          <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
            No careers addresses collected yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13px]" style={{ color: "var(--ink-2)" }}>
            Run <code>npm run links:check</code> — it harvests <code>careers@</code> style addresses
            from every employer page it reaches.
          </p>
        </div>
      ) : (
        <ul className="grid list-none gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {withEmail.map(({ company: c, emails }) => (
            <li key={c.name}>
              <article className="surface p-4" style={{ borderRadius: "var(--radius-lg)" }}>
                <h3 className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
                  {c.name}
                </h3>
                <p className="mt-0.5 text-[11.5px] uppercase tracking-wide" style={{ color: "var(--ink-3)" }}>
                  {c.sector.replace(/-/g, " ")}
                </p>

                {/* Every address, each with what it is for. Sending a co-op
                    application to the general careers inbox is how it gets
                    ignored, so the distinction is worth the extra line. */}
                <div className="mt-3 flex flex-col gap-2">
                  {emails.map((e) => (
                    <div key={e.address}>
                      <a
                        href={`mailto:${e.address}?subject=${encodeURIComponent(
                          /co-?op|train|intern|student|graduate/i.test(e.address)
                            ? "Co-op / internship application - Riyadh"
                            : "Application - technology role, Riyadh",
                        )}`}
                        className="block truncate text-[13px] font-semibold underline-offset-2 hover:underline"
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
                </div>

                <a
                  href={c.careersUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 block truncate text-[11.5px] underline-offset-2 hover:underline"
                  style={{ color: "var(--ink-3)" }}
                  title={c.careersUrl}
                >
                  found on {c.careersUrl.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              </article>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
