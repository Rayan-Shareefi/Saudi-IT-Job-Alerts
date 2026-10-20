/**
 * Is this actually a job posting?
 *
 * The repeated-block extractor finds groups of structurally similar elements on
 * a page and reads them as vacancies. That is what makes it work on 500+ sites
 * with no per-site rules, and it is also its failure mode: a cookie-consent
 * table is a group of structurally similar elements too. Deloitte's careers
 * homepage produced three "jobs" called `affinity`, `apiDomain_XXXXXX` and
 * `TEST_AMCV_COOKIE_WRITE`, with cookie descriptions as the body text.
 *
 * This runs at the INGEST layer rather than inside one extractor, so it covers
 * every adapter - a mis-configured Workday tenant or a broken JSON-LD block can
 * produce the same rubbish, and a check that only guards the browser path would
 * miss it.
 *
 * The bias is deliberately towards keeping: a missed real job is the failure
 * that matters here, so nothing is rejected without a positive reason. Anything
 * uncertain is kept and lands under Unclassified.
 */

/* -------------------------------------------------------------------------- */
/* hard rejects                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Analytics, consent and tracking identifiers.
 *
 * These are what cookie tables are made of. Matching anywhere in the title is
 * safe: no real vacancy is called "AMCV" or "utm_campaign".
 */
const TRACKING_TOKEN =
  /\b(amcv|gigya|_ga\b|_gid\b|gtm|utm_[a-z]+|adobe\s*(experience|analytics)|doubleclick|hotjar|matomo|piwik|ppms|optanon|onetrust|cloudflare|__cf|_hj[a-z]*|fbp|fbclid|_pk_|ct_data|domaintest|localstorage|sessionstorage|xsrf|csrf|jsessionid|phpsessid|aspxauth)\b/i;

/** Cookie-table prose, matched against the description rather than the title. */
const COOKIE_PROSE =
  /\b(this cookie|these cookies|the cookie is|cookie is (set|used)|used by .{0,40}\b(to|for)\b .{0,60}\b(cookie|tracking|analytics|session)|stores? (the )?(user|visitor|session) (id|identifier|state)|expires? (in|after)\b.{0,20}\b(day|month|year|minute|hour)s?\b)/i;

/**
 * Site furniture: legal pages, navigation, language switches, CTAs.
 *
 * Anchored where it matters - "Privacy" alone is furniture, but
 * "Privacy Counsel" and "Data Privacy Engineer" are real roles, so a bare
 * match on the word would throw away legitimate GRC vacancies, which is
 * exactly the track this app exists to surface.
 */
const FURNITURE =
  /^(privacy( (policy|notice|statement|centre|center))?|cookies?( (policy|notice|settings|preferences))?|terms( (of|and) (use|service|conditions))?|legal( notice)?|disclaimer|accessibility( statement)?|site ?map|imprint|copyright|contact( us)?|about( us)?|home|search|menu|login|log in|sign ?in|sign ?up|register|apply( now)?|submit|back|next|previous|close|share|print|download|subscribe|newsletter|follow us|read more|learn more|find out more|show more|load more|(view|see|browse|explore|show)( all)?( (jobs|openings|vacancies|positions|roles|opportunities))?|all (jobs|openings|vacancies|positions)|job search|search (jobs|openings)|filter|sort|reset|clear|english|arabic|العربية|français|deutsch|español|中文|日本語)$/i;

/** A candidate-facing legal notice, which several ATS pages list like a job. */
const CANDIDATE_LEGAL =
  /(candidate|applicant|recruitment|recruiting)\s+privacy|privacy\s+(notice|policy|statement)\s*$|equal\s+opportunit|eeo\s+statement|affirmative\s+action/i;

/**
 * Marketing and editorial content that sits on careers sites alongside the
 * actual vacancies.
 *
 * Employers increasingly publish "life at the company" articles on the same
 * page as their openings, and they extract identically. These reached the
 * board as jobs: "Learn more about cybersecurity", "10 Things to Know About
 * Incident Response Careers", "From LEAP to Program Management: Shaping Cyber
 * Leaders". None of them is a role, and a CV match against one is worse than
 * useless because it looks plausible.
 */
const ARTICLE_TITLE =
  /^(learn|read|discover|explore|find out|see|watch)\s+(more|about|how|why|what|our|the|this|these|all)\b|^(introducing|announcing|celebrating|inside|meet the)\b|^\d+\s+(things|ways|tips|reasons|steps|lessons|myths|questions|skills|trends)\b|^(how|why|what|when|where|who)\s+(to|is|are|do|does|did|we|you|your|i|our|it)\b|\?\s*$|^(a day|a week|my journey|our journey|the future|the story|behind the scenes|life at|working at|why i)\b|:\s*(shaping|building|driving|empowering|unlocking|navigating|rethinking|reimagining)\b/i;

