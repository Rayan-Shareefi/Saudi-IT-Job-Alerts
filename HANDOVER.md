# Saudi Job Alert - handover and runbook

Rewritten 2026-10-14, after the rebuild for verified cybersecurity and cloud
roles. Part 1 is for the owner, running this without any AI assistant. Part 2
is for whoever changes the code next. Numbers carry the date they were
measured and the command that re-measures them.

---

# Part 1 - Running it (no code needed)

## What it is

A personal job board for co-op, internships and entry-level work in
**cybersecurity and cloud** in Riyadh.

- Riyadh only. Cybersecurity and cloud only, judged from the whole posting,
  not the title (SOC and GRC roles often never say "cybersecurity").
- DevOps / SRE / Platform roles count only when the duties are cloud work;
  network roles only when the duties are security work. Software development,
  data / AI, IT support, plain IT audit and *selling* security are out.
- Roles that ask for 5+ years go to their own tab, never "All jobs".
- Nothing older than 30 days, unless its stated deadline is still ahead.
- One card per vacancy, with "Also on LinkedIn / Indeed / ..." badges.
- Free. No paid service anywhere.

## Where things run

| Machine | What it does | When |
|---|---|---|
| **GitHub Actions** | Company job boards and free APIs; the nightly scan of every company career page; the 3-day email; JSearch once a week | On a schedule, and when you press a Search button |
| **The laptop** | LinkedIn listings and hiring posts, the local AI reviewer, co-op watch, finding new employers, instant alerts; covers the nightly scan if GitHub misses it | Always on; every 2 hours |
| **Vercel** | The website | Always |
| **Supabase** | The database | Always |

Laptop setup: [docs/laptop-setup.md](docs/laptop-setup.md).

## The tabs

| Tab | What is in it | What you do |
|---|---|---|
| **All jobs** | Every verified vacancy. Order: time-sensitive, recommended, co-op, internship, then newest | Apply. Pressing Apply also saves the job |
| **Saved** | Everything you saved or applied to. Never removed automatically | Remove when done |
| **Company sites / LinkedIn / Job boards** | All jobs, split by where the best copy came from | - |
| **Unclassified** | Could not be proven either way: only a snippet was readable, location or kind of work not stated, or not reviewed yet | Keep or Hide when you have a minute; it teaches the reviewers |
| **Review** | The checks disagree, with quotes on both sides | **Keep or Hide.** Your decision is final and permanent |
| **5+ years** | Verified roles that state 5 or more years | For later |
| **Hidden** | Everything else, each with its reason (out of scope, too old, not Riyadh, not a job) | Keep brings one back |
| **Site report** | Every employer site that could not be read, why, and the fix | Fix the ones you care about |
| **Human intervene** | Employers no program can reach, with a working link | Check by hand now and then |

**The badge filter** (above the cards): click a badge to bring jobs with it
forward, click again to hide jobs with it, a third time to clear it. With
several badges chosen, the jobs that have the most of them come first, then
the newest.

**Every claim on a card is quoted.** Open a card ("Details") to see why it is
there: the sentence stating the years, the duties that make it security or
cloud work, and the date the full posting was read.

## Your routine

- **Every few days:** open **Review** and decide the few cards there. That is
  the last check on everything automatic, and each decision makes the next
  ones better.
- **The email** every 3 days lists new verified jobs. A separate instant email
  arrives for time-sensitive ones (application forms, deadlines within a week)
  and co-op watch hits.

## When something goes wrong

| You see | What it means | What to do |
|---|---|---|
| Email "LinkedIn needs you" | The laptop's LinkedIn session expired or LinkedIn asked for a check | On the laptop: `npm run linkedin:login` and sign in |
| Search button says "queued" for a long time | Neither GitHub nor the laptop picked it up | Check `GH_DISPATCH_TOKEN` on Vercel, or that the laptop is on |
| A run shows "stopped responding" | The machine running it went quiet | Press the button again |
| Nothing new for days | Something upstream changed | On the laptop: `npm run doctor`, then `npm run llm:check` |
| `llm:check` shows a model failing its canaries | A free model was renamed or retired | Set a working name from its list (`GEMINI_MODEL`, `GEMMA_MODEL`, `GROQ_MODEL`, `GROQ_SENIOR_MODEL`) in `.env.local`, GitHub secrets and Vercel |
| A real job was hidden | A rule or the reviewers got it wrong | Keep it from the Hidden tab; that fixes it permanently |
| A wrong job is shown | Same | Hide it |
| GitHub email "All jobs have failed" | A workflow failed | Open the run on GitHub, Actions tab; the failing step says why |
| Supabase says the project is paused | Free projects pause after a week with no activity | Restore it from the Supabase dashboard (it should never happen while the schedule runs) |

## Keys and where they live (never paste them into a chat)

