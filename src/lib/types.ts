/** Core domain types shared by scrapers, API routes and the UI. */

export const TRACKS = [
  "security",
  "cloud",
  "infra",
  "grc",
  "data-ai",
  "software",
  "it-support",
  "unknown",
] as const;
export type TrackId = (typeof TRACKS)[number];

export const TRACK_LABELS: Record<TrackId, string> = {
  security: "Cybersecurity",
  cloud: "Cloud",
  infra: "Infrastructure & Ops",
  grc: "GRC & Risk",
  "data-ai": "Data & AI",
  software: "Software Engineering",
  "it-support": "IT Support",
  unknown: "Unclassified",
};

export const EXPERIENCE_BANDS = [
  "coop",
  "internship",
  "0",
  "1-2",
  "3-5",
  "6-9",
  "10+",
  "unknown",
] as const;
export type ExperienceBand = (typeof EXPERIENCE_BANDS)[number];

export const EXPERIENCE_LABELS: Record<ExperienceBand, string> = {
  coop: "Co-op training",
  internship: "Internship",
  /*
   * "No experience required" and "one or two years" are different jobs to
   * anyone who has neither. Collapsing them into a single 0-2 band hid the
   * roles a final-year student can actually apply for behind the ones asking
   * for two years in industry.
   */
  "0": "No experience needed",
  "1-2": "1-2 years",
  "3-5": "3-5 years (mid)",
  "6-9": "6-9 years (senior)",
  "10+": "10+ years (lead)",
  unknown: "Not stated",
};

export const CITIES = [
  "riyadh",
  "jeddah",
  "dammam",
  "khobar",
  "dhahran",
  "jubail",
  "yanbu",
  "mecca",
  "medina",
  "tabuk",
  "neom",
  "qassim",
  "abha",
  "hail",
  "najran",
  "jazan",
  "taif",
  "kaec",
  "remote-ksa",
  "ksa-other",
  /*
   * The posting stated its own location and it was not in Saudi Arabia.
   *
   * Deliberately distinct from "unknown": unknown is kept on the board, and
   * this must not be. DXC's Cyber Security Intern says "Work Location: Milan"
   * in its description; with only "unknown" available it sat on a Riyadh board
   * as an unplaced role.
   */
  "foreign",
  "unknown",
] as const;
export type CityId = (typeof CITIES)[number];

export const CITY_LABELS: Record<CityId, string> = {
  riyadh: "Riyadh",
  jeddah: "Jeddah",
  dammam: "Dammam",
  khobar: "Al Khobar",
  dhahran: "Dhahran",
  jubail: "Jubail",
  yanbu: "Yanbu",
  mecca: "Mecca",
  medina: "Medina",
  tabuk: "Tabuk",
  neom: "NEOM",
  qassim: "Qassim",
  abha: "Abha",
  hail: "Hail",
  najran: "Najran",
  jazan: "Jazan",
  taif: "Taif",
  kaec: "King Abdullah Economic City",
  "remote-ksa": "Remote (Saudi)",
  "ksa-other": "Saudi Arabia (other)",
  foreign: "Outside Saudi Arabia",
  unknown: "Not stated",
};

/** How a source was reached. Drives the "how fresh is this" signal in the UI. */
export type SourceKind =
  | "ats" // company's own applicant tracking system - the earliest signal
  | "career-page" // company site scraped directly (JSON-LD / HTML)
  // Each aggregator gets its own kind so it gets its own tab, and so none of
  // them can leak into the company results.
  | "jsearch" // Google for Jobs proxy
  | "jooble" // Jooble API
  | "careerjet" // Careerjet API
  | "linkedin" // LinkedIn job listings (public, no login)
  | "linkedin-post" // a company "we are hiring" post on LinkedIn
  | "indeed" // Indeed, where it arrives as its own source
  | "aggregator" // any future multi-company API
  | "job-board" // classic board (Bayt, GulfTalent...)
  | "government" // Jadarat, Taqat, Qiwa
  | "rss";

/** A raw posting as returned by an adapter, before enrichment. */
export interface RawJob {
  sourceId: string;
  /** When applications close, where the posting states one. */
  closesAt?: string | null;
  externalId: string;
  title: string;
  company: string;
  locationText?: string;
  descriptionText?: string;
  url: string;
  postedAt?: string | null;
  department?: string | null;
  employmentType?: string | null;
  /** The board a syndicated posting came from (JSearch: LinkedIn, Indeed, Bayt...). */
  publisher?: string | null;
  /** Where the Apply button goes, when that differs from the posting URL. */
  applyUrl?: string | null;
}