/**
 * Things a careers page lists that are not an open vacancy.
 *
 * All of these reached the board as jobs:
 *   "Join Talent Community"     - a mailing-list signup
 *   "Our community impact"      - a corporate-responsibility page
 *   "Technology Lifecycle Services" / "Equity Capital Markets" - service lines
 *   "Master of Science in Supply Chain Management" - a degree programme
 *   "أمين مكتبة Position filled" - a role that has already been filled
 *
 * A filled position is the one worth calling out: it is a real vacancy that is
 * no longer open, and showing it wastes an application.
 */
/** Decisive: the posting says outright that it is not open. */
const CLOSED_POSTING =
  /\b(position|role|vacancy)\s+(filled|closed)\b|\bno longer (available|accepting|open)\b/i;

/**
 * Signals that mean "not a vacancy" ONLY when nothing names a role.
 *
 * "Bachelor Degree Programme Coordinator" is a real job and "Talent Community
 * Manager" is a real job; "Master of Science in Supply Chain Management" and
 * "Join Talent Community" are not. The role noun is what separates them.
 */
const NOT_AN_OPENING =
  /\b(talent|candidate)\s+(community|network|pool|pipeline)\b|\bjoin (our|the) (team|talent|community|network)\b|\b(bachelor|master|masters|phd|doctorate|diploma)\s+(of|in|degree|programme|program)\b|\b(msc|bsc|mba|beng|meng)\s+in\b|\bour\s+(community|people|culture|values|impact|story|purpose|commitment)\b|\b(scholarship|fellowship)\s+(program|programme|opportunit\w*)\b/i;

/** A role word anywhere in the title, not just as the whole of it. */
const CONTAINS_ROLE_WORD =
  /\b(engineer|developer|analyst|manager|specialist|consultant|architect|administrator|technician|officer|director|lead|supervisor|coordinator|designer|scientist|researcher|accountant|auditor|advisor|adviser|associate|assistant|executive|intern|trainee|apprentice|programmer|tester|nurse|physician|pharmacist|teacher|instructor|translator|editor|writer|recruiter|controller|planner|buyer|estimator|surveyor|inspector|operator|driver|electrician|mechanic|welder|receptionist|secretary|cashier|representative|agent|partner|principal|fellow|professor|lecturer|head|chief|president|vp|officer)\b/i;

/**
 * Field names published as headings, which look like very short job titles.
 *
 * "IT & Cybersecurity" is a department heading on a careers page; "IT &
 * Cybersecurity Manager" is a vacancy. The difference is a role word, so that
 * is exactly what this tests for - a title made only of domain nouns, with
 * nothing saying what the person would *be*.
 */
const DOMAIN_WORD =
  /^(it|ict|is|ai|ml|hr|qa|r&d|tech|technology|technologies|cyber|cybersecurity|security|information|infosec|cloud|data|analytics|digital|software|hardware|network|networking|infrastructure|operations|ops|devops|engineering|development|design|finance|accounting|legal|marketing|sales|procurement|logistics|hse|safety|quality|research|innovation|corporate|business|support|services|solutions|systems|and|&|\/|-|,)$/i;

function looksLikeCategoryHeading(t: string): boolean {
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => DOMAIN_WORD.test(w.replace(/[^\w&/-]/g, "")));
}

/**
 * Arabic role nouns.
 *
 * An Arabic job title is a noun phrase that begins with what the person would
 * BE: "أخصائي دعم تقنية المعلومات" (IT support specialist), "مهندس أمن سيبراني"
 * (cybersecurity engineer). Government careers pages publish a great deal
 * alongside their vacancies that shares none of that shape - frameworks,
 * strategies, newsletters, campaign names and press releases - and all of it
 * extracted as jobs.
 *
 * Of 86 Arabic titles on the board, exactly one was a vacancy. The rest were
 * "عام الذكاء الاصطناعي" (Year of AI), "الإطار الوطني للمعايير المهنية"
 * (National Framework for Professional Standards), "نشرة الذكاء الاصطناعي"
 * (AI Newsletter) and "الهيئة تستطلع آراء العموم" (the Authority surveys
 * public opinion).
 */
