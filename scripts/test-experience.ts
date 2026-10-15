/**
 * Years-of-experience extraction. Zero network, zero database.
 *
 *   npm run test:experience
 *
 * Built from the phrasings the old first-match-wins regexes missed or misread
 * on the live board (measured 2026-10-13), plus the traps that would hide a
 * real entry-level job if extraction got greedy. A wrong "5+" hides a posting,
 * so the traps matter as much as the hits.
 */
import { detectExperience } from "../src/lib/experience";

interface Want {
  band: string;
  min?: number | null;
  max?: number | null;
  source?: string;
  preferredOnly?: boolean;
  /** A fragment the evidence sentence must contain. */
  evidence?: string;
}

const CASES: Array<[string, string, string, Want]> = [
  /* ---- plain statements ------------------------------------------------ */
  ["range with hyphen", "SOC Analyst", "Requirements: 2-3 years of experience in a SOC.", { band: "1-2", min: 2, max: 3, evidence: "2-3 years" }],
  ["range with 'to'", "SOC Analyst", "You have 2 to 3 years of experience.", { band: "1-2", min: 2, max: 3 }],
  ["range with en dash", "Cloud Engineer", "3–5 years of hands-on AWS experience.", { band: "3-5", min: 3, max: 5 }],
  ["range with tilde", "Cloud Engineer", "Experience: 2~3 years", { band: "1-2", min: 2, max: 3 }],
  ["range in parentheses", "GRC Analyst", "(2-3) years of experience in GRC.", { band: "1-2", min: 2, max: 3 }],
  ["between X and Y", "IAM Engineer", "Between 2 and 4 years of IAM experience.", { band: "1-2", min: 2, max: 4 }],
  ["label then range", "SOC Analyst", "Years of experience: 1-3", { band: "1-2", min: 1, max: 3 }],
  ["N+ years", "Security Engineer", "3+ years of experience with SIEM tools.", { band: "3-5", min: 3 }],
  ["N + years with space", "Security Engineer", "Minimum 4 + years in security engineering", { band: "3-5", min: 4 }],
  ["minimum N years", "Cloud Engineer", "Minimum 3 years experience in cloud.", { band: "3-5", min: 3 }],
  ["minimum of N years", "Cloud Engineer", "A minimum of 2 years of experience is required.", { band: "1-2", min: 2 }],
  ["at least N years", "SOC Analyst", "At least 1 year of experience in security operations.", { band: "1-2", min: 1 }],
  ["no less than N", "SOC Analyst", "No less than 2 years of relevant experience.", { band: "1-2", min: 2 }],
  ["N years or more", "DevOps Engineer", "2 years or more of DevOps experience on Azure.", { band: "1-2", min: 2 }],
  ["N or more years", "DevOps Engineer", "2 or more years working with Kubernetes.", { band: "1-2", min: 2 }],
  ["label then single number", "Penetration Tester", "Years of Experience: 3", { band: "3-5", min: 3 }],
  ["experience required: N", "Penetration Tester", "Experience required: 2 years", { band: "1-2", min: 2 }],

  /* ---- spellings the old code missed ------------------------------------ */
  ["word number with digit in parentheses", "SOC Analyst", "At least two (2) years of experience in incident response.", { band: "1-2", min: 2 }],
  ["word number alone", "SOC Analyst", "Minimum two years of experience.", { band: "1-2", min: 2 }],
  ["professional between years and experience", "GRC Specialist", "3 years of professional experience in GRC.", { band: "3-5", min: 3 }],
  ["work between years and experience", "GRC Specialist", "2 years of work experience in compliance.", { band: "1-2", min: 2 }],
  ["IT-related between years and experience", "Security Analyst", "2 years of IT security related experience.", { band: "1-2", min: 2 }],
  ["apostrophe years'", "Security Analyst", "3 years' experience in vulnerability management.", { band: "3-5", min: 3 }],
  ["curly apostrophe years’", "Security Analyst", "3 years’ experience in vulnerability management.", { band: "3-5", min: 3 }],
  ["hyphenated 3-years", "Cloud Engineer", "3-years experience with AWS.", { band: "3-5", min: 3 }],
  ["years in a role", "SOC Analyst", "2 years in a SOC analyst role.", { band: "1-2", min: 2 }],

  /* ---- Arabic ------------------------------------------------------------ */
  ["Arabic N years experience", "محلل أمن سيبراني", "خبرة 3 سنوات في مجال الأمن السيبراني", { band: "3-5", min: 3 }],
  ["Arabic at least", "محلل أمن سيبراني", "خبرة لا تقل عن 2 سنوات", { band: "1-2", min: 2 }],
  ["Arabic على الأقل (alef maksura)", "محلل أمن سيبراني", "على الأقل 3 سنوات خبرة", { band: "3-5", min: 3 }],
  ["Arabic range من X إلى Y", "مهندس سحابي", "خبرة من 2 إلى 4 سنوات", { band: "1-2", min: 2, max: 4 }],
  ["Arabic-Indic digits", "محلل أمن", "خبرة ٣ سنوات في مركز العمليات الأمنية", { band: "3-5", min: 3 }],
  ["Arabic dual سنتين", "محلل أمن", "خبرة سنتين في الأمن السيبراني", { band: "1-2", min: 2 }],
  ["Arabic number word", "محلل أمن", "خبرة ثلاث سنوات على الأقل", { band: "3-5", min: 3 }],
  ["Arabic N years of experience", "محلل أمن", "3 سنوات من الخبرة في الحوكمة", { band: "3-5", min: 3 }],

  /* ---- choosing among several numbers ---------------------------------- */
  ["required beats preferred", "Security Engineer", "2+ years of experience required. 5 years preferred.", { band: "1-2", min: 2, preferredOnly: false }],
  ["preferred only", "Security Engineer", "5 years of experience preferred.", { band: "3-5", min: 5, preferredOnly: true }],
  ["largest required minimum", "Cloud Engineer", "5+ years of IT experience, including 2 years in AWS.", { band: "3-5", min: 5 }],
  ["degree alternatives take the easier path", "Security Engineer", "Bachelor's degree with 5 years of experience or Master's degree with 3 years of experience.", { band: "3-5", min: 3 }],
  ["bachelor's in the same sentence is not degree length", "SOC Analyst", "Bachelor's degree in Computer Science with 2+ years of experience in a SOC.", { band: "1-2", min: 2 }],

  /* ---- traps: numbers that are not the requirement ---------------------- */
  ["company history before requirement", "SOC Analyst", "We have been serving clients for over 25 years across the region. Requirements: 2+ years of SOC experience.", { band: "1-2", min: 2 }],
  ["company 'with over N years of experience'", "SOC Analyst", "A leading provider with over 30 years of experience in the Kingdom. You will monitor SIEM alerts.", { band: "unknown", source: "none" }],
  ["founded N years ago", "Cloud Engineer", "Founded 20 years ago, we are a cloud company. 1+ years of AWS experience.", { band: "1-2", min: 1 }],
  ["age range", "SOC Analyst", "Saudi national aged 22-30 years. 1-2 years experience in security.", { band: "1-2", min: 1, max: 2 }],
  ["years old", "Trainee", "Applicants must be under 25 years old.", { band: "internship" }],
  ["contract length", "Cloud Engineer", "This is a 2-year contract. 3+ years of experience with Azure.", { band: "3-5", min: 3 }],
  ["degree length", "Graduate Program", "Holders of a 4-year degree in Computer Science. Fresh graduates are welcome.", { band: "0", min: 0 }],
  ["vision year is not experience", "SOC Analyst", "Supporting Vision 2030. 2 years of experience in a SOC.", { band: "1-2", min: 2 }],
  ["GPA is not years", "Cybersecurity Co-op", "GPA 3.5 out of 5. Co-op students only.", { band: "coop" }],
  ["certification within N years", "SOC Analyst", "Obtain CISSP within 2 years of joining. 1 year of experience.", { band: "1-2", min: 1 }],

  /* ---- programmes ---------------------------------------------------------- */
  ["co-op in title", "Cybersecurity Co-op Trainee", "Six-month cooperative training placement.", { band: "coop", source: "programme" }],
  ["Arabic co-op title", "تدريب تعاوني - الأمن السيبراني", "فرصة تدريب تعاوني لطلاب الجامعات", { band: "coop", source: "programme" }],
  ["internship in title", "Cloud Internship", "Summer internship for students.", { band: "internship", source: "programme" }],
  ["Tamheer is a trainee programme", "Tamheer - Cybersecurity", "On-the-job training for graduates.", { band: "internship", source: "programme" }],
  ["LinkedIn employment type internship", "Security Analyst", "Monitor alerts. Employment type: Internship", { band: "internship", source: "programme" }],
  ["normal job mentioning an internship program stays a job", "Senior SOC Analyst", "5+ years of SOC experience. You will mentor our summer internship program.", { band: "3-5", min: 5 }],
  ["normal job mentioning co-op students stays a job", "Security Engineer", "3+ years of experience. You will supervise co-op students.", { band: "3-5", min: 3 }],

  /* ---- no number ----------------------------------------------------------- */
  ["fresh graduates", "Junior SOC Analyst", "Fresh graduates are encouraged to apply.", { band: "0", min: 0, source: "stated" }],
  ["senior title, no years -> not stated, never a number", "Senior Cloud Architect", "Design landing zones on AWS.", { band: "unknown", min: null, source: "none" }],
  ["manager title, no years", "Cybersecurity Manager", "Lead the security team.", { band: "unknown", min: null, source: "none" }],
  ["associate is junior, senior associate is not entry", "Senior Associate - Cyber", "Deliver GRC assessments.", { band: "unknown", source: "none" }],
  ["nothing at all", "Security Engineer", "Monitor and respond to alerts.", { band: "unknown", source: "none" }],
];

let failures = 0;
for (const [name, title, body, want] of CASES) {
  const got = detectExperience(title, body);
  const problems: string[] = [];
  if (got.band !== want.band) problems.push(`band ${got.band} != ${want.band}`);
  if (want.min !== undefined && got.minYears !== want.min) problems.push(`min ${got.minYears} != ${want.min}`);
  if (want.max !== undefined && got.maxYears !== want.max) problems.push(`max ${got.maxYears} != ${want.max}`);
  if (want.source !== undefined && got.source !== want.source) problems.push(`source ${got.source} != ${want.source}`);
  if (want.preferredOnly !== undefined && got.preferredOnly !== want.preferredOnly) problems.push(`preferredOnly ${got.preferredOnly}`);
  if (want.evidence && !(got.evidence ?? "").includes(want.evidence)) problems.push(`evidence "${got.evidence}" lacks "${want.evidence}"`);
  if (problems.length) {
    failures++;
    console.log(`FAIL  ${name}\n      ${problems.join("; ")}\n      evidence: ${got.evidence}`);
  }
}

console.log(`\nexperience: ${CASES.length - failures}/${CASES.length} correct`);
if (failures > 0) process.exit(1);
