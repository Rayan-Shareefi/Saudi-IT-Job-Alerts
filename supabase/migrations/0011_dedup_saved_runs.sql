-- Duplicates, saved jobs, run tracking and the CV profile.

/* -------------------------------------------------------------------------- */
/* bulk write of duplicate groups (src/lib/dedupe.ts)                          */
/* -------------------------------------------------------------------------- */

create or replace function public.apply_duplicates(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.jobs j
     set duplicate_of      = r.duplicate_of,
         also_on           = coalesce(r.also_on, '[]'::jsonb),
         last_refreshed_at = coalesce(r.last_refreshed_at, j.last_refreshed_at)
    from jsonb_to_recordset(p_rows) as r(id uuid, duplicate_of uuid, also_on jsonb, last_refreshed_at timestamptz)
   where j.id = r.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.apply_duplicates(jsonb) from public, anon, authenticated;
grant execute on function public.apply_duplicates(jsonb) to service_role;

/* -------------------------------------------------------------------------- */
/* saved jobs                                                                  */
/* -------------------------------------------------------------------------- */

-- What the user saved or applied to. Never removed by any rule: a saved job
-- that expires stays in the Saved tab, labelled, until the user removes it.
-- Read and written only through the server (service role) - which jobs a
-- person applied to is not for the public read path.
create table if not exists public.saved_jobs (
  job_id      uuid primary key references public.jobs(id) on delete cascade,
  saved_at    timestamptz not null default now(),
  applied_at  timestamptz,
  note        text
);

alter table public.saved_jobs enable row level security;
grant select, insert, update, delete on public.saved_jobs to service_role;

/* -------------------------------------------------------------------------- */
/* collection runs                                                             */
/* -------------------------------------------------------------------------- */

-- One row per run, started by a button, a schedule or the laptop. Progress
-- lives here rather than in a server's memory, so it survives reloads,
-- redeploys and runs that happen on a different machine.
create table if not exists public.ingest_runs (
  id            uuid primary key default gen_random_uuid(),
  scope         text        not null,
  status        text        not null default 'queued',
  trigger       text        not null default 'button',
  runner        text,
  requested_at  timestamptz not null default now(),
  started_at    timestamptz,
  finished_at   timestamptz,
  heartbeat_at  timestamptz,
  total         integer     not null default 0,
  done          integer     not null default 0,
  current       text,
  fetched       integer     not null default 0,
  kept          integer     not null default 0,
  inserted      integer     not null default 0,
  failed        integer     not null default 0,
  skipped       jsonb       not null default '[]',
  error         text,
  github_run_id text,
  constraint ingest_runs_status_check check (status in ('queued', 'running', 'done', 'failed', 'stalled')),
  constraint ingest_runs_scope_check check (scope in ('company', 'api', 'linkedin', 'judge', 'worker'))
);

-- One live run per scope: a second click while one is queued or running gets
-- the existing run back instead of starting another.
create unique index if not exists ingest_runs_one_live_idx
  on public.ingest_runs (scope)
  where status in ('queued', 'running');

create index if not exists ingest_runs_recent_idx on public.ingest_runs (scope, requested_at desc);

alter table public.ingest_runs enable row level security;
drop policy if exists ingest_runs_public_read on public.ingest_runs;
create policy ingest_runs_public_read on public.ingest_runs for select to anon, authenticated using (true);
grant select on public.ingest_runs to anon, authenticated;
grant select, insert, update on public.ingest_runs to service_role;

/* -------------------------------------------------------------------------- */
/* the user's CV profile                                                       */
/* -------------------------------------------------------------------------- */

-- The parsed profile only (skills, certifications, years) - never the file.
-- Stored so the Recommended badge works on every device and in the emails.
create table if not exists public.user_profile (
  id          text primary key default 'me',
  profile     jsonb       not null,
  updated_at  timestamptz not null default now()
);

alter table public.user_profile enable row level security;
grant select, insert, update, delete on public.user_profile to service_role;
