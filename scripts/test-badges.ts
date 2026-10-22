/**
 * The "Recommended Company" badge (src/lib/recommended-company.ts). Offline.
 *
 *   npm run test:badges
 */
import { isRecommendedCompany } from "../src/lib/recommended-company";
import { COMPANIES } from "../src/lib/sources/companies";

const CASES: Array<[string, boolean, string]> = [
  ["SITE", true, "the user's own example"],
  ["SITE (Saudi Information Technology Company)", true, "registry name"],
  ["Saudi Telecom Company", true, "alias of stc"],
  ["Elm Company", true, "Elm"],
  ["علم", true, "Elm in Arabic"],
  ["شركة علم لأمن المعلومات", true, "Elm's security arm, as LinkedIn names it"],
  ["Emdad By Elm", true, "Elm unit"],
  ["Amazon Web Services", true, "global tech"],
  ["Ericsson GmbH", true, "a suffix the alias map does not know"],
  ["2P Perfect Presentation", true, "a prefix the alias map does not know"],
  ["Group-IB", true, "a known security vendor outside the registry"],
  ["National Cybersecurity Authority (NCA)", true, "government, priority 1"],
  ["Riyad Bank", true, "a big-name bank"],
  ["Exequt", false, "a small recruiter"],
  ["TASC Outsourcing", false, "a staffing agency"],
  ["Al Salama Hospital", false, "not technical, not a big name"],
  ["Elmasry Trading", false, "'elm' must not match inside another word"],
  ["", false, "no name"],
];

let failures = 0;

// Every employer once: two entries named "RTX (Raytheon)" and "NTT DATA"
// broke the nightly Site report and emptied it (2026-10-22).
{
  const seen = new Map<string, number>();
  for (const c of COMPANIES) seen.set(c.name, (seen.get(c.name) ?? 0) + 1);
  const twice = [...seen].filter(([, n]) => n > 1).map(([name]) => name);
  if (twice.length) {
    failures++;
    console.log(`FAIL  companies.ts lists these more than once: ${twice.join(", ")}`);
  }
}
for (const [name, want, why] of CASES) {
  const got = isRecommendedCompany(name);
  if (got !== want) {
    failures++;
    console.log(`FAIL  "${name}" -> ${got}, wanted ${want} (${why})`);
  }
}
console.log(`badges: ${CASES.length - failures}/${CASES.length} correct`);
if (failures > 0) process.exit(1);
