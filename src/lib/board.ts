import { fetchAllRows, supabaseAdmin, supabaseRead } from "./db";
import { platformName, platformOf } from "./platform";
import { isRecommendedCompany } from "./recommended-company";
import { scoreJob, type ResumeProfile } from "./resume";
import type { AlsoOn, ExperienceBand, TrackId } from "./types";

/**
 * Server-side data for the board.
 *
 * The board's sorting and badge filtering happen in the browser (Board.tsx):
 * the visible set is a few hundred verified vacancies, and the user's badge
 * choices re-order it instantly without a round trip. The server decides what
 * each tab contains, scores the CV match (it needs the full description,
 * which is never sent to the browser in the list), and attaches saved state.
 */

export const BOARD_TABS = ["all", "saved", "company", "linkedin", "boards", "unclassified", "review", "saudi", "senior", "hidden"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

export interface BoardJob {
  id: string;
  title: string;
  company: string;
  url: string;
  applyUrl: string | null;
  applyKind: string | null;
  sourceKind: string;
  sourceLabel: string;
  publisher: string | null;
  location: string;
  city: string;
  experienceBand: ExperienceBand;
  minYears: number | null;
  maxYears: number | null;
  experienceSource: string | null;
  experienceEvidence: string | null;
  focus: string[];
  scope: string | null;
  scopeEvidence: string[];
  postedAt: string | null;
  firstSeenAt: string;
  lastRefreshedAt: string | null;
  closesAt: string | null;
  alsoOn: AlsoOn[];
  /** Other sites the same posting is listed on, as its source reported (JSearch). */
  listedOn: string[];
  textQuality: string | null;
  textFetchedAt: string | null;
  reviewState: string;
  hiddenReason: string | null;
  decisionNote: string | null;
  decidedBy: string | null;
  humanOverride: string | null;
  isActive: boolean;
  recommended: boolean;
  /** A big-name or technical employer (recommended-company.ts). */
  recommendedCompany: boolean;
  /** The weekly accuracy check's doubt about this job, if any (accuracy-check.ts). */
  doubleCheck: string | null;
  matchScore: number | null;
  matchNote: string | null;
  saved: { savedAt: string; appliedAt: string | null } | null;
}

const COMPANY_KINDS = ["ats", "career-page"];
const LINKEDIN_KINDS = ["linkedin", "linkedin-post"];
const BOARD_KINDS = ["jsearch", "jooble", "careerjet", "indeed", "aggregator", "telegram"];
const PLATFORM_TABS = new Set<BoardTab>(["company", "linkedin", "boards"]);

/**
 * Whether a card belongs on a platform tab. A card is one vacancy; it belongs
 * wherever the vacancy was seen, not only where its primary copy came from.
 * The LinkedIn tab showed 13 (user, 2026-10-21) because a job read in full on
 * a company site, with LinkedIn as its "also on" copy, or a JSearch result
 * Google found on LinkedIn, counted only as "company" or "job board".
 */
function onPlatformTab(tab: BoardTab, r: Row): boolean {
  const kind = String(r.source_kind);
  const others = ((r.also_on as AlsoOn[]) ?? []).map((a) => ({ kind: a.kind, name: platformName(a.label) }));
  const listed = ((r.listed_on as string[]) ?? []).map(platformName);
  const primary = platformOf(kind, String(r.source_label ?? ""), (r.publisher as string) ?? null);
  if (tab === "company") return COMPANY_KINDS.includes(kind) || others.some((o) => COMPANY_KINDS.includes(o.kind));
  if (tab === "linkedin") {
    const isLinkedIn = (name: string) => name.startsWith("LinkedIn");
    return LINKEDIN_KINDS.includes(kind) || isLinkedIn(primary) || others.some((o) => LINKEDIN_KINDS.includes(o.kind) || isLinkedIn(o.name)) || listed.some(isLinkedIn);
  }
  if (tab === "boards") return BOARD_KINDS.includes(kind) || others.some((o) => BOARD_KINDS.includes(o.kind));
  return true;
}

const LIST_COLUMNS =
  "id,title,company,url,apply_url,apply_kind,source_kind,source_label,publisher,location_text,city," +
  "experience_band,min_years,max_years,experience_source,experience_evidence,focus,scope,scope_evidence," +
  "posted_at,first_seen_at,last_refreshed_at,closes_at,also_on,listed_on,text_quality,text_fetched_at,review_state," +
  "hidden_reason,decision_note,decided_by,human_override,is_active,tracks,primary_track";

type Row = Record<string, unknown>;

function toBoardJob(r: Row): BoardJob {
  return {
    id: String(r.id),
    title: String(r.title),
    company: String(r.company),
    url: String(r.url),
    applyUrl: (r.apply_url as string) ?? null,
    applyKind: (r.apply_kind as string) ?? null,
    sourceKind: String(r.source_kind),
    sourceLabel: String(r.source_label),
    publisher: (r.publisher as string) ?? null,
    location: (r.location_text as string) ?? "",
    city: String(r.city ?? "unknown"),
    experienceBand: (r.experience_band as ExperienceBand) ?? "unknown",
    minYears: (r.min_years as number) ?? null,
    maxYears: (r.max_years as number) ?? null,
    experienceSource: (r.experience_source as string) ?? null,
    experienceEvidence: (r.experience_evidence as string) ?? null,
    focus: (r.focus as string[]) ?? [],
    scope: (r.scope as string) ?? null,
    scopeEvidence: (r.scope_evidence as string[]) ?? [],
    postedAt: (r.posted_at as string) ?? null,
    firstSeenAt: String(r.first_seen_at),
    lastRefreshedAt: (r.last_refreshed_at as string) ?? null,
    closesAt: (r.closes_at as string) ?? null,
    alsoOn: (r.also_on as AlsoOn[]) ?? [],
    listedOn: (r.listed_on as string[]) ?? [],
    textQuality: (r.text_quality as string) ?? null,
    textFetchedAt: (r.text_fetched_at as string) ?? null,
    reviewState: String(r.review_state ?? "pending"),
    hiddenReason: (r.hidden_reason as string) ?? null,
    decisionNote: (r.decision_note as string) ?? null,
    decidedBy: (r.decided_by as string) ?? null,
    humanOverride: (r.human_override as string) ?? null,
    isActive: Boolean(r.is_active),
    recommended: false,
    recommendedCompany: isRecommendedCompany(String(r.company)),
    doubleCheck: null,
    matchScore: null,
    matchNote: null,
    saved: null,
  };
}

/** The CV profile, stored server-side so every device and email can use it. */
export async function loadProfile(): Promise<ResumeProfile | null> {
  try {
    const { data } = await supabaseAdmin().from("user_profile").select("profile").eq("id", "me").maybeSingle();
    return (data?.profile as ResumeProfile) ?? null;
  } catch {
    return null;
  }
}

export async function savedMap(): Promise<Map<string, { savedAt: string; appliedAt: string | null }>> {
  try {
    const rows = await fetchAllRows<{ job_id: string; saved_at: string; applied_at: string | null }>(
      (from, to) => supabaseAdmin().from("saved_jobs").select("job_id,saved_at,applied_at").range(from, to),
      "saved_jobs",
    );
    return new Map(rows.map((r) => [r.job_id, { savedAt: r.saved_at, appliedAt: r.applied_at }]));
  } catch {
    return new Map();
  }
}

/** Which rows a tab holds. Every tab except Saved shows only primaries. */
export async function loadBoard(tab: BoardTab): Promise<BoardJob[]> {
  const db = supabaseRead();
  const saved = await savedMap();

  let rows: Row[];
  if (tab === "saved") {
    // Saved jobs are never removed by a rule: shown whatever their state,
    // active or not, so an expired application stays on the list, labelled.
    const ids = [...saved.keys()];
    rows = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data, error } = await db.from("jobs").select(`${LIST_COLUMNS},description_text`).in("id", ids.slice(i, i + 200));
      if (error) throw new Error(`saved jobs: ${error.message}`);
      rows.push(...(data ?? []));
    }
  } else {
    rows = await fetchAllRows<Row>((from, to) => {
      // The hidden tab never needs the description (no CV scoring there).
      let q = db
        .from("jobs")
        .select(tab === "hidden" ? LIST_COLUMNS : `${LIST_COLUMNS},description_text`)
        .eq("is_active", true)
        .is("removed_at", null)
        .is("duplicate_of", null);
      // Platform tabs are filtered below, by membership (onPlatformTab).
      if (tab === "all" || PLATFORM_TABS.has(tab)) q = q.eq("review_state", "show");
      // "pending" only exists between a run's write and its recompute; if a run
      // stops in between, those postings must still be visible somewhere.
      if (tab === "unclassified") q = q.in("review_state", ["unclassified", "pending"]);
      if (tab === "review") q = q.eq("review_state", "needs_review");
      if (tab === "senior") q = q.eq("review_state", "hidden").eq("hidden_reason", "experience_5plus");
      if (tab === "saudi") q = q.eq("review_state", "hidden").eq("hidden_reason", "ksa_no_city");
      if (tab === "hidden") q = q.eq("review_state", "hidden").not("hidden_reason", "in", "(experience_5plus,ksa_no_city)");
      return q.order("first_seen_at", { ascending: false }).range(from, to) as unknown as PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;
    }, `board ${tab}`);
    if (PLATFORM_TABS.has(tab)) rows = rows.filter((r) => onPlatformTab(tab, r));
  }

  const profile = tab === "hidden" ? null : await loadProfile();
  const doubts = await accuracyDoubts();
  return rows.map((r) => {
    const job = toBoardJob(r);
    // The owner's Keep or Hide settles a doubt for good.
    if (!job.humanOverride) job.doubleCheck = doubts.get(job.id) ?? null;
    job.saved = saved.get(job.id) ?? null;
    if (profile) {
      const m = scoreJob(
        {
          title: job.title,
          descriptionText: (r.description_text as string) ?? "",
          tracks: (r.tracks as TrackId[]) ?? [],
          primaryTrack: (r.primary_track as TrackId) ?? "unknown",
          experienceBand: job.experienceBand,
          minYears: job.minYears,
          maxYears: job.maxYears,
        },
        profile,
      );
      job.recommended = m.recommended;
      job.matchScore = m.score;
      job.matchNote = m.recommended ? (m.reasons[0] ?? null) : (m.blockers[0] ?? null);
    }
    return job;
  });
}

