/**
 * Deletes rows that are not job postings.
 *
 * The repeated-block extractor reads groups of structurally similar elements as
 * vacancies, and a cookie-consent table is such a group. Deloitte's careers
 * homepage produced three "openings" named after Adobe cookies; the same thing
 * happened at Dell, Cisco, EY and two dozen others.
 *
 * `judgePosting` is now applied at ingest, so nothing new gets in. This clears
 * what landed before that check existed, using the *same* function - a separate
 * copy of the rules here would drift from the live one within a week.
 *
 *   npx tsx scripts/purge-nonjobs.ts --dry   # report only
 *   npx tsx scripts/purge-nonjobs.ts
 */
/*
 * Soft, not hard: rows this script rejects are deactivated with
 * removed_reason "rule:purge-nonjobs", never deleted. A rule that turns out wrong
 * can then be undone - deleted rows were gone for good (HANDOVER §6).
 */
import "./load-env";
import { fetchAllRows, isConfigured, supabaseAdmin } from "../src/lib/db";
import { judgePosting } from "../src/lib/plausible";

const DRY = process.argv.includes("--dry");

async function main(): Promise<void> {
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase is not configured.");
    process.exit(1);
  }
  const db = supabaseAdmin();

  const rows = await fetchAllRows<{
    id: string;
    title: string;
    company: string;
    description_text: string | null;
    source_id: string;
  }>(
    (from, to) =>
      db.from("jobs").select("id, title, company, description_text, source_id").range(from, to),
    "non-job scan",
  );

  const doomed = rows
    .map((r) => ({ row: r, verdict: judgePosting(r.title, r.description_text) }))
    .filter((x) => !x.verdict.ok);

  console.log(`rows scanned   : ${rows.length}`);
  console.log(`not a job post : ${doomed.length}`);

  if (doomed.length === 0) {
    console.log("\nnothing to remove");
    return;
  }

  // Grouped by employer, because a company contributing many of these is the
  // real finding: its URL points at the wrong page.
  const byCompany = new Map<string, number>();
  const byReason = new Map<string, number>();
  for (const d of doomed) {
    byCompany.set(d.row.company, (byCompany.get(d.row.company) ?? 0) + 1);
    const r = d.verdict.reason ?? "unknown";
    const key = r.startsWith("single word") ? "single word, not a role name" : r;
    byReason.set(key, (byReason.get(key) ?? 0) + 1);
  }

  console.log(`\nby reason:`);
  for (const [r, n] of [...byReason.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${r}`);
  }

  console.log(`\nworst employers (their careers URL is probably wrong):`);
  for (const [c, n] of [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`  ${String(n).padStart(4)}  ${c}`);
  }

  console.log(`\nsample:`);
  for (const d of doomed.slice(0, 12)) {
    console.log(`  "${d.row.title.slice(0, 40).padEnd(40)}"  ${d.verdict.reason}`);
  }

  if (DRY) {
    console.log(`\n--dry given; nothing changed`);
    return;
  }

  const ids = doomed.map((d) => d.row.id);
  const CHUNK = 200;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db.from("jobs").update({ is_active: false, removed_reason: "rule:purge-nonjobs" }).in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`retire failed: ${error.message}`);
    removed += Math.min(CHUNK, ids.length - i);
    process.stdout.write(`\r  deleted ${removed}/${ids.length}`);
  }
  console.log(`\n\nremoved ${removed} rows that were not job postings`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
