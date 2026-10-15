# Getting your JSearch key

JSearch proxies **Google for Jobs**, which indexes LinkedIn, Indeed, Bayt,
GulfTalent, Glassdoor and thousands of company career pages. One key roughly
doubles the app's coverage and is the only route to the 27 Saudi sites that
block automation outright.

It is free to start and takes about three minutes.

---

## 1. Create a RapidAPI account

Go to **https://rapidapi.com/auth/sign-up** and sign up (GitHub or Google login
works). No card is required for the free tier.

## 2. Subscribe to JSearch

Open **https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch**

Click **Subscribe to Test** → choose the **Basic / $0** plan → **Subscribe**.

> The free plan gives ~200 requests/month. See "Staying inside the free tier"
> below — the defaults are tuned to fit.

## 3. Copy the key

Back on the JSearch page, open the **Endpoints** tab. On the right, under
*Code Snippets*, you will see a header like:

```
X-RapidAPI-Key: 0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t
```

That long string is your key. There is also a **Header Parameters** section on
the same page showing the same value.

## 4. Put it in the app

Add it to `.env.local` in the project root:

```
JSEARCH_RAPIDAPI_KEY=0a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t
```

Then confirm it works:

```bash
npm run ingest -- --source jsearch-riyadh --dry
```

You should see `fetched=` with a non-zero number. If it says
`skipped: missing JSEARCH_RAPIDAPI_KEY`, the variable is not being read — check
the file is named `.env.local` and sits next to `package.json`.

## 5. Add it to the deployed app

Two places, because the scraper and the website run separately:

- **GitHub** → repo **Settings** → *Secrets and variables* → **Actions** →
  **New repository secret** → name `JSEARCH_RAPIDAPI_KEY`, paste the value.
  This is what the scheduled ingest uses.
- **Vercel** → project **Settings** → *Environment Variables* → same name and
  value. This is only needed if you trigger `/api/cron/ingest` from your phone.

---

## Staying inside the free tier

Each ingest run makes one request per search term. The app ships with 20
professional terms plus 14 student-intake terms, so a full JSearch pass is ~34
requests **per JSearch source**, and there are two of them (Riyadh, all-Saudi) —
about 68 requests.

At the every-2-hours schedule that would blow through 200/month immediately, so
JSearch is deliberately **not** run on the frequent ingest. Restrict it to the
once-daily full run:

```bash
# frequent pass - company boards only, no API calls
npm run ingest -- --skip-browser --kind ats

# daily pass - everything including JSearch
npm run ingest
```

The shipped GitHub workflow already splits it this way. If you want more
headroom, the **Pro plan is $10/month for 10,000 requests**, which is plenty to
run JSearch on every 2-hour pass.

To trim requests without paying, cut the term lists in
`src/lib/adapters/aggregators.ts` — `QUERY_TERMS` and `STUDENT_TERMS`.

---

## Where the results appear

JSearch results land in their **own tab**, never mixed into the company results.

That separation is deliberate. A JSearch row is a *second-hand* listing: it
reached Google for Jobs because it was already syndicated somewhere, which means
the employer's own board had it first. Folding those into the main list would
bury the early ATS postings that are the entire point of the app.

So:

- **All company sources** — the employer boards. Earliest signal, apply here first.
- **JSearch** — everything Google for Jobs knows about, including employers not
  in the registry at all. Wider net, later signal.

The two never mix, in the dashboard or in the weekly email.

---

## Optional extras

The same pattern applies to two more free APIs, both already wired up:

| Variable | Where | Free tier |
|---|---|---|
| `JOOBLE_API_KEY` | https://jooble.org/api/about — fill the form, key arrives by email | generous |
| `CAREERJET_AFFID` | https://www.careerjet.com/partners/api/ — register for an affiliate id | free |

These land in the **Other aggregators** tab, also kept out of the company
results. All three are optional: a missing key skips that source rather than
failing the run.
