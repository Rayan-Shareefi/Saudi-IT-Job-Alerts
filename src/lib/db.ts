import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { EnrichedJob, IngestResult, JobRecord, SourceDefinition } from "./types";

/**
 * Source kinds that never appear in the company results, only in their own tab.
 * Each carries already-syndicated listings, so mixing them in would bury the
 * employer-board postings that arrive first.
 */
export const AGGREGATOR_KINDS = ["jsearch", "jooble", "careerjet", "aggregator", "telegram"] as const;

/* -------------------------------------------------------------------------- */
/* clients                                                                     */
/* -------------------------------------------------------------------------- */

let adminClient: SupabaseClient | null = null;
let publicClient: SupabaseClient | null = null;

/** Service-role client. Server/CI only -- never import into a client component. */
export function supabaseAdmin(): SupabaseClient {
  if (adminClient) return adminClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  adminClient = createClient(url, key, { auth: { persistSession: false } });
  return adminClient;
}

/** Anon client. Reads only -- RLS allows select and nothing else. */
/**
 * The best client for reading public data: the service role when this server
 * has it (it also sees the private tables), otherwise the read-only key. Pages
 * keep working on a deployment that was not given the service key - they just
 * lose what only it can read (saved jobs, the CV profile).
 */
export function supabaseRead(): SupabaseClient {
  return process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ? supabaseAdmin() : supabasePublic();
}

export function supabasePublic(): SupabaseClient {
  if (publicClient) return publicClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  }
  publicClient = createClient(url, key, { auth: { persistSession: false } });
  return publicClient;
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/* -------------------------------------------------------------------------- */
/* row mapping                                                                 */
/* -------------------------------------------------------------------------- */

type JobRow = Record<string, unknown>;

function toRow(job: EnrichedJob): JobRow {
  return {
    source_id: job.sourceId,
    source_label: job.sourceLabel,
    source_kind: job.sourceKind,
    external_id: job.externalId.slice(0, 500),
    title: job.title.slice(0, 500),
    company: job.company.slice(0, 300),
    location_text: job.locationText?.slice(0, 300) ?? null,
    // The whole posting, up to 16k characters. It used to be cut at 4,000,
    // which dropped the requirements section of long postings - the part that
    // states the years of experience. The list view selects columns without it.
    description_text: job.descriptionText?.slice(0, 16000) ?? null,
    url: job.url.slice(0, 1000),
    posted_at: job.postedAt ?? null,
    closes_at: job.closesAt ?? null,
    department: job.department?.slice(0, 200) ?? null,
    employment_type: job.employmentType?.slice(0, 100) ?? null,
    fingerprint: job.fingerprint,
    tracks: job.tracks,
    primary_track: job.primaryTrack,
    experience_band: job.experienceBand,
    min_years: job.minYears,
    max_years: job.maxYears,
    city: job.city,
    is_riyadh: job.isRiyadh,
    last_seen_at: new Date().toISOString(),
    is_active: true,
    // Facts about the posting. Review state is NOT written here: it is
    // recomputed by state.ts after the upsert, so a re-fetch can never undo a
    // decision the jury or the user made.
    publisher: job.publisher?.slice(0, 120) ?? null,
    listed_on: (job.listedOn ?? []).map((p) => p.slice(0, 60)).slice(0, 12),
    company_key: job.companyKey,
    text_quality: job.textQuality,
    text_hash: job.textHash,
    text_fetched_at: job.textQuality === "full" || job.textQuality === "partial" ? new Date().toISOString() : null,
    experience_source: job.experienceSource,
    experience_evidence: job.experienceEvidence?.slice(0, 400) ?? null,
    apply_url: job.applyUrl?.slice(0, 1000) ?? null,
    apply_kind: job.applyKind,
  };
}

