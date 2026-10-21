import { ADAPTERS, MissingCredential, MissingLlmKey, QuotaExceeded } from "./adapters";
import { enrich, normalize } from "./classify";
import { nameSaysSaudi } from "./sources/companies";
import { isPlausiblePosting, judgePosting, listingPageLabels } from "./plausible";
import { isTechnologyRole } from "./relevance";
import { deactivateMissing, recordSourceHealth, upsertJobs, existingExternalIds, storedTexts } from "./db";
import { mapLimit } from "./http";
import type { EnrichedJob, IngestResult, RawJob, SourceDefinition } from "./types";

/* -------------------------------------------------------------------------- */
/* relevance                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Whether a stated location is evidence of Saudi Arabia.
 *
 * This replaces an earlier blocklist of foreign place names, which was the
 * wrong shape for the problem: it could only ever reject the places somebody
 * had thought to list. It let "Bogota, Colombia" through on a global
 * engineering firm's board, because Colombia was not on it - and the same would
 * have been true of every country nobody had added yet.
 *
 * Requiring positive evidence instead is correct by construction: a posting
 * either names somewhere in Saudi Arabia or it does not, and there is no list
 * to keep up to date.
 */
const SAUDI_EVIDENCE =
  /\b(saudi|ksa|riyadh|jeddah|dammam|khobar|dhahran|jubail|yanbu|makkah|mecca|medina|madinah|tabuk|neom|abha|qassim|buraidah|hail|jazan|najran|taif|kaec|rabigh|diriyah|kafd)\b|السعود|الرياض|جده|الدمام|مكه|المدينه|نيوم/i;

/**
 * Strings that fill the location field while saying nothing. They mean the same
 * as an empty field, so they must not be read as "somewhere that isn't Saudi".
 */
const PLACEHOLDER_LOCATION =
  /^(n\/?a|not\s*(specified|stated|provided|disclosed|applicable)|unspecified|undisclosed|tbd|tba|various|multiple|any|-|--|\.)$/i;

/**
 * A location string that names a place we could not resolve to Saudi Arabia.
 *
 * Distinct from "no location at all": an empty field means the posting never
 * said, which may still be Riyadh. A populated field carrying no Saudi evidence
 * means it said somewhere else.
 */
export function namesSomewhereElse(locationText: string): boolean {
  const t = (locationText ?? "").trim();
  if (!t || PLACEHOLDER_LOCATION.test(t)) return false;
  return !SAUDI_EVIDENCE.test(normalize(t)) && !SAUDI_EVIDENCE.test(t);
}

/** Kept for the purge script, which reads stored rows rather than fresh ones. */
export function looksForeignLocation(locationText: string): boolean {
  return namesSomewhereElse(locationText);
}

/**
 * Broad technology vocabulary. Used only to decide whether an *unclassified*
 * posting is worth keeping: it lets genuinely ambiguous tech roles reach the
 * Unclassified tab without dragging in every retail and nursing vacancy a big
 * Saudi employer posts.
 */

/**
 * Does this belong on an IT board?
 *
 * See src/lib/relevance.ts. The old test matched substrings - "engineer",
 * "digital", "system", "analyst" - which in this market meant Mechanical
 * Engineer, Digital Marketing Manager and Maintenance Planner all qualified.
 */
function looksTechnical(job: EnrichedJob): boolean {
  return isTechnologyRole(job.title, job.descriptionText, job.department, job.primaryTrack);
}

/**
 * Cities that prove the role is somewhere other than Riyadh.
 *
 * Note what is *not* here: `ksa-other` and `remote-ksa`. "Saudi Arabia" with no
 * city named is unclear, not confirmed-elsewhere - it may well be Riyadh - so
 * those belong in "Not stated" rather than being thrown away.
 */
const CONFIRMED_OTHER_CITY = new Set([
  // The posting stated its own location and it was not Saudi Arabia.
  "foreign",
  "jeddah", "dammam", "khobar", "dhahran", "jubail", "yanbu", "mecca",
  "medina", "tabuk", "neom", "qassim", "abha", "hail", "najran", "jazan",
  "taif", "kaec",
]);

/** Cities that carry no city-level information once we are Riyadh-only. */
const UNPLACED = new Set(["unknown", "ksa-other", "remote-ksa"]);

/**
 * Riyadh-only storage value: everything that is not confirmed Riyadh and has
 * survived the relevance check is, by definition, unplaced.
 */
