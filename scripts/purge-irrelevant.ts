/**
 * Removes postings that are not IT roles.
 *
 * The board previously kept anything whose title contained "engineer",
 * "digital", "system", "analyst" or "support". In a market this heavy with oil,
 * construction and industrial work that meant two thirds of the postings were
 * unclassified and much of that was not technology at all: mechanical
 * engineers, maintenance planners, hospitality directors, equity capital
 * markets, reception and retail.
 *
 * `isRelevant` now applies the real test at ingest. This clears what landed
 * before it existed, using the SAME function so the two cannot drift.
 *
 *   npx tsx scripts/purge-irrelevant.ts --dry
 *   npx tsx scripts/purge-irrelevant.ts
 */
/*
 * Soft, not hard: rows this script rejects are deactivated with
 * removed_reason "rule:purge-irrelevant", never deleted. A rule that turns out wrong
 * can then be undone - deleted rows were gone for good (HANDOVER §6).
 */
import "dotenv/config";
import { fetchAllRows, isConfigured, supabaseAdmin } from "../src/lib/db";
import { judgePosting } from "../src/lib/plausible";
import { judgeRelevance } from "../src/lib/relevance";

const DRY = process.argv.includes("--dry");

interface Row {
  id: string;
  company: string;
  title: string;
  city: string;
  primary_track: string;
  department: string | null;
  description_text: string | null;
}

/** Cities that prove the role is somewhere other than Riyadh. */
const CONFIRMED_ELSEWHERE = new Set([
  "jeddah", "dammam", "khobar", "dhahran", "jubail", "yanbu", "mecca",
  "medina", "tabuk", "neom", "qassim", "abha", "hail", "najran", "jazan",
  "taif", "kaec",
]);

async function main(): Promise<void> {
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase is not configured.");
    process.exit(1);
  }

  const db = supabaseAdmin();
  const rows = await fetchAllRows<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("id, company, title, city, primary_track, department, description_text")
        .eq("is_active", true)
        .range(from, to),
    "relevance scan",
  );

  const reasons = new Map<string, number>();
  const doomed: Array<Row & { why: string }> = [];

  for (const r of rows) {
    // 1. Not a job posting at all.
    const p = judgePosting(r.title, r.description_text);
    if (!p.ok) {
      doomed.push({ ...r, why: p.reason ?? "not a posting" });
      continue;
    }
    // 2. Confirmed somewhere other than Riyadh.
    if (CONFIRMED_ELSEWHERE.has(r.city)) {
      doomed.push({ ...r, why: `confirmed in ${r.city}` });
      continue;
    }
    // 3. Not a technology role.
    const rel = judgeRelevance(r.title, r.description_text, r.department, r.primary_track);
    if (!rel.ok) doomed.push({ ...r, why: rel.reason ?? "not IT" });
  }

  for (const d of doomed) reasons.set(d.why, (reasons.get(d.why) ?? 0) + 1);

  console.log(`active postings : ${rows.length}`);
  console.log(`to remove       : ${doomed.length}`);
  console.log(`remaining       : ${rows.length - doomed.length}\n`);

  console.log("by reason:");
  for (const [why, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${why}`);
  }

  const byCompany = new Map<string, number>();
  for (const d of doomed) byCompany.set(d.company, (byCompany.get(d.company) ?? 0) + 1);
  console.log(`\nworst affected employers:`);
  for (const [c, n] of [...byCompany.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`  ${String(n).padStart(4)}  ${c}`);
  }

  console.log(`\nsample:`);
  for (const d of doomed.slice(0, 14)) {
    console.log(`  ${d.company.slice(0, 20).padEnd(20)} "${d.title.slice(0, 44)}"  (${d.why})`);
  }

  if (DRY) {
    console.log(`\n--dry given; nothing changed`);
    return;
  }

  const ids = doomed.map((d) => d.id);
  const CHUNK = 200;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db.from("jobs").update({ is_active: false, removed_reason: "rule:purge-irrelevant" }).in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`retire failed: ${error.message}`);
    removed += Math.min(CHUNK, ids.length - i);
    process.stdout.write(`\r  deleted ${removed}/${ids.length}`);
  }
  console.log(`\n\nremoved ${removed} postings that do not belong on an IT board`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
