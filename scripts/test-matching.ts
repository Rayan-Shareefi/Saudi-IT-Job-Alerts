/**
 * Regression cases for CV matching.
 *
 * The case that started this: a "Senior SOC Analyst" asking for five years
 * scored 68 against a final-year student's CV and was recommended, purely
 * because the vocabulary overlapped - SOC, SIEM, Splunk, incident response.
 * The words matched; the job did not.
 *
 * Skill overlap tells you a role is in your field. It does not tell you that
 * you can get it, and a "Recommended" badge that ignores the stated
 * requirements wastes the reader's time in the most expensive way.
 *
 *   npm run test:matching
 */
import { profileFromText, scoreJob } from "../src/lib/resume";

const STUDENT_CV = `
Sample Student
Final-year Computer Science student, Riyadh.
Expected graduation 2026. Seeking a co-op training placement.

SKILLS
Cybersecurity fundamentals, SIEM (Splunk), incident response, vulnerability
assessment with Nessus, Wireshark, Python, Linux, AWS, Docker, SQL.

CERTIFICATIONS
CompTIA Security+, AWS Certified Cloud Practitioner

PROJECTS
Built a home SOC lab with Splunk and Suricata for threat hunting practice.
`;

const SENIOR_CV = `
Nine years of experience in information security.
Currently Security Operations Manager, leading a SOC team of twelve.
SKILLS: SIEM, Splunk, QRadar, incident response, threat hunting, CISSP, CISM,
security architecture, AWS, Kubernetes, risk management, ISO 27001.
CERTIFICATIONS: CISSP, CISM
`;

interface Case {
  name: string;
  job: Parameters<typeof scoreJob>[0];
  cv: string;
  wantRecommended: boolean;
  because: string;
}

const CASES: Case[] = [
  {
    name: "Senior SOC Analyst (5+ yrs) vs student",
    job: {
      title: "Senior SOC Analyst",
      descriptionText:
        "Lead SOC monitoring using Splunk SIEM. Incident response and threat hunting. 5+ years of experience in security operations required.",
      tracks: ["security"],
      primaryTrack: "security",
      experienceBand: "3-5",
      minYears: 5,
    },
    cv: STUDENT_CV,
    wantRecommended: false,
    because: "the exact case that was wrong: asks 5+, CV has none",
  },
  {
    name: "Senior SOC Analyst (5+ yrs) vs senior",
    job: {
      title: "Senior SOC Analyst",
      descriptionText:
        "Lead SOC monitoring using Splunk SIEM. Incident response and threat hunting. 5+ years of experience required.",
      tracks: ["security"],
      primaryTrack: "security",
      experienceBand: "6-9",
      minYears: 5,
    },
    cv: SENIOR_CV,
    wantRecommended: true,
    because: "same role, and this CV clears the bar",
  },
  {
    name: "Co-op Trainee vs student",
    job: {
      title: "Co-op Trainee — Information Security",
      descriptionText:
        "Support the SOC team with SIEM monitoring in Splunk, incident response and vulnerability assessment. No prior experience required.",
      tracks: ["security"],
      primaryTrack: "security",
      experienceBand: "coop",
      minYears: null,
    },
    cv: STUDENT_CV,
    wantRecommended: true,
    because: "exactly what the student CV is aimed at",
  },
  {
    name: "Junior Security Analyst vs student",
    job: {
      title: "Junior Security Analyst",
      descriptionText:
        "Monitor alerts, triage incidents, Wireshark analysis, Splunk. 0-2 years experience.",
      tracks: ["security"],
      primaryTrack: "security",
      experienceBand: "1-2",
      minYears: 0,
    },
    cv: STUDENT_CV,
    wantRecommended: true,
    because: "entry level and in field",
  },
  {
    name: "Head of Information Security vs student",
    job: {
      title: "Head of Information Security",
      descriptionText: "Own the security function. SIEM, incident response, risk. Splunk.",
      tracks: ["security"],
      primaryTrack: "security",
      experienceBand: "10+",
      minYears: null,
    },
    cv: STUDENT_CV,
    wantRecommended: false,
    because: "senior title and a 10+ band, even with no stated number",
  },
  {
    name: "Security Engineer requiring CISSP vs student",
    job: {
      title: "Security Engineer",
      descriptionText:
        "Splunk, incident response, AWS. CISSP certification is required for this role.",
      tracks: ["security"],
      primaryTrack: "security",
      experienceBand: "3-5",
      minYears: 3,
    },
    cv: STUDENT_CV,
    wantRecommended: false,
    because: "states CISSP as required; the CV has Security+ only",
  },
  {
    name: "Cloud Engineer, 2 yrs vs student",
    job: {
      title: "Cloud Engineer",
      descriptionText: "AWS, Docker, Linux, Python automation. 2 years of experience.",
      tracks: ["cloud"],
      primaryTrack: "cloud",
      experienceBand: "1-2",
      minYears: 2,
    },
    cv: STUDENT_CV,
    wantRecommended: true,
    because: "a near miss on years is still worth applying to",
  },
];

function main(): void {
  const student = profileFromText(STUDENT_CV, "student.pdf");
  const senior = profileFromText(SENIOR_CV, "senior.pdf");
  let failures = 0;

  console.log(`\nCV matching (${CASES.length} cases)\n`);
  for (const c of CASES) {
    const profile = c.cv === STUDENT_CV ? student : senior;
    const r = scoreJob(c.job, profile);
    const ok = r.recommended === c.wantRecommended;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "ok  " : "FAIL"}  ${c.name.padEnd(42)} score=${String(r.score).padStart(3)} ` +
        `recommended=${String(r.recommended).padEnd(5)}`,
    );
    if (!ok) console.log(`        expected ${c.wantRecommended} — ${c.because}`);
    if (r.blockers.length > 0) console.log(`        blocked: ${r.blockers.join("; ")}`);
  }

  console.log(failures === 0 ? `\nall ${CASES.length} cases correct` : `\n${failures} case(s) wrong`);
  if (failures > 0) process.exit(1);
}

main();
