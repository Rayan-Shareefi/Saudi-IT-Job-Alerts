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
- One card per vacancy. Every card names the platform it was found on, and a
  **Duplicate** badge names every platform the same vacancy appeared on.
- Ordered by when a job was **posted**, never by when it was found.
- Free. No paid service anywhere.

## Where things run

| Machine | What it does | When |
|---|---|---|
| **GitHub Actions** | Company job boards and the free platforms; the nightly scan of every company career page; the 3-day email; JSearch twice a week | On a schedule, and when you press a Search button |
| **The laptop** | LinkedIn listings and hiring posts (pictures read too), the platforms GitHub has not read in 3 hours, the local AI reviewer, co-op watch, finding new employers, instant alerts; every company site on request (launcher **F**) or if GitHub misses a day | Always on; every 2 hours. Watch it with **Saudi Job Alert** on the desktop |
| **Vercel** | The website | Always |
| **Supabase** | The database | Always |

Laptop setup: [docs/laptop-setup.md](docs/laptop-setup.md).

## The tabs

| Tab | What is in it | What you do |
|---|---|---|
| **All jobs** | Every verified vacancy. Order: time-sensitive, recommended, co-op, internship, then the rest - each group newest *posting* first, undated ones last | Apply. Pressing Apply also saves the job |
| **Saved** | Everything you saved or applied to. Never removed automatically | Remove when done |
| **Company sites / LinkedIn / Job boards** | All jobs, split by where the best copy came from | - |
| **Waiting for the jury** | Full postings the AI jury has not read yet; each then moves to All jobs or Hidden | Nothing - it empties itself |
| **Your call** | Co-op and internships in technology outside cyber / cloud | **Keep or Hide.** Your decision is final and permanent |
| **Saudi Arabia** | Verified cyber / cloud roles in Saudi Arabia whose city is not stated | Keep moves one to All jobs if you know it is Riyadh |
| **5+ years** | Roles that state 5+ years, or a senior title with no years stated | For later |
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

## Where the jobs come from

| Platform | How it is read |
|---|---|
| **LinkedIn** | From the laptop, no login: public job listings (rotating keyword searches, plus each known company's own jobs by its LinkedIn id) and **company pages** - their hiring, co-op and internship posts, pictures read by OCR. The company list fills itself from every job card (`linkedin_companies`). The signed-in post search is off unless `LINKEDIN_SEARCH_POSTS=1`. Also arrives through JSearch |
| **Indeed, Glassdoor, Bayt, Naukrigulf** | They block automated readers (security checks; Naukrigulf's data needs its app's private ids), so through **JSearch** (Google's job listings), twice a week. A JSearch result also says which other sites carry the same job |
| **Jooble, Careerjet** | Their free APIs |
| **Sabbar** | Its public job sitemap (robots.txt allows it), then the job pages; twice a day |
| **Workable** | Its free public job search, every employer hiring in Riyadh through Workable |
| **Telegram** | Saudi job channels @ewdifh, @cd4cd, @jobzaty, @fu1sa through their public channel pages (no login). Only posts about technology or training are kept; the linked article is read where the site allows it (jobzaty.com, wdeftksa.com), the post's picture (OCR) otherwise. Change the list with `TELEGRAM_CHANNELS=handle,handle` |
| **Company sites** | ~530 employer boards and career pages, plus the ones the worker discovers |

Every posting from every platform goes through the same rules, jury and
evidence check. A company found on a platform but not tracked is looked up and
its own board added (`discover-employers`).

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
| `llm:check` shows a model failing its canaries | A free model was renamed or retired (each provider moves to its next model by itself, and the weekly `llm:upgrade` picks a tested replacement) | Usually nothing. See [docs/ai-models.md](docs/ai-models.md) for keys, pinning and undoing a change |
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
`test-judge.ts`). The owner's policy since 2026-10-21 is **not sure, not shown**:

- The models decide when they agree (their quotes are checked by code);
  rules that are *decisive* yield only to two models.
- Models that disagree go to the senior reviewer; if it does not settle
  them, the posting is rejected.
- A full posting no model has read yet waits ("Waiting for the jury"); once
  read it is shown or hidden. A snippet cannot be read further, so a vague one
  is hidden at once - unless its own title says security or cloud work.
- Physical security (guards, CCTV, loss prevention) is never cybersecurity.
- A senior title with no years stated counts as 5+.
- Saudi Arabia with no city: the "Saudi Arabia" tab.
- Co-op and internships in technology that miss the rules are the owner's
  call ("Your call" tab); physical security, sales, legal and other
  non-technology programmes are not.

Nothing is deleted: every hidden posting is restorable, and the owner's
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
npm run llm:upgrade       # move to newer free models that pass every canary (weekly on the laptop; --dry to preview)
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
    applied files in `schema_migrations` and applies only new ones. A new table
    needs its `grant ... to service_role` (0015 fixed 0014).
14. **Task Scheduler's "restart on failure" never fires for a program that
    exits by itself.** The worker exits to load new code, so the task runs it
    inside a restart loop (install-worker.ps1); the first design would have
    stopped for good after its first self-update.
15. **A refusal must not lose what was read.** The LinkedIn reader threw on
    the first 429 and stored nothing for four days at ~150 requests a day; it
    now keeps the listings read and reports the run as partial.
16. **JSearch answers in Arabic for Saudi searches**: 3 results with only
    relative dates ("قبل ١٥ يومًا"); with `language=en`, 10 with exact dates.
    Dates are read in every form (`relative-date.ts`).
19. **Programme titles were rejected as institution names.** "Summer Internship
    Program", "COOP Training Program", "Tamheer Program" matched the institution
    rule ("... Program") on every source until 2026-10-21. A programme word now
    lets a title through (`PROGRAMME`, plausible.ts), and announcements read
    their Arabic text for relevance (`announcesOpenings`).
18. **"Cannot read properties of undefined (reading 'length')" in webpack's
    WasmHash** during `npm run build` is a stale `.next` cache (left by a dev
    server): delete `.next` and build again.
17. **The worker cannot 'git pull' a private repo** (no desktop to sign in).
    The launcher updates it from your session; a public repo removes the issue.

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
2. **LinkedIn posts** are found by any attribute or link carrying a post id; if
   none is recognised the run fails with the page's structure (counts only) in
   source_health.error - read it there to adjust `EXTRACT`.
3. **Company list expansion**: `npm run employers:discover` (every laptop cycle,
   25 companies at most) adds employers found through LinkedIn, JSearch, Careerjet,
   Jooble and Workable's Riyadh search (`workable-riyadh`, free, ~27 requests a
   run). A board is added only when it shows real postings in Saudi Arabia;
   companies without one are looked at again after 30 days. Check
   `employer_candidates` for the ones it could not resolve.
4. **Private repo minutes**: while the repo is private the nightly scan is one
   30-minute shard. Making it public switches to six parallel shards
   automatically.