export function storageCity(city: string): "riyadh" | "unknown" {
  return city === "riyadh" ? "riyadh" : "unknown";
}

/**
 * Whether a posting belongs in the database at all.
 *
 * Riyadh-only, and the rule turns on *confirmation* rather than on absence:
 *   - confirmed Riyadh                       -> keep
 *   - unplaced (no city, or just "Saudi")    -> keep, shown as "Not stated"
 *   - confirmed any other city, or abroad    -> drop
 *
 * Multi-city postings ("Jeddah, Riyadh") resolve to Riyadh in the classifier
 * because Riyadh is matched first, so a role listing Riyadh among several
 * cities is kept.
 */
/**
 * A posting that names a market outside Saudi Arabia, anywhere in its text.
 *
 * Global boards put the market in the title rather than a location field:
 * Thales publishes "Ingenieur Cloud & DevSecOps (H/F)" - the (H/F) is a French
 * job-ad convention - and DXC publishes "SAP ECP Consultant - Germany". Both
 * arrive with an EMPTY location, so nothing else here catches them.
 */
const FOREIGN_MARKET_MARKER =
  /\((f\/h|h\/f|m\/w\/d|m\/f\/d|w\/m\/d|d\/f\/m|m\/v)\)|\b(germany|deutschland|france|espana|india|bengaluru|bangalore|hyderabad|pune|chennai|noida|gurgaon|egypt|cairo|dubai|abu dhabi|uae|united arab emirates|qatar|doha|kuwait|bahrain|manama|oman|muscat|jordan|amman|lebanon|beirut|turkey|istanbul|pakistan|karachi|poland|krakow|warsaw|romania|bucharest|hungary|budapest|czech|prague|philippines|manila|malaysia|vietnam|singapore|indonesia|thailand|japan|tokyo|china|shanghai|korea|brazil|mexico|argentina|canada|toronto|australia|sydney|new zealand|nigeria|kenya|south africa)\b/i;

/**
 * Whether a posting with no stated city should be kept.
 *
 * This is the "not stated" question, and the honest answer depends entirely on
 * WHOSE board it came from.
 *
 * On a Saudi employer's own board, a posting with no location is very likely
 * Riyadh - stc do not tag their listings because everyone reading them knows
 * where stc is. Dropping those would throw away real local jobs.
 *
 * On a global employer's global board it is the opposite: Thales, ServiceNow
 * and DXC publish hundreds of untagged roles, and the base rate is that they
 * are in Paris, San Diego and Bangalore. Keeping them filled this board with
 * 1,828 postings that had no Saudi connection of any kind - not in the title,
 * not in the description, not in the URL.
 *
 * So a global source has to show positive evidence, exactly as the location
 * rule does elsewhere in this file.
 */
export /**
 * Does this source hire in Saudi Arabia?
 *
 * Judged from where its postings actually are, not from the company's name.
 * A global firm does not rename itself when it opens in Riyadh - Apple hiring
 * in Saudi Arabia is still called Apple - so a name test would drop exactly the
 * postings worth having.
 *
 * The evidence is the board's own output: of the postings on this board whose
 * location we could determine, what share are Saudi? A board where a real
 * fraction of the located roles are Saudi is a board whose untagged roles
 * plausibly are too. A board where none of the hundreds of located roles is
 * Saudi is not somewhere an untagged posting is secretly in Riyadh.
 *
 * The share matters more than the count: one Riyadh role among three hundred
 * French ones says the company has a Saudi office, not that its untagged
 * postings are Saudi.
 */
