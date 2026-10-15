-- Split the entry experience band.
--
-- "No experience needed" and "one or two years" are different jobs to someone
-- who has neither, and merging them into 0-2 hid the roles a final-year student
-- can actually apply for behind the ones asking for two years in industry.

-- Order matters: the constraint is dropped, the data is moved, and only then is
-- the new constraint added. Adding it first fails on every existing 0-2 row.
alter table public.jobs drop constraint if exists jobs_experience_band_check;

-- Everything banded 0-2 had a stated minimum of 0, 1 or 2; min_years decides
-- which side it belongs on, and a row with no stated minimum is the "no
-- experience needed" case by definition.
update public.jobs
   set experience_band = case
         when coalesce(min_years, 0) <= 0 then '0'
         else '1-2'
       end
 where experience_band = '0-2';

alter table public.jobs
  add constraint jobs_experience_band_check
  check (experience_band in ('coop', 'internship', '0', '1-2', '3-5', '6-9', '10+', 'unknown'));
