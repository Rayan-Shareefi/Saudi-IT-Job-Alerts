import { hasTerm, normalize } from "./text";
import { COMMERCIAL_ROLE, OTHER_PROFESSION, STRONG_IT_OVERRIDE, TECHNICAL_ANYWAY } from "./relevance";

/**
 * Is this posting cybersecurity or cloud work?
 *
 * The board was narrowed on 2026-10-13 from "all IT in Riyadh" to security and
 * cloud. The user's rules, verbatim in spirit:
 *
 *  - judge the whole posting, not the title: SOC and GRC roles often never say
 *    "cybersecurity", and a title can name no role at all;
 *  - DevOps / SRE / Platform roles are out (the owner, 2026-10-21: cybersecurity,
 *    cloud and cloud security only); infrastructure roles count only when
 *    the duties are cloud work;
 *  - network roles count only when the duties are security work;
 *  - out: plain IT audit, data / AI roles that merely use cloud, IT support,
 *    software development, and selling security (a Major Account Manager at a
 *    security vendor is a sales job);
 *  - anything that cannot be told either way goes to Unclassified - never
 *    deleted, never shown as if it were proven.
 *
 * This module is the deterministic half. It is deliberately conservative: it is
 * "decisive" only when the title names a role family AND the duties carry the
 * vocabulary of that family (two signals that agree, HANDOVER §6). Everything
 * in between is "leaning" or "unclear" and goes to the model jury.
 */

export type ScopeVerdict = "in" | "out" | "unclear";
export type ScopeConfidence = "decisive" | "leaning";
export type ScopeArea = "security" | "cloud" | "both";
export type Focus =
  | "SOC" | "DFIR" | "Threat Intel" | "GRC" | "IAM" | "AppSec" | "Pentest"
  | "OT Security" | "Network Security" | "Cloud Security" | "Cloud" | "DevOps";

export type TextQuality = "full" | "partial" | "snippet" | "none";

export interface ScopeResult {
  verdict: ScopeVerdict;
  confidence: ScopeConfidence;
  /** An owner's exclusion (physical security, DevOps): no model can overrule it. */
  absolute?: boolean;
  scope: ScopeArea | null;
  focus: Focus[];
  /** Verbatim sentences from the posting that carry the decisive terms. */
  evidence: string[];
  reason: string;
  /** Distinct duty terms found, for the arbiter and for debugging. */
  securityTerms: string[];
  cloudTerms: string[];
}

/* -------------------------------------------------------------------------- */
/* vocabularies                                                                */
/* -------------------------------------------------------------------------- */

