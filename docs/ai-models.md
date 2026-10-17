# AI models: what updates itself, and what you might do once a year

## The short answer

**Model updates are automatic.** Once a week the laptop runs a check
(`llm:upgrade`):

1. It tests each AI model in use on 7 test postings whose right answers are
   known. They include an Arabic co-op posting, a cookie banner, and a posting
   that tries to give the AI orders.
2. It lists the newer free models Google and Groq offer.
3. It switches to a newer one **only if that model gets all 7 right**.
4. You get one email saying what changed.

A model that Google or Groq shuts down is skipped at once, in the middle of a
run, and the next one on the list takes over. No settings or code change is
needed for either.

**My recommendation: leave it automatic.** Free models get shut down every few
months, so changing models is not optional anyway. The check makes each change
a tested one instead of a surprise. Never set it to "always use the newest
model":

- the newest is often a *preview* that disappears within weeks;
- previews often get smaller free quotas;
- "newer" does not mean better at this narrow job.

That is why it only takes stable models that pass every test.

## Why a bad model cannot break the board

- **No AI answer is believed by itself.** Every claim must come with a quote,
  and our own code checks that the quote is really in the posting and really
  supports the claim. A worse model can only give fewer usable answers, never
  wrong decisions.
- **Showing or hiding a posting needs two signals** (rules + a model, or two
  models). A single confused model changes nothing.
- **Each AI role has a list of models.** If one is shut down, the next is used.
- **A model that refuses our request format** is asked again in the plainest
  format. A model that runs out of room is asked again with twice the room.
- **If every AI fails**, the board still works: the rules decide the clear
  cases, unclear postings wait in **Unclassified**, and nothing is ever
  deleted.

## Once a year (or never): the things that cannot update themselves

PowerShell refuses `npm` on Windows: type `npm.cmd` instead, as below. Run
these in the project folder.

### 1. Check the API keys still work

```
npm.cmd run llm:check
```

- Every line shows `7/7` (or close): nothing to do.
- A whole provider shows "not set", "HTTP 400/401/403" or "quota" every day
  for a week: its key needs replacing.
  - Gemini / Gemma: make a new key at https://aistudio.google.com/apikey
  - Groq: make a new key at https://console.groq.com/keys

  Put the new key in **four places**: the laptop's `.env.local`, the PC's
  `.env.local`, GitHub (repo → Settings → Secrets and variables → Actions)
  and Vercel (project → Settings → Environment Variables). Then restart the
  worker: launcher → **R**.
- **Never turn on billing** in Google Cloud or Groq. Without billing, nothing
  can ever be charged. A model outside the free tier just answers "quota" and
  is skipped.

### 2. The laptop's own model (Ollama) - optional

This is the only model that does not update itself, because a new one is a
5 GB download. Once a year, if you like:

1. See what is newer at https://ollama.com/search (look for "instruct"
   models of 3B-8B size; bigger is too slow for this laptop).
2. `ollama pull <name>` (for example `ollama pull qwen2.5:7b-instruct`).
3. Add `OLLAMA_MODEL=<name>` to the laptop's `.env.local`.
4. `npm.cmd run doctor`: it times one posting. Over 4 minutes is too slow;
   go back to the old name.
5. Launcher → **R**.

### 3. Look at the weekly check by hand (optional)

```
npm.cmd run llm:upgrade -- --dry
```

This shows what it would change without changing anything. Without `--dry`
it makes the changes.

## Choosing a model yourself

- **Keep a model no matter what:** add its name to `.env.local` (and GitHub
  and Vercel), for example `GROQ_SENIOR_MODEL=openai/gpt-oss-120b`. A pinned
  model is never changed by the weekly check.

  | Setting | Model |
  |---|---|
  | `GEMINI_MODEL` | the Gemini juror |
  | `GEMMA_MODEL` | the Gemma juror |
  | `GROQ_MODEL` | the Groq juror |
  | `GROQ_SENIOR_MODEL` | the senior reviewer on Groq |
  | `GEMINI_SENIOR_MODEL` | the senior reviewer on Gemini |

  Delete the line to hand the choice back to the weekly check.
- **Undo a change the weekly check made:** in Supabase, open Table Editor →
  `model_choices` and delete that role's row. The role goes back to the
  built-in default. The `previous` column shows what it used before.

## What the email "AI models updated" means

The weekly check moved one or more roles to a newer free model that got every
test posting right. Nothing to do. If the board looks worse in the days after
(more in **Unclassified**, fewer in **All**), undo it as above.

## Where the free model lists are

- Gemini and Gemma: https://ai.google.dev/gemini-api/docs/models
- Groq: https://console.groq.com/docs/models