function sourceHiresInSaudi(enriched: EnrichedJob[], source: SourceDefinition): boolean {
  if (source.region === "ksa") return true;
  // The name is still accepted as evidence, but only ever to INCLUDE - it can
  // no longer exclude anything.
  if (nameSaysSaudi(source.company ?? "")) return true;

  const located = enriched.filter((j) => j.city !== "unknown");
  const saudi = located.filter(
    (j) => j.city === "riyadh" || j.city === "ksa-other" || j.city === "remote-ksa",
  );

  /*
   * Not enough located postings to read anything into the ratio.
   *
   * Only a GLOBAL board ever reaches this line - the checks above already
   * returned true for anything the registry calls Saudi, or whose name says so.
   * That is what makes "no" the right answer here: stc, Alfanar, AMAALA and
   * Prince Sultan University tag nothing at all, and they are safe because they
   * never get this far.
   *
   * What does get this far is Lenovo, Bain and DXC - global boards that tag
   * almost nothing, whose untagged postings turned out to be Sao Paulo, Berlin
   * and Singapore. Sixty-eight Lenovo roles, several with Portuguese titles,
   * were kept on a Riyadh board on the strength of this returning true.
   *
   * An individual posting can still earn its place by naming Saudi Arabia; that
   * is checked per posting in unplacedIsPlausiblyRiyadh.
   */
  if (located.length < 4) return false;

  // Enough located postings to be informative: if essentially none of them are
  // Saudi, this board is not where Saudi roles get posted.
  return saudi.length / located.length >= 0.25;
}

/**
 * Whether a posting with no stated city should be kept.
 *
 * On a board that demonstrably hires in Saudi Arabia, an untagged posting is
 * very likely local - stc do not tag their listings, because everyone reading
 * them knows where stc is.
 *
 * On a board that has never posted a Saudi role, the base rate is the opposite,
 * and keeping them filled this app with 1,617 postings that mentioned Saudi
 * Arabia nowhere: not in the title, not in the description, not in the URL.
 */
function unplacedIsPlausiblyRiyadh(
  job: EnrichedJob,
  source: SourceDefinition,
  sourceIsSaudiActive: boolean,
): boolean {
  const blob = `${job.title} ${job.descriptionText ?? ""} ${job.locationText ?? ""} ${job.url}`;
  /*
   * A posting that names its own foreign market is settled, whatever the board.
   *
   * Scoped to the TITLE and the location field, never the description. A
   * Riyadh posting that mentions "our Dubai office" or "reports to the India
   * team" in its body is still a Riyadh posting - testing the whole
   * description flagged eight roles at Saudi Arabian Parsons, a Saudi company
   * with a Saudi board. Where a posting states its market it does so in the
   * title or the location, which is exactly where a French "(H/F)" or a
   * trailing "- Germany" appears.
   */
  const stated = `${job.title} ${job.locationText ?? ""}`;
  if (FOREIGN_MARKET_MARKER.test(stated)) return false;
  if (sourceIsSaudiActive) return true;
  return SAUDI_EVIDENCE.test(normalize(blob)) || SAUDI_EVIDENCE.test(blob);
}

export function isRelevant(
  job: EnrichedJob,
  source: SourceDefinition,
  sourceIsSaudiActive = true,
): boolean {
  /*
   * Is it a job at all?
   *
   * First, because every other test here assumes it is looking at a vacancy.
   * A cookie-table row from a careers homepage will happily classify as
   * "unknown city, unknown track" and survive everything below it - which is
   * how Deloitte ended up with three openings named after Adobe cookies.
   */
  if (!isPlausiblePosting(job.title, job.descriptionText, job.url)) return false;

  if (CONFIRMED_OTHER_CITY.has(job.city)) return false;

  if (job.city !== "riyadh") {
    if (!UNPLACED.has(job.city)) return false;
    // `ksa-other` and `remote-ksa` already carry Saudi evidence, so only a
    // fully unresolved city needs checking. If it named a place and that place
    // is not in Saudi Arabia, the role is not in Riyadh.
    if (job.city === "unknown" && namesSomewhereElse(job.locationText ?? "")) return false;
    // The "not stated" question, answered by whose board it came from.
    if (job.city === "unknown" && !unplacedIsPlausiblyRiyadh(job, source, sourceIsSaudiActive)) {
      return false;
    }
  }

  /*
   * Finally: is it a technology role at all?
   *
   * This is one person's board and they work in IT. Two thirds of the postings
   * were arriving unclassified, and that bucket held hospitality directors,
   * equity capital markets, maintenance planners and mechanical engineers.
   * Keeping them "just in case" was not caution, it was noise.
   */
  return looksTechnical(job);
}

/* -------------------------------------------------------------------------- */
/* per-source run                                                              */
/* -------------------------------------------------------------------------- */

