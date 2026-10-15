-- Results of re-checking employer careers URLs.
--
-- Stored rather than written to a file because the check runs from the deployed
-- app, where the filesystem is ephemeral: a finding written to disk in one
-- request does not exist in the next.
--
-- Nothing here is applied automatically. A careers URL is the single point of
-- failure for an employer - point it at the wrong page and that company
-- silently produces nothing - so these are findings for review, and the app
-- shows them with both the old and the new URL so the change can be judged
-- before it is made.

create table if not exists public.url_findings (
  company        text primary key,
  current_url    text not null,
  -- Set when a better URL was found. Null for "unchanged" and "unreachable".
  suggested_url  text,
  -- Additional boards for the same employer: a graduate scheme, an Arabic
  -- listing, a separate internships portal.
  extra_urls     text[] not null default '{}',
  status         text not null,
  note           text,
  checked_at     timestamptz not null default now(),
  -- Set once a human has acted on it, so the list shows what is still open.
  reviewed_at    timestamptz,

  constraint url_findings_status_check
    check (status in ('unchanged', 'moved', 'extra-found', 'stale', 'unreachable'))
);

comment on table public.url_findings is
  'Per-employer result of the last careers-URL check. Advisory only: the app
   displays these for review and never rewrites a source from them.';

create index if not exists url_findings_open_idx
  on public.url_findings (checked_at desc)
  where reviewed_at is null and status <> 'unchanged';

alter table public.url_findings enable row level security;

drop policy if exists url_findings_public_read on public.url_findings;
create policy url_findings_public_read
  on public.url_findings
  for select
  to anon, authenticated
  using (true);

-- Explicit grants.
--
-- Supabase's default privileges cover tables created through its own tooling.
-- A table created over the direct Postgres connection, as these migrations do,
-- gets none of them - so the service role could not write here and the API
-- returned "permission denied for table url_findings" while RLS looked fine.
grant select on public.url_findings to anon, authenticated;
grant select, insert, update, delete on public.url_findings to service_role;
