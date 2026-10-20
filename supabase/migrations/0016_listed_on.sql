-- The other sites a posting is listed on, where its source says so: JSearch
-- returns every site Google found the same vacancy on (LinkedIn, Indeed, Bayt,
-- Glassdoor, Naukrigulf...). The board shows them on the card's Duplicate
-- badge next to the copies our own dedup found.
alter table public.jobs add column if not exists listed_on text[] not null default '{}';
