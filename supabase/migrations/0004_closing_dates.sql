-- Closing dates.
--
-- A posting with a deadline that has passed is worse than no posting: it looks
-- live, it costs the reader the time to open it, and the application goes
-- nowhere. Employers state the date often enough to be worth extracting - in
-- JSON-LD as validThrough, and in the body as "closing date", "apply by",
-- "last date to apply" and their Arabic equivalents.

alter table public.jobs
  add column if not exists closes_at timestamptz;

comment on column public.jobs.closes_at is
  'When applications close, where the posting says so. Null means no stated
   deadline, which is the common case - it must never be read as "closes now".';

-- The board filters on it, so it belongs in the hot partial index.
create index if not exists jobs_closes_at_idx
  on public.jobs (closes_at)
  where is_active and removed_at is null and closes_at is not null;