export function fromRow(row: JobRow): JobRecord {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    sourceLabel: String(row.source_label),
    sourceKind: row.source_kind as JobRecord["sourceKind"],
    externalId: String(row.external_id),
    title: String(row.title),
    company: String(row.company),
    locationText: (row.location_text as string) ?? "",
    descriptionText: (row.description_text as string) ?? "",
    url: String(row.url),
    postedAt: (row.posted_at as string) ?? null,
    closesAt: (row.closes_at as string) ?? null,
    department: (row.department as string) ?? null,
    employmentType: (row.employment_type as string) ?? null,
    fingerprint: String(row.fingerprint),
    tracks: (row.tracks as JobRecord["tracks"]) ?? [],
    primaryTrack: row.primary_track as JobRecord["primaryTrack"],
    experienceBand: row.experience_band as JobRecord["experienceBand"],
    minYears: (row.min_years as number) ?? null,
    maxYears: (row.max_years as number) ?? null,
    city: row.city as JobRecord["city"],
    isRiyadh: Boolean(row.is_riyadh),
    firstSeenAt: String(row.first_seen_at),
    lastSeenAt: String(row.last_seen_at),
    isActive: Boolean(row.is_active),
    removedAt: (row.removed_at as string) ?? null,
    publisher: (row.publisher as string) ?? null,
    listedOn: (row.listed_on as string[]) ?? [],
    applyUrl: (row.apply_url as string) ?? null,
    companyKey: (row.company_key as string) ?? "",
    textQuality: ((row.text_quality as string) ?? "none") as JobRecord["textQuality"],
    textHash: (row.text_hash as string) ?? "",
    textFetchedAt: (row.text_fetched_at as string) ?? null,
    experienceSource: ((row.experience_source as string) ?? "none") as JobRecord["experienceSource"],
    experienceEvidence: (row.experience_evidence as string) ?? null,
    applyKind: ((row.apply_kind as string) ?? "page") as JobRecord["applyKind"],
    reviewState: ((row.review_state as string) ?? "pending") as JobRecord["reviewState"],
    hiddenReason: (row.hidden_reason as JobRecord["hiddenReason"]) ?? null,
    decidedBy: (row.decided_by as string) ?? null,
    decisionNote: (row.decision_note as string) ?? null,
    humanOverride: (row.human_override as JobRecord["humanOverride"]) ?? null,
    scope: (row.scope as JobRecord["scope"]) ?? null,
    focus: (row.focus as string[]) ?? [],
    scopeEvidence: (row.scope_evidence as string[]) ?? [],
    duplicateOf: (row.duplicate_of as string) ?? null,
    alsoOn: (row.also_on as JobRecord["alsoOn"]) ?? [],
    lastRefreshedAt: (row.last_refreshed_at as string) ?? null,
  };
}

/* -------------------------------------------------------------------------- */
/* writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Upsert a batch of postings.
 *
 * `first_seen_at` is deliberately left out of the update list: on conflict we
 * refresh everything except when we first saw the row, because that timestamp
 * is what the weekly digest and the "new" badge are built on.
 */
export async function upsertJobs(jobs: EnrichedJob[]): Promise<number> {
  if (jobs.length === 0) return 0;
  const db = supabaseAdmin();
  const rows = jobs.map(toRow);

  let written = 0;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await db
      .from("jobs")
      .upsert(chunk, { onConflict: "source_id,external_id", ignoreDuplicates: false })
      .select("id");
    if (error) throw new Error(`upsert failed: ${error.message}`);
    written += data?.length ?? 0;
  }
  return written;
}

/** Which of these (source_id, external_id) pairs does the table already have? */
export async function existingExternalIds(
  sourceId: string,
  externalIds: string[],
): Promise<Set<string>> {
  if (externalIds.length === 0) return new Set();
  const db = supabaseAdmin();
  const found = new Set<string>();

  /*
   * Batched by LENGTH, not by count.
   *
   * The identifiers vary enormously: an ATS gives you "12345" while Careerjet
   * gives you the full posting URL and JSearch a 200-character base64 blob.
   * A fixed batch of 100 is therefore fine for one source and far past
   * PostgREST's URL limit for another - Careerjet's 921 postings came back as
   * "400 Bad Request", which reads like a broken query rather than a request
   * that was simply too long to send.
   *
   * The budget is deliberately well under the usual 8 KB server limit, since
   * the ids are also percent-encoded on the way out.
   */
  const BUDGET = 3000;
  let batch: string[] = [];
  let budget = 0;

  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    const { data, error } = await db
      .from("jobs")
      .select("external_id")
      .eq("source_id", sourceId)
      .in("external_id", batch);
    if (error) throw new Error(`lookup failed: ${error.message}`);
    for (const r of data ?? []) found.add(String(r.external_id));
    batch = [];
    budget = 0;
  };

  for (const id of externalIds) {
    // Roughly what this id costs once encoded, plus a separator.
    const cost = encodeURIComponent(id).length + 3;
    // An id too long to share a batch still gets its own request rather than
    // silently dropping out of the "already known" set and re-counting as new.
    if (batch.length > 0 && budget + cost > BUDGET) await flush();
    batch.push(id);
    budget += cost;
  }
  await flush();

  return found;
}

/**
 * Retire postings a source stopped returning. Only touches sources that ran
 * successfully, so a source being down never mass-deactivates its jobs.
 */
