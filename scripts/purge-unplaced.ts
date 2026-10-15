/**
 * Removes "not stated" postings from boards that show no sign of hiring in
 * Saudi Arabia.
 *
 * The board keeps postings whose city is unknown, because on a board that does
 * hire here a missing location almost always means Riyadh - stc do not tag
 * their listings, since everyone reading them knows where stc is.
 *
 * On a board that has never posted a Saudi role the base rate is the opposite.
 * Thales publish French roles ("Ingenieur Cloud & DevSecOps (H/F)"), ServiceNow
 * publish US ones, DXC publish "SAP ECP Consultant - Germany" - all with an
 * empty location field. Keeping those filled this app with 1,617 postings that
 * mentioned Saudi Arabia nowhere.
 *
 * The verdict is per SOURCE and drawn from where that source actually posts,
 * never from the company's name: a global firm does not rename itself when it
 * opens in Riyadh, and a name test would drop exactly the postings worth having.
 *
 *   npx tsx scripts/purge-unplaced.ts --dry
 *   npx tsx scripts/purge-unplaced.ts
 */
/*
 * Soft, not hard: rows this script rejects are deactivated with
 * removed_reason "rule:purge-unplaced", never deleted. A rule that turns out wrong
 * can then be undone - deleted rows were gone for good (HANDOVER §6).
 */
import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { fetchAllRows, isConfigured, supabaseAdmin } from "../src/lib/db";
import { nameSaysSaudi } from "../src/lib/sources/companies";
import type { SourceDefinition } from "../src/lib/types";

const DRY = process.argv.includes("--dry");

/** Saudi evidence in a stated location. */
const SAUDI_LOCATION =
  /\b(saudi|ksa|riyadh|jeddah|dammam|khobar|dhahran|jubail|yanbu|makkah|mecca|medina|madinah|tabuk|neom|abha|qassim|hail|jazan|najran|taif|kaust|kaec|kafd)\b|السعود|الرياض/i;

/** A posting that names its own foreign market, whatever board it sits on. */
const FOREIGN_MARKET =
  /\((f\/h|h\/f|m\/w\/d|m\/f\/d|w\/m\/d|d\/f\/m|m\/v)\)|\b(germany|deutschland|france|espana|india|bengaluru|bangalore|hyderabad|pune|chennai|noida|gurgaon|egypt|cairo|dubai|abu dhabi|uae|united arab emirates|qatar|doha|kuwait|bahrain|manama|oman|muscat|jordan|amman|lebanon|beirut|turkey|istanbul|pakistan|karachi|poland|krakow|warsaw|romania|bucharest|hungary|budapest|czech|prague|philippines|manila|malaysia|vietnam|singapore|indonesia|thailand|japan|tokyo|china|shanghai|korea|brazil|mexico|argentina|canada|toronto|australia|sydney|new zealand|nigeria|kenya|south africa)\b/i;

interface Row {
  id: string;
  company: string;
  title: string;
  url: string;
  city: string;
  source_id: string;
  location_text: string | null;
  description_text: string | null;
}

