-- ============================================================
-- Konec toku (beta 29. 10.): jedna cesta platby, dodací listy po položkách.
--  1) sync_payments_from_order NIKDY nesmaže ruční úhrady (zálohy, dílčí platby z „Zadat platbu“).
--     Dřív přímý zápis orders.paid_at / paid_amount (stará „Zaplaceno“ v kartě = markJobPaid, psql,
--     úklid testů) smazal VŠECHNY job_payments a vložil jednu „Převzato ze zápisu úhrady“ → zálohy zmizely.
--     Teď: maže / přepisuje jen řádky via = 'automaticky' (ty vznikly právě z tohoto zrcadla); s ručními
--     úhradami se zapíše jen doplatek do zadané částky (záloha se nezapočte dvakrát).
--  2) delivery_note_items.order_item_id — řádek dodacího listu ví, ke které položce zakázky patří
--     (dodávka zapsaná bez DL se pak pozná a dostane svůj DL; „DL na dodané zboží“ i u zakázky s DL).
--     Doplnění starších řádků z historie vystavení (job_events: deliveryNoteId + items v pořadí řádků).
-- Idempotentní (create or replace, add column if not exists, doplnění jen prázdných).
-- ============================================================

-- ── 1) Úhrady: ochrana ručních záznamů ──
create or replace function sync_payments_from_order(p_job uuid, p_old_at date, p_old_amount numeric,
  p_new_at date, p_new_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last       uuid;
  v_has_manual boolean;
  v_manual     numeric;
  v_rest       numeric;
  v_prev_s     text := current_setting('app.payments_sync', true);
begin
  perform set_config('app.payments_sync', 'on', true);
  -- ruční = všechno, co nevzniklo tímto zrcadlem (Zadat platbu, foto, import, převzaté při zavedení evidence)
  select coalesce(bool_or(via <> 'automaticky'), false), coalesce(sum(amount) filter (where via <> 'automaticky'), 0)
    into v_has_manual, v_manual
  from job_payments where job_id = p_job;

  if p_new_at is null and p_new_amount is null then
    -- zrušení úhrady: zmizí jen automatické řádky; ruční zůstanou, jen už zakázku nevyrovnávají
    delete from job_payments where job_id = p_job and via = 'automaticky';
    update job_payments set settles = false where job_id = p_job and settles;
  elsif p_new_amount is distinct from p_old_amount then
    delete from job_payments where job_id = p_job and via = 'automaticky';
    if v_has_manual then
      -- zadaná částka = zaplaceno celkem → automaticky jen doplatek nad ruční úhrady (nikdy záporný)
      v_rest := case when p_new_amount is null then null else greatest(p_new_amount - v_manual, 0) end;
      if p_new_at is not null or coalesce(v_rest, 0) > 0 then
        insert into job_payments (job_id, paid_on, amount, settles, via, note)
        values (p_job, coalesce(p_new_at, app_today()), v_rest, p_new_at is not null, 'automaticky',
                'Doplatek ze zápisu úhrady (ruční úhrady zůstaly)');
      end if;
    else
      insert into job_payments (job_id, paid_on, amount, settles, via, note)
      values (p_job, coalesce(p_new_at, app_today()), p_new_amount, p_new_at is not null, 'automaticky',
              'Převzato ze zápisu úhrady');
    end if;
  elsif p_new_at is null then
    update job_payments set settles = false where job_id = p_job and settles;
  else
    select id into v_last from job_payments where job_id = p_job and settles
    order by paid_on desc, created_at desc limit 1;
    if v_last is null then
      insert into job_payments (job_id, paid_on, amount, settles, via, note)
      values (p_job, p_new_at, null, true, 'automaticky', 'Celá / zbývající částka (uzavření zakázky)');
    else
      update job_payments set paid_on = p_new_at where id = v_last;
    end if;
  end if;
  perform recompute_job_payments(p_job);
  perform set_config('app.payments_sync', coalesce(v_prev_s, ''), true);
end $$;

-- vnitřní přepočet (SECURITY DEFINER, mění data): jen DB a servisní role (jako původní definice)
revoke execute on function sync_payments_from_order(uuid, date, numeric, date, numeric) from public, anon, authenticated;
grant execute on function sync_payments_from_order(uuid, date, numeric, date, numeric) to service_role;

-- ── 2) Dodací list: řádek → položka zakázky ──
alter table delivery_note_items add column if not exists order_item_id uuid references order_items(id) on delete set null;
create index if not exists idx_delivery_note_items_item on delivery_note_items(order_item_id) where order_item_id is not null;
create index if not exists idx_delivery_note_items_note on delivery_note_items(delivery_note_id);

-- starší řádky: pořadí řádku (position) = pořadí položek v události vystavení DL (stejné řazení)
update delivery_note_items dni
set order_item_id = src.item_id
from (
  select distinct on (e.data->>'deliveryNoteId', (x.ord - 1))
         (e.data->>'deliveryNoteId')::uuid as note_id,
         (x.ord - 1)::int as position,
         (x.item->>'itemId')::uuid as item_id
  from job_events e
  cross join lateral jsonb_array_elements(e.data->'items') with ordinality as x(item, ord)
  where e.data->>'action' = 'issued'
    and e.data->>'kind' = 'dodaci_list'
    and coalesce(e.data->>'deliveryNoteId', '') ~ '^[0-9a-fA-F-]{36}$'
    and jsonb_typeof(e.data->'items') = 'array'
    and coalesce(x.item->>'itemId', '') ~ '^[0-9a-fA-F-]{36}$'
  order by e.data->>'deliveryNoteId', (x.ord - 1), e.created_at desc
) src
where dni.delivery_note_id = src.note_id
  and dni.position = src.position
  and dni.order_item_id is null
  and exists (select 1 from order_items oi where oi.id = src.item_id);
