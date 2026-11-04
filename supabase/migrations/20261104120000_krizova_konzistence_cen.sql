-- ─────────────────────────────────────────────────────────────────────────────
-- Křížová konzistence cen zakázky (majitel 4. 11.: „součet položek musí odpovídat
-- hodnotě zakázky, objednávka dodavateli nákupu — když vyplním jedno, druhé se musí
-- přepsat"). Pravidla (stejná jako src/lib/jobs/consistency.ts):
--
--  1) Hodnota zakázky = Σ(počet × prodejní cena) položek, jakmile má aspoň jedna položka
--     cenu. Přepočítá se při každé změně položek (cena, počet, přidání, odebrání) — ať
--     položky mění kdokoli (karta, nacenění, pošta, focení, sloučení). Přímý zápis jiné
--     hodnoty do orders.value DB srovná zpět na součet položek (rozpočítání změny hodnoty
--     na položky dělá server — src/app/actions/job-consistency.ts).
--  2) Nákupní náklady = Σ objednávek dodavatelům (bez zrušených), jakmile nějaká je.
--     Zrušení poslední objednávky → nákup podle nákupních cen položek, jinak podle vítězné
--     nabídky dodavatele, jinak zůstane.
--  3) Vyfakturovaná zakázka (číslo faktury / vyfakturováno) se nikdy nepřepočítává.
--  4) Každý automatický přepočet zapíše do historie zakázky jednu událost (v rámci
--     jednoho požadavku se sloučí), u nákupu bez částek (citlivé).
--  5) Oprava dat: hodnota se srovná se součtem položek jen tam, kde nebyla odeslaná ani
--     přijatá nabídka a zakázka není vyfakturovaná; nákup se srovná s objednávkami
--     (nevyfakturované). Ostatní rozdíly ukáže karta zakázky s tlačítkem „Srovnat".
-- Idempotentní (create or replace, drop trigger if exists).
-- ─────────────────────────────────────────────────────────────────────────────

-- částka česky („48 000 Kč", „1 234,50 Kč") nezávisle na locale DB
create or replace function money_text(p numeric) returns text
language sql immutable set search_path = public as $$
  select case when p is null then '—' else
    replace(replace(to_char(round(p, 2), case when round(p, 2) = trunc(p) then 'FM999,999,999,990' else 'FM999,999,999,990.00' end),
                    ',', chr(160)), '.', ',') || ' Kč' end
$$;

-- zakázka je vyfakturovaná → ceny se už nepřepočítávají
create or replace function job_is_invoiced(p_invoice_number text, p_invoiced_at timestamptz) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(nullif(btrim(p_invoice_number), ''), null) is not null or p_invoiced_at is not null
$$;

