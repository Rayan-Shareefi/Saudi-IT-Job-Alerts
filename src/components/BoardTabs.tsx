"use client";

import Link from "next/link";
import { TabScroller } from "./TabScroller";

export interface TabDef {
  id: string;
  label: string;
  hint: string;
  count?: number;
}

/**
 * Board tabs, in the order the user reads them: the verified list, what they
 * saved, the list split by where it came from, then the queues that need a
 * person, then the tools.
 */
export const TABS: TabDef[] = [
  { id: "all", label: "All jobs", hint: "Every verified cyber / cloud vacancy in Riyadh, one card per vacancy" },
  { id: "saved", label: "Saved", hint: "Jobs you saved or applied to - never removed automatically" },
  { id: "company", label: "Company sites", hint: "Verified vacancies whose best source is the employer's own site" },
  { id: "linkedin", label: "LinkedIn", hint: "LinkedIn job listings and company hiring posts" },
  { id: "boards", label: "Job boards", hint: "JSearch (Indeed, Bayt, Glassdoor...), Careerjet and Jooble" },
  { id: "unclassified", label: "Unclassified", hint: "Could not be proven either way - snippet only, location or scope unclear" },
  { id: "review", label: "Review", hint: "The checks disagree - your Keep / Hide decides" },
  { id: "senior", label: "5+ years", hint: "Verified roles that state 5 or more years - kept for later" },
  { id: "hidden", label: "Hidden", hint: "Out of scope, too old, not Riyadh, not a job - with the reason, restorable" },
  { id: "human", label: "Human intervene", hint: "Employers no reader can reach - with a working link" },
  { id: "sites", label: "Site report", hint: "Every site that could not be read, why, and the fix" },
  { id: "email", label: "Apply by email", hint: "Employers with no board - send a CV instead" },
  { id: "urls", label: "Check URLs", hint: "Re-check every employer's careers URL" },
  { id: "failing", label: "Failing sources", hint: "Sources erroring on the last run" },
];

export function BoardTabs({ active, counts }: { active: string; counts: Record<string, number> }) {
  return (
    <div className="mb-4">
      <TabScroller label="Board sections">
        {TABS.map((t) => {
          const on = t.id === active;
          const count = counts[t.id];
          return (
            <Link
              key={t.id}
              href={t.id === "all" ? "/" : `/?tab=${t.id}`}
              role="tab"
              aria-selected={on}
              aria-current={on ? "page" : undefined}
              title={t.hint}
              className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 py-2 text-[13px] font-semibold no-underline"
              style={{
                background: on ? "var(--accent)" : "var(--surface)",
                color: on ? "var(--accent-on)" : "var(--ink-2)",
                border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius)",
              }}
            >
              {t.label}
              {typeof count === "number" && (
                <span
                  className="nums px-1.5 text-[11px]"
                  style={{
                    background: on ? "rgb(255 255 255 / 0.22)" : "var(--surface-2)",
                    color: on ? "var(--accent-on)" : "var(--ink-3)",
                    borderRadius: "999px",
                  }}
                >
                  {count}
                </span>
              )}
            </Link>
          );
        })}
      </TabScroller>
    </div>
  );
}