/**
 * Retire postings a source stopped returning.
 *
 * Called after any run that FETCHED WITHOUT ERROR, including one that returned
 * nothing. That last case is the important one: the previous version bailed out
 * when the source produced no postings, on the theory that an empty page should
 * not wipe an employer's jobs.
 *
 * The effect was the opposite of safe. When a board genuinely emptied, its rows
 * were never retired and stayed on the app for good - Saudi National Bank
 * advertising three roles whose page had none, and a "Trainee" at stc whose
 * own site says "There are currently no open positions". Postings that do not
 * exist are the worst thing this app can show, because every one costs an
 * application that goes nowhere.
 *
 * A source that ERRORS never reaches here, so a site being down still cannot
 * empty the board. And a wrongly-retired posting comes back on the next run,
 * because the upsert sets is_active again - the cost of being wrong is one
 * cycle, and it is self-healing.
 */
/** Search results, not complete lists: retired by age, never by one absence. */
export const SEARCH_RESULT_KINDS = ["jsearch", "jooble", "careerjet", "linkedin", "linkedin-post", "indeed", "aggregator", "telegram"];
const SEARCH_RESULT_MAX_UNSEEN_DAYS = 10;

export async function deactivateMissing(
  sourceId: string,
  runStartedAt: string,
  sourceKind?: string,
): Promise<number> {
  /*
   * An employer board is a complete list: anything this run did not return
   * (last_seen_at older than the run) is gone. A search API is a ranked
   * sample - a posting missing from one call is usually just ranked lower that
   * day - so those rows retire only after ten days unseen.
   */
  const cutoff =
    sourceKind && SEARCH_RESULT_KINDS.includes(sourceKind)
      ? new Date(Date.now() - SEARCH_RESULT_MAX_UNSEEN_DAYS * 86_400_000).toISOString()
      : runStartedAt;
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("jobs")
    .update({ is_active: false })
    .eq("source_id", sourceId)
    .eq("is_active", true)
    .lt("last_seen_at", cutoff)
    .select("id");
  if (error) throw new Error(`deactivate failed: ${error.message}`);
  return data?.length ?? 0;
}

/**
 * Retires postings whose source no longer exists.
 *
 * `deactivateMissing` only ever looks at sources that RAN, so a posting
 * outlives its source the moment that source leaves the registry - nothing
 * fetches it, nothing retires it, and it sits on the board forever. Merging
 * duplicate employers left 35 of these behind: Salla still had 13 postings
 * under `workable-salla` after it moved to `browser-salla`, and alfanar had
 * two registrations that were folded into one. Thirty-two of the thirty-five
 * had no location, which is a third of everything still reading "not stated".
 *
 * Aggregator rows are exempt: their source ids are built at run time from the
 * search being made, so they are legitimately absent from the registry file.
 */
/** Source kinds created at run time, never listed in data/discovered.json. */
export const RUNTIME_SOURCE_KINDS = ["linkedin", "linkedin-post", "indeed"];

export async function retireOrphanedSources(knownSourceIds: Iterable<string>): Promise<number> {
  const known = new Set(knownSourceIds);
  const db = supabaseAdmin();

  const rows = await fetchAllRows<{ id: string; source_id: string }>(
    (from, to) =>
      db
        .from("jobs")
        .select("id, source_id")
        .eq("is_active", true)
        .not("source_kind", "in", `(${[...AGGREGATOR_KINDS, ...RUNTIME_SOURCE_KINDS].join(",")})`)
        .range(from, to),
    "orphan scan",
  );

  // Employers the worker added by itself live in dynamic_sources, not the
  // registry file; they are known too.
  const { data: dynamic } = await db.from("dynamic_sources").select("id");
  for (const d of dynamic ?? []) known.add(String(d.id));

  const doomed = rows.filter((r) => !known.has(r.source_id)).map((r) => r.id);
  if (doomed.length === 0) return 0;

  const CHUNK = 200;
  for (let i = 0; i < doomed.length; i += CHUNK) {
    const { error } = await db
      .from("jobs")
      .update({ is_active: false })
      .in("id", doomed.slice(i, i + CHUNK));
    if (error) throw new Error(`retire failed: ${error.message}`);
  }
  return doomed.length;
}

/** When each source last ran, for stale-first ordering. */
export async function lastRunTimes(): Promise<Map<string, string>> {
  const db = supabaseAdmin();
  const rows = await fetchAllRows<{ source_id: string; last_run_at: string | null }>(
    (from, to) => db.from("source_health").select("source_id,last_run_at").range(from, to),
    "source_health",
  );
  return new Map(rows.filter((r) => r.last_run_at).map((r) => [r.source_id, String(r.last_run_at)]));
}

