/**
 * Whether a link off a careers page is a *second job board* for the employer.
 *
 * Lives here rather than in the crawl script because the apply step needs the
 * same rule, and importing it from the script ran the script's `main()` - which
 * launched a 513-page browser crawl as a side effect of applying a file.
 *
 * Two ways the original rule went wrong:
 *
 *   - SUBSTRINGS. `intern` matched inside "INTERNational", so Deloitte's
 *     international-tax page and Al Rajhi's international-transfer page were
 *     both recorded as graduate boards. 55 of 384 finds were this.
 *   - SINGLE POSTINGS. A link to one vacancy ("/job/8595/Principal-Specialist")
 *     satisfies "vacanc" but is one row, not a board; polling it as its own
 *     source would yield exactly one job forever.
 */

/**
 * Link text or URL that indicates a separate board - a graduate scheme, an
 * Arabic listing, an internships portal.
 *
 * Word-bounded so "intern" cannot match inside "international".
 */
const SECONDARY_HINT =
  /\b(graduates?|students?|interns?|internships?|co-?ops?|trainees?|traineeships?|campus|early careers?|apprentices?|apprenticeships?|vacancies|vacancy|opportunities|opportunity|careers?|jobs?|openings?|recruitment)\b|تدريب|طلاب|خريج|وظائف/i;

/**
 * Hint words that only count as a board when the link is not a single posting.
 *
 * Covers the short forms too: Workable links one vacancy as `/j/63`, which has
 * neither the word "job" nor a long id, and three of those were reported as
 * Qiddiya's "additional boards".
 */
const SINGLE_POSTING =
  /\/(job|jobs|posting|position|requisition|vacancy)\/[a-z0-9-]*\d{3,}|\/j\/[a-z0-9]{1,12}(\/|$)|\/(jobs?|positions?)\/[0-9]+(\/|$)/i;

/** Sections of a corporate site that are not hiring pages at all. */
const NOT_A_CAREERS_PAGE =
  /\/(about|about-us|services?|solutions?|investments?|investor|banking|products?|esg|governance|news|media|insights?|blog|events?|contact|privacy|terms|legal|sitemap|connectivity|research)(\/|$|\?|#)/i;

/** Substrings that used to produce false hits and never indicate a board. */
const FALSE_FRIEND = /international|internal[- ]?audit|internet/i;

/**
 * A recognised applicant-tracking host. These are boards by definition, even
 * when the URL carries no hint word at all - an Oracle Recruiting link is
 * `/hcmUI/CandidateExperience/en/sites/CX_1/`, which says nothing about jobs.
 */
const ATS_HOST =
  /greenhouse\.io|job-boards\.greenhouse|lever\.co|myworkdayjobs\.com|oraclecloud\.com|successfactors|taleo\.net|icims\.com|smartrecruiters\.com|workable\.com|ashbyhq\.com|bamboohr\.com|recruitee\.com|jobvite|breezy\.hr|teamtailor/i;

/**
 * Hiring language strong enough to override a section marker.
 *
 * Zain publishes their co-op programme at `/about/co-op-program/`. Rejecting
 * everything under `/about/` threw that away - and a co-op portal is precisely
 * what a final-year student is looking for, so the cost of that mistake is
 * higher than the cost of the odd stray page.
 */
const STRONG_HIRING =
  /\b(co-?op|cooperative|graduates?|internships?|trainees?|traineeships?|apprentices?(hips?)?|careers?|jobs?|vacanc\w*|recruit\w*|join-?us|join-[a-z]+|hiring|tamheer)\b|تدريب|وظائف/i;

export function looksLikeSecondaryBoard(url: string, text = ""): boolean {
  if (!/^https?:/i.test(url)) return false;
  // Social and third-party boards are not the employer's own second board.
  if (/linkedin|facebook|twitter|x\.com|instagram|youtube|glassdoor|indeed|bayt\.com/i.test(url)) {
    return false;
  }
  // Checked BEFORE the ATS shortcut. An applicant-tracking host is a board by
  // definition, but a link to one vacancy ON that host is not - and three
  // Workable job links (/j/63, /j/DE) were reported as Qiddiya's additional
  // boards because the shortcut fired first.
  if (SINGLE_POSTING.test(url)) return false;

  if (ATS_HOST.test(url)) return true;

  if (FALSE_FRIEND.test(url)) return false;
  // A section marker only disqualifies when nothing in the URL actually talks
  // about hiring.
  if (NOT_A_CAREERS_PAGE.test(url) && !STRONG_HIRING.test(url)) return false;

  // Strong hiring language in the URL is sufficient on its own. Zain's
  // "join-zain" page is a careers page by any reading, but matches none of the
  // narrower hint words, so requiring both tests threw it away.
  return STRONG_HIRING.test(url) || SECONDARY_HINT.test(`${text} ${url}`);
}
