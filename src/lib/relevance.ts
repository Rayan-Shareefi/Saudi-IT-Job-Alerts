/**
 * Is this a technology role?
 *
 * The board previously kept anything whose title contained one of a list of
 * substrings - "engineer", "digital", "system", "analyst", "support". In Saudi
 * Arabia, where the job market is heavy with oil, construction and industrial
 * work, that let through Mechanical Engineer, Electrical Engineer, Digital
 * Marketing Manager, Maintenance Planner and Analyst - Workplace Operations.
 * Two thirds of the board was unclassified and much of it was not IT at all.
 *
 * The test here works the other way round: a role has to show a POSITIVE
 * computing signal, and a title that names a different profession is excluded
 * even when it also carries a generic word like "engineer".
 *
 * This is one person's board and they work in IT. Keeping a hospitality
 * director "just in case" is not caution, it is noise.
 */

import { namesARole } from "./plausible";

/* -------------------------------------------------------------------------- */
/* positive signals                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Words that make a role a technology role on their own.
 *
 * Deliberately specific. "Engineer" is not here, because most engineers in this
 * market are not software engineers; "software engineer" is.
 */
const IT_TERM =
  /\b(software|hardware|firmware|computer science|information technology|\bit\b|ict|cybersecurity|cyber security|infosec|information security|network security|application security|appsec|devsecops|penetration test|pentest|red team|blue team|\bsoc\b|security (analyst|engineer|specialist|architect|consultant|coordinator|manager|officer|administrator|lead|operations|awareness)|security operations|network (administrator|engineer|specialist|architect|operations)|\bnetworking\b|siem|incident response|threat (hunting|intelligence)|vulnerability (management|assessment)|malware|forensics|cryptography|encryption|pki|identity and access|iam\b|zero trust|firewall|endpoint|edr\b|xdr\b|grc\b|governance risk|iso 27001|risk and compliance|cloud|aws\b|azure|gcp\b|kubernetes|docker|container|serverless|terraform|ansible|devops|sre\b|site reliability|platform engineer|infrastructure|sysadmin|system administrator|systems administrator|server|virtualization|vmware|linux|unix|windows server|active directory|help ?desk|service desk|technical support|it support|desktop support|database|dba\b|sql|nosql|oracle db|data (engineer|scientist|analyst|architect|warehouse|lake|platform|governance|management)|big data|etl\b|analytics|business intelligence|power bi|tableau|machine learning|deep learning|artificial intelligence|\bai\b|\bml\b|\bnlp\b|llm\b|generative ai|data science|developer|programmer|full ?stack|front ?end|back ?end|web development|mobile (developer|app)|android|ios\b|api\b|microservice|integration engineer|qa engineer|quality assurance engineer|test automation|sdet\b|scrum master|product owner|technical product|solution architect|enterprise architect|technical architect|erp\b|sap\b|salesforce|servicenow|sharepoint|dynamics 365|middleware|telecom|telecommunication|5g\b|iot\b|blockchain|digital transformation|digital product|digital platform|technology (manager|lead|director|officer|consultant|specialist|analyst)|cto\b|ciso\b|cio\b)/i;

/** Arabic equivalents, for the government and university boards. */
const IT_TERM_AR =
  /(تقنية المعلومات|تقنيات المعلومات|أمن سيبراني|الأمن السيبراني|أمن المعلومات|شبكات|برمجة|مبرمج|مطور|قواعد البيانات|الحوسبة|حاسب آلي|الذكاء الاصطناعي|تحليل البيانات|علوم البيانات|الدعم الفني|نظم المعلومات|البنية التحتية|سحابية)/;

/* -------------------------------------------------------------------------- */
/* other professions                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Titles that name a different profession.
 *
 * Checked BEFORE the positive signal, because these often carry a generic
 * technical word: "Mechanical Engineer", "Electrical Maintenance Technician",
 * "Process Engineer". Every one of them appeared on the board.
 *
 * Non-IT engineering disciplines are the largest group by far, and the reason
 * a bare "engineer" can never be the signal.
 */