const ARABIC_ROLE_NOUN =
  /(?<!ال)(مهندس|مهندسة|أخصائي|اخصائي|أخصائية|اختصاصي|محلل|محللة|مدير|مديرة|فني|فنية|مطور|مطورة|مبرمج|مصمم|مستشار|مستشارة|منسق|منسقة|رئيس|رئيسة|مشرف|مشرفة|باحث|باحثة|محاسب|محاسبة|مراجع|مدقق|أمين|سكرتير|ممرض|ممرضة|طبيب|طبيبة|صيدلي|معلم|معلمة|مدرب|مدربة|سائق|حارس|كاتب|مساعد|مساعدة|موظف|موظفة|متدرب|متدربة|خبير|خبيرة|قائد|ضابط|وكيل|ممثل|عامل|مندوب|مسؤول|مسئول|منفذ|مشغل|مراقب|مفتش|استشاري|طالب)/;

/** Announcement verbs and document words - the shape of a news headline. */
const ARABIC_NOT_A_ROLE =
  /(تعلن|تطلق|توقع|تُوقِّع|تستطلع|تنظم|تشارك|تحتفل|تصدر|تدشن|تختتم|تكرم|تستضيف|تعقد|تبحث|تناقش|توقّع|يعلن|يطلق)|^(ال)?(إطار|اطار|استراتيجية|الاستراتيجية|دليل|الدليل|نشرة|النشرة|سياسة|السياسة|لائحة|اللائحة|ضوابط|الضوابط|وثيقة|الوثيقة|معايير|المعايير|برنامج|البرنامج|مركز|المركز|هيئة|الهيئة|عام|منصة|المنصة|بوابة|البوابة)\b|رأيكم يهمنا|حق الوصول|حرية المعلومات/;

/**
 * True when a predominantly-Arabic title names no role at all.
 *
 * Mirrors the single-word English rule: something is a vacancy when it says
 * what the person would be. A Latin role word in the same string (mixed-script
 * titles are common) is accepted as evidence too, so "COOP Training" is not
 * rejected for the Arabic beside it.
 */
function arabicWithNoRole(t: string): boolean {
  const arabicChars = (t.match(/[\u0600-\u06FF]/g) ?? []).length;
  if (arabicChars < 4) return false;
  // Mostly Arabic? Latin words alongside are usually the same phrase repeated.
  const latinWords = t.match(/[A-Za-z]{3,}/g) ?? [];
  if (ARABIC_ROLE_NOUN.test(t)) return false;
  if (latinWords.some((w) => ROLE_NOUN.test(w))) return false;
  // Programme words carry the same weight here: a co-op or internship listing
  // names the programme rather than a role, and is still a real opening.
  if (/\b(co-?op|coop|training|internship|intern|trainee|graduate|apprentice|tamheer)\b/i.test(t)) {
    return false;
  }
  if (PROGRAMME.test(t) || ARABIC_VACANCY_ANNOUNCEMENT.test(t)) return false;
  if (ARABIC_NOT_A_ROLE.test(t)) return true;
  // No role noun in either script and no other evidence: a heading or a notice.
  return true;
}

/**
 * Names of institutions, listed where vacancies should be.
 *
 * Almarai's board carries a "University / College" dropdown, and every option
 * in it - Al Yamamah University, Alfaisal University, Bisha University, Dar Al
 * Uloom University - extracted as a job at Almarai. Princess Nourah's site
 * lists its own departments the same way: "Research Ethics Unit", "Humanities
 * Colleges", "Institutional Funding".
 *
 * An organisation is not a vacancy. A vacancy AT one says what the person would
 * do, so a title that is only an institution's name is rejected while
 * "Lecturer, Alfaisal University" is not.
 */
const INSTITUTION_NAME =
  /^(the\s+)?[\w'&.,\/\- ]{0,48}\b(universit(y|ies)|colleges?|institutes?|academ(y|ies)|schools?|facult(y|ies)|hospitals?|centres?|centers?|authorit(y|ies)|ministr(y|ies)|commissions?|foundations?|departments?|units?|divisions?|directorates?|programmes?|programs?)\b[\w'&.,\/\- ]{0,48}$/i;

/**
 * A training programme is an opening, whatever it is called. "Summer
 * Internship Program", "COOP Training Program", "Cooperative Training Program
 * 2026" and "Tamheer Program" were all rejected as institution names - on
 * every source - until 2026-10-21: the user's first priority, silently
 * dropped. Arabic forms included, for the same announcements on Telegram and
 * LinkedIn ("برنامج التدريب التعاوني", "تدريب منتهي بالتوظيف").
 */
const PROGRAMME =
  /\b(co-?op|coop|cooperative training|internships?|interns?|trainees?|graduates?(?!\s+(school|studies|college))|apprentice(ship)?s?|tamheer)\b|تدريب تعاوني|التدريب التعاوني|تعاوني|تمهير|حديثي التخرج|منتهي بالتوظيف|برنامج تدريب|برامج تدريب|فرصة تدريبية|فرص تدريبية|تدريب على رأس العمل/i;

