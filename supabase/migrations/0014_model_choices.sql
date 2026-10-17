-- The AI models the weekly check (scripts/llm-upgrade.ts) chose, one per
-- role. Every machine reads this table, so a change reaches GitHub, the laptop
-- and Vercel at once with no setting edited. Delete a row to go back to the
-- built-in defaults; a model pinned in .env.local / secrets beats this table.
create table if not exists public.model_choices (
  role        text        primary key,
  model       text        not null,
  previous    text,
  score       text,
  reason      text,
  checked_at  timestamptz not null default now(),
  changed_at  timestamptz
);

alter table public.model_choices enable row level security;
-- Service role only: no public policy.