| Name | Where it is set | Free from |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `.env.local`, GitHub secrets, Vercel | supabase.com |
| `GEMINI_API_KEY` | `.env.local`, GitHub secrets | aistudio.google.com |
| `GROQ_API_KEY` | `.env.local`, GitHub secrets | console.groq.com |
| `RESEND_API_KEY`, `DIGEST_TO`, `DIGEST_FROM` | `.env.local`, GitHub secrets | resend.com |
| `JOOBLE_API_KEY`, `CAREERJET_AFFID` | `.env.local`, GitHub secrets | jooble.org, careerjet.com |
| `JSEARCH_RAPIDAPI_KEY`, `JSEARCH_OPENWEBNINJA_KEY` | `.env.local`, GitHub secrets | rapidapi.com (free plan, hard limit) |
| `CRON_SECRET` | `.env.local`, GitHub secrets, Vercel | any long random string; it is also the website's editing key |
| `GH_DISPATCH_TOKEN`, `GH_REPO` | Vercel | github.com > Settings > Developer settings > fine-grained token, this repo, Actions: read and write |
| `LINKEDIN_*` | the laptop's `.env.local` only | the secondary account |

To rotate a key: replace it in every place listed, then press a Search button
to confirm.

---

# Part 2 - For whoever changes the code

## Non-negotiables

1. **Never print a key's value.** `npm run check:keys` reports presence and length.
2. **Free only.** Every quota goes through `src/lib/budget.ts`.
3. **Nothing is deleted on one signal - and rules never delete at all.** Every
   decision is a recomputable `review_state`; `removed_at` is the user's own
   trash button only. See "The checker".
4. **No bypassing bot protection.** Blocked sites go to the Site report and are
   covered through LinkedIn and JSearch instead. LinkedIn itself stops at the
   first 429 / login wall / challenge and is never retried around.
5. **Riyadh only, cyber / cloud only**, as defined in Part 1.
6. **Every claim on a card is a verifiable quote** from the posting.

## How a posting reaches the board

```
adapter (fetch)  ->  enrich: full text, experience, company key, apply route
  ->  plausible + Riyadh + IT gate (ingest)  ->  upsert as review_state "pending"
  ->  dedupe (one card per vacancy)  ->  rules (scope.ts, experience.ts)
  ->  AI jury on what the rules cannot settle (judge/)  ->  evidence check
  ->  arbiter (state.ts)  ->  show / unclassified / needs_review / hidden
```

`npm run reclassify` recomputes every state from stored rows with no fetching
and no model calls; `npm run dedupe` rebuilds duplicate groups. Both are safe
to run any time and run at the end of every ingest.

## The checker

**Rules first** (`src/lib/scope.ts`, `src/lib/experience.ts`,
`src/lib/plausible.ts`). They are *decisive* only when two signals agree - a
role family in the title and its duties in the text - and never on a snippet.

**The jury** (`src/lib/judge/`) reads what the rules leave open: two jurors
(Ollama on the laptop, Gemini Flash-Lite, Gemma, Groq Llama), a third on
disagreement, and a senior reviewer (Groq's largest model, Gemini Flash as
fallback) only for disputes. Each posting text is read once per
`PROMPT_VERSION`; answers are cached in `judgements`.

**The evidence check** (`judge/verify.ts`) is plain code. A claim counts only
if its quote is really in the posting *and* supports the claim: a security
verdict must quote a security duty, years are re-read from the quoted sentence
by our parser, Riyadh must be named. Instruction-like text is refused as
evidence (prompt-injection guard). Failed claims are abstentions.

**The arbiter** (`src/lib/state.ts`, pure, every branch tested in
`test-judge.ts`): show when the rules are decisive, or lean in plus a verified
vote, or two verified votes agree, or the senior plus one other signal. Hide as
out of scope only when the rules say out *and* two verified votes (or the
senior plus one) agree. Anything else is Unclassified or Review. The user's
Keep / Hide beats everything.

**To change a rule safely:** add the regression case first (the suites below
say which real posting each case is for), change the rule, run `npm run test`,
then `npm run reclassify -- --dry` and read the "moves" before applying.

## Code map

