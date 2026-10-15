-- Bulk-write recomputed review states and re-derived facts.
--
-- src/lib/review.ts recomputes every row's state from the rules, the verified
-- model votes and the user's override, then writes only the rows that changed.
-- PostgREST cannot express a partial-row bulk UPDATE (an upsert would have to
-- carry every NOT NULL column), so it goes through this function.

create or replace function public.apply_job_states(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.jobs j
     set review_state        = r.review_state,
         hidden_reason       = r.hidden_reason,
         decided_by          = r.decided_by,
         decided_at          = now(),
         decision_note       = r.decision_note,
         scope               = r.scope,
         focus               = coalesce(array(select jsonb_array_elements_text(r.focus)), '{}'),
         scope_evidence      = coalesce(array(select jsonb_array_elements_text(r.scope_evidence)), '{}'),
         experience_band     = coalesce(r.experience_band, j.experience_band),
         min_years           = case when r.experience_band is null then j.min_years else r.min_years end,
         max_years           = case when r.experience_band is null then j.max_years else r.max_years end,
         experience_source   = coalesce(r.experience_source, j.experience_source),
         experience_evidence = case when r.experience_band is null then j.experience_evidence else r.experience_evidence end,
         company_key         = coalesce(r.company_key, j.company_key),
         text_quality        = coalesce(r.text_quality, j.text_quality),
         text_hash           = coalesce(r.text_hash, j.text_hash),
         apply_kind          = coalesce(r.apply_kind, j.apply_kind),
         apply_url           = coalesce(r.apply_url, j.apply_url),
         city                = coalesce(r.city, j.city),
         is_riyadh           = coalesce(r.city, j.city) = 'riyadh'
    from jsonb_to_recordset(p_rows) as r(
           id uuid,
           review_state text,
           hidden_reason text,
           decided_by text,
           decision_note text,
           scope text,
           focus jsonb,
           scope_evidence jsonb,
           experience_band text,
           min_years smallint,
           max_years smallint,
           experience_source text,
           experience_evidence text,
           company_key text,
           text_quality text,
           text_hash text,
           apply_kind text,
           apply_url text,
           city text
         )
   where j.id = r.id;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function public.apply_job_states(jsonb) from public, anon, authenticated;
grant execute on function public.apply_job_states(jsonb) to service_role;
