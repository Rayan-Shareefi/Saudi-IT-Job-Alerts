/**
 * Which API keys are actually usable.
 *
 * Reports presence and length only - never a value - so it is safe to run and
 * safe to paste the output anywhere.
 *
 * It exists because "set" and "usable" are not the same thing, and the
 * difference is invisible from the app. A variable left in place from
 * .env.example as `JOOBLE_API_KEY=` is present, is a perfectly good string, and
 * is worth nothing; the adapter then reports "missing JOOBLE_API_KEY" while the
 * line is right there in the file.
 *
 *   npx tsx scripts/check-keys.ts
 */
import { config } from "dotenv";

// .env.local first (what Next.js and the laptop use), then .env.
config({ path: ".env.local", quiet: true });
config({ quiet: true });

interface Check {
  name: string;
  what: string;
  optional?: boolean;
}

const KEYS: Check[] = [
  { name: "NEXT_PUBLIC_SUPABASE_URL", what: "database" },
  { name: "NEXT_PUBLIC_SUPABASE_ANON_KEY", what: "database, read path" },
  { name: "SUPABASE_SERVICE_ROLE_KEY", what: "database, write path" },
  { name: "JSEARCH_OPENWEBNINJA_KEY", what: "JSearch bought direct from openwebninja.com", optional: true },
  { name: "JSEARCH_OPENWEBNINJA_KEY_2", what: "second OpenWeb Ninja account", optional: true },
  { name: "JSEARCH_RAPIDAPI_KEY", what: "JSearch bought on RapidAPI", optional: true },
  { name: "JSEARCH_RAPIDAPI_KEY_2", what: "second RapidAPI account", optional: true },
  { name: "JSEARCH_PROVIDER", what: "reads the legacy names as OpenWeb Ninja keys", optional: true },
  { name: "JOOBLE_API_KEY", what: "Jooble tab", optional: true },
  { name: "CAREERJET_AFFID", what: "Careerjet tab", optional: true },
  { name: "RESEND_API_KEY", what: "the email digest", optional: true },
  { name: "DIGEST_TO", what: "who the digest goes to", optional: true },
  { name: "REMOVAL_SECRET", what: "removing postings and deciding URLs", optional: true },
  { name: "CRON_SECRET", what: "scheduled runs, and the removal fallback", optional: true },
  { name: "GEMINI_API_KEY", what: "AI jury: Gemini + Gemma", optional: true },
  { name: "GROQ_API_KEY", what: "AI jury + senior reviewer (free: console.groq.com)", optional: true },
  { name: "DIGEST_FROM", what: "email sender (blank = Resend sandbox sender)", optional: true },
  { name: "APP_URL", what: "link in the emails", optional: true },
  { name: "LINKEDIN_ENABLED", what: "LinkedIn listings (laptop only)", optional: true },
  { name: "LINKEDIN_POSTS_ENABLED", what: "LinkedIn hiring posts (laptop only)", optional: true },
  { name: "LINKEDIN_EMAIL", what: "secondary account, re-sign-in (laptop only)", optional: true },
  { name: "LINKEDIN_PASSWORD", what: "secondary account, re-sign-in (laptop only)", optional: true },
  { name: "GH_DISPATCH_TOKEN", what: "website buttons start GitHub runs (Vercel)", optional: true },
  { name: "GH_REPO", what: "owner/name for the dispatch (Vercel)", optional: true },
];

function main(): void {
  console.log("");
  let blanks = 0;
  let missing = 0;

  for (const k of KEYS) {
    const raw = process.env[k.name];
    const value = raw?.trim() ?? "";

    let state: string;
    if (raw === undefined) {
      state = k.optional ? "not set" : "MISSING";
      if (!k.optional) missing++;
    } else if (value === "") {
      // The failure mode worth naming: present, empty, and therefore useless.
      state = "SET BUT EMPTY";
      blanks++;
    } else {
      state = `ok (${value.length} chars)`;
    }

    const flag = state === "SET BUT EMPTY" || state === "MISSING" ? "!" : " ";
    console.log(`${flag} ${k.name.padEnd(30)} ${state.padEnd(16)} ${k.what}`);
  }

  const jsearch = [
    "JSEARCH_OPENWEBNINJA_KEY",
    "JSEARCH_OPENWEBNINJA_KEY_2",
    "JSEARCH_RAPIDAPI_KEY",
    "JSEARCH_RAPIDAPI_KEY_2",
  ].filter((n) => (process.env[n] ?? "").trim());

  console.log(`\nJSearch keys the rotation will use: ${jsearch.length}`);
  for (const n of jsearch) console.log(`  ${n}`);

  if (blanks > 0) {
    console.log(
      `\n${blanks} variable(s) are present but empty. An empty value is not the same as` +
        `\nan unset one: the line looks right in .env.local while the feature reports` +
        `\nthe key as missing. Give them a value or delete the line.`,
    );
  }
  if (missing > 0) console.log(`\n${missing} required variable(s) are missing.`);
  if (blanks === 0 && missing === 0) console.log("\neverything set is usable");
}

main();
