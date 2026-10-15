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
 *   unclassified  not proven either way - visible in its own tab
 *   needs_review  the evidence conflicts - the Review tab, for the user
 *   hidden        with a reason; every one reversible
 *
 * Deletion is never decided on one signal (HANDOVER §6). "Hide as out of
 * scope" needs the rules AND the models; the models alone, or the rules alone
 * on anything but a decisive two-signal verdict, can only send a posting to
 * Unclassified or Review.
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
  [/devops|sre|site reliability|platform/i, "DevOps"],
  [/^cloud|aws|azure|gcp/i, "Cloud"],
];

/** A model's free-form focus label, mapped onto the board's fixed badges. */
export function canonicalFocus(label: string): string | null {
  for (const [re, name] of FOCUS_NAMES) if (re.test(label.trim())) return name;
  return null;
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

export function arbitrateScope(rules: ScopeResult, votes: Vote[]): ScopeCall {
  const jurors = votes.filter((v) => v.role === "juror");
  const senior = votes.find((v) => v.role === "senior" && v.decision !== null);
  const inV = count(jurors, (v) => v.scope === "in");
  const outV = count(jurors, (v) => v.scope === "out");
  const seniorIn = senior?.decision === "add" && senior.scope === "in";
  const seniorOut = senior?.decision === "dont_add" && senior.scope !== "in";
  const area = (): ScopeArea | null => rules.scope ?? jurors.find((v) => v.area)?.area ?? senior?.area ?? null;

  const R = `${rules.verdict}/${rules.confidence}`;

  if (R === "in/decisive") {
    if (outV >= 2 && inV === 0 && !seniorIn) return { kind: "review", why: "rules say in (title and duties), two models say out" };
    return { kind: "in", by: "rules", area: area(), why: rules.reason };
  }

  if (R === "out/decisive") {
    if (inV >= 2 || seniorIn) return { kind: "review", why: "rules say out, models say in" };
    return { kind: "out", by: "rules", why: rules.reason };
  }

  if (R === "in/leaning") {
    if (inV >= 1 && outV === 0) return { kind: "in", by: "jury", area: area(), why: `${rules.reason}; confirmed by ${inV} model(s)` };
    if (seniorIn && inV >= 0 && outV <= 1) return { kind: "in", by: "senior", area: area(), why: `${rules.reason}; senior reviewer: add` };
    if (outV >= 1 && inV >= 1) return { kind: "review", why: "models disagree" };
    if (outV >= 2 || seniorOut) return { kind: "review", why: "rules lean in, models say out" };
    return { kind: "unclear", why: `${rules.reason}; waiting for a model to confirm` };
  }

  if (R === "out/leaning") {
    if (outV >= 2 || (outV >= 1 && seniorOut)) return { kind: "out", by: "jury", why: `${rules.reason}; confirmed by the models` };
    if (inV >= 2 || seniorIn) return { kind: "review", why: "rules lean out, models say in" };
    return { kind: "unclear", why: `${rules.reason}; not confirmed yet` };
  }

  // Rules unclear: the models decide, and only when they agree.
  if (inV >= 2 && outV === 0) return { kind: "in", by: "jury", area: area(), why: "two models agree, with quoted duties" };
  if (seniorIn && inV >= 1 && outV === 0) return { kind: "in", by: "senior", area: area(), why: "senior reviewer and a model agree" };
  if (seniorOut && outV >= 2) return { kind: "out", by: "senior", why: "senior reviewer and two models agree it is out of scope" };
  if (inV >= 1 && outV >= 1) return { kind: "review", why: "models disagree" };
  return { kind: "unclear", why: rules.reason };
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
  const call = i.humanOverride === "show" ? ({ kind: "in", by: "rules", area: i.scope.scope, why: "kept by you" } as ScopeCall) : arbitrateScope(i.scope, i.votes);
  const evidence = [...i.scope.evidence, ...jurors.flatMap((v) => v.evidence), ...(senior?.evidence ?? [])];
  // Models name the focus in their own words ("cloud", "soc analysis");
  // only the fixed vocabulary becomes a badge.
  const focus = [...new Set([...i.scope.focus, ...jurors.flatMap((v) => v.focus.map(canonicalFocus).filter((f): f is string => f !== null))])].slice(0, 4);
  base.juryLocation = juryLocation;

  if (call.kind === "out") return hidden("out_of_scope", call.by, call.why);
  if (call.kind === "review") {
    return { ...base, state: "needs_review", hiddenReason: null, decidedBy: "jury", note: call.why, scope: i.scope.scope, focus, scopeEvidence: [...new Set(evidence)].slice(0, 3) };
  }
  if (call.kind === "unclear") {
    return { ...base, state: "unclassified", hiddenReason: null, decidedBy: "rules", note: `scope: ${call.why}`, scope: i.scope.scope, focus, scopeEvidence: [...new Set(evidence)].slice(0, 3) };
  }

  const inDecision = {
    ...base,
    scope: call.area,
    focus,
    scopeEvidence: [...new Set(evidence)].slice(0, 3),
  };

  // 6. Experience: hidden at 5+ only on a stated, required, quoted number.
  const exp = i.experience;
  const programme = exp.source === "programme" || jurors.some((v) => v.programme);
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
  if (statedMin !== null && statedMin >= 5 && i.humanOverride !== "show") {
    if (programme) {
      return { ...inDecision, juryYears, state: "needs_review", hiddenReason: null, decidedBy: "rules", note: "a co-op or internship that also states 5+ years" };
    }
    return { ...inDecision, juryYears, state: "hidden", hiddenReason: "experience_5plus", decidedBy: juryYears ? "jury" : "rules", note: `requires ${statedMin}+ years (quoted)` };
  }

  // 7. Not proven enough for "All".
  if (city === "unknown" && i.humanOverride !== "show") {
    return { ...inDecision, juryYears, state: "unclassified", hiddenReason: null, decidedBy: "rules", note: "location not stated in the posting" };
  }
  if (statedMin === null && !programme && exp.band !== "0" && exp.seniorityHint === "senior" && i.humanOverride !== "show") {
    return { ...inDecision, juryYears, state: "unclassified", hiddenReason: null, decidedBy: "rules", note: "senior title; years of experience not stated" };
  }

  return { ...inDecision, juryYears, state: "show", hiddenReason: null, decidedBy: i.humanOverride === "show" ? "human" : call.by, note: call.why };
}
