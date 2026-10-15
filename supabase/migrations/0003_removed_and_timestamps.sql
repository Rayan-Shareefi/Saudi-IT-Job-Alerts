-- Manual removal of postings that are no longer available.
--
-- Deliberately a flag rather than a DELETE. The ingest upserts on
-- (source_id, external_id) and sets is_active = true every time it sees a
-- posting, so a hard delete would be undone by the very next run - the row
-- would reappear a few hours later and look like the removal never worked.
-- A column the ingest never writes is the only thing that survives it.

alter table public.jobs
  add column if not exists removed_at timestamptz,
  add column if not exists removed_reason text;

comment on column public.jobs.removed_at is
  'Set when the posting was removed by hand because it is gone from the source.
   The read path excludes these; the ingest never clears it, so a removal
   sticks even though upsert keeps refreshing is_active and last_seen_at.';

-- The read path filters on it, so it belongs in the hot partial index.
drop index if exists public.jobs_active_city_seen_idx;
create index if not exists jobs_active_city_seen_idx
  on public.jobs (city, first_seen_at desc)
  where is_active and removed_at is null;

create index if not exists jobs_removed_idx
  on public.jobs (removed_at desc)
  where removed_at is not null;

-- The digest must not re-send something that was removed by hand.
drop index if exists public.jobs_digest_idx;
create index if not exists jobs_digest_idx
  on public.jobs (first_seen_at desc)
  where is_active and notified_at is null and removed_at is null;

-- Sorting and filtering by posting age needs an index that matches the
-- expression the query uses: posted_at when the source gave one, otherwise
-- when we first saw it. Without this the 12-hour filter table-scans.
create index if not exists jobs_effective_posted_idx
  on public.jobs (coalesce(posted_at, first_seen_at) desc)
  where is_active and removed_at is null;