/** Jobs the weekly accuracy check doubted in the last 30 days, with why. */
async function accuracyDoubts(): Promise<Map<string, string>> {
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data } = await supabaseRead().from("accuracy_checks").select("job_id,why,checked_at").eq("flagged", true).gte("checked_at", since).order("checked_at", { ascending: true });
    return new Map((data ?? []).map((d) => [String(d.job_id), String(d.why ?? "the weekly check doubts it")]));
  } catch {
    return new Map();
  }
}

/** Counts for the tab bar. One light query, grouped in memory. */
export async function tabCounts(): Promise<Record<BoardTab, number>> {
  const counts: Record<BoardTab, number> = { all: 0, saved: 0, company: 0, linkedin: 0, boards: 0, unclassified: 0, review: 0, saudi: 0, senior: 0, hidden: 0 };
  try {
    const rows = await fetchAllRows<Row & { review_state: string; hidden_reason: string | null }>(
      (from, to) =>
        supabaseRead()
          .from("jobs")
          .select("review_state,hidden_reason,source_kind,source_label,publisher,also_on,listed_on")
          .eq("is_active", true)
          .is("removed_at", null)
          .is("duplicate_of", null)
          .range(from, to),
      "tab counts",
    );
    for (const r of rows) {
      if (r.review_state === "show") {
        counts.all++;
        for (const tab of PLATFORM_TABS) if (onPlatformTab(tab, r)) counts[tab]++;
      } else if (r.review_state === "unclassified" || r.review_state === "pending") counts.unclassified++;
      else if (r.review_state === "needs_review") counts.review++;
      else if (r.review_state === "hidden" && r.hidden_reason === "experience_5plus") counts.senior++;
      else if (r.review_state === "hidden" && r.hidden_reason === "ksa_no_city") counts.saudi++;
      else if (r.review_state === "hidden") counts.hidden++;
    }
    counts.saved = (await savedMap()).size;
  } catch {
    /* counts are decoration; the board still renders */
  }
  return counts;
}
