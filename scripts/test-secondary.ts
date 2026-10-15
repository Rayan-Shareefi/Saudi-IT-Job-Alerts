/**
 * Regression cases for "is this link a second job board for the same employer?"
 *
 * Every wrong answer here has a cost. A false positive becomes a source that
 * gets polled forever and yields one posting or none; a false negative loses a
 * whole graduate or co-op portal, which is exactly the kind of listing this
 * board exists to surface.
 *
 *   npm run test:secondary
 */
import { looksLikeSecondaryBoard } from "../src/lib/sources/secondary";

const CASES: Array<[string, boolean, string]> = [
  // Not boards.
  ["https://apply.workable.com/qiddiya-investment-company-1/j/63", false, "Workable's short link to one vacancy"],
  ["https://apply.workable.com/qiddiya-investment-company-1/j/DE", false, "same, non-numeric id"],
  ["https://example.com/jobs/12345", false, "numeric link to one posting"],
  ["https://careers.maaden.com/gb/en/job/8595/Principal-Specialist", false, "one posting"],
  ["https://www.deloitte.com/middle-east/en/services/tax/international-tax.html", false, "'intern' inside INTERNational"],
  ["https://www.alahli.com/en/pages/personal-banking/finance/international-transfer", false, "same substring trap"],
  ["https://www.se.com.sa/ar-SA/Whoweare/About-Company/Internal-Audit/", false, "internal audit"],
  ["https://nour.net.sa/connectivity/internet-service-provider-in-ksa/", false, "internet service page"],
  ["https://www.linkedin.com/company/acme/jobs/", false, "third-party board"],

  // Real second boards.
  ["https://careers.theredsea.sa/go/Job-Opportunities/7716923/", true, "a listing"],
  ["https://www.sabic.com/en/careers/middle-east-africa/students-and-fresh-graduates", true, "graduate portal"],
  ["https://careers.stc.com.sa/go/Cooperative-Training/7736023/", true, "co-op board"],
  ["https://careers.petrorabigh.com/pages/university-college-co-op-program", true, "university co-op programme"],
  ["https://www.pif.gov.sa/en/careers/graduate-development-program/", true, "graduate scheme"],
  ["https://sa.zain.com/about/co-op-program/", true, "co-op page under /about/"],
  ["https://fa-eueh.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/", true, "Oracle board, no hint word in the URL"],
];

let failures = 0;
console.log(`\nSecondary-board links (${CASES.length} cases)\n`);
for (const [url, want, why] of CASES) {
  const got = looksLikeSecondaryBoard(url);
  if (got !== want) {
    console.log(`  FAIL  ${got ? "kept" : "rejected"} — ${why}`);
    console.log(`        ${url}`);
    failures++;
  }
}
console.log(failures === 0 ? `all ${CASES.length} cases correct` : `\n${failures} case(s) wrong`);
if (failures > 0) process.exit(1);
