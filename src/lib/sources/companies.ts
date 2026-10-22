/**
 * The employer database.
 *
 * Every entry is a company that hires into Riyadh (or elsewhere in Saudi) for
 * technology roles. `careersUrl` is the page the discovery pass fetches to work
 * out which applicant-tracking system the company actually runs -- guessing ATS
 * slugs from a company name is unreliable, but companies almost always link or
 * iframe their real ATS from their own careers page, so we read it off there.
 *
 * Run `npm run sources:discover` to resolve these into concrete, working
 * sources, then `npm run sources:audit` to prune the ones that go dead.
 */

export interface CompanySeed {
  name: string;
  /** Primary careers page. Discovery also tries a few common variants. */
  careersUrl: string;
  sector: Sector;
  /** Rough signal for how much Riyadh tech hiring to expect. */
  priority: 1 | 2 | 3;
  /**
   * Set when the employer publishes no machine-readable board and accepts CVs
   * by email instead. Surfaced on the Sources page as an "apply direct" route
   * rather than the employer being silently dropped.
   */
  careersEmail?: string;
  /**
   * Further application addresses, where one inbox is not the whole story.
   *
   * Employers routinely run more than one: SITE takes co-op and trainee
   * applications at a different address from permanent roles, and sending a
   * co-op application to the general careers inbox is how it gets ignored.
   * The harvester used to find both and keep only the first.
   *
   * `careersEmail` remains the primary; these are additional.
   */
  careersEmails?: Array<{ address: string; purpose?: string }>;
  /**
   * Additional boards for the same employer - a graduate scheme, an Arabic
   * listing, a separate internships portal. Discovery resolves each one into
   * its own source, so a company with two boards is polled twice rather than
   * having half its vacancies quietly missed.
   */
  altUrls?: string[];
}

/**
 * Every application address for an employer, primary first, de-duplicated.
 *
 * One place so the Apply-by-email tab, the Human Intervene tab and the coverage
 * report cannot disagree about how many addresses a company has.
 */
export function allCareersEmails(
  c: Pick<CompanySeed, "careersEmail" | "careersEmails">,
): Array<{ address: string; purpose?: string }> {
  const out: Array<{ address: string; purpose?: string }> = [];
  const seen = new Set<string>();
  const add = (address?: string, purpose?: string) => {
    const a = address?.trim().toLowerCase();
    if (!a || seen.has(a) || !isApplicationAddress(a)) return;
    seen.add(a);
    out.push({ address: a, purpose });
  };
  add(c.careersEmail);
  for (const e of c.careersEmails ?? []) add(e.address, e.purpose);
  return out;
}

/**
 * Is this an address you would actually send an application to?
 *
 * Careers pages carry inboxes that look like application addresses and are not:
 * `recruiting-scams@` and `recruitment-fraud@` exist to REPORT fake job offers,
 * and a candidate emailing a CV there is writing to the security team. Same for
 * unsubscribe and privacy contacts.
 */
export function isApplicationAddress(address: string): boolean {
  const a = address.toLowerCase();
  const box = a.split("@")[0] ?? "";
  // Addresses scraped out of embedded JSON arrive with the escape sequence
  // still attached - "u003ecareers@..." is `>careers@...` that was never
  // decoded. Rather than guess at the real mailbox, reject it: a wrong address
  // is worse than a missing one, because an application sent there vanishes.
  if (/^u00[0-9a-f]{2}/i.test(box) || /\\u[0-9a-f]{4}/i.test(a)) return false;
  if (/scam|fraud|phish|abuse|report|spam|unsubscribe|privacy|dpo|legal|compliance-hotline|whistle/i.test(box)) {
    return false;
  }
  if (/^(no-?reply|noreply|donotreply|info|support|sales|marketing|webmaster|postmaster|admin|contact|hello|enquiries|inquiries|media|press|sentry|example|your|email|user|name|test|sample)$/i.test(box)) {
    return false;
  }
  return true;
}

/**
 * What an inbox is for, guessed from its mailbox name.
 *
 * Only used to label an address in the UI - a wrong guess costs a slightly odd
 * caption, never a missing address, so the fallback is deliberately silent
 * rather than asserting "general applications" over something unrecognised.
 */
export function purposeOfMailbox(address: string): string | undefined {
  const box = address.split("@")[0] ?? "";
  if (/co-?op|train(ee|ing)|intern|student|graduate|tamheer|طلاب|تدريب/i.test(box)) {
    return "Co-op, trainees and internships";
  }
  if (/career|job|recruit|hiring|hr|talent|employment|cv|resume|وظائف|توظيف/i.test(box)) {
    return "General applications";
  }
  return undefined;
}

export type Sector =
  | "giga-project"
  | "energy-industrial"
  | "telecom-tech"
  | "banking-fintech"
  | "government"
  | "education-research"
  | "consulting"
  | "global-tech"
  | "security-vendor"
  | "aviation-transport"
  | "healthcare-insurance"
  | "retail-consumer";

