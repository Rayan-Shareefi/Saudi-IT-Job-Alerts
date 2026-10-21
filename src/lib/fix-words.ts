/**
 * The words and types of a source fix, shared by the pages (browser code)
 * and src/lib/source-fix.ts. No server imports here: the repair cards are
 * client components.
 */
export type FixPage = "human" | "sites" | "failing" | "urls";
export type FixStatus = "queued" | "checking" | "applied" | "needs_you" | "done";
export type FixVerdict =
  | "works"
  | "works-empty"
  | "linkedin"
  | "blocked"
  | "robots"
  | "login"
  | "unreachable"
  | "not-found"
  | "no-postings"
  | "other-company"
  | "nothing-found"
  | "queued-all";
/** What the user can choose for a fix that waits for them. */
export type FixDecision = "keep" | "delete" | "linkedin" | "replace" | "accept" | "undo";

export interface FixRow {
  id: string;
  company: string;
  sourceId: string | null;
  page: FixPage;
  oldUrl: string | null;
  newUrl: string | null;
  requestedBy: "user" | "auto";
  status: FixStatus;
  verdict: FixVerdict | null;
  reason: string | null;
  detail: FixDetail;
  options: FixDecision[];
  decision: FixDecision | null;
  decidedAt: string | null;
  createdAt: string;
  checkedAt: string | null;
}

/** A board the checker read, ready to be added as a source. */
export interface FoundBoard {
  adapter: string;
  handle: string;
  handle2?: string;
  url: string;
  needsBrowser: boolean;
}

export interface FixDetail {
  board?: FoundBoard;
  postings?: number;
  saudi?: number;
  sample?: string[];
  linkedinSlug?: string | null;
  /** Every URL tried, and what each one said. */
  tried?: Array<{ url: string; verdict: FixVerdict; why: string }>;
  /** For Check URLs: an extra board rather than a replacement. */
  role?: "primary" | "alternate";
  /** Set when the decision was the user's learned habit, not the checker's. */
  learned?: string;
  /** The dynamic source this fix added, and the sources it switched off. */
  addedSource?: string;
  disabled?: string[];
}

/** Plain words for each outcome, as the cards show them. */
export const VERDICT_WORDS: Record<FixVerdict, string> = {
  works: "Fixed - real postings read from the new URL",
  "works-empty": "Fixed - the right careers page, nothing open there today",
  linkedin: "Read through LinkedIn instead",
  blocked: "The site blocks automated readers",
  robots: "The site asks crawlers not to read this page (robots.txt)",
  login: "Needs a personal login",
  unreachable: "The site does not answer",
  "not-found": "The page does not exist (404)",
  "no-postings": "The page opens, but no postings could be read",
  "other-company": "Postings found, but not this employer's",
  "nothing-found": "No working URL found",
  "queued-all": "Checked every item on the page",
};

/** The choices offered for each problem, most useful first. */
export function optionsFor(verdict: FixVerdict): FixDecision[] {
  switch (verdict) {
    case "works":
    case "works-empty":
    case "linkedin":
      return ["undo"];
    case "blocked":
    case "robots":
    case "login":
      return ["linkedin", "replace", "keep", "delete"];
    case "no-postings":
    case "other-company":
      return ["accept", "replace", "linkedin", "keep", "delete"];
    default:
      return ["replace", "linkedin", "delete", "keep"];
  }
}

export const DECISION_WORDS: Record<FixDecision, string> = {
  keep: "Keep as it is",
  delete: "Stop reading it",
  linkedin: "Use its LinkedIn page",
  replace: "Try another URL",
  accept: "Use this URL anyway",
  undo: "Undo",
};