export const OTHER_PROFESSION =
  /\b(mechanical|electrical|civil|structural|chemical|petroleum|petrochemical|process|piping|welding|hvac|plumbing|instrumentation|metallurg\w*|geolog\w*|geophysic\w*|drilling|reservoir|subsea|marine|aeronautic\w*|aerospace|automotive|manufacturing|production|maintenance|facilities|construction|architect(ure|ural)|surveying|quantity survey\w*|hse|health and safety|occupational safety|environmental)\s+(engineer|technician|supervisor|manager|specialist|planner|inspector|designer|coordinator|lead|director|foreman|draftsman)\b|\b(nurse|nursing|physician|doctor|surgeon|pharmacist|dentist|radiolog\w*|physiotherap\w*|laborator\w* technician|midwife|paramedic)\b|\b(chef|cook|barista|waiter|waitress|housekeep\w*|concierge|bellman|butler|hospitality|food and beverage|f&b|banquet|restaurant|catering|hotel)\b|\b(cashier|salesperson|sales (associate|representative|executive|manager|director|specialist)|retail|merchandis\w*|store manager|branch manager)\b|\b(accountant|accounting|bookkeep\w*|payroll|treasury|tax|audit(or)?|actuar\w*|underwrit\w*|teller|relationship manager|wealth|investment (banking|analyst|manager)|equity (analyst|research|trader|sales)|credit analyst|portfolio manager)\b|\b(lawyer|attorney|legal counsel|paralegal|litigation)\b|\b(teacher|lecturer|professor|tutor|instructor|faculty|curriculum)\b|\b(driver|chauffeur|courier|warehouse|forklift|logistics coordinator|supply chain (officer|coordinator|specialist|manager)|procurement|purchasing|customs|shipping)\b|\b(receptionist|secretary|administrative assistant|office (boy|manager|administrator)|clerk|janitor|cleaner|security guard|guard)\b|\b(marketing|brand|public relations|\bpr\b|communications|content (writer|creator)|copywriter|social media|graphic design\w*|photographer|videographer|event)\b|\b(human resources|\bhr\b|recruit(er|ment)|talent acquisition|compensation and benefits|learning and development|training (coordinator|specialist))\b/i;

/**
 * Words that override the exclusion.
 *
 * "Electrical Engineer - SCADA and Control Systems" is an industrial-automation
 * role and genuinely computing-adjacent; "Sales Engineer - Cloud Solutions"
 * sells cloud. The override needs a real IT term, not a generic one.
 */
/**
 * Selling technology is not working in technology.
 *
 * These are the roles a technology employer advertises alongside its
 * engineering ones, and they defeat every signal the filter has: the company
 * is a technology company, the description is full of technology words, and
 * the product being sold is named in the title. "Major Account Manager" at
 * CyberArk and "Strategic Account Executive - MENA" at GitLab both read as
 * cybersecurity roles to anything counting keywords. 448 postings sat under
 * Unclassified and most of them were this.
 *
 * Deliberately checked BEFORE the IT override rather than after: the override
 * exists to rescue "Electrical Engineer - SCADA", and every one of these
 * titles would trip it too.
 */
export const COMMERCIAL_ROLE =
  /\b(account (executive|manager|director|lead)|key account|major account|named account|enterprise account|client (executive|director|partner)|business development|partner (manager|director|account)|channel (manager|director|sales|partner)|alliances?|commercial (director|manager|lead|account)|trade (director|manager)|customer success (manager|director)|revenue (manager|director)|territory manager|inside sales|field sales|sales (representative|director|specialist|manager|executive|development)|sales$)/i;

