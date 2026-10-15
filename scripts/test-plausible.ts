/**
 * Regression cases for the "is this actually a job posting?" judge.
 *
 * Every entry here is real: the rejects were found sitting in the database as
 * job postings, and the keeps are titles an earlier version of the rules threw
 * away. The judge has been tightened five times now, and each tightening broke
 * something legitimate - "Read-Across Toxicologist" died to a rule about
 * "Read more about...", "Bachelor Degree Programme Coordinator" to a rule about
 * degree programmes, "Data Privacy Engineer" to one about privacy notices.
 *
 * So both directions are asserted. A filter that only proves it catches junk is
 * half a filter.
 *
 *   npm run test:plausible
 */
import { judgePosting } from "../src/lib/plausible";

/** Found in the database, none of them a vacancy. */
const MUST_REJECT: Array<[string, string]> = [
  /*
   * Every one of these was on the board, under a real employer's name, and
   * was reported as a job. Grouped by what they actually are.
   */
  // Policy and legal pages (Worley, Alstom, Google Cloud Saudi, DGDA).
  ["Employee privacy notice", "Worley - a PDF of their privacy notice"],
  ["Pay transparency policy statement", "Worley"],
  ["Candidate data privacy", "Alstom"],
  ["Google's EEO Policy", "Google Cloud Saudi"],
  ["[DGDA] Nav Menu Item Terms And Conditions [en]", "Diriyah Gate - says what it is"],
  ["[DGDA] Nav Menu Item Cookie Policy [en]", "Diriyah Gate"],

  // Navigation and about pages (AECOM, Ejada, IBM, BCG, SAP).
  ["Career Paths", "AECOM"],
  ["Military / Veteran", "AECOM"],
  ["Welcoming Workplace", "AECOM"],
  ["Candidate FAQ", "AECOM"],
  ["About Ejada", "Ejada Systems, three copies of it"],
  ["Contact IBM", "IBM - and it reached HashiCorp too"],
  ["Careers in AI", "Boston Consulting Group"],
  ["Career areas", "Accenture"],
  ["Dremio careers", "SAP"],
  ["Legal and Risk jobs search", "Boston Consulting Group"],
  ["Employee network groups", "SAP"],

  // Marketing collateral (Cohesity - twenty-seven of these).
  ["GigaOm Radar for Unstructured Data Management", "Cohesity"],
  ["Your guide to selecting an AI-powered data security platform", "Cohesity"],
  ["3 must haves to effectively manage data in the cloud", "Cohesity"],
  ["ESG Research Report: Data protection and cloud strategies at a crossroads", "Cohesity"],
  ["Gartner Critical Capabilities for Enterprise Backup and Recovery Software Solutions", "Cohesity"],
  // Controls a repeated-block reader mistook for postings on HCLTech's board.
  ["View Profile", "a control, not a vacancy"],
  ["Save Job", "a control, not a vacancy"],
  ["Explore Job Opportunities", "a heading, not a vacancy"],
  ["Find Your Best Path", "a heading, not a vacancy"],
  ["Back to search", "a control, not a vacancy"],
  ["affinity", "Adobe cookie name, Deloitte"],
  ["apiDomain_XXXXXX", "cookie name"],
  ["TEST_AMCV_COOKIE_WRITE", "cookie name, seen at 26 employers"],
  ["AWSALBTG", "load-balancer cookie"],
  ["ARRAffinitySameSite", "Azure cookie"],
  ["__CT_Data", "tracking identifier"],
  ["pys_utm_campaign", "tracking identifier"],
  ["_ga", "analytics cookie"],
  ["engineering", "department heading, Northrop"],
  ["Privacy Policy", "legal page"],
  ["Red Hat Candidate Privacy Notice", "candidate legal notice"],
  ["Terms of Use", "legal page"],
  ["Français", "language switch"],
  ["View all jobs", "navigation"],
  ["Search jobs", "navigation"],
  ["Learn more about cybersecurity", "marketing article, CyberArk"],
  ["10 Things to Know About Incident Response Careers", "blog article"],
  ["From LEAP to Program Management: Shaping Cyber Leaders", "blog article"],
  ["How to Become a Cloud Engineer", "blog article"],
  ["What is Zero Trust?", "blog article"],
  ["A day in the life of an analyst", "culture page"],
  ["IT & Cybersecurity", "field heading, Dell"],
  ["Data & Analytics", "field heading"],
  ["Join Talent Community", "mailing-list signup, HPE"],
  ["Our community impact", "CSR page, Ma'aden"],
  ["Master of Science in Supply Chain Management", "degree programme, KFUPM"],
  ["أمين مكتبة Position filled", "already filled"],
  ["Position Closed", "already filled"],
  ["No longer accepting applications", "already closed"],
  // Arabic, all found on government careers pages alongside real vacancies.
  ["عام الذكاء الاصطناعي", "campaign name — Year of AI, SDAIA"],
  ["الإطار الوطني للمعايير المهنية للبيانات والذكاء الاصطناعي", "a published framework"],
  ["نشرة الذكاء الاصطناعي", "a newsletter"],
  ["الدعم الفني", "site section — technical support"],
  ["التحول الرقمي", "site section — digital transformation"],
  ["التقنية والهندسة", "site section — technology and engineering"],
  ["الاستراتيجية الوطنية للبيانات والذكاء الاصطناعي", "a national strategy document"],
  ["الهيئة تستطلع آراء العموم حول مسودة وثيقة الضوابط", "press release, NCA"],
  ["رأيكم يهمنا لتطوير الخدمات الرقمية لمنصة وزارة السياحة", "a feedback survey"],
  ["هيئة الحكومة الرقمية", "an organisation name"],
  ["حق الوصول إلى المعلومات", "a policy page"],
  ["برنامج الابتعاث في الذكاء الاصطناعي", "a scholarship programme"],
  // Institution names, from dropdowns and department lists read as vacancies.
  ["Al Yamamah University", "an option in Almarai's university dropdown"],
  ["Alfaisal University", "same dropdown"],
  ["Dar Al Uloom University", "same dropdown"],
  ["University / College", "the dropdown's own label"],
  ["College of Engineering", "Alfaisal, a faculty not a job"],
  ["College of Engineering & Architecture", "Al Yamamah"],
  ["Research Ethics Unit", "Princess Nourah department"],
  ["Research Services Unit", "Princess Nourah department"],
  ["Humanities Colleges", "Princess Nourah department"],
  ["Alfaisal University Preparatory Program", "a programme, not a role"],
  // Page furniture.
  ["Skip to main content", "the accessibility link, read as a job at stc"],
  ["Job Opportunities", "the heading above the list, Red Sea Global"],
  ["Employee Benefits", "a marketing panel, Saudi National Bank"],
  ["Tips from our Recruiters", "a marketing panel, Saudi National Bank"],
  ["Current Openings", "a heading"],
  // Advertised in another market.
  ["Electrical Engineer (電気系エンジニア)", "SABIC, posted in Japanese"],
  ["Mechanical Engineer (機械系エンジニア)", "SABIC, posted in Japanese"],
  ["AI 算法专家", "Siemens Energy, posted in Chinese"],

  // Cookie banners and buttons the user found on the board as "jobs"
  // (2026-10-13). The old cookie rule read only the description.
  ["Accept All Cookies", "consent banner button"],
  ["Reject All", "consent banner button"],
  ["Manage Preferences", "consent banner button"],
  ["Cookie Settings", "consent banner link"],
  ["Your Privacy Choices", "consent banner link"],
  ["Do Not Sell My Personal Information", "US privacy footer link"],
  ["Follow us on LinkedIn", "social link beside the job list"],
  ["Apply now", "the apply button, read as a posting"],
  ["Apply nowApply now", "screen-reader text doubled into one title (seen on the board)"],
  ["Click here", "link text"],
  ["Learn More", "link text"],
  ["View all jobs", "link back to the list"],
  ["Share this job", "share widget"],
  ["Strictly necessary cookies", "cookie category heading"],
];

