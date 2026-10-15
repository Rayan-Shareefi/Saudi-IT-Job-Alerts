/**
 * Regression cases for "is this a technology role?"
 *
 * Every rejected title below was sitting on the board. The old test matched
 * substrings like "engineer", "digital", "system" and "analyst", which in a
 * market this heavy with oil, construction and industrial work meant two thirds
 * of the board was not IT.
 *
 * The kept list matters just as much: this is a Riyadh IT board, and losing a
 * real security or cloud role to an over-eager filter is the expensive failure.
 *
 *   npm run test:relevance
 */
import { judgeRelevance } from "../src/lib/relevance";

/** Found on the board, none of them an IT role. */
const MUST_REJECT: Array<[string, string]> = [
  ["Equity Research Analyst", "the role the equity rule is actually for"],
  // Selling technology at a technology company. Every one of these was on the
  // board, most of them filed under Unclassified.
  ["Major Account Manager", "CyberArk - reads as cybersecurity to a keyword count"],
  ["Strategic Account Executive - MENA", "GitLab"],
  ["Commercial Account Executive (Saudi Arabia)", "Datadog"],
  ["Partner Manager", "ServiceNow"],
  ["Key Account Manager", "Unifonic"],
  ["Trade Director", "webook"],
  ["Security Services Sales Specialist", "NTT Data - the product is security, the job is sales"],
  ["Sales Representative - Cybersecurity SaaS", "Beyondtrust"],
  ["B2B IT Field Sales Representative", "IDSCCC"],
  ["Business Development Executive-IT & CYBERSECURITY", "ValueMentor"],
  ["Mechanical Engineer", "engineering, but not computing"],
  ["Electrical Engineer", "same"],
  ["Coop Mechanical Engineer", "NOV"],
  ["Coop Electrical Engineer", "NOV"],
  ["Coop Maintenance Technician", "NOV"],
  ["Field Service Engineer", "NOV"],
  ["Repair Engineer", "NOV"],
  ["Process Engineer", "Lucid Motors"],
  ["CAD Engineer", "drafting, not software"],
  ["Electrical Repair Technician", "Lucid Motors"],
  ["Sr. Dimensional Quality Technician", "Lucid Motors"],
  ["Incoming Quality Sr. Supervisor", "Lucid Motors"],
  ["Maintenance Planner", "Lucid Motors"],
  ["Supervisor, High Pressure Maintenance", "SABIC"],
  ["Senior Manager, Asset Engineering", "SABIC"],
  ["Assistant Area Maintenance Engineer (Mechanical)", "SABIC"],
  ["Director - Architecture - Hospitality - 20013111 HS8", "Qiddiya, hospitality"],
  ["Senior Manager - Development - Hospitality", "Qiddiya"],
  ["Equity Capital Markets", "Alrajhi Capital"],
  ["Debt Capital Markets", "Alrajhi Capital"],
  ["Digital Marketing Manager", "marketing, not IT"],
  ["Specialist - Reception and Retail", "Red Sea Global"],
  ["Specialist - Admin and Business Support", "Red Sea Global"],
  ["Manager - Maintenance and Operations Support", "Red Sea Global"],
  ["Senior Manager - Logistics Systems", "logistics"],
  ["Engineer - BIM", "construction modelling"],
  ["Land Surveyor (Irrigation & Landscaping)", "surveying"],
  ["Senior Sales Engineer", "sales"],
  ["Analyst - Workplace Operations", "facilities"],
  ["Assistant Manager - Technology Procurement", "procurement"],
  ["Senior Talent Acquisition Specialist", "HR"],
  ["Trust & Safety New Associate – English Support", "content moderation, not IT"],
];

