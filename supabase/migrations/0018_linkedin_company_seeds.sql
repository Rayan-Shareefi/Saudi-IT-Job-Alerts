-- The first company pages to read, before job cards add the rest. Each was
-- checked to be a public page with posts (2026-10-21) or comes from the
-- registry's own LinkedIn careers link. Highest priority: read first.
insert into public.linkedin_companies (slug, name, found_via, seen_count)
values
  ('elm', 'Elm Company', 'seed', 100),
  ('stc', 'stc', 'seed', 100),
  ('sirarbystc', 'sirar by stc', 'registry', 100)
on conflict (slug) do nothing;
