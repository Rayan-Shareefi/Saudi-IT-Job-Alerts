-- The laptop worker's heartbeat (2026-10-22). It writes here every two
-- minutes and before each long step, so the website can say "online, doing
-- X" or "offline since 03:06" - the last search alone could not tell a
-- sleeping laptop from a busy one.
create table if not exists public.worker_status (
  id            text        primary key,
  seen_at       timestamptz not null default now(),
  version       text,
  state         text,
  busy_until    timestamptz,
  next_cycle_at timestamptz
);

alter table public.worker_status enable row level security;
drop policy if exists worker_status_public_read on public.worker_status;
create policy worker_status_public_read on public.worker_status for select to anon, authenticated using (true);
grant select on public.worker_status to anon, authenticated;
grant select, insert, update, delete on public.worker_status to service_role;