export async function recordSourceHealth(
  source: SourceDefinition,
  result: IngestResult,
): Promise<void> {
  const db = supabaseAdmin();
  const now = new Date().toISOString();

  const { data: prior } = await db
    .from("source_health")
    .select("consecutive_failures")
    .eq("source_id", source.id)
    .maybeSingle();

  const priorFailures = Number(prior?.consecutive_failures ?? 0);

  const { error } = await db.from("source_health").upsert(
    {
      source_id: source.id,
      label: source.label,
      kind: source.kind,
      adapter: source.adapter,
      last_run_at: now,
      last_ok_at: result.ok ? now : undefined,
      ok: result.ok,
      fetched: result.fetched,
      kept: result.kept,
      inserted: result.inserted,
      duration_ms: result.durationMs,
      consecutive_failures: result.ok ? 0 : priorFailures + 1,
      error: result.error ?? null,
    },
    { onConflict: "source_id" },
  );
  if (error) throw new Error(`health upsert failed: ${error.message}`);
}

/**
 * Remove a posting by hand, for roles that are gone from the source.
 *
 * Sets a flag instead of deleting the row, because the ingest upserts on
 * (source_id, external_id): a deleted row is re-inserted on the next run and
 * the removal silently undoes itself. `removed_at` is a column the ingest never
 * writes, so it survives every subsequent pass over the same posting.
 *
 * Returns false when no such row exists, so a stale page cannot report success
 * for something it did not actually change.
 */
