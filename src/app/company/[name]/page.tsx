import Link from "next/link";
import { notFound } from "next/navigation";
import { CompanyFilters } from "@/components/CompanyFilters";
import { queryJobs, isConfigured } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * One company's open roles, on its own page.
 *
 * Company cards on the dashboard link here with target="_blank" rather than
 * expanding in place, so comparing two employers is two tabs instead of a lot
 * of scrolling back and forth.
 */
export default async function CompanyPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const company = decodeURIComponent(name);

  /*
   * Ask for the company by name, not by search.
   *
   * `search` runs a LIKE over title and company and leaves `q.company` unset -
   * and an unset company is what tells queryJobs it is building the DEFAULT
   * board, where aggregator rows are deliberately excluded so syndicated
   * copies do not bury the employer boards. So any employer found only through
   * JSearch, Jooble or Careerjet counted its roles on the aggregator tab and
   * then showed "0 open roles" when you opened it.
   *
   * `company` matches with an equality rather than a LIKE, so the punctuation
   * and parentheses that made the search unreliable - "Saudi National Bank
   * (SNB)" - are no longer a problem either.
   */
  const query = { city: "all", limit: 1000, sort: "newest" as const, company };
  if (!isConfigured()) notFound();
  const { jobs } = await queryJobs(query);
  const mine = jobs.filter((j) => j.company === company);


  const students = mine.filter(
    (j) => j.experienceBand === "coop" || j.experienceBand === "internship",
  ).length;
  const riyadh = mine.filter((j) => j.city === "riyadh").length;

  return (
    <div className="py-1">
      <Link
        href="/"
        className="text-[13px] font-medium no-underline hover:underline"
        style={{ color: "var(--ink-3)" }}
      >
        &larr; All companies
      </Link>

      <h1 className="mt-3 text-xl font-bold sm:text-2xl" style={{ color: "var(--ink)" }}>
        {company}
      </h1>
      <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
        {mine.length} open role{mine.length === 1 ? "" : "s"}
        {riyadh > 0 && <> &middot; {riyadh} confirmed Riyadh</>}
        {students > 0 && <> &middot; {students} co-op / internship</>}
      </p>

      <div className="mt-5">
        {mine.length === 0 ? (
          <div className="surface px-6 py-12 text-center" style={{ borderRadius: "var(--radius-lg)" }}>
            <p className="text-[14px] font-semibold" style={{ color: "var(--ink)" }}>
              No open roles for {company}
            </p>
            <p className="mx-auto mt-2 max-w-md text-[13px]" style={{ color: "var(--ink-2)" }}>
              They may have been filled since the last collection run.
            </p>
          </div>
        ) : (
          <CompanyFilters jobs={mine} />
        )}
      </div>
    </div>
  );
}