export interface RunOptions {
  dryRun?: boolean;
  onLog?: (line: string) => void;
  /**
   * Called with every relevant posting a source produced. Used to spot
   * employers that appear in aggregator results but are missing from the
   * registry, so the company list keeps growing from real evidence.
   */
  onJobs?: (jobs: EnrichedJob[], source: SourceDefinition) => void;
  /**
   * Called when a source produced items that are not job postings at all -
   * cookie-table rows, nav links, legal pages.
   *
   * A handful is normal noise. A source where *everything* is rejected is
   * almost always pointed at a careers homepage rather than the vacancy list,
   * and that is worth reporting as a wrong URL rather than as "no openings".
   */
  onNotAJob?: (
    source: SourceDefinition,
    count: number,
    reasons: Array<[string, number]>,
  ) => void;
}

export async function runSource(
  source: SourceDefinition,
  opts: RunOptions = {},
): Promise<IngestResult & { jobs: EnrichedJob[] }> {
  const started = Date.now();
  const runStartedAt = new Date().toISOString();
  const base: IngestResult = {
    sourceId: source.id,
    ok: false,
    fetched: 0,
    kept: 0,
    inserted: 0,
    durationMs: 0,
  };

  const adapter = ADAPTERS[source.adapter];
  if (!adapter) {
    return { ...base, error: `no adapter "${source.adapter}"`, durationMs: 0, jobs: [] };
  }

  let raw: RawJob[];
  try {
    raw = await adapter(source);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A missing key or an exhausted monthly quota is a skip, not a failure -
    // nothing is broken, there is just nothing more to fetch this month.
    const skipped =
      err instanceof MissingCredential ||
      err instanceof QuotaExceeded ||
      err instanceof MissingLlmKey ||
      // A spent free-tier day is not breakage; tomorrow it works again.
      message.includes("free quota reached") ||
      // LinkedIn asking us to slow down is the rule working, not breakage
      // (named, not imported: linkedin.ts must not load for every run).
      (err instanceof Error && (err.name === "LinkedInRefused" || err.name === "NotDue"));
    return {
      ...base,
      ok: skipped,
      error: skipped ? `skipped: ${message}` : message,
      durationMs: Date.now() - started,
      jobs: [],
    };
  }

  // Some boards repeat a posting across departments.
  const byExternalId = new Map<string, RawJob>();
  for (const r of raw) {
    if (r.title && r.url && !byExternalId.has(r.externalId)) byExternalId.set(r.externalId, r);
  }

  /*
   * Enrichment is guarded per posting.
   *
   * Classification touches URLs, dates and free text from hundreds of sites,
   * and any one of them can be malformed in a way that throws. Before this,
   * such a posting escaped runSource entirely and aborted the whole pass -
   * a single bad URL at source 241 of 390 threw away the remaining 149.
   *
   * Dropping the one posting is the right trade: the alternative is losing
   * every source after it.
   */
  /*
   * Never let a re-fetch shrink what was already read.
   *
   * A posting read in full once (by the detail pass, or LinkedIn's posting
   * page) arrives on later runs as just its listing card, because those
   * passes skip what they already have. Writing that card over the stored
   * text would throw away the requirements section - and with it the years of
   * experience and the duties the checks rely on.
   */
  if (!opts.dryRun) {
    const stored = await storedTexts(source.id, [...byExternalId.keys()]).catch(() => new Map<string, string>());
    for (const [id, r] of byExternalId) {
      const kept = stored.get(id);
      if (kept && kept.length > (r.descriptionText?.length ?? 0) * 1.25) r.descriptionText = kept;
    }
  }

  const enriched: EnrichedJob[] = [];
  let unreadable = 0;
  for (const r of byExternalId.values()) {
    try {
      enriched.push(enrich(r, source));
    } catch {
      unreadable++;
    }
  }
  if (unreadable > 0) {
    opts.onNotAJob?.(source, unreadable, [["could not be parsed", unreadable]]);
  }

  /*
   * Count what the plausibility gate throws out, separately from what the
   * Riyadh rule throws out.
   *
   * A source rejecting *everything* as implausible is the signature of a wrong
   * URL - the extractor found a repeated block on a page that has no vacancy
   * list, and read the cookie table or the nav menu instead. That is worth
   * surfacing rather than silently reporting "0 jobs", which reads like the
   * employer simply is not hiring.
   */
  const implausible = enriched.filter((j) => !isPlausiblePosting(j.title, j.descriptionText, j.url));
  if (implausible.length > 0) {
    const why = new Map<string, number>();
    for (const j of implausible) {
      const r = judgePosting(j.title, j.descriptionText, j.url).reason ?? "unknown";
      // Collapse the per-title reasons so the log stays one line.
      const key = r.startsWith("single word") ? "single word, not a role name" : r;
      why.set(key, (why.get(key) ?? 0) + 1);
    }
    opts.onNotAJob?.(source, implausible.length, [...why.entries()]);
  }

  // Riyadh-only: whatever survives is either Riyadh or unplaced, so collapse the
  // city to those two values before persisting. Keeps the filter honest and the
  // city dropdown down to the two options that actually mean something now.
  // Computed once from the whole batch: the question "does this employer hire
  // in Saudi Arabia" is about the board, not about one posting on it.
  const saudiActive = sourceHiresInSaudi(enriched, source);

  /*
   * Link labels that only reveal themselves as a group.
   *
   * Judged one at a time these look like ordinary postings with an unusual
   * title; judged together, dozens of role-less titles sharing one address is
   * a menu on a page. Almarai was publishing 44 Saudi town names this way.
   */
  const labels = listingPageLabels(enriched);

  const kept = enriched
    .filter((j, i) => !labels.has(i) && isRelevant(j, source, saudiActive))
    .map((j) => ({ ...j, city: storageCity(j.city), isRiyadh: j.city === "riyadh" }) as EnrichedJob);

  let inserted = 0;
  if (!opts.dryRun && kept.length > 0) {
    /*
     * The write is guarded separately from the fetch.
     *
     * A transient "fetch failed" talking to the database used to escape
     * runSource entirely, propagate through mapLimit and abort the whole pass:
     * one blip 222 sources into a 390-source run threw away the remaining 168.
     * A source that read fine but could not be persisted is a failure of that
     * source, not of the run.
     */
    try {
      // Count genuinely new postings before writing, so "new this week" in the
      // digest reflects arrivals rather than re-seen rows.
      const known = await existingExternalIds(
        source.id,
        kept.map((j) => j.externalId),
      );
      inserted = kept.filter((j) => !known.has(j.externalId)).length;
      await upsertJobs(kept);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ...base,
        ok: false,
        fetched: raw.length,
        kept: kept.length,
        inserted: 0,
        error: `read ${kept.length} but could not save: ${message}`,
        durationMs: Date.now() - started,
        jobs: [],
      };
    }
  }

  /*
   * Retire what this source stopped returning - even when it returned nothing.
   *
   * Outside the "kept > 0" guard on purpose. A board that empties has to be
   * allowed to empty, or its postings stay on the app for good.
   */
  if (!opts.dryRun) {
    await deactivateMissing(source.id, runStartedAt, source.kind).catch(() => 0);
  }

  opts.onJobs?.(kept, source);

  // An adapter that stopped part-way (LinkedIn's "slow down") says so here;
  // what it read is saved like any other batch.
  const note = (raw as RawJob[] & { note?: string }).note;
  const result: IngestResult = {
    sourceId: source.id,
    ok: true,
    fetched: raw.length,
    kept: kept.length,
    inserted,
    durationMs: Date.now() - started,
    ...(note ? { error: note } : {}),
  };
  return { ...result, jobs: kept };
}

