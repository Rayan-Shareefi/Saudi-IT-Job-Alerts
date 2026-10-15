-- Your decisions about the URLs the checker finds.
--
-- One row per (company, url), because the choice is per URL: a finding can
-- carry a replacement plus three additional boards, and you may want one of
-- them and not the others.
--
-- These are overrides layered on top of src/lib/sources/companies.ts, not edits
-- to it. The deployed app cannot write to a TypeScript file, and a checkbox in
-- a browser should not be rewriting source anyway - discovery merges what is
-- accepted here when it resolves employers into pollable sources.

create table if not exists public.url_decisions (
  company     text        not null,
  url         text        not null,
  -- 'primary' replaces the employer's careers URL; 'alternate' adds a second
  -- board polled alongside it.
  role        text        not null,
  decision    text        not null,
  decided_at  timestamptz not null default now(),

  primary key (company, url),
  constraint url_decisions_role_check check (role in ('primary', 'alternate')),
  constraint url_decisions_decision_check check (decision in ('accepted', 'rejected'))
);

comment on table public.url_decisions is
  'Accepted or dismissed careers URLs. Nothing is applied without a row here -
   the checker only ever proposes.';

create index if not exists url_decisions_accepted_idx
  on public.url_decisions (company)
  where decision = 'accepted';

alter table public.url_decisions enable row level security;

drop policy if exists url_decisions_public_read on public.url_decisions;
create policy url_decisions_public_read
  on public.url_decisions
  for select
  to anon, authenticated
  using (true);

-- Supabase's default privileges only cover tables created through its own
-- tooling; these migrations run over the direct Postgres connection, so the
-- grants have to be explicit or the service role gets "permission denied".
grant select on public.url_decisions to anon, authenticated;
grant select, insert, update, delete on public.url_decisions to service_role;
