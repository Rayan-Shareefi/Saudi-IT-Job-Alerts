import { createHash } from "node:crypto";
import { toIso } from "./http";
import { hasTerm, normalize } from "./text";
import { detectExperience } from "./experience";
import { companyKey, shortHash } from "./company-key";
import { textQualityOf } from "./scope";
import { applyKindOf, formLinkIn } from "./apply-link";

export { normalize };
import type {
  CityId,
  EnrichedJob,
  ExperienceBand,
  RawJob,
  SourceDefinition,
  TrackId,
} from "./types";

/* -------------------------------------------------------------------------- */
/* text normalisation                                                          */
/* -------------------------------------------------------------------------- */

function countTerms(haystack: string, terms: readonly string[]): number {
  let n = 0;
  for (const t of terms) if (hasTerm(haystack, t)) n++;
  return n;
}

/* -------------------------------------------------------------------------- */
/* career tracks                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Title hits weigh far more than description hits: a "Cloud Engineer" job that
 * merely mentions "firewall" in a bullet is still a cloud job.
 */
interface TrackRule {
  id: TrackId;
  title: readonly string[];
  body: readonly string[];
  /** Terms that veto the track even on a title hit. */
  veto?: readonly string[];
}

const TRACK_RULES: readonly TrackRule[] = [
  {
    id: "security",
    title: [
      "security", "cybersecurity", "cyber security", "infosec", "information security",
      "soc analyst", "soc engineer", "siem", "penetration tester", "pentester",
      "pen tester", "red team", "blue team", "purple team", "threat hunter",
      "threat intelligence", "incident response", "incident responder", "dfir",
      "forensics", "malware analyst", "vulnerability", "appsec", "application security",
      "offensive security", "ethical hacker", "vapt", "iam engineer", "pki",
      "cryptography", "zero trust", "devsecops", "product security", "cloud security",
      "network security", "ot security", "ics security", "security architect",
      "security consultant", "security engineer", "security analyst", "ciso",
      "امن سيبراني", "الامن السيبراني", "امن المعلومات", "محلل امن", "مهندس امن",
    ],
    body: [
      "siem", "splunk", "qradar", "sentinel", "crowdstrike", "edr", "xdr", "soar",
      "nessus", "tenable", "qualys", "rapid7", "metasploit", "burp suite", "owasp",
      "mitre", "firewall", "palo alto", "fortinet", "fortigate",
      "checkpoint", "check point", "ids", "ips", "waf", "dlp", "casb", "sase",
      "threat modeling", "malware", "phishing", "ransomware", "vulnerability assessment",
      "security operations", "cissp", "ceh", "oscp", "gcih", "gsec",
    ],
  },
  {
    id: "cloud",
    title: [
      "cloud", "aws", "azure", "gcp", "google cloud", "cloud engineer",
      "cloud architect", "cloud consultant", "cloud native", "solutions architect",
      "cloud administrator", "cloud operations", "finops", "openstack",
      "الحوسبه السحابيه", "مهندس سحابي",
    ],
    body: [
      "amazon web services", "microsoft azure", "google cloud platform", "ec2", "s3",
      "lambda", "eks", "aks", "gke", "cloudformation", "terraform", "pulumi",
      "azure devops", "arm templates", "bicep", "cloud migration", "landing zone",
      "well-architected", "serverless", "kubernetes", "iaas", "paas", "saas",
      "aws certified", "az-104", "az-305",
    ],
    veto: ["cloud kitchen", "cloud sales"],
  },
  {
    id: "infra",
    title: [
      "network engineer", "network administrator", "network specialist", "noc",
      "sysadmin", "system administrator", "systems administrator",
      "system engineer", "systems engineer", "infrastructure",
      "devops", "sre", "site reliability", "platform engineer", "platform engineering",
      "virtualization", "vmware", "storage engineer", "datacenter", "data center",
      "linux administrator", "windows administrator", "unix", "middleware",
      // Saudi Business Machines advertises "Linux OS Specialist" and "Servers
      // & Storage Support - Backup"; neither matched anything above.
      "linux", "operating system", "storage", "backup", "server", "servers",
      "system support", "windows os", "patch",
      "مهندس شبكات", "اداري نظام", "البنيه التحتيه",
    ],
    body: [
      "ccna", "ccnp", "ccie", "cisco", "juniper", "bgp", "ospf", "mpls", "sd-wan",
      "vlan", "load balancer", "f5", "nginx", "apache", "active directory", "ldap",
      "kubernetes", "docker", "helm", "ansible", "puppet", "chef", "jenkins",
      "gitlab ci", "prometheus", "grafana", "observability", "vsphere",
      "hyper-v", "nutanix", "san", "nas", "rhel", "red hat", "powershell", "bash",
    ],
  },
  {
    id: "grc",
    title: [
      "grc", "governance", "compliance", "risk", "audit", "auditor",
      "internal audit", "regulatory", "policy", "assurance", "controls",
      "business continuity", "bcm", "third party risk", "vendor risk",
      "privacy", "data protection officer", "operational risk",
      "الحوكمه", "الالتزام", "المخاطر", "التدقيق", "مراجع داخلي",
    ],
    body: [
      "iso 27001", "iso27001", "iso 22301", "nca ecc", "ecc-1", "nca", "sama",
      "sama csf", "pdpl", "gdpr", "pci dss", "pci-dss", "soc 2", "soc2", "nist",
      "nist csf", "cobit", "coso", "risk register", "risk assessment",
      "control testing", "cisa", "crisc", "cism", "lead auditor",
      "sox", "basel", "aml", "regulatory compliance", "internal controls",
    ],
  },
  {
    id: "data-ai",
    title: [
      "data engineer", "data scientist", "data analyst", "analytics engineer",
      "machine learning", "ml engineer", "mlops", "ai engineer", "ai",
      "artificial intelligence", "deep learning", "nlp engineer",
      "business intelligence", "bi developer", "data architect", "big data",
      "data platform", "generative ai", "llm engineer",
      "عالم بيانات", "مهندس بيانات", "محلل بيانات", "الذكاء الاصطناعي",
    ],
    body: [
      "python", "pandas", "spark", "pyspark", "hadoop", "databricks", "snowflake",
      "airflow", "dbt", "etl", "elt", "data warehouse", "data lake", "lakehouse",
      "power bi", "tableau", "looker", "qlik", "tensorflow", "pytorch",
      "scikit-learn", "sagemaker", "vertex ai", "azure ml", "feature store",
      "sql", "kafka", "redshift", "bigquery", "synapse",
    ],
  },
  {
    id: "software",
    title: [
      "software engineer", "software developer", "backend", "back-end", "frontend",
      "front-end", "full stack", "fullstack", "mobile developer", "ios developer",
      "android developer", "web developer", "programmer", "api developer",
      "solution developer", "application developer", "qa engineer",
      // Plain forms. ".NET Developer" was landing under Unclassified because
      // every entry here was a compound and none of them was just "developer".
      "developer", ".net", "dotnet", "java developer", "python developer",
      "php developer", "software engineering",
      "test engineer", "automation engineer", "sdet", "tech lead",
      "engineering manager", "salesforce developer", "sap abap", "integration developer",
      "مطور برمجيات", "مهندس برمجيات", "مبرمج",
    ],
    body: [
      "java", "javascript", "typescript", "react", "angular", "vue", "node.js",
      "nodejs", ".net", "c#", "golang", "rust", "kotlin", "swift", "flutter",
      "spring boot", "django", "laravel", "rest api", "graphql", "microservices",
      "unit testing", "selenium", "cypress", "playwright", "agile", "scrum",
    ],
  },
  {
    id: "it-support",
    title: [
      "it support", "help desk", "helpdesk", "service desk", "desktop support",
      "technical support", "it technician", "it specialist", "field engineer",
      "end user computing", "it operations", "support engineer", "it coordinator",
      "incident management", "problem management", "change and release",
      "service management", "itil",
      "الدعم الفني", "دعم تقني", "فني حاسب",
    ],
    body: [
      "ticketing", "servicenow", "itil", "sla", "troubleshooting",
      "windows 10", "windows 11", "office 365", "microsoft 365", "printer",
      "remote desktop", "asset management", "l1 support",
    ],
  },
];

