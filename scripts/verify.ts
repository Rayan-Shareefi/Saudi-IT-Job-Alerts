/**
 * Pre-deploy checks against the live database.
 *
 * Not a unit-test suite - these are the invariants that have actually broken in
 * this project, asserted against real rows: the Riyadh-only rule, the age
 * filter agreeing with the timestamp each card prints, facet counts matching
 * what clicking them returns, and removals staying removed.
 *
 *   npx tsx scripts/verify.ts
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  AGGREGATOR_KINDS,
  facetCounts,
  fetchAllRows,
  isConfigured,
  queryJobs,
  removedJobs,
  supabaseAdmin,
  supabasePublic,
} from "../src/lib/db";
import { judgePosting } from "../src/lib/plausible";
import { effectivePostedAt } from "../src/lib/types";

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail = ""): void {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
}

/**
 * Control bytes in source files.
 *
 * A regex written as `\b` can end up in a file as a literal backspace byte
 * (0x08) when it passes through a tool that interprets the escape. The result
 * still compiles and still runs - it just silently stops matching word
 * boundaries, so `\bdisabled\b` becomes a test for a control character that
 * never appears. It has happened three times in this project and cost an hour
 * each time, so it is now a check rather than a lesson.
 */
/**
 * True when the text holds a byte no source file should contain.
 *
 * Char codes rather than a regex on purpose: writing this test as a character
 * class means putting the very bytes it looks for into this file, and the check
 * then flags itself. Comparing codes needs no escapes at all.
 */
function hasControlByte(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue; // tab, newline, carriage return
    if (c < 32) return true;
  }
  return false;
}

function checkSourceHygiene(): void {
  console.log("\nSource hygiene\n");
  const roots = ["src", "scripts"];
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        if (hasControlByte(readFileSync(full, "utf8"))) offenders.push(full);
      }
    }
  };
  for (const r of roots) walk(r);

  check(
    "no control bytes in source (mangled regex escapes)",
    offenders.length === 0,
    offenders.length ? `(${offenders.slice(0, 3).join(", ")})` : "",
  );
}

