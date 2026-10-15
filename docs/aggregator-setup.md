# Jooble and Careerjet keys

Both are free, both cover Saudi Arabia, and both land in the **Jooble & Careerjet**
tab — kept separate from the company boards, same as JSearch.

---

## Jooble

Jooble does not self-serve a key: you fill in a short form and they email one.

1. Open **https://jooble.org/api/about**
2. Scroll to *How to get started?* and complete the form:

   | Field | What to put |
   |---|---|
   | Your name | your name |
   | Position | `Developer` |
   | Email | your email — the key is sent here |
   | Website | your deployed app URL, e.g. `https://your-app.vercel.app` |
   | Phone | your number |

   The Website field is the one they actually check — they want to see where
   results will be shown. Your Vercel URL is fine; a GitHub repo link also works.

3. Submit. The key arrives by email, usually within a day.
4. Add it to `.env.local`:

   ```
   JOOBLE_API_KEY=paste-the-key-here
   ```

Jooble's quota is generous, so it runs on every pass rather than nightly only.

---

## Careerjet

Careerjet needs a publisher account, and the key is on the dashboard.

1. Open **https://www.careerjet.com/partners/api/**
2. Click **Publisher account** (the link in the *Getting your API key* section)
   and register. It asks for the site where results will appear — same answer as
   Jooble, your app URL.
3. Once approved, the dashboard shows your **affiliate ID**. That is the value
   the app wants.
4. Add it to `.env.local`:

   ```
   CAREERJET_AFFID=paste-the-affiliate-id-here
   ```

> The docs describe Basic auth with a Base64-encoded key for their newer
> `search.api.careerjet.net/v4/query` endpoint. This app uses the older public
> endpoint (`public.api.careerjet.net/search`), which takes the affiliate ID as
> a plain `affid` query parameter and needs no auth header. If Careerjet ever
> retires it, the adapter in `src/lib/adapters/aggregators.ts` is the one file to
> change.

---

## Confirming they work

```bash
npm run ingest -- --source jooble-riyadh --dry
npm run ingest -- --source careerjet-riyadh --dry
```

A working key prints `fetched=` with a non-zero number. A missing one prints
`skipped: missing JOOBLE_API_KEY`, which is a skip rather than a failure — the
rest of the run is unaffected.

Then add both to **GitHub → Settings → Secrets and variables → Actions** so the
scheduled runs pick them up, and to **Vercel → Settings → Environment
Variables** so the in-app *Search for new jobs* button can use them.

---

## Why they are in their own tab

Same reasoning as JSearch. A posting reaches Jooble or Careerjet because it was
already syndicated somewhere, which means the employer's own board had it first.
Mixing them into the company results would bury the early listings that are the
point of the app.

They are worth having anyway: they reach employers that are not in the registry
at all, and every ingest run records employer names it does not recognise to
`data/suggested-employers.json` so the company list keeps growing from real
evidence.

## Two quirks worth knowing

Both cost a working key an entire tab of results, and neither is visible from
the app - the tab just says "no results yet", which reads like a missing key.

### Jooble needs the country in the location

`location: "Riyadh"` returns `{"totalCount":0,"jobs":[]}` for every keyword.
`"Riyadh, Saudi Arabia"` returns results. Verified against the live API:

| location | results |
|---|---|
| `Riyadh` | 0 |
| `Riyadh, Saudi Arabia` | 24 |
| `Saudi Arabia` | 11 |

The adapter appends the country when the handle does not already name it.

### Careerjet needs HTTP and a Referer

Two separate refusals:

1. **HTTPS is refused.** `public.api.careerjet.net` resolves but drops TLS
   connections - no status code, just a failed connection, which the fetch
   reports as a network error. The API is HTTP-only.
2. **A `Referer` header is required.** Without one it answers 403:
   *"Undeclared referrer. Please add a Referer header so we know who is calling
   this API and from which page."*

With both: 141 hits for `developer` in Riyadh, and 1,646 postings across the
full sweep. The adapter sends `APP_URL` as the referer.

### Check what is actually configured

```bash
npm run check:keys
```

Reports presence and length, never a value. It exists because *set* and
*usable* are different: a line left from `.env.example` as `JOOBLE_API_KEY=` is
present, is a perfectly good empty string, and makes the adapter report the key
as missing while the line sits right there in the file.