/** Things only security work does. Generic IT words are not here. */
const SECURITY_DUTY = [
  // operations / monitoring
  "siem", "splunk", "qradar", "microsoft sentinel", "azure sentinel", "arcsight", "logrhythm",
  "soar", "xdr", "edr", "crowdstrike", "sentinelone", "carbon black", "defender for endpoint",
  "security operations", "security monitoring", "security operations center", "soc",
  "use cases", "log correlation", "security alerts", "security incidents",
  // response / threat
  "incident response", "incident handling", "digital forensics", "forensic", "malware",
  "threat intelligence", "threat hunting", "threat modeling", "mitre att&ck", "mitre",
  "indicators of compromise", "ioc", "ttps", "phishing", "ransomware", "ddos",
  // offensive / vulnerability
  "penetration testing", "penetration test", "pentest", "red team", "red teaming",
  "vulnerability assessment", "vulnerability management", "vulnerability scanning",
  "nessus", "tenable", "qualys", "rapid7", "burp suite", "metasploit", "vapt",
  // appsec
  "owasp", "sast", "dast", "secure code review", "secure coding", "devsecops",
  "application security", "api security",
  // identity
  "identity and access management", "identity & access management", "iam",
  "privileged access", "pam", "cyberark", "beyondtrust", "sailpoint", "okta",
  "identity governance", "multi-factor authentication", "mfa",
  // network security
  // Not bare "ids" / "ips": "user IDs" and "IPs" are everyday IT words.
  "firewall", "firewalls", "ids/ips", "ips/ids", "intrusion detection", "intrusion prevention",
  "waf", "nac", "network access control", "vpn", "zero trust", "palo alto", "fortinet",
  "fortigate", "check point", "checkpoint", "network segmentation", "dlp", "data loss prevention",
  "casb", "sase", "email security", "web proxy",
  // cyber GRC (frameworks are specific; "governance" alone is not)
  "iso 27001", "iso27001", "isms", "nca ecc", "ecc", "essential cybersecurity controls",
  "nca", "sama csf", "sama cyber", "nist csf", "nist 800", "cis controls", "cis benchmarks",
  "security policies", "security policy", "security risk", "cyber risk", "security awareness",
  "security controls", "security assessment", "security architecture", "security baseline",
  "hardening", "pci dss", "soc 2",
  // OT
  "ot security", "ics security", "scada security", "iec 62443",
  // certifications
  "cissp", "cism", "oscp", "ceh", "gcih", "gcia", "security+", "comptia security",
  "ccsp", "crisc",
  // general but security-only
  "cybersecurity", "cyber security", "information security", "infosec", "cyber",
  // Arabic (normalised: ة -> ه, أ -> ا). Written without the definite article,
  // because Arabic prefixes it: "للحوادث" does not contain "الحوادث", but it
  // does contain "حوادث". Matching is by substring for Arabic.
  "امن السيبراني", "امن سيبراني", "امن المعلومات", "ثغرات", "اختبار الاختراق",
  "حوادث الامنيه", "حوادث امنيه", "تنبيهات الامنيه", "عمليات الامنيه", "جدار الحمايه",
  "جدران الحمايه", "الهيئه الوطنيه للامن السيبراني", "ضوابط الاساسيه للامن السيبراني",
  "استجابه للحوادث", "هويه والوصول", "cspm", "cnapp",
] as const;

const CLOUD_DUTY = [
  "aws", "amazon web services", "azure", "microsoft azure", "gcp", "google cloud",
  "oracle cloud", "oci", "alibaba cloud", "huawei cloud", "stc cloud",
  "ec2", "s3", "lambda", "vpc", "vnet", "cloudwatch", "cloudtrail", "azure ad", "entra id",
  "eks", "aks", "gke", "kubernetes", "k8s", "openshift", "helm", "argocd", "gitops",
  "terraform", "cloudformation", "bicep", "arm templates", "pulumi", "infrastructure as code", "iac",
  "landing zone", "cloud migration", "multi-cloud", "hybrid cloud", "cloud native", "cloud-native",
  "serverless", "iaas", "paas", "finops", "cloud cost", "well-architected", "cloud infrastructure",
  "cloud platform", "cloud services", "cloud environment", "cloud security", "cspm", "cnapp",
  "containers", "container orchestration", "service mesh", "istio",
  "aws certified", "az-104", "az-305", "az-500", "az-900", "solutions architect associate",
  "الحوسبه السحابيه", "السحابه", "سحابي", "سحابيه",
] as const;

/* -------------------------------------------------------------------------- */
/* title families                                                              */
/* -------------------------------------------------------------------------- */

/** Titles that name security work outright. */
const SECURITY_TITLE =
  /\b(cyber ?security|cyber|information security|infosec|security (engineer|analyst|specialist|architect|consultant|administrator|operations|researcher|tester|lead|manager|officer|coordinator|champion|expert|auditor)|soc\b|siem|dfir|forensic\w*|incident respon\w*|threat (intel\w*|hunt\w*|detection)|malware|vulnerabilit\w*|penetration|pen ?test\w*|red team|blue team|purple team|offensive security|ethical hack\w*|appsec|application security|product security|devsecops|\biam\b|identity (and|&) access|identity governance|privileged access|\bpam\b|pki|cryptograph\w*|zero trust|ot security|ics security|cloud security|network security|data security|ai security|ciso|vapt|detection engineer\w*|security grc|cyber grc|isms|managed security|security managed services|security (services|practice|delivery|solutions|operations))\b|امن سيبراني|الامن السيبراني|امن المعلومات|السيبراني|اختبار الاختراق|مركز العمليات الامنيه/;