/** Titles that are clearly not in scope at all, whatever the keywords say. */
const OUT_OF_SCOPE = [
  "nurse", "physician", "dentist", "pharmacist", "teacher", "chef", "driver",
  "waiter", "barista", "cashier", "housekeeping", "receptionist", "salesman",
  "real estate agent", "civil engineer", "mechanical engineer", "hse officer",
  "safety officer", "welder", "quantity surveyor",
];

export function detectTracks(title: string, body: string): {
  tracks: TrackId[];
  primaryTrack: TrackId;
} {
  const t = normalize(title);
  const b = normalize(`${title} ${body}`);

  if (OUT_OF_SCOPE.some((term) => hasTerm(t, term))) {
    return { tracks: ["unknown"], primaryTrack: "unknown" };
  }

  const scored: Array<{ id: TrackId; score: number; titleHits: number }> = [];
  for (const rule of TRACK_RULES) {
    if (rule.veto?.some((v) => hasTerm(b, v))) continue;
    const titleHits = countTerms(t, rule.title);
    const bodyHits = countTerms(b, rule.body);
    // A title hit is worth ~4 body hits; body alone needs corroboration.
    const score = titleHits * 4 + Math.min(bodyHits, 6);
    if (titleHits > 0 || bodyHits >= 4) scored.push({ id: rule.id, score, titleHits });
  }

  if (scored.length === 0) return { tracks: ["unknown"], primaryTrack: "unknown" };

  scored.sort((a, b2) => b2.score - a.score);
  const top = scored[0].score;
  // Anything named in the title keeps its track, so a "Cloud Security Engineer"
  // lands under both tabs rather than only the higher-scoring one.
  const tracks = scored
    .filter((s) => s.titleHits > 0 || s.score >= Math.max(4, top * 0.5))
    .map((s) => s.id);
  return { tracks, primaryTrack: scored[0].id };
}

