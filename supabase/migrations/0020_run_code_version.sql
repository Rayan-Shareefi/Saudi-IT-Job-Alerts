-- Which version of the code each run used (2026-10-22). The laptop ran a
-- copied folder's old code for days and nobody could tell: the website now
-- shows the laptop's version beside the latest one.
alter table public.ingest_runs add column if not exists code_version text;