-- Σ(počet × prodejní cena) položek s cenou; null = žádná položka nemá cenu
create or replace function job_items_value(p_job uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(sum(quantity * unit_price) filter (where unit_price is not null), 2)
  from order_items where order_id = p_job
$$;

-- Σ(počet × nákupní cena) položek s nákupní cenou; null = žádná nemá
create or replace function job_items_purchase(p_job uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select round(sum(quantity * purchase_unit_price) filter (where purchase_unit_price is not null), 2)
  from order_items where order_id = p_job
$$;

-- Σ objednávek dodavatelům bez zrušených; null = žádná aktivní objednávka
create or replace function job_ordered_cost(p_job uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case when count(*) = 0 then null else round(sum(coalesce(total, 0)), 2) end
  from purchase_orders where job_id = p_job and status <> 'zrusena'
$$;

/**
 * Událost automatického přepočtu do historie zakázky. V rámci jednoho požadavku serveru (x-actor-request)
 * nebo jedné transakce se sloučí do jedné („A → C" místo „A → B", „B → C").
 */
create or replace function log_money_sync(p_job uuid, p_kind text, p_field text, p_label text,
                                          p_from numeric, p_to numeric, p_message text, p_sensitive boolean)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_req  uuid := app_request_id();
  v_by   uuid := app_actor();
  v_id   uuid;
  v_from numeric := p_from;
  v_msg  text;
  v_data jsonb;
begin
  select e.id, (e.data->>'fromValue')::numeric into v_id, v_from
  from job_events e
  where e.job_id = p_job and e.type = 'field' and e.data->>'auto' = p_kind
    and ((v_req is not null and e.request_id = v_req) or e.data->>'tx' = txid_current()::text)
  order by e.created_at desc limit 1;
  if v_id is null then v_from := p_from; end if;

  if v_id is not null and not p_sensitive and v_from is not distinct from p_to then
    delete from job_events where id = v_id;          -- vráceno na původní — žádná změna
    return;
  end if;

  v_msg := case when p_sensitive then p_message
                else p_message || ': ' || money_text(v_from) || ' → ' || money_text(p_to) end;
  v_data := jsonb_build_object(
    'auto', p_kind, 'origin', 'db', 'via', 'automaticky', 'tx', txid_current()::text,
    'fromValue', case when p_sensitive then null else v_from end,
    'changes', jsonb_build_array(case when p_sensitive
      then jsonb_build_object('field', p_field, 'label', p_label, 'from', null, 'to', null,
                              'fromText', '', 'toText', '', 'sensitive', true)
      else jsonb_build_object('field', p_field, 'label', p_label, 'from', v_from, 'to', p_to,
                              'fromText', money_text(v_from), 'toText', money_text(p_to)) end));
  if p_sensitive then
    -- slučování citlivé změny bez částky: „fromValue" se nepíše, stačí, že událost existuje
    v_data := v_data - 'fromValue';
  end if;

  if v_id is not null then
    update job_events set message = v_msg, data = v_data where id = v_id;
  else
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (p_job, 'field', v_msg, v_data, v_by, app_event_kind(v_by), 'automaticky', 'job', p_job, v_req);
  end if;
end $$;

-- Hodnota zakázky ze součtu položek (pravidlo 1)
create or replace function sync_job_value(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j orders%rowtype;
  v numeric;
begin
  if p_job is null then return; end if;
  select * into j from orders where id = p_job;
  if not found or j.merged_into_id is not null or job_is_invoiced(j.invoice_number, j.invoiced_at) then return; end if;
  v := job_items_value(p_job);
  if v is null or (j.value is not null and abs(j.value - v) < 0.005) then return; end if;
  update orders set value = v where id = p_job;
  perform log_money_sync(p_job, 'items_value', 'value', 'Hodnota zakázky (bez DPH)', j.value, v,
                         'Hodnota zakázky přepočtena ze součtu položek', false);
end $$;

-- Nákupní náklady z objednávek dodavatelům (pravidlo 2)
create or replace function sync_job_purchase_cost(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  j   orders%rowtype;
  v   numeric;
  v_src text := 'objednávek dodavatelům';
begin
  if p_job is null then return; end if;
  select * into j from orders where id = p_job;
  if not found or j.merged_into_id is not null or job_is_invoiced(j.invoice_number, j.invoiced_at) then return; end if;
  v := job_ordered_cost(p_job);
  if v is null then
    -- žádná aktivní objednávka (zrušená / smazaná): nákup podle položek, jinak podle vítězné nabídky
    v := job_items_purchase(p_job);
    v_src := 'nákupních cen položek';
    if v is null then
      select total into v from supplier_quotes where job_id = p_job and selected and total is not null
      order by selected_at desc nulls last, created_at desc limit 1;
      v_src := 'vybrané nabídky dodavatele';
    end if;
  end if;
  if v is null or (j.purchase_cost is not null and abs(j.purchase_cost - v) < 0.005) then return; end if;
  update orders set purchase_cost = v where id = p_job;
  perform log_money_sync(p_job, 'po_cost', 'purchase_cost', 'Nákupní náklady', null, null,
                         'Nákupní náklady přepočteny podle ' || v_src, true);
end $$;

-- Přímý zápis do orders.value / purchase_cost: hodnota zůstane = součtu položek, nákup = objednávkám
create or replace function orders_money_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if old.merged_into_id is not null or job_is_invoiced(old.invoice_number, old.invoiced_at) then return new; end if;
  if new.value is distinct from old.value then
    v := job_items_value(new.id);
    if v is not null then new.value := v; end if;
  end if;
  if new.purchase_cost is distinct from old.purchase_cost then
    v := job_ordered_cost(new.id);
    if v is not null then new.purchase_cost := v; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_money_guard on orders;
create trigger trg_orders_money_guard
  before update of value, purchase_cost on orders
  for each row execute function orders_money_guard();

create or replace function order_items_money_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform sync_job_value(old.order_id);
  else
    perform sync_job_value(new.order_id);
    if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
      perform sync_job_value(old.order_id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_order_items_money_sync on order_items;
create trigger trg_order_items_money_sync
  after insert or delete or update of quantity, unit_price, order_id on order_items
  for each row execute function order_items_money_sync();

create or replace function purchase_orders_money_sync()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform sync_job_purchase_cost(old.job_id);
  else
    if tg_op = 'UPDATE' and old.total is not distinct from new.total and old.status is not distinct from new.status
       and old.job_id is not distinct from new.job_id then
      return null;
    end if;
    perform sync_job_purchase_cost(new.job_id);
    if tg_op = 'UPDATE' and old.job_id is distinct from new.job_id then
      perform sync_job_purchase_cost(old.job_id);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_purchase_orders_money_sync on purchase_orders;
create trigger trg_purchase_orders_money_sync
  after insert or delete or update of total, status, job_id on purchase_orders
  for each row execute function purchase_orders_money_sync();

/**
 * Rozpočítání změny hodnoty zakázky na položky (server, src/app/actions/job-consistency.ts) v JEDNÉ
 * transakci: ceny položek → DB přepočte hodnotu (trigger) → událost přepočtu dostane popis rozpočítání.
 * p_prices = [{ "id": uuid, "unit_price": numeric }]. Vrací novou hodnotu zakázky.
 */
create or replace function apply_job_item_prices(p_job uuid, p_prices jsonb, p_message text, p_data jsonb default '{}'::jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  j  orders%rowtype;
  r  jsonb;
  v  numeric;
  n  int := 0;
begin
  select * into j from orders where id = p_job for update;
  if not found then raise exception 'Zakázka nenalezena.'; end if;
  if job_is_invoiced(j.invoice_number, j.invoiced_at) then
    raise exception 'Zakázka je vyfakturovaná — hodnotu ani ceny položek už nejde měnit.';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_prices, '[]'::jsonb)) loop
    update order_items set unit_price = round((r->>'unit_price')::numeric, 2)
    where id = (r->>'id')::uuid and order_id = p_job
      and unit_price is distinct from round((r->>'unit_price')::numeric, 2);
    if found then n := n + 1; end if;
  end loop;
  select value into v from orders where id = p_job;
  if n > 0 and nullif(btrim(coalesce(p_message, '')), '') is not null then
    update job_events set message = left(p_message, 1000), data = data || coalesce(p_data, '{}'::jsonb)
    where job_id = p_job and type = 'field' and data->>'auto' = 'items_value' and data->>'tx' = txid_current()::text;
  end if;
  return v;
end $$;

-- výpočty a zápisy jen pro server (servisní klíč) — přes REST je session volat nesmí
do $$
declare f text;
begin
  foreach f in array array[
    'log_money_sync(uuid, text, text, text, numeric, numeric, text, boolean)',
    'sync_job_value(uuid)', 'sync_job_purchase_cost(uuid)',
    'apply_job_item_prices(uuid, jsonb, text, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── Oprava dat (pravidlo 5) ──────────────────────────────────────────────────
do $$
declare r record;
begin
  for r in
    select o.id from orders o
    where o.merged_into_id is null and not job_is_invoiced(o.invoice_number, o.invoiced_at)
      and job_items_value(o.id) is not null
      and (o.value is null or abs(o.value - job_items_value(o.id)) >= 0.005)
      and not exists (
        select 1 from quotes q where q.job_id = o.id
          and (q.sent_at is not null or q.status in ('odeslano', 'prijato') or o.quote_id = q.id))
  loop
    perform sync_job_value(r.id);
  end loop;
  for r in
    select o.id from orders o
    where o.merged_into_id is null and not job_is_invoiced(o.invoice_number, o.invoiced_at)
      and job_ordered_cost(o.id) is not null
      and (o.purchase_cost is null or abs(o.purchase_cost - job_ordered_cost(o.id)) >= 0.005)
  loop
    perform sync_job_purchase_cost(r.id);
  end loop;
end $$;
