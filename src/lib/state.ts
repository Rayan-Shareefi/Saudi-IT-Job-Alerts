import type { ExperienceResult } from "./experience";
import type { PlausibilityResult } from "./plausible";
import type { ScopeArea, ScopeResult } from "./scope";
import type { HiddenReason, ReviewState } from "./types";
import type { Vote } from "./judge/types";

/**
 * The arbiter: one pure function that turns everything known about a posting
 * into where it belongs. Plain code on purpose - the user asked for something
 * that checks the models rather than another model to trust.
 *
 *   show          proven: a real Riyadh posting, cyber/cloud, fresh, < 5 years
 *   unclassified  a full posting waiting for the AI jury's first reading
 *   needs_review  the user's call: co-op and internships outside cyber/cloud
 *   hidden        with a reason; every one reversible - including the
 *                 "5+ years" and "Saudi Arabia" (city not stated) tabs
 *
 * Nothing is ever deleted. Since 2026-10-21 the user's policy is "not sure,
 * not shown": the models decide when they agree, disagreement is rejected
 * unless the senior reviewer settles it, and a posting that cannot be
 * confirmed is hidden rather than left waiting (arbitrateScope).
 *
 * Every branch has a case in scripts/test-judge.ts.
 */

export interface StateInput {
  title: string;
  city: string;
  postedAt: string | null;
  firstSeenAt: string;
  lastRefreshedAt: string | null;
  closesAt: string | null;
  textQuality: string;
  plausibility: PlausibilityResult;
  /** A deterministic hint that this is not a vacancy (no role word, empty text). */
  weakNotJob: boolean;
  scope: ScopeResult;
  experience: ExperienceResult;
  votes: Vote[];
  humanOverride: "show" | "hide" | null;
  now?: Date;
}

export interface StateDecision {
  state: ReviewState;
  hiddenReason: HiddenReason | null;
  decidedBy: "human" | "rules" | "jury" | "senior";
  note: string;
  scope: ScopeArea | null;
  focus: string[];
  scopeEvidence: string[];
  /** Years found by a model (verified) when the rules found none. */
  juryYears: { min: number; evidence: string } | null;
  /** Riyadh confirmed by a model's verified quote when the location field was empty. */
  juryLocation: string | null;
}

const DAY = 86_400_000;
export const MAX_AGE_DAYS = 30;

/** The date a posting was last (re)published, as far as we can tell. */
export function refreshedAt(i: Pick<StateInput, "postedAt" | "firstSeenAt" | "lastRefreshedAt">, now: Date): { at: Date; exact: boolean } {
  const candidates: Array<{ at: Date; exact: boolean }> = [];
  if (i.postedAt) {
    const t = new Date(i.postedAt);
    // A future date cannot be a posting date (types.ts effectivePostedAt).
    if (Number.isFinite(t.getTime()) && t.getTime() <= now.getTime() + 3_600_000) candidates.push({ at: t, exact: true });
  }
  if (i.lastRefreshedAt) {
    const t = new Date(i.lastRefreshedAt);
    if (Number.isFinite(t.getTime())) candidates.push({ at: t, exact: true });
  }
  if (candidates.length === 0) return { at: new Date(i.firstSeenAt), exact: false };
  return candidates.reduce((a, b) => (b.at > a.at ? b : a));
}

const FOCUS_NAMES: Array<[RegExp, string]> = [
  [/^soc|security operations|monitoring/i, "SOC"],
  [/dfir|forensic|incident/i, "DFIR"],
  [/threat/i, "Threat Intel"],
  [/grc|governance|risk|compliance/i, "GRC"],
  [/iam|identity|access management|pam/i, "IAM"],
  [/appsec|application security|devsecops|secure code/i, "AppSec"],
  [/pentest|penetration|red team|offensive/i, "Pentest"],
  [/\bot\b|ics|scada|operational technology/i, "OT Security"],
  [/network security|firewall/i, "Network Security"],
  [/cloud security/i, "Cloud Security"],
  [/^cloud|aws|azure|gcp/i, "Cloud"],
];

/** A model's free-form focus label, mapped onto the board's fixed badges. */
export function canonicalFocus(label: string): string | null {
  for (const [re, name] of FOCUS_NAMES) if (re.test(label.trim())) return name;
  return null;
}

/*
 * The co-op and internships the user judges are technology ones. "Any co-op
 * or intern" (2026-10-21) brought Sales Intern, Tamheer Legal GRC and Board
 * Affairs, Trade Compliance and Real Estate internships with it on the first
 * dry run - not what a cybersecurity student is asking for.
 */