/**
 * Two-signal rules: the title alone is not enough, title plus description or
 * URL is. [title, description, url, why].
 */
const MUST_REJECT_CTX: Array<[string, string, string, string]> = [
  ["Ahmed Al-Harbi", "", "https://example.com/about/leadership/ahmed-al-harbi", "leadership profile collected as a posting"],
  ["Sara Abdullah", "Sara joined the company in 2019 and serves as Head of Digital Transformation.", "https://example.com/careers/sara-abdullah", "a biography, not a vacancy"],
  ["Khalid Bin Saeed", "", "https://example.com/our-team/khalid", "team page profile"],
];

const MUST_KEEP_CTX: Array<[string, string, string, string]> = [
  ["OT Incident Response", "Responsibilities: lead incident response in ICS environments.", "https://www.accenture.com/sa-en/careers/jobdetails?id=R00123", "Accenture: a real posting whose title names no role (HANDOVER §6)"],
  ["Delivery Excellence", "Responsibilities: run delivery reviews. Requirements: 3 years of experience.", "https://example.com/jobs/12345", "name-shaped title on a vacancy URL with vacancy text - one signal only"],
  ["Noura Alqahtani", "", "https://example.com/jobs/98765", "name-shaped but no second signal: kept rather than risk a real role"],
  ["Consent Management Specialist", "Run the OneTrust consent platform.", "https://example.com/jobs/1", "a privacy-tech role that contains 'consent'"],
];

