import type { ScopeArea } from "../scope";

/** What a model returns, before anything is believed. */
export interface Answer {
  is_job_posting: boolean;
  not_job_reason?: string | null;
  scope: "cybersecurity" | "cloud" | "both" | "neither" | "unclear";
  scope_quotes: string[];
  out_reason?: string | null;
  focus?: string[];
  min_years: number | null;
  years_quote: string | null;
  programme: "coop" | "internship" | "graduate" | "none";
  programme_quote: string | null;
  location: "riyadh" | "saudi_other" | "outside_saudi" | "not_stated";
  location_quote: string | null;
  confidence: "high" | "medium" | "low";
  /** Senior reviewer only. */
  decision?: "add" | "dont_add" | "unclassified";
  reasoning?: string;
}

export type Role = "juror" | "senior";

/**
 * A model's answer after the evidence check (verify.ts). Only claims whose
 * quote was found in the posting - and says what the claim says - survive;
 * everything else is null, i.e. an abstention.
 */
export interface Vote {
  provider: string;
  model: string;
  role: Role;
  isJob: boolean | null;
  scope: "in" | "out" | "unclear" | null;
  area: ScopeArea | null;
  focus: string[];
  /** Verified quotes supporting the scope claim. */
  evidence: string[];
  minYears: number | null;
  yearsEvidence: string | null;
  programme: "coop" | "internship" | null;
  programmeEvidence: string | null;
  riyadh: boolean | null;
  locationEvidence: string | null;
  decision: "add" | "dont_add" | "unclassified" | null;
  /** Quotes the model gave that are not in the posting. */
  hallucinated: number;
}

export interface JudgeInput {
  title: string;
  company: string;
  location: string;
  text: string;
  textQuality: string;
}

export class ProviderUnavailable extends Error {
  constructor(provider: string, why: string) {
    super(`${provider}: ${why}`);
    this.name = "ProviderUnavailable";
  }
}

export class ProviderQuotaHit extends Error {
  constructor(provider: string) {
    super(`${provider}: free quota reached for now`);
    this.name = "ProviderQuotaHit";
  }
}
