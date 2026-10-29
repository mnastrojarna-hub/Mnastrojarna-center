-- ============================================================
-- 20261029110000 — Faktury dodavatelů (zadání majitele 29. 10.)
--  * nahrát smí všichni (foto / sken / upload / e-mail), vidí zatím jen super admin — přepínač
--    integration_settings.supplier_invoices_visibility = super_admin | all (supplier_invoices_for_all())
--  * hlavička + položky jak jsou na faktuře, rozdělení položek (nebo zbytku faktury) na zakázky částkami
--    a na režii; zaplaceno / nezaplaceno jen super admin (sloupce platby nejsou grantované authenticated)
--  * náklad zakázky (job_cost) = objednávky dodavatelům, u kterých faktura nahradí částku objednávky,
--    + faktury bez objednávky; bez dvojího počítání. Přepočet provize triggery.
--  * merge_jobs (#24): PŘEDEFINOVÁNO (základ 20261023161000) — navíc přesun alokací faktur a přemapování
--    položek; jinak beze změny. Další úpravy merge_jobs dělej od TÉTO definice.
--  * job_cost a job_unpriced_purchase_orders: PŘEDEFINOVÁNO (základ 20261023150000).
-- Celý soubor je idempotentní.
-- ============================================================

-- ── 0) Dodavatel: bankovní účet z faktury; fronta; automatika ─
alter table suppliers add column if not exists bank_account text;
alter type approval_type add value if not exists 'supplier_invoice';
insert into automation_settings (module, mode) values ('supplier_invoice', 'approval') on conflict (module) do nothing;
insert into integration_settings (key, category, label, is_secret, value)
values ('supplier_invoices_visibility', 'supplier_invoices', 'Kdo vidí faktury dodavatelů (super_admin | all)', false, 'super_admin')
on conflict (key) do nothing;

-- ── 1) Viditelnost (jediný přepínač) ────────────────────────
/** Režim „všichni vidí faktury" (jen super admin vidí zaplaceno / nezaplaceno). */
create or replace function supplier_invoices_for_all() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select lower(btrim(coalesce(value, ''))) = 'all' from integration_settings
                   where key = 'supplier_invoices_visibility'), false)
$$;

/** Čtení přes REST (druhá linie; aplikace čte servisním klíčem a hlídá sama): super admin,
 *  v režimu „all" i obchodník (zaměstnanec částky nákupu nevidí nikde). */
create or replace function supplier_invoices_readable() returns boolean
language sql stable security definer set search_path = public as $$
  select is_active_user() and (is_super_admin() or (supplier_invoices_for_all() and is_obchodnik_or_admin()))
$$;

create or replace function supplier_invoice_number_norm(p text) returns text
language sql immutable set search_path = public as $$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g'))
$$;

