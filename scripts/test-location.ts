/**
 * Regression cases for reading a location out of the description.
 *
 * The classifier used to scan the body for a SAUDI city and, finding none,
 * record "not stated" - which is kept. So DXC's Cyber Security Intern, whose
 * description says in plain text **"Work Location: Milan with smart working
 * possibility"**, sat on a Riyadh board as an unplaced role. 730 postings had
 * no location, which is not credible for real job ads.
 *
 * Reading the statement lets a posting be judged on what it actually says.
 *
 *   npm run test:location
 */
import { detectCity, statedLocations } from "../src/lib/classify";

const CASES: Array<[string, string, string]> = [
  [
    "DXC Cyber Security Intern (the one you found)",
    "DXC Technology is looking for a Cyber Security Intern to join Risk & Data Governance projects. Your work will focus on major European regulatory frameworks, including: DORA and NIS2. Work Location: Milan with smart working possibility. Why Join Us...",
    "foreign",
  ],
  ["stated Riyadh in the body", "About the role. Work Location: Riyadh, Saudi Arabia. You will...", "riyadh"],
  ["stated Jeddah", "Job Location: Jeddah", "jeddah"],
  ["stated Dubai", "Location: Dubai, United Arab Emirates", "foreign"],
  ["stated Bangalore", "Work location: Bangalore, India", "foreign"],
  ["Arabic, Riyadh", "موقع العمل: الرياض", "riyadh"],
  ["Arabic, Cairo", "مكان العمل: القاهرة", "foreign"],
  ["genuinely says nothing", "We are hiring a security analyst. Competitive salary and benefits.", "unknown"],
  ["boilerplate TBD is not a place", "Location: TBD. Great team, flexible hours.", "unknown"],
  ["Riyadh mentioned in prose, no statement", "Our Riyadh office is growing and we want you on the team.", "riyadh"],

  /*
   * Listing snippets that name their location without labelling it. These are
   * the shape the browser adapter stores when a board shows title, place and
   * date in one row, and every one of them used to come back "not stated".
   */
  ["Lenovo listing row", "Software Engineer Software Engineering Romania, Bucharest Req #: WD00100666 Posted 25-Aug-2026", "foreign"],
  ["Jacobs listing row", "Senior Instrumentation and Controls Engineer Conshohocken, Pennsylvania, United States | 44764 | Life Science | Electrical", "foreign"],
  ["Accenture bulletFields row", "Sales Capture Lead Sao Paulo, Torre Paineira", "foreign"],

  /*
   * The two ways a raw body scan gets it wrong, both found in stored rows
   * before they were ever deleted.
   */
  [
    "Apache Phoenix is not Phoenix, Arizona",
    "Senior SRE Engineer (MLOps). You will run our data platform on Kafka, Spark and Apache Phoenix, with Terraform and ArgoCD.",
    "unknown",
  ],
  [
    "a footer listing every country the employer operates in is not a location",
    "We are hiring a Cloud Engineer. Our offices: Argentina, Australia, Austria, Belgium, Bulgaria, Canada, China, Czech Republic, Denmark, Finland, France, Germany, Greece, Hungary, India, Indonesia, Ireland, Italy, Japan, Korea, Malaysia, Mexico, Netherlands, New Zealand, Norway, Philippines, Poland, Portugal, Singapore, Spain, Sweden, Switzerland, Thailand, United Kingdom, United States, Vietnam.",
    "unknown",
  ],
  [
    "a single clear foreign location is still read",
    "Cloud Engineer. You will be based in our Bangalore, India development centre.",
    "foreign",
  ],
  ["unlabelled Riyadh row still wins", "Security Analyst Riyadh, Saudi Arabia Req #: 4412 Posted 25-Aug-2026", "riyadh"],
  [
    "a foreign city in prose does NOT beat Saudi evidence",
    "You will join our Riyadh team, reporting into the London office.",
    "riyadh",
  ],
  [
    "an unrecognised place stays unknown rather than being guessed at",
    "Praktik pa Siemens Energy i Finspang",
    "unknown",
  ],
];

let bad = 0;
for (const [name, body, want] of CASES) {
  const got = detectCity("", body);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(46)} -> ${got}${ok ? "" : `  (wanted ${want})`}`);
  if (!ok) console.log(`          stated: ${JSON.stringify(statedLocations(body))}`);
}

/** URLs that name their own country, which is the cheapest signal there is. */
const URL_CASES: Array<[string, string, string]> = [
  ["DXC Singapore", "https://careers.dxc.com/job/23802738/servicenow-solutions-architect-singapore-sg/", "foreign"],
  ["DXC Philippines", "https://careers.dxc.com/job/23802498/associate-manager-infra-taguig-city-ph/", "foreign"],
  ["DXC Spain", "https://careers.dxc.com/job/23805979/mainframe-network-lead-las-rozas-es/", "foreign"],
  ["DXC Riyadh", "https://careers.dxc.com/job/1234/security-analyst-riyadh-sa/", "riyadh"],
  ["no country in the slug", "https://careers.example.com/jobs/security-analyst", "unknown"],
  ["city in the path", "https://careers.example.com/job/riyadh/security-analyst", "riyadh"],
];

for (const [name, url, want] of URL_CASES) {
  const got = detectCity("", "", url);
  const ok = got === want;
  if (!ok) bad++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name.padEnd(46)} -> ${got}${ok ? "" : `  (wanted ${want})`}`);
}
console.log(bad === 0 ? `\nall ${CASES.length} correct` : `\n${bad} wrong`);
process.exit(bad === 0 ? 0 : 1);