/** Cloud work in the title. Not "solutions architect": that is any vendor's presales. */
const CLOUD_TITLE =
  /\b(cloud|aws|azure|gcp|google cloud|oracle cloud|\boci\b|finops|openshift|kubernetes)\b|سحابي|الحوسبه السحابيه/;
const NOT_CLOUD_WORK = /\b(cloud kitchen|cloud sales|marketing cloud|commerce cloud|sales cloud|service cloud|azure devops)\b/;

/** A cloud provider or the word cloud itself: what keeps "Cloud DevOps" in. */
const CLOUD_NAME = /\b(cloud|aws|azure|gcp|google cloud|oracle cloud|oci)\b|سحابي|الحوسبه السحابيه/;

/** DevOps, SRE and platform roles: out by the owner's choice. */
const DEVOPS_ONLY = /\b(devops|dev ops|sre|site reliability|platform engineer\w*|platform operations)\b/;

/** Infrastructure roles: in scope only if the duties are cloud work. */
const DEVOPS_TITLE =
  /\b(devops|dev ops|sre|site reliability|platform engineer\w*|platform operations|cloudops|infrastructure engineer|infrastructure specialist|system(s)? administrator|system(s)? engineer|sysadmin|linux|windows (server|administrator)|virtuali[sz]ation|vmware|middleware|data ?cent(er|re))\b|البنيه التحتيه/;

/** In scope only if the duties are security work. */
const NETWORK_TITLE =
  /\b(network|networking|noc\b|telecom|infrastructure security|wan|lan)\b|شبكات/;

/** GRC-shaped titles share their vocabulary with ordinary business. */
const GRC_TITLE =
  /\b(grc|governance|risk|compliance|assurance|controls|policy|regulatory|business continuity|bcm)\b|الحوكمه|المخاطر|الالتزام/;

/** Families the user excluded outright, even when the employer is a security or cloud company. */
/** Guarding, CCTV, loss prevention: security of buildings and goods, not of systems. */
const PHYSICAL_SECURITY =
  /physical\W{0,3}security|\b(cctv|loss prevention|asset protection|security (guard|officer|supervisor|patrol)|guard(s|ing)?|patrol\w*|surveillance|close protection|executive protection|fire (alarm|safety))\b|حراس|حارس|كاميرات المراقبه|امن وسلامه|الامن والسلامه/;
/** Words that make a title cyber work even beside a physical one ("Physical & Cyber Security Lead"). */
const CYBER_WORD =
  /\b(cyber\w*|information security|infosec|it security|network security|cloud security|soc analyst|security operations cent(er|re)|siem|appsec|application security|penetration|pentest\w*|vulnerabilit\w*|incident response|grc)\b|سيبران|امن المعلومات/;

