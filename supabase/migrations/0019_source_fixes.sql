-- Repairs to the sites the collector reads (2026-10-21).
--
-- The Human intervene, Site report, Failing sources and Check URLs pages each
-- let the user paste a working URL, or press "Find fixes" to have the laptop
-- look for one. A request waits here until the laptop checks it
-- (scripts/fix-sources.ts): robots.txt, bot protection, which job system the
-- page runs on, and a real read that must return real postings. A fix that
-- works is applied by itself; one the checker cannot settle - even after the
-- AI jury - waits for the user with the reason and the choices. The user's
-- choices are kept and learned from.
create table if not exists public.source_fixes (
  id            uuid        primary key default gen_random_uuid(),
  company       text        not null,
  source_id     text,
  page          text        not null,
  old_url       text,
  new_url       text,
  requested_by  text        not null default 'user',
  status        text        not null default 'queued',
  verdict       text,
  reason        text,
  detail        jsonb       not null default '{}',
  options       text[]      not null default '{}',
  decision      text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  checked_at    timestamptz,
  constraint source_fixes_page_check check (page in ('human', 'sites', 'failing', 'urls')),
  constraint source_fixes_status_check check (status in ('queued', 'checking', 'applied', 'needs_you', 'done')),
  constraint source_fixes_by_check check (requested_by in ('user', 'auto'))
);

create index if not exists source_fixes_status_idx on public.source_fixes (status, created_at);
create index if not exists source_fixes_company_idx on public.source_fixes (company, created_at desc);

alter table public.source_fixes enable row level security;
-- Company names, public URLs and reasons, like source_reports: readable by the board.
drop policy if exists source_fixes_public_read on public.source_fixes;
create policy source_fixes_public_read on public.source_fixes for select to anon, authenticated using (true);
grant select on public.source_fixes to anon, authenticated;
grant select, insert, update, delete on public.source_fixes to service_role;

-- A source the collector should no longer read (the user chose "delete", or a
-- fix replaced it). Reversible: delete the row and the source is read again.
create table if not exists public.source_overrides (
  source_id   text        primary key,
  action      text        not null default 'disable',
  company     text,
  reason      text,
  fix_id      uuid,
  created_at  timestamptz not null default now(),
  constraint source_overrides_action_check check (action in ('disable'))
);

alter table public.source_overrides enable row level security;
grant select, insert, update, delete on public.source_overrides to service_role;

-- A board found by a fix stands in for the sources it replaces.
alter table public.dynamic_sources add column if not exists replaces text[] not null default '{}';