const NOT_TECH_FAMILY = /^(physical security|commercial role|a profession outside IT|construction|marketing|business risk|facilities)/;
const TECH_TITLE_WORD = /\b(it|ict|information technology|information systems|computer\w*|software|cyber\w*|security|cloud|data|network\w*|devops|digital|tech\w*|programming|ai)\b|تقني|حاسب|سيبران|بيانات|شبكات|برمج/i;
const NON_TECH_TITLE = /\b(sales|marketing|legal|finance|financial|accounting|hr|human resources|real estate|procurement|supply chain|trade|commercial|business development|retail|hospitality|customer service|logistics|admin\w*)\b|مبيعات|تسويق|قانون|محاسب|موارد بشرية|مشتريات/i;

/** A co-op or internship in technology - the kind the user wants to judge. Exported for tests. */
export function techProgramme(title: string, scopeReason: string): boolean {
  if (/^physical security/.test(scopeReason)) return false;
  if (TECH_TITLE_WORD.test(title)) return true;
  if (NOT_TECH_FAMILY.test(scopeReason)) return false;
  return !NON_TECH_TITLE.test(title);
}

function count(votes: Vote[], pred: (v: Vote) => boolean): number {
  return votes.filter(pred).length;
}

/* -------------------------------------------------------------------------- */
/* scope arbitration                                                           */
/* -------------------------------------------------------------------------- */

type ScopeCall =
  | { kind: "in"; by: "rules" | "jury" | "senior"; area: ScopeArea | null; why: string }
  | { kind: "out"; by: "rules" | "jury" | "senior"; why: string }
  | { kind: "unclear"; why: string }
  | { kind: "review"; why: string };

/**
 * In or out of scope - cybersecurity or cloud work?
 *
 * The user's policy (2026-10-21), replacing "two signals before hiding":
 *
 *   - The models decide when they agree. Their answers carry quotes our code
 *     checked, and the rules were written without much time to think them
 *     through ("rules lean in, models say out" was physical security every
 *     time). Rules that are *decisive* yield only to two models.
 *   - Models that disagree are settled by the senior reviewer, or the
 *     posting is rejected.
 *   - Not sure is not shown: a posting that cannot be confirmed is hidden
 *     (restorable from Hidden), not left in Unclassified. Only a full posting
 *     still waiting for its first reading waits; a snippet cannot be read
 *     further, so a vague one is hidden at once - unless its own title says
 *     security or cloud work, which keeps it.
 *
 * `kind: "review"` means a dispute no senior has settled yet: judge/run.ts
 * calls the senior reviewer on it, and decideState rejects it if none does.
 */
export function arbitrateScope(rules: ScopeResult, votes: Vote[], readable = true): ScopeCall {
  const jurors = votes.filter((v) => v.role === "juror");
  const senior = votes.find((v) => v.role === "senior" && v.decision !== null);
  const inV = count(jurors, (v) => v.scope === "in");
  const outV = count(jurors, (v) => v.scope === "out");
  const seniorIn = senior?.decision === "add" && senior.scope === "in";
  const seniorOut = senior?.decision === "dont_add" && senior.scope !== "in";
  const area = (): ScopeArea | null => rules.scope ?? jurors.find((v) => v.area)?.area ?? senior?.area ?? null;
  const decisiveIn = rules.verdict === "in" && rules.confidence === "decisive";
  const decisiveOut = rules.verdict === "out" && rules.confidence === "decisive";

  // The owner's own exclusions (physical security, DevOps) are final.
  if (rules.absolute) return { kind: "out", by: "rules", why: rules.reason };

  // The senior reviewer settles what it was asked to settle.
  if (seniorIn) return { kind: "in", by: "senior", area: area(), why: "the senior reviewer: add, with quoted duties" };
  if (seniorOut) return { kind: "out", by: "senior", why: "the senior reviewer: out of scope" };

  // The models agree.
  if (inV >= 1 && outV === 0) {
    if (decisiveOut && inV < 2) return { kind: "out", by: "rules", why: `${rules.reason} (one model disagreed)` };
    return { kind: "in", by: "jury", area: area(), why: `${inV} model(s) confirm security or cloud duties, quoted` };
  }
  if (outV >= 1 && inV === 0) {
    if (decisiveIn && outV < 2) return { kind: "in", by: "rules", area: area(), why: `${rules.reason} (one model disagreed)` };
    return { kind: "out", by: "jury", why: rules.verdict === "in" ? "the models say it is not security or cloud work (the rules leaned in)" : "the models say it is not security or cloud work" };
  }
  // They disagree: the senior reviewer's call, else rejected (decideState).
  if (inV >= 1 && outV >= 1) return { kind: "review", why: "the models disagree" };

  // No usable reading.
  if (decisiveIn) return { kind: "in", by: "rules", area: area(), why: rules.reason };
  if (decisiveOut) return { kind: "out", by: "rules", why: rules.reason };
  if (jurors.length >= 2) return { kind: "out", by: "jury", why: "the models could not establish security or cloud work" };
  if (!readable) {
    // A snippet will not get clearer. Its title saying security or cloud work
    // is the evidence there is; anything vaguer is not shown.
    if (rules.verdict === "in") return { kind: "in", by: "rules", area: area(), why: `${rules.reason} - from the title; only a snippet is readable` };
    return { kind: "out", by: "rules", why: `${rules.reason} - only a snippet is readable, not enough to tell` };
  }
  return { kind: "unclear", why: `${rules.reason} - waiting for the AI jury` };
}