/* -------------------------------------------------------------------------- */
/* years of experience                                                         */
/* -------------------------------------------------------------------------- */

/*
 * Experience extraction lives in experience.ts since 2026-10-13: the regexes
 * that were here took the first number anywhere in the text, missed most
 * real phrasings, and turned "Senior" into a stated six years.
 */
export { detectExperience } from "./experience";

/* -------------------------------------------------------------------------- */
/* location                                                                    */
/* -------------------------------------------------------------------------- */

const CITY_TERMS: Array<{ id: CityId; terms: string[] }> = [
  { id: "riyadh", terms: ["riyadh", "riyad", "ar riyadh", "al riyadh", "kafd", "king abdullah financial district", "diriyah", "الرياض", "الدرعيه"] },
  { id: "jeddah", terms: ["jeddah", "jedda", "jiddah", "جده"] },
  { id: "khobar", terms: ["khobar", "al khobar", "alkhobar", "الخبر"] },
  { id: "dhahran", terms: ["dhahran", "الظهران"] },
  { id: "dammam", terms: ["dammam", "ad dammam", "eastern province", "الدمام", "المنطقه الشرقيه"] },
  { id: "jubail", terms: ["jubail", "الجبيل"] },
  { id: "yanbu", terms: ["yanbu", "ينبع"] },
  { id: "mecca", terms: ["mecca", "makkah", "مكه"] },
  { id: "medina", terms: ["medina", "madinah", "al madinah", "المدينه"] },
  { id: "tabuk", terms: ["tabuk", "تبوك"] },
  { id: "neom", terms: ["neom", "oxagon", "trojena", "نيوم"] },
  { id: "qassim", terms: ["qassim", "buraidah", "unaizah", "القصيم", "بريده"] },
  { id: "abha", terms: ["abha", "asir", "khamis mushait", "ابها", "عسير"] },
  { id: "hail", terms: ["hail", "حائل"] },
  { id: "najran", terms: ["najran", "نجران"] },
  { id: "jazan", terms: ["jazan", "jizan", "جازان"] },
  { id: "taif", terms: ["taif", "الطائف"] },
  { id: "kaec", terms: ["kaec", "king abdullah economic city", "rabigh"] },
];

const SAUDI_TERMS = [
  "saudi arabia", "saudi", "ksa", "kingdom of saudi arabia",
  "السعوديه", "المملكه العربيه السعوديه",
];

const REMOTE_TERMS = ["remote", "work from home", "wfh", "telecommute", "عن بعد"];

