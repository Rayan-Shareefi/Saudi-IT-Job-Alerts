/**
 * One-off: move stored Careerjet, Jooble and JSearch rows onto stable ids.
 *
 *   npx tsx scripts/migrate-aggregator-ids.ts --dry
 *   npx tsx scripts/migrate-aggregator-ids.ts
 *
 * Until 2026-10-13 these rows were keyed on ids the providers regenerate on
 * every call (Careerjet's tracking URL, JSearch's job_id suffix), so the same
 * posting was stored again every day. The adapters now key on stable ids; this
 * re-keys what is already stored and collapses the copies:
 *
 *   - the earliest copy keeps its first_seen_at and takes the stable id;
 *   - every other copy of the same posting is deactivated and points at it
 *     (duplicate_of), never deleted.
 *
 * Idempotent: rows already on a stable id are left alone.
 */
import "dotenv/config";
import { contentId, jsearchIdFor } from "../src/lib/adapters/aggregators";
import { fetchAllRows, supabaseAdmin } from "../src/lib/db";

const DRY = process.argv.includes("--dry");

interface Row {
  id: string;
  source_id: string;
  source_kind: string;
  external_id: string;
  company: string;
  title: string;
  location_text: string | null;
  url: string;
  first_seen_at: string;
  last_seen_at: string;
  is_active: boolean;
}

function stableId(r: Row): string {
  if (r.source_kind === "careerjet") return contentId("cj", r.company, r.title, r.location_text ?? "");
  if (r.source_kind === "jooble") return contentId("jb", r.company, r.title, r.location_text ?? "");
  return jsearchIdFor(r.url, r.company, r.title, (r.location_text ?? "").split(",")[0]?.trim() ?? "");
}

const STABLE = /^(cj|jb|js|li|url):/;

async function main(): Promise<void> {
  const db = supabaseAdmin();
  const rows = await fetchAllRows<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("id,source_id,source_kind,external_id,company,title,location_text,url,first_seen_at,last_seen_at,is_active")
        .in("source_kind", ["careerjet", "jooble", "jsearch"])
        .range(from, to),
    "aggregator rows",
  );

  // Group every stored copy by (source, stable id).
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const key = `${r.source_id}|${stableId(r)}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  let rekey = 0;
  let retire = 0;
  const updates: Array<{ id: string; change: Record<string, unknown> }> = [];
  for (const [key, list] of groups) {
    const target = key.split("|")[1];
    // The row already on the stable id wins; otherwise the earliest-seen copy.
    const keeper =
      list.find((r) => r.external_id === target) ??
      [...list].sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at))[0];
    const earliest = list.reduce((a, b) => (a.first_seen_at <= b.first_seen_at ? a : b)).first_seen_at;
    const latest = list.reduce((a, b) => (a.last_seen_at >= b.last_seen_at ? a : b));
    if (keeper.external_id !== target || keeper.first_seen_at !== earliest) {
      updates.push({
        id: keeper.id,
        change: {
          external_id: target,
          first_seen_at: earliest,
          last_seen_at: latest.last_seen_at,
          is_active: list.some((r) => r.is_active),
        },
      });
      if (keeper.external_id !== target) rekey++;
    }
    for (const r of list) {
      if (r.id === keeper.id || (STABLE.test(r.external_id) && r.external_id === target && !r.is_active)) continue;
      // Already-retired copies are invisible; rewriting tens of thousands of
      // them buys nothing. Only active copies need to step aside.
      if (!r.is_active) continue;
      updates.push({ id: r.id, change: { is_active: false, duplicate_of: keeper.id } });
      retire++;
    }
  }

  console.log(`${rows.length} aggregator rows, ${groups.size} distinct postings`);
  console.log(`re-keyed : ${rekey}`);
  console.log(`collapsed: ${retire} copies (deactivated, pointing at the kept row)`);
  if (DRY) return console.log("--dry given; nothing written");

  // Copies first, so the keeper's new external_id never collides with an
  // active copy that already holds it.
  const ordered = [...updates.filter((u) => u.change.duplicate_of), ...updates.filter((u) => !u.change.duplicate_of)];
  let done = 0;
  for (const u of ordered) {
    const { error } = await db.from("jobs").update(u.change).eq("id", u.id);
    if (error) {
      console.warn(`  ${u.id}: ${error.message}`);
      continue;
    }
    done++;
    if (done % 200 === 0) process.stdout.write(`\r  ${done}/${ordered.length}`);
  }
  console.log(`\nwrote ${done} change(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