/**
 * An employer announcing openings is an opening: "شركة NHC تعلن 14 وظيفة
 * شاغرة", "فتح التوظيف لدى شركة بنده", "وظائف بنك الجزيرة". The bare headings
 * a careers page carries ("وظائف شاغرة", "الوظائف المتاحة") still are not.
 */
const ARABIC_VACANCY_ANNOUNCEMENT =
  /(تعلن|يعلن|توفر|يوفر|تفتح|يفتح|فتح|تطرح|طرح)[^.]{0,80}(وظائف|وظيفة|فرص وظيفية|فرصة وظيفية|فرص عمل|فرص توظيف|توظيف مباشر|باب التوظيف|التوظيف لدى|التوظيف في)|^وظائف\s+(?:شاغرة\s+)?(?:لدى\s+|في\s+)?\S+\s+\S+|[^\s(]{2,}.{0,60}\(\s*(?:وظائف|وظيفة)[\s)]/;

/**
 * A title that announces openings without naming one role: a training
 * programme, or an employer announcing vacancies. Its text says which fields
 * it takes, so relevance.ts reads the text for those titles too.
 */
export function announcesOpenings(title: string): boolean {
  return PROGRAMME.test(title) || ARABIC_VACANCY_ANNOUNCEMENT.test(title);
}

/**
 * Site furniture that survived the earlier rules.
 *
 * "Skip to main content" is the accessibility link every page opens with, and
 * it extracted as a job at stc. "Job Opportunities" is the heading above the
 * list. "Employee Benefits" and "Tips from our Recruiters" are the marketing
 * panels beside it - all three at Saudi National Bank, which is why its card
 * claimed three roles and its page showed none worth opening.
 *
 * The second group are controls: "View Profile", "Save Job", "Explore Job
 * Opportunities". HCLTech's board yielded three of these as postings, and
 * they survived because the description scraped alongside them was the site's
 * cookie banner - enough marketing language to look like a technology role to
 * a filter that had nothing else to read.
 */
const PAGE_FURNITURE =
  /^(skip to (main )?content|skip navigation|main content|job opportunities|opportunities|vacancies|open positions|current openings|career opportunities|employee benefits|benefits|why join us|why work (here|with us)|our benefits|tips from our recruiters|recruitment process|how to apply|application process|hiring process|frequently asked questions|faqs?|help|support centre|support center|newsroom|press releases?|media centre|media center|overview|introduction|welcome|view profile|view job|view details|save job|saved jobs?|share this job|explore job opportunities|find your best path|join our talent (community|network)|create (a )?job alert|sign up for job alerts|back to search|search jobs?)$/i;

/**
 * A title written in a script that is not used in Saudi job ads.
 *
 * SABIC's board carries "Electrical Engineer (電気系エンジニア)" and Siemens
 * Energy "AI 算法专家". A Saudi company posting in Japanese or Chinese is
 * advertising in Japan or China - being a Saudi employer does not make every
 * one of its vacancies Saudi, and this is the clearest possible statement of
 * where a role actually is.
 */
const CJK_SCRIPT = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;

/**
 * Programmatic identifiers rather than prose.
 *
 *   __CT_Data          leading underscores
 *   TEST_AMCV_COOKIE   SCREAMING_SNAKE_CASE
 *   apiDomain_XXXXXX   camelCase glued to an underscore
 *   ppms_privacy_xxx   snake_case single token
 *
 * Requires no whitespace, so a genuine title containing an underscore
 * ("Engineer_Level II" on a badly configured board) still gets through.
 */
function looksLikeIdentifier(t: string): boolean {
  if (/\s/.test(t)) return false;
  if (/^__/.test(t)) return true;
  if (/^[A-Z0-9]+(_[A-Z0-9]+)+$/.test(t)) return true;
  if (/_/.test(t) && /^[A-Za-z0-9_]+$/.test(t)) return true;
  if (/^[a-z]+[A-Z][a-zA-Z]*$/.test(t) && t.length < 24) return true;
  if (/x{4,}/i.test(t)) return true;
  return false;
}

/* -------------------------------------------------------------------------- */
/* positive evidence                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Words that make something a role even on their own.
 *
 * Only consulted for SINGLE-WORD titles, to separate "Engineer" (a real, if
 * terse, vacancy) from "affinity" and "engineering" (a cookie name and a
 * department heading). Multi-word titles never need to match this - requiring a
 * known noun across the board would quietly drop Arabic titles and unusual role
 * names, which is the expensive mistake.
 */
const ROLE_NOUN =
  /^(engineer|developer|analyst|manager|specialist|consultant|architect|administrator|technician|officer|director|lead|supervisor|coordinator|designer|scientist|researcher|accountant|auditor|advisor|adviser|associate|assistant|executive|intern|trainee|apprentice|graduate|programmer|tester|nurse|physician|pharmacist|teacher|instructor|translator|editor|writer|recruiter|controller|planner|buyer|estimator|surveyor|inspector|operator|driver|electrician|mechanic|welder|receptionist|secretary|cashier|salesperson|representative|agent|partner|principal|fellow|professor|lecturer|مهندس|محلل|مدير|مطور|فني|مستشار|أخصائي|متدرب|محاسب|مشرف|منسق)$/i;

/* -------------------------------------------------------------------------- */

export interface PlausibilityResult {
  ok: boolean;
  /** Why it was rejected, for the ingest log and the audit script. */
  reason?: string;
}

/**
 * Judge a candidate posting.
 *
 * `title` carries almost all the signal; `description` is only consulted to
 * catch cookie-table prose, where the title alone can look innocuous.
 */
/**
 * Company policy, legal and candidate-information pages.
 *
 * Every employer publishes these next to their vacancies and links to them from
 * the same list, so a reader that collects links collects these too. No real
 * vacancy is called "Cookie Policy", which makes them safe to reject on the
 * title alone: Worley was showing eight postings that were all "Employee
 * privacy notice" and "Pay transparency policy statement", Alstom two of
 * "Candidate data privacy", Google Cloud Saudi two of "Google's EEO Policy".
 */
const POLICY_PAGE =
  /\b(privacy (notice|statement|policy)|data privacy|candidate (data )?privacy|cookie (policy|statement|notice)|terms (and|&) conditions|terms of (use|service)|legal notice|pay transparency|equal (employment )?opportunit|eeo (policy|statement)|accessibility statement|modern slavery|code of conduct|whistleblow|disclaimer|sitemap)\b/i;

/**
 * Navigation and "about us" labels a careers site puts beside its job list.
 *
 * These arrive as postings because they are links in the same list markup.
 * AECOM was showing "Career Paths", "Military / Veteran", "Welcoming Workplace"
 * and "Candidate FAQ"; Ejada three copies of "About Ejada"; IBM "Contact IBM";
 * and Diriyah Gate three items that say what they are in their own titles -
 * "[DGDA] Nav Menu Item Terms And Conditions [en]".
 */
const NAV_LABEL =
  /(nav menu item|^contact\b|^about\b|\babout us\b|^careers?( (areas?|paths?|hub|site|home))?$|^careers? (in|at|with|for) |\bcareer (areas?|paths?|opportunities|hub)\b|candidate faq|^faqs?$|military ?[/] ?veteran|welcoming workplace|employee network|^(jobs?|vacancies|search results?|job search|jobs? search)$|\bjobs? search$|^(next|previous|prev|back|more|load more)\b *(>>|<<|>|<)?$|^[a-z ]+ careers$)/i;

/**
 * Marketing collateral, published on the same domain and often the same nav.
 *
 * Cohesity's careers reader was returning twenty-seven of these - "GigaOm Radar
 * for Unstructured Data Management", "Your guide to selecting an AI-powered
 * data security platform", "3 must haves to effectively manage data in the
 * cloud". They are white papers and webinars, not vacancies.
 */
const MARKETING_TITLE =
  /\b(white ?paper|buyers?.? guide|field guide|your guide to|a guide for|guides? (to|for) |guide (to|for) (selecting|choosing|evaluating)|e-?book|webinar|case study|gigaom|gartner (magic quadrant|critical capabilities)|forrester wave|esg (research )?report|research report|analyst report|must[ -]haves?|infographic|datasheet|data sheet|solution brief|press release|blog post)\b/i;

/** Words that name what a person would be hired as. */
const ROLE_WORD =
  /\b(engineers?|engineering|developers?|programmers?|architects?|analysts?|scientists?|researchers?|administrators?|admins?|technicians?|specialists?|consultants?|advisors?|advisers?|experts?|officers?|managers?|directors?|leads?|leaders?|heads?|chiefs?|supervisors?|coordinators?|controllers?|associates?|assistants?|agents?|executives?|representatives?|partners?|principals?|fellows?|apprentices?|interns?|internships?|trainees?|graduates?|designers?|writers?|editors?|planners?|auditors?|accountants?|buyers?|recruiters?|instructors?|teachers?|trainers?|nurses?|pharmacists?|drivers?|operators?|technologists?|strategists?|sre|devops|qa|testers?|helpdesk|co-?op|tamheer|scrum master|product owner|team lead|tech lead|full ?stack|front ?end|back ?end|service desk)\b/i;

/** The Arabic equivalents, for boards that publish in it. */
const ROLE_WORD_AR =
  /(مهندس|مطور|محلل|فني|أخصائي|اخصائي|مدير|مشرف|منسق|متدرب|مستشار|مسؤول|رئيس|مبرمج|مصمم|خبير|كاتب|محاسب|سكرتير|موظف)/;

/** Does the title name a role at all? */
export function namesARole(title: string): boolean {
  return ROLE_WORD.test(title) || ROLE_WORD_AR.test(title);
}

/**
 * Consent banners and buttons, read as postings.
 *
 * The user found cookie buttons and links on the board as jobs. The old cookie
 * rule only read the *description*, so a row titled "Accept All Cookies" or
 * "Manage Preferences" with an empty body sailed through, and the IT-word
 * fallback in relevance.ts then admitted it from the surrounding careers page.
 * Anchored to the whole title: no vacancy is called "Apply now" or "Follow us
 * on LinkedIn", so this is safe on the title alone, like FURNITURE.
 */
const CONSENT_OR_BUTTON =
  /^(?:(?:accept|reject|allow|deny|decline|refuse)(?: all| selected| necessary)?(?: cookies?)?|(?:manage|customi[sz]e|change) (?:cookie )?(?:preferences|settings|consent|choices)|cookies? (?:settings|preferences|consent|banner)|your privacy (?:choices|settings|rights)|privacy (?:settings|preferences|choices)|do not sell(?: my)?(?: personal)?(?: information| info)?|(?:follow|connect with|find|join) us(?: on [a-z ]+)?|share (?:this )?(?:job|position|page|posting)|apply (?:now|here|online|today|for this job)|click here|learn more|read more|show more|see more|view (?:all )?(?:jobs|openings|vacancies|positions|details)|see (?:all )?(?:jobs|openings|positions)|sign (?:in|up)|log ?in|register|subscribe|back to (?:search|results|jobs)|ok|got it|close)[\s.!>»]*$/i;

/** "Apply nowApply now" - screen-reader text doubled into one string. */
function undoubled(t: string): string {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length % 2 === 0 && s.slice(0, s.length / 2) === s.slice(s.length / 2)) return s.slice(0, s.length / 2);
  const words = s.split(" ");
  if (words.length % 2 === 0) {
    const half = words.length / 2;
    if (words.slice(0, half).join(" ") === words.slice(half).join(" ")) return words.slice(0, half).join(" ");
  }
  return s;
}

