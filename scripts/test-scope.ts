/**
 * Cybersecurity / cloud scope. Zero network, zero database.
 *
 *   npm run test:scope
 *
 * The rules (user, 2026-10-13): security and cloud only, judged from the whole
 * posting. DevOps/SRE/Platform out (owner, 2026-10-21); network roles only with
 * security duties. Out: IT audit, data/AI roles that merely use cloud, IT
 * support, software development, and selling security. Unclear -> Unclassified.
 *
 * Each case names the real posting or rule it exists for. A wrong "out" hides
 * a real job, so "decisive out" is asserted only where two signals agree.
 */
import { judgeScope, type TextQuality } from "../src/lib/scope";

type Want = { verdict: "in" | "out" | "unclear"; confidence?: "decisive" | "leaning"; scope?: string | null; focus?: string };

const SOC_DUTIES =
  "Responsibilities: Monitor SIEM alerts in Splunk and triage security incidents. Perform incident response and escalate according to playbooks. Tune use cases and correlation rules. Requirements: knowledge of EDR and MITRE ATT&CK.";
const GRC_DUTIES =
  "Responsibilities: Maintain the ISMS and ISO 27001 certification. Assess compliance with NCA ECC and SAMA CSF. Write security policies and run security risk assessments.";
const CLOUD_DUTIES =
  "Responsibilities: Build and operate workloads on AWS and Azure. Manage EKS and AKS clusters with Terraform. Design landing zones and lead cloud migration projects.";
const DEVOPS_NO_CLOUD =
  "Responsibilities: Maintain Jenkins pipelines for on-premise applications. Write Bash scripts and manage Linux servers in our data center. Support release management.";
const NETWORK_SEC_DUTIES =
  "Responsibilities: Configure and manage Palo Alto and Fortinet firewalls. Operate IDS/IPS, VPN and NAC. Implement network segmentation and zero trust access.";
const NETWORK_PLAIN =
  "Responsibilities: Configure Cisco switches and routers, manage BGP and OSPF routing, maintain the LAN and WAN, and troubleshoot connectivity for branch offices.";
const SALES_DUTIES =
  "Responsibilities: Own a sales quota for our cybersecurity portfolio. Build pipeline with enterprise customers and close deals. Partner with presales on SIEM and EDR demos.";
const DATA_ON_CLOUD =
  "Responsibilities: Build ETL pipelines in Azure Data Factory and Databricks. Model data in Synapse and Power BI. Deploy to AWS S3 and Lambda.";
const BOILERPLATE_SECURITY_COMPANY =
  "About us: We are a leading cybersecurity company providing SOC and penetration testing services across the Kingdom. Responsibilities: Answer phone calls, greet visitors, manage meeting rooms and office supplies.";

