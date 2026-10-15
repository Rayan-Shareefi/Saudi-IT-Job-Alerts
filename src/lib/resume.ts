/**
 * Reads a CV and scores postings against it.
 *
 * Everything here is a pure function over text, deliberately: the parsing and
 * matching run **in the browser**, and the CV is never uploaded, never written
 * to the database and never sent to an API. A CV is the most personal document
 * in a job search - it carries your name, phone number, address and history -
 * and there is no reason this app needs a copy on a server to tell you which
 * postings look relevant. What gets stored is the derived profile (a list of
 * skills and a seniority band), in localStorage, on your machine.
 *
 * The matching is deliberately explainable rather than clever. Every
 * recommendation can name the skills it matched on, because "recommended"
 * with no reason is not something you can act on or disagree with.
 */
import {
  EXPERIENCE_BANDS,
  EXPERIENCE_LABELS,
  TRACKS,
  type ExperienceBand,
  type TrackId,
} from "./types";

/* -------------------------------------------------------------------------- */
/* skill vocabulary                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Skills worth matching on, grouped by the track they signal.
 *
 * Kept as an explicit list rather than "any capitalised word": a CV is full of
 * company names, universities and city names, and treating those as skills
 * produces matches that look impressive and mean nothing.
 *
 * Very short names are avoided for the same reason. "go" matched 32 postings on
 * "go through" and "go live"; "r" matches "R&D". Both languages are real, so
 * they appear as "golang" and "r programming" instead.
 */
const SKILL_VOCABULARY: Record<TrackId, string[]> = {
  security: [
    "cybersecurity", "information security", "infosec", "soc", "siem", "splunk",
    "qradar", "sentinel", "incident response", "threat hunting", "threat intelligence",
    "penetration testing", "pentest", "red team", "blue team", "purple team",
    "vulnerability assessment", "vulnerability management", "nessus", "qualys",
    "burp suite", "metasploit", "wireshark", "malware analysis", "forensics",
    "dfir", "edr", "xdr", "crowdstrike", "sentinelone", "defender", "firewall",
    "ids", "ips", "waf", "zero trust", "iam", "identity and access management",
    "pam", "privileged access", "okta", "active directory", "kerberos", "oauth",
    "saml", "encryption", "cryptography", "pki", "owasp", "appsec",
    "application security", "devsecops", "security architecture", "nist", "mitre",
    "att&ck", "cissp", "ceh", "oscp", "security+", "comptia security",
    "gcih", "gsec", "cysa", "pentest+",
  ],
  cloud: [
    "aws", "amazon web services", "azure", "gcp", "google cloud", "oci",
    "oracle cloud", "cloud architecture", "cloud migration", "ec2", "s3",
    "lambda", "cloudformation", "terraform", "pulumi", "ansible", "kubernetes",
    "k8s", "docker", "containers", "eks", "aks", "gke", "openshift", "helm",
    "serverless", "microservices", "api gateway", "cloudfront", "route 53",
    "vpc", "iaas", "paas", "saas", "cloud security", "well-architected",
    "solutions architect", "aws certified", "az-900", "az-104", "az-500",
    "cloud practitioner", "ckad", "cka",
  ],
  infra: [
    "linux", "unix", "windows server", "vmware", "vsphere", "hyper-v",
    "virtualization", "networking", "tcp/ip", "dns", "dhcp", "bgp", "ospf",
    "vlan", "sd-wan", "cisco", "ccna", "ccnp", "juniper", "fortinet", "palo alto",
    "load balancer", "f5", "nginx", "apache", "storage", "san", "nas", "backup",
    "disaster recovery", "high availability", "monitoring", "nagios", "zabbix",
    "prometheus", "grafana", "elk", "observability", "sre", "site reliability",
    "devops", "ci/cd", "jenkins", "gitlab ci", "github actions", "bash",
    "powershell", "shell scripting", "itil", "system administration",
  ],
  grc: [
    "grc", "governance", "risk management", "compliance", "audit",
    "internal audit", "iso 27001", "iso27001", "soc 2", "pci dss", "pci-dss",
    "hipaa", "gdpr", "sama", "nca", "ecc", "csc", "risk assessment",
    "business continuity", "bcp", "third party risk", "vendor risk",
    "policy", "controls", "cisa", "crisc", "cism", "cgeit", "iso 22301",
    "data privacy", "privacy", "regulatory",
  ],
  "data-ai": [
    "machine learning", "deep learning", "artificial intelligence", "ai",
    "data science", "data engineering", "data analysis", "analytics", "python",
    "r programming", "pandas", "numpy", "scikit-learn", "tensorflow", "pytorch", "keras",
    "nlp", "computer vision", "llm", "large language model", "generative ai",
    "sql", "nosql", "mongodb", "postgresql", "mysql", "oracle database",
    "snowflake", "databricks", "spark", "hadoop", "kafka", "airflow", "etl",
    "data warehouse", "data lake", "power bi", "tableau", "looker",
    "visualization", "statistics", "predictive modeling", "mlops",
  ],
  software: [
    "java", "javascript", "typescript", "c#", ".net", "c++", "golang",
    "rust", "ruby", "php", "swift", "kotlin", "scala", "react", "angular",
    "vue", "next.js", "node.js", "express", "spring", "spring boot", "django",
    "flask", "fastapi", "laravel", "rest api", "graphql", "grpc",
    "microservices", "git", "agile", "scrum", "jira", "unit testing",
    "test automation", "selenium", "cypress", "jest", "software engineering",
    "full stack", "frontend", "backend", "mobile development", "android", "ios",
    "flutter", "react native",
  ],
  "it-support": [
    "help desk", "helpdesk", "service desk", "technical support", "it support",
    "desktop support", "troubleshooting", "ticketing", "servicenow",
    "remote support", "hardware", "printer", "office 365", "microsoft 365",
    "endpoint", "asset management", "onboarding", "itil foundation",
  ],
  unknown: [],
};

