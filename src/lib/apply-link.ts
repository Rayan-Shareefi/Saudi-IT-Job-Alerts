import type { ApplyKind } from "./types";

/**
 * Where "Apply" actually goes, and what kind of route that is.
 *
 * The user asked for a badge on postings that apply through a form (Google
 * Forms and the like): those are usually a one-off intake - a co-op batch, a
 * bootcamp, a graduate programme - that closes without notice, so they are
 * time-sensitive in a way an ATS requisition is not.
 */

const FORM_HOST =
  /(^|\.)(docs\.google\.com\/forms|forms\.gle|forms\.office\.com|forms\.microsoft\.com|typeform\.com|jotform\.com|jotform\.me|forms\.zohopublic\.(com|sa|eu)|zfrmz\.com|tally\.so|surveymonkey\.com|airtable\.com\/(shr|app)|formstack\.com|cognitoforms\.com|survey\.alchemer\.com|form\.jotform\.com)/i;

/** Short links people paste into posts; resolved before judging (apply-link resolution). */
export const SHORTLINK_HOST = /^(bit\.ly|tinyurl\.com|t\.co|lnkd\.in|ow\.ly|rb\.gy|cutt\.ly|shorturl\.at|is\.gd|buff\.ly|rebrand\.ly)$/i;

const ATS_HOST =
  /(greenhouse\.io|lever\.co|workable\.com|myworkdayjobs\.com|myworkdaysite\.com|successfactors\.(com|eu)|sapsf\.(com|eu)|oraclecloud\.com|taleo\.net|smartrecruiters\.com|ashbyhq\.com|bamboohr\.com|recruitee\.com|icims\.com|jobvite\.com|personio\.(de|com)|teamtailor\.com|breezy\.hr|zohorecruit\.(com|sa)|jazzhr\.com)/i;

const BOARD_HOST = /(bayt\.com|gulftalent\.com|indeed\.com|naukrigulf\.com|glassdoor\.com|tanqeeb\.com|careerjet\.|jooble\.org|jobviewtrack\.com|wuzzuf\.net|akhtaboot\.com|monstergulf\.com)/i;

const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/gi;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const EMAIL_APPLY = /\b(send|email|e-mail|submit|share)\b[^.]{0,60}\b(cv|resume|résumé|application)\b|ارسال السيره الذاتيه|ارسل سيرتك/i;

export function kindOfUrl(url: string): ApplyKind {
  const u = url.trim();
  if (/^mailto:/i.test(u)) return "email";
  let host = "";
  let hostAndPath = u;
  try {
    const parsed = new URL(u);
    host = parsed.hostname.replace(/^www\./, "");
    hostAndPath = `${host}${parsed.pathname}`;
  } catch {
    return "page";
  }
  if (FORM_HOST.test(hostAndPath)) return "form";
  if (/linkedin\.com$/i.test(host)) return "linkedin";
  if (ATS_HOST.test(host)) return "ats";
  if (BOARD_HOST.test(host)) return "board";
  return "page";
}

/** The first application form linked from the posting text, if any. */
export function formLinkIn(text: string | null | undefined): string | null {
  for (const m of (text ?? "").matchAll(URL_IN_TEXT)) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (kindOfUrl(url) === "form") return url;
  }
  return null;
}

/**
 * The apply route for a posting. A form linked in the body wins over the
 * posting's own URL: "Apply through this form: forms.gle/..." is the real route.
 */
export function applyKindOf(url: string, sourceKind: string, body?: string | null): ApplyKind {
  if (formLinkIn(body)) return "form";
  const k = kindOfUrl(url);
  if (k !== "page") return k;
  if (sourceKind === "ats") return "ats";
  if (body && EMAIL_APPLY.test(body) && EMAIL_IN_TEXT.test(body)) return "email";
  return "page";
}
