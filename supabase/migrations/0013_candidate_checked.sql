-- When discover-employers last looked for an employer's job board. A company
-- with no board yet is looked at again after 30 days: sites change, and the
-- candidate list is otherwise a one-way door.
alter table public.employer_candidates add column if not exists checked_at timestamptz;

create index if not exists employer_candidates_todo_idx on public.employer_candidates (status, checked_at);
