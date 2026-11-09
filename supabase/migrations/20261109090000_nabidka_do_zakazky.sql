-- ─────────────────────────────────────────────────────────────────────────────
-- Nabídka → zakázka (majitel 9. 11.: „Když někdo vytvořil nabídku, proč se to nedoplnilo do přehledu
-- zakázky — číslo, cena, termíny, nic. Termíny, ceny, nákup, marže, obrat — všechno musí být doplněné,
-- když se udělá nabídka.")
--
-- Zakázka vždy odráží svou AKTUÁLNÍ nabídku (přijatá, jinak nejnovější platná verze bez archivních a
-- zamítnutých). Propisování dělá server po každé změně nabídky (src/lib/jobs/quote-job-sync*.ts);
-- tahle migrace přidá:
--  1) orders.offer_sync — co se do zakázky naposledy propsalo (nabídka, otisk položek, termín odvozený
--     z nabídky, dodací lhůta). Shoda due_date s offer_sync.dueDate = termín je „z nabídky" (ruční termín
--     se nikdy nepřepíše).
--  2) Datum objednávky zákazníka (order_date) u termínu z nabídky → termín = datum objednávky + lhůta
--     („lhůta se bere od data objednání", stejně jako src/lib/jobs/order-deadline.ts).
--  3) Oprava dat: nevyfakturované otevřené zakázky BEZ položek s aktuální nabídkou s položkami dostanou
--     položky z nabídky (hodnotu přepočte trigger order_items_money_sync, nákup podle nákupních cen položek
--     bez objednávek dodavatelům), prázdný termín dodání = odeslání nabídky + lhůta (jen budoucí), jedna
--     událost do historie. Znovu spuštěná nic nezmění (zakázka už položky má).
-- Idempotentní.
-- ─────────────────────────────────────────────────────────────────────────────

alter table orders add column if not exists offer_sync jsonb;
comment on column orders.offer_sync is
  'Poslední propsání nabídky do zakázky (server): quoteId, number, itemsKey, dueDate (termín odvozený z nabídky), leadDays, at.';

-- datum česky („4. 12. 2026")
create or replace function offer_cz_date(p date) returns text
language sql immutable set search_path = public as $$
  select case when p is null then '—' else to_char(p, 'FMDD. FMMM. YYYY') end
$$;

-- ── 2) Datum objednávky u termínu z nabídky → termín od data objednávky ──────
create or replace function orders_offer_due_from_order()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_lead int;
  v_due  date;
  v_by   uuid := app_actor();
begin
  if new.order_date is null or new.order_date is not distinct from old.order_date then return null; end if;
  -- termín zapsaný stejným příkazem (ruční / z dokladu) má přednost
  if new.due_date is distinct from old.due_date then return null; end if;
  if new.offer_sync is null or new.due_date is null or new.offer_sync->>'dueDate' is null then return null; end if;
  if new.offer_sync->>'dueDate' <> to_char(new.due_date, 'YYYY-MM-DD') then return null; end if;  -- ruční termín
  if new.merged_into_id is not null or job_is_invoiced(new.invoice_number, new.invoiced_at)
     or new.status::text in ('dodano_zakaznikovi', 'fakturovano', 'dokonceno', 'nerealizovano', 'zruseno') then
    return null;
  end if;
  v_lead := case when coalesce(new.offer_sync->>'leadDays', '') ~ '^\d+$' then (new.offer_sync->>'leadDays')::int end;
  if v_lead is null or v_lead <= 0 then return null; end if;
  v_due := new.order_date + v_lead;
  if v_due = new.due_date then return null; end if;
  update orders set due_date = v_due,
    offer_sync = offer_sync || jsonb_build_object('dueDate', to_char(v_due, 'YYYY-MM-DD'), 'at', now())
  where id = new.id;
  insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
  values (new.id, 'quote',
    format('Termín dodání podle data objednávky: %s dní od %s → %s', v_lead, offer_cz_date(new.order_date), offer_cz_date(v_due)),
    jsonb_build_object('action', 'offer_sync', 'reason', 'order_date', 'quoteId', new.offer_sync->>'quoteId',
                       'number', new.offer_sync->>'number', 'dueDate', to_char(v_due, 'YYYY-MM-DD'),
                       'previousDueDate', to_char(new.due_date, 'YYYY-MM-DD'), 'dueBase', 'order', 'leadDays', v_lead),
    v_by, app_event_kind(v_by), 'automaticky', 'quote',
    case when coalesce(new.offer_sync->>'quoteId', '') ~ '^[0-9a-fA-F-]{36}$' then (new.offer_sync->>'quoteId')::uuid end,
    app_request_id());
  return null;
end $$;
drop trigger if exists trg_orders_offer_due_from_order on orders;
create trigger trg_orders_offer_due_from_order
  after update of order_date on orders
  for each row execute function orders_offer_due_from_order();