/** Location values that fill the field while saying nothing. */
const PLACEHOLDER_LOCATION =
  /^(n\/?a|not\s*(specified|stated|provided|disclosed|applicable)|unspecified|undisclosed|tbd|tba|various|multiple|any|-|--|\.)$/i;

/** decodeURIComponent that returns the input rather than throwing. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A location the description states outright.
 *
 * The classifier used to scan the body for a SAUDI city and, finding none,
 * record "not stated" - which is kept. So DXC's Cyber Security Intern, whose
 * description says in plain text "Work Location: Milan with smart working
 * possibility", sat on a Riyadh board as an unplaced role.
 *
 * Precision matters far more than recall here, because a false positive
 * DELETES a real Riyadh job. A first attempt matched a bare "location" and
 * "based in" anywhere in the text and pulled out "may be", "Home", "Arabic"
 * and half a sentence about cross-functional teams - flagging real Mrsool,
 * Salla and Foodics roles as foreign. So:
 *
 *   1. the keyword must be used as a LABEL, with a separator after it;
 *   2. the captured value must look like a place, not prose;
 *   3. a value that is neither recognisably Saudi nor a known foreign place is
 *      left as "not stated" rather than guessed at.
 */
const STATED_LOCATION =
  /\b(?:work location|job location|position location|office location|place of work|duty station|work site|worksite|location)\s*[:\-–—]\s*([^\n.;|]{2,44})/gi;

/** Arabic equivalents - government and university boards state it this way. */
const STATED_LOCATION_AR =
  /(?:موقع العمل|مكان العمل|مقر العمل)\s*[:\-–—]\s*([^\n.;|]{2,44})/g;

/**
 * Does this read like a place name rather than a sentence?
 *
 * Place names are short, few-worded and carry no verbs. The prose that slipped
 * through before - "may be", "a multi-vendor delivery environment and will
 * play a critical" - fails on both counts.
 */
/**
 * The place at the front of a stated location.
 *
 * Postings qualify the location in the same breath: DXC writes "Work Location:
 * Milan with smart working possibility". The place is the head of that phrase
 * and everything from the connector on is commentary, so testing the whole
 * capture threw the real answer away as prose.
 */
