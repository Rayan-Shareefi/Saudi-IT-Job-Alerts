# Saudi Job Alert

A personal job board surfacing **cybersecurity and cloud roles in Riyadh**,
co-op, internships and entry-level work first. Narrowed from "all IT" on
2026-10-13.

Full context, architecture, runbook and traps: **[HANDOVER.md](HANDOVER.md)**.
Read it before changing any rule, adapter or the checker.

## Non-negotiables

1. **Never print an API key value.** The user manages `.env` / `.env.local`.
   `npm run check:keys` reports presence and length only. Never ask for a
   password in chat; LinkedIn credentials live in the laptop's `.env.local`.
2. **The app stays free.** No paid API or service. Every quota goes through
   `src/lib/budget.ts`.
3. **JSearch is metered** (~200 requests/month per key, one per page). Never
   in a frequent schedule (`jsearch.yml` is weekly). Test with
   `npm run test:jsearch` - the local mock, zero real requests.
4. **Do not bypass bot protection.** Blocked sites go to the Site report and
   are covered through LinkedIn / JSearch. LinkedIn: public listings (no
   login) and hiring posts via the user's *secondary* account on the laptop -
   an explicit user decision (2026-10-13), slow and read-only, stopping at
   the first 429 / login wall / challenge. Never solve a CAPTCHA or
   verification step in code.
5. **Riyadh only. Cybersecurity and cloud only**, judged from the duties:
   DevOps/SRE only with cloud duties, network roles only with security duties;
   software dev, data/AI, IT support, plain IT audit and selling security are
   out. 5+ years -> its own tab. Older than 30 days -> hidden unless the
   stated deadline is ahead.

## Deciding where a posting goes

- **Rules never delete.** Every decision is a recomputable `review_state`
  (`src/lib/state.ts`); `removed_at` is the user's trash button only.
- **Two signals before hiding** (HANDOVER §"The checker"). Unproven ->
  Unclassified; conflicting evidence -> Review. The user's Keep/Hide is final.
- **Models never create postings and never decide alone.** Every model claim
  needs a quote that `judge/verify.ts` finds in the posting and that supports
  the claim; years are re-read from the quote by our own parser.
- When you change a rule, **add a regression case** naming the real posting,
  run `npm run test`, then `npm run reclassify -- --dry` and read the moves.

## Commands

```bash
npm run verify          # live end-to-end checks - run after any change
npm run test            # all suites (494 cases)
npm run reclassify      # recompute states from stored rows; no fetching, no model calls
npm run dedupe          # rebuild duplicate groups
npm run judge           # the AI jury (free models), --max N
npm run llm:check       # which free models work right now
npm run doctor          # is this machine ready to be the laptop worker
npm run ingest -- --no-metered   # collection without JSearch
npm run fix:bytes       # repair regex escapes mangled by shell heredocs
```

Single source: `npx tsx scripts/ingest.ts --source <id> --dry`

## Environment gotchas

- Shell heredocs and `sed` corrupt regex escapes here (`\b` -> backspace or
  nothing). Edit regexes with the editor tool, then `npm run fix:bytes`.
- PostgREST silently caps responses at 1000 rows - use `fetchAllRows`.
- Treat a blank env var as unset: `envStr()` from `src/lib/env.ts`, never `??`.
- `DETAIL_SCRIPT` (generic.ts) and the LinkedIn post extractor are strings,
  not functions: esbuild's `__name` breaks `page.evaluate(fn)`.
- The browser pane in the desktop app does not draw when hidden, so streamed
  React content never appears there; verify UI with headless Playwright.
- The user's laptop worker runs the code on disk and updates itself from
  GitHub; a long-lived local `npm run dev` still holds old code until restarted.