-- ── 3) Oprava dat ────────────────────────────────────────────────────────────
do $$
declare
  r       record;
  v_n     int;
  v_lead  int;
  v_due   date;
  v_key   text;
  v_value numeric;
  v_parts text[];
  v_today date := (now() at time zone 'Europe/Prague')::date;
begin
  for r in
    select o.id as job_id, o.status::text as stage, o.due_date, o.order_date, o.currency, o.value as old_value,
           q.id as quote_id, q.number, q.lead_time_days, q.sent_at, q.created_at
    from orders o
    cross join lateral (
      -- aktuální nabídka = přijatá, jinak nejnovější platná verze (stejně jako currentOffer v quote-job-sync.ts)
      select q.* from quotes q
      where q.job_id = o.id
        and q.status::text <> 'zamitnuto' and coalesce(q.state::text, '') <> 'zamitnuta'
        and (q.id = o.quote_id or q.status::text = 'prijato' or coalesce(q.state::text, '') = 'prijata'
             or (not coalesce(q.archived, false) and coalesce(q.state::text, '') <> 'archivovana'))
      order by (o.quote_id is not null and q.id = o.quote_id) desc,
               (q.status::text = 'prijato' or coalesce(q.state::text, '') = 'prijata') desc,
               q.revision desc nulls last, q.created_at desc
      limit 1
    ) q
    where o.merged_into_id is null
      and not job_is_invoiced(o.invoice_number, o.invoiced_at)
      and o.status::text not in ('fakturovano', 'dokonceno', 'nerealizovano', 'zruseno')
      and not exists (select 1 from order_items i where i.order_id = o.id)
      and exists (select 1 from quote_items qi where qi.quote_id = q.id)
  loop
    insert into order_items (order_id, position, drawing_id, drawing_number, name, description, material,
                             quantity, unit, unit_price, purchase_unit_price)
    select r.job_id, (row_number() over (order by qi.position, qi.id) - 1)::int, qi.drawing_id, qi.drawing_number,
           qi.name, qi.description, qi.material, qi.quantity, coalesce(nullif(btrim(qi.unit), ''), 'ks'),
           qi.unit_price, qi.purchase_unit_price
    from quote_items qi where qi.quote_id = r.quote_id;
    get diagnostics v_n = row_count;

    -- hodnotu přepočetl trigger; nákup podle nákupních cen položek (jen bez objednávek dodavatelům)
    if job_items_purchase(r.job_id) is not null and job_ordered_cost(r.job_id) is null then
      perform sync_job_purchase_cost(r.job_id);
    end if;

    -- termín dodání jen prázdný, otevřené zakázky a jen do budoucna (stará nabídka by hlásila „po termínu")
    v_lead := case when r.lead_time_days > 0 and r.lead_time_days < 1095 then r.lead_time_days end;
    v_due := null;
    if v_lead is not null and r.due_date is null and r.stage not in ('dodano_zakaznikovi') then
      v_due := coalesce(r.order_date, (coalesce(r.sent_at, r.created_at) at time zone 'Europe/Prague')::date) + v_lead;
      if v_due < v_today then v_due := null; end if;
    end if;

    select md5(coalesce(string_agg(lower(qi.id::text), ',' order by lower(qi.id::text) collate "C"), ''))
      into v_key from quote_items qi where qi.quote_id = r.quote_id;
    update orders set
      due_date = coalesce(v_due, due_date),
      offer_sync = jsonb_build_object('quoteId', r.quote_id, 'number', r.number, 'itemsKey', v_key,
        'dueDate', case when v_due is not null then to_char(v_due, 'YYYY-MM-DD') end,
        'leadDays', v_lead, 'at', now())
    where id = r.job_id;

    select value into v_value from orders where id = r.job_id;
    v_parts := array[format('%s %s', v_n, case when v_n = 1 then 'položka' when v_n between 2 and 4 then 'položky' else 'položek' end)];
    if v_value is not null and v_value is distinct from r.old_value then
      v_parts := v_parts || ('hodnota ' || money_text(v_value));
    end if;
    if v_due is not null then v_parts := v_parts || ('termín dodání ' || offer_cz_date(v_due)); end if;
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id)
    values (r.job_id, 'quote',
      format('Z nabídky %s doplněno: %s', coalesce(r.number, ''), array_to_string(v_parts, ', ')),
      jsonb_build_object('action', 'offer_sync', 'reason', 'backfill', 'quoteId', r.quote_id, 'number', r.number,
        'itemsCreated', v_n, 'pricesUpdated', 0, 'purchaseFilled', 0, 'value', v_value, 'previousValue', r.old_value)
        || case when v_due is not null then jsonb_build_object('dueDate', to_char(v_due, 'YYYY-MM-DD'), 'dueBase',
             case when r.order_date is not null then 'order' else 'quote' end, 'leadDays', v_lead) else '{}'::jsonb end,
      null, 'system', 'automaticky', 'quote', r.quote_id);
  end loop;
end $$;

notify pgrst, 'reload schema';