async function main(): Promise<void> {
  checkSourceHygiene();

  if (!isConfigured()) {
    console.error("Supabase is not configured - nothing to verify against.");
    process.exit(1);
  }

  /* ---------------------------------------------------------------- */
  console.log("\nRiyadh only\n");

  // Paged deliberately: checking the Riyadh rule against the first 1000 rows is
  // how the leak stayed hidden in the first place, so this check must see every
  // row or it is worth nothing.
  const db = supabasePublic();
  const everyRow = await fetchAllRows<{ city: string; company: string; posted_at: string | null }>(
    (from, to) =>
      db
        .from("jobs")
        .select("city, company, posted_at")
        .eq("is_active", true)
        .is("removed_at", null)
        .range(from, to),
    "verify scan",
  );
  console.log(`  (scanned ${everyRow.length} active rows)`);
  const all = await queryJobs({ city: "all", limit: 1000 });
  const CONFIRMED_ELSEWHERE = [
    "jeddah", "dammam", "khobar", "dhahran", "jubail", "yanbu", "mecca",
    "medina", "tabuk", "neom", "qassim", "abha", "hail", "najran", "jazan",
    "taif", "kaec",
  ];
  const leaked = everyRow.filter((j) => CONFIRMED_ELSEWHERE.includes(j.city));
  check(
    "no postings confirmed outside Riyadh",
    leaked.length === 0,
    leaked.length ? `(${leaked.slice(0, 3).map((j) => `${j.company}/${j.city}`).join(", ")})` : "",
  );

  const cities = new Set(everyRow.map((j) => j.city));
  check(
    "only riyadh / unknown / ksa-wide cities present",
    [...cities].every((c) => ["riyadh", "unknown", "remote-ksa", "ksa-other"].includes(c)),
    `(${[...cities].join(", ")})`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\nAge filter agrees with the displayed timestamp\n");

  for (const hours of [12, 24, 72, 168]) {
    const { jobs } = await queryJobs({ city: "all", postedWithinHours: hours, limit: 1000 });
    // Every row the filter admitted must display a timestamp inside the window.
    // A tolerance of one minute absorbs the clock moving between the query and
    // this assertion; anything larger is a real disagreement.
    const cutoff = Date.now() - hours * 3_600_000 - 60_000;
    const stale = jobs.filter((j) => new Date(effectivePostedAt(j).iso).getTime() < cutoff);
    check(
      `posted=${hours}h returns only rows dated within ${hours}h`,
      stale.length === 0,
      `(${jobs.length} rows${stale.length ? `, ${stale.length} outside` : ""})`,
    );
  }

  // And the windows must nest: 12h can never return more than 24h.
  const w12 = await queryJobs({ city: "all", postedWithinHours: 12, limit: 1000 });
  const w24 = await queryJobs({ city: "all", postedWithinHours: 24, limit: 1000 });
  const wAll = await queryJobs({ city: "all", limit: 1000 });
  check("12h ⊆ 24h ⊆ all time", w12.total <= w24.total && w24.total <= wAll.total,
    `(${w12.total} ≤ ${w24.total} ≤ ${wAll.total})`);

  // A future date is not a posting date, and it satisfies every `>= cutoff`
  // test - which is how an Oracle event listing dated three weeks out ended up
  // inside "last 12 hours", displayed as "posted just now".
  const horizon = Date.now() + 3_600_000;
  const future = everyRow.filter((r) => r.posted_at && new Date(r.posted_at).getTime() > horizon);
  check(
    "no posting is dated in the future",
    future.length === 0,
    future.length
      ? `(${future.slice(0, 3).map((r) => `${r.company}@${String(r.posted_at).slice(0, 10)}`).join(", ")})`
      : "",
  );

  /* ---------------------------------------------------------------- */
  console.log("\nEvery row is actually a job posting\n");

  // Deloitte's careers homepage produced three "openings" named after Adobe
  // cookies, because the repeated-block extractor read the cookie-consent table
  // as a vacancy list. The gate now runs at ingest; this makes sure nothing has
  // slipped past it since.
  const titled = await fetchAllRows<{ title: string; company: string; description_text: string | null }>(
    (from, to) =>
      db
        .from("jobs")
        .select("title, company, description_text")
        .eq("is_active", true)
        .is("removed_at", null)
        // Since 2026-10-13 non-jobs are kept and hidden (reversibly) rather
        // than deleted; what must not exist is one that is NOT hidden.
        .or("review_state.neq.hidden,hidden_reason.neq.not_a_job")
        .range(from, to),
    "posting scan",
  );
  const notJobs = titled.filter((r) => !judgePosting(r.title, r.description_text).ok);
  check(
    "no cookie tables, nav links or legal pages left unhidden",
    notJobs.length === 0,
    notJobs.length
      ? `(${notJobs.slice(0, 3).map((r) => `${r.company}: "${r.title.slice(0, 22)}"`).join(", ")})`
      : `(${titled.length} titles checked)`,
  );


  /* ---------------------------------------------------------------- */
  console.log("\nFreshness badge\n");

  const fresh = wAll.jobs.filter(
    (j) => (Date.now() - new Date(effectivePostedAt(j).iso).getTime()) / 3_600_000 <= 72,
  );
  check(
    "every badged row is also returned by the 3-day filter",
    fresh.length <= (await queryJobs({ city: "all", postedWithinHours: 72, limit: 1000 })).total,
    `(${fresh.length} badged)`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\nFacet counts match what clicking them returns\n");

  const facets = await facetCounts("all", "all");
  check("active total agrees with the unfiltered query", facets.total === wAll.total,
    `(facets ${facets.total} vs query ${wAll.total})`);

  const [track, trackCount] = Object.entries(facets.byTrack).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (track) {
    const clicked = await queryJobs({ city: "all", tracks: [track], limit: 1000 });
    check(`chip "${track}" says ${trackCount}, clicking gives ${clicked.total}`,
      clicked.total === trackCount);
  }

  const [band, bandCount] = Object.entries(facets.byBand).sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (band) {
    const clicked = await queryJobs({ city: "all", bands: [band], limit: 1000 });
    check(`chip "${band}" says ${bandCount}, clicking gives ${clicked.total}`,
      clicked.total === bandCount);
  }

  /* ---------------------------------------------------------------- */
  console.log("\nRemovals\n");

  const removed = await removedJobs(500);
  const removedIds = new Set(removed.map((j) => j.id));
  check("no removed posting appears in the board",
    !wAll.jobs.some((j) => removedIds.has(j.id)), `(${removed.length} removed)`);
  check("every removed row carries a removed_at",
    removed.every((j) => Boolean(j.removedAt)));

  /* ---------------------------------------------------------------- */
  console.log("\nScraped postings were actually read\n");

  /*
   * A posting whose description is barely longer than its own title is a
   * listing card that was stored without its page ever being opened.
   *
   * The detail pass has now failed silently three times: a serialisation
   * error thrown inside the page, a budget spent before the relevance
   * filter, and a `return finish()` that let the enclosing `finally` close
   * the browser while the pass was still opening tabs on it. Every time the
   * run reported success, and every time the damage surfaced only as
   * hundreds of postings reading "location not stated" - because a
   * 60-character card gives the classifier nothing to read.
   *
   * This checks the outcome rather than the plumbing, so it catches the next
   * variant of the same failure too.
   */
  const scraped = wAll.jobs.filter((j) => j.sourceKind === "career-page");
  const cardOnly = scraped.filter(
    (j) => (j.descriptionText ?? "").length < (j.title ?? "").length + 60,
  );
  check(
    "scraped postings carry more than their listing card",
    scraped.length === 0 || cardOnly.length / scraped.length < 0.5,
    `(${cardOnly.length} of ${scraped.length} are card-only)`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\nCompany cards open to their roles\n");

  /*
   * A card that counts roles must open to those roles.
   *
   * The company page asked queryJobs for `search`, which leaves `company`
   * unset - and an unset company is what tells queryJobs it is building the
   * DEFAULT board, where aggregator rows are excluded on purpose. So every
   * employer discovered only through JSearch, Jooble or Careerjet counted its
   * roles on the tab and then said "0 open roles" when opened. Salla, SiFi and
   * Trace Systems all did.
   *
   * Checked against the aggregator employers specifically, because those are
   * the ones the exclusion can silently swallow.
   */
  const aggRows = await fetchAllRows<{ company: string; source_kind: string }>(
    (from, to) =>
      supabaseAdmin()
        .from("jobs")
        .select("company, source_kind")
        .eq("is_active", true)
        .is("removed_at", null)
        // The company page lists verified primaries only (2026-10-13).
        .eq("review_state", "show")
        .is("duplicate_of", null)
        .in("source_kind", [...AGGREGATOR_KINDS])
        .range(from, to),
    "aggregator company scan",
  );
  const aggCompanies = [...new Set(aggRows.map((r) => r.company))];
  let emptyPages = 0;
  for (const name of aggCompanies) {
    const page = await queryJobs({
      city: "all",
      limit: 1000,
      sort: "newest",
      company: name,
    });
    if (page.jobs.length === 0) emptyPages++;
  }
  check(
    "every aggregator employer's page returns its roles",
    emptyPages === 0,
    `(${aggCompanies.length} checked, ${emptyPages} empty)`,
  );

  /* ---------------------------------------------------------------- */
  console.log("\nAggregator isolation\n");

  const AGG = ["jsearch", "jooble", "careerjet", "aggregator"];
  check("no aggregator rows in the default company view",
    !wAll.jobs.some((j) => AGG.includes(j.sourceKind)));

  await verifiedBoardChecks();

  /* ---------------------------------------------------------------- */
  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

/**
 * The rules the board has run on since 2026-10-13: verified cyber / cloud
 * vacancies, quoted evidence, one card per vacancy, nothing older than 30
 * days, nothing asking 5+ years in All jobs - plus the plumbing that broke
 * before (churn, the digest, runs, budgets).
 */
async function verifiedBoardChecks(): Promise<void> {
  console.log("\nVerified board\n");
  const db = supabaseAdmin();
  type Row = {
    id: string; title: string; url: string; description_text: string | null; source_kind: string;
    min_years: number | null; experience_source: string | null; experience_evidence: string | null;
    scope_evidence: string[] | null; posted_at: string | null; last_refreshed_at: string | null;
    first_seen_at: string; closes_at: string | null; duplicate_of: string | null;
  };
  const shown = await fetchAllRows<Row>(
    (from, to) =>
      db
        .from("jobs")
        .select("id,title,url,description_text,source_kind,min_years,experience_source,experience_evidence,scope_evidence,posted_at,last_refreshed_at,first_seen_at,closes_at,duplicate_of")
        .eq("is_active", true)
        .is("removed_at", null)
        .eq("review_state", "show")
        .range(from, to),
    "shown rows",
  );
  const { loose } = await import("../src/lib/judge/verify");
  const now = Date.now();

  check("no verified job states a required 5+ years", !shown.some((r) => r.experience_source === "stated" && (r.min_years ?? 0) >= 5),
    `(${shown.filter((r) => r.experience_source === "stated" && (r.min_years ?? 0) >= 5).length} found)`);
  const bad = shown.filter((r) => !judgePosting(r.title, r.description_text, r.url).ok);
  check("no cookie, button or profile text among verified jobs", bad.length === 0, bad.slice(0, 3).map((r) => `"${r.title}"`).join(", "));
  // A copy is hidden behind its primary; if the primary went away the copy
  // must not stay hidden, or the vacancy vanishes from the board.
  const copies = shown.filter((r) => r.duplicate_of !== null);
  const primaryIds = [...new Set(copies.map((r) => r.duplicate_of as string))];
  const livePrimaries = new Set<string>();
  for (let i = 0; i < primaryIds.length; i += 200) {
    const { data } = await db.from("jobs").select("id").in("id", primaryIds.slice(i, i + 200)).eq("is_active", true).is("removed_at", null);
    for (const d of data ?? []) livePrimaries.add(String(d.id));
  }
  const orphaned = copies.filter((r) => !livePrimaries.has(r.duplicate_of as string));
  check("every hidden duplicate points at a live primary", orphaned.length === 0, `(${copies.length} copies, ${orphaned.length} orphaned)`);
  const stale = shown.filter((r) => {
    const t = Math.max(...[r.posted_at, r.last_refreshed_at].map((d) => (d ? new Date(d).getTime() : 0)).filter((n) => n <= now + 3_600_000), r.posted_at || r.last_refreshed_at ? 0 : new Date(r.first_seen_at).getTime());
    const ahead = r.closes_at ? new Date(r.closes_at).getTime() >= now : false;
    return (now - t) / 86_400_000 > 30 && !ahead;
  });
  check("nothing older than 30 days is shown (unless its deadline is ahead)", stale.length === 0, `(${stale.length} found)`);
  const unquoted = shown.filter((r) => {
    const text = loose(`${r.title}\n${r.description_text ?? ""}`);
    const quotes = [...(r.scope_evidence ?? []), ...(r.experience_source === "stated" && r.experience_evidence ? [r.experience_evidence] : [])];
    return quotes.some((q) => {
      const l = loose(q.replace(/^\.\.\.|\.\.\.$/g, ""));
      return l.length > 0 && !text.includes(l);
    });
  });
  check("every quote on a verified card is really in its posting", unquoted.length === 0, unquoted.slice(0, 3).map((r) => `"${r.title}"`).join(", "));

  // Aggregator churn: stable ids mean yesterday's postings are not "new" today.
  const since = new Date(now - 86_400_000).toISOString();
  const { count: cjActive } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("source_kind", "careerjet").eq("is_active", true);
  const { count: cjNew } = await db.from("jobs").select("id", { count: "exact", head: true }).eq("source_kind", "careerjet").eq("is_active", true).gte("first_seen_at", since);
  check("Careerjet is not re-adding the same postings daily", !cjActive || (cjNew ?? 0) / cjActive < 0.5, `(${cjNew} of ${cjActive} first seen in the last day)`);

  // Plumbing.
  const { data: digest } = await db.from("digest_runs").select("ok,error,sent_at").order("sent_at", { ascending: false }).limit(1);
  check("the last digest attempt succeeded", digest?.[0]?.ok === true, digest?.[0]?.ok === false ? `(${digest[0].error?.slice(0, 60)})` : "");
  const { data: stuck } = await db.from("ingest_runs").select("id").eq("status", "running").lt("heartbeat_at", new Date(now - 10 * 60_000).toISOString());
  check("no collection run is stuck without a heartbeat", (stuck ?? []).length === 0, `(${(stuck ?? []).length})`);
  const month = new Date().toISOString().slice(0, 7);
  const { data: js } = await db.from("api_usage").select("requests").eq("provider", "jsearch").eq("period", month).maybeSingle();
  check("JSearch use this month is within the app's budget", Number(js?.requests ?? 0) <= Number(process.env.BUDGET_JSEARCH_MONTH || 150), `(${js?.requests ?? 0} used)`);
  const day = new Date().toISOString().slice(0, 10);
  const { data: alerts } = await db.from("api_usage").select("requests").eq("provider", "resend-alert").eq("period", day).maybeSingle();
  check("alert emails today are within the free-plan cap", Number(alerts?.requests ?? 0) <= 20, `(${alerts?.requests ?? 0} sent)`);
}
