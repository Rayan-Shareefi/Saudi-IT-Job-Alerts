-- Review state, evidence and cross-source identity.
--
-- Until now a posting was either stored (and shown) or never stored. Rules that
-- rejected something deleted it, so a wrong rule destroyed real vacancies with
-- no way back (HANDOVER §6). From here every decision is a recomputable state:
--
--   pending       stored, not judged yet
--   show          passed every check; appears in "All"
--   unclassified  could not be proven either way (snippet only, no location,
--                 scope unclear) - visible in its own tab, never deleted
--   needs_review  the checks disagree with verified evidence - the Review tab
--   hidden        a stated reason in hidden_reason; reversible
--
-- `removed_at` stays exactly what it was: the user's own trash button. Rules
-- never write it, so restoring a rule mistake never touches a human decision.
--
-- Safe to re-run: scripts/db-push.ts applies every migration on every push.

alter table public.jobs
  add column if not exists review_state       text        not null default 'pending',
  add column if not exists hidden_reason      text,
  add column if not exists decided_by         text,
  add column if not exists decided_at         timestamptz,
  add column if not exists decision_note      text,
  add column if not exists human_override     text,
  -- what the posting is about, with the sentences that prove it
  add column if not exists scope              text,
  add column if not exists focus              text[]      not null default '{}',
  add column if not exists scope_evidence     text[]      not null default '{}',
  -- where the experience band came from, and the sentence it came from
  add column if not exists experience_source  text,
  add column if not exists experience_evidence text,
  -- how much of the posting was actually read
  add column if not exists text_quality       text,
  add column if not exists text_hash          text,
  add column if not exists text_fetched_at    timestamptz,
  -- cross-source identity
  add column if not exists publisher          text,
  add column if not exists company_key        text,
  add column if not exists duplicate_of       uuid,
  add column if not exists also_on            jsonb       not null default '[]',
  -- dates and apply route
  add column if not exists closes_evidence    text,
  add column if not exists last_refreshed_at  timestamptz,
  add column if not exists apply_url          text,
  add column if not exists apply_kind         text;

-- Self-reference for "this row is a copy of that one". Added separately so a
-- re-run does not try to create the constraint twice.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'jobs_duplicate_of_fkey'
  ) then
    alter table public.jobs
      add constraint jobs_duplicate_of_fkey
      foreign key (duplicate_of) references public.jobs(id) on delete set null;
  end if;
end $$;

alter table public.jobs drop constraint if exists jobs_review_state_check;
alter table public.jobs
  add constraint jobs_review_state_check
  check (review_state in ('pending', 'show', 'unclassified', 'needs_review', 'hidden'));

alter table public.jobs drop constraint if exists jobs_human_override_check;
alter table public.jobs
  add constraint jobs_human_override_check
  check (human_override is null or human_override in ('show', 'hide'));

alter table public.jobs drop constraint if exists jobs_text_quality_check;
alter table public.jobs
  add constraint jobs_text_quality_check
  check (text_quality is null or text_quality in ('full', 'partial', 'snippet', 'none'));

comment on column public.jobs.review_state is
  'Recomputed by src/lib/state.ts on every pass. Never written by upsert.';
comment on column public.jobs.human_override is
  'The user''s Keep/Hide decision from the Review tab. Beats every rule and model.';
comment on column public.jobs.duplicate_of is
  'Set on the secondary copies of one vacancy; the primary carries also_on.';

-- The board's read path: visible primaries.
create index if not exists jobs_visible_idx
  on public.jobs (review_state, first_seen_at desc)
  where is_active and removed_at is null and duplicate_of is null;

-- Foreign keys are not indexed automatically; dedup rebuilds look rows up by it.
create index if not exists jobs_duplicate_of_idx
  on public.jobs (duplicate_of)
  where duplicate_of is not null;

create index if not exists jobs_company_key_idx on public.jobs (company_key);
create index if not exists jobs_text_hash_idx on public.jobs (text_hash);
