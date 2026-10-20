/**
 * Which platform a posting was found on, by the name a person knows it by.
 *
 * Shared by dedup (the "also on" list) and the board (the card's platform and
 * Duplicate badges), so both always say the same thing. A JSearch result is
 * named after the site Google found it on - LinkedIn, Indeed, Bayt,
 * Glassdoor, Naukrigulf - not "JSearch", which is only how it reached us.
 */

// JSearch names some sites in Arabic for Saudi results ("إنديد" for Indeed).
const KNOWN: Array<[RegExp, string]> = [
  [/linkedin|لينكد/i, "LinkedIn"],
  [/indeed|إنديد|انديد/i, "Indeed"],
  [/glassdoor|جلاسدور/i, "Glassdoor"],
  [/bayt|بيت\.كوم|بيت دوت كوم/i, "Bayt"],
  [/naukri|نوكري/i, "Naukrigulf"],
  [/jooble/i, "Jooble"],
  [/sabbar|صب[اّ]ر/i, "Sabbar"],
  [/workable/i, "Workable"],
  [/careerjet/i, "Careerjet"],
  [/gulftalent/i, "GulfTalent"],
  [/tanqeeb/i, "Tanqeeb"],
];

/** A publisher's name as people know it: "Bayt.com" -> "Bayt", "LinkedIn Jobs" -> "LinkedIn". */
export function platformName(raw: string): string {
  const s = raw.trim();
  for (const [re, name] of KNOWN) if (re.test(s)) return name;
  return s;
}

/** The platform one stored posting came from. */
export function platformOf(kind: string, sourceLabel: string, publisher: string | null): string {
  if (kind === "ats" || kind === "career-page") return "Company site";
  if (kind === "linkedin") return "LinkedIn";
  if (kind === "linkedin-post") return "LinkedIn post";
  if (publisher && (kind === "jsearch" || kind === "aggregator" || kind === "jooble")) return platformName(publisher);
  return platformName(sourceLabel);
}