-- ── 2) Tabulky ──────────────────────────────────────────────
create table if not exists supplier_invoices (
  id                    uuid primary key default uuid_generate_v4(),
  supplier_id           uuid references suppliers(id) on delete set null,
  supplier_name         text,
  supplier_ico          text,
  supplier_dic          text,
  supplier_address      text,
  supplier_bank_account text,
  supplier_email        text,
  supplier_phone        text,
  number                text,
  variable_symbol       text,
  issue_date            date,
  taxable_date          date,
  due_date              date,
  currency              text not null default 'CZK',
  exchange_rate         numeric(12,6) check (exchange_rate is null or exchange_rate > 0),
  total_net             numeric(14,2),
  total_vat             numeric(14,2),
  total_gross           numeric(14,2),
  payment_status        text not null default 'nezaplaceno',
  paid_amount           numeric(14,2),
  paid_at               date,
  paid_by               uuid references profiles(id) on delete set null,
  status                text not null default 'nahrano',
  source                text not null default 'upload',
  email_id              uuid references emails(id) on delete set null,
  capture_key           text unique,
  duplicate_of_id       uuid references supplier_invoices(id) on delete set null,
  content_sha256        text,
  is_credit_note        boolean not null default false,
  ai_extracted          jsonb,
  ai_confidence         numeric(4,3),
  ai_used               boolean not null default false,
  ai_error              text,
  ai_processed_at       timestamptz,
  note                  text,
  uploaded_by           uuid references profiles(id) on delete set null,
  updated_by            uuid references profiles(id) on delete set null,
  processed_by          uuid references profiles(id) on delete set null,
  processed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- zálohová (proforma) faktura: do nákladů zakázek se nepočítá (náklad přinese až daňový doklad)
alter table supplier_invoices add column if not exists is_proforma boolean not null default false;
-- objednávky dodavatelům, které tahle faktura uzavírá („Faktura konečná") — dílčí faktury jinak částku objednávky jen navyšují
alter table supplier_invoices add column if not exists final_po_ids uuid[] not null default '{}';
alter table supplier_invoices add column if not exists number_norm text
  generated always as (upper(regexp_replace(coalesce(number, ''), '[^0-9A-Za-z]', '', 'g'))) stored;
alter table supplier_invoices add column if not exists supplier_key text
  generated always as (coalesce(nullif(regexp_replace(coalesce(supplier_ico, ''), '\D', '', 'g'), ''),
                                supplier_id::text,
                                nullif(lower(btrim(coalesce(supplier_name, ''))), ''))) stored;
do $$ begin
  alter table supplier_invoices add constraint supplier_invoices_payment_check
    check (payment_status in ('nezaplaceno', 'castecne', 'zaplaceno'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_invoices add constraint supplier_invoices_status_check
    check (status in ('nahrano', 'ke_kontrole', 'zpracovano', 'zamitnuto'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_invoices add constraint supplier_invoices_source_check
    check (source in ('photo', 'scan', 'upload', 'email'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_invoices add constraint supplier_invoices_not_self_duplicate check (duplicate_of_id is distinct from id);
exception when duplicate_object then null; end $$;
create index if not exists idx_supplier_invoices_supplier on supplier_invoices(supplier_id);
create index if not exists idx_supplier_invoices_status on supplier_invoices(status);
create index if not exists idx_supplier_invoices_due on supplier_invoices(due_date) where payment_status <> 'zaplaceno';
create index if not exists idx_supplier_invoices_issue on supplier_invoices(issue_date desc);
create index if not exists idx_supplier_invoices_sha on supplier_invoices(content_sha256) where content_sha256 is not null;
create index if not exists idx_supplier_invoices_email on supplier_invoices(email_id) where email_id is not null;
-- jedna faktura (dodavatel + číslo) nevznikne dvakrát; další nahrání = duplicita (duplicate_of_id)
create unique index if not exists uq_supplier_invoices_number on supplier_invoices(supplier_key, number_norm)
  where duplicate_of_id is null and status <> 'zamitnuto' and number_norm <> '' and supplier_key is not null;

create table if not exists supplier_invoice_files (
  id            uuid primary key default uuid_generate_v4(),
  invoice_id    uuid not null references supplier_invoices(id) on delete cascade,
  position      int not null default 0,
  storage_path  text not null unique,
  filename      text not null,
  mime_type     text,
  size          bigint,
  sha256        text,
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_supplier_invoice_files_invoice on supplier_invoice_files(invoice_id, position);

create table if not exists supplier_invoice_items (
  id            uuid primary key default uuid_generate_v4(),
  invoice_id    uuid not null references supplier_invoices(id) on delete cascade,
  position      int not null default 0,
  text          text not null default '',
  code          text,
  quantity      numeric(14,3),
  unit          text,
  unit_price    numeric(14,4),
  amount        numeric(14,2) not null default 0,           -- bez DPH; sleva / dobropis záporně
  vat_rate      numeric(5,2),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_supplier_invoice_items_invoice on supplier_invoice_items(invoice_id, position);

create table if not exists supplier_invoice_allocations (
  id                      uuid primary key default uuid_generate_v4(),
  invoice_id              uuid not null references supplier_invoices(id) on delete cascade,
  item_id                 uuid references supplier_invoice_items(id) on delete cascade,  -- null = z hlavičky / zbytku
  target                  text not null default 'job',
  job_id                  uuid references orders(id) on delete cascade,
  overhead_category       text,
  amount                  numeric(14,2) not null check (amount <> 0),
  purchase_order_id       uuid references purchase_orders(id) on delete set null,
  purchase_order_item_id  uuid references purchase_order_items(id) on delete set null,
  order_item_id           uuid references order_items(id) on delete set null,
  note                    text,
  ai_suggested            boolean not null default false,
  ai_reason               text,
  confirmed_at            timestamptz,
  confirmed_by            uuid references profiles(id) on delete set null,
  position                int not null default 0,
  created_by              uuid references profiles(id) on delete set null,
  updated_by              uuid references profiles(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
do $$ begin
  alter table supplier_invoice_allocations add constraint supplier_invoice_allocations_target_check
    check ((target = 'job' and job_id is not null and overhead_category is null)
        or (target = 'rezie' and job_id is null and purchase_order_id is null and order_item_id is null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_invoice_allocations add constraint supplier_invoice_allocations_category_check
    check (overhead_category is null or overhead_category in ('doprava', 'naradi', 'energie', 'material', 'sluzby', 'ostatni'));
exception when duplicate_object then null; end $$;
create index if not exists idx_sia_invoice on supplier_invoice_allocations(invoice_id);
create index if not exists idx_sia_item on supplier_invoice_allocations(item_id) where item_id is not null;
create index if not exists idx_sia_job on supplier_invoice_allocations(job_id) where job_id is not null;
create index if not exists idx_sia_po on supplier_invoice_allocations(purchase_order_id) where purchase_order_id is not null;
create index if not exists idx_sia_order_item on supplier_invoice_allocations(order_item_id) where order_item_id is not null;

-- ── 3) Triggery hlavičky (autor, platba, zpracování) ────────
create or replace function supplier_invoices_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), 'CZK'));
  if new.currency = 'CZK' then new.exchange_rate := null; end if;
  if tg_op = 'INSERT' then
    new.uploaded_by := app_pick(new.uploaded_by);
    new.updated_by := null;
    if new.payment_status <> 'nezaplaceno' or new.paid_at is not null then
      new.paid_by := app_pick(new.paid_by);
    end if;
  else
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.uploaded_by := app_keep(new.uploaded_by, old.uploaded_by);
    if (new.payment_status, new.paid_at, new.paid_amount) is distinct from (old.payment_status, old.paid_at, old.paid_amount) then
      -- zaplaceno / nezaplaceno mění jen super admin (AI ani systém bez autora ano — import, e-mail)
      if app_ctx() in ('session', 'app') and app_actor() is not null and not app_actor_is_super_admin() then
        raise exception 'Zaplaceno / nezaplaceno mění jen super admin.' using errcode = '42501', hint = 'FORBIDDEN';
      end if;
      new.paid_by := app_pick(case when new.paid_by is distinct from old.paid_by then new.paid_by end);
    else
      new.paid_by := app_keep(new.paid_by, old.paid_by);
    end if;
    if new.status is distinct from old.status and new.status = 'zpracovano' then
      new.processed_at := coalesce(new.processed_at, now());
      new.processed_by := app_pick(case when new.processed_by is distinct from old.processed_by then new.processed_by end);
    end if;
  end if;
  if new.payment_status = 'zaplaceno' and new.paid_at is null then new.paid_at := app_today(); end if;
  if new.payment_status = 'nezaplaceno' then new.paid_at := null; new.paid_amount := null; end if;
  return new;
end $$;
drop trigger if exists trg_supplier_invoices_before on supplier_invoices;
create trigger trg_supplier_invoices_before before insert or update on supplier_invoices
  for each row execute function supplier_invoices_before();

create or replace function supplier_invoice_items_before() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_supplier_invoice_items_before on supplier_invoice_items;
create trigger trg_supplier_invoice_items_before before insert or update on supplier_invoice_items
  for each row execute function supplier_invoice_items_before();

-- ── 4) Alokace: konzistence, kapacita, stav faktury, provize ─
create or replace function supplier_invoice_allocations_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_item_invoice uuid; v_po_job uuid; v_poi_po uuid; v_oi_job uuid;
begin
  new.updated_at := now();
  new.amount := round(new.amount, 2);
  if new.item_id is not null then
    select invoice_id into v_item_invoice from supplier_invoice_items where id = new.item_id;
    if v_item_invoice is distinct from new.invoice_id then
      raise exception 'Položka nepatří k této faktuře.' using errcode = 'P0001', hint = 'VALIDATION';
    end if;
  end if;
  if new.target = 'rezie' then
    new.job_id := null; new.purchase_order_id := null; new.purchase_order_item_id := null; new.order_item_id := null;
    new.overhead_category := coalesce(new.overhead_category, 'ostatni');
  else
    new.overhead_category := null;
  end if;
  if new.purchase_order_item_id is not null then
    select purchase_order_id into v_poi_po from purchase_order_items where id = new.purchase_order_item_id;
    new.purchase_order_id := coalesce(new.purchase_order_id, v_poi_po);
    if v_poi_po is distinct from new.purchase_order_id then new.purchase_order_item_id := null; end if;
  end if;
  if new.purchase_order_id is not null then
    select job_id into v_po_job from purchase_orders where id = new.purchase_order_id;
    if new.job_id is null then new.job_id := v_po_job;
    elsif v_po_job is distinct from new.job_id then
      raise exception 'Objednávka dodavateli patří k jiné zakázce.' using errcode = 'P0001', hint = 'VALIDATION';
    end if;
  end if;
  -- (sloučení zakázek přemapuje položku dřív, než přesune alokaci — kontrolu přeskočí)
  if new.order_item_id is not null and coalesce(current_setting('app.job_merge', true), '') <> 'on' then
    select order_id into v_oi_job from order_items where id = new.order_item_id;
    if v_oi_job is distinct from new.job_id then new.order_item_id := null; end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    if new.confirmed_at is not null then new.confirmed_by := app_pick(new.confirmed_by); end if;
  else
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.created_by := app_keep(new.created_by, old.created_by);
    if new.confirmed_at is not null and old.confirmed_at is null then
      new.confirmed_by := app_pick(case when new.confirmed_by is distinct from old.confirmed_by then new.confirmed_by end);
    elsif new.confirmed_at is null then
      new.confirmed_by := null;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_sia_before on supplier_invoice_allocations;
create trigger trg_sia_before before insert or update on supplier_invoice_allocations
  for each row execute function supplier_invoice_allocations_before();

/** Rozdělení faktury nepřesahuje částky: položka → její částka (stejné znaménko), hlavička → zbytek
 *  net − Σ položek (bez položek celý net). Haléřová tolerance 0,004. */
create or replace function supplier_invoice_check(p_invoice uuid) returns void
language plpgsql stable security definer set search_path = public as $$
declare r record; v_net numeric; v_items numeric; v_cap numeric; v_sum numeric; v_bad boolean;
begin
  for r in select i.id, i.amount, i.text, coalesce(sum(a.amount), 0) as s, coalesce(bool_or(sign(a.amount) <> sign(i.amount)), false) as bad
           from supplier_invoice_items i join supplier_invoice_allocations a on a.item_id = i.id
           where i.invoice_id = p_invoice group by i.id, i.amount, i.text loop
    if r.bad or abs(r.s) > abs(r.amount) + 0.004 then
      raise exception 'Rozdělení položky „%“ (% ) přesahuje její částku %.', left(coalesce(nullif(r.text, ''), 'bez názvu'), 60), r.s, r.amount
        using errcode = 'P0001', hint = 'ALLOCATION_EXCEEDS';
    end if;
  end loop;
  select coalesce(sum(amount), 0), coalesce(bool_or(true), false) into v_sum, v_bad
  from supplier_invoice_allocations where invoice_id = p_invoice and item_id is null;
  if v_sum <> 0 or v_bad then
    select total_net into v_net from supplier_invoices where id = p_invoice;
    select coalesce(sum(amount), 0) into v_items from supplier_invoice_items where invoice_id = p_invoice;
    -- bez součtu faktury není zbytek mimo položky (jinak by vyšel záporný a pustil cokoli)
    v_cap := case when v_net is null then 0 else v_net - v_items end;
    if exists (select 1 from supplier_invoice_allocations where invoice_id = p_invoice and item_id is null and sign(amount) <> sign(v_cap))
       or abs(v_sum) > abs(v_cap) + 0.004 then
      raise exception 'Rozdělení zbytku faktury (%) přesahuje nerozepsanou částku %.', v_sum, v_cap
        using errcode = 'P0001', hint = 'ALLOCATION_EXCEEDS';
    end if;
  end if;
end $$;

/** Stav zpracování podle rozdělení: vše potvrzené a rozdělené beze zbytku = zpracováno, jinak ke kontrole. */
create or replace function supplier_invoice_refresh(p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare inv supplier_invoices%rowtype; v_any boolean; v_pending boolean; v_open boolean; v_items numeric; v_hdr numeric; v_next text;
begin
  select * into inv from supplier_invoices where id = p_invoice;
  if not found or inv.status = 'zamitnuto' or inv.duplicate_of_id is not null then return; end if;
  select exists (select 1 from supplier_invoice_allocations where invoice_id = p_invoice),
         exists (select 1 from supplier_invoice_allocations where invoice_id = p_invoice and confirmed_at is null)
    into v_any, v_pending;
  -- otevřená položka = |Σ potvrzených| < |částka|
  select exists (
    select 1 from supplier_invoice_items i
    where i.invoice_id = p_invoice and i.amount <> 0
      and abs(i.amount) - abs(coalesce((select sum(a.amount) from supplier_invoice_allocations a
                                        where a.item_id = i.id and a.confirmed_at is not null), 0)) > 0.004)
    into v_open;
  select coalesce(sum(amount), 0) into v_items from supplier_invoice_items where invoice_id = p_invoice;
  select coalesce(sum(amount), 0) into v_hdr from supplier_invoice_allocations
  where invoice_id = p_invoice and item_id is null and confirmed_at is not null;
  -- zbytek mimo položky jen se součtem faktury (bez něj 0)
  if abs(case when inv.total_net is null then 0 else inv.total_net - v_items end) - abs(v_hdr) > 0.004 then v_open := true; end if;
  if coalesce(inv.total_net, 0) = 0 and v_items = 0 then v_open := true; end if;
  -- cizí měna bez kurzu: náklad zakázky nejde spočítat → zůstává ke kontrole
  if inv.currency <> 'CZK' and inv.exchange_rate is null then v_open := true; end if;
  -- zálohová faktura se nerozděluje (do nákladů se nepočítá) — stačí ji zkontrolovat
  if inv.is_proforma then v_open := false; end if;
  v_next := case when not v_pending and not v_open then 'zpracovano'
                 when v_any or inv.status <> 'nahrano' then 'ke_kontrole' else inv.status end;
  if v_next is distinct from inv.status then
    update supplier_invoices set status = v_next where id = p_invoice;
  end if;
end $$;

create or replace function supplier_invoice_allocations_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid; v_job uuid;
begin
  -- (každý dotaz smí číst jen přechodovou tabulku, kterou jeho trigger má)
  if tg_op = 'INSERT' then
    for v_inv in select distinct invoice_id from new_rows loop
      perform supplier_invoice_check(v_inv); perform supplier_invoice_refresh(v_inv);
    end loop;
    for v_job in select distinct job_id from new_rows where job_id is not null loop perform recompute_job_commission(v_job); end loop;
  elsif tg_op = 'DELETE' then
    for v_inv in select distinct o.invoice_id from old_rows o where exists (select 1 from supplier_invoices s where s.id = o.invoice_id) loop
      perform supplier_invoice_refresh(v_inv);
    end loop;
    for v_job in select distinct o.job_id from old_rows o where o.job_id is not null and exists (select 1 from orders x where x.id = o.job_id) loop
      perform recompute_job_commission(v_job);
    end loop;
  else
    for v_inv in select distinct invoice_id from new_rows loop
      perform supplier_invoice_check(v_inv); perform supplier_invoice_refresh(v_inv);
    end loop;
    for v_job in select distinct j from (select job_id as j from new_rows union select job_id from old_rows) x
                 where j is not null and exists (select 1 from orders o where o.id = x.j) loop
      perform recompute_job_commission(v_job);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists trg_sia_after_ins on supplier_invoice_allocations;
drop trigger if exists trg_sia_after_upd on supplier_invoice_allocations;
drop trigger if exists trg_sia_after_del on supplier_invoice_allocations;
create trigger trg_sia_after_ins after insert on supplier_invoice_allocations
  referencing new table as new_rows for each statement execute function supplier_invoice_allocations_after();
create trigger trg_sia_after_upd after update on supplier_invoice_allocations
  referencing old table as old_rows new table as new_rows for each statement execute function supplier_invoice_allocations_after();
create trigger trg_sia_after_del after delete on supplier_invoice_allocations
  referencing old table as old_rows for each statement execute function supplier_invoice_allocations_after();

-- změna částky položky / netto faktury nesmí nechat rozdělení přes částku
-- (hromadné uložení položek supplier_invoice_set_items kontroluje až na konci — app.sinv_bulk)
create or replace function supplier_invoice_items_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid;
begin
  if coalesce(current_setting('app.sinv_bulk', true), '') = 'on' then return null; end if;
  if tg_op = 'DELETE' then
    for v_inv in select distinct o.invoice_id from old_rows o where exists (select 1 from supplier_invoices s where s.id = o.invoice_id) loop
      perform supplier_invoice_check(v_inv); perform supplier_invoice_refresh(v_inv);
    end loop;
  else
    for v_inv in select distinct invoice_id from new_rows loop
      perform supplier_invoice_check(v_inv); perform supplier_invoice_refresh(v_inv);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists trg_sii_after_ins on supplier_invoice_items;
drop trigger if exists trg_sii_after_upd on supplier_invoice_items;
drop trigger if exists trg_sii_after_del on supplier_invoice_items;
create trigger trg_sii_after_ins after insert on supplier_invoice_items
  referencing new table as new_rows for each statement execute function supplier_invoice_items_after();
create trigger trg_sii_after_upd after update on supplier_invoice_items
  referencing new table as new_rows for each statement execute function supplier_invoice_items_after();
create trigger trg_sii_after_del after delete on supplier_invoice_items
  referencing old table as old_rows for each statement execute function supplier_invoice_items_after();

-- hlavička: netto, kurz, zamítnutí / duplicita → kontrola a přepočet nákladů zakázek
create or replace function supplier_invoices_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_job uuid;
begin
  if (new.total_net, new.status, new.duplicate_of_id, new.exchange_rate, new.currency, new.is_proforma, new.final_po_ids)
     is not distinct from (old.total_net, old.status, old.duplicate_of_id, old.exchange_rate, old.currency, old.is_proforma, old.final_po_ids)
  then return null; end if;
  if new.total_net is distinct from old.total_net then perform supplier_invoice_check(new.id); end if;
  if new.total_net is distinct from old.total_net or new.duplicate_of_id is distinct from old.duplicate_of_id
     or (new.status = 'zamitnuto') is distinct from (old.status = 'zamitnuto')
     or (new.currency, new.exchange_rate, new.is_proforma) is distinct from (old.currency, old.exchange_rate, old.is_proforma) then
    perform supplier_invoice_refresh(new.id);
  end if;
  if (new.exchange_rate, new.currency, new.is_proforma, new.final_po_ids) is distinct from (old.exchange_rate, old.currency, old.is_proforma, old.final_po_ids)
     or new.duplicate_of_id is distinct from old.duplicate_of_id
     or (new.status = 'zamitnuto') is distinct from (old.status = 'zamitnuto') then
    for v_job in select distinct job_id from supplier_invoice_allocations where invoice_id = new.id and job_id is not null loop
      perform recompute_job_commission(v_job);
    end loop;
  end if;
  return null;
end $$;
drop trigger if exists trg_supplier_invoices_after on supplier_invoices;
create trigger trg_supplier_invoices_after after update on supplier_invoices
  for each row execute function supplier_invoices_after();

-- fronta schvalování: schválení potvrdí návrhy AI, zamítnutí je smaže (autor = kdo vyřídil)
create or replace function approval_queue_supplier_invoice() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_inv uuid := app_uuid(new.payload ->> 'invoiceId');
begin
  if new.type::text <> 'supplier_invoice' or old.status <> 'pending' or new.status = 'pending' or v_inv is null then return null; end if;
  if new.status = 'approved' then
    update supplier_invoice_allocations set confirmed_at = now(), confirmed_by = coalesce(new.resolved_by, app_actor())
    where invoice_id = v_inv and confirmed_at is null;
  elsif new.status = 'rejected' then
    delete from supplier_invoice_allocations where invoice_id = v_inv and confirmed_at is null and ai_suggested;
    update supplier_invoices set status = 'ke_kontrole' where id = v_inv and status = 'nahrano';
  end if;
  return null;
end $$;
drop trigger if exists trg_approval_queue_supplier_invoice on approval_queue;
create trigger trg_approval_queue_supplier_invoice after update of status on approval_queue
  for each row execute function approval_queue_supplier_invoice();

-- ── 5) Atomické uložení rozdělení faktury (jen servisní role) ─
/**
 * Nahradí rozdělení faktury: řádky s id se upraví, bez id založí, chybějící smažou — vše v jedné
 * transakci (kapacitu hlídá trigger na konci příkazu). p_rows = [{ id?, itemId?, target, jobId?, category?,
 * amount, purchaseOrderId?, purchaseOrderItemId?, orderItemId?, note?, aiSuggested?, aiReason?, confirmed }].
 */
create or replace function supplier_invoice_set_allocations(p_invoice uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if app_ctx() not in ('app', 'service', 'db') then raise exception 'K této akci nemáš oprávnění.' using errcode = '42501', hint = 'FORBIDDEN'; end if;
  perform 1 from supplier_invoices where id = p_invoice for update;
  if not found then raise exception 'Faktura nenalezena.' using errcode = 'P0002', hint = 'NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Neplatné rozdělení.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  create temporary table if not exists _sia_rows (
    id uuid, item_id uuid, target text, job_id uuid, overhead_category text, amount numeric, purchase_order_id uuid,
    purchase_order_item_id uuid, order_item_id uuid, note text, ai_suggested boolean, ai_reason text, confirmed boolean, position int
  ) on commit drop;
  truncate _sia_rows;
  insert into _sia_rows
  select app_uuid(r ->> 'id'), app_uuid(r ->> 'itemId'), coalesce(nullif(r ->> 'target', ''), 'job'), app_uuid(r ->> 'jobId'),
         nullif(r ->> 'category', ''), round((r ->> 'amount')::numeric, 2), app_uuid(r ->> 'purchaseOrderId'),
         app_uuid(r ->> 'purchaseOrderItemId'), app_uuid(r ->> 'orderItemId'), left(nullif(btrim(r ->> 'note'), ''), 1000),
         coalesce((r ->> 'aiSuggested')::boolean, false), left(nullif(r ->> 'aiReason', ''), 500),
         coalesce((r ->> 'confirmed')::boolean, false), (ord - 1)::int
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, ord);
  -- id cizí faktury = nový řádek
  update _sia_rows x set id = null where x.id is not null
    and not exists (select 1 from supplier_invoice_allocations a where a.id = x.id and a.invoice_id = p_invoice);
  delete from supplier_invoice_allocations a where a.invoice_id = p_invoice and not exists (select 1 from _sia_rows x where x.id = a.id);
  update supplier_invoice_allocations a set
    item_id = x.item_id, target = x.target, job_id = x.job_id, overhead_category = x.overhead_category, amount = x.amount,
    purchase_order_id = x.purchase_order_id, purchase_order_item_id = x.purchase_order_item_id, order_item_id = x.order_item_id,
    note = x.note, ai_suggested = x.ai_suggested, ai_reason = x.ai_reason, position = x.position,
    confirmed_at = case when x.confirmed then coalesce(a.confirmed_at, now()) else null end
  from _sia_rows x
  where x.id = a.id and (a.item_id, a.target, a.job_id, a.overhead_category, a.amount, a.purchase_order_id, a.purchase_order_item_id,
                         a.order_item_id, a.note, a.ai_suggested, a.ai_reason, a.position, a.confirmed_at is not null)
        is distinct from (x.item_id, x.target, x.job_id, x.overhead_category, x.amount, x.purchase_order_id, x.purchase_order_item_id,
                          x.order_item_id, x.note, x.ai_suggested, x.ai_reason, x.position, x.confirmed);
  insert into supplier_invoice_allocations (invoice_id, item_id, target, job_id, overhead_category, amount, purchase_order_id,
                                            purchase_order_item_id, order_item_id, note, ai_suggested, ai_reason, position, confirmed_at)
  select p_invoice, x.item_id, x.target, x.job_id, x.overhead_category, x.amount, x.purchase_order_id, x.purchase_order_item_id,
         x.order_item_id, x.note, x.ai_suggested, x.ai_reason, x.position, case when x.confirmed then now() end
  from _sia_rows x where x.id is null;
  get diagnostics v_n = row_count;
  -- stav (i bez změny řádků — např. potvrzení prázdné faktury)
  perform supplier_invoice_refresh(p_invoice);
  return jsonb_build_object('inserted', v_n, 'status', (select status from supplier_invoices where id = p_invoice));
end $$;

/**
 * Nahradí položky faktury v jedné transakci pod zámkem faktury (souběžné uložení rozdělení čeká):
 * s id upraví, bez id založí, chybějící smaže (i s jejich rozdělením). Kapacitu rozdělení zkontroluje
 * až na konci (mezistavy nevadí). Faktura bez součtu dostane součet = Σ položek.
 * p_rows = [{ id?, text, code?, quantity?, unit?, unitPrice?, amount, vatRate? }].
 */
create or replace function supplier_invoice_set_items(p_invoice uuid, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_n int; v_net numeric;
begin
  if app_ctx() not in ('app', 'service', 'db') then raise exception 'K této akci nemáš oprávnění.' using errcode = '42501', hint = 'FORBIDDEN'; end if;
  select total_net into v_net from supplier_invoices where id = p_invoice for update;
  if not found then raise exception 'Faktura nenalezena.' using errcode = 'P0002', hint = 'NOT_FOUND'; end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then raise exception 'Neplatné položky.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  create temporary table if not exists _sii_rows (
    id uuid, text text, code text, quantity numeric, unit text, unit_price numeric, amount numeric, vat_rate numeric, position int
  ) on commit drop;
  truncate _sii_rows;
  insert into _sii_rows
  select app_uuid(r ->> 'id'), left(coalesce(r ->> 'text', ''), 1000), left(nullif(btrim(r ->> 'code'), ''), 80),
         nullif(r ->> 'quantity', '')::numeric, left(nullif(btrim(r ->> 'unit'), ''), 20), nullif(r ->> 'unitPrice', '')::numeric,
         round(coalesce(nullif(r ->> 'amount', ''), '0')::numeric, 2), nullif(r ->> 'vatRate', '')::numeric, (ord - 1)::int
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) with ordinality as t(r, ord);
  update _sii_rows x set id = null where x.id is not null
    and not exists (select 1 from supplier_invoice_items i where i.id = x.id and i.invoice_id = p_invoice);
  perform set_config('app.sinv_bulk', 'on', true);
  delete from supplier_invoice_items i where i.invoice_id = p_invoice and not exists (select 1 from _sii_rows x where x.id = i.id);
  update supplier_invoice_items i set text = x.text, code = x.code, quantity = x.quantity, unit = x.unit, unit_price = x.unit_price,
         amount = x.amount, vat_rate = x.vat_rate, position = x.position
  from _sii_rows x
  where x.id = i.id and (i.text, i.code, i.quantity, i.unit, i.unit_price, i.amount, i.vat_rate, i.position)
        is distinct from (x.text, x.code, x.quantity, x.unit, x.unit_price, x.amount, x.vat_rate, x.position);
  insert into supplier_invoice_items (invoice_id, position, text, code, quantity, unit, unit_price, amount, vat_rate)
  select p_invoice, x.position, x.text, x.code, x.quantity, x.unit, x.unit_price, x.amount, x.vat_rate from _sii_rows x where x.id is null;
  get diagnostics v_n = row_count;
  perform set_config('app.sinv_bulk', '', true);
  if v_net is null and exists (select 1 from _sii_rows) then
    update supplier_invoices set total_net = (select sum(amount) from _sii_rows) where id = p_invoice;
  end if;
  perform supplier_invoice_check(p_invoice);
  perform supplier_invoice_refresh(p_invoice);
  return jsonb_build_object('inserted', v_n, 'status', (select status from supplier_invoices where id = p_invoice));
end $$;

-- ── 6) Náklad zakázky — PŘEDEFINOVÁNO (základ 20261023150000 §job_cost) ─
/**
 * Potvrzené alokace faktur dodavatelů na zakázku. czk = částka v Kč (cizí měna × kurz; BEZ KURZU null —
 * náklad pak není známý, nikdy se nepočítá 1:1). Zamítnuté, duplicitní a zálohové faktury se nepočítají.
 * po_final = faktura je u své objednávky označená jako konečná („Faktura konečná").
 */
drop function if exists job_invoice_allocations(uuid);
create or replace function job_invoice_allocations(p_job uuid)
returns table (purchase_order_id uuid, purchase_order_item_id uuid, czk numeric, invoice_id uuid, invoice_number text,
               currency text, po_final boolean)
language sql stable security definer set search_path = public as $$
  select a.purchase_order_id, a.purchase_order_item_id,
         case when si.currency = 'CZK' then a.amount
              when si.exchange_rate is null then null
              else round(a.amount * si.exchange_rate, 2) end,
         si.id, si.number, si.currency,
         a.purchase_order_id is not null and a.purchase_order_id = any(si.final_po_ids)
  from supplier_invoice_allocations a join supplier_invoices si on si.id = a.invoice_id
  where a.job_id = p_job and a.target = 'job' and a.confirmed_at is not null
    and si.status <> 'zamitnuto' and si.duplicate_of_id is null and not si.is_proforma
$$;

/**
 * Objednávky dodavatelům zakázky a co z nich jde do nákladu (bez dvojího počítání):
 *  - bez faktury → částka objednávky,
 *  - vyfakturovaná CELÁ (konečná faktura / Σ faktur ≥ 99,5 % objednávky / každá položka objednávky má fakturu)
 *    → Σ faktur (skutečnost, i když je nižší),
 *  - jen DÍLČÍ faktura → max(Σ faktur, částka objednávky) — první dílčí faktura náklad nesníží.
 * unknown = položka bez ceny a objednávka není celá vyfakturovaná, nebo faktura v cizí měně bez kurzu.
 */
create or replace function job_purchase_order_costs(p_job uuid)
returns table (id uuid, number text, order_date date, total numeric, invoiced boolean, inv numeric, complete boolean,
               contributes numeric, unpriced boolean, no_rate boolean)
language sql stable security definer set search_path = public as $$
  with a as materialized (select * from job_invoice_allocations(p_job)),
  p as (
    select po.id, po.number, po.order_date, coalesce(po.total, 0) as total,
           exists (select 1 from a where a.purchase_order_id = po.id) as invoiced,
           coalesce((select sum(coalesce(a.czk, 0)) from a where a.purchase_order_id = po.id), 0) as inv,
           exists (select 1 from a where a.purchase_order_id = po.id and a.czk is null) as no_rate,
           exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id and i.unit_price is null) as unpriced,
           coalesce((select bool_or(a.po_final) from a where a.purchase_order_id = po.id), false) as final,
           exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id)
             and not exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id
                               and not exists (select 1 from a where a.purchase_order_item_id = i.id)) as items_covered
    from purchase_orders po where po.job_id = p_job and po.status <> 'zrusena'
  ),
  q as (select p.*, p.invoiced and (p.final or p.items_covered or p.inv >= p.total * 0.995 - 0.005) as complete from p)
  select q.id, q.number, q.order_date, q.total, q.invoiced, q.inv, q.complete,
         case when not q.invoiced then q.total when q.complete then q.inv else greatest(q.inv, q.total) end,
         q.unpriced, q.no_rate
  from q
$$;

/**
 * Náklad zakázky bez dvojího počítání: Σ job_purchase_order_costs.contributes
 * + Σ potvrzených alokací faktur na zakázku bez objednávky (nebo na zrušenou / cizí objednávku);
 * bez objednávek i faktur odhad orders.purchase_cost. Nabídky dodavatelů se nepočítají (vítězná nabídka
 * vyplňuje purchase_cost = odhad). Neznámý: viz job_purchase_order_costs.unknown, faktura bez kurzu.
 */
create or replace function job_cost(p_job uuid, out cost numeric, out known boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_count int; v_total numeric; v_unknown boolean; v_free numeric; v_free_count int; v_free_unknown boolean; v_planned numeric;
begin
  select count(*), coalesce(sum(x.contributes), 0), coalesce(bool_or((x.unpriced and not x.complete) or x.no_rate), false)
    into v_count, v_total, v_unknown
  from job_purchase_order_costs(p_job) x;
  select count(*), coalesce(sum(coalesce(a.czk, 0)), 0), coalesce(bool_or(a.czk is null), false)
    into v_free_count, v_free, v_free_unknown
  from job_invoice_allocations(p_job) a
  where a.purchase_order_id is null
     or not exists (select 1 from purchase_orders po where po.id = a.purchase_order_id and po.job_id = p_job and po.status <> 'zrusena');
  select purchase_cost into v_planned from orders where id = p_job;
  if v_count + v_free_count > 0 then
    known := not (v_unknown or v_free_unknown);
    cost  := v_total + v_free;
  else
    known := v_planned is not null;
    cost  := coalesce(v_planned, 0);
  end if;
end $$;

/**
 * Proč náklad zakázky není známý (null = je známý): čísla objednávek s položkou bez ceny, které ještě
 * nejsou celé vyfakturované, + „kurz EUR u faktury dodavatele" u faktur v cizí měně bez kurzu (bez čísla faktury — to vidí jen ten, kdo vidí faktury).
 */
create or replace function job_unpriced_purchase_orders(p_job uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select nullif(array(
    select x.label from (
      select 0 as k, c.order_date as d, coalesce(c.number, '—') as label
      from job_purchase_order_costs(p_job) c where c.unpriced and not c.complete
      union all
      select distinct 1, null::date, 'kurz ' || a.currency || ' u faktury dodavatele'
      from job_invoice_allocations(p_job) a where a.czk is null
    ) x order by x.k, x.d nulls last, x.label
  ), '{}'::text[])
$$;
revoke all on function job_purchase_order_costs(uuid) from public, anon, authenticated;
grant execute on function job_purchase_order_costs(uuid) to service_role;
revoke all on function job_unpriced_purchase_orders(uuid) from public, anon, authenticated;
grant execute on function job_unpriced_purchase_orders(uuid) to service_role;

-- ── 7) Sloučení zakázek: pozdní zápis na zdroj → cíl ─────────
drop trigger if exists trg_000_merge_redirect on supplier_invoice_allocations;
create trigger trg_000_merge_redirect before insert or update of job_id on supplier_invoice_allocations
  for each row execute function merge_redirect_job('job_id');

-- ============================================================
-- merge_jobs — PŘEDEFINOVÁNO (základ 20261023161000 §merge_jobs): navíc
--   a) položky se shodným výkresem: alokace faktur dodavatelů na položku zdroje → položka cíle,
--   d) alokace faktur dodavatelů na zdroj → cíl (počet supplierInvoiceAllocations v moved).
-- ============================================================
create or replace function merge_jobs(p_target uuid, p_source uuid, p_token uuid,
                                      p_force boolean default false, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t orders%rowtype; s orders%rowtype; v_prev job_merges%rowtype;
  v_ctx text := app_ctx(); v_actor uuid := app_actor(); v_actor_name text; v_admin boolean;
  v_plan jsonb; v_conf jsonb; v_c jsonb; v_merge uuid; v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_hdr text := nullif(current_setting('request.headers', true), '');
  v_patch jsonb := '{}'; f jsonb; v_sets text; v_stage_to job_stage; v_order_block boolean;
  r record; v_pos int; v_n int; v_moved jsonb := '{}'; v_items_merged int := 0; v_files_dup int := 0;
  v_accepted jsonb; v_summary text; v_result jsonb; v_from jsonb; v_handoff uuid; v_has_final boolean;
  v_pair_src uuid[]; v_si order_items%rowtype; v_ti order_items%rowtype; v_pdf jsonb;
begin
  if v_ctx not in ('app', 'service', 'db') then raise exception 'K této akci nemáš oprávnění.' using errcode = '42501', hint = 'FORBIDDEN'; end if;
  if p_token is null or p_target is null or p_source is null then
    raise exception 'Chybí identifikátor požadavku.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  if p_target = p_source then raise exception 'Zakázku nejde sloučit samu se sebou.' using errcode = 'P0001', hint = 'SAME_JOB'; end if;

  -- zámky obou zakázek v pevném pořadí (souběžná sloučení se nezablokují navzájem)
  perform 1 from orders where id in (p_target, p_source) order by id for update;
  select * into t from orders where id = p_target;
  select * into s from orders where id = p_source;
  if t.id is null or s.id is null then raise exception 'Zakázka nenalezena.' using errcode = 'P0002', hint = 'NOT_FOUND'; end if;

  -- idempotence: stejný token, nebo zdroj už je sloučený do cíle
  select * into v_prev from job_merges where token = p_token;
  if found then
    if v_prev.target_id is distinct from p_target or v_prev.source_id is distinct from p_source then
      raise exception 'Neplatný požadavek.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    return v_prev.result || jsonb_build_object('replayed', true);
  end if;
  if s.merged_into_id = p_target then
    select * into v_prev from job_merges where source_id = p_source and target_id = p_target order by created_at desc limit 1;
    return coalesce(v_prev.result, jsonb_build_object('targetId', t.id, 'targetNumber', t.number, 'sourceId', s.id, 'sourceNumber', s.number))
      || jsonb_build_object('replayed', true);
  end if;

  v_plan := merge_jobs_plan(p_target, p_source);
  v_conf := v_plan->'conflicts';
  select c into v_c from jsonb_array_elements(v_conf) c where c->>'level' = 'block' limit 1;
  if v_c is not null then
    raise exception '%', v_c->>'message' using errcode = case when v_c->>'code' = 'FORBIDDEN' then '42501' else 'P0001' end,
      hint = v_c->>'code';
  end if;
  v_admin := (v_plan->>'canForce')::boolean;
  if (v_plan->>'needsForce')::boolean then
    if not coalesce(p_force, false) or not v_admin then
      select c into v_c from jsonb_array_elements(v_conf) c where c->>'level' = 'force' limit 1;
      raise exception '%', v_c->>'message' using errcode = 'P0001', hint = 'NEEDS_FORCE';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'Napiš důvod, proč slučuješ i přes upozornění.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  end if;

  select coalesce(nullif(btrim(full_name), ''), email) into v_actor_name from profiles where id = v_actor;
  insert into job_merges (token, target_id, source_id, target_number, source_number, forced, reason, created_by, created_via)
  values (p_token, t.id, s.id, t.number, s.number, coalesce(p_force, false) and (v_plan->>'needsForce')::boolean,
          left(v_reason, 1000), v_actor, case when v_ctx = 'db' then 'db' else app_actor_via() end)
  returning id into v_merge;
  v_from := jsonb_build_object('id', s.id, 'number', s.number, 'mergeId', v_merge);
  -- vlastní přesuny se nepřesměrovávají a stráž zdroje je pustí (do konce transakce / RPC)
  perform set_config('app.job_merge', 'on', true);

  -- ── a) položky: shodný výkres → do položky cíle (doplní prázdné), jinak přesun za položky cíle ──
  v_pair_src := array(select p.source_item from merge_jobs_item_pairs(t.id, s.id) p);
  -- objednávku zákazníka má jen zdroj → přejde s ní celý blok objednávky a počty kusů u shodných
  -- výkresů platí z ní (nabídka cíle je jen návrh)
  v_order_block := s.order_revision >= 1 and t.order_revision < 1;
  for r in select p.source_item, p.target_item from merge_jobs_item_pairs(t.id, s.id) p loop
    select * into v_si from order_items where id = r.source_item;
    select * into v_ti from order_items where id = r.target_item;
    -- klíč focení je unikátní: zdroj ho uvolní, cíl ho převezme (když nemá vlastní) — opakované
    -- použití dávky pak najde položku cíle
    if v_si.capture_key is not null then
      update order_items set capture_key = null where id = v_si.id;
    end if;
    update order_items ti set
      capture_key = coalesce(ti.capture_key, v_si.capture_key),
      -- dodané kusy: platí víc (zdroj mohl být už dodaný); uzavření dodávky platí z kterékoli
      delivered_quantity = greatest(coalesce(ti.delivered_quantity, 0), coalesce(v_si.delivered_quantity, 0)),
      delivery_closed = coalesce(ti.delivery_closed, false) or coalesce(v_si.delivery_closed, false),
      delivery_closed_reason = case when ti.delivery_closed then ti.delivery_closed_reason
                                    else coalesce(ti.delivery_closed_reason, v_si.delivery_closed_reason) end,
      drawing_id = coalesce(ti.drawing_id, si.drawing_id),
      quantity = case when v_order_block and si.quantity > 0 then si.quantity else ti.quantity end,
      unit = case when v_order_block and si.quantity > 0 then coalesce(si.unit, ti.unit) else ti.unit end,
      revision = coalesce(nullif(btrim(coalesce(ti.revision, '')), ''), si.revision),
      name = coalesce(nullif(btrim(coalesce(ti.name, '')), ''), si.name),
      description = coalesce(nullif(btrim(coalesce(ti.description, '')), ''), si.description),
      material = coalesce(nullif(btrim(coalesce(ti.material, '')), ''), si.material),
      material_group = coalesce(ti.material_group, si.material_group),
      material_designation = coalesce(ti.material_designation, si.material_designation),
      material_condition = coalesce(ti.material_condition, si.material_condition),
      unit_price = coalesce(ti.unit_price, si.unit_price),
      purchase_unit_price = coalesce(ti.purchase_unit_price, si.purchase_unit_price),
      weight_source = case when ti.weight_kg is null and si.weight_kg is not null then si.weight_source else ti.weight_source end,
      weight_kg = coalesce(ti.weight_kg, si.weight_kg),
      blank_weight_kg = coalesce(ti.blank_weight_kg, si.blank_weight_kg),
      blank_dims = coalesce(ti.blank_dims, si.blank_dims), blank_shape = coalesce(ti.blank_shape, si.blank_shape),
      heat_treatment = coalesce(ti.heat_treatment, si.heat_treatment), heat_status = coalesce(ti.heat_status, si.heat_status),
      heat_steps = coalesce(ti.heat_steps, si.heat_steps),
      surface_treatment = coalesce(ti.surface_treatment, si.surface_treatment), surface_status = coalesce(ti.surface_status, si.surface_status),
      surface_steps = coalesce(ti.surface_steps, si.surface_steps),
      hardness = coalesce(ti.hardness, si.hardness), drawing_notes = coalesce(ti.drawing_notes, si.drawing_notes),
      note = coalesce(nullif(btrim(coalesce(ti.note, '')), ''), si.note),
      spec_sources = coalesce(si.spec_sources, '{}'::jsonb) || coalesce(ti.spec_sources, '{}'::jsonb)
    from order_items si where si.id = r.source_item and ti.id = r.target_item;
    -- kdo a kdy dodal / uzavřel: původní autor ze zdroje (trigger by zapsal „teď, slučující")
    if coalesce(v_si.delivered_quantity, 0) > coalesce(v_ti.delivered_quantity, 0) then
      update order_items set delivered_changed_at = v_si.delivered_changed_at, delivered_changed_by = v_si.delivered_changed_by
      where id = r.target_item;
    end if;
    if coalesce(v_si.delivery_closed, false) and not coalesce(v_ti.delivery_closed, false) then
      update order_items set delivery_closed_at = v_si.delivery_closed_at, delivery_closed_by = v_si.delivery_closed_by
      where id = r.target_item;
    end if;
    update job_files set order_item_id = r.target_item where order_item_id = r.source_item;
    update purchase_order_items set order_item_id = r.target_item where order_item_id = r.source_item;
    update supplier_invoice_allocations set order_item_id = r.target_item where order_item_id = r.source_item;
    update job_operations set order_item_ids = array_replace(order_item_ids, r.source_item, r.target_item)
    where job_id in (t.id, s.id) and r.source_item = any(order_item_ids);
    v_items_merged := v_items_merged + 1;
  end loop;
  select coalesce(max(position), -1) + 1 into v_pos from order_items where order_id = t.id;
  v_n := 0;
  for r in select i.id from order_items i where i.order_id = s.id
           and not (i.id = any(v_pair_src))
           order by i.position, i.created_at, i.id loop
    update order_items set order_id = t.id, position = v_pos where id = r.id;
    v_pos := v_pos + 1; v_n := v_n + 1;
  end loop;
  v_moved := v_moved || jsonb_build_object('items', v_n, 'itemsMerged', v_items_merged);

  -- ── b) dokumenty (vč. anonymizace) a výkresy; shodný obsah = archivovaná kopie u cíle ──
  v_n := 0;
  for r in select sf.id, sf.archived, (select tf.id from job_files tf where tf.job_id = t.id and not tf.archived
                                 and tf.content_sha256 = sf.content_sha256 order by tf.created_at, tf.id limit 1) as dup
           from job_files sf where sf.job_id = s.id order by sf.created_at, sf.id loop
    if r.dup is not null and not r.archived then
      update job_files set job_id = t.id, archived = true, replaced_by = coalesce(replaced_by, r.dup) where id = r.id;
      v_files_dup := v_files_dup + 1;
    else
      update job_files set job_id = t.id where id = r.id;
    end if;
    v_n := v_n + 1;
  end loop;
  v_moved := v_moved || jsonb_build_object('files', v_n, 'filesDuplicate', v_files_dup);
  update drawings set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('drawings', v_n);

  -- ── c) nabídky: přesun je systémové přeřazení, ne úprava obsahu nabídky — pravidla úprav (R5: odeslanou
  --       nabídku ne-admin nezmění) se na něj nevztahují. Bez x-actor-kind je kontext „service" (žádný přímý
  --       zápis člověka), autor (x-actor-id) zůstává → kdo upravil = autor sloučení. ──
  if v_hdr is not null then
    perform merge_jobs_headers(null, array['x-actor-kind', 'x-change-note']);
  end if;
  update quotes set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('quotes', v_n);
  if v_hdr is not null then perform set_config('request.headers', v_hdr, true); end if;

  -- ── d) pošta, nákup, výroba, úhrady, revize, předání, fronty, doklady ──
  update emails set order_id = t.id where order_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('emails', v_n);

  if exists (select 1 from supplier_quotes where job_id = t.id and selected) then
    update supplier_quotes set selected = false where job_id = s.id and selected;
  end if;
  update supplier_quotes set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('supplierQuotes', v_n);

  update purchase_orders set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('purchaseOrders', v_n);

  -- faktury dodavatelů: alokace na zdroj → cíl (náklad zakázky se přepočítá v h)
  update supplier_invoice_allocations set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('supplierInvoiceAllocations', v_n);

  select coalesce(max(position), -1) + 1, bool_or(ends_at_customer_date and status <> 'preskoceno')
    into v_pos, v_has_final from job_operations where job_id = t.id;
  update job_operations set job_id = t.id, position = position + v_pos,
         ends_at_customer_date = case when coalesce(v_has_final, false) then false else ends_at_customer_date end
  where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('operations', v_n);

  update job_payments set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('payments', v_n);

  if t.order_revision < 1 then
    delete from job_order_revisions where job_id = t.id;      -- cíl objednávku nemá (prázdné řádky by kolidovaly)
    update job_order_revisions set job_id = t.id where job_id = s.id;
    get diagnostics v_n = row_count;
  else
    v_n := 0;                                               -- platí objednávka cíle; revize zdroje zůstanou v jeho historii
  end if;
  v_moved := v_moved || jsonb_build_object('revisions', v_n);

  update production_handoffs set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('handoffs', v_n);

  update approval_queue set order_id = t.id,
         payload = case when payload::text like '%' || s.id::text || '%' then replace(payload::text, s.id::text, t.id::text)::jsonb else payload end
  where order_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('approvals', v_n);

  update anon_send_queue set job_id = t.id,
         payload = case when payload::text like '%' || s.id::text || '%' then replace(payload::text, s.id::text, t.id::text)::jsonb else payload end
  where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('anonQueue', v_n);

  update ai_training_examples set job_id = t.id where job_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('training', v_n);
  update invoices set order_id = t.id where order_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('invoices', v_n);
  update delivery_notes set order_id = t.id where order_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('deliveryNotes', v_n);
  update documents set order_id = t.id where order_id = s.id;
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('documents', v_n);

  -- rozpracované / dokončené focení: odkazy na zdroj v datech → cíl (otevřít zakázku, idempotence kroků)
  update capture_sessions set data = regexp_replace(replace(data::text, s.id::text, t.id::text),
           '("jobNumber"\s*:\s*)"' || regexp_replace(s.number, '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '"', '\1"' || t.number || '"', 'g')::jsonb
  where data::text like '%' || s.id::text || '%';
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('captureSessions', v_n);
  update capture_apply_steps set result = replace(result::text, s.id::text, t.id::text)::jsonb
  where result is not null and result::text like '%' || s.id::text || '%';

  -- historie: vše kromě hlavního stavu zdroje (ten popisuje zdroj sám); s odkazem, odkud událost je
  -- (záznamy o zakázce / poptávce / objednávce teď patří cíli — entity_id na cíl)
  update job_events set job_id = t.id, data = coalesce(data, '{}'::jsonb) || jsonb_build_object('mergedFrom', v_from),
         entity_id = case when entity in ('job', 'inquiry', 'order') and entity_id = s.id then t.id else entity_id end
  where job_id = s.id and type <> 'stage';
  get diagnostics v_n = row_count; v_moved := v_moved || jsonb_build_object('events', v_n);

  -- ── e) hodnoty cíle: vyhrává cíl, prázdné doplní zdroj, poznámky se připojí ──
  for f in select * from jsonb_array_elements(v_plan->'fields') loop
    if f->>'rule' in ('fill', 'append', 'union') then
      v_patch := v_patch || jsonb_build_object(f->>'field', f->'value');
    end if;
  end loop;
  v_stage_to := (v_plan #>> '{stage,to}')::job_stage;
  -- dodané kusy ze zdroje mohly cíl mezitím posunout (Dodáno zákazníkovi) — zpět ho sloučení neposune
  if v_stage_to <> t.status and job_stage_rank(v_stage_to) <= job_stage_rank((select o.status from orders o where o.id = t.id)) then
    v_stage_to := t.status;
  end if;
  if v_stage_to <> t.status then
    v_patch := v_patch || jsonb_build_object('status', v_stage_to);
    -- razítka postupu ze zdroje (jinak by posun zapsal „teď")
    v_patch := v_patch || jsonb_strip_nulls(jsonb_build_object(
      'confirmed_at', case when t.confirmed_at is null then s.confirmed_at end,
      'production_started_at', case when t.production_started_at is null then s.production_started_at end,
      'produced_at', case when t.produced_at is null then s.produced_at end,
      'received_at', case when t.received_at is null then s.received_at end,
      'shipped_at', case when t.shipped_at is null then s.shipped_at end,
      'delivered_at', case when t.delivered_at is null then s.delivered_at end,
      'invoiced_at', case when t.invoiced_at is null then s.invoiced_at end));
  end if;
  if v_order_block then
    -- objednávka zákazníka je jen u zdroje: celý blok objednávky (stav, revize, potvrzení) jde s ní
    v_patch := v_patch || jsonb_strip_nulls(jsonb_build_object(
      'order_status', s.order_status, 'order_revision', s.order_revision, 'order_confirmed_revision', s.order_confirmed_revision,
      'order_mismatch', s.order_mismatch, 'confirmed_by', s.confirmed_by,
      'confirmation_issued_at', s.confirmation_issued_at, 'confirmation_issued_by', s.confirmation_issued_by,
      'confirmation_issued_revision', s.confirmation_issued_revision,
      'confirmation_sent_at', s.confirmation_sent_at, 'confirmation_sent_by', s.confirmation_sent_by,
      'confirmation_sent_via', s.confirmation_sent_via, 'confirmation_sent_revision', s.confirmation_sent_revision));
  end if;
  if not t.ai_filled and s.ai_filled then v_patch := v_patch || jsonb_build_object('ai_filled', true); end if;

  if v_patch <> '{}'::jsonb then
    select string_agg(format('%I = r.%I', k, k), ', ') into v_sets from jsonb_object_keys(v_patch) k;
    if v_hdr is not null and v_stage_to <> t.status then
      perform merge_jobs_headers(jsonb_build_object('x-change-note', merge_jobs_note('sloučením se zakázkou ' || s.number)), null);
    end if;
    if v_stage_to = 've_vyrobe' then           -- brána předání (až bude zapnutá): předání zdroje platí i pro cíl
      select id into v_handoff from production_handoffs where job_id = t.id and kind = 'predani' and undone_at is null
      order by created_at desc limit 1;
      if v_handoff is not null then perform set_config('app.production_handoff', v_handoff::text, true); end if;
    end if;
    execute format('update orders o set %s from jsonb_populate_record(null::orders, $2) r where o.id = $1', v_sets)
      using t.id, v_patch;
    if v_handoff is not null then perform set_config('app.production_handoff', '', true); end if;
    if v_hdr is not null then perform set_config('request.headers', v_hdr, true); end if;
  end if;
  if v_order_block then
    -- kdo objednávku potvrdil, vystavil a odeslal potvrzení: původní autoři ze zdroje (v kontextu
    -- aplikace by stavový trigger zapsal slučujícího) → servisní zápis bez x-actor-kind
    if v_hdr is not null then perform merge_jobs_headers(null, array['x-actor-kind', 'x-change-note']); end if;
    update orders o set confirmed_by = s.confirmed_by, confirmation_issued_by = s.confirmation_issued_by,
           confirmation_sent_by = s.confirmation_sent_by, order_changed_at = s.order_changed_at, order_changed_by = s.order_changed_by,
           order_status_changed_at = s.order_status_changed_at, order_status_changed_by = s.order_status_changed_by,
           order_status_changed_via = s.order_status_changed_via
    where o.id = t.id;
    if v_hdr is not null then perform set_config('request.headers', v_hdr, true); end if;
  end if;

  -- ── f) objednávka s jedinou odeslanou nabídkou = nabídka přijatá (jako ruční posun do Objednávky) ──
  select * into t from orders where id = t.id;
  if job_stage_rank(t.status) >= 3 and not exists (select 1 from quotes where job_id = t.id and status = 'prijato') then
    select count(*)::int as n, (array_agg(id))[1] as id, (array_agg(number))[1] as number,
           coalesce(bool_or(admin_approval_required and approved_by is null), false) as blocked into r
    from quotes where job_id = t.id and not archived and status = 'odeslano';
    -- neschválenou nabídku přijmout nejde (náhled to už hlásí jako QUOTE_WONT_ACCEPT)
    if r.n = 1 and not r.blocked then
      begin
        perform set_config('app.flow_cause', 'prijeti', true);
        update quotes set status = 'prijato' where id = r.id;
        perform set_config('app.flow_cause', '', true);
        v_accepted := jsonb_build_object('id', r.id, 'number', r.number);
        if v_ctx = 'app' then                    -- záznam stavu nabídky (mimo aplikaci ho zapíše trigger sám)
          insert into job_events (job_id, type, message, data, actor_id, entity, entity_id)
          values (t.id, 'quote', 'Nabídka ' || coalesce(r.number, '') || ': Odeslaná → Přijatá — při sloučení se zakázkou ' || s.number
                                 || ' (objednávka zákazníka k jediné odeslané nabídce)',
                  jsonb_build_object('quoteId', r.id, 'number', r.number, 'action', 'state', 'from', 'odeslana', 'to', 'prijata',
                                     'jobMerge', jsonb_build_object('mergeId', v_merge, 'sourceNumber', s.number)),
                  v_actor, 'quote', r.id);
        end if;
      exception when others then
        perform set_config('app.flow_cause', '', true);
        v_conf := v_conf || jsonb_build_object('code', 'QUOTE_NOT_ACCEPTED', 'level', 'warn',
          'message', 'Nabídku ' || coalesce(r.number, '') || ' označ jako přijatou ručně (' || sqlerrm || ').');
      end;
    end if;
  end if;
  if v_accepted is null then
    select jsonb_build_object('id', id, 'number', number) into v_accepted from quotes
    where job_id = t.id and status = 'prijato' order by accepted_at desc nulls last limit 1;
  end if;

  -- ── g) zdroj: uzavřít jako duplicitní a označit sloučení (řádek zůstává kvůli historii a přesměrování) ──
  if v_hdr is not null then
    perform merge_jobs_headers(jsonb_build_object('x-change-note', merge_jobs_note('sloučeno do zakázky ' || t.number)), null);
  end if;
  -- dílčí stavy zdroje se vynulují: sloučená duplicita není „odmítnutá poptávka“ ani „stornovaná
  -- objednávka“ (počty a seznamy toku); klíč focení přejde na cíl, když nemá vlastní (jinak zůstane
  -- a opakované focení ho přes merged_into_id dohledá)
  update orders set status = 'zruseno', lost_reason = 'duplicita', lost_note = left('Sloučeno do zakázky ' || t.number, 500),
         merged_into_id = t.id, merged_at = now(), merged_by = v_actor, quote_id = null, flow_proposal = null,
         inquiry_status = null, order_status = null,
         capture_key = case when t.capture_key is null then null else capture_key end
  where id = s.id;
  if v_hdr is not null then perform set_config('request.headers', v_hdr, true); end if;
  -- (vynulování dílčích stavů není událost — zdroj má „Stav: … → Zrušeno — sloučeno do …“)
  delete from job_events e where e.job_id = s.id and e.type = 'status' and e.created_at = now()
    and e.data->>'field' in ('inquiry_status', 'order_status') and not (e.data ? 'to');
  if t.capture_key is null and s.capture_key is not null then
    update orders set capture_key = s.capture_key where id = t.id;
  end if;

  -- ── h) přepočty (agregáty položek, úhrady, výroba, provize obou zakázek) ──
  perform recompute_job_flow(t.id, false);
  perform recompute_job_flow(s.id, false);
  perform recompute_job_payments(t.id);
  perform recompute_job_payments(s.id);
  perform recompute_job_production(t.id);
  perform recompute_job_production(s.id);
  perform recompute_job_commission(t.id);
  perform recompute_job_commission(s.id);
  select * into t from orders where id = t.id;

  -- ── i) historie obou zakázek + audit ──
  v_summary := concat_ws(', ',
    case when (v_moved->>'items')::int > 0 then flow_count_label((v_moved->>'items')::int, 'položka', 'položky', 'položek') end,
    case when v_items_merged > 0 then flow_count_label(v_items_merged, 'položka spojena', 'položky spojeny', 'položek spojeno') end,
    case when (v_moved->>'quotes')::int > 0 then flow_count_label((v_moved->>'quotes')::int, 'nabídka', 'nabídky', 'nabídek') end,
    case when (v_moved->>'files')::int > 0 then flow_count_label((v_moved->>'files')::int, 'dokument', 'dokumenty', 'dokumentů') end,
    case when (v_moved->>'emails')::int > 0 then flow_count_label((v_moved->>'emails')::int, 'e-mail', 'e-maily', 'e-mailů') end,
    case when (v_moved->>'purchaseOrders')::int > 0 then flow_count_label((v_moved->>'purchaseOrders')::int, 'objednávka dodavateli', 'objednávky dodavatelům', 'objednávek dodavatelům') end,
    case when (v_moved->>'operations')::int > 0 then flow_count_label((v_moved->>'operations')::int, 'krok výroby', 'kroky výroby', 'kroků výroby') end,
    case when (v_moved->>'payments')::int > 0 then flow_count_label((v_moved->>'payments')::int, 'úhrada', 'úhrady', 'úhrad') end);

  v_result := jsonb_build_object(
    'mergeId', v_merge, 'targetId', t.id, 'targetNumber', t.number, 'sourceId', s.id, 'sourceNumber', s.number,
    'stage', jsonb_build_object('from', v_plan #>> '{stage,from}', 'to', t.status, 'source', s.status),
    'acceptedQuote', v_accepted, 'moved', v_moved, 'fields', v_plan->'fields',
    'warnings', (select coalesce(jsonb_agg(c), '[]'::jsonb) from jsonb_array_elements(v_conf) c where c->>'level' in ('warn', 'info', 'force')),
    'forced', coalesce(p_force, false) and (v_plan->>'needsForce')::boolean, 'reason', v_reason,
    'by', v_actor, 'byName', v_actor_name, 'at', now(), 'quotePdf', v_plan->'quotePdf');

  -- naše nabídka byla u zdroje jen jako PDF: zapsat, že byla odeslaná (jinak by „Nabídka odeslaná“ zmizela)
  v_pdf := v_plan->'quotePdf';
  if v_pdf is not null and jsonb_typeof(v_pdf) = 'object' then
    insert into job_events (job_id, type, message, data, actor_id, entity, entity_id)
    values (t.id, 'quote',
      left('Nabídka ' || (v_pdf->>'label') || ' (PDF) odeslána — dle zakázky ' || s.number
        || coalesce(' (stav Nabídka odeslaná od ' || to_char(((v_pdf->>'since')::timestamptz at time zone 'Europe/Prague'), 'FMDD. FMMM. YYYY') || ')', ''), 1000),
      jsonb_build_object('action', 'pdf_only', 'label', v_pdf->>'label', 'since', v_pdf->'since',
                         'jobMerge', jsonb_build_object('mergeId', v_merge, 'sourceNumber', s.number)),
      v_actor, 'job', t.id);
  end if;

  insert into job_events (job_id, type, message, data, actor_id, entity, entity_id)
  values (t.id, 'field',
    left('Sloučeno ze zakázky ' || s.number || ' (' || coalesce(v_actor_name, 'Systém') || ')'
      || case when v_summary <> '' then ': ' || v_summary else '' end
      || case when (v_plan->>'needsForce')::boolean then ' · důvod: ' || v_reason else '' end, 2000),
    jsonb_build_object('jobMerge', jsonb_build_object('role', 'target', 'mergeId', v_merge, 'sourceId', s.id, 'sourceNumber', s.number,
      'moved', v_moved, 'fields', (select coalesce(jsonb_agg(x - 'value'), '[]'::jsonb) from jsonb_array_elements(v_plan->'fields') x))),
    v_actor, 'job', t.id);
  insert into job_events (job_id, type, message, data, actor_id, entity, entity_id)
  values (s.id, 'field',
    left('Sloučeno do zakázky ' || t.number || ' (' || coalesce(v_actor_name, 'Systém') || ') — doklady, nabídky a historie jsou teď tam', 2000),
    jsonb_build_object('jobMerge', jsonb_build_object('role', 'source', 'mergeId', v_merge, 'targetId', t.id, 'targetNumber', t.number)),
    v_actor, 'job', s.id);
  insert into audit_log (action, entity, entity_id, diff)
  values ('job_merged', 'orders', t.id::text, jsonb_build_object('jobId', t.id, 'targetNumber', t.number, 'sourceId', s.id,
    'sourceNumber', s.number, 'moved', v_moved, 'forced', v_result->'forced', 'reason', v_reason));

  update job_merges set result = v_result where id = v_merge;
  perform set_config('app.job_merge', '', true);
  return v_result;
end $$;

-- ── 8) Práva: RLS (druhá linie), sloupce platby, funkce ─────
alter table supplier_invoices enable row level security;
alter table supplier_invoice_files enable row level security;
alter table supplier_invoice_items enable row level security;
alter table supplier_invoice_allocations enable row level security;

