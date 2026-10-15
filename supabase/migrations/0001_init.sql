-- Saudi Job Alert - initial schema
--
-- Read path is anonymous and read-only (the web app uses the anon key).
-- Write path is the ingest job only, which uses the service-role key and
-- therefore bypasses RLS.

/* -------------------------------------------------------------------------- */
/* jobs                                                                       */
/* -------------------------------------------------------------------------- */

create table if not exists public.jobs (
  id                uuid primary key default gen_random_uuid(),

  -- provenance
  source_id         text        not null,
  source_label      text        not null,
  source_kind       text        not null,
  external_id       text        not null,

  -- posting
  title             text        not null,
  company           text        not null,
  location_text     text,
  description_text  text,
  url               text        not null,
  posted_at         timestamptz,
  department        text,
  employment_type   text,

  -- classification
  fingerprint       text        not null,
  tracks            text[]      not null default '{}',
  primary_track     text        not null default 'unknown',
  experience_band   text        not null default 'unknown',
  min_years         smallint,
  max_years         smallint,
  city              text        not null default 'unknown',
  is_riyadh         boolean     not null default false,

  -- lifecycle
  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  is_active         boolean     not null default true,
  notified_at       timestamptz,

  constraint jobs_source_external_key unique (source_id, external_id),
  constraint jobs_experience_band_check
    check (experience_band in ('0-2', '3-5', '6-9', '10+', 'unknown')),
  constraint jobs_min_years_check check (min_years is null or min_years between 0 and 60),
  constraint jobs_max_years_check check (max_years is null or max_years between 0 and 60)
);

comment on table public.jobs is
  'One row per posting per source. Cross-source duplicates share a fingerprint.';
comment on column public.jobs.fingerprint is
  'company + title + city hash; collapses the same role seen on several sources.';
comment on column public.jobs.first_seen_at is
  'When this app first saw the posting - the basis for the weekly digest, since
   a source''s own posted_at is frequently missing or wrong.';

-- Arrays need GIN for the && (overlaps) operator the track filter uses.
create index if not exists jobs_tracks_gin_idx on public.jobs using gin (tracks);

-- The app's hot query: active jobs in a city, newest first.
create index if not exists jobs_active_city_seen_idx
  on public.jobs (city, first_seen_at desc)
  where is_active;

-- Secondary filters ride along on the same predicate.
create index if not exists jobs_active_track_band_idx
  on public.jobs (primary_track, experience_band, first_seen_at desc)
  where is_active;

-- Source tabs in the UI.
create index if not exists jobs_source_idx on public.jobs (source_id, first_seen_at desc);

-- Dedupe lookups and the "also posted on" roll-up.
create index if not exists jobs_fingerprint_idx on public.jobs (fingerprint);

-- The digest asks "what appeared since X and has not been emailed yet".
create index if not exists jobs_digest_idx
  on public.jobs (first_seen_at desc)
  where is_active and notified_at is null;

alter table public.jobs enable row level security;

drop policy if exists jobs_public_read on public.jobs;
create policy jobs_public_read
  on public.jobs
  for select
  to anon, authenticated
  using (true);

/* -------------------------------------------------------------------------- */
/* source health                                                              */
/* -------------------------------------------------------------------------- */

create table if not exists public.source_health (
  source_id       text primary key,
  label           text        not null,
  kind            text        not null,
  adapter         text        not null,
  last_run_at     timestamptz,
  last_ok_at      timestamptz,
  ok              boolean     not null default true,
  fetched         integer     not null default 0,
  kept            integer     not null default 0,
  inserted        integer     not null default 0,
  duration_ms     integer     not null default 0,
  consecutive_failures smallint not null default 0,
  error           text
);

comment on table public.source_health is
  'Per-source outcome of the last ingest run; drives the Sources page and the
   "stale source" warning in the weekly digest.';

alter table public.source_health enable row level security;

drop policy if exists source_health_public_read on public.source_health;
create policy source_health_public_read
  on public.source_health
  for select
  to anon, authenticated
  using (true);

/* -------------------------------------------------------------------------- */
/* digest runs                                                                */
/* -------------------------------------------------------------------------- */

create table if not exists public.digest_runs (
  id            uuid primary key default gen_random_uuid(),
  sent_at       timestamptz not null default now(),
  recipient     text        not null,
  job_count     integer     not null default 0,
  window_start  timestamptz not null,
  window_end    timestamptz not null,
  ok            boolean     not null default true,
  error         text
);

create index if not exists digest_runs_sent_idx on public.digest_runs (sent_at desc);

alter table public.digest_runs enable row level security;

drop policy if exists digest_runs_public_read on public.digest_runs;
create policy digest_runs_public_read
  on public.digest_runs
  for select
  to anon, authenticated
  using (true);

/* -------------------------------------------------------------------------- */
/* helper view: one row per distinct role                                     */
/* -------------------------------------------------------------------------- */

-- The same opening often appears on the company ATS *and* an aggregator. The
-- UI shows the earliest-seen copy and counts the rest, so the ATS listing --
-- the one that appeared first -- is the row you actually click.
-- Dropped first rather than replaced: the view selects j.*, so every column
-- added to jobs afterwards changes its shape, and CREATE OR REPLACE VIEW
-- refuses to rename or reorder existing columns. Re-running 0001 after a
-- later migration then fails on a view that is trivially rebuildable.
drop view if exists public.jobs_deduped;
create view public.jobs_deduped as
select distinct on (fingerprint)
  j.*,
  count(*) over (partition by fingerprint)              as duplicate_count,
  array_agg(source_label) over (partition by fingerprint) as all_sources
from public.jobs j
where is_active
order by fingerprint, first_seen_at asc;
