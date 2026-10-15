# Saudi Job Alert

A free, self-hosted job board for **cybersecurity and cloud roles in Riyadh**,
with co-op, internship and entry-level roles first.

It collects postings from hundreds of employer career sites, LinkedIn and job
APIs, reads each full posting, and shows only the ones it can prove are real,
in Riyadh, and cybersecurity or cloud work. Every claim on a card is quoted
from the posting itself.

## What it does

- **Collects** from employer applicant-tracking systems (Workday, Greenhouse,
  Lever, SuccessFactors, Oracle and others), career pages read with a real
  browser, LinkedIn public listings, JSearch, Careerjet and Jooble.
- **Reads the whole posting**, not just the title, to decide:
  - is it a real job posting (not a cookie banner, a button or a profile)?
  - is it cybersecurity or cloud work, judged from the duties?
  - how many years does it ask for, quoted from the posting?
- **Checks itself.** Rules decide the clear cases; free AI models read the
  rest and must quote the posting for every claim; plain code verifies the
  quotes and makes the final call. Anything unproven goes to *Unclassified*,
  anything disputed to *Review* - nothing is ever deleted by a rule.
- **One card per vacancy**, with "Also on LinkedIn / Indeed / ..." badges.
- **Hides** roles older than 30 days (unless the deadline is still ahead) and
  keeps roles asking 5+ years in their own tab.
- **Emails** a digest every 3 days, and an instant alert for time-sensitive
  jobs (application forms, closing soon).
- **Watches** co-op programme pages for new intakes, and adds new employers
  it discovers through LinkedIn and job APIs.

## How it runs

| Part | Where | Cost |
|---|---|---|
| Website | Vercel | free |
| Database | Supabase | free |
| Scheduled collection, nightly scan, emails | GitHub Actions | free |
| LinkedIn, local AI reviewer, alerts | an always-on laptop | free |
| AI reviewers | Gemini / Gemma, Groq, Ollama (local) | free tiers |

## Setting up

1. `npm ci` and `npx playwright install chromium`
2. Copy `.env.example` to `.env.local` and fill in the keys (each one says
   where to get it free). `npm run check:keys` shows what is set without
   printing values.
3. Create the database tables: `npm run db:push`
4. Run it locally: `npm run dev`
5. Add the same keys as GitHub Actions secrets and Vercel environment
   variables (see [HANDOVER.md](HANDOVER.md), "Keys and where they live").
6. For the always-on worker, follow [docs/laptop-setup.md](docs/laptop-setup.md).

## Everyday commands

```bash
npm run verify        # live checks against the database
npm run test          # every rule's regression cases
npm run reclassify    # re-apply the rules to stored postings (no fetching)
npm run judge         # run the free AI reviewers on unclear postings
npm run doctor        # is this machine ready to be the worker
```

## More

- [HANDOVER.md](HANDOVER.md) - how it works, how to run it, what to do when
  something breaks.
- [docs/laptop-setup.md](docs/laptop-setup.md) - the always-on worker.
- [docs/jsearch-setup.md](docs/jsearch-setup.md),
  [docs/aggregator-setup.md](docs/aggregator-setup.md) - the job APIs.
