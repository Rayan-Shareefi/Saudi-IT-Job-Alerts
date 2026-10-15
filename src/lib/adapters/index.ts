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
};

export type { Adapter };
export { MissingCredential, QuotaExceeded } from "./aggregators";
export { MissingLlmKey } from "./llm";