const EXCLUDED_FAMILY: Array<[RegExp, string]> = [
  [/\b(it audit\w*|itgc|internal audit\w*|it auditor|sox)\b/, "IT / internal audit"],
  // \w* on purpose: "Data Engineering Manager" and "Software Engineering
  // Intern" slipped past "engineer\b" on the live board (2026-10-13).
  [/\b(data (engineer\w*|scien\w*|analy\w*|architect\w*|governance|management|platform|steward\w*|quality)|analytics|business intelligence|\bbi\b|machine learning|\bml\b|mlops|\bai\b|artificial intelligence|llm|nlp|computer vision)\b/, "data / AI role"],
  [/\b(software (engineer\w*|develop\w*)|developer|programmer|front ?end|back ?end|full ?stack|mobile|android|ios|web develop\w*|\.net|java|python developer|qa\b|quality assurance|test (engineer\w*|analyst|automation)|sdet)\b/, "software development"],
  [/\b(it support|help ?desk|service desk|desktop support|technical support|support engineer|end user|field (engineer|technician)|it technician|itsm|customer (support|service|care|success|experience))\b|الدعم الفني|خدمه العملاء/, "IT / customer support"],
  [/\b(erp|sap|oracle (ebs|fusion|hcm|financials)|dynamics 365|salesforce|servicenow developer|crm)\b/, "enterprise application"],
  [/\b(project manager|program manager|pmo|scrum master|product owner|business analyst|product manager)\b/, "project / product role"],
  [/\b(credit risk|market risk|operational risk|aml|anti-money|fraud|financial crime|sharia|shariah|actuar\w*|enterprise risk)\b/, "business risk"],
  [/\b(security guard|guard|patrol|cctv operator|safety|hse|حارس|امن وسلامه)\b/, "physical security / safety"],
  // "Data Center Facility Engineer (Controls), AWS" maintains cooling and power
  // in Amazon's buildings; the AWS in the title is the employer, not the work.
  [/\b(facilit(y|ies)|critical (facilities|environment)|mep|hvac|electrical|mechanical|building management|bms)\b/, "facilities / building engineering"],
  // Giga-project boards (Qiddiya, ROSHN) list these beside their IT roles.
  [/\b(pavement|roads?|airfield|civil|structural|construction|qa\/qc|project controls?|cost control|quantity survey\w*|geotechnical|rail|metro|bim|land ?scap\w*|architectural)\b/, "construction / civil engineering"],
  [/\b(seo|marketing|growth|content|brand|social media|communications|public relations)\b/, "marketing / communications"],
];

/** Commercial titles relevance.ts does not name. */
const COMMERCIAL_EXTRA = /\b(partnerships?|partner sales|sales|go-to-market|gtm)\b/;

/* -------------------------------------------------------------------------- */
/* sections                                                                    */
/* -------------------------------------------------------------------------- */

const DUTY_HEADING =
  /\b(responsibilit\w*|duties|what you('ll| will) do|the role|role (overview|description|summary)|key (accountabilit\w*|tasks)|job (description|purpose|summary)|requirements|qualifications|what you('ll)? (need|bring)|skills|experience|you have|about the role|your impact|tasks)\b|المهام|المسؤوليات|الواجبات|المتطلبات|المؤهلات|الوصف الوظيفي|المهارات/;
const BOILERPLATE_HEADING =
  /\b(about us|about the company|who we are|our company|company overview|benefits|what we offer|perks|why join|equal opportunity|diversity|privacy|cookie)\b|عن الشركه|نبذه عن|المزايا/;
const BOILERPLATE_SENTENCE =
  /\b(we are an equal|equal opportunity|all qualified applicants|cookies?|privacy (notice|policy)|founded in|was founded|headquartered|our mission|our vision|we are a leading|is a leading|join our team of)\b/;

/**
 * The parts of a posting that describe the job, as normalised text plus the
 * original sentences they came from (for evidence).
 *
 * Postings that use headings get their About-us and Benefits sections dropped.
 * Flattened ones with no headings keep everything except sentences that read
 * as company boilerplate - "a leading cybersecurity company" in the About-us
 * blurb is not evidence that the receptionist role is a security job.
 */
