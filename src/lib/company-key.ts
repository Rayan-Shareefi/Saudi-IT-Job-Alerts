import { createHash } from "node:crypto";
import { normalize } from "./text";

/**
 * Keys for recognising the same employer and the same role across sources.
 *
 * The old fingerprint hashed company + title + city exactly, so "stc" on the
 * company ATS and "Saudi Telecom Company" on JSearch, or "SOC Analyst" and
 * "SOC Analyst - Riyadh, KSA", were different vacancies. Dedup compares these
 * keys first and only then the posting text (src/lib/dedupe.ts).
 */

/**
 * Employers that appear under more than one name. Left side: any spelling seen
 * on a source. Right side: the key every spelling collapses to.
 */
const ALIASES: Array<[RegExp, string]> = [
  [/^(stc|saudi telecom( company)?|stc group|الاتصالات السعوديه)$/, "stc"],
  [/^(solutions by stc|stc solutions|arabian internet (and|&) communications services)$/, "solutionsbystc"],
  [/^(sirar( by stc)?|sirar)$/, "sirar"],
  [/^(elm( company)?|علم)$/, "elm"],
  [/^(saudi aramco|aramco)$/, "aramco"],
  [/^(sabic|saudi basic industries( corporation)?)$/, "sabic"],
  [/^(sdaia|saudi data (and|&) ai authority|saudi data and artificial intelligence authority)$/, "sdaia"],
  [/^(nca|national cybersecurity authority|الهيئه الوطنيه للامن السيبراني)$/, "nca"],
  [/^(mobily|etihad etisalat)$/, "mobily"],
  [/^(zain( ksa)?|zain saudi arabia)$/, "zain"],
  [/^(aws|amazon web services|amazon)$/, "amazon"],
  [/^(microsoft|microsoft corporation)$/, "microsoft"],
  [/^(google|google cloud)$/, "google"],
  [/^(oracle|oracle corporation)$/, "oracle"],
  [/^(ibm|international business machines)$/, "ibm"],
  // Juniper has been part of HPE since 2025; its postings apply through HPE's
  // Workday and appeared on the board twice, once under each name.
  [/^(hpe|hewlett packard enterprise|juniper|juniper networks)$/, "hpe"],
  [/^(pwc|pricewaterhousecoopers|pwc middle east)$/, "pwc"],
  [/^(ey|ernst (and|&) young)$/, "ey"],
  [/^(kpmg|kpmg al fozan)$/, "kpmg"],
  [/^(deloitte|deloitte middle east)$/, "deloitte"],
  [/^(accenture|accenture middle east)$/, "accenture"],
  [/^(sbm|saudi business machines)$/, "sbm"],
  [/^(neom|neom company)$/, "neom"],
  [/^(qiddiya|qiddiya investment company)$/, "qiddiya"],
  [/^(tabby|تابي)$/, "tabby"],
];

/** Legal-form and filler words that never distinguish one employer from another. */
const FILLER =
  /\b(inc|ltd|llc|plc|co|company|corp|corporation|group|holding|holdings|limited|ksa|saudi arabia|ksa branch|branch|middle east|mea|the|for|of|and|est)\b/g;

export function companyKey(name: string | null | undefined): string {
  const n = normalize(name ?? "")
    .replace(/\s*[|(].*$/, "") // "Tabby | تابي", "Elm (Saudi)"
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  for (const [re, key] of ALIASES) if (re.test(n)) return key;
  const stripped = n.replace(FILLER, " ").replace(/[^a-z0-9؀-ۿ]+/g, "");
  return stripped || n.replace(/\s+/g, "");
}

/** Place and requisition decoration that is not part of the role. */
const TITLE_NOISE: RegExp[] = [
  /\s*[-–|,(]\s*(riyadh|jeddah|dammam|khobar|ksa|saudi arabia|saudi|remote|hybrid|onsite|on-site)(\s*,?\s*(ksa|saudi arabia|saudi))?\)?\s*$/gi,
  /\s*\((saudi nationals?( only)?|saudi only|saudization|nationals only)\)\s*$/gi,
  /\s*[-–|]\s*(saudi nationals?( only)?|saudi only)\s*$/gi,
  /\s*\b(req|job|requisition)\s*(id|#|no\.?)?\s*[:#]?\s*[a-z]*\d{3,}\b/gi,
  /\s*\b[a-z]{0,3}-?\d{5,}\b/gi,
];

/** Seniority synonyms, folded so "Sr." and "Senior" compare equal. */
const SYNONYMS: Array<[RegExp, string]> = [
  [/\bsr\.?(?=\s|$)/g, "senior"],
  [/\bjr\.?(?=\s|$)/g, "junior"],
  [/\bmgr\b/g, "manager"],
  [/\beng\b/g, "engineer"],
  [/\bspec\b/g, "specialist"],
  [/\bcyber ?security\b/g, "cybersecurity"],
  [/\bco-?op\b/g, "coop"],
  [/\bi\b(?=\s*$)/g, "1"],
  [/\bii\b/g, "2"],
  [/\biii\b/g, "3"],
];

/** The role with its decoration removed, as sorted tokens joined by spaces. */
export function titleKey(title: string | null | undefined): string {
  let t = title ?? "";
  for (const re of TITLE_NOISE) t = t.replace(re, "");
  let n = normalize(t);
  for (const [re, rep] of SYNONYMS) n = n.replace(re, rep);
  return n
    .replace(/[^a-z0-9؀-ۿ]+/g, " ")
    .split(" ")
    .filter((w) => w && !["the", "a", "an", "of", "for", "and", "in", "at", "to"].includes(w))
    .sort()
    .join(" ");
}

/** Short stable hash for building IDs out of keys. */
export function shortHash(...parts: string[]): string {
  return createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 20);
}

/** Token-set Jaccard similarity of two title keys. */
export function titleSimilarity(a: string, b: string): number {
  const A = new Set(a.split(" ").filter(Boolean));
  const B = new Set(b.split(" ").filter(Boolean));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
