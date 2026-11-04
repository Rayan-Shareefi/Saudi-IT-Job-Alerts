-- Employers searched on Google Jobs through SerpApi (2026-11-04): the ones
-- whose own careers site cannot be read - blocked, moved, or a list the reader
-- cannot see. Each run takes those searched longest ago, so the free 250
-- searches a month go round all of them.
create table if not exists public.serpapi_targets (
  company          text        primary key,
  last_searched_at timestamptz,
  last_found       integer     not null default 0,
  searches         integer     not null default 0
);

alter table public.serpapi_targets enable row level security;
grant select, insert, update, delete on public.serpapi_targets to service_role;