/* -------------------------------------------------------------------------- */
/* batch run                                                                   */
/* -------------------------------------------------------------------------- */

export interface IngestSummary {
  results: IngestResult[];
  /**
   * Sources that returned items which were not job postings. A source appearing
   * here with kept=0 is nearly always pointed at a careers homepage rather than
   * the vacancy list.
   */
  notJobs: Array<{ sourceId: string; label: string; count: number; reasons: Array<[string, number]> }>;
  totalFetched: number;
  totalKept: number;
  totalInserted: number;
  failed: number;
  skipped: number;
  /** Sources not started because the run's deadline had passed. */
  deferred: number;
  durationMs: number;
}

export interface BatchOptions extends RunOptions {
  concurrency?: number;
  recordHealth?: boolean;
  /**
   * Structured progress, one call per finished source.
   *
   * The refresh route used to recover progress by regex-parsing log lines; the
   * regex lost its backslashes to a shell heredoc and the UI sat at "0 of 520"
   * for whole runs. Progress is data, so it is passed as data.
   */
  onSourceDone?: (result: IngestResult, done: number, total: number, source: SourceDefinition) => void;
  /**
   * Epoch ms after which no new source is started. Sources already running are
   * allowed to finish, so their health is recorded - unlike a CI timeout, which
   * kills the job and records nothing. The nightly browser pass hit its 50-min
   * limit every night from 2026-09-04 and stored no health for 388 sources.
   */
  deadlineAt?: number;
}

