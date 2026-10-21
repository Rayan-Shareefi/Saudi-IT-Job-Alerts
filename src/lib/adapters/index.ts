import {
  ashby,
  bamboohr,
  greenhouse,
  lever,
  personio,
  recruitee,
  smartrecruiters,
  workable,
  type Adapter,
} from "./ats";
import { oraclecloud, successfactors, taleo, workday } from "./enterprise";
import { browser, jsonld, rss } from "./generic";
import { llm } from "./llm";
import { careerjet, jooble, jsearch } from "./aggregators";
import { linkedin } from "./linkedin";
import { linkedinPosts } from "./linkedin-posts";
import { workableSearch } from "./workable-search";
import { sabbar } from "./sabbar";
import { telegram } from "./telegram";
import { linkedinCompanies } from "./linkedin-companies";

export const ADAPTERS: Record<string, Adapter> = {
  // company-hosted applicant tracking systems
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  recruitee,
  bamboohr,
  personio,
  // enterprise recruiting platforms
  workday,
  oraclecloud,
  successfactors,
  taleo,
  // generic fallbacks
  jsonld,
  rss,
  browser,
  // reads the page as text via Claude when nothing structured exists
  llm,
  // multi-employer APIs
  jooble,
  jsearch,
  careerjet,
  // LinkedIn public listings (no login); laptop only, see linkedin.ts
  linkedin,
  // company hiring posts, secondary account, laptop only
  "linkedin-posts": linkedinPosts,
  // company pages, no login: their posts, and their ids for job searches
  "linkedin-companies": linkedinCompanies,
  // every employer hiring in Riyadh through Workable (public search, free)
  "workable-search": workableSearch,
  // Sabbar, a Saudi job platform: its public job sitemap, then the job pages
  sabbar,
  // Saudi job channels on Telegram (public channel pages), with their articles
  telegram,
};

export type { Adapter };
export { MissingCredential, QuotaExceeded } from "./aggregators";
export { MissingLlmKey } from "./llm";
