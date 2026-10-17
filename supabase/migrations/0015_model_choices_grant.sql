-- 0014 created model_choices without the grant every table here needs: the
-- weekly model check could read nothing and write nothing ("permission
-- denied for table model_choices", caught by its first test, 2026-10-17).
grant select, insert, update, delete on public.model_choices to service_role;