function placeHead(value: string): string {
  return value
    .split(/\s+(?:with|and|or|for|plus|including|option\w*|prefer\w*|possib\w*|remote|hybrid|onsite|on-site)\b/i)[0]
    .replace(/[,\-–—:;(]+\s*$/, "")
    .trim();
}

function looksLikePlace(value: string): boolean {
  const v = value.trim().replace(/\s+/g, " ");
  if (v.length < 3 || v.length > 44) return false;
  const words = v.split(" ");
  if (words.length > 6) return false;
  if (!/^[\p{L}]/u.test(v)) return false;
  // Sentence machinery: if it is present, this is prose.
  if (/\b(may|will|shall|must|should|can|and|or|with|that|which|the|a|an|is|are|be|been|to|for|of|in|on|at)\b/i.test(v) && words.length > 2) {
    return false;
  }
  if (/\b(apply|shortlist|environment|experience|team|role|position|responsib\w*)\b/i.test(v)) {
    return false;
  }
  return true;
}

/**
 * Places outside Saudi Arabia that a posting might name.
 *
 * A list rather than "anything not Saudi", because a value this test does not
 * recognise is far more likely to be prose than a foreign city - and guessing
 * wrong removes a real job.
 */
const FOREIGN_PLACE =
  /\b(egypt|cairo|alexandria|giza|uae|dubai|abu dhabi|sharjah|emirates|qatar|doha|kuwait|bahrain|manama|oman|muscat|jordan|amman|lebanon|beirut|syria|iraq|baghdad|yemen|sudan|khartoum|morocco|casablanca|tunisia|tunis|algeria|libya|turkey|istanbul|ankara|iran|tehran|pakistan|karachi|lahore|islamabad|india|bangalore|bengaluru|hyderabad|mumbai|delhi|noida|gurgaon|pune|chennai|kolkata|bangladesh|dhaka|sri lanka|colombo|nepal|philippines|manila|cebu|malaysia|kuala lumpur|singapore|indonesia|jakarta|thailand|bangkok|vietnam|hanoi|china|shanghai|beijing|shenzhen|hong kong|japan|tokyo|osaka|korea|seoul|australia|sydney|melbourne|new zealand|auckland|uk|united kingdom|london|manchester|birmingham|ireland|dublin|france|paris|lyon|germany|deutschland|berlin|munich|frankfurt|hamburg|spain|madrid|barcelona|portugal|lisbon|italy|italia|milan|milano|rome|roma|turin|netherlands|amsterdam|rotterdam|belgium|brussels|switzerland|zurich|geneva|austria|vienna|poland|warsaw|krakow|czech|prague|hungary|budapest|romania|bucharest|bulgaria|sofia|greece|athens|sweden|stockholm|norway|oslo|denmark|copenhagen|finland|helsinki|russia|moscow|ukraine|kyiv|usa|united states|new york|california|texas|florida|chicago|boston|seattle|austin|atlanta|miami|denver|dallas|houston|phoenix|alpharetta|canada|toronto|vancouver|montreal|mexico|brazil|sao paulo|argentina|chile|colombia|south africa|johannesburg|cape town|nigeria|lagos|kenya|nairobi|ghana|ethiopia|addis)\b/i;

/** The same list in Arabic, for boards that publish in it. */
const FOREIGN_PLACE_AR =
  /(مصر|القاهرة|الإسكندرية|الاسكندرية|الإمارات|الامارات|دبي|أبوظبي|ابوظبي|الشارقة|قطر|الدوحة|الكويت|البحرين|المنامة|عمان|مسقط|الأردن|الاردن|عمّان|لبنان|بيروت|سوريا|العراق|بغداد|اليمن|السودان|الخرطوم|المغرب|تونس|الجزائر|ليبيا|تركيا|إسطنبول|اسطنبول|إيران|طهران|باكستان|الهند|بنغالور|مومباي|دلهي|بنغلاديش|الفلبين|ماليزيا|سنغافورة|إندونيسيا|تايلاند|فيتنام|الصين|شنغهاي|بكين|اليابان|طوكيو|كوريا|سيول|أستراليا|استراليا|بريطانيا|لندن|فرنسا|باريس|ألمانيا|المانيا|برلين|إسبانيا|اسبانيا|مدريد|إيطاليا|ايطاليا|ميلانو|روما|هولندا|أمستردام|بلجيكا|سويسرا|النمسا|بولندا|اليونان|السويد|النرويج|الدنمارك|فنلندا|روسيا|موسكو|أوكرانيا|أمريكا|امريكا|الولايات المتحدة|نيويورك|كندا|تورونتو|المكسيك|البرازيل|جنوب أفريقيا|نيجيريا|كينيا|إثيوبيا)/;

/**
 * Foreign place names that are also ordinary words, so they cannot be trusted
 * in free-flowing prose.
 *
 * Salla is a Saudi company, and its "Senior SRE Engineer (MLOps)" description
 * mentions Apache **Phoenix**. On a raw body scan that read as Phoenix,
 * Arizona and the role would have been deleted off a Riyadh board. These stay
 * trusted where a posting STATES them as its location - a stated "Milan" is a
 * place, whatever the word can also mean.
 */
const AMBIGUOUS_IN_PROSE = new Set([
  "phoenix", "jordan", "austin", "denver", "milan", "rome", "chile",
]);

/** The same list, able to report every match rather than just the first. */
const FOREIGN_PLACE_ALL = new RegExp(FOREIGN_PLACE.source, "gi");

/**
 * The distinct foreign places a description names, ignoring the ones that are
 * ordinary words.
 */
function foreignPlacesInBody(body: string): string[] {
  const hits = new Set<string>();
  for (const m of body.matchAll(FOREIGN_PLACE_ALL)) {
    const term = m[0].toLowerCase();
    if (!AMBIGUOUS_IN_PROSE.has(term)) hits.add(term);
  }
  return [...hits];
}
/**
 * Every location the body claims for itself.
 *
 * Only values that read like a place are returned; prose is discarded.
 */
export function statedLocations(body: string): string[] {
  const out: string[] = [];
  for (const re of [STATED_LOCATION, STATED_LOCATION_AR]) {
    re.lastIndex = 0;
    for (const m of (body ?? "").matchAll(re)) {
      const v = (m[1] ?? "").trim();
      if (!v) continue;
      if (/^(tbd|to be (confirmed|determined)|n\/a|various|multiple|remote|flexible|hybrid)$/i.test(v)) {
        continue;
      }
      const trimmed = placeHead(v);
      if (trimmed && looksLikePlace(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

/**
 * A country the job URL names.
 *
 * Boards put the location straight into the slug, and it is the cheapest
 * reliable signal there is. DXC's global board yields:
 *
 *   /job/23802738/servicenow-solutions-architect-singapore-sg/
 *   /job/23802498/associate-manager-infrastructure-services-taguig-city-ph/
 *   /job/23805979/mainframe-network-lead-las-rozas-es/
 *
 * Nothing in the title or the card text says Singapore, Manila or Madrid, so
 * every one of those arrived as "location not stated" and was kept on a Riyadh
 * board. The URL said so all along.
 *
 * Only an explicit two-letter country code at the very end of the slug counts:
 * anything looser matches ordinary words. "sa" is Saudi Arabia and is the one
 * that means keep.
 */
const URL_COUNTRY_SUFFIX =
  /-([a-z]{2})\/?$|-([a-z]{2})[-_]\d+\/?$/i;

/** Two-letter codes that are not Saudi Arabia. */
const FOREIGN_COUNTRY_CODE = new Set([
  "ae", "qa", "kw", "bh", "om", "jo", "lb", "sy", "iq", "ye", "eg", "sd",
  "ma", "tn", "dz", "ly", "tr", "ir", "pk", "in", "bd", "lk", "np", "ph",
  "my", "sg", "id", "th", "vn", "cn", "hk", "tw", "jp", "kr", "au", "nz",
  "gb", "uk", "ie", "fr", "de", "es", "pt", "it", "nl", "be", "ch", "at",
  "pl", "cz", "hu", "ro", "bg", "gr", "se", "no", "dk", "fi", "ru", "ua",
  "us", "ca", "mx", "br", "ar", "cl", "co", "za", "ng", "ke", "et", "gh",
]);

/**
 * The country a URL states, or null when it states none.
 *
 * Returns "sa" for Saudi Arabia so callers can tell "says Saudi" apart from
 * "says nothing", which are very different answers.
 */
export function countryFromUrl(url: string): string | null {
  if (!url) return null;
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return null;
  }
  const m = path.match(URL_COUNTRY_SUFFIX);
  const code = (m?.[1] ?? m?.[2] ?? "").toLowerCase();
  if (!code) return null;
  if (code === "sa") return "sa";
  return FOREIGN_COUNTRY_CODE.has(code) ? code : null;
}

export function detectCity(locationText: string, body: string, url = ""): CityId {
  const raw = (locationText ?? "").trim();
  const stated = raw.length > 0 && !PLACEHOLDER_LOCATION.test(raw);
  const loc = normalize(raw);

  if (stated) {
    /*
     * When the posting states a location, that is the answer - the description
     * is not consulted at all.
     *
     * Reading the body as a fallback here was an outright bug: Tamara's job
     * descriptions open with "Tamara is headquartered in Riyadh", so every one
     * of their Cairo, Dubai and India postings classified as Riyadh and sat in
     * a Riyadh-only app. Company boilerplate describes the company, not the
     * vacancy.
     */
    for (const c of CITY_TERMS) {
      if (c.terms.some((t) => hasTerm(loc, t))) return c.id;
    }
    const locIsSaudi = SAUDI_TERMS.some((t) => hasTerm(loc, t));
    if (REMOTE_TERMS.some((t) => hasTerm(loc, t)) && locIsSaudi) return "remote-ksa";
    if (locIsSaudi) return "ksa-other";
    // Names a place, and that place is not in Saudi Arabia.
    return "unknown";
  }

  /*
   * Nothing stated. Try the URL before the description.
   *
   * Boards routinely put the city in the path or the slug -
   * ".../job/riyadh/security-analyst", "...?location=Riyadh" - and that is a
   * far better signal than the description, which is company boilerplate. It
   * recovers a real city for postings that would otherwise sit in "Not stated"
   * forever.
   *
   * Separators are normalised to spaces first so a slug like
   * "senior-analyst-riyadh-2026" yields "riyadh" as its own word rather than
   * hiding inside a hyphenated run.
   */
  /*
   * Decoded defensively: decodeURIComponent throws URIError on a stray "%"
   * that is not valid percent-encoding, and job URLs contain those regularly
   * (a literal percent in a title, a half-encoded query string). One such URL
   * on HCLTech's board threw out of enrich, past the per-source guard, and
   * aborted a 390-source run at 241.
   */
  /*
   * A country code in the URL settles it outright.
   *
   * Checked before the city scan because it is both cheaper and stronger: the
   * slug is written by the board itself, whereas a city name in free text may
   * be the company's headquarters rather than the job's location.
   */
  const urlCountry = countryFromUrl(url);
  if (urlCountry && urlCountry !== "sa") return "foreign";

  const fromUrl = normalize(safeDecode(url || "").replace(/[/_\-+.?=&]+/g, " "));
  if (fromUrl) {
    for (const c of CITY_TERMS) {
      if (c.terms.some((t) => hasTerm(fromUrl, t))) return c.id;
    }
    /*
     * A foreign city in the slug, which is just as clear a statement.
     *
     * Only Saudi cities were looked for, so Bain's
     * ".../AI-Engineering-Intern-Berlin-Munich-main-folder" matched nothing and
     * arrived as "location not stated" - a Berlin internship on a Riyadh board,
     * with the city written in its own URL.
     */
    if (FOREIGN_PLACE.test(fromUrl)) return "foreign";
  }

  /*
   * A location the description states outright beats scanning the whole body.
   *
   * Scanning for any Saudi city meant a posting that says "Work Location:
   * Milan" matched nothing and was filed as "not stated" - and "not stated" is
   * kept, so it stayed on a Riyadh board. Reading the statement lets the
   * posting be judged on what it actually says.
   */
  for (const stated of statedLocations(body)) {
    const norm = normalize(stated);
    for (const c of CITY_TERMS) {
      if (c.terms.some((t) => hasTerm(norm, t))) return c.id;
    }
    if (SAUDI_TERMS.some((t) => hasTerm(norm, t))) {
      return REMOTE_TERMS.some((t) => hasTerm(norm, t)) ? "remote-ksa" : "ksa-other";
    }
    /*
     * A place we recognise as being outside Saudi Arabia.
     *
     * Only a RECOGNISED foreign place counts. Treating every unrecognised
     * value as foreign is what flagged Mrsool and Salla roles on the strength
     * of "may be" and "Arabic" - and being wrong here deletes a real job.
     */
    if (FOREIGN_PLACE.test(stated) || FOREIGN_PLACE_AR.test(stated)) return "foreign";
  }


  // Then the description, which is the only signal left.
  const all = normalize(body);
  for (const c of CITY_TERMS) {
    if (c.terms.some((t) => hasTerm(all, t))) return c.id;
  }
  if (SAUDI_TERMS.some((t) => hasTerm(all, t))) return "ksa-other";
  if (fromUrl && SAUDI_TERMS.some((t) => hasTerm(fromUrl, t))) return "ksa-other";

  /*
   * A foreign place named in the description, with nothing Saudi anywhere.
   *
   * The body scan only ever looked for Saudi places, so a description that
   * said where the job WAS - just not here - matched nothing and came back
   * "not stated". Lenovo's listing reads "Software Engineering Romania,
   * Bucharest"; Jacobs' reads "Conshohocken, Pennsylvania, United States".
   * Both sat on a Riyadh board as unplaced roles with their real location
   * written in plain text.
   *
   * This is only reached once every Saudi test above has failed: no Saudi city
   * in the location or the body, no Saudi term in either, none in the URL. The
   * "company headquartered in Riyadh" trap that this function warns about
   * cannot spring here, because any such sentence would have returned Riyadh
   * several branches ago.
   */
  /*
   * One or two places named is a location. Thirty is a list.
   *
   * Corporate descriptions carry footers that name every country the employer
   * operates in - one such posting matched Argentina, Australia, Austria,
   * Belgium, Bulgaria and thirty more. Reading that as "the job is abroad"
   * would delete real roles on the strength of an office directory, so a body
   * that names a crowd of countries is treated as saying nothing at all.
   */
  const abroad = foreignPlacesInBody(all);
  if (abroad.length > 0 && abroad.length <= 4) return "foreign";
  if (FOREIGN_PLACE_AR.test(body)) return "foreign";

  return "unknown";
}

/* -------------------------------------------------------------------------- */
/* dedupe + assembly                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The same role posted on the company ATS and on Bayt should collapse to one
 * row: company + title + city, aggressively normalised.
 */
export function fingerprintOf(company: string, title: string, city: CityId): string {
  const key = [
    normalize(company),
    normalize(title).replace(/[^a-z0-9؀-ۿ ]/g, ""),
    city,
  ]
    .join("|")
    .replace(/\s+/g, " ");
  return createHash("sha1").update(key).digest("hex").slice(0, 20);
}

/**
 * A posting date we are willing to believe.
 *
 * Boards publish dates that cannot be posting dates: an event listing dated
 * weeks ahead, or a day/month swap that lands in the future. Storing one is
 * worse than storing nothing, because a future timestamp satisfies every
 * `posted_at >= cutoff` test and the row then appears in "last 12 hours"
 * forever. Null is honest - the reader falls back to when we first saw it.
 *
 * The hour of slack absorbs clock skew between the source and us. The floor
 * catches epoch-zero and similar parse failures.
 */
function believablePostedAt(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  if (t > Date.now() + 3_600_000) return null;
  if (t < Date.UTC(2000, 0, 1)) return null;
  return value;
}

/**
 * When applications close, from the phrasings postings actually use.
 *
 * A posting whose deadline has passed is worse than no posting at all: it looks
 * live, it costs the time to open it, and the application goes nowhere.
 *
 * Only accepts dates in a believable window - a "closing date" two years out is
 * a parse error, and one in the distant past is a stale page rather than a
 * deadline that just went by.
 */
const CLOSING_PHRASE =
  /(?:closing date|close[sd]? on|closes|application deadline|deadline for applications?|deadline|apply (?:by|before)|last date (?:to apply|for application)|applications? close[sd]?(?: on)?|valid (?:through|until))\s*[:\-]?\s*([^\n.;]{4,40})|(?:آخر موعد|تاريخ الإغلاق|ينتهي التقديم|آخر يوم للتقديم)\s*[:\-]?\s*([^\n.;]{4,40})/i;

export function detectClosingDate(body: string, explicit?: string | null): string | null {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);

  const m = (body ?? "").match(CLOSING_PHRASE);
  if (m) candidates.push(m[1] ?? m[2] ?? "");

  for (const c of candidates) {
    const iso = toIso(c.trim());
    if (!iso) continue;
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) continue;
    // Believable window: not more than 18 months out, not more than 6 months
    // gone. Outside that it is a parse error or a page nobody has touched.
    const now = Date.now();
    if (t > now + 550 * 86_400_000) continue;
    if (t < now - 180 * 86_400_000) continue;
    return iso;
  }
  return null;
}

export function enrich(raw: RawJob, source: SourceDefinition): EnrichedJob {
  const body = raw.descriptionText ?? "";
  const { tracks, primaryTrack } = detectTracks(raw.title, body);
  const exp = detectExperience(raw.title, body);
  const city = detectCity(raw.locationText ?? "", body, raw.url);
  const company = raw.company || source.company || source.label;

  return {
    ...raw,
    company,
    postedAt: believablePostedAt(raw.postedAt),
    closesAt: detectClosingDate(body, raw.closesAt),
    fingerprint: fingerprintOf(company, raw.title, city),
    tracks,
    primaryTrack,
    experienceBand: exp.band,
    minYears: exp.minYears,
    maxYears: exp.maxYears,
    experienceSource: exp.source,
    experienceEvidence: exp.evidence,
    city,
    isRiyadh: city === "riyadh",
    sourceKind: source.kind,
    sourceLabel: source.label,
    firstSeenAt: new Date().toISOString(),
    companyKey: companyKey(company),
    textQuality: textQualityOf(body, source.kind),
    textHash: shortHash(normalize(body)),
    applyKind: applyKindOf(raw.applyUrl ?? raw.url, source.kind, body),
    applyUrl: raw.applyUrl ?? formLinkIn(body) ?? null,
  };
}
