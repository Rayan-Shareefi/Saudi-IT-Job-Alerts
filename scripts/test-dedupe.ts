/**
 * One card per vacancy - and never one card for two vacancies.
 *
 *   npm run test:dedupe
 *
 * The user: "make sure not to remove the wrong job and make sure that the jobs
 * are actually duplicated". So the must-not-merge cases matter as much as the
 * merges. Zero network, zero database.
 */
import { groupDuplicates, type DedupRow } from "../src/lib/dedupe";

let n = 0;
function row(over: Partial<DedupRow>): DedupRow {
  n++;
  return {
    id: `r${n}`,
    source_id: "ats-acme",
    source_kind: "ats",
    source_label: "Acme",
    publisher: null,
    company: "Acme",
    title: "SOC Analyst",
    city: "riyadh",
    url: `https://acme.example/jobs/${n}`,
    apply_url: null,
    description_text: null,
    text_quality: "full",
    min_years: null,
    experience_source: "none",
    posted_at: "2026-10-10T00:00:00Z",
    first_seen_at: "2026-10-10T00:00:00Z",
    last_refreshed_at: null,
    duplicate_of: null,
    also_on: null,
    ...over,
  };
}

const SOC_TEXT =
  "Responsibilities: Monitor SIEM alerts in Splunk and triage security incidents. Escalate to Tier 2 and document findings in the case management tool. Tune detection use cases with the engineering team. Requirements: 1-2 years of experience in a security operations center, knowledge of MITRE ATT&CK and EDR tooling, and a bachelor's degree in computer science.";
const OTHER_TEXT =
  "Responsibilities: Lead our red team engagements against critical infrastructure and design adversary emulation plans. Build custom tooling for initial access and lateral movement. Requirements: OSCP or OSCE and experience with Cobalt Strike, Active Directory attacks and cloud attack paths.";

let failures = 0;
function expectGroups(name: string, rows: DedupRow[], want: number, copies?: number): void {
  const groups = groupDuplicates(rows);
  const gotCopies = groups.reduce((s, g) => s + g.copies.length, 0);
  if (groups.length !== want || (copies !== undefined && gotCopies !== copies)) {
    failures++;
    console.log(`FAIL  ${name}: ${groups.length} group(s), ${gotCopies} copy(ies); want ${want}${copies !== undefined ? ` / ${copies}` : ""}`);
  }
}