/** Certifications called out separately - they are strong, checkable signals. */
const CERTIFICATIONS = [
  "cissp", "cism", "cisa", "crisc", "ceh", "oscp", "security+", "network+",
  "ccna", "ccnp", "ccie", "aws certified", "azure administrator",
  "azure solutions architect", "az-104", "az-500", "az-900", "gcp professional",
  "pmp", "itil", "cka", "ckad", "comptia", "gcih", "gsec", "cysa+", "pentest+",
  "iso 27001 lead auditor", "iso 27001 lead implementer",
];

/* -------------------------------------------------------------------------- */
/* profile                                                                     */
/* -------------------------------------------------------------------------- */

export interface ResumeProfile {
  /** Skills found in the CV, lowercased, de-duplicated. */
  skills: string[];
  /** Tracks the skills point at, strongest first. */
  tracks: TrackId[];
  /** Certifications found. */
  certifications: string[];
  /** Years of experience, where the CV states one. */
  years: number | null;
  /** Which band those years fall into. */
  band: ExperienceBand;
  /** Set when the CV reads as a student or new graduate. */
  isStudent: boolean;
  /** Source file name, so the UI can show what is loaded. */
  fileName: string;
  parsedAt: string;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ");
}

/** Whole-token match, so "r" does not match inside "architecture". */
function mentions(haystack: string, needle: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Skills legitimately contain +, # and . - the boundary has to be built from
  // what surrounds the term rather than from \b, which breaks on "c++".
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i").test(haystack);
}

/**
 * Years of experience, from the phrasings CVs actually use.
 *
 * Takes the LARGEST number found rather than the first: a CV saying "3 years at
 * X, 5 years at Y" is describing eight years of career, and the first number is
 * not the answer to "how senior is this person".
 */
function extractYears(text: string): number | null {
  const patterns = [
    /(\d{1,2})\+?\s*(?:\+|plus)?\s*years?\s+(?:of\s+)?(?:professional\s+|relevant\s+|hands-on\s+|work\s+)?experience/gi,
    /experience\s*(?:of|:)?\s*(\d{1,2})\+?\s*years?/gi,
    /over\s+(\d{1,2})\s+years?/gi,
  ];
  let best: number | null = null;
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0 && n <= 50) best = best === null ? n : Math.max(best, n);
    }
  }
  return best;
}

function bandFor(years: number | null, isStudent: boolean): ExperienceBand {
  if (isStudent) return "0";
  if (years === null) return "unknown";
  if (years <= 0) return "0";
  if (years <= 2) return "1-2";
  if (years <= 5) return "3-5";
  if (years <= 9) return "6-9";
  return "10+";
}