/** Real IT roles, which the filter must not throw away. */
const MUST_KEEP: Array<[string, string]> = [
  // Technical roles that sit on the commercial side. A sales engineer builds
  // the demo and answers the architecture questions.
  ["Senior Sales Engineer - Cloud Data Protection", "Commvault; the title has to carry its own signal"],
  ["Pre-Sales Engineer ELV (Low Current, Networking & CCTV)", "Aroma City Group"],
  ["Network Applications Engineer / Field Sales Engineer", "Keenfinity"],
  ["Solutions Architect - Cloud", "an architect, whoever they report to"],
  ["Equity Electronic Trading - Network Support Engineer", "Goldman Sachs; equity is the desk, not the profession"],
  ["Cloud Security Engineer", "core"],
  ["Senior SOC Analyst", "core"],
  ["Junior Security Analyst", "core"],
  ["Cyber Security Intern", "core"],
  ["Co-op Trainee — Information Security", "co-op, the point of the board"],
  ["Software Engineer", "core"],
  ["AI Native Software Engineer", "core"],
  ["Full-Stack Developer (React/Node)", "core"],
  ["DevOps Engineer", "core"],
  ["Platform Engineer, Kubernetes", "core"],
  ["Sr. Analyst ICT", "SABIC, genuinely IT"],
  ["Network Administrator - Level 2", "core"],
  ["IT Support Specialist", "core"],
  ["Database Administrator", "core"],
  ["Senior Data Scientist", "core"],
  ["Data Engineer", "core"],
  ["SAP FICO / JVA Consultant – Oil & Gas", "ERP, an IT discipline"],
  ["Senior ServiceNow Developer", "core"],
  ["QMS & GRC Engineer", "governance, risk and compliance"],
  ["Assoc. Security Specialist, SOC", "Lucid Motors, genuinely security"],
  ["Security Coordinator", "kept: security"],
  ["Electrical Engineer - SCADA and Control Systems", "industrial automation, computing-adjacent"],
  ["Digital Transformation Manager", "core"],
  ["أخصائي دعم تقنية المعلومات", "Arabic: IT support specialist"],
  ["مهندس أمن سيبراني", "Arabic: cybersecurity engineer"],
];

function main(): void {
  let failures = 0;

  console.log(`\nMust be rejected (${MUST_REJECT.length})\n`);
  for (const [title, why] of MUST_REJECT) {
    const r = judgeRelevance(title);
    if (r.ok) {
      console.log(`  LEAK  "${title}"  — ${why}`);
      failures++;
    }
  }
  console.log(`  ${MUST_REJECT.length - failures}/${MUST_REJECT.length} rejected`);

  const before = failures;
  console.log(`\nMust be kept (${MUST_KEEP.length})\n`);
  for (const [title, why] of MUST_KEEP) {
    const r = judgeRelevance(title);
    if (!r.ok) {
      console.log(`  LOST  "${title}"  — ${why}  (${r.reason})`);
      failures++;
    }
  }
  console.log(`  ${MUST_KEEP.length - (failures - before)}/${MUST_KEEP.length} kept`);

  // The body fallback, which needs a description to test.
  const IT_PAGE = "Our cloud, cybersecurity and software teams run SIEM, AWS and Kubernetes for clients.";
  const BODY_CASES: Array<[string, string, boolean, string]> = [
    ["Follow us", IT_PAGE, false, "a social link on an IT-dense careers page (2026-10-13)"],
    ["Ahmed Al-Harbi", IT_PAGE, false, "a person's name on an IT-dense careers page"],
    ["Specialist II", IT_PAGE, true, "names a role; the dense page is then evidence"],
  ];
  console.log(`\nBody fallback (${BODY_CASES.length})\n`);
  for (const [title, body, want, why] of BODY_CASES) {
    if (judgeRelevance(title, body).ok !== want) {
      console.log(`  WRONG "${title}" -> ${!want}  — ${why}`);
      failures++;
    }
  }

  console.log(
    failures === 0
      ? `\nall ${MUST_REJECT.length + MUST_KEEP.length + BODY_CASES.length} cases correct`
      : `\n${failures} case(s) wrong`,
  );
  if (failures > 0) process.exit(1);
}

main();