/**
 * A person's name, read as a posting: half of a two-signal rule.
 *
 * Careers pages put "meet the team" and leadership profiles beside the job
 * list; the reader collected "Ahmed Al-Harbi" as a vacancy. A name-shaped
 * title alone is not enough to reject - "Karim Benzema Academy Coach" is not a
 * thing, but plenty of real titles are a few capitalised words ("Technical
 * Lead", "Delivery Excellence") - so this only fires together with a profile
 * URL or bio-style text (`judgePosting`).
 */
const NAME_PARTICLE = /^(al|el|bin|bint|ibn|abu|abdul|abd|de|van|von|da|di|le|la)$/i;
function looksLikePersonName(t: string): boolean {
  if (namesARole(t) || CONTAINS_ROLE_WORD.test(t)) return false;
  if (/\d|[,:;/()|&]/.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((w) => {
    const parts = w.split(/[-']/).filter(Boolean);
    return parts.every((p) => NAME_PARTICLE.test(p) || /^\p{Lu}[\p{Ll}]{1,15}$/u.test(p));
  });
}

/** URL segments of a page about a person. */
const PROFILE_SEGMENT =
  /^(team|our-team|the-team|meet-the-team|people|our-people|leadership|leadership-team|executive-team|board|board-of-directors|management-team|profile|profiles|author|authors|speakers|experts|staff-directory|bio|bios)$/i;

/** Text that describes a person rather than a role. */
const BIO_PROSE =
  /\b(serves as|joined (the company|us|in \d{4})|prior to joining|is the (ceo|cfo|cto|coo|ciso|chief|head|founder|managing director)|was appointed|board member|co-?founder|his (career|role|experience)|her (career|role|experience)|he (holds|has|is|was|joined|leads)|she (holds|has|is|was|joined|leads))\b/i;
const VACANCY_PROSE = /\b(requirements|qualifications|responsibilities|we are looking|apply|candidate|you will|the role)\b/i;

function isProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).pathname.split("/").filter(Boolean).some((p) => PROFILE_SEGMENT.test(decodeURIComponent(p)));
  } catch {
    return false;
  }
}

