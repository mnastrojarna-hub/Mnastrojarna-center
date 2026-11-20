-- ============================================================
-- 20261120100000 — Číslo nabídky podle zakázky (majitel 20. 11.)
-- „číslo nabídky bude mít stejný systém jako mají nyní objednávky — N a pak číslo zakázky, při více
--  nabídkách V1–Vx"  →  N2026/025-V1, N2026/025-V2 … (jako objednávky dodavatelům OV2026/025-1)
--
-- next_job_quote_number(p_job): další číslo nabídky zakázky (zámek na zakázku → souběžné vytvoření
-- nedostane stejné číslo). Bez zakázky / nečitelné číslo zakázky → dosavadní řada NAB-RRRR-NNN.
-- Starší nabídky si svá čísla (NAB-…) nechávají. Idempotentní.
-- ============================================================

create or replace function next_job_quote_number(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_num  text;
  v_base text;
  v_max  integer;
begin
  if p_job is null then return next_doc_number('NAB'); end if;
  select number into v_num from orders where id = p_job;
  v_base := job_po_base(v_num);
  if v_base is null or v_base !~ '^\d{4}/\d+$' then return next_doc_number('NAB'); end if;
  perform pg_advisory_xact_lock(hashtext('job_quote_number:' || p_job::text));
  select coalesce(max(substring(q.number from '-V(\d+)$')::int), 0) into v_max
    from quotes q
   where q.job_id = p_job and q.number like 'N' || v_base || '-V%';
  return 'N' || v_base || '-V' || (v_max + 1);
end $$;

revoke execute on function next_job_quote_number(uuid) from public, anon;
grant execute on function next_job_quote_number(uuid) to authenticated, service_role;