async function main(): Promise<void> {
  if (!isConfigured() || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Supabase is not configured.");
    process.exit(1);
  }

  // The registry's own view of each source, for boards that state no
  // locations at all and therefore give the ratio nothing to work with.
  const registry = existsSync("data/discovered.json")
    ? (JSON.parse(readFileSync("data/discovered.json", "utf8")) as { sources: SourceDefinition[] })
        .sources
    : [];
  const sourceById = new Map(registry.map((x) => [x.id, x]));

  const db = supabaseAdmin();
  const rows = await fetchAllRows<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("id, company, title, url, city, source_id, location_text, description_text")
        .eq("is_active", true)
        .range(from, to),
    "unplaced scan",
  );

  /*
   * Does each source hire here?
   *
   * Read from its own output: of the postings on this board that state a
   * location at all, what share name somewhere in Saudi Arabia. A board where a
   * real fraction of the located roles are Saudi is one whose untagged roles
   * plausibly are too.
   */
  const located = new Map<string, number>();
  const saudi = new Map<string, number>();
  for (const r of rows) {
    const loc = (r.location_text ?? "").trim();
    // A stored city of "riyadh" is itself a located, Saudi posting - the
    // classifier collapsed everything else to "unknown" before storage.
    if (r.city === "riyadh") {
      located.set(r.source_id, (located.get(r.source_id) ?? 0) + 1);
      saudi.set(r.source_id, (saudi.get(r.source_id) ?? 0) + 1);
      continue;
    }
    if (!loc) continue;
    located.set(r.source_id, (located.get(r.source_id) ?? 0) + 1);
    if (SAUDI_LOCATION.test(loc)) saudi.set(r.source_id, (saudi.get(r.source_id) ?? 0) + 1);
  }

  const hiresHere = (sourceId: string): boolean => {
    const src = sourceById.get(sourceId);
    if (src?.region === "ksa") return true;
    if (nameSaysSaudi(src?.company ?? "")) return true;

    const l = located.get(sourceId) ?? 0;
    const s = saudi.get(sourceId) ?? 0;
    /*
     * Not enough located postings to read anything into the ratio, so keep.
     *
     * Plenty of Saudi boards tag nothing: stc, Alfanar, AMAALA, Red Sea Global
     * and Prince Sultan University state a location on zero postings between
     * them. Reading that silence as "no evidence of Saudi hiring" marked every
     * one of them foreign. Absence of evidence is not evidence of absence.
     */
    if (l < 4) return true;
    return s / l >= 0.25;
  };

  const unplaced = rows.filter((r) => r.city === "unknown");
  const doomed: Row[] = [];
  let keptActive = 0;
  let keptEvidence = 0;

  for (const r of unplaced) {
    const blob = `${r.title} ${r.description_text ?? ""} ${r.location_text ?? ""} ${r.url}`;
    /*
     * Scoped to the title and location, never the description.
     * Scoped to the TITLE and the location field, never the description. A
     * Riyadh posting that mentions "our Dubai office" or "reports to the India
     * team" in its body is still a Riyadh posting - testing the whole
     * description flagged eight roles at Saudi Arabian Parsons, a Saudi company
     * with a Saudi board. Where a posting states its market it does so in the
     * title or the location, which is exactly where a French "(H/F)" or a
     * trailing "- Germany" appears.
     */
    const stated = `${r.title} ${r.location_text ?? ""}`;
    if (FOREIGN_MARKET.test(stated)) {
      doomed.push(r);
      continue;
    }
    if (hiresHere(r.source_id)) {
      keptActive++;
      continue;
    }
    if (SAUDI_LOCATION.test(blob)) {
      keptEvidence++;
      continue;
    }
    doomed.push(r);
  }

  const activeSources = [...new Set(rows.map((r) => r.source_id))].filter(hiresHere);

  console.log(`active postings              : ${rows.length}`);
  console.log(`  with no stated city        : ${unplaced.length}`);
  console.log(`sources that hire in Saudi   : ${activeSources.length}`);
  console.log(`\nkept, board hires here       : ${keptActive}`);
  console.log(`kept, posting names Saudi    : ${keptEvidence}`);
  console.log(`to remove                    : ${doomed.length}`);

  if (doomed.length === 0) {
    console.log("\nnothing to remove");
    return;
  }

  const bySource = new Map<string, number>();
  for (const d of doomed) bySource.set(d.source_id, (bySource.get(d.source_id) ?? 0) + 1);
  console.log(`\nby source:`);
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const l = located.get(s) ?? 0;
    const sa = saudi.get(s) ?? 0;
    console.log(`  ${String(n).padStart(4)}  ${s.slice(0, 40).padEnd(40)} (${sa}/${l} located roles are Saudi)`);
  }

  if (DRY) {
    console.log(`\n--dry given; nothing changed`);
    return;
  }

  const ids = doomed.map((d) => d.id);
  const CHUNK = 200;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db.from("jobs").update({ is_active: false, removed_reason: "rule:purge-unplaced" }).in("id", ids.slice(i, i + CHUNK));
    if (error) throw new Error(`retire failed: ${error.message}`);
    removed += Math.min(CHUNK, ids.length - i);
    process.stdout.write(`\r  deleted ${removed}/${ids.length}`);
  }
  console.log(`\n\nremoved ${removed} unplaced postings from boards with no Saudi hiring`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