/**
 * Path segments that belong to a page about the company, not to a vacancy.
 *
 * Matched as whole segments so that a posting at /careers/it-support-engineer
 * is untouched while /products/cloud/support and /careers/candidate-faq are
 * not.
 */
const NON_JOB_SEGMENT =
  /^(contact|about|about-us|privacy|privacy-policy|privacy-notice|candidate-privacy-notice|terms|terms-and-conditions|cookie|cookies|cookie-policy|legal|eeo|faq|faqs|candidate-faq|blog|news|press|media|events|event|webinar|webinars|white-paper|whitepaper|whitepapers|buyers-guide|ebook|resources|resource|forms|form|dm|products|product|career-paths|military-path|welcoming-workplace|employee-network-groups|sitemap|help|support-centre|support-center)$/i;

/** Landing pages: the list itself, or the front door. */
const LISTING_SEGMENT =
  /^(careers?|jobs?|job-postings|search|search-results|searchjobs.*|home|index|default)$/i;

/** Files we cannot read, and which are never a vacancy in practice. */
const DOCUMENT_URL = /\.(pdf|docx?|pptx?|xlsx?|zip|rtf)(\?|#|$)/i;

/**
 * Is this URL a page about the employer rather than one vacancy?
 *
 * Used only to corroborate a title that names no role - see `judgePosting`.
 */
function looksLikeNonPosting(url: string): boolean {
  if (!url) return false;
  if (DOCUMENT_URL.test(url)) return true;

  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }

  // BCG links a category as /global/en/Data Science and Analytics - a real
  // posting URL does not carry the display name, spaces and all.
  if (/\s/.test(path)) return true;

  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return true; // the site root is not a vacancy
  if (parts.some((p) => NON_JOB_SEGMENT.test(p))) return true;
  if (LISTING_SEGMENT.test(parts[parts.length - 1])) return true;

  return false;
}

