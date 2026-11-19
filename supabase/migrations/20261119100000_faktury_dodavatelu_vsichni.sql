-- ============================================================
-- 20261119100000 — Faktury dodavatelů zadávají a třídí všichni (majitel 19. 11.)
-- „aby všichni viděli faktury od dodavatelů … můžou je zadávat a rozstřizovat … nebudou vidět stav faktur
--  (zaplacené / nezaplacené)"
--
--  • jednorázově (značka supplier_invoices_all_v1): supplier_invoices_visibility = all
--    (super admin to může v nastavení faktur zase přepnout na „jen super admin")
--  • supplier_invoices_readable(): v režimu „all" čte každý aktivní uživatel (dřív jen obchodník / admin)
--  • zaplaceno / nezaplaceno dál mění jen super admin (trigger supplier_invoices_before beze změny);
--    aplikace stav platby ostatním nezobrazuje
-- Idempotentní.
-- ============================================================

create or replace function supplier_invoices_readable() returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user() and (is_super_admin() or supplier_invoices_for_all())
$$;

do $$
declare v_new boolean;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('supplier_invoices_all_v1', 'supplier_invoices', 'Faktury dodavatelů zadávají všichni (19. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if coalesce(v_new, false) then
    update integration_settings set value = 'all' where key = 'supplier_invoices_visibility';
    raise notice 'Faktury dodavatelů: viditelnost přepnuta na všechny (stav platby jen super admin).';
  end if;
end $$;