export async function runIngest(
  sources: SourceDefinition[],
  opts: BatchOptions = {},
): Promise<IngestSummary> {
  const started = Date.now();
  const log = opts.onLog ?? (() => {});
  const results: IngestResult[] = [];
  let done = 0;
  let deferred = 0;

  // Sources whose output was all site furniture rather than vacancies. Kept per
  // source so the summary can name them: this is the fingerprint of a URL
  // pointing at a careers homepage instead of the openings list.
  const notJobs = new Map<string, { label: string; count: number; reasons: Array<[string, number]> }>();
  const wrapped: RunOptions = {
    ...opts,
    onNotAJob: (source, count, reasons) => {
      notJobs.set(source.id, { label: source.label, count, reasons });
      opts.onNotAJob?.(source, count, reasons);
    },
  };

  // Browser sources are serialised separately by the caller; everything else is
  // network-bound and safe to fan out.
  const batchStarted = Date.now();
  await mapLimit(sources, opts.concurrency ?? 6, async (source) => {
    if (opts.deadlineAt && Date.now() >= opts.deadlineAt) {
      // Not run, so not reported as run: no health row, no deactivation. The
      // stale-first order puts it at the front of the next pass.
      deferred++;
      return;
    }
    const { jobs: _jobs, ...result } = await runSource(source, wrapped);
    results.push(result);
    done++;
    opts.onSourceDone?.(result, done, sources.length, source);

    // "none": the site answered and has nothing in scope today. Most company
    // boards are like that most days; it is not a fault, so it says so.
    const status = result.ok ? (result.error ? (result.error.startsWith("partial:") ? "part" : "skip") : result.kept > 0 ? "ok  " : "none") : "FAIL";
    log(
      `[${String(done).padStart(3)}/${sources.length}] ${status} ${source.label.slice(0, 34).padEnd(34)} ` +
        `fetched=${String(result.fetched).padStart(4)} kept=${String(result.kept).padStart(3)} ` +
        `new=${String(result.inserted).padStart(3)} ${result.error ? `(${result.error.slice(0, 60)})` : ""}`,
    );
    // Time left, every 10 sources of a long run: from the pace so far.
    if (sources.length >= 20 && done % 10 === 0 && done < sources.length) {
      const leftMs = ((Date.now() - batchStarted) / done) * (sources.length - done);
      const at = new Date(Date.now() + leftMs).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      log(`        about ${Math.max(1, Math.round(leftMs / 60_000))} min left - done around ${at}`);
    }

    // Flag it right where it happens, so a wrong URL is visible in the run log
    // rather than only in a summary at the end.
    const nj = notJobs.get(source.id);
    if (nj && result.kept === 0 && nj.count > 0) {
      log(
        `        ^ ${nj.count} item(s) read from this page were not job postings ` +
          `(${nj.reasons.map(([r, n]) => `${n} ${r}`).join(", ").slice(0, 70)}) - likely the wrong URL`,
      );
    }

    if (opts.recordHealth && !opts.dryRun) {
      await recordSourceHealth(source, result).catch(() => {});
    }
  });

  return {
    results,
    notJobs: [...notJobs.entries()].map(([sourceId, v]) => ({ sourceId, ...v })),
    totalFetched: results.reduce((n, r) => n + r.fetched, 0),
    totalKept: results.reduce((n, r) => n + r.kept, 0),
    totalInserted: results.reduce((n, r) => n + r.inserted, 0),
    failed: results.filter((r) => !r.ok).length,
    skipped: results.filter((r) => r.ok && r.error && !r.error.startsWith("partial:")).length,
    deferred,
    durationMs: Date.now() - started,
  };
}

/**
 * Least-recently-run first, never-run before everything.
 *
 * Combined with a deadline this rotates through the browser sources across
 * nights with no shard bookkeeping: whatever did not fit tonight leads tomorrow.
 */
export function orderStaleFirst(
  sources: SourceDefinition[],
  lastRun: Map<string, string>,
): SourceDefinition[] {
  return [...sources].sort((a, b) => {
    const ta = lastRun.get(a.id) ?? "";
    const tb = lastRun.get(b.id) ?? "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
}