export function judgePosting(
  title: string,
  description?: string | null,
  url?: string | null,
): PlausibilityResult {
  const t = (title ?? "").replace(/\s+/g, " ").trim();

  if (t.length === 0) return { ok: false, reason: "empty title" };
  if (t.length < 3) return { ok: false, reason: "title too short" };
  if (t.length > 180) return { ok: false, reason: "title too long to be a role" };

  // No letters at all - a table artefact, a price, a date.
  if (!/[a-z؀-ۿ]/i.test(t)) return { ok: false, reason: "no letters in title" };

  if (/^https?:\/\//i.test(t)) return { ok: false, reason: "URL used as title" };
  if (CONSENT_OR_BUTTON.test(undoubled(t))) return { ok: false, reason: "a cookie banner or button, not a vacancy" };
  if (/\b(cookies?|consent)\b/i.test(t) && !namesARole(t)) {
    return { ok: false, reason: "cookie or consent text, not a vacancy" };
  }
  if (FURNITURE.test(t)) return { ok: false, reason: "site navigation or legal page" };
  if (CANDIDATE_LEGAL.test(t)) return { ok: false, reason: "candidate privacy notice" };
  if (TRACKING_TOKEN.test(t)) return { ok: false, reason: "analytics or cookie identifier" };
  if (looksLikeIdentifier(t)) return { ok: false, reason: "programmatic identifier, not prose" };
  if (ARTICLE_TITLE.test(t)) return { ok: false, reason: "article or marketing headline" };
  if (CLOSED_POSTING.test(t)) return { ok: false, reason: "position already filled or closed" };
  if (NOT_AN_OPENING.test(t) && !CONTAINS_ROLE_WORD.test(t)) {
    return { ok: false, reason: "not an open vacancy" };
  }
  if (looksLikeCategoryHeading(t)) return { ok: false, reason: "field heading, not a role" };
  if (arabicWithNoRole(t)) return { ok: false, reason: "Arabic text that names no role" };
  if (PAGE_FURNITURE.test(t)) return { ok: false, reason: "page furniture, not a vacancy" };
  if (CJK_SCRIPT.test(t)) return { ok: false, reason: "advertised in a non-Saudi market" };
  if (INSTITUTION_NAME.test(t) && !CONTAINS_ROLE_WORD.test(t) && !PROGRAMME.test(t)) {
    return { ok: false, reason: "an institution's name, not a role" };
  }

  // Cookie tables give every row a description of the same shape. Checked only
  // when the title is short, so a real posting that happens to explain its own
  // cookie policy deep in the body is not thrown away.
  if (description && t.length <= 40 && COOKIE_PROSE.test(description.slice(0, 400))) {
    return { ok: false, reason: "cookie-table description" };
  }

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    // A single word is a vacancy only when the word is itself a role. Anything
    // else at this length is a heading, a department, or a cookie name.
    const bare = words[0].replace(/[^\p{L}]/gu, "");
    if (!ROLE_NOUN.test(bare)) {
      return { ok: false, reason: `single word "${bare}" is not a role name` };
    }
  }

  /*
   * Policy, navigation and marketing pages - unless the title names a role.
   *
   * The role check is not decoration. "Data Privacy Engineer" is a real
   * vacancy and the policy pattern matches "data privacy" inside it; without
   * the guard the rule deletes the job along with the privacy notice. An
   * employer that names a role in the title is advertising, whatever else the
   * words happen to spell.
   */
  if (!namesARole(t)) {
    if (POLICY_PAGE.test(t)) return { ok: false, reason: "a policy or legal page, not a vacancy" };
    if (NAV_LABEL.test(t)) return { ok: false, reason: "a navigation label, not a vacancy" };
    if (MARKETING_TITLE.test(t)) return { ok: false, reason: "marketing collateral, not a vacancy" };
  }

  /*
   * Marketing collateral whose title happens to contain a role word.
   *
   * The role guard above exists so that "Data Privacy Engineer" survives the
   * policy rule, but it also let two Cohesity white papers through - "Modern
   * data security and management topologies: A guide for IT leaders" and "An
   * executive's guide to accelerating enterprise AI". A guide addressed to IT
   * leaders is not a vacancy for one. Where the URL agrees - both of these sit
   * under /forms/white-paper/ - the role word is not enough to save it.
   */
  if (url && MARKETING_TITLE.test(t) && looksLikeNonPosting(url)) {
    return { ok: false, reason: "marketing collateral, not a vacancy" };
  }

  /*
   * A title that names no role, on a URL that is not one vacancy.
   *
   * Neither half is safe alone. Plenty of real postings name no role in the
   * title - Accenture advertises "OT Incident Response", Airbus "Technical and
   * Logistic Support" - so rejecting on that would delete real work. And a
   * listing-page URL is normal for a board that never links postings
   * individually: Foodics puts six genuine vacancies on one Workable address.
   *
   * Together they are decisive. Almarai was showing 44 postings, every one of
   * them a Saudi town - "Al Bahah", "Al Ghat", "Al Bukayriyah" - because the
   * co-op page lists the towns it recruits for as links, and all 44 carried
   * that same page as their URL.
   */
  if (url && !namesARole(t) && looksLikeNonPosting(url)) {
    return { ok: false, reason: "names no role, and its link is not a vacancy" };
  }

  /*
   * A person's name with a profile link or a biography: two signals.
   *
   * Neither alone - a few capitalised words is also what plenty of real
   * titles look like, and a /team/ URL is where some boards keep vacancies.
   */
  if (looksLikePersonName(t)) {
    const bio = description ? BIO_PROSE.test(description.slice(0, 1500)) && !VACANCY_PROSE.test(description.slice(0, 1500)) : false;
    if (isProfileUrl(url) || bio) {
      return { ok: false, reason: "a person's profile, not a vacancy" };
    }
  }

  return { ok: true };
}

