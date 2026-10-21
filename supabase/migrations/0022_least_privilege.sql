-- Least privilege for the public key (security review, 2026-10-22).
--
-- The anon and authenticated roles held Supabase's default grants: insert,
-- update, delete and truncate on every table. Row-level security blocked the
-- writes (no write policy exists anywhere), but a single policy mistake would
-- have opened them, and TRUNCATE is not covered by row-level security at all.
-- Every write in this app goes through the service key on the server, so the
-- public roles keep only SELECT, and only where a read policy allows it.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

-- New tables get no rights for the public roles unless a migration grants them.
alter default privileges in schema public revoke insert, update, delete, truncate, references, trigger on tables from anon, authenticated;

-- An old view nothing reads. Views run with their owner's rights and skip
-- row-level security, so an unused one is only risk.
drop view if exists public.jobs_deduped;
