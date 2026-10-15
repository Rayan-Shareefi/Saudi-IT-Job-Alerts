/**
 * Retires rows that the Riyadh-only rule no longer accepts.
 *
 * The database predates that rule, so it holds Jeddah, Dammam, NEOM and KAEC
 * postings plus foreign rows that landed under "Not stated". This applies the
 * same test `isRelevant` now uses, against the stored columns.
 *
 * Rows are deleted rather than deactivated: a Jeddah posting is not "inactive",
 * it is out of scope, and leaving it as history would keep skewing the counts.
 *
 *   npx tsx scripts/purge-non-riyadh.ts --dry   # report only
 *   npx tsx scripts/purge-non-riyadh.ts
 */
/*
 * Soft, not hard: rows this script rejects are deactivated with
 * removed_reason "rule:purge-non-riyadh", never deleted. A rule that turns out wrong
 * can then be undone - deleted rows were gone for good (HANDOVER §6).
 */
import "dotenv/config";
import { fetchAllRows, supabaseAdmin, isConfigured } from "../src/lib/db";
import { looksForeignLocation, storageCity } from "../src/lib/ingest";

const DRY = process.argv.includes("--dry");

async function main(): Promise<void> {
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase is not configured.");
    process.exit(1);
  }
  const db = supabaseAdmin();

  // Paged: PostgREST silently caps a response at 1000 rows, so the previous
  // .limit(50_000) meant this only ever swept the first thousand - which is why
  // it reported a clean sweep while Jeddah and Dammam rows were still sitting
  // in the table.
  const rows = await fetchAllRows<{
    id: string; city: string; location_text: string | null; company: string; title: string;
  }>((from, to) =>
    db.from("jobs").select("id, city, location_text, company, title").range(from, to),
    "purge scan",
  );
  const UNPLACED = new Set(["unknown", "ksa-other", "remote-ksa"]);

  // Confirmed somewhere else -> out of scope.
  const wrongCity = rows.filter((r) => r.city !== "riyadh" && !UNPLACED.has(String(r.city)));
  /*
   * The stated location names somewhere that is not Saudi Arabia.
   *
   * Deliberately not restricted to unplaced rows: the classifier used to read
   * the job description as a fallback, so Tamara's Cairo and India postings
   * were stored with city="riyadh" because their boilerplate says the company
   * is headquartered in Riyadh. Filtering on the stored city alone would leave
   * every one of them in place.
   */
  const foreignUnknown = rows.filter(
    (r) => looksForeignLocation(String(r.location_text ?? "")),
  );
  // Unplaced and staying: collapse "Saudi Arabia (other)" / "Remote (Saudi)"
  // into "Not stated", which is the only unplaced value now.
  const toRelabel = rows.filter(
    (r) =>
      UNPLACED.has(String(r.city)) &&
      r.city !== "unknown" &&
      !looksForeignLocation(String(r.location_text ?? "")),
  );

  const doomed = [...wrongCity, ...foreignUnknown];
  const byCity: Record<string, number> = {};
  for (const r of doomed) byCity[String(r.city)] = (byCity[String(r.city)] ?? 0) + 1;

  console.log(`rows in table        : ${rows.length}`);
  console.log(`confirmed non-Riyadh : ${wrongCity.length}`);
  console.log(`foreign under unknown: ${foreignUnknown.length}`);
  console.log(`to remove            : ${doomed.length}`);
  console.log(`to relabel Not stated: ${toRelabel.length}`);
  console.log(`remaining after purge: ${rows.length - doomed.length}`);
  console.log(`\nby city: ${JSON.stringify(byCity)}`);

  if (foreignUnknown.length > 0) {
    console.log(`\nsample of foreign rows caught under "Not stated":`);
    for (const r of foreignUnknown.slice(0, 10)) {
      console.log(`  ${String(r.title).slice(0, 40).padEnd(40)} ${String(r.location_text).slice(0, 40)}`);
    }
  }

  if (DRY) {
    console.log(`\n--dry given; nothing changed`);
    return;
  }

  const ids = doomed.map((r) => String(r.id));
  const CHUNK = 100;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error: delErr } = await db.from("jobs").update({ is_active: false, removed_reason: "rule:purge-non-riyadh" }).in("id", ids.slice(i, i + CHUNK));
    if (delErr) throw new Error(`retire failed: ${delErr.message}`);
    removed += Math.min(CHUNK, ids.length - i);
    process.stdout.write(`\r  deleted ${removed}/${ids.length}`);
  }
  console.log(`\n\nremoved ${removed} out-of-scope postings`);

  // "Saudi Arabia" with no city, and remote-in-Saudi, are unclear rather than
  // confirmed-elsewhere, so they move to "Not stated" instead of being deleted.
  const relabelIds = toRelabel.map((r) => String(r.id));
  let relabelled = 0;
  for (let i = 0; i < relabelIds.length; i += CHUNK) {
    const { error: upErr } = await db
      .from("jobs")
      .update({ city: "unknown", is_riyadh: false })
      .in("id", relabelIds.slice(i, i + CHUNK));
    if (upErr) throw new Error(`relabel failed: ${upErr.message}`);
    relabelled += Math.min(CHUNK, relabelIds.length - i);
  }
  if (relabelled > 0) console.log(`relabelled ${relabelled} unplaced postings to "Not stated"`);
  void storageCity;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
