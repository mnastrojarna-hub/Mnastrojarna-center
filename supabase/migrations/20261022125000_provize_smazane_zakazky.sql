-- ============================================================
-- 0023 — Smazaná zakázka nesmí zůstat v provizích
--
-- commission_entries.order_id je „on delete set null" — po smazání zakázky
-- zůstával její nevyplacený záznam bez vazby a dál se sčítal do měsíčního
-- vyúčtování obchodníka. Teď se před smazáním zakázky nevyplacené záznamy
-- odstraní a dotčené měsíce přepočítají. Vyplacené zůstávají (historie výplat).
-- ============================================================

create or replace function orders_delete_commissions()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in
    select distinct owner_id, period from commission_entries
    where order_id = old.id and status <> 'vyplaceno'
  loop
    delete from commission_entries
      where order_id = old.id and owner_id = r.owner_id and period = r.period and status <> 'vyplaceno';
    perform recompute_owner_month(r.owner_id, r.period);
  end loop;
  return old;
end $$;

drop trigger if exists trg_orders_delete_commissions on orders;
create trigger trg_orders_delete_commissions before delete on orders
  for each row execute function orders_delete_commissions();

-- Jednorázový úklid: nevyplacené záznamy už smazaných zakázek
do $$
declare r record;
begin
  for r in
    select distinct owner_id, period from commission_entries
    where order_id is null and status <> 'vyplaceno'
  loop
    delete from commission_entries
      where order_id is null and owner_id is not distinct from r.owner_id and period = r.period and status <> 'vyplaceno';
    perform recompute_owner_month(r.owner_id, r.period);
  end loop;
end $$;