export async function removeJob(id: string, reason?: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("jobs")
    .update({
      removed_at: new Date().toISOString(),
      removed_reason: reason?.slice(0, 200) ?? null,
    })
    .eq("id", id)
    .is("removed_at", null)
    .select("id");
  if (error) throw new Error(`remove failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Undo a removal - the mistake is one click away, so the fix should be too. */
export async function restoreJob(id: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("jobs")
    .update({ removed_at: null, removed_reason: null })
    .eq("id", id)
    .not("removed_at", "is", null)
    .select("id");
  if (error) throw new Error(`restore failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Everything removed by hand, newest first - the undo list. */
export async function removedJobs(limit = 100): Promise<JobRecord[]> {
  const db = supabasePublic();
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .not("removed_at", "is", null)
    .order("removed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`removed query failed: ${error.message}`);
  return (data ?? []).map(fromRow);
}

export async function markNotified(jobIds: string[]): Promise<void> {
  if (jobIds.length === 0) return;
  const db = supabaseAdmin();
  const CHUNK = 300;
  for (let i = 0; i < jobIds.length; i += CHUNK) {
    const { error } = await db
      .from("jobs")
      .update({ notified_at: new Date().toISOString() })
      .in("id", jobIds.slice(i, i + CHUNK));
    if (error) throw new Error(`notify mark failed: ${error.message}`);
  }
}

/* -------------------------------------------------------------------------- */
/* reads                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Read every row a query matches, not the first thousand.
 *
 * PostgREST caps a response at its `max-rows` setting - 1000 on Supabase - and
 * does so SILENTLY: `.limit(20_000)` returns 1000 rows with no error and no
 * truncation flag. Anything that counts or sweeps the whole table has to page,
 * or it quietly reports on a subset. That is not hypothetical: the facet chips
 * and the Riyadh purge were both doing exactly this, so the stats under-counted
 * and the purge skipped rows it was written to remove.
 *
 * `build(from, to)` must return a fresh query each call - PostgREST builders are
 * single-use.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  label = "query",
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label} failed: ${error.message}`);
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
    // A table larger than this means something has gone wrong upstream; stop
    // rather than paging forever.
    if (out.length >= 100_000) return out;
  }
}

export interface JobQuery {
  city?: string;
  tracks?: string[];
  bands?: string[];
  /** Exact employer name. */
  company?: string;
  sourceId?: string;
  sourceKind?: string;
  search?: string;
  /** Only postings first seen in the last N days. */
  sinceDays?: number;
  /**
   * Only postings whose *effective* posting time falls inside this many hours.
   *
   * Hours rather than days because the shortest window on offer is 12h, and
   * expressing that as 0.5 days invites rounding bugs.
   *
   * "Effective" means `posted_at` when the source supplied one and
   * `first_seen_at` otherwise. That fallback is not a fudge: for a source with
   * no date, the moment we first saw a posting is a genuine upper bound on its
   * age, and it is the same value the card displays - so a row can never be
   * shown with a timestamp that contradicts the filter that admitted it.
   * `EFFECTIVE_POSTED_SQL` keeps the two in step.
   */
  postedWithinHours?: number;
  limit?: number;
  offset?: number;
  sort?: "newest" | "posted" | "company";
}

export async function queryJobs(
  q: JobQuery = {},
): Promise<{ jobs: JobRecord[]; total: number }> {
  const db = supabasePublic();
  // The ceiling is high because the company-grouped view has to see every
  // matching row to group it - capping at 200 made the header claim "615 roles
  // across 22 companies" when there were 54, because grouping only ever saw the
  // first page.
  // Whole numbers in range: "?limit=abc" or a negative offset made the query fail.
  const whole = (v: number | undefined, fallback: number) => (Number.isFinite(v) && (v as number) >= 0 ? Math.trunc(v as number) : fallback);
  const limit = Math.min(Math.max(whole(q.limit, 50), 1), 1000);
  const offset = Math.min(whole(q.offset, 0), 100_000);

  let query = db
    .from("jobs")
    .select("*", { count: "exact" })
    .eq("is_active", true)
    .is("removed_at", null)
    // Verified vacancies only, one row per vacancy (state.ts, dedupe.ts).
    .eq("review_state", "show")
    .is("duplicate_of", null)
    /*
     * Past its stated deadline, so not applicable any more.
     *
     * Only excludes postings that actually carry a date. A null closes_at is
     * the common case and means "no deadline stated" - it must never be read
     * as "closes now", which would empty the board.
     */
    .or(`closes_at.is.null,closes_at.gte.${new Date().toISOString()}`);

  if (q.city && q.city !== "all") query = query.eq("city", q.city);
  if (q.tracks?.length) query = query.overlaps("tracks", q.tracks);
  if (q.bands?.length) query = query.in("experience_band", q.bands);
  if (q.sourceId && q.sourceId !== "all") query = query.eq("source_id", q.sourceId);
  /*
   * Matched exactly, never through the search filter.
   *
   * The company page used to pass the name as a search term, and PostgREST
   * builds that into an or() whose syntax is comma- and parenthesis-delimited.
   * "Saudi National Bank (SNB)" therefore broke the filter: its card said three
   * roles and its page showed none.
   */
  if (q.company) query = query.eq("company", q.company);

  if (q.sourceKind && q.sourceKind !== "all") {
    query = query.eq("source_kind", q.sourceKind);
  } else if (q.company) {
    /*
     * Asking for one employer means all of its postings.
     *
     * The exclusion below exists to keep already-syndicated listings out of the
     * DEFAULT board, not to hide them when you have asked for a company by
     * name. Applying it here meant every employer discovered through an
     * aggregator showed "0 open roles" on its own page while its card on the
     * Careerjet or JSearch tab counted them - SiFi, SITE, Trace Systems and
     * Salla all did exactly that.
     */
  } else {
    // The aggregators live only in their own tabs. Their rows are
    // already-syndicated copies of postings that reached the employer boards
    // first, so letting them into the default view would push the early
    // listings down the page.
    query = query.not("source_kind", "in", `(${AGGREGATOR_KINDS.join(",")})`);
  }
  if (q.search) {
    // Only letters, digits and spaces reach the filter: PostgREST's or() is
    // comma- and bracket-delimited, so "x,review_state.eq.hidden" from the
    // public feed's ?q= added filters of its own (security review, 2026-10-22).
    const term = `%${q.search.replace(/[^\p{L}\p{N} .+#-]/gu, " ").replace(/[.]/g, " ").trim().slice(0, 80)}%`;
    query = query.or(`title.ilike.${term},company.ilike.${term}`);
  }
  if (q.sinceDays) {
    const since = new Date(Date.now() - q.sinceDays * 86_400_000).toISOString();
    query = query.gte("first_seen_at", since);
  }
  if (q.postedWithinHours) {
    const since = new Date(Date.now() - q.postedWithinHours * 3_600_000).toISOString();
    // One hour of clock-skew tolerance, matching effectivePostedAt.
    const horizon = new Date(Date.now() + 3_600_000).toISOString();
    /*
     * The SQL twin of effectivePostedAt, and it has to stay that way or a row
     * gets admitted on one measure and displayed on another.
     *
     *   1. a believable posted_at inside the window
     *   2. posted_at in the future - not a posting date, so judge on first_seen
     *   3. no posted_at at all - judge on first_seen
     *
     * Case 2 is the one that bit: `posted_at >= cutoff` alone is satisfied by
     * ANY future date, so an event dated next month sailed through "last 12
     * hours".
     */
    query = query.or(
      [
        `and(posted_at.gte.${since},posted_at.lte.${horizon})`,
        `and(posted_at.gt.${horizon},first_seen_at.gte.${since})`,
        `and(posted_at.is.null,first_seen_at.gte.${since})`,
      ].join(","),
    );
  }

  switch (q.sort) {
    case "posted":
      // posted_at first, then first_seen_at for the rows that have no
      // posted_at, so "newest posted" does not park every undated posting at
      // the bottom regardless of how recent it actually is.
      query = query
        .order("posted_at", { ascending: false, nullsFirst: false })
        .order("first_seen_at", { ascending: false });
      break;
    case "company":
      query = query.order("company", { ascending: true });
      break;
    default:
      query = query.order("first_seen_at", { ascending: false });
  }

  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`query failed: ${error.message}`);

  return { jobs: (data ?? []).map(fromRow), total: count ?? 0 };
}

/**
 * Facet counts for the filter chips, computed in one pass over active rows.
 *
 * Scoped to the source kind *and* the active city, so a chip's number always
 * matches what clicking it returns. Without the city scope a student sees
 * "Co-op training 8", clicks it under the default Riyadh filter, and gets
 * nothing - because those eight co-ops are in Dammam.
 *
 * The city breakdown itself stays unscoped, since that is what the city
 * dropdown offers you to switch to.
 */
export async function facetCounts(sourceKind?: string, city?: string): Promise<{
  byTrack: Record<string, number>;
  byBand: Record<string, number>;
  byCity: Record<string, number>;
  bySource: Array<{ sourceId: string; label: string; kind: string; count: number }>;
  total: number;
  newThisWeek: number;
}> {
  const db = supabasePublic();
  const data = await fetchAllRows<Record<string, unknown>>((from, to) => {
    let q = db
      .from("jobs")
      .select("tracks, experience_band, city, source_id, source_label, source_kind, first_seen_at")
      .eq("is_active", true)
      .is("removed_at", null)
      .eq("review_state", "show")
      .is("duplicate_of", null);
    q = sourceKind && sourceKind !== "all"
      ? q.eq("source_kind", sourceKind)
      : q.not("source_kind", "in", `(${AGGREGATOR_KINDS.join(",")})`);
    return q.range(from, to);
  }, "facets");

  const byTrack: Record<string, number> = {};
  const byBand: Record<string, number> = {};
  const byCity: Record<string, number> = {};
  const sourceMap = new Map<string, { label: string; kind: string; count: number }>();
  const weekAgo = Date.now() - 7 * 86_400_000;
  let newThisWeek = 0;
  let total = 0;

  const cityFilter = city && city !== "all" ? city : null;

  for (const row of data ?? []) {
    const rowCity = String(row.city);
    // Always counted: this is the list the city dropdown is built from.
    byCity[rowCity] = (byCity[rowCity] ?? 0) + 1;
    if (cityFilter && rowCity !== cityFilter) continue;

    total++;
    for (const t of (row.tracks as string[]) ?? []) byTrack[t] = (byTrack[t] ?? 0) + 1;
    byBand[String(row.experience_band)] = (byBand[String(row.experience_band)] ?? 0) + 1;

    const sid = String(row.source_id);
    const entry = sourceMap.get(sid) ?? {
      label: String(row.source_label),
      kind: String(row.source_kind),
      count: 0,
    };
    entry.count++;
    sourceMap.set(sid, entry);

    if (new Date(String(row.first_seen_at)).getTime() >= weekAgo) newThisWeek++;
  }

  return {
    byTrack,
    byBand,
    byCity,
    bySource: [...sourceMap.entries()]
      .map(([sourceId, v]) => ({ sourceId, ...v }))
      .sort((a, b) => b.count - a.count),
    total,
    newThisWeek,
  };
}

/**
 * Fingerprints of every posting that reached us from a company board.
 *
 * The aggregator tabs use this to mark rows that duplicate something already
 * found first-hand. A duplicate is not noise - it confirms the role is real -
 * but it is worth showing which ones you have already seen on the employer's
 * own site, where the listing arrived earlier.
 */
export async function companyFingerprints(): Promise<Set<string>> {
  const db = supabasePublic();
  const seen = new Set<string>();
  let from = 0;
  for (;;) {
    const { data, error } = await db
      .from("jobs")
      .select("fingerprint")
      .eq("is_active", true)
      .is("removed_at", null)
      .not("source_kind", "in", `(${AGGREGATOR_KINDS.join(",")})`)
      .range(from, from + 999);
    if (error) throw new Error(`fingerprints failed: ${error.message}`);
    for (const r of data ?? []) seen.add(String(r.fingerprint));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return seen;
}

/* -------------------------------------------------------------------------- */
/* careers-URL findings                                                        */
/* -------------------------------------------------------------------------- */

export interface StoredUrlFinding {
  company: string;
  currentUrl: string;
  suggestedUrl: string | null;
  extraUrls: string[];
  status: "unchanged" | "moved" | "extra-found" | "stale" | "unreachable";
  note: string | null;
  checkedAt: string;
  reviewedAt: string | null;
}

/**
 * When each employer's URL was last checked.
 *
 * Drives the batching: the in-app check takes the companies checked longest
 * ago, so pressing the button repeatedly sweeps the whole list instead of
 * re-checking the same twenty-five.
 */
export async function urlFindingsCheckedBefore(): Promise<Map<string, number>> {
  const db = supabasePublic();
  const out = new Map<string, number>();
  const rows = await fetchAllRows<{ company: string; checked_at: string }>(
    (from, to) => db.from("url_findings").select("company, checked_at").range(from, to),
    "url findings",
  ).catch(() => []);
  for (const r of rows) out.set(String(r.company), new Date(String(r.checked_at)).getTime());
  return out;
}

/**
 * Record what a check found.
 *
 * A new finding clears any previous review: if the URL has moved again since
 * you last looked at it, that is news, not something already dealt with.
 */
export async function saveUrlFindings(
  findings: Array<{
    company: string;
    currentUrl: string;
    suggestedUrl?: string;
    extraUrls: string[];
    status: string;
    note?: string;
  }>,
): Promise<void> {
  if (findings.length === 0) return;
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const { error } = await db.from("url_findings").upsert(
    findings.map((f) => ({
      company: f.company,
      current_url: f.currentUrl,
      suggested_url: f.suggestedUrl ?? null,
      extra_urls: f.extraUrls,
      status: f.status,
      note: f.note ?? null,
      checked_at: now,
      reviewed_at: null,
    })),
    { onConflict: "company" },
  );
  if (error) throw new Error(`url findings upsert failed: ${error.message}`);
}

/** Findings worth showing: anything that is not "unchanged" and not reviewed. */
export async function openUrlFindings(): Promise<StoredUrlFinding[]> {
  const db = supabasePublic();
  const { data, error } = await db
    .from("url_findings")
    .select("*")
    .neq("status", "unchanged")
    .is("reviewed_at", null)
    .order("checked_at", { ascending: false })
    .limit(500);
  if (error) throw new Error(`url findings query failed: ${error.message}`);
  return (data ?? []).map((r) => ({
    company: String(r.company),
    currentUrl: String(r.current_url),
    suggestedUrl: (r.suggested_url as string) ?? null,
    extraUrls: (r.extra_urls as string[]) ?? [],
    status: r.status as StoredUrlFinding["status"],
    note: (r.note as string) ?? null,
    checkedAt: String(r.checked_at),
    reviewedAt: (r.reviewed_at as string) ?? null,
  }));
}

/** How much of the list has been swept, for the button to report progress. */
export async function urlCheckProgress(): Promise<{ checked: number; open: number }> {
  const db = supabasePublic();
  const [{ count: checked }, { count: open }] = await Promise.all([
    db.from("url_findings").select("company", { count: "exact", head: true }),
    db
      .from("url_findings")
      .select("company", { count: "exact", head: true })
      .neq("status", "unchanged")
      .is("reviewed_at", null),
  ]);
  return { checked: checked ?? 0, open: open ?? 0 };
}

export type UrlRole = "primary" | "alternate";
export type UrlDecisionValue = "accepted" | "rejected";

export interface UrlDecision {
  company: string;
  url: string;
  role: UrlRole;
  decision: UrlDecisionValue;
  decidedAt: string;
}

/**
 * Record a decision about one proposed URL.
 *
 * Per URL rather than per finding: a single check can turn up a replacement
 * plus three additional boards, and you may want one of them and not the rest.
 */
export async function saveUrlDecision(
  company: string,
  url: string,
  role: UrlRole,
  decision: UrlDecisionValue,
): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("url_decisions").upsert(
    { company, url, role, decision, decided_at: new Date().toISOString() },
    { onConflict: "company,url" },
  );
  if (error) throw new Error(`url decision failed: ${error.message}`);
}

/** Undo a decision, putting the URL back on the list as undecided. */
export async function clearUrlDecision(company: string, url: string): Promise<void> {
  const db = supabaseAdmin();
  const { error } = await db.from("url_decisions").delete().eq("company", company).eq("url", url);
  if (error) throw new Error(`clear decision failed: ${error.message}`);
}

/** Every decision so far, so the UI can show what has already been settled. */
export async function urlDecisions(): Promise<UrlDecision[]> {
  const db = supabasePublic();
  const rows = await fetchAllRows<Record<string, unknown>>(
    (from, to) => db.from("url_decisions").select("*").range(from, to),
    "url decisions",
  ).catch(() => []);
  return rows.map((r) => ({
    company: String(r.company),
    url: String(r.url),
    role: r.role as UrlRole,
    decision: r.decision as UrlDecisionValue,
    decidedAt: String(r.decided_at),
  }));
}

/**
 * Accepted URLs, grouped for the collector.
 *
 * Discovery merges these over the seed list: an accepted 'primary' replaces the
 * employer's careers URL, and accepted 'alternate' entries are added as extra
 * boards. The seed file stays the starting point and is never rewritten.
 */
export async function acceptedUrlOverrides(): Promise<
  Map<string, { primary?: string; alternates: string[] }>
> {
  const out = new Map<string, { primary?: string; alternates: string[] }>();
  for (const d of await urlDecisions()) {
    if (d.decision !== "accepted") continue;
    const entry = out.get(d.company) ?? { alternates: [] };
    if (d.role === "primary") entry.primary = d.url;
    else if (!entry.alternates.includes(d.url)) entry.alternates.push(d.url);
    out.set(d.company, entry);
  }
  return out;
}

/** Postings first seen inside the digest window and not yet emailed. */
export async function jobsForDigest(sinceIso: string, limit = 120): Promise<JobRecord[]> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("jobs")
    .select("*")
    .eq("is_active", true)
    .is("removed_at", null)
    .is("notified_at", null)
    // Only what the board shows: verified, in scope, one row per vacancy.
    .eq("review_state", "show")
    .is("duplicate_of", null)
    .gte("first_seen_at", sinceIso)
    .order("first_seen_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`digest query failed: ${error.message}`);
  return (data ?? []).map(fromRow);
}

export async function sourceHealth(): Promise<
  Array<{
    sourceId: string;
    label: string;
    kind: string;
    adapter: string;
    ok: boolean;
    lastRunAt: string | null;
    lastOkAt: string | null;
    fetched: number;
    kept: number;
    consecutiveFailures: number;
    error: string | null;
  }>
> {
  const db = supabasePublic();
  // Every row: ~850 on 2026-10-22 and growing. A plain select stops at 1000,
  // and sorted by "kept" the rows cut off would be the failing ones - the very
  // ones the Failing sources page and the repair checker need.
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) => db.from("source_health").select("*").order("kept", { ascending: false }).order("source_id").range(from, to),
    "source health",
  );
  return data.map((r) => ({
    sourceId: String(r.source_id),
    label: String(r.label),
    kind: String(r.kind),
    adapter: String(r.adapter),
    ok: Boolean(r.ok),
    lastRunAt: (r.last_run_at as string) ?? null,
    lastOkAt: (r.last_ok_at as string) ?? null,
    fetched: Number(r.fetched ?? 0),
    kept: Number(r.kept ?? 0),
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    error: (r.error as string) ?? null,
  }));
}
/* -------------------------------------------------------------------------- */
/* site report                                                                 */
/* -------------------------------------------------------------------------- */

export interface SourceReport {
  company: string;
  sector: string | null;
  priority: number | null;
  careers_url: string | null;
  verdict: string;
  reason: string;
  fix: string;
  suggested_url: string | null;
  emails: string[];
  postings_seen: number;
  jobs_found: number;
  checked_at: string;
}

/** Every employer whose site could not be read, with the reason and the fix. */
export async function sourceReports(): Promise<SourceReport[]> {
  return fetchAllRows<SourceReport>(
    (from, to) =>
      supabaseAdmin()
        .from("source_reports")
        .select("*")
        .order("priority", { ascending: true })
        .order("company", { ascending: true })
        .range(from, to),
    "source_reports",
  );
}

/** The stored description of each of these postings, for the no-shrink guard in ingest. */
export async function storedTexts(sourceId: string, externalIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const db = supabaseAdmin();
  for (let i = 0; i < externalIds.length; i += 150) {
    const { data, error } = await db
      .from("jobs")
      .select("external_id,description_text")
      .eq("source_id", sourceId)
      .in("external_id", externalIds.slice(i, i + 150));
    if (error) throw new Error(`stored texts: ${error.message}`);
    for (const r of data ?? []) if (r.description_text) out.set(String(r.external_id), String(r.description_text));
  }
  return out;
}
