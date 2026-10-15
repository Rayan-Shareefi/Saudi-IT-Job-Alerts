/**
 * Answers "which employers are we actually getting data from, and why not the
 * rest" - one verdict per company, with the evidence behind it.
 *
 * Merges everything already measured rather than re-probing:
 *   data/discovered.json  - which sources resolved for each company
 *   source_health (DB)    - what the last run fetched and kept per source
 *   data/link-check.json  - whether the careers URL resolves at all
 *   data/link-rescue.json - blocked-but-valid vs genuinely dead
 *   data/zero-audit.json  - landing page vs a page that really lists nothing
 *
 * The verdict order matters. "The company has no open roles" is the *last*
 * conclusion, only reached when the page was read successfully and still held
 * nothing - otherwise a broken URL or a blocked site quietly gets recorded as
 * "not hiring", which is the most misleading answer available.
 *
 * Writes data/coverage.json, which the Human Intervene tab reads.
 */
import "dotenv/config";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { COMPANIES, allCareersEmails } from "../src/lib/sources/companies";
import { sourceHealth, isConfigured } from "../src/lib/db";
import type { SourceDefinition } from "../src/lib/types";

export type Verdict =
  | "working"
  | "blocked"
  | "email-only"
  | "wrong-url"
  | "unreachable"
  | "reachable-no-riyadh"
  | "no-openings"
  | "no-postings-read"
  | "disabled"
  | "not-yet-run";

export interface CoverageRow {
  company: string;
  sector: string;
  priority: number;
  careersUrl: string;
  careersEmail?: string;
  careersEmails?: Array<{ address: string; purpose?: string }>;
  verdict: Verdict;
  /** Why this verdict, in words. */
  reason: string;
  jobsFound: number;
  postingsSeen: number;
  adapters: string[];
  /** Set when a better URL is known but not yet applied. */
  suggestedUrl?: string;
  needsHuman: boolean;
}

