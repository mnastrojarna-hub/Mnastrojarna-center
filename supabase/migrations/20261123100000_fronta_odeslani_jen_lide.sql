-- ============================================================
-- 20261123100000 — Odeslaná pošta nesmí viset ve frontě (majitel 23. 11.)
-- „pokud kliknu kdekoliv odeslat, musí maily odejít" + „mají se odeslat jen lidmi poslané maily, ne žádné
-- automatické AI zprávy … návrhy AI člověkem neotevřené nebo neposlané smaž"
--
-- Jednorázově (značka send_queue_humans_only_v1):
--  • fronta odeslání s výkresy (anon_send_queue): automatická odeslání (předání do výroby bez kliknutí,
--    událost s auto = true) → zrušena; odeslání, která klikl člověk, zůstanou čekat — aplikace je po nasazení
--    odešle sama (výkres, jehož anonymizace se nepovedla, jako originál).
--  • fronta ke schválení: čekající AI návrhy odpovědí a připomínek (email_reply, reminder), které nikdo
--    neodeslal → smazány; u e-mailů zrušen příznak „má návrh".
-- Idempotentní (značka).
-- ============================================================

do $$
declare
  v_new boolean;
  v_auto integer := 0;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('send_queue_humans_only_v1', 'ai_access', 'Fronta odeslání: jen e-maily odeslané člověkem (23. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Fronta odeslání: úklid už proběhl dřív — beze změny.';
    return;
  end if;

  update anon_send_queue q
     set status = 'cancelled', updated_at = now(),
         reason = 'Automatické odeslání bez kliknutí člověka — zrušeno (23. 11.)'
   where q.status in ('waiting', 'blocked')
     and exists (
       select 1 from job_events ev
        where ev.data->>'sendQueueId' = q.id::text and coalesce(ev.data->>'auto', 'false') = 'true'
     );
  get diagnostics v_auto = row_count;

  with d as (
    delete from approval_queue
     where status = 'pending' and type::text in ('email_reply', 'reminder')
    returning email_id
  )
  update emails e set has_draft = false
    from (select distinct email_id from d where email_id is not null) x
   where e.id = x.email_id;

  raise notice 'Fronta odeslání: % automatických odeslání zrušeno; AI návrhy odpovědí a připomínek smazány.', v_auto;
end $$;