/**
 * Technical roles that sit on the commercial side of the house.
 *
 * A sales engineer builds the demo and answers the architecture questions;
 * the job needs the same knowledge as the engineering roles beside it, so it
 * stays. Commvault's "Senior Sales Engineer" and an ELV pre-sales engineer
 * working on networking and CCTV are both real technical work.
 */
export const TECHNICAL_ANYWAY = /\b(engineer|engineering|architect|technologist)\b/i;

export const STRONG_IT_OVERRIDE =
  /\b(scada|plc\b|control systems?|automation (engineer|specialist)|software|cybersecurity|cyber security|information security|network|cloud|data (engineer|scientist|analyst)|devops|sre\b|developer|programmer|\bit\b|ict|erp\b|sap\b|digital transformation)\b/i;

/* -------------------------------------------------------------------------- */

export interface RelevanceResult {
  ok: boolean;
  reason?: string;
}

/**
 * Judge whether a posting belongs on an IT board.
 *
 * `track` is the classifier's verdict. When it recognised a technology track
 * that is decisive - the classifier looked at the whole description, which is
 * more evidence than a title match. Everything else has to earn its place.
 */
export function judgeRelevance(
  title: string,
  description?: string | null,
  department?: string | null,
  track?: string,
): RelevanceResult {
  const t = (title ?? "").trim();
  if (!t) return { ok: false, reason: "no title" };

  const titleAndDept = `${t} ${department ?? ""}`;

  /*
   * The exclusions run BEFORE the track short-circuit, not after.
   *
   * Having a track used to be treated as proof on its own - "the classifier
   * put it in a technology track, that is a positive finding" - and it let
   * every profession filter be skipped. GRC is where that breaks: governance,
   * risk and compliance share their whole vocabulary with ordinary business,
   * so Qiddiya's "Senior Manager - Procurement Compliance Audit" scored as a
   * GRC role on the words compliance and audit and was then accepted without
   * anything ever asking whether procurement is IT work. Twenty-eight of its
   * postings arrived that way, alongside construction HSE and medical audit.
   *
   * A track is evidence about WHICH kind of technology work a posting is, not
   * evidence that it is technology work at all.
   */
  if (COMMERCIAL_ROLE.test(titleAndDept) && !TECHNICAL_ANYWAY.test(titleAndDept)) {
    return { ok: false, reason: "a commercial role, not a technical one" };
  }

  const overridden = STRONG_IT_OVERRIDE.test(titleAndDept);
  if (OTHER_PROFESSION.test(titleAndDept) && !overridden) {
    return { ok: false, reason: "names a profession outside IT" };
  }

  // Past the exclusions, a technology track is a positive finding over the
  // full text rather than a guess.
  if (track && track !== "unknown") return { ok: true };

  // The override list is itself made of computing terms, so a title that
  // matched it has already shown the signal.
  if (overridden) return { ok: true };
  if (IT_TERM.test(titleAndDept) || IT_TERM_AR.test(titleAndDept)) return { ok: true };

  /*
   * Nothing in the title. Fall back to the description, but demand real
   * density: a single mention of "cloud" in a paragraph about company benefits
   * is not evidence that the role is technical. Three distinct signals is.
   */
  /*
   * ...and only for a title that names a role. On a browser-scraped careers
   * page the "description" is the surrounding page, which on a technology
   * employer's site is dense with IT words - so cookie buttons, social links
   * and people's names were admitted on the strength of the page around them.
   */
  const body = (description ?? "").slice(0, 4000);
  if (body && namesARole(t)) {
    const hits = new Set<string>();
    for (const m of body.matchAll(new RegExp(IT_TERM.source, "gi"))) hits.add(m[0].toLowerCase());
    if (hits.size >= 3) return { ok: true };
  }

  return { ok: false, reason: "no technology signal in the title or description" };
}

/** Convenience wrapper for call sites that only want a boolean. */
export function isTechnologyRole(
  title: string,
  description?: string | null,
  department?: string | null,
  track?: string,
): boolean {
  return judgeRelevance(title, description, department, track).ok;
}
