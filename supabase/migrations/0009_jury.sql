-- The model jury: cached verdicts, a shared free-quota budget, and an audit trail.

/* -------------------------------------------------------------------------- */
/* judgements: one model's reading of one posting text                         */
/* -------------------------------------------------------------------------- */

-- Keyed by the text, not the row: the same posting on three sources is read
-- once, and a posting whose text changes is read again. prompt_version lets a
-- better prompt re-read everything without deleting the old answers.
create table if not exists public.judgements (
  id              uuid primary key default gen_random_uuid(),
  text_hash       text        not null,
  prompt_version  text        not null,
  provider        text        not null,
  model           text        not null,
  role            text        not null default 'juror',
  answer          jsonb       not null,
  -- which of the answer's claims survived the evidence check (judge/verify.ts)
  verified        jsonb       not null default '{}',
  latency_ms      integer,
  created_at      timestamptz not null default now(),
  constraint judgements_role_check check (role in ('juror', 'senior')),
  constraint judgements_unique unique (text_hash, prompt_version, provider, model, role)
);

create index if not exists judgements_text_hash_idx on public.judgements (text_hash);

alter table public.judgements enable row level security;
grant select, insert, update, delete on public.judgements to service_role;

/* -------------------------------------------------------------------------- */
/* api_usage: one budget shared by GitHub Actions, the laptop and dev          */
/* -------------------------------------------------------------------------- */

-- period is '2026-10' for monthly caps (JSearch) and '2026-10-13' for daily
-- ones (Gemini, Groq, LinkedIn). Free tiers stop rather than bill, but running
-- into the wall mid-run loses work, so callers reserve before they spend.
create table if not exists public.api_usage (
  provider    text        not null,
  period      text        not null,
  requests    integer     not null default 0,
  tokens      bigint      not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (provider, period)
);

alter table public.api_usage enable row level security;
grant select, insert, update on public.api_usage to service_role;

-- Atomically add usage if it stays within the caps; false (and no change) if
-- it would not. A cap of 0 or null means "no cap".
create or replace function public.bump_usage(
  p_provider text,
  p_period text,
  p_requests integer,
  p_tokens bigint,
  p_cap_requests integer,
  p_cap_tokens bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  insert into public.api_usage (provider, period, requests, tokens)
  values (p_provider, p_period, 0, 0)
  on conflict (provider, period) do nothing;

  update public.api_usage
     set requests = requests + p_requests,
         tokens = tokens + p_tokens,
         updated_at = now()
   where provider = p_provider
     and period = p_period
     and (coalesce(p_cap_requests, 0) = 0 or requests + p_requests <= p_cap_requests)
     and (coalesce(p_cap_tokens, 0) = 0 or tokens + p_tokens <= p_cap_tokens)
  returning true into ok;

  return coalesce(ok, false);
end;
$$;

revoke all on function public.bump_usage(text, text, integer, bigint, integer, bigint) from public, anon, authenticated;
grant execute on function public.bump_usage(text, text, integer, bigint, integer, bigint) to service_role;

/* -------------------------------------------------------------------------- */
/* audit_log: who decided what, so any decision can be traced and undone       */
/* -------------------------------------------------------------------------- */

create table if not exists public.audit_log (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor    text        not null,
  action   text        not null,
  job_id   uuid,
  detail   jsonb       not null default '{}'
);

create index if not exists audit_log_job_idx on public.audit_log (job_id, at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, at desc);

alter table public.audit_log enable row level security;
grant select, insert on public.audit_log to service_role;
