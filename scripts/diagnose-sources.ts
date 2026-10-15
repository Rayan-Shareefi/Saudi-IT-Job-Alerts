/**
 * Write the Site report: every employer site that could not be read, why, and
 * the fix for each.
 *
 *   npm run coverage            # refresh data/coverage.json from the last runs
 *   npm run sites:diagnose      # publish it to the Site report tab
 *
 * The verdicts come from coverage.ts (which reads source health and the
 * registry); this attaches a concrete fix to each and stores it in the
 * database so the deployed site shows it without a redeploy.
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { supabaseAdmin } from "../src/lib/db";

interface CoverageRow {
  company: string;
  sector: string;
  priority: number;
  careersUrl: string;
  careersEmail?: string;
  careersEmails?: Array<{ address: string }>;
  verdict: string;
  reason: string;
  suggestedUrl?: string;
  needsHuman: boolean;
  postingsSeen?: number;
  jobsFound?: number;
}

/** Portals that need a personal login (Nafath) - no program can read them. */
const LOGIN_PORTALS = [
  { company: "Jadarat (national jobs portal)", careersUrl: "https://jadarat.sa/", reason: "Listings sit behind a Nafath login." },
  { company: "Hadaf - Tamheer (on-the-job training)", careersUrl: "https://tamheer.hrdf.org.sa/", reason: "Tamheer applications need a Nafath login." },
];

function fixFor(r: CoverageRow): string {
  switch (r.verdict) {
    case "blocked":
      return "Not bypassed on purpose. This employer is searched on LinkedIn and JSearch instead; open the careers page to check by hand.";
    case "unreachable":
      return "Find the current careers page (the company's LinkedIn page usually links it) and add it under Check URLs.";
    case "wrong-url":
      return r.suggestedUrl ? "Accept the suggested URL under Check URLs." : "Find the page that lists openings and add it under Check URLs.";
    case "email-only":
      return "Send your CV to the address shown (Apply by email tab).";
    case "no-postings-read":
      return "If the page shows openings in your browser, it needs a navigation recipe; if it shows none, nothing is open.";
    case "disabled":
      return "Switched off after repeated failures; it is still searched on LinkedIn and JSearch.";
    default:
      return "Check the page by hand.";
  }
}

async function main(): Promise<void> {
  const coverage = JSON.parse(readFileSync("data/coverage.json", "utf8")) as { rows: CoverageRow[] };
  const problems = coverage.rows.filter((r) => r.needsHuman || ["blocked", "unreachable", "wrong-url", "email-only", "no-postings-read"].includes(r.verdict));

  const rows = [
    ...problems.map((r) => ({
      company: r.company,
      sector: r.sector,
      priority: r.priority,
      careers_url: r.careersUrl || null,
      verdict: r.verdict,
      reason: r.reason,
      fix: fixFor(r),
      suggested_url: r.suggestedUrl ?? null,
      emails: [r.careersEmail, ...(r.careersEmails ?? []).map((e) => e.address)].filter((e): e is string => Boolean(e)),
      postings_seen: r.postingsSeen ?? 0,
      jobs_found: r.jobsFound ?? 0,
      checked_at: new Date().toISOString(),
    })),
    ...LOGIN_PORTALS.map((p) => ({
      company: p.company,
      sector: "government",
      priority: 1,
      careers_url: p.careersUrl,
      verdict: "login-required",
      reason: p.reason,
      fix: "Sign in yourself with Nafath now and then; it cannot be automated by anyone.",
      suggested_url: null,
      emails: [],
      postings_seen: 0,
      jobs_found: 0,
      checked_at: new Date().toISOString(),
    })),
  ];

  const db = supabaseAdmin();
  // Replace the whole report: a site that is now readable must drop off it.
  const { error: delError } = await db.from("source_reports").delete().neq("company", "");
  if (delError) throw new Error(`clear failed: ${delError.message}`);
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from("source_reports").upsert(rows.slice(i, i + 200), { onConflict: "company" });
    if (error) throw new Error(`write failed: ${error.message}`);
  }

  const by: Record<string, number> = {};
  for (const r of rows) by[r.verdict] = (by[r.verdict] ?? 0) + 1;
  console.log(`site report: ${rows.length} employer sites need attention`);
  for (const [k, n] of Object.entries(by).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(18)} ${n}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
