-- The weekly accuracy check (scripts/accuracy-check.ts, 2026-10-22): a fresh
-- reading of a random sample of the jobs on the board by the strongest free
-- model. A finding is shown on the card as "Double-check" and emailed; it
-- never hides a job by itself - the owner's Keep / Hide decides.
create table if not exists public.accuracy_checks (
  id          uuid        primary key default gen_random_uuid(),
  job_id      uuid        not null references public.jobs (id) on delete cascade,
  checked_at  timestamptz not null default now(),
  provider    text        not null,
  model       text        not null,
  flagged     boolean     not null,
  why         text
);

create index if not exists accuracy_checks_job_idx on public.accuracy_checks (job_id, checked_at desc);

alter table public.accuracy_checks enable row level security;
-- Titles' verdicts only, like the board itself: readable by the board.
drop policy if exists accuracy_checks_public_read on public.accuracy_checks;
create policy accuracy_checks_public_read on public.accuracy_checks for select to anon, authenticated using (true);
grant select on public.accuracy_checks to anon, authenticated;
grant select, insert, update, delete on public.accuracy_checks to service_role;
