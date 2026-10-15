/**
 * Weekly digest email.
 *
 *   npx tsx scripts/digest.ts             # build + send, mark jobs notified
 *   npx tsx scripts/digest.ts --preview   # write data/cache-digest-preview.html, send nothing
 *   npx tsx scripts/digest.ts --days 14   # widen the window
 *
 * The window defaults to 3 days to match the schedule it runs on.
 *
 * Runs from GitHub Actions on a schedule; safe to run by hand any time.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { renderDigest } from "../src/lib/email";
import { jobsForDigest } from "../src/lib/db";
import { resolveSender, sendDigest } from "../src/lib/digest";
import { envFirst, envStr } from "../src/lib/env";
import type { JobRecord } from "../src/lib/types";

const has = (n: string) => process.argv.includes(`--${n}`);
function arg(n: string): string | undefined {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Stand-in rows so --preview renders something before the DB has data. */
function sampleJobs(): JobRecord[] {
  const base = {
    id: "",
    sourceId: "demo",
    externalId: "",
    descriptionText: "",
    department: null,
    employmentType: null,
    minYears: null,
    maxYears: null,
    lastSeenAt: new Date().toISOString(),
    isActive: true,
    locationText: "Riyadh, Saudi Arabia",
    firstSeenAt: new Date().toISOString(),
  };
  return [
    { ...base, id: "1", title: "Cloud Security Engineer", company: "Elm", url: "https://example.com/1", city: "riyadh", isRiyadh: true, tracks: ["security", "cloud"], primaryTrack: "security", experienceBand: "3-5", sourceKind: "ats", sourceLabel: "Elm", postedAt: null, fingerprint: "a" },
    { ...base, id: "2", title: "SOC Analyst (Tier 1)", company: "sirar by stc", url: "https://example.com/2", city: "riyadh", isRiyadh: true, tracks: ["security"], primaryTrack: "security", experienceBand: "1-2", sourceKind: "ats", sourceLabel: "sirar by stc", postedAt: null, fingerprint: "b" },
    { ...base, id: "3", title: "DevOps Engineer", company: "Tamara", url: "https://example.com/3", city: "riyadh", isRiyadh: true, tracks: ["infra", "cloud"], primaryTrack: "infra", experienceBand: "3-5", sourceKind: "ats", sourceLabel: "Tamara", postedAt: null, fingerprint: "c" },
    { ...base, id: "4", title: "IT Risk & Compliance Officer", company: "Alinma Bank", url: "https://example.com/4", city: "riyadh", isRiyadh: true, tracks: ["grc"], primaryTrack: "grc", experienceBand: "6-9", sourceKind: "job-board", sourceLabel: "Bayt", postedAt: null, fingerprint: "d" },
    { ...base, id: "5", title: "Data Engineer", company: "SDAIA", url: "https://example.com/5", city: "riyadh", isRiyadh: true, tracks: ["data-ai"], primaryTrack: "data-ai", experienceBand: "unknown", sourceKind: "career-page", sourceLabel: "SDAIA", postedAt: null, fingerprint: "e" },
    { ...base, id: "6", title: "Cooperative Training - Cybersecurity", company: "Saudi Aramco", url: "https://example.com/6", city: "riyadh", isRiyadh: true, tracks: ["security"], primaryTrack: "security", experienceBand: "coop", sourceKind: "ats", sourceLabel: "Saudi Aramco", postedAt: null, fingerprint: "f" },
    { ...base, id: "7", title: "Summer Internship - Cloud Infrastructure", company: "Elm", url: "https://example.com/7", city: "riyadh", isRiyadh: true, tracks: ["cloud", "infra"], primaryTrack: "cloud", experienceBand: "internship", sourceKind: "ats", sourceLabel: "Elm", postedAt: null, fingerprint: "g" },
    { ...base, id: "8", title: "IT Support Specialist", company: "Almarai", url: "https://example.com/8", city: "riyadh", isRiyadh: true, tracks: ["it-support"], primaryTrack: "it-support", experienceBand: "1-2", sourceKind: "jsearch", sourceLabel: "JSearch - Riyadh", postedAt: null, fingerprint: "h" },
  ] as JobRecord[];
}

async function main(): Promise<void> {
  const preview = has("preview");
  const days = Number(arg("days") ?? 3);
  const windowEnd = new Date();
  const windowStart = new Date(Date.now() - days * 86_400_000);

  let jobs: JobRecord[] = [];
  // The digest only ever uses the service-role client; requiring the anon key
  // as well (isConfigured) made a missing, unused secret fail the whole run.
  const configured = Boolean(envStr("NEXT_PUBLIC_SUPABASE_URL") && envStr("SUPABASE_SERVICE_ROLE_KEY"));

  if (configured) {
    jobs = await jobsForDigest(windowStart.toISOString());
  } else if (preview) {
    console.log("! Supabase not configured - previewing with sample rows\n");
    jobs = sampleJobs();
  } else {
    console.error("Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }

  const appUrl = envFirst("APP_URL", "NEXT_PUBLIC_APP_URL");

  if (preview) {
    const { subject, html } = renderDigest({ jobs, windowStart, windowEnd, appUrl });
    if (!existsSync("data")) mkdirSync("data", { recursive: true });
    writeFileSync("data/cache-digest-preview.html", html);
    const { from, problem } = resolveSender();
    console.log(`subject: ${subject}`);
    console.log(`jobs   : ${jobs.length}`);
    console.log(`from   : ${from}`);
    if (problem) console.log(`! ${problem}`);
    console.log(`\nwrote data/cache-digest-preview.html - open it in a browser to check the layout`);
    return;
  }

  const outcome = await sendDigest({ days, appUrl, jobs });
  for (const w of outcome.warnings) console.warn(`! ${w}`);
  if (!outcome.ok) {
    console.error(`digest failed: ${outcome.reason}`);
    process.exit(1);
  }
  console.log(
    outcome.sent
      ? `sent ${outcome.jobs} postings (id ${outcome.id})`
      : `nothing sent: ${outcome.reason}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
