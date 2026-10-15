# Reading all 513 employers — free

## What was actually wrong

Only ~126 of 513 employers expose a machine-readable board. I assumed for a long
time that the other 387 needed a smarter parser, and built three of them —
anchor sweeping, schema.org, then intercepting the JSON the page fetches for
itself. All three measured **zero**.

Then I opened the pages and read them, which I should have done first:

| Employer | Page content |
|---|---|
| Alinma Bank | 1,078 characters — marketing copy and an "Apply now" button |
| NEOM | 2,503 characters — "Join the talent network", CV upload |
| Tahakom | 3,533 characters — a *search form*: "Search by Keyword / Search by Location" |

**They contained no vacancies at all.** Not hidden in awkward markup — simply
absent. The jobs are real; they live one route deeper, behind a search nobody
submitted. No parser and no LLM can extract what the page does not serve, and an
LLM would have charged for the privilege of finding nothing.

## The free fix, which is now the default

`src/lib/adapters/generic.ts` no longer assumes the seeded page holds the jobs.
It **walks** for them, and at every stop runs the whole extraction chain:

1. Load the page → try to extract.
2. Nothing? Click whatever says *Search jobs* / *View all* / *بحث* — an empty
   search lists everything on these sites.
3. Still nothing? Try `/search/`, `/viewalljobs/`, `/jobs`, `/vacancies`,
   `/openings`, `/go/All-Jobs/` in turn.

`/search/` and `/viewalljobs/` come first because SAP SuccessFactors powers a
large share of Saudi enterprise career sites — the same route that turned SAP's
own board from 0 into 52 postings.

At each stop the chain is: intercepted JSON → schema.org → **repeated-block
detection** → job-shaped anchors. The third step is new: rather than looking for
markup it recognises, it finds the largest group of structurally identical
siblings and scores each on how much it behaves like a vacancy list. That works
on a table, a card grid, an accordion or a plain list, in English or Arabic,
with no per-site rules.

### What it produced

| | Before | After |
|---|---|---|
| Relevant Riyadh postings | 529 | **909** |
| Companies represented | 54 | **97** |
| Yield from browser sources | **0** | Dell 100, Check Point 61, Cisco 15, BCG 13, Microsoft 10, IBM 7, Bain 8, Help AG 6, Red Sea Global 6, HPE 14, … |

**No API key. No signup. No cost.** This is the default behaviour now.

## The remaining gap, and the free option for it

Route-walking reaches the list, but it cannot always tell a *category* from a
*vacancy*. Tahakom's results page lists "Operations", "Entry Level",
"التدريب التعاوني"; Elm's lists "المالية والاستثمار". Those are filters, and
structurally they are identical to job rows — shape-matching cannot separate
them. Reading the words can.

`src/lib/adapters/llm.ts` does that, and **defaults to Google Gemini, whose free
tier allows ~1,500 requests per day** — comfortably more than 513 employers
need, at no cost and with no card:

1. Get a key at **https://aistudio.google.com/apikey** (Google account, ~1 min).
2. Put it in `.env.local`:

   ```
   GEMINI_API_KEY=...
   ```

3. Turn it on for the sources that need it:

   ```bash
   npm run llm:enable -- --priority 2
   ```

The prompt is explicit about the failure mode that matters here — it is told, in
so many words, not to return categories, and that an empty array is the correct
answer for a landing page that only invites you to search.

A spent daily quota is treated as a skip, not a failure: tomorrow's run picks up
where it left off.

> Anthropic is supported as an alternative (`LLM_PROVIDER=anthropic`) for anyone
> who prefers it and is happy to pay. Nothing in this project requires it — the
> free path is the default, deliberately.

## What no tool fixes

~51 employers refuse automated access outright — Diriyah, AMAALA, Jahez,
Tawuniya, flynas. Cloudflare and Akamai block headless Chromium as readily as
plain `fetch`. Getting past that means impersonating a logged-in browser
session, which is a line worth not crossing. They stay as working manual links
in the employer directory, and JSearch picks them up once their postings
syndicate.

And for Alinma and NEOM specifically: their careers pages genuinely have no
listings to read. Their jobs sit behind an account. That is a wall, not a
parsing problem.