/** Convenience wrapper for call sites that only want a boolean. */
/**
 * Which of these are link labels on a shared page rather than vacancies?
 *
 * Some judgements cannot be made one posting at a time. Almarai's co-op page
 * lists the towns it recruits for, each one a link back to that same page, so
 * 44 postings arrived carrying identical URLs and titles like "Al Bahah" and
 * "Al Bukayriyah". Read alone, each is merely a title that names no role -
 * which is true of real vacancies too, so rejecting on that would be wrong.
 * Read together, 44 role-less titles at one address is a menu.
 *
 * The role test is what keeps this safe. Foodics lists six genuine vacancies
 * on a single Workable address because their board never links postings
 * individually - but every one of them says "Officer", so every one survives.
 *
 * Returns the indexes to drop.
 */
export function listingPageLabels(
  postings: ReadonlyArray<{ title: string; url?: string | null }>,
): Set<number> {
  const byUrl = new Map<string, number[]>();
  postings.forEach((p, i) => {
    const u = (p.url ?? "").trim();
    if (!u) return;
    byUrl.set(u, [...(byUrl.get(u) ?? []), i]);
  });

  const drop = new Set<number>();
  for (const idxs of byUrl.values()) {
    const titles = new Set(idxs.map((i) => postings[i].title));
    if (titles.size < 3) continue;
    for (const i of idxs) {
      if (!namesARole(postings[i].title)) drop.add(i);
    }
  }
  return drop;
}

export function isPlausiblePosting(
  title: string,
  description?: string | null,
  url?: string | null,
): boolean {
  return judgePosting(title, description, url).ok;
}
