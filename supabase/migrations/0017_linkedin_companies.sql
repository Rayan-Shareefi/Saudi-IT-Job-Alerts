-- LinkedIn company pages the laptop reads, without signing in: their recent
-- posts (hiring, co-op, internships) and, through the company's numeric id,
-- their job listings. Filled by itself from the company named on every
-- LinkedIn job card; visited a few at a time, the longest-unvisited first.
create table if not exists public.linkedin_companies (
  slug             text        primary key,
  name             text,
  org_id           text,
  website          text,
  status           text        not null default 'new',
  seen_count       integer     not null default 1,
  found_via        text,
  last_visited_at  timestamptz,
  last_jobs_at     timestamptz,
  posts_found      integer     not null default 0,
  created_at       timestamptz not null default now(),
  constraint linkedin_companies_status_check check (status in ('new', 'ok', 'dead'))
);

create index if not exists linkedin_companies_due_idx on public.linkedin_companies (status, last_visited_at);

alter table public.linkedin_companies enable row level security;
grant select, insert, update, delete on public.linkedin_companies to service_role;

-- bump_seen: count another job card for a company, adding it if new.
create or replace function public.linkedin_company_seen(p_slug text, p_name text, p_via text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.linkedin_companies (slug, name, found_via)
  values (p_slug, p_name, p_via)
  on conflict (slug) do update set seen_count = public.linkedin_companies.seen_count + 1,
                                   name = coalesce(public.linkedin_companies.name, excluded.name);
$$;

revoke all on function public.linkedin_company_seen(text, text, text) from public, anon, authenticated;
grant execute on function public.linkedin_company_seen(text, text, text) to service_role;