/** A posting after classification, ready to persist. */
export interface EnrichedJob extends RawJob {
  fingerprint: string;
  tracks: TrackId[];
  primaryTrack: TrackId;
  experienceBand: ExperienceBand;
  minYears: number | null;
  maxYears: number | null;
  city: CityId;
  isRiyadh: boolean;
  sourceKind: SourceKind;
  sourceLabel: string;
  firstSeenAt: string;
  companyKey: string;
  textQuality: TextQuality;
  textHash: string;
  experienceSource: "programme" | "stated" | "none";
  experienceEvidence: string | null;
  applyKind: ApplyKind;
}

export type TextQuality = "full" | "partial" | "snippet" | "none";
export type ApplyKind = "form" | "email" | "ats" | "linkedin" | "board" | "page";
export type ReviewState = "pending" | "show" | "unclassified" | "needs_review" | "hidden";
export type HiddenReason =
  | "not_a_job"
  | "not_riyadh"
  | "out_of_scope"
  | "experience_5plus"
  | "too_old"
  | "stale"
  | "closed"
  | "human";

/** A row as stored and as served to the client. */
export interface JobRecord extends EnrichedJob {
  id: string;
  lastSeenAt: string;
  isActive: boolean;
  /** Set when removed by hand because the role is gone from the source. */
  removedAt?: string | null;
  reviewState: ReviewState;
  hiddenReason: HiddenReason | null;
  decidedBy: string | null;
  decisionNote: string | null;
  humanOverride: "show" | "hide" | null;
  scope: "security" | "cloud" | "both" | null;
  focus: string[];
  scopeEvidence: string[];
  duplicateOf: string | null;
  alsoOn: AlsoOn[];
  lastRefreshedAt: string | null;
  textFetchedAt: string | null;
}

/** Another place the same vacancy was found. */
export interface AlsoOn {
  kind: string;
  label: string;
  url: string;
}

/**
 * When a posting went live, as far as we can tell.
 *
 * Sources are inconsistent about `postedAt` - plenty of ATS feeds omit it
 * entirely - so the fallback is when this app first saw the row, which is a
 * genuine upper bound on the posting's age.
 *
 * This is the single definition used by the age filter, the sort, the freshness
 * badge and the timestamp on the card. Keeping them on one function is what
 * stops a card from displaying "5 days ago" while sitting inside a
 * "last 24 hours" filter.
 */
export function effectivePostedAt(job: {
  postedAt?: string | null;
  firstSeenAt: string;
}): { iso: string; exact: boolean } {
  if (job.postedAt) {
    /*
     * A date in the future is not a posting date. Oracle's board carries an
     * event listing dated three weeks out, and taking it at face value made the
     * row "posted just now" - and let it through every age window, including
     * "last 12 hours", because a future timestamp satisfies any `>= cutoff`
     * test. Sources also mis-parse day/month order, which lands in the same
     * place. Where the date cannot be true, fall back to when we saw it.
     *
     * The hour of tolerance is for clock skew between the source and us, not a
     * judgement about the date.
     */
    const t = new Date(job.postedAt).getTime();
    if (Number.isFinite(t) && t <= Date.now() + 3_600_000) {
      return { iso: job.postedAt, exact: true };
    }
  }
  return { iso: job.firstSeenAt, exact: false };
}

export interface SourceDefinition {
  id: string;
  label: string;
  kind: SourceKind;
  /** Adapter name -> which fetcher knows how to read this. */
  adapter: string;
  /** Adapter-specific handle: board token, tenant id, feed url... */
  handle: string;
  /** Optional second handle (Workday tenant sites, SuccessFactors company id). */
  handle2?: string;
  /** Human-facing company name when the source is a single employer. */
  company?: string;
  /** Country/region hint used to skip obviously irrelevant boards early. */
  region?: "ksa" | "gulf" | "global";
  /** Set false to keep a definition on file without polling it. */
  enabled?: boolean;
  /** Why a source was switched off, when it was switched off for a reason. */
  note?: string;
  /** Marks sources that need a real browser (Playwright) rather than fetch. */
  needsBrowser?: boolean;
}

export interface IngestResult {
  sourceId: string;
  ok: boolean;
  fetched: number;
  kept: number;
  inserted: number;
  error?: string;
  durationMs: number;
}
