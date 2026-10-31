-- ============================================================
-- Výjimky v toku zakázky (majitel 31. 10.): „Zákazník neobjednal", „Výroba se nepovedla",
-- „Reklamace", „Vyrábět bez objednávky", „Pozastavit / Pokračovat", „Aktualizace výkresu",
-- „Oprava zakázky". Idempotentní (jde pustit znovu).
--
--  * orders.side_from_stage — stav PŘED vstupem do vedlejšího stavu (pozastaveno, reklamace,
--    nerealizováno, zrušeno); „Pokračovat" / „Obnovit" vrací sem. Udržuje trigger.
--  * orders.hold_reason — proč zakázka stojí (chip „Pozastaveno — …").
--  * orders.awaiting_customer_po (+ since/by/note) — vyrábí se bez objednávky zákazníka; jakmile
--    zakázka dostane číslo objednávky zákazníka (foto, pošta, ručně), příznak zmizí sám a zapíše se
--    customer_po_received_at (+ událost v historii).
--  * orders.claim_* — reklamace (důvod, kusy, popis, stav před reklamací, vyřízení).
--  * orders.corrected_* — oprava zakázky (chip „Opraveno …").
--  * orders.drawing_changes_open — počet nepotvrzených změn revize výkresu (štítek „Nová revize").
--  * job_drawing_changes — změny revize výkresu (zapisuje trigger order_items i server), „Beru na vědomí".
--  * purchase_orders.drawing_changed_at — objednávka dodavateli dostala novou revizi výkresu.
--  * důvod prohry 'vyroba' („Výroba se nepovedla") pro zrušení zakázky po zmetku.
-- ============================================================

-- ── 1) Sloupce ──────────────────────────────────────────────
alter table orders add column if not exists side_from_stage          job_stage;
alter table orders add column if not exists hold_reason              text;
alter table orders add column if not exists awaiting_customer_po     boolean not null default false;
alter table orders add column if not exists awaiting_po_since        timestamptz;
alter table orders add column if not exists awaiting_po_by           uuid references profiles(id) on delete set null;
alter table orders add column if not exists awaiting_po_note         text;
alter table orders add column if not exists customer_po_received_at  timestamptz;
alter table orders add column if not exists claim_opened_at          timestamptz;
alter table orders add column if not exists claim_opened_by          uuid references profiles(id) on delete set null;
alter table orders add column if not exists claim_reason             text;
alter table orders add column if not exists claim_qty                numeric(12,3);
alter table orders add column if not exists claim_item_id            uuid references order_items(id) on delete set null;
alter table orders add column if not exists claim_note               text;
alter table orders add column if not exists claim_from_stage         job_stage;
alter table orders add column if not exists claim_resolution         text;
alter table orders add column if not exists claim_resolution_note    text;
alter table orders add column if not exists claim_resolved_at        timestamptz;
alter table orders add column if not exists claim_resolved_by        uuid references profiles(id) on delete set null;
alter table orders add column if not exists corrected_at             timestamptz;
alter table orders add column if not exists corrected_by             uuid references profiles(id) on delete set null;
alter table orders add column if not exists corrected_note           text;
alter table orders add column if not exists drawing_changes_open     int not null default 0;

alter table purchase_orders add column if not exists drawing_changed_at   timestamptz;
alter table purchase_orders add column if not exists drawing_change_note  text;

do $$ begin
  alter table orders add constraint orders_claim_reason_check check (claim_reason is null or claim_reason in
    ('rozmery', 'material', 'povrch', 'mnozstvi', 'poskozeni', 'jine'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table orders add constraint orders_claim_resolution_check check (claim_resolution is null or claim_resolution in
    ('oprava', 'dobropis', 'zamitnuto'));
exception when duplicate_object then null; end $$;

create index if not exists idx_orders_awaiting_po on orders(awaiting_po_since) where awaiting_customer_po;
create index if not exists idx_orders_claim_open on orders(claim_opened_at) where claim_opened_at is not null and claim_resolved_at is null;
create index if not exists idx_orders_drawing_changes on orders(id) where drawing_changes_open > 0;

-- ── 2) Důvod prohry „Výroba se nepovedla" ───────────────────
alter table orders drop constraint if exists orders_lost_reason_check;
alter table orders add constraint orders_lost_reason_check check (lost_reason is null or lost_reason in
    ('nevyrabime', 'kapacita', 'nevyplati_se', 'duplicita', 'cena', 'termin', 'jiny_dodavatel',
     'projekt_zrusen', 'bez_odezvy', 'zakaznik_stahl', 'vyroba', 'jine', 'neuvedeno'));
alter table quotes drop constraint if exists quotes_lost_reason_check;
alter table quotes add constraint quotes_lost_reason_check check (lost_reason is null or lost_reason in
    ('nevyrabime', 'kapacita', 'nevyplati_se', 'duplicita', 'cena', 'termin', 'jiny_dodavatel',
     'projekt_zrusen', 'bez_odezvy', 'zakaznik_stahl', 'vyroba', 'jine', 'neuvedeno'));

create or replace function lost_reason_label(p text) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'nevyrabime' then 'Nevyrábíme (technologie)' when 'kapacita' then 'Nestíháme (kapacita / termín)'
    when 'nevyplati_se' then 'Nevyplatí se (cena / objem)' when 'duplicita' then 'Duplicitní poptávka'
    when 'cena' then 'Cena' when 'termin' then 'Termín dodání' when 'jiny_dodavatel' then 'Vybral jiného dodavatele'
    when 'projekt_zrusen' then 'Projekt zrušen' when 'bez_odezvy' then 'Bez odezvy'
    when 'zakaznik_stahl' then 'Zákazník stáhl poptávku' when 'vyroba' then 'Výroba se nepovedla'
    when 'jine' then 'Jiný důvod'
    when 'neuvedeno' then 'Důvod neuveden' else coalesce(p, 'Důvod neuveden') end
$$;

-- ── 3) Zakázka: stav před vedlejším stavem, příchod objednávky zákazníka ──
create or replace function orders_flow_exceptions()
returns trigger language plpgsql set search_path = public as $$
declare
  v_side job_stage[] := array['pozastaveno', 'reklamace', 'nerealizovano', 'zruseno']::job_stage[];
  v_has_po boolean := nullif(btrim(coalesce(new.customer_order_number, '')), '') is not null;
begin
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- do vedlejšího stavu z běžného toku → zapamatovat, kam se vrátit (vedlejší → vedlejší původ drží)
    if new.status = any(v_side) and not (old.status = any(v_side)) then
      new.side_from_stage := old.status;
    end if;
    if old.status = 'pozastaveno' and new.status <> 'pozastaveno' then new.hold_reason := null; end if;
    -- uzavřená zakázka na objednávku zákazníka nečeká
    if new.status in ('nerealizovano', 'zruseno') then new.awaiting_customer_po := false; end if;
  end if;

  -- vyrábět bez objednávky: kdo a od kdy (příznak smí jen zakázka bez čísla objednávky zákazníka)
  if new.awaiting_customer_po and (tg_op = 'INSERT' or not old.awaiting_customer_po) then
    if v_has_po then
      new.awaiting_customer_po := false;
    else
      new.awaiting_po_since := now();
      new.awaiting_po_by := app_pick(new.awaiting_po_by);
      new.customer_po_received_at := null;
    end if;
  elsif new.awaiting_customer_po and v_has_po
        and (tg_op = 'INSERT' or new.customer_order_number is distinct from old.customer_order_number) then
    -- objednávka zákazníka dorazila (foto, pošta, ručně) → příznak zmizí, potvrzení s jejím číslem
    new.awaiting_customer_po := false;
    new.customer_po_received_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_zz_flow_exceptions on orders;
create trigger trg_orders_zz_flow_exceptions before insert or update on orders
  for each row execute function orders_flow_exceptions();

-- historie: objednávka zákazníka dorazila k zakázce, která už se vyrábí bez ní (jakoukoli cestou)
create or replace function orders_flow_exceptions_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.awaiting_customer_po and not new.awaiting_customer_po and new.customer_po_received_at is not null
     and new.customer_po_received_at is distinct from old.customer_po_received_at then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'field',
      'Objednávka zákazníka dorazila: ' || coalesce(new.customer_order_number, '—')
        || ' — zakázka se už vyráběla bez ní, potvrď objednávku s tímto číslem',
      jsonb_build_object('exception', 'po_received', 'customerOrderNumber', new.customer_order_number),
      app_actor(), app_event_kind(app_actor()), case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end,
      'order', new.id, app_request_id());
  end if;
  return null;
end $$;

drop trigger if exists trg_orders_flow_exceptions_after on orders;
-- bez seznamu sloupců: příznak mění BEFORE trigger (zápis čísla objednávky), ne SET příkazu
create trigger trg_orders_flow_exceptions_after after update on orders
  for each row when (old.awaiting_customer_po and not new.awaiting_customer_po)
  execute function orders_flow_exceptions_after();

-- ── 4) Změny revize výkresu ─────────────────────────────────
create table if not exists job_drawing_changes (
  id               uuid primary key default uuid_generate_v4(),
  job_id           uuid not null references orders(id) on delete cascade,
  order_item_id    uuid references order_items(id) on delete set null,
  drawing_number   text,
  rev_from         text,
  rev_to           text,
  file_id          uuid references job_files(id) on delete set null,
  old_file_id      uuid references job_files(id) on delete set null,
  note             text,
  created_by       uuid references profiles(id) on delete set null,
  created_via      text,
  created_at       timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid references profiles(id) on delete set null,
  ack_note         text
);
create index if not exists idx_job_drawing_changes_job on job_drawing_changes(job_id, created_at desc);
create index if not exists idx_job_drawing_changes_open on job_drawing_changes(job_id) where acknowledged_at is null;

alter table job_drawing_changes enable row level security;
drop policy if exists "job_drawing_changes_select" on job_drawing_changes;
create policy "job_drawing_changes_select" on job_drawing_changes for select using (is_active_user());
drop policy if exists "job_drawing_changes_insert" on job_drawing_changes;
create policy "job_drawing_changes_insert" on job_drawing_changes for insert with check (is_active_user());
drop policy if exists "job_drawing_changes_update" on job_drawing_changes;
create policy "job_drawing_changes_update" on job_drawing_changes for update using (is_active_user()) with check (is_active_user());
drop policy if exists "job_drawing_changes_delete" on job_drawing_changes;
create policy "job_drawing_changes_delete" on job_drawing_changes for delete using (is_super_admin());

-- kdo: vždy z kontextu (REST nepodvrhne autora ani potvrzení)
create or replace function job_drawing_changes_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    new.created_via := coalesce(case when app_ctx() = 'session' then 'rest' end, new.created_via, app_actor_via());
    new.created_at := now();
    if new.acknowledged_at is not null then new.acknowledged_by := app_pick(new.acknowledged_by); end if;
  else
    new.job_id := old.job_id; new.created_by := old.created_by; new.created_at := old.created_at;
    if new.acknowledged_at is distinct from old.acknowledged_at then
      new.acknowledged_at := case when new.acknowledged_at is null then null else now() end;
      new.acknowledged_by := case when new.acknowledged_at is null then null else app_pick(new.acknowledged_by) end;
    else
      new.acknowledged_by := old.acknowledged_by;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_drawing_changes_before on job_drawing_changes;
create trigger trg_job_drawing_changes_before before insert or update on job_drawing_changes
  for each row execute function job_drawing_changes_before();

-- počet nepotvrzených změn na zakázce (štítek v Knize) + událost v historii
create or replace function job_drawing_changes_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_job uuid := coalesce(new.job_id, old.job_id);
begin
  update orders set drawing_changes_open = (select count(*) from job_drawing_changes where job_id = v_job and acknowledged_at is null)
   where id = v_job
     and drawing_changes_open is distinct from (select count(*) from job_drawing_changes where job_id = v_job and acknowledged_at is null);
  if tg_op = 'INSERT' then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.job_id, 'file',
      'Nová revize výkresu ' || coalesce(nullif(new.drawing_number, ''), '—') || ': '
        || coalesce(nullif(new.rev_from, ''), '—') || ' → ' || coalesce(nullif(new.rev_to, ''), '—')
        || coalesce(' — ' || nullif(new.note, ''), ''),
      jsonb_strip_nulls(jsonb_build_object('exception', 'drawing_revision', 'changeId', new.id, 'itemId', new.order_item_id,
        'drawingNumber', new.drawing_number, 'from', new.rev_from, 'to', new.rev_to, 'fileId', new.file_id)),
      new.created_by, app_event_kind(new.created_by), new.created_via, 'file', new.id, app_request_id());
  elsif tg_op = 'UPDATE' and old.acknowledged_at is null and new.acknowledged_at is not null then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.job_id, 'file',
      'Nová revize výkresu ' || coalesce(nullif(new.drawing_number, ''), '—') || ' (' || coalesce(nullif(new.rev_to, ''), '—')
        || ') — beru na vědomí' || coalesce(' — ' || nullif(new.ack_note, ''), ''),
      jsonb_build_object('exception', 'drawing_revision_ack', 'changeId', new.id),
      new.acknowledged_by, app_event_kind(new.acknowledged_by), app_actor_via(), 'file', new.id, app_request_id());
  end if;
  return null;
end $$;
drop trigger if exists trg_job_drawing_changes_after on job_drawing_changes;
create trigger trg_job_drawing_changes_after after insert or update or delete on job_drawing_changes
  for each row execute function job_drawing_changes_after();

-- jakákoli změna revize u položky se stejným číslem výkresu (foto, pošta, ruční úprava, nahrání) = nová revize
create or replace function order_items_drawing_revision()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from text := nullif(btrim(coalesce(old.revision, '')), '');
  v_to   text := nullif(btrim(coalesce(new.revision, '')), '');
begin
  if v_from is null or v_to is null or upper(v_from) = upper(v_to) then return null; end if;
  if drawing_norm(old.drawing_number) is distinct from drawing_norm(new.drawing_number) then return null; end if;
  insert into job_drawing_changes (job_id, order_item_id, drawing_number, rev_from, rev_to)
  values (new.order_id, new.id, new.drawing_number, v_from, v_to);
  return null;
end $$;
drop trigger if exists trg_order_items_drawing_revision on order_items;
create trigger trg_order_items_drawing_revision after update of revision on order_items
  for each row execute function order_items_drawing_revision();