| Module | Question | Suite | Cases |
|---|---|---|---|
| `src/lib/plausible.ts` | Is it a job posting? (cookies, buttons, people's names) | `test:plausible` | 146 |
| `src/lib/relevance.ts` | Is it IT at all? (ingest gate) | `test:relevance` | 76 |
| `src/lib/classify.ts` | City, tracks, closing date | `test:location` | 19 |
| `src/lib/experience.ts` | Years required, with the sentence | `test:experience` | 61 |
| `src/lib/scope.ts` | Cybersecurity / cloud? | `test:scope` | 60 |
| `src/lib/judge/*`, `src/lib/state.ts` | Jury, evidence check, arbiter | `test:judge` | 54 |
| `src/lib/dedupe.ts` | One card per vacancy | `test:dedupe` | 19 |
| `src/lib/adapters/linkedin*.ts` | LinkedIn listings and posts | `test:linkedin` | 14 |
| `src/lib/digest.ts` | Email sender handling | `test:digest` | 13 |
| `src/lib/resume.ts` | CV match ("Recommended") | `test:matching` | 7 |

Other key files: `src/lib/review.ts` (recompute states), `src/lib/board.ts`
(what each tab holds), `src/lib/runs.ts` (run tracking for the buttons),
`src/lib/budget.ts` (free quotas), `src/lib/alerts.ts` (instant emails),
`scripts/local-worker.ts` (the laptop), `scripts/coop-watch.ts`,
`scripts/discover-employers.ts`, `scripts/diagnose-sources.ts` (Site report).

## Commands

```bash
npm run verify            # live end-to-end checks
npm run test              # every suite above (494 cases)
npm run reclassify        # recompute states (no fetching, no model calls); --dry to preview
npm run dedupe            # rebuild duplicate groups; --dry to preview
npm run judge             # run the AI jury; --max N, --deadline-min N
npm run llm:check         # which free models work right now (canary postings)
npm run doctor            # is this machine ready to be the worker
npm run ingest -- --no-metered        # collection without JSearch
npm run digest:preview    # write data/digest-preview.html
npm run db:push           # apply new migrations (tracked in schema_migrations)
npm run fix:bytes         # repair regex escapes mangled by shell edits
```

## Traps (each has cost real time)

1. **Blank env vars.** GitHub turns a missing secret into `""`, and `?? default`
   keeps `""`. The digest failed every run from 2026-09-04 to 2026-10-10 on
   `from: ""`. Read config through `envStr()` (`src/lib/env.ts`).
2. **Shell edits mangle regex escapes.** `\b` becomes a backspace byte or
   vanishes. Edit regexes with an editor, then `npm run fix:bytes`.
3. **PostgREST caps responses at 1000 rows.** Use `fetchAllRows`.
4. **Provider IDs that change per call.** Careerjet's URL and JSearch's job_id
   suffix made every posting "new" daily. Aggregator rows are keyed on content
   (`contentId`, `jsearchIdFor` in aggregators.ts).
5. **Search APIs are samples, not lists.** Their rows retire after 10 days
   unseen, never on one absence (`deactivateMissing`).
6. **Free models change.** Google cut Gemini's free tier in Dec 2025;
   `gemma-4-31b-it` returned 500 on every call on 2026-10-13; Flash models
   answer "high demand" (503) often. Providers retry 5xx, chain fallbacks, and
   `llm:check` catches a dead model.
7. **Models quote the location field**, not the description. The evidence
   check accepts location quotes from the field (with a shorter minimum).
8. **Thinking models** (Gemma 4) return reasoning as separate `thought` parts;
   only answer parts are read.
9. **LinkedIn rate-limits fast** - a 429 after a handful of requests from one
   address. Stop, do not retry; it runs from the laptop's home connection.
10. **`DETAIL_SCRIPT` and the LinkedIn extractor are strings**, not functions:
    esbuild's `__name` helper breaks `page.evaluate(fn)`.
11. **A re-fetch must not shrink stored text** (`storedTexts` guard in
    ingest.ts): passes skip what they already read, and the listing card would
    otherwise overwrite the full posting.
12. **Background browser panes do not draw**, so React's streamed content
    never appears there; verify UI with headless Playwright
    (`npm run ui:check`, with the dev server running).
13. **Migrations re-run cannot be assumed safe.** `db-push.ts` now records
    applied files in `schema_migrations` and applies only new ones.

## State on 2026-10-15

```
active postings 1,294 (after collapsing ~35,000 churned aggregator copies)
verified (All jobs) 56   5+ years 36   Unclassified 534   Review 5   Hidden 663
tests 494 cases
```

Re-measure: `npm run reclassify -- --dry`, `npm run verify`.

## Open items

1. **The Unclassified backlog** shrinks as the jury reads it; with Groq added and
   the laptop's Ollama running it clears in a few days. Most of it is Careerjet
   snippets, which stay unclassified unless the same vacancy is found with its
   full text elsewhere.
2. **LinkedIn posts** selectors (`linkedin-posts.ts`) are untested against a
   signed-in page until the laptop is set up; run once with `LINKEDIN_DEBUG=1`
   and adjust if no posts are found.
3. **Company list expansion**: `npm run employers:discover` adds employers found
   through LinkedIn / JSearch automatically; check `employer_candidates` for the
   ones it could not resolve.
4. **Private repo minutes**: while the repo is private the nightly scan is one
   30-minute shard. Making it public switches to six parallel shards
   automatically.