/* ---- must merge ------------------------------------------------------------ */
expectGroups("company ATS + Careerjet snippet, same title", [
  row({ description_text: SOC_TEXT }),
  row({ source_id: "careerjet-riyadh", source_kind: "careerjet", source_label: "Careerjet", text_quality: "snippet", description_text: "Monitor SIEM alerts..." }),
], 1, 1);
expectGroups("title decoration and company spelling differ", [
  row({ company: "stc", title: "SOC Analyst", description_text: SOC_TEXT }),
  row({ company: "Saudi Telecom Company", title: "SOC Analyst - Riyadh, KSA", source_id: "jsearch-riyadh", source_kind: "jsearch", publisher: "LinkedIn", description_text: SOC_TEXT }),
], 1, 1);
expectGroups("same LinkedIn id from JSearch and LinkedIn", [
  row({ source_id: "linkedin-riyadh", source_kind: "linkedin", url: "https://www.linkedin.com/jobs/view/4475550800/", title: "Information Security Engineer (SOC L2)", description_text: SOC_TEXT }),
  row({ source_id: "jsearch-riyadh", source_kind: "jsearch", url: "https://www.linkedin.com/jobs/view/information-security-engineer-at-tabby-4475550800", title: "Information Security Engineer - SOC L2", description_text: SOC_TEXT }),
], 1, 1);
expectGroups("near-same title with the same text", [
  row({ title: "Cyber Security Analyst - SOC", description_text: SOC_TEXT }),
  row({ title: "Cybersecurity Analyst SOC", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 1, 1);
expectGroups("three sources, one vacancy", [
  row({ description_text: SOC_TEXT }),
  row({ source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
  row({ source_id: "careerjet-riyadh", source_kind: "careerjet", text_quality: "snippet", description_text: "SIEM alerts" }),
], 1, 2);

/* ---- must NOT merge ---------------------------------------------------------- */
expectGroups("two real SOC Analyst requisitions on one board", [
  row({ description_text: SOC_TEXT }),
  row({ description_text: SOC_TEXT }),
], 0);
expectGroups("Senior vs plain", [
  row({ title: "Senior SOC Analyst", description_text: SOC_TEXT }),
  row({ title: "SOC Analyst", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 0);
expectGroups("level II vs III", [
  row({ title: "Security Engineer II", description_text: SOC_TEXT }),
  row({ title: "Security Engineer III", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 0);
expectGroups("different companies, same title", [
  row({ company: "Acme", description_text: SOC_TEXT }),
  row({ company: "Globex", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 0);
expectGroups("same title, different full texts", [
  row({ title: "Security Consultant", description_text: SOC_TEXT }),
  row({ title: "Security Consultant", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: OTHER_TEXT }),
], 0);
expectGroups("different stated cities", [
  row({ city: "riyadh", description_text: SOC_TEXT }),
  row({ city: "jeddah", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 0);
expectGroups("stated years far apart", [
  row({ min_years: 1, experience_source: "stated", description_text: SOC_TEXT }),
  row({ min_years: 5, experience_source: "stated", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 0);
expectGroups("one aggregator row matching two separate company requisitions", [
  row({ description_text: SOC_TEXT }),
  row({ description_text: SOC_TEXT }),
  row({ source_id: "careerjet-riyadh", source_kind: "careerjet", text_quality: "snippet", description_text: "SIEM" }),
], 0);
expectGroups("co-op vs full-time with the same role words", [
  row({ title: "Cybersecurity Co-op", description_text: SOC_TEXT }),
  row({ title: "Cybersecurity", source_id: "linkedin-riyadh", source_kind: "linkedin", description_text: SOC_TEXT }),
], 0);

expectGroups("Foodics: different vacancies sharing one board URL (HANDOVER §6)", [
  row({ company: "Foodics", title: "AI Engineer", url: "https://apply.workable.com/foodics/", description_text: SOC_TEXT }),
  row({ company: "Foodics", title: "BCM Officer", url: "https://apply.workable.com/foodics/", source_id: "browser-foodics", source_kind: "career-page", description_text: SOC_TEXT }),
], 0);

expectGroups("same posting filed under an acquired brand (Juniper -> HPE), same apply link", [
  row({ company: "Hewlett Packard Enterprise", title: "Data Solutions and Storage Intern (COOP)", url: "https://hpe.wd5.myworkdayjobs.com/Jobs/job/Riyadh/Data-Solutions_1197", description_text: SOC_TEXT }),
  row({ company: "Juniper Networks", title: "Data Solutions and Storage Intern (COOP)", url: "https://hpe.wd5.myworkdayjobs.com/Jobs/job/Riyadh/Data-Solutions_1197", source_id: "workday-juniper", description_text: SOC_TEXT }),
], 1, 1);
expectGroups("a recruiter's posting with the same link but a different role is not merged", [
  row({ company: "Acme", title: "SOC Analyst", url: "https://jobs.example/apply", description_text: SOC_TEXT }),
  row({ company: "Talent Partners", title: "Cloud Architect", url: "https://jobs.example/apply", source_id: "jsearch-riyadh", source_kind: "jsearch", description_text: SOC_TEXT }),
], 0);

/* ---- primary choice ---------------------------------------------------------- */
{
  const ats = row({ description_text: SOC_TEXT });
  const cj = row({ source_id: "careerjet-riyadh", source_kind: "careerjet", text_quality: "snippet", description_text: "SIEM" });
  const g = groupDuplicates([cj, ats])[0];
  if (!g || g.primary.id !== ats.id) {
    failures++;
    console.log("FAIL  the company's own posting must be the card everyone sees");
  }
}

const total = 19;
console.log(`dedupe: ${total - failures}/${total} correct`);
if (failures > 0) process.exit(1);