function dutyText(original: string): { text: string; sentences: string[] } {
  const parts = original
    .split(/(?<=[.!?؟;:])\s+|\n+|\s*[•·|]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const anyHeading = parts.some((p) => p.length < 80 && (DUTY_HEADING.test(normalize(p)) || BOILERPLATE_HEADING.test(normalize(p))));
  const kept: string[] = [];
  let skipping = false;
  for (const p of parts) {
    const n = normalize(p);
    if (anyHeading && p.length < 80) {
      if (BOILERPLATE_HEADING.test(n)) {
        skipping = true;
        continue;
      }
      if (DUTY_HEADING.test(n)) skipping = false;
    }
    if (skipping) continue;
    if (BOILERPLATE_SENTENCE.test(n)) continue;
    kept.push(p);
  }
  return { text: normalize(kept.join(" ")), sentences: kept };
}

function distinctTerms(haystack: string, terms: readonly string[]): string[] {
  const found = new Set<string>();
  for (const t of terms) if (hasTerm(haystack, t)) found.add(t);
  // "security operations center" implies "security operations" and "soc";
  // count the idea once, not three times.
  const collapsed = [...found].filter((t) => ![...found].some((o) => o !== t && o.includes(t) && o.length > t.length));
  return collapsed;
}

function evidenceSentences(sentences: string[], terms: string[], max = 3): string[] {
  const out: string[] = [];
  for (const s of sentences) {
    if (out.length >= max) break;
    const n = normalize(s);
    if (terms.some((t) => hasTerm(n, t))) out.push(s.length <= 220 ? s : `${s.slice(0, 217)}...`);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* focus                                                                       */
/* -------------------------------------------------------------------------- */

const FOCUS_RULES: Array<[Focus, RegExp]> = [
  ["SOC", /\b(soc|siem|security operations|security monitoring|splunk|qradar|sentinel|use cases|detection engineer\w*)\b|مركز العمليات الامنيه/],
  ["DFIR", /\b(dfir|forensic\w*|incident respon\w*|incident handling)\b/],
  ["Threat Intel", /\b(threat intel\w*|threat hunt\w*|cti)\b/],
  ["GRC", /\b(grc|iso ?27001|isms|nca ecc|essential cybersecurity controls|sama csf|nist csf|security polic\w*|security risk|cyber risk|security governance|compliance)\b|الحوكمه/],
  ["IAM", /\b(iam|identity (and|&) access|identity governance|privileged access|pam|cyberark|sailpoint|okta|beyondtrust)\b/],
  ["AppSec", /\b(appsec|application security|devsecops|owasp|sast|dast|secure code|api security|product security)\b/],
  ["Pentest", /\b(penetration|pen ?test\w*|red team\w*|offensive security|vapt|ethical hack\w*|burp)\b|اختبار الاختراق/],
  ["OT Security", /\b(ot security|ics|scada|iec 62443|operational technology)\b/],
  ["Network Security", /\b(firewall\w*|ids|ips|waf|nac|vpn|zero trust|palo alto|fortinet|fortigate|check ?point|network security|segmentation)\b/],
  ["Cloud Security", /\b(cloud security|cspm|cnapp|ccsp|az-500|security hub|defender for cloud)\b/],
  ["Cloud", /\b(aws|azure|gcp|google cloud|oci|oracle cloud|landing zone|cloud migration|cloud architect\w*|cloud engineer\w*|iaas|paas)\b|سحابي|الحوسبه السحابيه/],
];

function focusOf(title: string, duty: string, area: ScopeArea | null): Focus[] {
  const t = normalize(title);
  const fromTitle = FOCUS_RULES.filter(([, re]) => re.test(t)).map(([f]) => f);
  const fromDuty = FOCUS_RULES.filter(([f, re]) => !fromTitle.includes(f) && (duty.match(new RegExp(re.source, "g"))?.length ?? 0) >= 2).map(([f]) => f);
  let focus = [...fromTitle, ...fromDuty];
  // A security job that mentions AWS once is not a cloud job, and vice versa.
  if (area === "security") focus = focus.filter((f) => f !== "Cloud" && f !== "DevOps");
  if (area === "cloud") focus = focus.filter((f) => !["SOC", "DFIR", "Threat Intel", "GRC", "IAM", "Pentest", "OT Security"].includes(f));
  return focus.slice(0, 4);
}

/* -------------------------------------------------------------------------- */
/* the judgement                                                               */
/* -------------------------------------------------------------------------- */

function result(
  verdict: ScopeVerdict,
  confidence: ScopeConfidence,
  scope: ScopeArea | null,
  reason: string,
  ctx: { title: string; duty: string; sentences: string[]; sec: string[]; cloud: string[] },
  absolute = false,
): ScopeResult {
  const terms = scope === "cloud" ? ctx.cloud : scope === "security" ? ctx.sec : [...ctx.sec, ...ctx.cloud];
  return {
    verdict,
    confidence,
    scope,
    focus: verdict === "in" ? focusOf(ctx.title, ctx.duty, scope) : [],
    evidence: verdict === "out" ? [] : evidenceSentences(ctx.sentences, terms),
    reason,
    ...(absolute ? { absolute: true } : {}),
    securityTerms: ctx.sec,
    cloudTerms: ctx.cloud,
  };
}

export function judgeScope(
  title: string,
  department: string | null | undefined,
  text: string | null | undefined,
  quality: TextQuality,
): ScopeResult {
  const t = normalize(`${title} ${department ?? ""}`);
  const { text: duty, sentences } = dutyText(text ?? "");
  const sec = distinctTerms(duty, SECURITY_DUTY);
  const cloud = distinctTerms(duty, CLOUD_DUTY);
  const ctx = { title, duty, sentences, sec, cloud };
  // Full text can be decisive; a snippet or a listing card never is.
  const canDecide = quality === "full" || quality === "partial";
  const strong = (n: number) => canDecide && n >= 2;

  const secTitle = SECURITY_TITLE.test(t);
  const cloudTitle = CLOUD_TITLE.test(t) && !NOT_CLOUD_WORK.test(t);
  const area = (s: boolean, c: boolean): ScopeArea | null => (s && c ? "both" : s ? "security" : c ? "cloud" : null);

  // Selling security is a sales job, whatever the product (CLAUDE.md rule 5).
  if ((COMMERCIAL_ROLE.test(t) || COMMERCIAL_EXTRA.test(t)) && !TECHNICAL_ANYWAY.test(t)) {
    return result("out", canDecide ? "decisive" : "leaning", null, "commercial role, not technical work", ctx);
  }
  // Non-IT professions, unless the title itself carries a real IT term.
  if (OTHER_PROFESSION.test(t) && !STRONG_IT_OVERRIDE.test(t) && !secTitle && !cloudTitle) {
    return result("out", canDecide ? "decisive" : "leaning", null, "a profession outside IT", ctx);
  }

  /*
   * Physical security is not cybersecurity, though its titles say "security".
   * Amazon's "(Physical) Security Specialist Intern", the Ritz-Carlton's
   * "Loss Prevention Officer (Security Officer)" and DIKTUCOM's "CCTV
   * Manufacturing Expert" all leaned in on the word, and the models were
   * right to say out (user, 2026-10-21). Checked before the security title,
   * which they would otherwise pass as.
   */
  if (PHYSICAL_SECURITY.test(t) && !CYBER_WORD.test(t)) {
    return result("out", "decisive", null, "physical security, not cybersecurity", ctx, true);
  }
  // DevOps, SRE and platform work: out by the owner's choice (2026-10-21,
  // "only cybersecurity, cloud and cloud security"), whatever the duties - a
  // title that is itself cloud or security work ("Cloud DevOps Engineer",
  // "DevSecOps") stays in.
  // Only a cloud *name* rescues a DevOps title: "Kubernetes & Storage DevOps
  // Engineer" (Yallo Retail) passed on "Kubernetes" and was shown (2026-10-22).
  // The title alone, not the department: Devoteam's "DevOps Engineer" in a
  // department called "Cloud" was shown (2026-10-22).
  const ownTitle = normalize(title);
  if (!SECURITY_TITLE.test(ownTitle) && !CLOUD_NAME.test(ownTitle.replace(/azure devops/g, "")) && DEVOPS_ONLY.test(ownTitle)) {
    return result("out", "decisive", null, "DevOps / SRE / platform role - out by the owner's choice (cybersecurity and cloud only)", ctx, true);
  }

  // Families the user excluded. A security title wins ("Data Security
  // Analyst", "DevSecOps Developer"); otherwise the duties decide how sure we
  // are, and heavy security duties make it a question rather than an answer.
  if (!secTitle) {
    for (const [re, why] of EXCLUDED_FAMILY) {
      if (!re.test(t)) continue;
      if (strong(sec.length) && sec.length >= 4) {
        return result("unclear", "leaning", "security", `${why} title, but the duties are heavily security`, ctx);
      }
      // Cloud vocabulary does not rescue data, AI or software roles: the
      // user ruled those out even when they run on cloud.
      return result("out", canDecide && sec.length <= 1 ? "decisive" : "leaning", null, why, ctx);
    }
  }

  if (secTitle) {
    const both = cloudTitle || (strong(cloud.length) && cloud.length >= 4);
    // "Cloud Security Engineer": the duties of either side are the job.
    const duties = cloudTitle ? new Set([...sec, ...cloud]).size : sec.length;
    if (strong(duties)) return result("in", "decisive", area(true, both), "security title and security duties", ctx);
    return result("in", "leaning", area(true, both), canDecide ? "security title, few security duties in the text" : "security title; full posting not read", ctx);
  }

  if (cloudTitle) {
    if (strong(cloud.length)) return result("in", "decisive", area(strong(sec.length) && sec.length >= 4, true), "cloud title and cloud duties", ctx);
    return result("in", "leaning", "cloud", canDecide ? "cloud title, few cloud duties in the text" : "cloud title; full posting not read", ctx);
  }

  if (DEVOPS_TITLE.test(t)) {
    if (strong(cloud.length)) return result("in", "decisive", "cloud", "infrastructure role with cloud duties", ctx);
    if (cloud.length === 1 || !canDecide) return result("unclear", "leaning", "cloud", "infrastructure role; cloud duties not established", ctx);
    if (strong(sec.length) && sec.length >= 3) return result("unclear", "leaning", "security", "infrastructure role with security duties", ctx);
    return result("out", "leaning", null, "infrastructure role without cloud duties", ctx);
  }

  if (NETWORK_TITLE.test(t)) {
    if (strong(sec.length)) return result("in", "decisive", "security", "network role with security duties", ctx);
    if (sec.length === 1 || !canDecide) return result("unclear", "leaning", "security", "network role; security duties not established", ctx);
    return result("out", "leaning", null, "network role without security duties", ctx);
  }

  if (GRC_TITLE.test(t)) {
    // Frameworks are specific: ISO 27001, NCA ECC, SAMA CSF never describe
    // procurement compliance. Governance words alone always could.
    if (strong(sec.length)) return result("in", "leaning", "security", "GRC title with cyber frameworks in the duties", ctx);
    if (sec.length === 1) return result("unclear", "leaning", "security", "GRC title, one cyber term", ctx);
    return result(canDecide ? "out" : "unclear", "leaning", null, "GRC-shaped title with no cyber content", ctx);
  }

  // A title naming no family ("Engineer", "Consultant", "Specialist II").
  if (canDecide && sec.length >= 4) return result("in", "leaning", area(true, cloud.length >= 4), "generic title, duties are security work", ctx);
  if (canDecide && cloud.length >= 4) return result("in", "leaning", "cloud", "generic title, duties are cloud work", ctx);
  if (canDecide && sec.length + cloud.length === 0) return result("out", "leaning", null, "no security or cloud content in the posting", ctx);
  return result("unclear", "leaning", null, "the title and text do not establish the kind of work", ctx);
}

/** How much of a posting we actually hold, from its length and source. */
export function textQualityOf(text: string | null | undefined, sourceKind: string): TextQuality {
  const n = (text ?? "").trim().length;
  if (n === 0) return "none";
  // Careerjet and Jooble only ever return a search snippet.
  if (sourceKind === "careerjet" || sourceKind === "jooble") return "snippet";
  if (n < 300) return "snippet";
  if (n < 900) return "partial";
  return "full";
}

/** Security-duty terms in a piece of text (used to check a model's quote supports its claim). */
export function securityTermsIn(text: string): string[] {
  const n = normalize(text);
  const fromTitle = SECURITY_TITLE.test(n) ? ["(security role)"] : [];
  return [...distinctTerms(n, SECURITY_DUTY), ...fromTitle];
}

/** Cloud-duty terms in a piece of text. */
export function cloudTermsIn(text: string): string[] {
  const n = normalize(text);
  const fromTitle = CLOUD_TITLE.test(n) && !NOT_CLOUD_WORK.test(n) ? ["(cloud role)"] : [];
  return [...distinctTerms(n, CLOUD_DUTY), ...fromTitle];
}