const CASES: Array<[string, string, string, TextQuality, Want]> = [
  /* ---- security, decisive ------------------------------------------------- */
  ["SOC analyst with SOC duties", "SOC Analyst - Tier 1", SOC_DUTIES, "full", { verdict: "in", confidence: "decisive", scope: "security", focus: "SOC" }],
  ["cybersecurity specialist", "Cybersecurity Specialist", SOC_DUTIES, "full", { verdict: "in", confidence: "decisive" }],
  ["Arabic cybersecurity title", "أخصائي أمن سيبراني", "المهام: مراقبة التنبيهات الأمنية والاستجابة للحوادث الأمنية. الامتثال للضوابط الأساسية للأمن السيبراني والهيئة الوطنية للأمن السيبراني.", "full", { verdict: "in", confidence: "decisive", scope: "security" }],
  ["penetration tester", "Penetration Tester", "Perform penetration testing of web applications using Burp Suite and Metasploit. Report vulnerabilities following OWASP.", "full", { verdict: "in", confidence: "decisive", focus: "Pentest" }],
  ["IAM engineer", "IAM Engineer", "Administer CyberArk privileged access and SailPoint identity governance. Enforce MFA.", "full", { verdict: "in", confidence: "decisive", focus: "IAM" }],
  ["Accenture OT Incident Response (HANDOVER §6)", "OT Incident Response", "Lead incident response for ICS and SCADA environments under IEC 62443. Perform digital forensics.", "full", { verdict: "in", confidence: "decisive" }],
  ["DevSecOps engineer", "DevSecOps Engineer", "Integrate SAST and DAST into CI/CD. Run secure code review and container scanning on Kubernetes.", "full", { verdict: "in", confidence: "decisive" }],
  ["cloud security engineer -> both", "Cloud Security Engineer", `${CLOUD_DUTIES} Implement CSPM and security controls.`, "full", { verdict: "in", confidence: "decisive", scope: "both" }],
  ["data security analyst is security, not data", "Data Security Analyst", "Operate DLP and data loss prevention controls, classify data, investigate security incidents.", "full", { verdict: "in", confidence: "decisive", scope: "security" }],

  /* ---- security without the word ------------------------------------------ */
  ["GRC specialist with cyber frameworks", "GRC Specialist", GRC_DUTIES, "full", { verdict: "in", confidence: "leaning", scope: "security", focus: "GRC" }],
  ["generic title, security duties", "Specialist II", SOC_DUTIES, "full", { verdict: "in", confidence: "leaning", scope: "security" }],
  ["detection engineer", "Detection Engineer", SOC_DUTIES, "full", { verdict: "in", confidence: "decisive" }],

  /* ---- cloud ----------------------------------------------------------------- */
  ["cloud engineer", "Cloud Engineer", CLOUD_DUTIES, "full", { verdict: "in", confidence: "decisive", scope: "cloud", focus: "Cloud" }],
  ["Arabic cloud title", "مهندس حوسبة سحابية", "المهام: إدارة خدمات AWS و Azure وبناء البنية باستخدام Terraform و Kubernetes.", "full", { verdict: "in", confidence: "decisive", scope: "cloud" }],
  ["generic title, cloud duties", "Engineer", CLOUD_DUTIES, "full", { verdict: "in", confidence: "leaning", scope: "cloud" }],

  /* ---- DevOps / SRE / platform: out by the owner's choice (2026-10-21) ------- */
  ["DevOps with cloud duties is still out", "DevOps Engineer", CLOUD_DUTIES, "full", { verdict: "out", confidence: "decisive" }],
  ["SRE with cloud duties is still out", "Site Reliability Engineer", CLOUD_DUTIES, "full", { verdict: "out", confidence: "decisive" }],
  ["platform engineer is out", "Platform Engineer", CLOUD_DUTIES, "full", { verdict: "out", confidence: "decisive" }],
  ["DevOps without cloud", "DevOps Engineer", DEVOPS_NO_CLOUD, "full", { verdict: "out", confidence: "decisive" }],
  ["DevOps snippet is out too", "Senior DevOps Engineer", "Kubernetes and CI/CD.", "snippet", { verdict: "out", confidence: "decisive" }],
  ["Azure DevOps is a pipeline tool, not cloud work", "Azure DevOps Engineer", DEVOPS_NO_CLOUD, "full", { verdict: "out", confidence: "decisive" }],
  ["must stay in: DevSecOps is security", "DevSecOps Engineer", "Integrate SAST and DAST into CI/CD pipelines and run container scanning.", "full", { verdict: "in" }],
  ["must stay in: a cloud title with DevOps in it", "Cloud DevOps Engineer (AWS)", CLOUD_DUTIES, "full", { verdict: "in", scope: "cloud" }],
  ["must stay in: cloud security with platform in it", "Cloud Security Platform Engineer", `${CLOUD_DUTIES} Implement CSPM and security controls.`, "full", { verdict: "in" }],

  /* ---- conditional families ------------------------------------------------- */
  ["infrastructure engineer with cloud duties", "Infrastructure Engineer", CLOUD_DUTIES, "full", { verdict: "in", confidence: "decisive", scope: "cloud" }],
  ["system administrator without cloud", "System Administrator", DEVOPS_NO_CLOUD, "full", { verdict: "out", confidence: "leaning" }],
  ["network engineer with security duties", "Network Engineer", NETWORK_SEC_DUTIES, "full", { verdict: "in", confidence: "decisive", scope: "security", focus: "Network Security" }],
  ["network engineer, routing only", "Network Engineer", NETWORK_PLAIN, "full", { verdict: "out", confidence: "leaning" }],
  ["network engineer, snippet only -> unclear", "Network Engineer", "Configure firewalls for branches.", "snippet", { verdict: "unclear" }],

  /* ---- excluded families ------------------------------------------------------ */
  ["CyberArk Major Account Manager (CLAUDE.md rule 5)", "Major Account Manager", SALES_DUTIES, "full", { verdict: "out", confidence: "decisive" }],
  ["GitLab Strategic Account Executive", "Strategic Account Executive - MENA", SALES_DUTIES, "full", { verdict: "out", confidence: "decisive" }],
  ["data engineer on Azure is a data job", "Data Engineer", DATA_ON_CLOUD, "full", { verdict: "out", confidence: "decisive" }],
  ["AI engineer", "AI Engineer", "Train and deploy machine learning models on AWS SageMaker.", "full", { verdict: "out" }],
  ["software engineer", "Software Engineer", "Build REST APIs in Java and React front ends. Deploy to Kubernetes.", "full", { verdict: "out" }],
  ["full stack .NET developer", "Full Stack .NET Developer", "Develop web applications with .NET and Angular.", "full", { verdict: "out", confidence: "decisive" }],
  ["IT support", "IT Support Specialist", "Resolve end-user tickets, install software, manage printers.", "full", { verdict: "out", confidence: "decisive" }],
  ["IT auditor", "IT Auditor", "Test ITGC and SOX controls, document audit findings.", "full", { verdict: "out" }],
  ["Qiddiya procurement compliance audit (HANDOVER §6)", "Senior Manager - Procurement Compliance Audit", "Audit procurement processes and vendor compliance.", "full", { verdict: "out" }],
  ["credit risk analyst", "Credit Risk Analyst", "Assess credit exposure and model probability of default.", "full", { verdict: "out" }],
  ["AML compliance", "AML Compliance Officer", "Monitor transactions for money laundering.", "full", { verdict: "out" }],
  ["physical security guard", "Security Guard", "Patrol the premises and monitor CCTV.", "full", { verdict: "out" }],
  ["receptionist at a security company", "Receptionist", BOILERPLATE_SECURITY_COMPANY, "full", { verdict: "out", confidence: "decisive" }],
  ["project manager", "IT Project Manager", "Manage project plans, budgets and stakeholders.", "full", { verdict: "out" }],
  ["ERP consultant", "SAP FICO Consultant", "Configure SAP finance modules.", "full", { verdict: "out" }],
  ["mechanical engineer", "Mechanical Engineer", "Design HVAC systems.", "full", { verdict: "out", confidence: "decisive" }],

  /* ---- excluded title but security duties -> a question, not an answer --------- */
  ["QA with heavy security testing", "QA Engineer", "Perform penetration testing, DAST and SAST, OWASP top 10 verification and vulnerability assessment.", "full", { verdict: "unclear" }],
  ["security title beats developer word", "Application Security Developer", "Run SAST and secure code review; triage OWASP findings.", "full", { verdict: "in" }],

  /* ---- GRC vocabulary without cyber content ------------------------------------- */
  ["governance with no cyber terms", "Governance Specialist", "Prepare board packs and corporate governance reports.", "full", { verdict: "out", confidence: "leaning" }],
  ["risk manager, one cyber term -> unclear", "Risk Manager", "Maintain the enterprise risk register including cyber risk.", "full", { verdict: "unclear" }],

  /* ---- snippets are never decisive ------------------------------------------------ */
  ["security title, snippet", "SOC Analyst", "Monitor SIEM alerts.", "snippet", { verdict: "in", confidence: "leaning" }],
  ["cloud title, snippet", "Cloud Engineer", "AWS and Terraform.", "snippet", { verdict: "in", confidence: "leaning" }],
  ["sales title, snippet", "Account Manager", "Sell security products.", "snippet", { verdict: "out", confidence: "leaning" }],
  ["generic title, snippet", "Consultant", "Join our team.", "snippet", { verdict: "unclear" }],

  /* ---- boilerplate is not evidence ------------------------------------------------ */
  ["generic role at a security company is not security", "Office Coordinator", BOILERPLATE_SECURITY_COMPANY, "full", { verdict: "out" }],
  ["cloud kitchen", "Cloud Kitchen Supervisor", "Run the cloud kitchen.", "full", { verdict: "out" }],
  ["marketing cloud developer", "Salesforce Marketing Cloud Developer", "Build journeys in Marketing Cloud.", "full", { verdict: "out" }],

  /* ---- found on the live board, 2026-10-13 ---------------------------------- */
  ["AWS data center facility engineer is building work", "Data Center Facility Engineer (Controls), AWS", "Maintain BMS controls, chillers and electrical systems across AWS data centers. Work with HVAC vendors.", "full", { verdict: "out" }],
  ["security managed services title", "Security Managed Services Associate Manager", SOC_DUTIES, "full", { verdict: "in", confidence: "decisive" }],
  ["partner sales director", "Director, Strategic Partnerships & Partner Sales", SALES_DUTIES, "full", { verdict: "out", confidence: "decisive" }],
  ["Qiddiya airfield pavement engineer", "Pavement Lead Engineer - Airfield Infrastructure", "Design airfield pavement.", "full", { verdict: "out" }],
  ["SEO specialist", "Senior SEO, Organic Growth & Website Experience Specialist", "Improve organic search rankings.", "full", { verdict: "out" }],
  ["rail cybersecurity stays security", "Rail Cybersecurity Engineer", SOC_DUTIES, "full", { verdict: "in", confidence: "decisive" }],
  ["sales engineer is technical (relevance.ts TECHNICAL_ANYWAY)", "Cybersecurity Sales Engineer", SOC_DUTIES, "full", { verdict: "in" }],
  ["software engineering intern", "Software Engineering Intern", "Build features in React and Node.js.", "full", { verdict: "out" }],
  ["data engineering manager", "Data Engineering Manager II", "Lead the data platform team building pipelines on AWS.", "full", { verdict: "out" }],
  ["customer support intern", "Customer Support Intern (TechOps)", "Answer customer tickets and escalate issues.", "full", { verdict: "out" }],

  /* ---- physical security is not cybersecurity (user, 2026-10-21) ---------- */
  ["Amazon physical security intern", "(Physical) Security Specialist Intern - 2027 Internship", "Support physical security operations at our sites: access badges, guard tours, incident reports.", "full", { verdict: "out", confidence: "decisive" }],
  ["Sabbar physical security specialist", "(Physical) Security Specialist", "Physical security programme for data centre buildings.", "full", { verdict: "out", confidence: "decisive" }],
  ["Ritz-Carlton loss prevention", "Loss Prevention Officer (Security Officer)", "Patrol the hotel and monitor CCTV.", "snippet", { verdict: "out", confidence: "decisive" }],
  ["DIKTUCOM CCTV manufacturing", "CCTV Manufacturing Expert, project in a Saudi Arabian Tech Company, Riyadh", "Manufacturing of CCTV cameras.", "snippet", { verdict: "out", confidence: "decisive" }],
  ["Arabic security guard", "حارس أمن", "حراسة المنشأة", "full", { verdict: "out", confidence: "decisive" }],
  ["must stay in: a cyber title beside a physical one", "Physical & Cyber Security Lead", SOC_DUTIES, "full", { verdict: "in" }],
  ["must stay in: security officer of information", "Information Security Officer", SOC_DUTIES, "full", { verdict: "in", confidence: "decisive" }],
];

let failures = 0;
for (const [name, title, body, quality, want] of CASES) {
  const got = judgeScope(title, null, body, quality);
  const problems: string[] = [];
  if (got.verdict !== want.verdict) problems.push(`verdict ${got.verdict} != ${want.verdict}`);
  if (want.confidence && got.confidence !== want.confidence) problems.push(`confidence ${got.confidence} != ${want.confidence}`);
  if (want.scope !== undefined && got.scope !== want.scope) problems.push(`scope ${got.scope} != ${want.scope}`);
  if (want.focus && !got.focus.includes(want.focus as never)) problems.push(`focus [${got.focus}] lacks ${want.focus}`);
  if (got.verdict === "in" && got.evidence.length === 0 && quality === "full") problems.push("in without evidence");
  if (problems.length) {
    failures++;
    console.log(`FAIL  ${name}\n      ${problems.join("; ")}\n      reason: ${got.reason}; sec=[${got.securityTerms}] cloud=[${got.cloudTerms}]`);
  }
}
console.log(`\nscope: ${CASES.length - failures}/${CASES.length} correct`);
if (failures > 0) process.exit(1);