/* -------------------------------------------------------------------------- */
/* the decision                                                                */
/* -------------------------------------------------------------------------- */

export function decideState(i: StateInput): StateDecision {
  const now = i.now ?? new Date();
  const base = {
    scope: null as ScopeArea | null,
    focus: [] as string[],
    scopeEvidence: [] as string[],
    juryYears: null as StateDecision["juryYears"],
    juryLocation: null as string | null,
  };
  const hidden = (reason: HiddenReason, by: StateDecision["decidedBy"], note: string): StateDecision => ({
    ...base,
    state: "hidden",
    hiddenReason: reason,
    decidedBy: by,
    note,
  });
  const jurors = i.votes.filter((v) => v.role === "juror");
  const senior = i.votes.find((v) => v.role === "senior");

  // 1. The user's own decision beats everything.
  if (i.humanOverride === "hide") return hidden("human", "human", "hidden by you");

  // 2. Not a job posting.
  if (!i.plausibility.ok && i.humanOverride !== "show") {
    return hidden("not_a_job", "rules", i.plausibility.reason ?? "not a job posting");
  }
  const notJobVotes = count(i.votes, (v) => v.isJob === false);
  if (notJobVotes >= 2 && i.humanOverride !== "show") {
    if (i.weakNotJob) return hidden("not_a_job", "jury", "two models say this is not a vacancy, and it names no role / has no posting text");
  }

  // 3. Location: Riyadh only. A model may confirm a location the field omitted,
  //    but only with a quote that names it.
  let city = i.city;
  let juryLocation: string | null = null;
  if (city !== "riyadh") {
    const riyadhVote = i.votes.find((v) => v.riyadh === true);
    const elsewhere = count(i.votes, (v) => v.riyadh === false);
    if (riyadhVote && elsewhere === 0) {
      city = "riyadh";
      juryLocation = riyadhVote.locationEvidence;
    } else if (city === "unknown" && elsewhere >= 2 && i.humanOverride !== "show") {
      return hidden("not_riyadh", "jury", "two models quote a location outside Riyadh");
    }
  }
  if (city !== "riyadh" && city !== "unknown" && i.humanOverride !== "show") {
    return hidden("not_riyadh", "rules", `located in ${city}`);
  }

  // 4. Closed and old postings.
  if (i.closesAt && new Date(i.closesAt).getTime() < now.getTime() && i.humanOverride !== "show") {
    return hidden("closed", "rules", "the closing date has passed");
  }
  const fresh = refreshedAt(i, now);
  const ageDays = (now.getTime() - fresh.at.getTime()) / DAY;
  const deadlineAhead = i.closesAt ? new Date(i.closesAt).getTime() >= now.getTime() : false;
  if (ageDays > MAX_AGE_DAYS && !deadlineAhead && i.humanOverride !== "show") {
    return fresh.exact
      ? hidden("too_old", "rules", `posted ${Math.floor(ageDays)} days ago and not reposted`)
      : hidden("stale", "rules", `first seen ${Math.floor(ageDays)} days ago with no posting date or repost`);
  }

  // 5. Scope.
  const readable = i.textQuality === "full" || i.textQuality === "partial";
  const call = i.humanOverride === "show" ? ({ kind: "in", by: "rules", area: i.scope.scope, why: "kept by you" } as ScopeCall) : arbitrateScope(i.scope, i.votes, readable);
  const evidence = [...i.scope.evidence, ...jurors.flatMap((v) => v.evidence), ...(senior?.evidence ?? [])];
  // Models name the focus in their own words ("cloud", "soc analysis");
  // only the fixed vocabulary becomes a badge.
  const focus = [...new Set([...i.scope.focus, ...jurors.flatMap((v) => v.focus.map(canonicalFocus).filter((f): f is string => f !== null))])].slice(0, 4);
  base.juryLocation = juryLocation;
  const exp = i.experience;
  const programme = exp.source === "programme" || jurors.some((v) => v.programme);

  if (call.kind !== "in") {
    /*
     * Co-op and internships outside the rules are the user's call (2026-10-21:
     * "add them and I will be the judge") - except physical security, which
     * is never cybersecurity, whatever the programme.
     */
    if (programme && techProgramme(i.title, i.scope.reason)) {
      return { ...base, state: "needs_review", hiddenReason: null, decidedBy: "rules", note: `a co-op or internship outside cyber/cloud (${call.why}) - your call`, scope: i.scope.scope, focus, scopeEvidence: [...new Set(evidence)].slice(0, 3) };
    }
    if (call.kind === "out") return hidden("out_of_scope", call.by, call.why);
    // A dispute nobody settled: rejected, restorable from Hidden.
    if (call.kind === "review") return hidden("out_of_scope", "jury", `${call.why}, and no senior reviewer settled it`);
    return { ...base, state: "unclassified", hiddenReason: null, decidedBy: "rules", note: `scope: ${call.why}`, scope: i.scope.scope, focus, scopeEvidence: [...new Set(evidence)].slice(0, 3) };
  }

  const inDecision = {
    ...base,
    scope: call.area,
    focus,
    scopeEvidence: [...new Set(evidence)].slice(0, 3),
  };

  // 6. Experience: 5+ on a stated, required, quoted number - or a senior title.
  let statedMin = exp.source === "stated" && !exp.preferredOnly ? exp.minYears : null;
  let juryYears: StateDecision["juryYears"] = null;
  if (exp.source === "none") {
    // The rules found no number; a model may have found one the patterns
    // missed. The number is our parser's reading of the model's quote.
    const found = i.votes.find((v) => v.minYears !== null && v.yearsEvidence);
    if (found && found.minYears !== null && found.yearsEvidence) {
      statedMin = found.minYears;
      juryYears = { min: found.minYears, evidence: found.yearsEvidence };
    }
  }
  /*
   * A range that reaches 5 counts as 5+ (the owner, 2026-10-21): with "4-8
   * years" or "2-5 years", a candidate with five years is the one chosen.
   */
  const statedMax = exp.source === "stated" && !exp.preferredOnly ? exp.maxYears : null;
  const reaches5 = statedMin !== null && statedMin < 5 && statedMax !== null && statedMax >= 5;
  if (((statedMin !== null && statedMin >= 5) || reaches5) && i.humanOverride !== "show") {
    if (programme) {
      return { ...inDecision, juryYears, state: "needs_review", hiddenReason: null, decidedBy: "rules", note: "a co-op or internship that also states 5+ years" };
    }
    const note = reaches5 ? `asks for ${statedMin}-${statedMax} years (quoted) - the range reaches 5` : `requires ${statedMin}+ years (quoted)`;
    return { ...inDecision, juryYears, state: "hidden", hiddenReason: "experience_5plus", decidedBy: juryYears ? "jury" : "rules", note };
  }

  // A senior title with no number is 5+ (user, 2026-10-21: "if there is a
  // senior title that means it's 5+ years"). A stated number always wins.
  if (statedMin === null && !programme && exp.band !== "0" && exp.seniorityHint === "senior" && i.humanOverride !== "show") {
    return { ...inDecision, juryYears, state: "hidden", hiddenReason: "experience_5plus", decidedBy: "rules", note: "senior title, no years stated - counted as 5+" };
  }

  // 7. Saudi Arabia, city not stated: its own tab (user, 2026-10-21), not
  //    "All" (Riyadh only) and not Unclassified.
  if (city === "unknown" && i.humanOverride !== "show") {
    return { ...inDecision, juryYears, state: "hidden", hiddenReason: "ksa_no_city", decidedBy: "rules", note: "in Saudi Arabia; the city is not stated" };
  }

  return { ...inDecision, juryYears, state: "show", hiddenReason: null, decidedBy: i.humanOverride === "show" ? "human" : call.by, note: call.why };
}
