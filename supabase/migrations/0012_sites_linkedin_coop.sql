-- Site report, auto-added employers, LinkedIn hiring posts, co-op watch.

/* -------------------------------------------------------------------------- */
/* source_reports: every site that could not be read, why, and the fix          */
/* -------------------------------------------------------------------------- */

-- Written by scripts/diagnose-sources.ts. Lives in the database rather than
-- data/coverage.json so the deployed site shows the current report without a
-- redeploy.
create table if not exists public.source_reports (
  company      text        primary key,
  sector       text,
  priority     smallint,
  careers_url  text,
  verdict      text        not null,
  reason       text        not null,
  fix          text        not null,
  suggested_url text,
  emails       text[]      not null default '{}',
  postings_seen integer    not null default 0,
  jobs_found   integer     not null default 0,
  checked_at   timestamptz not null default now()
);

alter table public.source_reports enable row level security;
drop policy if exists source_reports_public_read on public.source_reports;
create policy source_reports_public_read on public.source_reports for select to anon, authenticated using (true);
grant select on public.source_reports to anon, authenticated;
grant select, insert, update, delete on public.source_reports to service_role;

/* -------------------------------------------------------------------------- */
/* dynamic_sources: employers found on LinkedIn / JSearch and added by code     */
/* -------------------------------------------------------------------------- */

-- When a Riyadh cyber/cloud job comes from an employer the registry does not
-- track (the user's example: STC), the worker finds that employer's careers
-- site and, once real postings are confirmed there, adds it here. The
-- registry merges these at run time, so nothing needs a code commit.
create table if not exists public.dynamic_sources (
  id            text        primary key,
  company       text        not null,
  label         text        not null,
  kind          text        not null,
  adapter       text        not null,
  handle        text        not null,
  handle2       text,
  region        text        not null default 'ksa',
  needs_browser boolean     not null default false,
  enabled       boolean     not null default true,
  found_via     text,
  evidence      text,
  added_at      timestamptz not null default now()
);

alter table public.dynamic_sources enable row level security;
grant select, insert, update, delete on public.dynamic_sources to service_role;

-- Employers seen in search results that are not tracked yet, with progress.
create table if not exists public.employer_candidates (
  company_key   text        primary key,
  company       text        not null,
  seen_count    integer     not null default 1,
  example_title text,
  example_url   text,
  website       text,
  status        text        not null default 'new',
  note          text,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint employer_candidates_status_check check (status in ('new', 'searching', 'added', 'no-careers-site', 'blocked', 'ignored'))
);

alter table public.employer_candidates enable row level security;
grant select, insert, update, delete on public.employer_candidates to service_role;

/* -------------------------------------------------------------------------- */
/* co-op watch                                                                 */
/* -------------------------------------------------------------------------- */

-- Co-op intakes open seasonally, and a company may publish a brand-new page
-- for this year's intake instead of updating the old one. Each watched
-- company is checked several ways (scripts/coop-watch.ts); anything new is
-- recorded here and alerted once.
create table if not exists public.coop_watch (
  company      text        primary key,
  overview_url text,
  domain       text,
  last_hash    text,
  known_urls   text[]      not null default '{}',
  known_hosts  text[]      not null default '{}',
  checked_at   timestamptz
);

create table if not exists public.coop_signals (
  id          bigint generated always as identity primary key,
  company     text        not null,
  kind        text        not null,
  url         text        not null,
  detail      text,
  found_at    timestamptz not null default now(),
  alerted_at  timestamptz,
  constraint coop_signals_unique unique (company, kind, url)
);

alter table public.coop_watch enable row level security;
alter table public.coop_signals enable row level security;
drop policy if exists coop_signals_public_read on public.coop_signals;
create policy coop_signals_public_read on public.coop_signals for select to anon, authenticated using (true);
grant select on public.coop_signals to anon, authenticated;
grant select, insert, update, delete on public.coop_watch to service_role;
grant select, insert, update, delete on public.coop_signals to service_role;

/* -------------------------------------------------------------------------- */
/* alerts already sent                                                          */
/* -------------------------------------------------------------------------- */

-- So an instant alert is sent once per job, not once per run.
alter table public.jobs add column if not exists alerted_at timestamptz;