drop policy if exists "supplier_invoices_select" on supplier_invoices;
create policy "supplier_invoices_select" on supplier_invoices for select using (supplier_invoices_readable());
drop policy if exists "supplier_invoice_files_select" on supplier_invoice_files;
create policy "supplier_invoice_files_select" on supplier_invoice_files for select using (supplier_invoices_readable());
drop policy if exists "supplier_invoice_items_select" on supplier_invoice_items;
create policy "supplier_invoice_items_select" on supplier_invoice_items for select using (supplier_invoices_readable());
drop policy if exists "supplier_invoice_allocations_select" on supplier_invoice_allocations;
create policy "supplier_invoice_allocations_select" on supplier_invoice_allocations for select using (supplier_invoices_readable());

-- zápis jen servisní role (aplikace); přes REST nikdo. Zaplaceno / nezaplaceno přes REST nikdo nečte (ani super admin —
-- aplikace čte servisním klíčem).
revoke all on supplier_invoices, supplier_invoice_files, supplier_invoice_items, supplier_invoice_allocations from anon, authenticated;
grant select on supplier_invoice_files, supplier_invoice_items, supplier_invoice_allocations to authenticated;
grant select (id, supplier_id, supplier_name, supplier_ico, supplier_dic, supplier_address, supplier_bank_account, supplier_email,
              supplier_phone, number, variable_symbol, issue_date, taxable_date, due_date, currency, exchange_rate, total_net,
              total_vat, total_gross, status, source, email_id, duplicate_of_id, is_credit_note, is_proforma, final_po_ids, note, uploaded_by,
              updated_by, processed_by, processed_at, created_at, updated_at, number_norm, supplier_key)
  on supplier_invoices to authenticated;
grant all on supplier_invoices, supplier_invoice_files, supplier_invoice_items, supplier_invoice_allocations to service_role;

do $$
declare f text;
begin
  foreach f in array array['supplier_invoice_set_allocations(uuid, jsonb)', 'supplier_invoice_set_items(uuid, jsonb)', 'supplier_invoice_check(uuid)',
                           'supplier_invoice_refresh(uuid)', 'job_invoice_allocations(uuid)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ── 9) Úložiště: privátní bucket faktur — čte jen kdo smí faktury (REST), zapisuje jen aplikace ─
insert into storage.buckets (id, name, public) values ('supplier-invoices', 'supplier-invoices', false)
on conflict (id) do nothing;
drop policy if exists "supplier_invoices_bucket_read" on storage.objects;
create policy "supplier_invoices_bucket_read" on storage.objects for select using (
  bucket_id = 'supplier-invoices' and auth.role() = 'authenticated' and public.supplier_invoices_readable());