export const COMPANIES: CompanySeed[] = [
  /* ------------------------- giga-projects & PIF ------------------------- */
  { name: "NEOM", careersUrl: "https://careers.neom.com/careers", sector: "giga-project", priority: 1, altUrls: ["https://careers.neom.com/careers/join?domain=neom.com&hl=en"] },
  { name: "Red Sea Global", careersUrl: "https://careers.theredsea.sa/go/Job-Opportunities/7716923/", sector: "giga-project", priority: 1, altUrls: ["https://careers.theredsea.sa/go/Job-Opportunities/7716923/#content", "https://careers.theredsea.sa/go/Job-Opportunities/7716923/#", "https://careers.theredsea.sa/go/Job-Opportunities/7716923/?q=&sortColumn=referencedate&sortDirection=desc"] },
  { name: "Qiddiya", careersUrl: "https://apply.workable.com/qiddiya-investment-company-1/", sector: "giga-project", priority: 1 },
  { name: "Diriyah Company", careersUrl: "https://www.diriyah.sa/en/careers", sector: "giga-project", priority: 1 },
  { name: "ROSHN", careersUrl: "https://www.roshn.sa/careers", sector: "giga-project", priority: 1 },
  { name: "Public Investment Fund (PIF)", careersUrl: "https://www.pif.gov.sa/en/careers/", sector: "giga-project", priority: 1, altUrls: ["https://www.pif.gov.sa/en/private-sector-hub/explore-opportunities/", "https://www.pif.gov.sa/en/careers/graduate-development-program/"] },
  { name: "New Murabba", careersUrl: "https://newmurabba.com/careers", sector: "giga-project", priority: 2 },
  { name: "King Salman Park Foundation", careersUrl: "https://kingsalmanpark.sa/careers", sector: "giga-project", priority: 2 },
  { name: "Soudah Development", careersUrl: "https://soudah.sa/work-with-us", sector: "giga-project", priority: 3, altUrls: ["https://fa-eueh-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/"] },
  { name: "AMAALA", careersUrl: "https://www.amaala.com/en/careers", sector: "giga-project", priority: 3 },
  { name: "Riyadh Air", careersUrl: "https://www.riyadhair.com/en/careers", sector: "aviation-transport", priority: 1 },
  { name: "NHC (National Housing Company)", careersUrl: "https://www.nhc.sa/careers", sector: "giga-project", priority: 2, altUrls: ["https://www.nhc.sa/ar/investment-opportunities"] },
  { name: "Alat", careersUrl: "https://alat.com/en/careers/", sector: "giga-project", priority: 2 },
  { name: "Ceer Motors", careersUrl: "https://www.ceer.com.sa/careers", sector: "giga-project", priority: 2 },
  { name: "Lucid Motors", careersUrl: "https://lucidmotors.com/careers", sector: "giga-project", priority: 2, altUrls: ["https://lucidmotors.com/careers/search"] },
  { name: "Sanabil Investments", careersUrl: "https://www.sanabil.com/en/careers", sector: "banking-fintech", priority: 3 },
  { name: "SIRC (Saudi Investment Recycling)", careersUrl: "https://www.sirc.sa/en/careers", sector: "energy-industrial", priority: 3 },

  /* ------------------------ energy & industrial -------------------------- */
  { name: "Saudi Aramco", careersUrl: "https://www.aramco.com/en/careers", sector: "energy-industrial", priority: 1 },
  { name: "SABIC", careersUrl: "https://jobs.sabic.com/search/?searchby=location&createNewAlert=false&q=&locationsearch=&geolocation=&optionsFacetsDD_title=&optionsFacetsDD_dept=&optionsFacetsDD_department=", sector: "energy-industrial", priority: 1, careersEmail: "recruitment@sabic.com", altUrls: ["https://www.sabic.com/en/careers/middle-east-africa/students-and-fresh-graduates"] },
  { name: "Ma'aden", careersUrl: "https://careers.maaden.com/gb/en", sector: "energy-industrial", priority: 1, altUrls: ["https://careers.maaden.com/gb/en/jointalentcommunity"] },
  { name: "ACWA Power", careersUrl: "https://careers.acwapower.com/", sector: "energy-industrial", priority: 1 },
  { name: "Saudi Electricity Company", careersUrl: "https://www.se.com.sa/careers", sector: "energy-industrial", priority: 1 },
  { name: "Petro Rabigh", careersUrl: "https://careers.petrorabigh.com/", sector: "energy-industrial", priority: 3, altUrls: ["https://careers.petrorabigh.com/pages/university-college-co-op-program"] },
  { name: "Sipchem", careersUrl: "https://www.sipchem.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Advanced Petrochemical", careersUrl: "https://careers.advancedpetrochem.com/", sector: "energy-industrial", priority: 3 },
  { name: "Bahri", careersUrl: "https://www.bahri.sa/careers/", sector: "aviation-transport", priority: 2 },
  { name: "Alfanar", careersUrl: "https://jobs.alfanar.com/alfanar/go/All-Openings/4442101/", sector: "energy-industrial", priority: 2 },
  { name: "Zamil Group", careersUrl: "https://www.zamil.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Nesma", careersUrl: "https://www.nesma.com/careers", sector: "energy-industrial", priority: 3, careersEmail: "jobs@nesma.com" },
  { name: "Marafiq", careersUrl: "https://www.marafiq.com.sa/en/partnering-with-us/careers/life-at-marafiq/", sector: "energy-industrial", priority: 3 },
  { name: "Tarshid", careersUrl: "https://www.tarshid.com.sa/en/jobs", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Water Authority", careersUrl: "https://www.swa.gov.sa/en/careers", sector: "government", priority: 3 },

  /* --------------------------- telecom & tech ---------------------------- */
  { name: "stc", careersUrl: "https://careers.stc.com.sa/", sector: "telecom-tech", priority: 1, altUrls: ["https://careers.stc.com.sa/go/Cooperative-Training/7736023/", "https://careers.stc.com.sa/go/Early-Career/7735923/", "https://careers.stc.com.sa/content/COOP/?locale=en_US"] },
  { name: "solutions by stc", careersUrl: "https://careers.solutions.com.sa/viewalljobs/", sector: "telecom-tech", priority: 1 },
  { name: "sirar by stc", careersUrl: "https://www.linkedin.com/company/sirarbystc/jobs/", sector: "security-vendor", priority: 1 },
  { name: "center3", careersUrl: "https://www.center3.com/careers", sector: "telecom-tech", priority: 2 },
  { name: "Mobily", careersUrl: "https://careers.mobily.com.sa/en/sites/opportunities", sector: "telecom-tech", priority: 1 },
  { name: "Zain KSA", careersUrl: "https://sa.zain.com/about/careers/", sector: "telecom-tech", priority: 1, altUrls: ["https://sa.zain.com/about/join-zain/", "https://sa.zain.com/about/co-op-program/"] },
  { name: "TAWAL", careersUrl: "https://ialegs.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_2001", sector: "telecom-tech", priority: 2 },
  { name: "Elm", careersUrl: "https://elm.sa/ar/recruitment/sectors/Pages/default.aspx", sector: "telecom-tech", priority: 1 },
  { name: "Thiqah", careersUrl: "https://www.thiqah.sa/en/careers", sector: "telecom-tech", priority: 1 },
  { name: "Takamol Holding", careersUrl: "https://www.takamolholding.com/en/careers", sector: "telecom-tech", priority: 2 },
  { name: "Tahakom", careersUrl: "https://careers.tahakom.com/", sector: "telecom-tech", priority: 1, altUrls: ["https://careers.tahakom.com/content/Learning-and-Development/?locale=ar_SA", "https://careers.tahakom.com/lp/Cooperative%20Training%20ar/9064f865bd729606/?locale=ar_SA", "https://careers.tahakom.com/go/Fresh-Graduates/7763523/"] },
  { name: "SITE (Saudi Information Technology Company)", careersUrl: "https://site.sa/en/join-us", sector: "security-vendor", priority: 1, careersEmail: "careers@site.sa", careersEmails: [{ address: "trainee@site.sa", purpose: "Co-op, trainees and internships" }] },
  { name: "NourNet", careersUrl: "https://nour.net.sa/en/careers", sector: "telecom-tech", priority: 2 },
  { name: "Salam (Integrated Telecom)", careersUrl: "https://salam.net/careers", sector: "telecom-tech", priority: 2 },
  { name: "Innovative Solutions", careersUrl: "https://www.is.com.sa/careers", sector: "security-vendor", priority: 2, careersEmail: "careers@is.com.sa" },
  { name: "AlJammaz Technologies", careersUrl: "https://www.aljammaztechnologies.com/careers", sector: "telecom-tech", priority: 3 },
  { name: "Cipher (stc group)", careersUrl: "https://www.cipher.com.sa/careers", sector: "security-vendor", priority: 2 },
  { name: "Unifonic", careersUrl: "https://www.unifonic.com/en/careers", sector: "telecom-tech", priority: 2 },
  { name: "Quant", careersUrl: "https://careers.quant.sa/jobs/Careers", sector: "telecom-tech", priority: 3 },

  /* -------------------------- banking & fintech -------------------------- */
  { name: "Saudi National Bank (SNB)", careersUrl: "https://www.alahli.com/en/pages/about-us/careers", sector: "banking-fintech", priority: 1 },
  { name: "Al Rajhi Bank", careersUrl: "https://careers.alrajhibank.com.sa/ar/", sector: "banking-fintech", priority: 1, altUrls: ["https://careers.alrajhibank.com.sa/en/internal-posts/"] },
  { name: "Riyad Bank", careersUrl: "https://careers.riyadbank.com/en/", sector: "banking-fintech", priority: 1 },
  { name: "Saudi Awwal Bank (SAB)", careersUrl: "https://www.sab.com/en/about-us/careers/", sector: "banking-fintech", priority: 1, altUrls: ["https://www.sab.com/en/about-us/careers/graduate-opportunities/"] },
  { name: "Banque Saudi Fransi", careersUrl: "https://www.alfransi.com.sa/en/careers", sector: "banking-fintech", priority: 1 },
  { name: "Arab National Bank", careersUrl: "https://anb.com.sa/en/careers", sector: "banking-fintech", priority: 1 },
  { name: "Alinma Bank", careersUrl: "https://career.alinma.com/", sector: "banking-fintech", priority: 1 },
  { name: "Bank Albilad", careersUrl: "https://www.bankalbilad.com.sa/ar/about/Pages/e-careers.aspx", sector: "banking-fintech", priority: 2 },
  { name: "Bank AlJazira", careersUrl: "https://www.aljazirabank.com.sa/ar-sa/personal/careers", sector: "banking-fintech", priority: 2 },
  { name: "Gulf International Bank", careersUrl: "https://careers.gib.com/en/job-search-results/", sector: "banking-fintech", priority: 2, altUrls: ["https://www.gib.com/en/jammaz-al-suhaimi-future-executive-graduate-programme"] },
  { name: "SAMA (Saudi Central Bank)", careersUrl: "https://www.sama.gov.sa/careers", sector: "government", priority: 1 },
  { name: "Tadawul Group", careersUrl: "https://www.saudiexchange.sa/wps/portal/tadawul/careers", sector: "banking-fintech", priority: 2 },
  { name: "Saudi Payments", careersUrl: "https://www.saudipayments.sa/careers", sector: "banking-fintech", priority: 2 },
  { name: "stc pay", careersUrl: "https://stcpay.org/careers", sector: "banking-fintech", priority: 2 },
  { name: "Tamara", careersUrl: "https://tamara.co/en-sa/careers", sector: "banking-fintech", priority: 1 },
  { name: "Tabby", careersUrl: "https://tabby.ai/en-AE/careers", sector: "banking-fintech", priority: 1 },
  { name: "Lean Technologies", careersUrl: "https://jobs.ashbyhq.com/LeanTech/70aa6290-8d58-4749-9861-59675b1c8cb5", sector: "banking-fintech", priority: 2 },
  { name: "Rasan", careersUrl: "https://rasan.com/careers", sector: "banking-fintech", priority: 2 },
  { name: "Hala", careersUrl: "https://job-boards.greenhouse.io/hala", sector: "banking-fintech", priority: 2 },
  { name: "Geidea", careersUrl: "https://careers.geidea.net/", sector: "banking-fintech", priority: 2 },
  { name: "Moyasar", careersUrl: "https://moyasar.com/en/resources/careers/", sector: "banking-fintech", priority: 3 },
  { name: "PayTabs", careersUrl: "https://ai.paytabs.com/en/career/", sector: "banking-fintech", priority: 3, altUrls: ["https://ai.paytabs.com/en/business-opportunities/"] },
  { name: "Foodics", careersUrl: "https://www.foodics.com/careers/", sector: "banking-fintech", priority: 2, altUrls: ["http://foodics.workable.com/", "https://apply.workable.com/foodics/"] },

  /* ------------------------- retail & consumer tech ---------------------- */
  { name: "Jahez", careersUrl: "https://www.jahez.net/careers", sector: "retail-consumer", priority: 2 },
  { name: "HungerStation", careersUrl: "https://deliveryhero-1481174-gb-engb.sr-attrax.com/hungerstation-arabic", sector: "retail-consumer", priority: 2 },
  { name: "Nana", careersUrl: "https://nana.sa/careers", sector: "retail-consumer", priority: 3, careersEmail: "careers@nana.sa" },
  { name: "Salla", careersUrl: "https://salla.com/careers", sector: "retail-consumer", priority: 2 },
  { name: "Zid", careersUrl: "https://zid.sa/en/jobs/", sector: "retail-consumer", priority: 3 },
  { name: "Mrsool", careersUrl: "https://mrsool.co/careers", sector: "retail-consumer", priority: 3 },
  { name: "Sary", careersUrl: "https://sary.zenats.com/en", sector: "retail-consumer", priority: 3 },
  { name: "Almarai", careersUrl: "https://www.almarai.com/en/careers/", sector: "retail-consumer", priority: 2, altUrls: ["https://career5.successfactors.eu/career?company=AlMaraiP", "https://www.almarai.com/en/careers/employment-application-form", "https://www.almarai.com/en/careers/cooperative-training"] },
  { name: "Jarir Bookstore", careersUrl: "https://www.jarir.com/about-jarir/job-opportunities", sector: "retail-consumer", priority: 3, altUrls: ["https://www.jarir.com/about-jarir/job-opportunities#"] },
  { name: "Panda Retail", careersUrl: "https://www.panda.com.sa/en/careers", sector: "retail-consumer", priority: 3 },
  { name: "Alshaya Group", careersUrl: "https://www.alshaya.com/en/careers/", sector: "retail-consumer", priority: 3, altUrls: ["https://www.alshaya.com/en/careers/vacancies", "https://www.alshaya.com/en/careers/#getjobOpportunities"] },
  { name: "Abdul Latif Jameel", careersUrl: "https://alj.com/en/about/careers/", sector: "retail-consumer", priority: 2, altUrls: ["https://alj.com/en/about/careers/#early-careers"] },
  { name: "Ajlan & Bros", careersUrl: "https://ajlanbros.com/careers", sector: "retail-consumer", priority: 3 },

  /* --------------------------- government bodies ------------------------- */
  { name: "SDAIA", careersUrl: "https://sdaia.gov.sa/ar/SDAIA/SdaiaStrategies/Pages/EmploymentStrategy.aspx", sector: "government", priority: 1 },
  { name: "National Cybersecurity Authority (NCA)", careersUrl: "https://nca.gov.sa/en/careers/", sector: "government", priority: 1 },
  { name: "Digital Government Authority", careersUrl: "https://dga.gov.sa/ar/join-us", sector: "government", priority: 1 },
  { name: "Ministry of Communications and IT", careersUrl: "https://careers.mcit.gov.sa/", sector: "government", priority: 2, altUrls: ["https://careers.mcit.gov.sa/ar/saudi-arabia/jobs/%D8%A7%D9%84%D8%AA%D8%AF%D8%B1%D9%8A%D8%A8-%D8%A7%D9%84%D8%AA%D8%B9%D8%A7%D9%88%D9%86%D9%8A-1100084333/"] },
  { name: "ZATCA", careersUrl: "https://careers.zatca.gov.sa/?locale=ar_SA", sector: "government", priority: 2, altUrls: ["https://careers.zatca.gov.sa/content/Coop-and-Training-Programs-Arabic/?locale=ar_SA"] },
  { name: "GOSI", careersUrl: "https://www.gosi.gov.sa/en/careers", sector: "government", priority: 2 },
  { name: "Monshaat", careersUrl: "https://www.monshaat.gov.sa/en/careers", sector: "government", priority: 3 },
  { name: "NUPCO", careersUrl: "https://www.nupco.com/careers-and-training/careers/", sector: "healthcare-insurance", priority: 2 },
  { name: "Saudi Post (SPL)", careersUrl: "https://splonline.com.sa/careers/", sector: "aviation-transport", priority: 3 },
  { name: "Mawani", careersUrl: "https://careers.mawani.gov.sa/", sector: "aviation-transport", priority: 3 },
  { name: "Saudi Railways (SAR)", careersUrl: "https://www.sar.com.sa/careers", sector: "aviation-transport", priority: 3 },
  { name: "GACA", careersUrl: "https://careers.gaca.gov.sa/", sector: "aviation-transport", priority: 3, altUrls: ["https://careers.gaca.gov.sa/en/public/jobs", "https://careers.gaca.gov.sa/en/auth/jobseeker/signup?id=68b4574dd171cfb256d5429d"] },
  { name: "Human Resources Development Fund", careersUrl: "https://www.hrdf.org.sa/about/joinus/jobs/", sector: "government", priority: 3 },

  /* --------------------- education & research institutes ----------------- */
  { name: "KAUST", careersUrl: "https://www.kaust.edu.sa/en/error/404?404;https://www.kaust.edu.sa:443/en/careers", sector: "education-research", priority: 2, altUrls: ["https://www.kaust.edu.sa/ar/study/student-central"] },
  { name: "KACST", careersUrl: "https://www.kacst.gov.sa/en/careers", sector: "education-research", priority: 2 },
  { name: "KAPSARC", careersUrl: "https://www.kapsarc.org/work-with-us/job-opportunities/", sector: "education-research", priority: 3, altUrls: ["https://www.kapsarc.org/work-with-us/job-opportunities/#"] },
  { name: "KFUPM", careersUrl: "https://www.kfupm.edu.sa/about-us/connect/careers", sector: "education-research", priority: 3, altUrls: ["https://www.kfupm.edu.sa/study/graduate-programs-ms"] },
  { name: "Alfaisal University", careersUrl: "https://jobs.alfaisal.edu/", sector: "education-research", priority: 3, altUrls: ["https://jobs.alfaisal.edu/col/"] },
  { name: "Prince Sultan University", careersUrl: "https://psu.edu.sa/en/career", sector: "education-research", priority: 3, altUrls: ["https://psu.edu.sa/en/student-faculty", "https://psu.edu.sa/en/Deanship-of-Student-Affairs", "https://psu.edu.sa/en/graduate-studies-unit"] },

  /* ------------------------ healthcare & insurance ----------------------- */
  { name: "Bupa Arabia", careersUrl: "https://careers.bupa.com.sa/en/job-search-results/", sector: "healthcare-insurance", priority: 2, altUrls: ["https://www.bupa.com.sa/en/careers#"] },
  { name: "Tawuniya", careersUrl: "https://www.tawuniya.com/careers", sector: "healthcare-insurance", priority: 2 },
  { name: "Dr. Sulaiman Al Habib", careersUrl: "https://hmg.elevatus.io/jobs", sector: "healthcare-insurance", priority: 3 },
  { name: "King Faisal Specialist Hospital", careersUrl: "https://www.kfshrc.edu.sa/en/home/careers", sector: "healthcare-insurance", priority: 3, altUrls: ["https://www.kfshrc.edu.sa/en/home/careers#"] },
  { name: "Seha Virtual Hospital", careersUrl: "https://svh.med.sa/careers", sector: "healthcare-insurance", priority: 3 },

  /* -------------------------- consulting & advisory ---------------------- */
  { name: "Accenture", careersUrl: "https://www.accenture.com/sa-en/careers", sector: "consulting", priority: 1, altUrls: ["https://www.accenture.com/sa-en/careers/life-at-accenture/internships-students", "https://www.accenture.com/sa-en/careers/life-at-accenture/entry-level"] },
  { name: "Deloitte Middle East", careersUrl: "https://middleeastjobs.deloitte.com/", sector: "consulting", priority: 1, altUrls: ["https://www.deloitte.com/middle-east/en/careers/deloitte-life/impact-every-day/kiyadat-at-deloitte.html"] },
  { name: "PwC Middle East", careersUrl: "https://www.pwc.com/m1/en/careers.html", sector: "consulting", priority: 1, altUrls: ["https://www.pwc.com/m1/en/careers/graduates-and-undergraduates-careers.html", "https://www.pwc.com/m1/en/careers/graduates.html", "https://www.pwc.com/m1/en/careers/oman-nationals-careers.html"] },
  { name: "EY", careersUrl: "https://www.ey.com/en_sa/careers", sector: "consulting", priority: 1 },
  { name: "KPMG Saudi Arabia", careersUrl: "https://kpmg.com/sa/en/careers.html", sector: "consulting", priority: 1, altUrls: ["https://kpmg.com/sa/en/careers/graduates.html", "https://kpmg.com/sa/en/careers/coop-and-internship-programs.html"] },
  { name: "McKinsey & Company", careersUrl: "https://www.mckinsey.com/careers/home", sector: "consulting", priority: 2 },
  { name: "Boston Consulting Group", careersUrl: "https://careers.bcg.com/global/en/search-results", sector: "consulting", priority: 2, altUrls: ["https://careers.bcg.com/global/en/early-careers", "https://careers.bcg.com/global/en/internship-opportunities", "https://careers.bcg.com/global/en/on-campus"] },
  { name: "Bain & Company", careersUrl: "https://careers.bain.com/", sector: "consulting", priority: 2 },
  { name: "Oliver Wyman", careersUrl: "https://careers.marsh.com/global/en/oliver-wyman-search", sector: "consulting", priority: 3 },
  { name: "Kearney", careersUrl: "https://www.kearney.com/careers", sector: "consulting", priority: 3, altUrls: ["https://www.kearney.com/careers/opportunities", "https://www.kearney.com/careers/interviewing"] },
  { name: "Capgemini", careersUrl: "https://www.capgemini.com/careers/?page=1&size=11", sector: "consulting", priority: 2, altUrls: ["https://www.capgemini.com/careers/career-paths/students-and-graduates/"] },
  { name: "Wipro", careersUrl: "https://careers.wipro.com/search/?searchResultView=LIST", sector: "consulting", priority: 2, altUrls: ["https://careers.wipro.com/content/Early-Careers/?locale=en_US", "https://careers.wipro.com/talentcommunity/subscribe/?locale=en_US"] },
  { name: "Infosys", careersUrl: "https://www.infosys.com/careers/", sector: "consulting", priority: 2 },
  { name: "Tata Consultancy Services", careersUrl: "https://www.tcs.com/careers", sector: "consulting", priority: 2 },
  { name: "Tech Mahindra", careersUrl: "https://careers.techmahindra.com/", sector: "consulting", priority: 3, altUrls: ["https://careers.techmahindra.com/CurrentOpportunity.aspx", "https://careers.techmahindra.com/BPSOpportunity.aspx", "https://careers.techmahindra.com/Currentopportunity.aspx"] },
  { name: "HCLTech", careersUrl: "https://careers.hcltech.com/", sector: "consulting", priority: 3, altUrls: ["https://careers.hcltech.com/go/NonTPDemand/9558355/", "https://careers.hcltech.com/talentcommunity/subscribe/?locale=en_US"] },
  { name: "Atos", careersUrl: "https://atos.net/en/join-us", sector: "consulting", priority: 3, altUrls: ["https://atos.net/en/join-us/young-professionals-and-graduates", "https://atos.net/en/join-us/interns-apprentices"] },
  { name: "DXC Technology", careersUrl: "https://careers.dxc.com/", sector: "consulting", priority: 3, altUrls: ["https://careers.dxc.com/profile/join/", "https://careers.dxc.com/job-search-results/?category=Apprentice%20%26%20Interns", "https://careers.dxc.com/profile/join"] },
  { name: "Giza Systems", careersUrl: "https://www.pulse-careers.com/", sector: "consulting", priority: 3 },
  { name: "Injazat / Core42", careersUrl: "https://careers.core42.ai/", sector: "consulting", priority: 3 },

  /* ------------------------------ global tech ---------------------------- */
  { name: "Microsoft", careersUrl: "https://apply.careers.microsoft.com/careers?start=0&pid=1970393556972152&sort_by=timestamp", sector: "global-tech", priority: 1, altUrls: ["https://apply.careers.microsoft.com/careers/join"] },
  { name: "Amazon Web Services", careersUrl: "https://www.amazon.jobs/en/", sector: "global-tech", priority: 1 },
  { name: "Google", careersUrl: "https://www.google.com/about/careers/applications/", sector: "global-tech", priority: 1, altUrls: ["https://www.google.com/about/careers/applications/students"] },
  { name: "Oracle", careersUrl: "https://careers.oracle.com/en/sites/jobsearch", sector: "global-tech", priority: 1 },
  { name: "SAP", careersUrl: "https://jobs.sap.com/", sector: "global-tech", priority: 1, careersEmail: "careers@sap.com", altUrls: ["https://jobs.sap.com/content/Students-and-Graduates/?locale=en_US", "https://performancemanager5.successfactors.eu/sf/careers?company=SAP", "https://jobs.sap.com/content/students/"] },
  { name: "IBM", careersUrl: "https://www.ibm.com/careers/search", sector: "global-tech", priority: 1, altUrls: ["https://www.ibm.com/careers/career-opportunities", "https://www.ibm.com/careers/internships"] },
  { name: "Cisco", careersUrl: "https://careers.cisco.com/global/en", sector: "global-tech", priority: 1, altUrls: ["https://careers.cisco.com/global/en/jointalentcommunity"] },
  { name: "Dell Technologies", careersUrl: "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/jobs?mode=location", sector: "global-tech", priority: 2, altUrls: ["https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/join-talent-community", "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/pages/internships/?mode=location", "https://enterpriseplatform.dell.com/hcmUI/CandidateExperience/en/sites/careers/pages/recent-graduates/?mode=location"] },
  { name: "Hewlett Packard Enterprise", careersUrl: "https://careers.hpe.com/us/en/search-results", sector: "global-tech", priority: 2, altUrls: ["https://careers.hpe.com/us/en/students", "https://careers.hpe.com/us/en/jointalentcommunity"] },
  { name: "Huawei", careersUrl: "https://career.huawei.com/reccampportal/portal5/index.html", sector: "global-tech", priority: 2, careersEmail: "career@huawei.com", altUrls: ["https://career.huawei.com/reccampportal/portal5/campus-recruitment.html?v=20241208", "https://career.huawei.com/reccampportal/campus4/pages/westernEurope/index.html?v=20241120", "https://career.huawei.com/reccampportal/portal5/campus-recruitment.html"] },
  { name: "Nokia", careersUrl: "https://www.nokia.com/careers/", sector: "global-tech", priority: 2 },
  { name: "Ericsson", careersUrl: "https://jobs.ericsson.com/careers?start=0&pid=563121776072318&sort_by=hot", sector: "global-tech", priority: 2, altUrls: ["https://jobs.ericsson.com/careers/join?domain=ericsson.com"] },
  { name: "Siemens", careersUrl: "https://jobs.siemens.com/en_US/externaljobs/Home", sector: "global-tech", priority: 2 },
  { name: "Schneider Electric", careersUrl: "https://careers.se.com/life-at-schneider", sector: "global-tech", priority: 2 },
  { name: "Honeywell", careersUrl: "https://careers.honeywell.com/en/sites/Honeywell", sector: "global-tech", priority: 2 },
  { name: "ABB", careersUrl: "https://careers.abb/global/en", sector: "global-tech", priority: 3, altUrls: ["https://careers.abb/global/en/early-careers"] },
  { name: "General Electric", careersUrl: "https://jobs.gecareers.com/", sector: "global-tech", priority: 3 },
  { name: "ServiceNow", careersUrl: "https://careers.servicenow.com/", sector: "global-tech", priority: 2, altUrls: ["https://careers.servicenow.com/early-careers/"] },
  { name: "Salesforce", careersUrl: "https://www.salesforce.com/company/careers/jobs/", sector: "global-tech", priority: 2 },
  { name: "VMware by Broadcom", careersUrl: "https://broadcom.wd1.myworkdayjobs.com/External_Career", sector: "global-tech", priority: 3 },
  { name: "Red Hat", careersUrl: "https://www.redhat.com/en/jobs", sector: "global-tech", priority: 2 },
  { name: "Nutanix", careersUrl: "https://careers.nutanix.com/en/", sector: "global-tech", priority: 3, careersEmail: "recruiting@nutanix.com" },
  { name: "NetApp", careersUrl: "https://careers.netapp.com/", sector: "global-tech", priority: 3, careersEmail: "careers@netapp.com", altUrls: ["https://careers.netapp.com/category/internships-jobs/27600/8608640/1", "https://careers.netapp.com/en/temporaryopportunities"] },
  { name: "Pure Storage", careersUrl: "https://www.everpuredata.com/company/careers/opportunities.html", sector: "global-tech", priority: 3, altUrls: ["https://www.everpuredata.com/company/careers/opportunities.html#", "https://www.everpuredata.com/company/careers/opportunities.html#pathfinder", "https://job-boards.greenhouse.io/purestorage/jobs/8027655"] },
  { name: "Snowflake", careersUrl: "https://careers.snowflake.com/us/en", sector: "global-tech", priority: 3, altUrls: ["https://careers.snowflake.com/us/en/jointalentcommunity", "https://careers.snowflake.com/us/en/equal-opportunity"] },
  { name: "Databricks", careersUrl: "https://www.databricks.com/company/careers/open-positions", sector: "global-tech", priority: 3, altUrls: ["https://www.databricks.com/company/careers/university-recruiting", "https://www.databricks.com/company/careers/engineering---pipeline/senior-software-engineer---database-engine-internals-8012809002", "https://www.databricks.com/company/careers/engineering---pipeline/senior-software-engineer---database-engine-internals-6544383002"] },
  { name: "MongoDB", careersUrl: "https://www.mongodb.com/company/careers", sector: "global-tech", priority: 3, altUrls: ["https://www.mongodb.com/company/careers/how-to-avoid-recruiting-scams", "https://www.mongodb.com/students", "https://www.mongodb.com/careers/departments/campus"] },
  { name: "Elastic", careersUrl: "https://www.elastic.co/careers", sector: "global-tech", priority: 3 },
  { name: "GitLab", careersUrl: "https://about.gitlab.com/jobs/all-jobs/", sector: "global-tech", priority: 3, altUrls: ["https://job-boards.greenhouse.io/gitlab/jobs/8642850002", "https://job-boards.greenhouse.io/gitlab/jobs/8643077002", "https://job-boards.greenhouse.io/gitlab/jobs/8700587002"] },
  { name: "Atlassian", careersUrl: "https://www.atlassian.com/company/careers/all-jobs", sector: "global-tech", priority: 3, altUrls: ["https://www.atlassian.com/company/careers/earlycareers", "https://www.atlassian.com/company/careers/details/26275", "https://www.atlassian.com/company/careers/details/26274"] },
  { name: "HashiCorp", careersUrl: "https://www.ibm.com/careers/search?q=hashicorp", sector: "global-tech", priority: 3, altUrls: ["https://www.ibm.com/careers/career-opportunities", "https://www.ibm.com/careers/internships"] },
  { name: "Confluent", careersUrl: "https://www.confluent.io/careers/", sector: "global-tech", priority: 3 },
  { name: "Cloudera", careersUrl: "https://cloudera.wd5.myworkdayjobs.com/External_Career", sector: "global-tech", priority: 3 },
  { name: "Informatica", careersUrl: "https://www.salesforce.com/company/careers/jobs/?search=informatica&pagesize=20", sector: "global-tech", priority: 3 },

  /* --------------------------- security vendors -------------------------- */
  { name: "Palo Alto Networks", careersUrl: "https://jobs.paloaltonetworks.com/en", sector: "security-vendor", priority: 1, altUrls: ["https://jobs.paloaltonetworks.com/early-in-career", "https://jobs.paloaltonetworks.com/en/Must-Know-Facts-from-an-Early-Career-Product-Manager", "https://paloaltonetworks.wd5.myworkdayjobs.com/en-US/panwexternalcareers/introduceYourself?clientRequestID=06f06ca6dae2441d99391ed600fc2265"] },
  { name: "Fortinet", careersUrl: "https://www.fortinet.com/corporate/careers", sector: "security-vendor", priority: 1, altUrls: ["https://www.fortinet.com/customers/coop"] },
  { name: "CrowdStrike", careersUrl: "https://www.crowdstrike.com/en-us/careers/", sector: "security-vendor", priority: 1, careersEmail: "recruiting@crowdstrike.com", altUrls: ["https://crowdstrike.wd5.myworkdayjobs.com/crowdstrikecareers/page/56040874354a1000d20c322b45450000", "https://www.crowdstrike.com/en-us/careers/university-interns/"] },
  { name: "Splunk", careersUrl: "https://careers.cisco.com/global/en/splunk/india", sector: "security-vendor", priority: 2 },
  { name: "Check Point Software", careersUrl: "https://careers.checkpoint.com/index.php?m=cpcareers&a=search", sector: "security-vendor", priority: 2 },
  { name: "Trend Micro", careersUrl: "https://www.trendmicro.com/en_us/about/careers.html", sector: "security-vendor", priority: 2, altUrls: ["https://trendmicro.wd3.myworkdayjobs.com/External", "https://www.trendmicro.com/zh_tw/about/careers.html"] },
  { name: "Tenable", careersUrl: "https://www.tenable.com/careers", sector: "security-vendor", priority: 2 },
  { name: "Rapid7", careersUrl: "https://careers.rapid7.com/jobs/search", sector: "security-vendor", priority: 2, altUrls: ["https://careers.rapid7.com/emerging-talent"] },
  { name: "Qualys", careersUrl: "https://www.qualys.com/careers/", sector: "security-vendor", priority: 3 },
  { name: "Zscaler", careersUrl: "https://www.zscaler.com/careers", sector: "security-vendor", priority: 2, altUrls: ["https://www.zscaler.com/careers/search"] },
  { name: "Netskope", careersUrl: "https://www.netskope.com/company/careers", sector: "security-vendor", priority: 3 },
  { name: "Cloudflare", careersUrl: "https://www.cloudflare.com/careers/jobs/", sector: "security-vendor", priority: 2 },
  { name: "F5", careersUrl: "https://www.f5.com/company/careers", sector: "security-vendor", priority: 3, altUrls: ["https://www.f5.com/company/careers#internships", "https://www.f5.com/company/careers/early-careers", "https://ffive.wd5.myworkdayjobs.com/en-US/f5jobs/introduceYourself"] },
  { name: "Akamai", careersUrl: "https://www.akamai.com/careers", sector: "security-vendor", priority: 3 },
  { name: "Proofpoint", careersUrl: "https://www.proofpoint.com/us/company/careers", sector: "security-vendor", priority: 3, altUrls: ["https://proofpoint.wd5.myworkdayjobs.com/proofpointcareers"] },
  { name: "Sophos", careersUrl: "https://www.sophos.com/en-us/company/careers", sector: "security-vendor", priority: 3 },
  { name: "Kaspersky", careersUrl: "https://careers.kaspersky.com/", sector: "security-vendor", priority: 3, altUrls: ["https://careers.kaspersky.com/vacancies"] },
  { name: "SentinelOne", careersUrl: "https://www.sentinelone.com/careers/#cq=i1", sector: "security-vendor", priority: 3 },
  { name: "Trellix", careersUrl: "https://careers.trellix.com/", sector: "security-vendor", priority: 3 },
  { name: "Darktrace", careersUrl: "https://darktrace.wd3.myworkdayjobs.com/DarktaceExternal", sector: "security-vendor", priority: 3 },
  { name: "Secureworks", careersUrl: "https://www.sophos.com/en-us/company/careers", sector: "security-vendor", priority: 3 },
  { name: "Help AG", careersUrl: "https://www.helpag.com/careers/", sector: "security-vendor", priority: 2, altUrls: ["https://www.helpag.com/join-our-talent-community/"] },
  { name: "spiderSilk", careersUrl: "https://spidersilk.com/careers", sector: "security-vendor", priority: 3 },
  { name: "CyberKnight", careersUrl: "https://cyberknight.tech/about-us/jobs/", sector: "security-vendor", priority: 3 },

  /* -------------------------- defence & aerospace ------------------------ */
  { name: "SAMI (Saudi Arabian Military Industries)", careersUrl: "https://www.sami.com.sa/careers", sector: "energy-industrial", priority: 1, altUrls: ["https://www.sami.com.sa/join-internship-program/"] },
  { name: "Thales", careersUrl: "https://careers.thalesgroup.com/global/en", sector: "energy-industrial", priority: 2, altUrls: ["https://careers.thalesgroup.com/global/en/studentandgraduates2"] },
  { name: "Airbus", careersUrl: "https://www.airbus.com/en/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://ag.wd3.myworkdayjobs.com/Airbus", "https://www.airbus.com/en/careers/students-and-graduates/apprentices/apprenticeships-in-the-united-kingdom"] },
  { name: "Boeing", careersUrl: "https://jobs.boeing.com/", sector: "energy-industrial", priority: 3, altUrls: ["https://jobs.boeing.com/veterans", "https://jobs.boeing.com/internships", "https://jobs.boeing.com/Meet-Abbey-Carlson"] },
  { name: "Lockheed Martin", careersUrl: "https://www.lockheedmartin.com/en-us/careers/index.html", sector: "energy-industrial", priority: 3 },
  { name: "RTX (Raytheon)", careersUrl: "https://careers.rtx.com/global/en", sector: "energy-industrial", priority: 3, careersEmail: "rtxrecruiting@rtx.com" },
  { name: "Northrop Grumman", careersUrl: "https://www.northropgrumman.com/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://www.northropgrumman.com/careers/students-and-entry-level-careers-start-a-career-of-purpose", "https://www.northropgrumman.com/corporate-responsibility/reaffirmation-of-equal-employment-opportunity-and-affirmative-action-policies"] },
  { name: "L3Harris", careersUrl: "https://careers.l3harris.com/en", sector: "energy-industrial", priority: 3, altUrls: ["https://careers.l3harris.com/new-grads-and-interns", "https://careers.l3harris.com/new-grads-and-interns-jobs"] },
  { name: "BAE Systems", careersUrl: "https://jobs.baesystems.com/global/en", sector: "energy-industrial", priority: 3, altUrls: ["https://jobs.baesystems.com/global/en/studentsandgraduates", "https://jobs.baesystems.com/global/en/jointalentcommunity", "https://jobs.baesystems.com/global/en/blogarticle/how-two-employees-turned-a-bae-systems-internship-into-a-fulltime-career"] },
  { name: "Leonardo", careersUrl: "https://www.leonardo.com/en/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://www.leonardo.com/en/careers/work-with-us", "https://www.leonardo.com/en/careers/students-and-graduates"] },

  /* ------------------------- aviation & transport ------------------------ */
  { name: "Saudia", careersUrl: "https://www.saudia.com/about-saudia/careers", sector: "aviation-transport", priority: 2 },
  { name: "flynas", careersUrl: "https://www.flynas.com/en/careers", sector: "aviation-transport", priority: 3 },
  { name: "flyadeal", careersUrl: "https://www.flyadeal.com/en/careers/", sector: "aviation-transport", priority: 3 },
  { name: "Matarat Holding", careersUrl: "https://careers.matarat.com.sa/", sector: "aviation-transport", priority: 3 },
  { name: "Riyadh Airports", careersUrl: "https://www.riyadhairports.com/en/careers", sector: "aviation-transport", priority: 3 },

  /* ------------------------- banking, finance, fintech ------------------- */
  { name: "Jadwa Investment", careersUrl: "https://www.jadwa.com/en/careers", sector: "banking-fintech", priority: 2, careersEmail: "careers@jadwa.com" },
  { name: "SNB Capital", careersUrl: "https://career.snbcapital.com/", sector: "banking-fintech", priority: 2 },
  { name: "Riyad Capital", careersUrl: "https://www.riyadcapital.com/en/careers", sector: "banking-fintech", priority: 3 },
  { name: "Derayah Financial", careersUrl: "https://web.derayah.com/ar/join-us/", sector: "banking-fintech", priority: 3, altUrls: ["https://web.derayah.com/ar/no-job-vacancies/", "https://web.derayah.com/ar/no-gdp-vacancies/", "https://web.derayah.com/ar/no-internship-vacancies/"] },
  { name: "Alistithmar Capital", careersUrl: "https://www.icap.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Saudi Reinsurance", careersUrl: "https://saudire.net/career/", sector: "healthcare-insurance", priority: 3 },
  { name: "Nayifat Finance", careersUrl: "https://nayifat.com/careers/", sector: "banking-fintech", priority: 3 },
  { name: "Emkan Finance", careersUrl: "https://www.emkanfinance.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Quara Finance", careersUrl: "https://www.quara.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Bidaya Home Finance", careersUrl: "https://www.bidaya.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Lendo", careersUrl: "https://www.lendo.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Manafa Capital", careersUrl: "https://manafa.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Tameed", careersUrl: "https://careers.ta3meed.com/jobs", sector: "banking-fintech", priority: 3 },
  { name: "Forus", careersUrl: "https://forus.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Sukuk Capital", careersUrl: "https://sukuk.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Waed Ventures", careersUrl: "https://portfoliojobs.waed.com/jobs", sector: "banking-fintech", priority: 3 },
  { name: "Saudi Venture Capital", careersUrl: "https://svc.com.sa/en/careers", sector: "banking-fintech", priority: 3 },
  { name: "Neo Leap", careersUrl: "https://neoleap.com.sa/en/careers", sector: "banking-fintech", priority: 2 },
  { name: "Barq", careersUrl: "https://barq.io/careers", sector: "banking-fintech", priority: 3 },
  { name: "Alinma Investment", careersUrl: "https://www.alinmainvestment.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Wamid", careersUrl: "https://careers.tadawulgroup.sa/?lang=en", sector: "banking-fintech", priority: 3 },
  { name: "Muqassa", careersUrl: "https://careers.tadawulgroup.sa/?lang=en", sector: "banking-fintech", priority: 3 },
  { name: "Edaa", careersUrl: "https://careers.tadawulgroup.sa/?lang=en", sector: "banking-fintech", priority: 3 },

  /* ------------------------------ insurance ------------------------------ */
  { name: "Malath Insurance", careersUrl: "https://www.malath.com.sa/en/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Walaa Insurance", careersUrl: "https://walaa.com/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "MedGulf", careersUrl: "https://www.medgulf.com.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Al Rajhi Takaful", careersUrl: "https://www.alrajhitakaful.com/ar/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Arabian Shield", careersUrl: "https://www.der.com.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Allianz Saudi Fransi", careersUrl: "https://www.allianzsf.com/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Solidarity Saudi Takaful", careersUrl: "https://solidarity.com/careers", sector: "healthcare-insurance", priority: 3 },

  /* ---------------------- technology & digital services ------------------ */
  { name: "Ejada Systems", careersUrl: "https://careers.ejada.com/", sector: "telecom-tech", priority: 1, altUrls: ["https://careers.ejada.com/en/page/career-fairs/", "https://careers.ejada.com/en/job-search-results/?trigger=emptype&emptype=6585"] },
  { name: "Perfect Presentation", careersUrl: "https://2p.com.sa/careers", sector: "telecom-tech", priority: 1 },
  { name: "Al Moammar Information Systems", careersUrl: "https://www.mis.com.sa/careers", sector: "telecom-tech", priority: 2, careersEmail: "jobs@mis.com.sa" },
  { name: "Advanced Electronics Company", careersUrl: "https://www.aec.com.sa/careers", sector: "telecom-tech", priority: 2 },
  { name: "Intigral", careersUrl: "https://www.intigral.net/careers", sector: "telecom-tech", priority: 2 },
  { name: "Dawiyat", careersUrl: "https://www.dawiyat.com.sa/careers", sector: "telecom-tech", priority: 3 },
  { name: "GO Telecom", careersUrl: "https://www.go.com.sa/careers", sector: "telecom-tech", priority: 3 },
  { name: "Arabsat", careersUrl: "https://www.arabsat.com/careers", sector: "telecom-tech", priority: 3 },
  { name: "Neo Space Group", careersUrl: "https://www.neospace.group/career/", sector: "telecom-tech", priority: 2 },
  { name: "Lucidya", careersUrl: "https://lucidya.com/careers", sector: "telecom-tech", priority: 3 },
  { name: "Intelmatix", careersUrl: "https://intelmatix.ai/company-careers.html", sector: "telecom-tech", priority: 2 },
  { name: "Mozn", careersUrl: "https://www.mozn.ai/careers", sector: "telecom-tech", priority: 2 },
  { name: "Rewaa", careersUrl: "https://rewaa.com/careers/", sector: "retail-consumer", priority: 2 },
  { name: "Tahaluf", careersUrl: "https://tahaluf.sa/careers", sector: "telecom-tech", priority: 3 },
  { name: "Naizak", careersUrl: "https://naizak.com/index.php/home/careers-2/", sector: "telecom-tech", priority: 3 },
  { name: "Gulf IT", careersUrl: "https://gulfit.com/careers", sector: "security-vendor", priority: 3 },
  { name: "Malomatia", careersUrl: "https://malomatia.com/careers/", sector: "telecom-tech", priority: 3 },

  /* ------------------------ gaming, sport, entertainment ----------------- */
  { name: "Savvy Games Group", careersUrl: "https://evth.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/savvy-careers", sector: "retail-consumer", priority: 2 },
  { name: "Manga Productions", careersUrl: "https://mangaproductions.net/careers", sector: "retail-consumer", priority: 3 },
  { name: "SURJ Sports Investment", careersUrl: "https://surj.com/careers", sector: "retail-consumer", priority: 3 },
  { name: "SRJ Sports Investments", careersUrl: "https://srj.com/careers", sector: "retail-consumer", priority: 3 },
  { name: "MDLBEAST", careersUrl: "https://mdlbeast.com/about/careers", sector: "retail-consumer", priority: 3, altUrls: ["https://mdlbeast.recruitee.com/"] },
  { name: "General Entertainment Authority", careersUrl: "https://www.gea.gov.sa/careers", sector: "government", priority: 3 },
  { name: "webook", careersUrl: "https://webook.com/en/careers", sector: "retail-consumer", priority: 3 },
  { name: "Saudi Pro League", careersUrl: "https://iaazkf.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/", sector: "retail-consumer", priority: 3 },

  /* ------------------------------ government ----------------------------- */
  { name: "Royal Commission for AlUla", careersUrl: "https://www.rcu.gov.sa/en/contact/careers", sector: "government", priority: 2 },
  { name: "Royal Commission for Riyadh City", careersUrl: "https://www.rcrc.gov.sa/careers/", sector: "government", priority: 2 },
  { name: "Ministry of Investment", careersUrl: "https://jobs.misa.gov.sa/ar/?locale=en_US", sector: "government", priority: 2 },
  { name: "Ministry of Health", careersUrl: "https://www.moh.gov.sa/en/careers", sector: "government", priority: 3 },
  { name: "Ministry of Energy", careersUrl: "https://www.moenergy.gov.sa/ar/recruitment", sector: "government", priority: 3 },
  { name: "Ministry of Tourism", careersUrl: "https://mt.gov.sa/en/careers", sector: "government", priority: 3, altUrls: ["https://mt.gov.sa/tourism-investment#financing-opportunities"] },
  { name: "Saudi Tourism Authority", careersUrl: "https://www.sta.gov.sa/en/careers/", sector: "government", priority: 3 },
  { name: "SFDA", careersUrl: "https://www.sfda.gov.sa/ar/career-vision-and-mission", sector: "government", priority: 3 },
  { name: "SASO", careersUrl: "https://www.saso.gov.sa/ar/mediacenter/Pages/JoinOurTeam.aspx", sector: "government", priority: 3 },
  { name: "GASTAT", careersUrl: "https://careers.stats.gov.sa/", sector: "government", priority: 3 },
  { name: "Saudi Authority for Intellectual Property", careersUrl: "https://www.saip.gov.sa/ar/contact-us/careers", sector: "government", priority: 3 },
  { name: "Etimad", careersUrl: "https://etimad.sa/careers", sector: "government", priority: 3 },
  { name: "Local Content Authority", careersUrl: "https://www.lcgpa.gov.sa/careers", sector: "government", priority: 3 },
  { name: "Saudi Space Agency", careersUrl: "https://ssa.gov.sa/ar/careersLandingPage/?path=/careers/", sector: "government", priority: 3 },
  { name: "Communications Space and Technology Commission", careersUrl: "https://www.cst.gov.sa/about/career", sector: "government", priority: 2 },
  { name: "Saudi Industrial Development Fund", careersUrl: "https://www.sidf.gov.sa/en/careers", sector: "government", priority: 3 },

  /* ------------------------- energy & petrochemicals --------------------- */
  { name: "SATORP", careersUrl: "https://www.satorp.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Sadara Chemical", careersUrl: "https://www.sadara.com/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://www.sadara.com/students-graduates"] },
  { name: "Luberef", careersUrl: "https://www.luberef.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "YASREF", careersUrl: "https://www.yasref.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Tasnee", careersUrl: "https://jobs.tasnee.com/search", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Ceramics", careersUrl: "https://www.saudiceramics.com/en/careers/", sector: "energy-industrial", priority: 3 },
  { name: "Astra Industrial", careersUrl: "https://www.astraindustrial.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Alkhorayef Group", careersUrl: "https://www.alkhorayef.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Alturki Holding", careersUrl: "https://www.alturki.net/careers", sector: "energy-industrial", priority: 3 },
  { name: "Water and Electricity Company", careersUrl: "https://wec.sa/careers", sector: "energy-industrial", priority: 3 },

  /* ------------------------- healthcare providers ------------------------ */
  { name: "Mouwasat Medical Services", careersUrl: "https://www.mouwasat.com/en/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Dallah Health", careersUrl: "https://www.dallah-hospital.com/careers/index.html", sector: "healthcare-insurance", priority: 3 },
  { name: "Saudi German Health", careersUrl: "https://www.sghgroup.net/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Fakeeh Care Group", careersUrl: "https://careers.fakeeh.care/", sector: "healthcare-insurance", priority: 3, altUrls: ["https://careers.fakeeh.care/internal"] },
  { name: "National Guard Health Affairs", careersUrl: "https://ngha.med.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "King Fahad Medical City", careersUrl: "https://www.kfmc.med.sa/EN/Page/Pages/JoinUs.aspx", sector: "healthcare-insurance", priority: 3, altUrls: ["https://www.kfmc.med.sa/EN/ATS/Pages/Internship.aspx%20"] },
  { name: "Magrabi Hospitals", careersUrl: "https://www.magrabi.com/careers", sector: "healthcare-insurance", priority: 3 },

  /* --------------------------- education & research ---------------------- */
  { name: "King Saud University", careersUrl: "https://dfpa.ksu.edu.sa/ar/jobs", sector: "education-research", priority: 3 },
  { name: "King Abdulaziz University", careersUrl: "https://www.kau.edu.sa/careers", sector: "education-research", priority: 3 },
  { name: "Princess Nourah University", careersUrl: "https://pnu.edu.sa/en/jobs/Pages/default.aspx", sector: "education-research", priority: 3 },
  { name: "Saudi Electronic University", careersUrl: "https://www.seu.edu.sa/careers", sector: "education-research", priority: 3 },
  { name: "Misk Foundation", careersUrl: "https://misk.org.sa/careers/", sector: "education-research", priority: 3 },
  { name: "Tuwaiq Academy", careersUrl: "https://tuwaiq.edu.sa/careers", sector: "education-research", priority: 3 },

  /* -------------------------- retail, logistics, F&B --------------------- */
  { name: "Al Othaim Markets", careersUrl: "https://www.othaimmarkets.com/ar/about-us/careers", sector: "retail-consumer", priority: 3 },
  { name: "BinDawood Holding", careersUrl: "https://www.bindawoodholding.com/careers", sector: "retail-consumer", priority: 3 },
  { name: "United Electronics eXtra", careersUrl: "https://www.extra.com/careers", sector: "retail-consumer", priority: 3 },
  { name: "Cenomi", careersUrl: "https://centers.cenomi.com/sa-en/careers/", sector: "retail-consumer", priority: 3, altUrls: ["https://centers.cenomi.com/sa-en/opportunities-and-new-developments/"] },
  { name: "Herfy Food Services", careersUrl: "https://herfy.com/careers", sector: "retail-consumer", priority: 3 },
  { name: "Dur Hospitality", careersUrl: "https://www.dur.sa/careers", sector: "retail-consumer", priority: 3 },
  { name: "SMSA Express", careersUrl: "https://www.smsaexpress.com/career", sector: "aviation-transport", priority: 3 },
  { name: "Naqel Express", careersUrl: "https://www.naqelexpress.com/careers", sector: "aviation-transport", priority: 3 },
  { name: "Aramex", careersUrl: "https://www.aramex.com/ae/en/careers", sector: "aviation-transport", priority: 3 },
  { name: "Almajdouie", careersUrl: "https://www.almajdouie.com/careers", sector: "aviation-transport", priority: 3 },
  { name: "Seera Group", careersUrl: "https://www.seera.sa/careers", sector: "retail-consumer", priority: 2 },
  { name: "Almosafer", careersUrl: "https://www.almosafer.com/ar/careers", sector: "retail-consumer", priority: 3, careersEmail: "careers@almosafer.com" },

  /* ------------------------------ global tech ---------------------------- */
  { name: "Meta", careersUrl: "https://www.metacareers.com/jobsearch/", sector: "global-tech", priority: 3, altUrls: ["https://www.metacareers.com/careerprograms/students/"] },
  { name: "Amazon", careersUrl: "https://www.amazon.jobs/en/", sector: "global-tech", priority: 2 },
  { name: "Careem", careersUrl: "https://jobs.careem.com/", sector: "global-tech", priority: 2 },
  { name: "Delivery Hero", careersUrl: "https://careers.deliveryhero.com/", sector: "global-tech", priority: 3 },
  { name: "Visa", careersUrl: "https://visa.wd5.myworkdayjobs.com/Visa", sector: "global-tech", priority: 3, altUrls: ["https://corporate.visa.com/en/careers/early-careers.html"] },
  { name: "Mastercard", careersUrl: "https://careers.mastercard.com/us/en", sector: "global-tech", priority: 3, altUrls: ["https://careers.mastercard.com/us/en/early-careers", "https://careers.mastercard.com/us/en/talent-community", "https://careers.mastercard.com/us/en/leadpage?formId=fe9ud95ciji7mu64uivgqno1te&eventScheduleId=632c94d5b0eadd2bfc76192a&utm_campaign=campus"] },
  { name: "PayPal", careersUrl: "https://careers.pypl.com/home/default.aspx", sector: "global-tech", priority: 3, altUrls: ["https://careers.pypl.com/university-hiring/intern-hub/default.aspx", "https://careers.pypl.com/university-hiring/University-Overview/default.aspx#university-job-tiles-container-interns"] },
  { name: "Adobe", careersUrl: "https://careers.adobe.com/us/en", sector: "global-tech", priority: 3, altUrls: ["https://careers.adobe.com/us/en/university", "https://careers.adobe.com/us/en/jointalentcommunity"] },
  { name: "Qualcomm", careersUrl: "https://careers.qualcomm.com/careers?start=0&pid=446719884008&sort_by=timestamp", sector: "global-tech", priority: 3, altUrls: ["https://careers.qualcomm.com/careers/join"] },
  { name: "Intel", careersUrl: "https://intel.wd1.myworkdayjobs.com/External/page/6042070b79e01001f04fa9b468070000", sector: "global-tech", priority: 3, altUrls: ["https://intel.wd1.myworkdayjobs.com/External/page/f7af6f4ab7131001ecc380a588ca0000", "https://intel.wd1.myworkdayjobs.com/en-US/External/introduceYourself?landingPage=03340f04f5841001e516ffc97995000a", "https://intel.wd1.myworkdayjobs.com/en-US/External/job/Ireland-Leixlip/Manufacturing-Technician_JR0284021?shared_id=NTA3OGJmNzQtNjNiOS00MWYyLWJlNDItYjdhMDAyM2I2OWVh"] },
  { name: "NVIDIA", careersUrl: "https://www.nvidia.com/en-us/about-nvidia/careers/", sector: "global-tech", priority: 3 },
  { name: "Lenovo", careersUrl: "https://jobs.lenovo.com/en_US/careers", sector: "global-tech", priority: 3, altUrls: ["https://jobs.lenovo.com/en_US/careers/EarlyCareer", "https://jobs.lenovo.com/en_US/careers/Internship", "https://jobs.lenovo.com/en_US/careers/Locations"] },
  { name: "Juniper Networks", careersUrl: "https://careers.hpe.com/juniper", sector: "global-tech", priority: 3, altUrls: ["https://careers.hpe.com/us/en/students", "https://careers.hpe.com/us/en/jointalentcommunity"] },
  { name: "Veeam", careersUrl: "https://careers.veeam.com/", sector: "global-tech", priority: 3, altUrls: ["https://careers.veeam.com/early-careers", "https://careers.veeam.com/sales-careers", "https://careers.veeam.com/costa-rica"] },
  { name: "Commvault", careersUrl: "https://www.commvault.com/careers", sector: "global-tech", priority: 3, careersEmail: "recruitingteam@commvault.com", altUrls: ["https://www.commvault.com/careers/internships"] },
  { name: "OpenText", careersUrl: "https://careers.opentext.com/us/en", sector: "global-tech", priority: 3, careersEmail: "hr@opentext.com", altUrls: ["https://careers.opentext.com/us/en/studentsandgraduates", "https://careers.opentext.com/us/en/jointalentcommunity"] },

  /* --------------------------- security vendors -------------------------- */
  { name: "Forcepoint", careersUrl: "https://forcepoint.wd1.myworkdayjobs.com/external-careers", sector: "security-vendor", priority: 3 },
  { name: "Imperva", careersUrl: "https://careers.thalesgroup.com/global/en/search-results?keywords=imperva", sector: "security-vendor", priority: 3 },
  { name: "Varonis", careersUrl: "https://www.varonis.com/careers", sector: "security-vendor", priority: 3 },
  { name: "CyberArk", careersUrl: "https://jobs.paloaltonetworks.com/en/", sector: "security-vendor", priority: 3, altUrls: ["https://jobs.paloaltonetworks.com/early-in-career", "https://jobs.paloaltonetworks.com/en/Must-Know-Facts-from-an-Early-Career-Product-Manager", "https://paloaltonetworks.wd5.myworkdayjobs.com/en-US/panwexternalcareers/introduceYourself?clientRequestID=06f06ca6dae2441d99391ed600fc2265"] },
  { name: "Okta", careersUrl: "https://www.okta.com/company/careers/", sector: "security-vendor", priority: 3, altUrls: ["https://www.okta.com/company/careers/intern-program/"] },
  { name: "SailPoint", careersUrl: "https://www.sailpoint.com/company/careers/", sector: "security-vendor", priority: 3, altUrls: ["https://sailpoint.wd1.myworkdayjobs.com/SailPoint/jobs", "https://www.sailpoint.com/company/careers/engineering", "https://www.sailpoint.com/company/careers/sales"] },
  { name: "Delinea", careersUrl: "https://jobs.ashbyhq.com/delinea", sector: "security-vendor", priority: 3 },
  { name: "Group-IB", careersUrl: "https://www.group-ib.com/careers/", sector: "security-vendor", priority: 3, altUrls: ["https://www.group-ib.com/careers/internship/", "https://www.group-ib.com/careers/#vacancies"] },
  { name: "Infoblox", careersUrl: "https://www.infoblox.com/company/careers/", sector: "security-vendor", priority: 3, altUrls: ["https://efpv.fa.us6.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/join-talent-community"] },

  /* ------------- heavy co-op / graduate intake in Saudi ------------------- */
  /* Oilfield services and industrial primes run the largest structured        */
  /* cooperative-training and graduate-development intakes in the Kingdom,     */
  /* and most take engineering and IT students every semester.                 */
  { name: "SLB", careersUrl: "https://careers.slb.com/", sector: "energy-industrial", priority: 2, altUrls: ["https://careers.slb.com/early-careers", "https://careers.slb.com/early-careers/internships", "https://careers.slb.com/experienced-roles"] },
  { name: "Halliburton", careersUrl: "https://jobs.halliburton.com/", sector: "energy-industrial", priority: 2, altUrls: ["https://jobs.halliburton.com/content/students-and-recent-graduates/?locale=en_US"] },
  { name: "Baker Hughes", careersUrl: "https://careers.bakerhughes.com/global/en", sector: "energy-industrial", priority: 2, altUrls: ["https://careers.bakerhughes.com/global/en/Early-Careers-BakerHughes"] },
  { name: "Weatherford", careersUrl: "https://careers.weatherford.com/#en/sites/CX_1", sector: "energy-industrial", priority: 3 },
  { name: "NOV", careersUrl: "https://www.nov.com/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://www.nov.com/careers/early-career-development"] },
  { name: "Aramco Digital", careersUrl: "https://fa-exrn-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_3001", sector: "telecom-tech", priority: 1 },
  { name: "Siemens Energy", careersUrl: "https://jobs.siemens-energy.com/en_US/jobs", sector: "energy-industrial", priority: 2, altUrls: ["https://jobs.siemens-energy.com/en_US/jobs/SearchJobsStudents"] },
  { name: "Hitachi Energy", careersUrl: "https://www.hitachienergy.com/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://www.hitachienergy.com/careers/about-us/early-career"] },
  { name: "Emerson", careersUrl: "https://careers.emerson.com/", sector: "energy-industrial", priority: 3 },
  { name: "Rockwell Automation", careersUrl: "https://www.rockwellautomation.com/en-us/careers.html", sector: "energy-industrial", priority: 3, altUrls: ["https://www.rockwellautomation.com/en-us/company/careers/edge-student-early-career.html", "https://www.rockwellautomation.com/en-us/company/careers/edge-student-early-career/edge-student-programs.html", "https://www.rockwellautomation.com/en-us/company/careers/edge-student-early-career/edge-early-career.html"] },
  { name: "Yokogawa", careersUrl: "https://www.yokogawa.com/about/careers/", sector: "energy-industrial", priority: 3 },
  { name: "Johnson Controls Arabia", careersUrl: "https://jobs.johnsoncontrols.com/job-search", sector: "energy-industrial", priority: 3, altUrls: ["https://jobs.johnsoncontrols.com/early-careers", "https://jobs.johnsoncontrols.com/talent-community", "https://jobs.johnsoncontrols.com/#"] },
  { name: "Alstom", careersUrl: "https://jobsearch.alstom.com/", sector: "aviation-transport", priority: 3, altUrls: ["https://www.alstom.com/careers/students-graduates", "https://www.alstom.com/careers#global-opportunities"] },
  { name: "Saudi Business Machines", careersUrl: "https://www.sbm.com.sa/career-opportunities", sector: "telecom-tech", priority: 2, altUrls: ["https://www.sbm.com.sa/career-opportunities#main-content", "https://www.sbm.com.sa/career-opportunities#", "https://www.sbm.com.sa/career/co-op-internship-application"] },
  { name: "National Water Company", careersUrl: "https://www.nwc.com.sa/AR/OurCompany/Careers/Pages/default.aspx", sector: "energy-industrial", priority: 3 },
  { name: "SAL Saudi Logistics", careersUrl: "https://sal.sa/careers", sector: "aviation-transport", priority: 3 },
  { name: "Saudi Ground Services", careersUrl: "https://www.saudiags.com/career/", sector: "aviation-transport", priority: 3 },
  { name: "Savola Group", careersUrl: "https://www.savola.com/about-us/careers", sector: "retail-consumer", priority: 3 },
  { name: "NADEC", careersUrl: "https://www.nadec.com.sa/careers", sector: "retail-consumer", priority: 3 },
  { name: "Obeikan Investment Group", careersUrl: "https://www.obeikan.com.sa/careers", sector: "energy-industrial", priority: 3 },
  { name: "Rawabi Holding", careersUrl: "https://careers.rawabi.com/", sector: "energy-industrial", priority: 3 },
  { name: "Al Yamamah Steel", careersUrl: "https://www.alyamamahsteel.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Alessa Industries", careersUrl: "https://www.alessa.com.sa/careers", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Arabian Mining Services", careersUrl: "https://careers.maaden.com/gb/en", sector: "energy-industrial", priority: 3, altUrls: ["https://careers.maaden.com/gb/en/jointalentcommunity"] },
  { name: "Elm Academy", careersUrl: "https://elm.sa/ar/recruitment/sectors/Pages/default.aspx", sector: "telecom-tech", priority: 2 },
  { name: "National Information Center", careersUrl: "https://nic.gov.sa/careers", sector: "government", priority: 2 },
  { name: "Saudi Aramco Base Oil", careersUrl: "https://www.luberef.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Riyadh Metro (RCRC)", careersUrl: "https://www.rcrc.gov.sa/careers", sector: "aviation-transport", priority: 3 },
  { name: "KAUST Innovation", careersUrl: "https://www.kaust.edu.sa/en/error/404?404;https://www.kaust.edu.sa:443/en/careers", sector: "education-research", priority: 3, altUrls: ["https://www.kaust.edu.sa/ar/study/student-central"] },
  { name: "Saudi Aramco Shell Refinery", careersUrl: "https://www.sasref.com.sa/careers.html", sector: "energy-industrial", priority: 3 },
  { name: "Nesma & Partners", careersUrl: "https://www.nesmapartners.com/en/careers", sector: "energy-industrial", priority: 3 },
  { name: "Almabani General Contractors", careersUrl: "https://www.almabani.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Readymix", careersUrl: "https://saudireadymix.com/join-us/", sector: "energy-industrial", priority: 3 },
  { name: "Arabian Drilling", careersUrl: "https://jobs.arabdrill.com/search", sector: "energy-industrial", priority: 3, altUrls: ["https://jobs.arabdrill.com/talentcommunity/subscribe/?locale=en_US"] },
  { name: "Advanced Communications and Electronics Systems", careersUrl: "https://www.aces.com.sa/careers", sector: "telecom-tech", priority: 3 },
  { name: "Bupa Labs", careersUrl: "https://careers.bupa.com.sa/en/job-search-results/", sector: "healthcare-insurance", priority: 3, altUrls: ["https://www.bupa.com.sa/en/careers#"] },
  { name: "Saudi Aramco Nabors Drilling", careersUrl: "https://www.sandsp.com/employment.html", sector: "energy-industrial", priority: 3 },
  { name: "Petrofac", careersUrl: "https://www.petrofac.com/careers/find-a-job-at-petrofac", sector: "energy-industrial", priority: 3, altUrls: ["https://www.petrofac.com/careers/early-careers/"] },
  { name: "Wood", careersUrl: "https://careers.woodgroup.com/", sector: "energy-industrial", priority: 3, altUrls: ["https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions?lastSelectedFacet=AttributeChar4&mode=location&selectedFlexFieldsFacets=%22AttributeChar4%7CGraduates%3BInterns%3BCo-op+%28placement+students%29%3BTrainees%22", "https://careers.woodgroup.com/early-careers", "https://ehif.fa.em2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/tc-join"] },
  { name: "Worley", careersUrl: "https://www.worley.com/en/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://www.worley.com/en/careers/our-programs/internship", "https://www.worley.com/en/careers/our-programs/graduate", "https://www.worley.com/en/careers/our-programs"] },
  { name: "Jacobs", careersUrl: "https://careers.jacobs.com/en_US/careers", sector: "energy-industrial", priority: 3, altUrls: ["https://careers.jacobs.com/en_US/careers/EarlyCareers", "https://careers.jacobs.com/Talent"] },
  { name: "AECOM", careersUrl: "https://aecom.com/careers/", sector: "energy-industrial", priority: 3, altUrls: ["https://aecom.com/careers/graduates-and-early-careers/"] },
  { name: "Parsons", careersUrl: "https://jobs.parsons.com/", sector: "energy-industrial", priority: 3, altUrls: ["https://jobs.parsons.com/internships", "https://jobs.parsons.com/career-search?search=intern", "https://jobs.parsons.com/talent-community"] },
  { name: "Hill International", careersUrl: "https://www.hillintl.com/careers/", sector: "energy-industrial", priority: 3, altUrls: ["https://www.hillintl.com/careers/recent-graduates/"] },

  /* ---------------- additional Saudi employers (batch 3) ----------------- */
  /* Weighted toward Riyadh head offices and organisations with in-house IT.  */

  /* -- semi-government, authorities, funds -- */
  { name: "Saudi Data and AI Authority Academy", careersUrl: "https://sdaia.gov.sa/ar/SDAIA/SdaiaStrategies/Pages/EmploymentStrategy.aspx", sector: "government", priority: 2 },
  { name: "National Debt Management Center", careersUrl: "https://www.ndmc.gov.sa/ar/recruitment", sector: "government", priority: 3 },
  { name: "Saudi Export Development Authority", careersUrl: "https://saudiexports.sa/careers", sector: "government", priority: 3 },
  { name: "National Center for Privatization", careersUrl: "https://www.ncp.gov.sa/careers", sector: "government", priority: 3 },
  { name: "Saudi Contractors Authority", careersUrl: "https://sca.sa/careers", sector: "government", priority: 3 },
  { name: "National Center for Performance Measurement", careersUrl: "https://www.adaa.gov.sa/careers", sector: "government", priority: 3 },
  { name: "Quality of Life Program", careersUrl: "https://www.vision2030.gov.sa/careers", sector: "government", priority: 3 },
  { name: "Saudi Standards Metrology Authority", careersUrl: "https://www.saso.gov.sa/ar/mediacenter/Pages/JoinOurTeam.aspx", sector: "government", priority: 3 },
  { name: "General Authority of Foreign Trade", careersUrl: "https://gaft.gov.sa/employment-and-training", sector: "government", priority: 3 },
  { name: "Saudi Food Bank", careersUrl: "https://etaam.org.sa/careers", sector: "government", priority: 3 },
  { name: "Real Estate General Authority", careersUrl: "https://rega.gov.sa/careers", sector: "government", priority: 3 },
  { name: "National Housing Strategy Office", careersUrl: "https://www.housing.sa/careers", sector: "government", priority: 3 },
  { name: "Saudi Water Partnership Company", careersUrl: "https://www.sharakat.com.sa/careers/", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Grains Organization", careersUrl: "https://www.sago.gov.sa/careers", sector: "government", priority: 3 },
  { name: "Public Transport Authority", careersUrl: "https://tga.gov.sa/en/about-tga/recruitment", sector: "aviation-transport", priority: 3 },

  /* -- PIF portfolio and giga-project subsidiaries -- */
  { name: "Diriyah Gate Development Authority", careersUrl: "https://www.dgda.gov.sa/en/careers", sector: "giga-project", priority: 2 },
  { name: "King Abdullah Financial District", careersUrl: "https://www.kafd.sa/en/careers", sector: "giga-project", priority: 2 },
  { name: "Boutique Group", careersUrl: "https://fa-eute-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1", sector: "giga-project", priority: 3 },
  { name: "Asfar", careersUrl: "https://asfar.com/careers/", sector: "retail-consumer", priority: 3 },
  { name: "Saudi Coffee Company", careersUrl: "https://www.saudicoffee.com/careers/", sector: "retail-consumer", priority: 3 },
  { name: "Halal Products Development Company", careersUrl: "https://hpdc.sa/en/careers", sector: "retail-consumer", priority: 3 },
  { name: "Saudi Egyptian Investment Company", careersUrl: "https://seic.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Jada Fund of Funds", careersUrl: "https://www.jada.com.sa/career", sector: "banking-fintech", priority: 3 },
  { name: "Saudi Real Estate Refinance Company", careersUrl: "https://srco.com.sa/en/careers", sector: "banking-fintech", priority: 3 },
  { name: "Tahakom Investments", careersUrl: "https://tahakominvestments.com/careers", sector: "telecom-tech", priority: 3 },
  { name: "Saudi Information Technology Academy", careersUrl: "https://sita.org.sa/careers", sector: "education-research", priority: 3 },
  { name: "NEOM Tech and Digital", careersUrl: "https://careers.neom.com/careers", sector: "telecom-tech", priority: 1, altUrls: ["https://careers.neom.com/careers/join?domain=neom.com&hl=en"] },
  { name: "Tonomus", careersUrl: "https://www.tonomus.neom.com/careers", sector: "telecom-tech", priority: 2 },
  { name: "Alat Semiconductors", careersUrl: "https://alat.com/en/careers/", sector: "telecom-tech", priority: 2 },
  { name: "Humain", careersUrl: "https://www.humain.com/careers", sector: "telecom-tech", priority: 1 },

  /* -- banks, finance, insurance -- */
  { name: "Saudi Awwal Bank Digital", careersUrl: "https://www.sab.com/en/about-us/careers/", sector: "banking-fintech", priority: 2, altUrls: ["https://www.sab.com/en/about-us/careers/graduate-opportunities/"] },
  { name: "Alrajhi Capital", careersUrl: "https://alrajhi-capital.sa/about-us/about-us-careers", sector: "banking-fintech", priority: 3, careersEmail: "careers@alrajhi-capital.sa" },
  { name: "Albilad Capital", careersUrl: "https://www.albiladcapital.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Yaqeen Capital", careersUrl: "https://www.yaqeen.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Osool and Bakheet Investment", careersUrl: "https://www.obic.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "SEDCO Capital", careersUrl: "https://sedcocapital.com/careers-landing/", sector: "banking-fintech", priority: 3 },
  { name: "Musharaka Capital", careersUrl: "https://musharaka.sa/en/contact/careers/", sector: "banking-fintech", priority: 3 },
  { name: "Tamweel Aloula", careersUrl: "https://www.tamweelaloula.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Saudi Home Loans", careersUrl: "https://www.saudihomeloans.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Amlak International", careersUrl: "https://www.amlak.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Deutsche Gulf Finance", careersUrl: "https://www.dgf.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Raqamyah", careersUrl: "https://raqamyah.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Tasheel Finance", careersUrl: "https://www.tasheelfinance.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Baianat", careersUrl: "https://baianat.com.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Tweeq", careersUrl: "https://tweeq.sa/careers", sector: "banking-fintech", priority: 3 },
  { name: "Drahim", careersUrl: "https://drahim.sa/join", sector: "banking-fintech", priority: 3 },
  { name: "Wataniya Insurance", careersUrl: "https://careers.wataniya.com.sa/", sector: "healthcare-insurance", priority: 3 },
  { name: "ACIG Insurance", careersUrl: "https://www.acig.com.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Gulf Union Alahlia", careersUrl: "https://www.gulfunion-saudi.com/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Saudi Enaya", careersUrl: "https://www.saudienaya.com/careers", sector: "healthcare-insurance", priority: 3, careersEmail: "career@saudienaya.com" },

  /* -- technology, telecom, digital services -- */
  { name: "stc Bank", careersUrl: "https://stcbank.com.sa/web/guest/job-application", sector: "banking-fintech", priority: 2 },
  { name: "Sahm Capital", careersUrl: "https://www.sahmcapital.com/about/careers", sector: "banking-fintech", priority: 3 },
  { name: "Cipher Saudi", careersUrl: "https://www.cipher.com.sa/careers", sector: "security-vendor", priority: 2 },
  { name: "Saudi Technology Ventures", careersUrl: "https://stv.vc/careers", sector: "banking-fintech", priority: 3 },
  { name: "Wa'ed Ventures Portfolio", careersUrl: "https://waedventures.com/careers", sector: "banking-fintech", priority: 3 },
  { name: "Tamkeen Technologies", careersUrl: "https://tamkeentech.sa/careers", sector: "telecom-tech", priority: 2, altUrls: ["https://tamkeentech.sa/careers/open-opportunities"] },
  { name: "Sary Technology", careersUrl: "https://sary.zenats.com/en", sector: "retail-consumer", priority: 3 },
  { name: "Tarabut", careersUrl: "https://careers.tarabut.com/jobs/Careers", sector: "banking-fintech", priority: 3 },
  { name: "Nearpay", careersUrl: "https://nearpay.io/career", sector: "banking-fintech", priority: 3, careersEmail: "hr@nearpay.io" },
  { name: "Ratio", careersUrl: "https://ratio.sa/jobs", sector: "banking-fintech", priority: 3 },
  { name: "Sadeem Technology", careersUrl: "https://sadeem.tech/careers", sector: "telecom-tech", priority: 3 },
  { name: "Takamol Business Services", careersUrl: "https://www.takamolholding.com/en/careers", sector: "telecom-tech", priority: 2 },
  { name: "Bayanat Al-Oula", careersUrl: "https://bayanat.sa/careers/", sector: "telecom-tech", priority: 3 },
  { name: "Alfa Technologies", careersUrl: "https://alfa-tech.sa/careers", sector: "telecom-tech", priority: 3 },
  { name: "Etihad Etisalat Digital", careersUrl: "https://careers.mobily.com.sa/en/sites/opportunities", sector: "telecom-tech", priority: 2 },
  { name: "Rakiza", careersUrl: "https://rakiza.sa/careers", sector: "telecom-tech", priority: 3 },
  { name: "Nasdaq Gulf Technology", careersUrl: "https://www.nasdaq.com/about/careers", sector: "global-tech", priority: 3 },
  { name: "Zain Business", careersUrl: "https://sa.zain.com/about/careers/", sector: "telecom-tech", priority: 2, altUrls: ["https://sa.zain.com/about/join-zain/", "https://sa.zain.com/about/co-op-program/"] },
  { name: "Integrated Digital Systems", careersUrl: "https://www.ids.com.sa/careers", sector: "telecom-tech", priority: 3 },

  /* -- healthcare, education, services -- */
  { name: "Almana General Hospitals", careersUrl: "https://www.almanahospital.com.sa/en/careers", sector: "healthcare-insurance", priority: 3, careersEmail: "career@almanahospital.com.sa" },
  { name: "National Medical Care", careersUrl: "https://care.med.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Sulaiman Al Rajhi University", careersUrl: "https://sr.zohorecruit.sa/jobs/Careers", sector: "education-research", priority: 3 },
  { name: "Alfaisal University Research", careersUrl: "https://jobs.alfaisal.edu/", sector: "education-research", priority: 3, altUrls: ["https://jobs.alfaisal.edu/col/"] },
  { name: "Dar Al Hekma University", careersUrl: "https://www.dah.edu.sa/en/careers/pages/default.aspx", sector: "education-research", priority: 3, careersEmail: "jobs@dah.edu.sa", altUrls: ["https://www.dah.edu.sa/en/students/Pages/default.aspx", "https://www.dah.edu.sa/en/about/Pages/Graduate-Studies-Research-and-Business-Division.aspx"] },
  { name: "Al Yamamah University", careersUrl: "https://edugate.yu.edu.sa/yu/ui/guest/application_online/index/forwardNewApplicationOnlineIndex.faces;jsessionid=RXZolw3GjVdeJ0N8IoMPtNBVMkQUfH0RvRqlyDXY7yKLlHwv9FFK!-1396078192", sector: "education-research", priority: 3, altUrls: ["https://yu.edu.sa/wp-content/uploads/2024/03/YU-Graduates-Attributes-2023-24.pdf"] },
  { name: "Prince Sultan Military Medical City", careersUrl: "https://psmmc.med.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "King Khaled Eye Specialist Hospital", careersUrl: "https://kkesh.med.sa/careers", sector: "healthcare-insurance", priority: 3 },
  { name: "Elm Education", careersUrl: "https://elm.sa/ar/recruitment/sectors/Pages/default.aspx", sector: "education-research", priority: 2 },
  { name: "Riyadh Schools", careersUrl: "https://www.riyadhschools.edu.sa/careers", sector: "education-research", priority: 3 },

  /* -- industrial, construction, logistics -- */
  { name: "Saudi Arabian Parsons", careersUrl: "https://jobs.parsons.com/", sector: "energy-industrial", priority: 3, altUrls: ["https://jobs.parsons.com/internships", "https://jobs.parsons.com/career-search?search=intern", "https://jobs.parsons.com/talent-community"] },
  { name: "Al Bawani", careersUrl: "https://albawani.net/careers", sector: "energy-industrial", priority: 3 },
  { name: "El Seif Engineering", careersUrl: "https://www.elseif.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Shibh Al Jazira Contracting", careersUrl: "https://sajco.com/careers/", sector: "energy-industrial", priority: 3, altUrls: ["https://sajco.com/careers/#"] },
  { name: "Freyssinet Saudi Arabia", careersUrl: "https://www.freyssinetsaudi.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Pan Kingdom", careersUrl: "https://sapac.com.sa/careers/", sector: "energy-industrial", priority: 3 },
  { name: "Abdullah Al Othaim Investment", careersUrl: "https://www.othaim.com/careers", sector: "retail-consumer", priority: 3 },
  { name: "Al Fanar Electric", careersUrl: "https://jobs.alfanar.com/alfanar/go/All-Openings/4442101/", sector: "energy-industrial", priority: 3 },
  { name: "Middle East Paper Company", careersUrl: "https://www.mep.co/Website/En/careers/", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Cement", careersUrl: "https://www.saudicement.com.sa/careers", sector: "energy-industrial", priority: 3 },
  { name: "Yamama Cement", careersUrl: "https://www.yamamacement.com/en/careers", sector: "energy-industrial", priority: 3 },
  { name: "Arabian Cement", careersUrl: "https://www.arabiancement.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Steel Pipe", careersUrl: "https://www.sspc.com.sa/careers", sector: "energy-industrial", priority: 3 },
  { name: "Zamil Steel", careersUrl: "https://www.zamilsteel.com/jobs", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Airlines Cargo", careersUrl: "https://www.saudiacargo.com/en/careers", sector: "aviation-transport", priority: 3 },
  { name: "Riyadh Cables", careersUrl: "https://www.riyadhcables.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Saudi Arabian Trading and Construction", careersUrl: "https://www.satco.com.sa/careers", sector: "energy-industrial", priority: 3 },
  { name: "Nesma Trading", careersUrl: "https://www.nesma.com/careers", sector: "energy-industrial", priority: 3, careersEmail: "jobs@nesma.com" },
  { name: "Al Rashid Trading", careersUrl: "https://www.alrashidtrading.com/careers", sector: "energy-industrial", priority: 3 },
  { name: "Bin Quraya", careersUrl: "https://www.binquraya.com/careers", sector: "energy-industrial", priority: 3 },

  /* -- global tech and consulting with Riyadh delivery centres -- */
  { name: "Accenture Saudi Advanced Technology", careersUrl: "https://www.accenture.com/sa-en/careers", sector: "consulting", priority: 1, altUrls: ["https://www.accenture.com/sa-en/careers/life-at-accenture/internships-students", "https://www.accenture.com/sa-en/careers/life-at-accenture/entry-level"] },
  { name: "IBM Saudi Arabia", careersUrl: "https://www.ibm.com/careers/search", sector: "global-tech", priority: 2, altUrls: ["https://www.ibm.com/careers/career-opportunities", "https://www.ibm.com/careers/internships"] },
  { name: "Microsoft Arabia", careersUrl: "https://apply.careers.microsoft.com/careers?start=0&pid=1970393556961344&sort_by=timestamp", sector: "global-tech", priority: 1, altUrls: ["https://apply.careers.microsoft.com/careers/join"] },
  { name: "Google Cloud Saudi", careersUrl: "https://www.google.com/about/careers/applications/", sector: "global-tech", priority: 2, altUrls: ["https://www.google.com/about/careers/applications/students"] },
  { name: "Oracle Saudi Arabia", careersUrl: "https://careers.oracle.com/en/sites/jobsearch", sector: "global-tech", priority: 2 },
  { name: "SAP Saudi Arabia", careersUrl: "https://jobs.sap.com/viewalljobs/", sector: "global-tech", priority: 2, careersEmail: "careers@sap.com", altUrls: ["https://jobs.sap.com/content/Students-and-Graduates/?locale=en_US", "https://performancemanager5.successfactors.eu/sf/careers?company=SAP"] },
  { name: "Cognizant", careersUrl: "https://careers.cognizant.com/global-en/", sector: "consulting", priority: 3, altUrls: ["https://careers.cognizant.com/global-en/pathways-to-cognizant/students-and-new-grads/", "https://careers.cognizant.com/global-en/talent-community/", "https://careers.cognizant.com/global-en/blog/life-at-cognizant/where-opportunities-truly-feel-equal-maria-s-life-at-cognizant/"] },
  { name: "LTIMindtree", careersUrl: "https://www.ltm.com/careers", sector: "consulting", priority: 3 },
  { name: "Zensar", careersUrl: "https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs", sector: "consulting", priority: 3, altUrls: ["https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/requisitions/", "https://fa-etvl-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/jobs?lastSelectedFacet=LOCATIONS&selectedLocationsFacet=300000000435067"] },
  { name: "NTT DATA", careersUrl: "https://careers.nttdata.com/", sector: "global-tech", priority: 2 },
  { name: "Fujitsu", careersUrl: "https://www.jobs.global.fujitsu.com/search?searchResultView=LIST", sector: "global-tech", priority: 3, altUrls: ["https://global.fujitsu/en-global/careers#opportunities"] },
  { name: "Hitachi Vantara", careersUrl: "https://www.hitachivantara.com/en-us/company/careers", sector: "global-tech", priority: 3 },
  { name: "Ericsson Saudi", careersUrl: "https://jobs.ericsson.com/careers?start=0&pid=563121776072318&sort_by=hot", sector: "global-tech", priority: 2, altUrls: ["https://jobs.ericsson.com/careers/join?domain=ericsson.com"] },
  { name: "Nokia Saudi", careersUrl: "https://www.nokia.com/careers/", sector: "global-tech", priority: 2 },
  { name: "ZTE", careersUrl: "https://www.zte.com.cn/global/careers.html", sector: "global-tech", priority: 3 },
  { name: "Motorola Solutions", careersUrl: "https://motorolasolutions.wd5.myworkdayjobs.com/Careers", sector: "global-tech", priority: 3, altUrls: ["https://www.motorolasolutions.com/en_us/about/careers.html#phnnav_internship-program", "https://motorolasolutions.wd5.myworkdayjobs.com/Careers?q=Internship#xd_co_f=MGM2OTU4MzMtMGY5ZS00MWNiLTk1YTYtMmFmNGFlNDQ1ZmZk~"] },
  { name: "Genesys", careersUrl: "https://www.genesys.com/company/careers", sector: "global-tech", priority: 3 },
  { name: "Avaya", careersUrl: "https://careers.avaya.com/search/?createNewAlert=false&q=&optionsFacetsDD_title=&optionsFacetsDD_location=&optionsFacetsDD_department=Engineering", sector: "global-tech", priority: 3 },
  { name: "Teradata", careersUrl: "https://careers.teradata.com/jobs", sector: "global-tech", priority: 3, careersEmail: "global.careers@teradata.com" },
  { name: "SAS Institute", careersUrl: "https://www.sas.com/en_us/careers.html", sector: "global-tech", priority: 3, careersEmail: "recruitingsupport@sas.com", careersEmails: [{ address: "careersaccessibility@sas.com", purpose: "General applications" }] },
  { name: "Palantir", careersUrl: "https://www.palantir.com/careers/", sector: "global-tech", priority: 3, altUrls: ["https://www.palantir.com/careers/students-and-early-talent/", "https://www.palantir.com/careers/meritocracy-fellowship/"] },
  { name: "Cloudflare Saudi", careersUrl: "https://www.cloudflare.com/careers/jobs/", sector: "security-vendor", priority: 3 },
  { name: "Dynatrace", careersUrl: "https://www.dynatrace.com/careers/jobs/", sector: "global-tech", priority: 3, careersEmail: "careers@dynatrace.com", altUrls: ["https://www.dynatrace.com/careers/early-careers/"] },
  { name: "Datadog", careersUrl: "https://careers.datadoghq.com/", sector: "global-tech", priority: 3, altUrls: ["https://careers.datadoghq.com/early-careers/", "https://careers.datadoghq.com/early-careers"] },
  { name: "Splunk Saudi", careersUrl: "https://careers.cisco.com/global/en/splunk", sector: "security-vendor", priority: 3 },
  { name: "Nutanix Arabia", careersUrl: "https://careers.nutanix.com/en/", sector: "global-tech", priority: 3, careersEmail: "recruiting@nutanix.com" },
  { name: "Cohesity", careersUrl: "https://www.cohesity.com/careers/", sector: "global-tech", priority: 3, altUrls: ["https://www.cohesity.com/careers/university-and-internship-program/"] },
  { name: "Rubrik", careersUrl: "https://www.rubrik.com/company/careers", sector: "global-tech", priority: 3 },
  { name: "Fortinet Saudi", careersUrl: "https://www.fortinet.com/corporate/careers", sector: "security-vendor", priority: 2, altUrls: ["https://www.fortinet.com/customers/coop"] },
  { name: "Mimecast", careersUrl: "https://careers.mimecast.com/en/", sector: "security-vendor", priority: 3, careersEmail: "careers@mimecast.com", altUrls: ["https://careers.mimecast.com/en/teams/early-careers/"] },
  { name: "Cloudera Saudi", careersUrl: "https://cloudera.wd5.myworkdayjobs.com/External_Career", sector: "global-tech", priority: 3 },
  { name: "Red Hat Saudi", careersUrl: "https://www.redhat.com/en/jobs", sector: "global-tech", priority: 2 },
  { name: "Canonical", careersUrl: "https://canonical.com/careers/all", sector: "global-tech", priority: 3, altUrls: ["https://canonical.com/careers/early-careers", "https://canonical.com/careers/6103331", "https://canonical.com/careers/7048263"] },
  { name: "SUSE", careersUrl: "https://www.suse.com/careers/", sector: "global-tech", priority: 3 },
  // Riyadh cyber / cloud employers missing from the list (2026-10-21), each
  // URL checked to answer. Their boards are found by the repair checker
  // (scripts/fix-sources.ts) and the monthly sources:discover.
  { name: "Check Point", careersUrl: "https://www.checkpoint.com/careers/", sector: "security-vendor", priority: 2 },
  { name: "Inspira Enterprise", careersUrl: "https://inspiraenterprise.com/careers", sector: "security-vendor", priority: 2 },
  { name: "Recorded Future", careersUrl: "https://www.recordedfuture.com/work-with-us", sector: "security-vendor", priority: 3 },
  { name: "Spire Solutions", careersUrl: "https://www.spiresolutions.com/careers/", sector: "security-vendor", priority: 3 },
  { name: "Seclore", careersUrl: "https://www.seclore.com/careers/", sector: "security-vendor", priority: 3 },
  { name: "Saudi Cloud Computing Company (SCCC)", careersUrl: "https://sccc.sa/en", sector: "telecom-tech", priority: 2 },
  { name: "EzdiTek", careersUrl: "https://ezditek.com/", sector: "telecom-tech", priority: 2 },
  { name: "TAQNIA", careersUrl: "https://www.taqnia.com/", sector: "telecom-tech", priority: 2 },
  { name: "Gulf Business Machines (GBM)", careersUrl: "https://www.gbmme.com/", sector: "telecom-tech", priority: 2 },
  { name: "Saudi Federation for Cybersecurity and Programming (SAFCSP)", careersUrl: "https://safcsp.org.sa/", sector: "government", priority: 2 },
  { name: "Protiviti", careersUrl: "https://www.protiviti.com/sa-en/careers", sector: "consulting", priority: 2 },
];

/** Company count by sector, used by the sources page in the UI. */
export function sectorCounts(): Record<Sector, number> {
  const counts = {} as Record<Sector, number>;
  for (const c of COMPANIES) counts[c.sector] = (counts[c.sector] ?? 0) + 1;
  return counts;
}

/**
 * Whether an employer hires globally.
 *
 * Drives the ingest relevance filter: a Saudi-headquartered employer is allowed
 * through with an unstated location (it hires here by default), while a global
 * employer must name a Saudi location or a single Workday tenant would import
 * thousands of irrelevant rows.
 */
const GLOBAL_SECTORS = new Set<Sector>(["global-tech", "security-vendor", "consulting"]);

const GLOBAL_OVERRIDES = new Set([
  "Thales", "Airbus", "Boeing", "Lockheed Martin", "RTX (Raytheon)",
  "Northrop Grumman", "L3Harris", "BAE Systems", "Leonardo", "Lucid Motors",
  "Alshaya Group", "Capgemini", "Wipro", "Infosys",
  "Tata Consultancy Services", "Tech Mahindra", "HCLTech", "Atos",
  "DXC Technology", "Injazat / Core42", "Giza Systems", "Gulf International Bank",
]);

/** Saudi-owned companies that sit in an otherwise-global sector. */
const KSA_OVERRIDES = new Set([
  "sirar by stc", "SITE (Saudi Information Technology Company)",
  "Innovative Solutions", "Cipher (stc group)", "spiderSilk",
  "SAMI (Saudi Arabian Military Industries)",
]);

/**
 * A name that states the employer is the Saudi entity.
 *
 * "Accenture" is a global employer; "Accenture Saudi Advanced Technology" is
 * its Riyadh arm, and its board lists Riyadh roles. Twenty-eight sources were
 * tagged global purely because the parent sector is global, which would have
 * thrown away their untagged local postings.
 */
const SAUDI_NAMED = /\b(saudi|saudia|ksa|arabia|arabian|riyadh|jeddah|dammam|khobar|dhahran)\b|السعود|الرياض/i;

export function isGlobalEmployer(company: CompanySeed): boolean {
  if (KSA_OVERRIDES.has(company.name)) return false;
  if (SAUDI_NAMED.test(company.name)) return false;
  return GLOBAL_SECTORS.has(company.sector) || GLOBAL_OVERRIDES.has(company.name);
}

/** Whether a company name alone marks it as the Saudi entity. */
export function nameSaysSaudi(name: string): boolean {
  return SAUDI_NAMED.test(name ?? "");
}