const VERDICT_LABEL: Record<Verdict, string> = {
  working: "producing jobs",
  blocked: "site blocks automation",
  "email-only": "no board, applications by email",
  "wrong-url": "URL points at the wrong page",
  unreachable: "domain or page does not resolve",
  "reachable-no-riyadh": "reachable, but nothing matched Riyadh",
  "no-openings": "read successfully, no open roles",
  "no-postings-read": "reached, but nothing could be read off the page",
  disabled: "source exists but is switched off",
  "not-yet-run": "no ingest run recorded",
};

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function main(): Promise<void> {
  const discovered = readJson<{ sources: SourceDefinition[] }>("data/discovered.json", {
    sources: [],
  });
  const linkCheck = readJson<{ results: Array<{ company: string; status: string; note?: string }> }>(
    "data/link-check.json",
    { results: [] },
  );
  const rescue = readJson<{ results: Array<{ company: string; outcome: string; note?: string }> }>(
    "data/link-rescue.json",
    { results: [] },
  );
  const zero = readJson<{
    findings: Array<{ company: string; verdict: string; suggestedUrl?: string; note?: string }>;
  }>("data/zero-audit.json", { findings: [] });
  // Domains found by probing for employers whose seeded host does not resolve.
  // Each has been checked to actually carry the company's own name, but they
  // are suggestions to confirm rather than facts - which is why they surface in
  // the Human Intervene tab instead of being applied.
  const probe = readJson<{
    found: Array<{ company: string; candidate: string }>;
  }>("data/domain-probe.json", { found: [] });

  const health = isConfigured() ? await sourceHealth().catch(() => []) : [];
  const healthById = new Map(health.map((h) => [h.sourceId, h]));

  const sourcesByCompany = new Map<string, SourceDefinition[]>();
  for (const s of discovered.sources) {
    const key = s.company ?? s.label;
    sourcesByCompany.set(key, [...(sourcesByCompany.get(key) ?? []), s]);
  }

  const linkByCompany = new Map(linkCheck.results.map((r) => [r.company, r]));
  const rescueByCompany = new Map(rescue.results.map((r) => [r.company, r]));
  const zeroByCompany = new Map(zero.findings.map((f) => [f.company, f]));
  const probeByCompany = new Map(probe.found.map((f) => [f.company, f.candidate]));

  const rows: CoverageRow[] = COMPANIES.map((c) => {
    const sources = sourcesByCompany.get(c.name) ?? [];
    /*
     * A switched-off source is not a working one.
     *
     * source_health keeps the last run of every source, and a disabled source
     * keeps its final record forever - so HCLTech went on reporting "147
     * Riyadh-relevant postings on the last run" after its boards had been
     * retired for rendering nothing readable. The company then stayed out of
     * the Human Intervene tab, which is precisely where switching a board off
     * is supposed to put it.
     */
    const live = sources.filter((s) => s.enabled !== false);
    const runs = live.map((s) => healthById.get(s.id)).filter(Boolean);
    const jobsFound = runs.reduce((n, r) => n + (r?.kept ?? 0), 0);
    const postingsSeen = runs.reduce((n, r) => n + (r?.fetched ?? 0), 0);
    const adapters = [...new Set(live.map((s) => s.adapter))];

    const base = {
      company: c.name,
      sector: c.sector,
      priority: c.priority,
      careersUrl: c.careersUrl,
      careersEmail: c.careersEmail,
      careersEmails: c.careersEmails,
      jobsFound,
      postingsSeen,
      adapters,
    };

    // 1. Producing jobs. Nothing else to decide.
    if (jobsFound > 0) {
      return { ...base, verdict: "working" as const, reason: `${jobsFound} Riyadh-relevant postings on the last run`, needsHuman: false };
    }

    // 2. The site refuses automation. A human with a browser can still apply.
    const r = rescueByCompany.get(c.name);
    const l = linkByCompany.get(c.name);
    const blockedNote = r?.outcome === "blocked-but-valid" ? r.note : undefined;
    const blockedByStatus = /403|401|429|refuses bots/i.test(`${l?.note ?? ""} ${r?.note ?? ""}`);
    if (blockedNote || blockedByStatus) {
      return {
        ...base,
        verdict: "blocked" as const,
        reason: blockedNote ?? "careers site rejects automated access (Cloudflare/Akamai)",
        needsHuman: true,
      };
    }

    // 3. No board at all, but a real address to send a CV to.
    const emails = allCareersEmails(c);
    if (emails.length > 0) {
      return {
        ...base,
        verdict: "email-only" as const,
        reason:
          emails.length === 1
            ? `applications go to ${emails[0].address}`
            : `${emails.length} application addresses: ${emails.map((e) => e.address).join(", ")}`,
        needsHuman: true,
      };
    }

    // 4. A better URL is known but has not been applied yet.
    const z = zeroByCompany.get(c.name);
    if (z?.verdict === "landing-page" && z.suggestedUrl) {
      return {
        ...base,
        verdict: "wrong-url" as const,
        reason: z.note ?? "seeded URL is a careers landing page, not the vacancy list",
        suggestedUrl: z.suggestedUrl,
        needsHuman: false,
      };
    }

    // 5. Nothing resolves.
    if (r?.outcome === "dead" || l?.status === "unreachable") {
      const candidate = probeByCompany.get(c.name);
      return {
        ...base,
        verdict: "unreachable" as const,
        reason: candidate
          ? `the seeded domain does not resolve; ${new URL(candidate).hostname} carries this company's name and may be the right one`
          : (r?.note ?? l?.note ?? "no working careers URL found"),
        suggestedUrl: candidate,
        needsHuman: true,
      };
    }

    // 6. It served postings; none were Riyadh. That is a real answer.
    if (postingsSeen > 0) {
      return {
        ...base,
        verdict: "reachable-no-riyadh" as const,
        reason: `${postingsSeen} postings read, none in Riyadh`,
        needsHuman: false,
      };
    }

    // 7. Never actually attempted. Distinguish "switched off" from "no source
    //    at all" - the first is a decision we made and can revisit, the second
    //    means discovery found nothing to poll.
    if (runs.length === 0) {
      const allDisabled = sources.length > 0 && sources.every((s) => s.enabled === false);
      if (allDisabled) {
        /*
         * Why it was switched off decides whether a human should look.
         *
         * Most disabled sources are a browser fallback we chose not to poll
         * because a better one exists for the same employer - nobody needs to
         * act on those, and listing all 108 of them would bury the tab. A
         * source switched off because the site defeated the scraper is the
         * opposite: it carries a note saying so, and it is exactly what the
         * Human Intervene tab is for. HCLTech's boards render no description
         * and no location to anything scripted, so the careers link is the
         * only thing left worth handing over.
         */
        const note = sources.map((x) => x.note).find(Boolean);
        if (note) {
          /*
           * "blocked", not "disabled": the Human Intervene tab renders four
           * verdicts and this is the one that means "opens fine in your
           * browser, refuses anything scripted" - which is the situation, and
           * the only reason a source gets switched off with a note. Filing it
           * as disabled set needsHuman and then dropped it from every group,
           * so it appeared nowhere at all.
           */
          return { ...base, verdict: "blocked" as const, reason: note, needsHuman: true };
        }
        return {
          ...base,
          verdict: "disabled" as const,
          reason: `${sources.length} source(s) resolved but disabled (browser fallback, priority ${c.priority})`,
          needsHuman: false,
        };
      }
      return { ...base, verdict: "not-yet-run" as const, reason: "no source has run for this employer yet", needsHuman: false };
    }

    // 8. The source ran and produced nothing. Two very different situations
    //    hide here, and collapsing them is exactly the misleading answer this
    //    script's header warns about.
    //
    //    Only the zero-audit can tell them apart: it opened the page in a real
    //    browser and judged whether it genuinely lists no vacancies. Where it
    //    says so, "no open roles" is a real finding. Where it never looked, all
    //    that is honestly known is that we read nothing off the page - which
    //    may mean the employer is not hiring, or may mean the extractor cannot
    //    see their list. That is a question for a human, not a verdict.
    if (z?.verdict === "no-openings") {
      return {
        ...base,
        verdict: "no-openings" as const,
        reason: z.note ?? "page opens and genuinely lists no vacancies",
        needsHuman: false,
      };
    }

    return {
      ...base,
      verdict: "no-postings-read" as const,
      reason:
        "the source ran without error but no postings could be read - either the employer has nothing open, or their listing is in a shape the extractor cannot see",
      needsHuman: true,
    };
  });

  writeFileSync(
    "data/coverage.json",
    JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2),
  );

  const byVerdict = new Map<Verdict, CoverageRow[]>();
  for (const row of rows) byVerdict.set(row.verdict, [...(byVerdict.get(row.verdict) ?? []), row]);

  const order: Verdict[] = [
    "working",
    "reachable-no-riyadh",
    "no-openings",
    "no-postings-read",
    "wrong-url",
    "blocked",
    "email-only",
    "unreachable",
    "disabled",
    "not-yet-run",
  ];

  console.log(`Coverage across ${rows.length} employers\n`);
  for (const v of order) {
    const list = byVerdict.get(v) ?? [];
    if (list.length === 0) continue;
    console.log(`${String(list.length).padStart(4)}  ${VERDICT_LABEL[v]}`);
  }

  const working = byVerdict.get("working") ?? [];
  const needsHuman = rows.filter((r) => r.needsHuman);
  console.log(`\nfetching data from : ${working.length} employers`);
  console.log(`no data from       : ${rows.length - working.length}`);
  console.log(`needs you          : ${needsHuman.length} (Human Intervene tab)`);

  const fixable = byVerdict.get("wrong-url") ?? [];
  if (fixable.length > 0) {
    console.log(`\nfixable now - run npm run audit:zero:apply:`);
    for (const f of fixable.slice(0, 15)) console.log(`  ${f.company.slice(0, 34).padEnd(34)} -> ${f.suggestedUrl}`);
  }

  console.log(`\nwrote data/coverage.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
