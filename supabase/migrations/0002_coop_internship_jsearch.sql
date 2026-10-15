-- Adds the co-op and internship experience bands, and the dedicated JSearch
-- source kind whose results are kept in their own tab rather than mixed into
-- the company results.

/* ---------------------------- experience bands ---------------------------- */

alter table public.jobs
  drop constraint if exists jobs_experience_band_check;

alter table public.jobs
  add constraint jobs_experience_band_check
  check (
    experience_band in ('coop', 'internship', '0-2', '3-5', '6-9', '10+', 'unknown')
  );

comment on column public.jobs.experience_band is
  'coop and internship are distinct from 0-2: in Saudi the cooperative training
   semester and the summer internship are separate, formally-run intakes, and a
   student searching for one is not looking for a permanent entry-level role.';

-- Student-facing views hit this constantly, so give those two bands their own
-- partial index rather than making them share the general one.
create index if not exists jobs_student_bands_idx
  on public.jobs (experience_band, city, first_seen_at desc)
  where is_active and experience_band in ('coop', 'internship');

/* ------------------------------ source kinds ------------------------------ */

-- JSearch rows are excluded from every other view, so the source_kind filter is
-- on the hot path for both the default listing and the JSearch tab.
create index if not exists jobs_source_kind_idx
  on public.jobs (source_kind, first_seen_at desc)
  where is_active;
