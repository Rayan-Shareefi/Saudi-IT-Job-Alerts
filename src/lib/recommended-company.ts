/**
 * The "Recommended Company" badge (user, 2026-10-21): "only companies with big
 * names that are very good in their market, or whose main work is technical -
 * for example SITE".
 *
 *   - every priority-1 employer in the registry: the big names (Aramco, NEOM,
 *     PIF, SNB, SDAIA, NCA, stc, Elm, SITE, Tahakom, Microsoft, Deloitte...);
 *   - priority-2 employers whose main work is technical: security vendors,
 *     global technology firms, telecom and IT companies.
 *
 * Matched on the company key (company-key.ts), so "Saudi Telecom Company",
 * "stc" and "AWS" / "Amazon Web Services" all land on the right employer. A
 * company not in the registry gets the badge once it is added there with a
 * priority - the list lives in src/lib/sources/companies.ts, not here.
 */
import { companyKey } from "./company-key";
import { COMPANIES, type CompanySeed } from "./sources/companies";

const TECHNICAL: ReadonlySet<CompanySeed["sector"]> = new Set(["security-vendor", "global-tech", "telecom-tech"]);

/**
 * Well-known technology and security firms that post in Riyadh but are not
 * employers in the registry (they come in through LinkedIn and JSearch), and
 * the names Saudi postings use for registry employers' own units.
 */
const ALSO = [
  "Tencent Cloud", "Alibaba Cloud", "Huawei", "Ericsson", "Nokia", "Thales", "Group-IB", "Kaspersky", "Trend Micro",
  "Check Point", "HCLTech", "Infosys", "Tata Consultancy Services", "Cloudflare", "Zscaler", "Okta", "Splunk", "Dell",
  "Hewlett Packard Enterprise", "VMware", "Red Hat", "Mandiant", "Help AG", "Cipher", "Visa", "Mastercard", "Wipro", "Cohere",
  "Emdad By Elm", "شركة علم لأمن المعلومات",
];

const KEYS: ReadonlySet<string> = new Set(
  [...COMPANIES.filter((c) => c.priority === 1 || (c.priority === 2 && TECHNICAL.has(c.sector))).map((c) => c.name), ...ALSO]
    .map((n) => companyKey(n))
    .filter((k) => k.length >= 2),
);

export function isRecommendedCompany(name: string | null | undefined): boolean {
  if (!name) return false;
  const key = companyKey(name);
  if (KEYS.has(key)) return true;
  // The same brand with a suffix or prefix the alias map does not know:
  // "Ericsson GmbH", "2P Perfect Presentation". Five letters at least, so a
  // short key such as "elm" or "stc" never matches inside another word.
  for (const k of KEYS) if (k.length >= 5 && (key.startsWith(k) || key.endsWith(k))) return true;
  return false;
}

/** How many employers carry the badge, for the page's note. */
export const RECOMMENDED_COMPANY_COUNT = KEYS.size;
