-- ============================================================
-- 0022 — Podrobný postup výroby, poznámky, dodací list, splatnost
--
--  * job_operations — výrobní operace zakázky v pořadí (soustružení,
--    frézování, tepelné zpracování, broušení, drát, povrchová úprava…),
--    kdo ji dělá (dodavatel / u nás), stav, termíny, poznámka.
--    Zjednodušeně jedna operace „Kompletní dodávka" od firmy A.
--  * orders.production_* — kde se zakázka právě nachází (pro řádek knihy
--    a filtry), udržuje trigger.
--  * Domluvy se zákazníkem (orders.customer_note), potvrzený dodací list,
--    splatnost faktury; zaplaceno → zakázka Dokončeno.
-- ============================================================

-- ── 1) Výrobní operace ──────────────────────────────────────
create table if not exists job_operations (
  id                 uuid primary key default uuid_generate_v4(),
  job_id             uuid not null references orders(id) on delete cascade,
  position           int not null default 0,
  kind               text not null default 'jine',
  title              text,                      -- vlastní název (např. „Soustružení — 2. upnutí")
  supplier_id        uuid references suppliers(id) on delete set null,  -- kooperace; null = u nás
  supplier_name      text,                      -- firma, která ještě není v adresáři
  in_house           boolean not null default false,
  status             text not null default 'ceka',
  planned_start      date,
  planned_end        date,                      -- termín operace
  started_at         timestamptz,
  finished_at        timestamptz,
  note               text,
  purchase_order_id  uuid references purchase_orders(id) on delete set null,
  created_by         uuid references profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_job_operations_job on job_operations(job_id, position);
create index if not exists idx_job_operations_supplier on job_operations(supplier_id);

do $$ begin
  alter table job_operations add constraint job_operations_kind_check check (kind in (
    'soustruzeni', 'frezovani', 'brouseni', 'tepelne_zpracovani', 'povrchova_uprava',
    'dratove_rezani', 'elektroeroze', 'vrtani', 'svarovani', 'plech', 'montaz',
    'kontrola', 'doprava', 'kompletni_dodavka', 'jine'
  ));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_operations add constraint job_operations_status_check
    check (status in ('ceka', 'probiha', 'hotovo', 'problem', 'preskoceno'));
exception when duplicate_object then null; end $$;

drop trigger if exists trg_job_operations_updated on job_operations;
create trigger trg_job_operations_updated before update on job_operations
  for each row execute function set_updated_at();

-- Časová razítka operace podle stavu
create or replace function job_operations_status_times()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('probiha', 'hotovo', 'problem') and new.started_at is null then new.started_at := now(); end if;
    if new.status = 'hotovo' and new.finished_at is null then new.finished_at := now(); end if;
    if new.status in ('ceka', 'probiha') then new.finished_at := null; end if;
    if new.status = 'ceka' then new.started_at := null; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_job_operations_times on job_operations;
create trigger trg_job_operations_times before insert or update on job_operations
  for each row execute function job_operations_status_times();

-- ── 2) Zakázka: kde se právě nachází + konec toku ───────────
alter table orders add column if not exists production_step      text;  -- druh aktuální operace
alter table orders add column if not exists production_location  text;  -- firma / „U nás"
alter table orders add column if not exists production_done      int not null default 0;
alter table orders add column if not exists production_total     int not null default 0;
alter table orders add column if not exists production_problem   boolean not null default false;
alter table orders add column if not exists customer_note        text;  -- domluvy se zákazníkem (co není v objednávce)
alter table orders add column if not exists delivery_note_confirmed_at date;  -- potvrzený dodací list vrácen
alter table orders add column if not exists invoice_date         date;
alter table orders add column if not exists invoice_due_date     date;  -- splatnost faktury
create index if not exists idx_orders_production_step on orders(production_step);
create index if not exists idx_orders_invoice_due on orders(invoice_due_date) where paid_at is null;

/**
 * Souhrn výroby zakázky: aktuální operace = první probíhající (nebo problémová),
 * jinak první čekající po poslední hotové. Když výroba začne a zakázka je
 * objednaná/potvrzená, přepne se do „Ve výrobě" (jen dopředu).
 */
create or replace function recompute_job_production(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur     job_operations%rowtype;
  v_total   int;
  v_done    int;
  v_problem boolean;
  v_started boolean;
  v_loc     text;
begin
  select count(*) filter (where status <> 'preskoceno'),
         count(*) filter (where status = 'hotovo'),
         bool_or(status = 'problem'),
         bool_or(status in ('probiha', 'hotovo', 'problem'))
    into v_total, v_done, v_problem, v_started
  from job_operations where job_id = p_job;

  select * into v_cur from job_operations
  where job_id = p_job and status in ('probiha', 'problem')
  order by position, created_at limit 1;
  if v_cur.id is null then
    select * into v_cur from job_operations
    where job_id = p_job and status = 'ceka'
    order by position, created_at limit 1;
  end if;

  if v_cur.id is not null then
    v_loc := case
      when v_cur.in_house then 'U nás'
      when v_cur.supplier_id is not null then (select name from suppliers where id = v_cur.supplier_id)
      else coalesce(nullif(v_cur.supplier_name, ''), null)
    end;
  end if;

  update orders set
    production_step = case when v_cur.id is null then (case when v_total > 0 and v_done = v_total then 'hotovo' else null end) else v_cur.kind end,
    production_location = v_loc,
    production_done = coalesce(v_done, 0),
    production_total = coalesce(v_total, 0),
    production_problem = coalesce(v_problem, false),
    status = case when coalesce(v_started, false) and status in ('objednavka', 'potvrzeno') then 've_vyrobe'::job_stage else status end
  where id = p_job;
end $$;

create or replace function trg_job_operations_production()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_job_production(old.job_id);
  else
    perform recompute_job_production(new.job_id);
    if tg_op = 'UPDATE' and old.job_id is distinct from new.job_id then
      perform recompute_job_production(old.job_id);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_job_operations_production on job_operations;
create trigger trg_job_operations_production
  after insert or update or delete on job_operations
  for each row execute function trg_job_operations_production();

-- Změna názvu dodavatele → přepočet míst u jeho operací
create or replace function trg_suppliers_production_name()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.name is distinct from old.name then
    for r in select distinct job_id from job_operations where supplier_id = new.id loop
      perform recompute_job_production(r.job_id);
    end loop;
  end if;
  return null;
end $$;

drop trigger if exists trg_suppliers_production_name on suppliers;
create trigger trg_suppliers_production_name
  after update of name on suppliers
  for each row execute function trg_suppliers_production_name();

-- ── 3) Konec toku: faktura → splatnost, zaplaceno → Dokončeno ──
create or replace function orders_stage_change()
returns trigger language plpgsql as $$
declare
  v_terms int;
begin
  -- zaplaceno (inkaso) u vyfakturované zakázky → hotovo
  if tg_op = 'UPDATE' and new.paid_at is not null and old.paid_at is null
     and new.status = 'fakturovano' and old.status = 'fakturovano' then
    new.status := 'dokonceno';
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.stage_changed_at := now();
    if new.status = 'potvrzeno' and new.confirmed_at is null then new.confirmed_at := now(); end if;
    if new.status = 've_vyrobe' and new.production_started_at is null then new.production_started_at := now(); end if;
    if new.status = 'dodano_k_nam' and new.received_at is null then new.received_at := now(); end if;
    if new.status = 'dodano_zakaznikovi' and new.delivered_at is null then new.delivered_at := now(); end if;
    if new.status = 'fakturovano' and new.invoiced_at is null then new.invoiced_at := now(); end if;
    if new.status = 'dokonceno' and new.paid_at is null then new.paid_at := current_date; end if;
  end if;

  -- datum faktury a splatnost (platební podmínky zákazníka, jinak 14 dní)
  if new.status in ('fakturovano', 'dokonceno') and new.invoice_date is null then
    new.invoice_date := coalesce(new.invoiced_at::date, current_date);
  end if;
  if new.invoice_date is not null and new.invoice_due_date is null then
    select payment_terms_days into v_terms from customers where id = new.customer_id;
    new.invoice_due_date := new.invoice_date + coalesce(v_terms, 14);
  end if;
  return new;
end $$;

-- Dopočet pro existující zakázky
update orders set invoice_date = invoiced_at::date where invoice_date is null and invoiced_at is not null;

-- ── 4) RLS — výrobní postup vidí všichni aktivní ────────────
alter table job_operations enable row level security;
do $$ begin
  create policy "job_operations_select" on job_operations for select using (is_active_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "job_operations_write" on job_operations for all using (is_active_user()) with check (is_active_user());
exception when duplicate_object then null; end $$;