const STUDENT_SIGNALS =
  /\b(currently (a )?(student|studying|enrolled)|final[- ]year|senior year|expected graduation|graduating in|undergraduate|bachelor'?s? (student|candidate)|seeking (a )?(co-?op|internship|training)|co-?op (student|trainee)|fresh graduate|recent graduate|طالب|خريج جديد|تدريب تعاوني)\b/i;

/** Build a profile from raw CV text. */
export function profileFromText(text: string, fileName = "resume"): ResumeProfile {
  const t = normalise(text);

  const skills: string[] = [];
  const trackHits: Record<string, number> = {};

  for (const track of TRACKS) {
    for (const skill of SKILL_VOCABULARY[track]) {
      if (mentions(t, skill)) {
        skills.push(skill);
        trackHits[track] = (trackHits[track] ?? 0) + 1;
      }
    }
  }

  const certifications = CERTIFICATIONS.filter((c) => mentions(t, c));

  const tracks = (Object.entries(trackHits) as Array<[TrackId, number]>)
    .sort((a, b) => b[1] - a[1])
    .filter(([, n]) => n >= 2)
    .map(([track]) => track);

  const isStudent = STUDENT_SIGNALS.test(text);
  const years = extractYears(text);

  return {
    skills: [...new Set(skills)],
    tracks,
    certifications: [...new Set(certifications)],
    years,
    band: bandFor(years, isStudent),
    isStudent,
    fileName,
    parsedAt: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* matching                                                                    */
/* -------------------------------------------------------------------------- */

export interface MatchResult {
  /** 0-100, used for ordering even when the role is not recommended. */
  score: number;
  recommended: boolean;
  /** Skills the posting and the CV share - the reason, in plain terms. */
  matchedSkills: string[];
  /** Skills the posting asks for that the CV does not show. */
  missingSkills: string[];
  /** Why it scored as it did. */
  reasons: string[];
  /**
   * Why it is NOT recommended, in plain terms.
   *
   * A blocker is decisive: no amount of skill overlap outranks "this asks for
   * five years and your CV shows none". Kept as text so the UI can say what is
   * wrong instead of leaving you to guess at a number.
   */
  blockers: string[];
}

/** Bands that all mean "early career" for scoring purposes. */
const ENTRY_BANDS = new Set<ExperienceBand>(["0", "1-2"]);

/** A posting scores as recommended at or above this, and with no blockers. */
export const RECOMMEND_THRESHOLD = 45;

interface ScorableJob {
  title: string;
  descriptionText?: string;
  tracks?: TrackId[];
  primaryTrack?: TrackId;
  experienceBand?: ExperienceBand;
  minYears?: number | null;
  maxYears?: number | null;
}

/** Every vocabulary skill mentioned in a piece of text. */
export function skillsInText(text: string): string[] {
  const t = normalise(text);
  const found: string[] = [];
  for (const track of TRACKS) {
    for (const skill of SKILL_VOCABULARY[track]) {
      if (mentions(t, skill)) found.push(skill);
    }
  }
  return [...new Set(found)];
}

/**
 * Years of experience the CV represents.
 *
 * Null when there is genuinely nothing to go on - neither a stated number nor a
 * seniority band - because guessing zero would then block every mid-level role
 * for someone whose CV simply does not phrase its experience in years.
 */
function cvYears(profile: ResumeProfile): number | null {
  if (profile.years !== null) return profile.years;
  if (profile.isStudent) return 0;
  switch (profile.band) {
    case "0":
      return 0;
    case "1-2":
      return 1;
    case "3-5":
      return 4;
    case "6-9":
      return 7;
    case "10+":
      return 12;
    default:
      return null;
  }
}

/** Seniority stated in the title, independent of any years the body gives. */
const SENIOR_TITLE =
  /\b(senior|sr\.?|lead|principal|staff|head of|director|chief|vp|vice president|manager|expert|specialist iii|iii|iv)\b/i;
const JUNIOR_TITLE = /\b(junior|jr\.?|entry[- ]level|graduate|intern|trainee|associate|assistant|i|ii)\b/i;

/** Certifications a posting states as required rather than preferred. */
function requiredCertifications(body: string): string[] {
  const out: string[] = [];
  // Only sentences that demand it - "preferred" and "a plus" are not blockers.
  const demanding = body.match(/[^.]*\b(required|must have|mandatory|essential)\b[^.]*/gi) ?? [];
  const blob = normalise(demanding.join(" "));
  for (const c of CERTIFICATIONS) if (mentions(blob, c)) out.push(c);
  return [...new Set(out)];
}

/**
 * Score one posting against the profile.
 *
 * Two stages, deliberately separate. First the positive evidence - overlapping
 * skills, the field, the level - which produces a score used for ordering.
 * Then the DISQUALIFIERS, which can veto a recommendation outright.
 *
 * The veto exists because the first stage alone was actively misleading: a
 * "Senior SOC Analyst" asking for five years scored 68 against a final-year
 * student's CV, purely on shared vocabulary. The words matched; the job did
 * not. Skill overlap says a role is in your field, not that you can get it.
 */
export function scoreJob(job: ScorableJob, profile: ResumeProfile): MatchResult {
  const title = normalise(job.title ?? "");
  const body = normalise(job.descriptionText ?? "");
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (profile.skills.length === 0) {
    return { score: 0, recommended: false, matchedSkills: [], missingSkills: [], reasons: [], blockers: [] };
  }

  /* ---- positive evidence ---- */

  const matchedSkills: string[] = [];
  let skillPoints = 0;
  for (const skill of profile.skills) {
    const inTitle = mentions(title, skill);
    const inBody = mentions(body, skill);
    if (!inTitle && !inBody) continue;
    matchedSkills.push(skill);
    skillPoints += inTitle ? 2 : 1;
  }

  const asked = skillsInText(`${job.title ?? ""} ${job.descriptionText ?? ""}`);
  const have = new Set(profile.skills);
  const missingSkills = asked.filter((sk) => !have.has(sk));

  const skillScore = Math.min(1, skillPoints / 10) * 55;
  if (matchedSkills.length > 0) {
    reasons.push(
      `${matchedSkills.length} skill${matchedSkills.length === 1 ? "" : "s"} from your CV appear in this posting`,
    );
  }

  let trackScore = 0;
  const jobTracks = new Set<TrackId>([
    ...(job.tracks ?? []),
    ...(job.primaryTrack ? [job.primaryTrack] : []),
  ]);
  if (profile.tracks.some((t) => jobTracks.has(t))) {
    trackScore = profile.tracks[0] && jobTracks.has(profile.tracks[0]) ? 25 : 15;
    reasons.push("the role is in a field your CV covers");
  }

  const jobBand = job.experienceBand ?? "unknown";
  let bandScore = 0;
  if (profile.isStudent && (jobBand === "coop" || jobBand === "internship")) {
    bandScore = 20;
    reasons.push("a co-op or internship, which is what your CV is aimed at");
  } else if (jobBand === "unknown" || profile.band === "unknown") {
    bandScore = 8;
  } else if (jobBand === profile.band) {
    bandScore = 20;
    reasons.push("the experience level matches yours");
  } else if (ENTRY_BANDS.has(jobBand) && ENTRY_BANDS.has(profile.band)) {
    /*
     * Both ends of entry level count as a match.
     *
     * Splitting "0-2" into "no experience needed" and "1-2 years" made those
     * two look like different rungs, and a final-year student stopped matching
     * junior roles that ask for a year - which is exactly the job they should
     * be applying for. The distinction is worth having as a FILTER; it is not
     * a reason to score them apart.
     */
    bandScore = 18;
    reasons.push("an entry-level role, which is where your CV sits");
  } else {
    const ladder = EXPERIENCE_BANDS.filter(
      (b): b is Exclude<ExperienceBand, "coop" | "internship" | "unknown"> =>
        b !== "coop" && b !== "internship" && b !== "unknown",
    );
    const jobIdx = ladder.indexOf(jobBand as (typeof ladder)[number]);
    const meIdx = ladder.indexOf(profile.band as (typeof ladder)[number]);
    const comparable = jobIdx >= 0 && meIdx >= 0;
    bandScore = comparable && Math.abs(jobIdx - meIdx) === 1 ? 10 : 0;
  }

  const score = Math.round(Math.min(100, skillScore + trackScore + bandScore));

  /* ---- disqualifiers ---- */

  const mine = cvYears(profile);

  // 1. The posting states how many years it wants, and it is well above yours.
  //    Two years of slack: job ads routinely overstate, and a near miss is
  //    worth applying to. Three or more is a different job.
  if (job.minYears != null && mine != null && job.minYears - mine >= 3) {
    blockers.push(
      `asks for ${job.minYears}+ years; your CV shows ${mine === 0 ? "no professional experience yet" : `about ${mine}`}`,
    );
  }

  // 2. Seniority in the TITLE, which often carries the requirement even when
  //    the body states no number at all.
  if (mine != null && mine < 3 && SENIOR_TITLE.test(job.title ?? "") && !JUNIOR_TITLE.test(job.title ?? "")) {
    blockers.push("a senior-level title, and your CV is early-career");
  }

  // 3. Band far above yours, for postings that give a band but no number.
  if (
    job.minYears == null &&
    (jobBand === "6-9" || jobBand === "10+") &&
    (profile.band === "0" || profile.band === "1-2" || profile.isStudent)
  ) {
    blockers.push(`aimed at ${EXPERIENCE_LABELS[jobBand]}`);
  }

  // 4. A certification the posting states as required and the CV does not have.
  const needCerts = requiredCertifications(job.descriptionText ?? "");
  const haveCerts = new Set(profile.certifications);
  const missingCerts = needCerts.filter((c) => !haveCerts.has(c));
  if (missingCerts.length > 0) {
    blockers.push(`requires ${missingCerts.slice(0, 2).join(" and ")}, which your CV does not list`);
  }

  return {
    score,
    recommended: score >= RECOMMEND_THRESHOLD && blockers.length === 0,
    matchedSkills: matchedSkills.sort((a, b) => b.length - a.length).slice(0, 6),
    missingSkills: missingSkills.sort((a, b) => b.length - a.length).slice(0, 8),
    reasons,
    blockers,
  };
}