/** Real vacancies, several of which a previous rule wrongly rejected. */
const MUST_KEEP: Array<[string, string]> = [
  // Near misses: real vacancies whose wording overlaps the rules above.
  ["Data Privacy Engineer", "the policy rule matches \"data privacy\" inside it"],
  ["Privacy Program Manager", "same trap"],
  ["Career Coach", "near the career-page labels"],
  ["Senior Regional Services Partner - MENA", "Elastic - a partner is a role"],
  ["Technical Writer - White Paper Team", "near the marketing rule"],
  ["Cloud Security Engineer", "ordinary"],
  ["Senior SOC Analyst", "ordinary"],
  ["Engineer", "single word, but a role"],
  ["Co-op Trainee — Information Security", "co-op"],
  ["Cybersecurity Consultant (Intern to FTE Program)", "internship"],
  ["Data Privacy Engineer", "killed by an early privacy rule"],
  ["Privacy Counsel", "killed by an early privacy rule"],
  ["Read-Across Toxicologist", "killed by the 'Read more' rule"],
  ["Bachelor Degree Programme Coordinator", "killed by the degree rule"],
  ["Senior Talent Acquisition Specialist", "killed by the talent-community rule"],
  ["Community Manager", "killed by the 'our community' rule"],
  ["Master Data Analyst", "killed by the degree rule"],
  ["Position Control Analyst", "contains 'position'"],
  ["IT & Cybersecurity Manager", "heading plus a role word"],
  ["Head of Data & Analytics", "heading plus a role word"],
  ["مهندس أمن سيبراني", "Arabic title"],
  ["محلل نظم", "Arabic title"],
  ["Trust & Safety New Associate – English Support | Fresh Grads Welcome", "long, punctuated"],
  ["SAP FICO / JVA Consultant – Oil & Gas", "slashes and dashes"],
  ["Engineer_Level II", "underscore in a real title"],
  ["Full-Stack Developer (React/Node)", "parentheses"],
  ["Network Administrator - Level 2", "ordinary"],
  // Arabic vacancies must survive the rule that removes the headlines above.
  ["أخصائي دعم تقنية المعلومات", "IT support specialist — the one real Arabic job found"],
  ["مهندس أمن سيبراني", "cybersecurity engineer"],
  ["محلل نظم", "systems analyst"],
  ["مدير تقنية المعلومات", "IT manager"],
  ["متدرب تعاوني - الأمن السيبراني", "co-op trainee"],
  ["فني شبكات", "network technician"],
  ["COOP Training التدريب التعاوني", "mixed script, co-op listing"],
  // Real roles that mention an institution or a department must survive.
  ["Lecturer, Alfaisal University", "a role AT an institution"],
  ["IT Support Specialist - College of Engineering", "a role in a faculty"],
  ["Systems Administrator, Research Unit", "a role in a department"],
  ["Head of Institutional Research", "a real role"],
  ["Program Manager", "a real role despite the word 'program'"],
];

function main(): void {
  let failures = 0;

  console.log(`\nMust be rejected (${MUST_REJECT.length})\n`);
  for (const [title, why] of MUST_REJECT) {
    const r = judgePosting(title);
    if (r.ok) {
      console.log(`  LEAK  "${title}"  — ${why}`);
      failures++;
    }
  }
  console.log(`  ${MUST_REJECT.length - failures}/${MUST_REJECT.length} rejected`);

  const before = failures;
  console.log(`\nMust be kept (${MUST_KEEP.length})\n`);
  for (const [title, why] of MUST_KEEP) {
    const r = judgePosting(title);
    if (!r.ok) {
      console.log(`  LOST  "${title}"  — ${why}  (rejected as: ${r.reason})`);
      failures++;
    }
  }
  console.log(`  ${MUST_KEEP.length - (failures - before)}/${MUST_KEEP.length} kept`);

  console.log(`\nTwo-signal cases (${MUST_REJECT_CTX.length + MUST_KEEP_CTX.length})\n`);
  for (const [title, desc, url, why] of MUST_REJECT_CTX) {
    if (judgePosting(title, desc, url).ok) {
      console.log(`  LEAK  "${title}" @ ${url}  — ${why}`);
      failures++;
    }
  }
  for (const [title, desc, url, why] of MUST_KEEP_CTX) {
    const r = judgePosting(title, desc, url);
    if (!r.ok) {
      console.log(`  LOST  "${title}" @ ${url}  — ${why}  (rejected as: ${r.reason})`);
      failures++;
    }
  }

  const total = MUST_REJECT.length + MUST_KEEP.length + MUST_REJECT_CTX.length + MUST_KEEP_CTX.length;
  console.log(
    failures === 0
      ? `\nall ${total} cases correct`
      : `\n${failures} case(s) wrong`,
  );
  if (failures > 0) process.exit(1);
}

main();
