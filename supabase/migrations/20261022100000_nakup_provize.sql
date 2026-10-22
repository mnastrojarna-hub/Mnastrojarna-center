-- ============================================================
-- 0020 — Nákupní strana zakázky + automatická provize ze zisku
--
--  * supplier_quotes — nabídky dodavatelů k zakázce (víc), jedna vítězná
--  * purchase_orders — naše objednávky vydané dodavatelům (OV-2026-001)
--  * provize: zisk = objednávka zákazníka (orders.value) − nákup
--    (objednávky vydané; bez nich odhad orders.purchase_cost),
--    provize dle smlouvy obchodníka (commission_rules, jinak sazba
--    z profilu, základem je zisk). Přepočet běží v DB triggery, takže
--    sedí vždy — ať se změna udělá z aplikace, AI nebo importem.
-- ============================================================

-- ── 1) Nabídky dodavatelů ───────────────────────────────────
create table if not exists supplier_quotes (
  id              uuid primary key default uuid_generate_v4(),
  job_id          uuid not null references orders(id) on delete cascade,
  supplier_id     uuid references suppliers(id) on delete set null,
  supplier_name   text,                     -- dodavatel ještě není v adresáři
  number          text,                     -- číslo nabídky dodavatele
  quote_date      date,
  valid_until     date,
  lead_time_days  int,
  delivery_date   date,                     -- termín dodání dle nabídky
  currency        text not null default 'CZK',
  total           numeric(14,2),            -- celkem bez DPH
  selected        boolean not null default false,  -- vítězná nabídka
  note            text,
  file_id         uuid references job_files(id) on delete set null,
  source          text not null default 'manual',
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_supplier_quotes_job on supplier_quotes(job_id);
-- Jen jedna vítězná nabídka na zakázku
create unique index if not exists uq_supplier_quotes_selected on supplier_quotes(job_id) where selected;
do $$ begin
  alter table supplier_quotes add constraint supplier_quotes_source_check
    check (source in ('manual', 'foto', 'email', 'ai'));
exception when duplicate_object then null; end $$;
drop trigger if exists trg_supplier_quotes_updated on supplier_quotes;
create trigger trg_supplier_quotes_updated before update on supplier_quotes
  for each row execute function set_updated_at();

create table if not exists supplier_quote_items (
  id                 uuid primary key default uuid_generate_v4(),
  supplier_quote_id  uuid not null references supplier_quotes(id) on delete cascade,
  position           int not null default 0,
  drawing_number     text,
  name               text,
  material           text,
  quantity           numeric(12,3) not null default 1,
  unit               text not null default 'ks',
  unit_price         numeric(14,2),
  note               text
);
create index if not exists idx_supplier_quote_items_quote on supplier_quote_items(supplier_quote_id);

-- ── 2) Objednávky vydané (naše objednávka dodavateli) ───────
do $$ begin
  create type purchase_order_status as enum ('navrh', 'vystavena', 'odeslana', 'potvrzena', 'dodana', 'zrusena');
exception when duplicate_object then null; end $$;

create table if not exists purchase_orders (
  id                        uuid primary key default uuid_generate_v4(),
  job_id                    uuid not null references orders(id) on delete cascade,
  supplier_id               uuid references suppliers(id) on delete set null,
  supplier_quote_id         uuid references supplier_quotes(id) on delete set null,
  number                    text unique,                       -- OV-2026-001
  status                    purchase_order_status not null default 'navrh',
  order_date                date not null default current_date,
  required_date             date,                              -- požadovaný termín dodání od dodavatele
  confirmed_date            date,                              -- termín potvrzený dodavatelem
  currency                  text not null default 'CZK',
  total                     numeric(14,2) not null default 0,  -- celkem bez DPH
  delivery_terms            text,
  payment_terms             text,
  delivery_address          text,
  note                      text,
  supplier_reference        text,                              -- číslo potvrzení / zakázky u dodavatele
  file_id                   uuid references job_files(id) on delete set null,
  created_by                uuid references profiles(id) on delete set null,
  sent_at                   timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create index if not exists idx_purchase_orders_job on purchase_orders(job_id);
create index if not exists idx_purchase_orders_supplier on purchase_orders(supplier_id);
drop trigger if exists trg_purchase_orders_updated on purchase_orders;
create trigger trg_purchase_orders_updated before update on purchase_orders
  for each row execute function set_updated_at();

create table if not exists purchase_order_items (
  id                 uuid primary key default uuid_generate_v4(),
  purchase_order_id  uuid not null references purchase_orders(id) on delete cascade,
  position           int not null default 0,
  drawing_number     text,
  name               text,
  material           text,
  quantity           numeric(12,3) not null default 1,
  unit               text not null default 'ks',
  unit_price         numeric(14,2),
  note               text
);
create index if not exists idx_purchase_order_items_po on purchase_order_items(purchase_order_id);

create or replace function next_purchase_order_number()
returns text language sql as $$
  select next_doc_number('OV');
$$;

-- Druh dokumentu zakázky pro objednávku vydanou
alter type job_file_kind add value if not exists 'objednavka_vydana';

-- ── 3) Provize: rozšíření záznamů ───────────────────────────
alter table commission_entries add column if not exists cost       numeric(14,2) not null default 0;
alter table commission_entries add column if not exists profit     numeric(14,2) not null default 0;
alter table commission_entries add column if not exists base       text not null default 'margin';
alter table commission_entries add column if not exists status     text not null default 'predbezna';
alter table commission_entries add column if not exists updated_at timestamptz not null default now();
-- false = nákupní cena zatím neznámá (žádná objednávka vydaná ani odhad) → provize se nepočítá
alter table commission_entries add column if not exists cost_known boolean not null default true;
-- margin = podíl zisku na obratu (0.2537), dříve se ořezával na 2 desetinná místa
alter table commission_entries alter column margin type numeric(9,4);
create unique index if not exists uq_commission_entries_order on commission_entries(order_id) where order_id is not null;
do $$ begin
  alter table commission_entries add constraint commission_entries_status_check
    check (status in ('predbezna', 'k_vyplate', 'vyplaceno'));
exception when duplicate_object then null; end $$;

/**
 * Přepočet provize jedné zakázky.
 *  obrat  = hodnota objednávky zákazníka (orders.value, bez DPH)
 *  náklad = Σ objednávek vydaných (bez zrušených), bez nich odhad orders.purchase_cost
 *  zisk   = obrat − náklad
 *  provize = zisk × sazba (pravidlo „margin", výchozí) nebo obrat × sazba („revenue")
 * Sazba: poslední platné commission_rules obchodníka, jinak profiles.commission_rate.
 * Bez provize: poptávky/nabídky, nerealizované a zrušené zakázky, bez obchodníka či hodnoty.
 */
create or replace function recompute_job_commission(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  j          orders%rowtype;
  v_count    int;
  v_po_total numeric;
  v_cost     numeric;
  v_profit   numeric;
  v_rate     numeric;
  v_base     text;
  v_comm     numeric;
  v_period   date;
  v_status   text;
  v_known    boolean;
begin
  select * into j from orders where id = p_job;
  if not found then return; end if;

  if j.owner_id is null or coalesce(j.value, 0) <= 0
     or j.status in ('poptavka', 'naceneni', 'nabidka', 'nerealizovano', 'zruseno') then
    -- vyplacenou provizi nikdy nemažeme
    delete from commission_entries where order_id = p_job and status <> 'vyplaceno';
    return;
  end if;

  select count(*), coalesce(sum(total), 0) into v_count, v_po_total
  from purchase_orders where job_id = p_job and status <> 'zrusena';
  v_known := v_count > 0 or j.purchase_cost is not null;
  v_cost := case when v_count > 0 then v_po_total else coalesce(j.purchase_cost, 0) end;
  v_profit := case when v_known then j.value - v_cost else 0 end;

  select r.rate, r.base into v_rate, v_base
  from commission_rules r
  where r.owner_id = j.owner_id and r.valid_from <= coalesce(j.order_date, current_date)
  order by r.valid_from desc, r.created_at desc
  limit 1;
  if v_rate is null then
    select p.commission_rate into v_rate from profiles p where p.id = j.owner_id;
    v_base := 'margin';
  end if;
  v_rate := coalesce(v_rate, 0);
  v_base := coalesce(v_base, 'margin');

  -- bez známé nákupní ceny nelze spočítat zisk → provize ze zisku zatím 0
  v_comm := round(case
    when v_base = 'revenue' then j.value * v_rate
    when v_known then greatest(v_profit, 0) * v_rate
    else 0 end, 2);
  v_period := date_trunc('month', coalesce(j.order_date, j.confirmed_at::date, j.created_at::date))::date;
  v_status := case when j.status in ('fakturovano', 'dokonceno') then 'k_vyplate' else 'predbezna' end;

  insert into commission_entries (owner_id, order_id, period, revenue, cost, profit, margin, rate, base, commission, status, cost_known, updated_at)
  values (
    j.owner_id, p_job, v_period, j.value, v_cost, v_profit,
    case when j.value > 0 and v_known then round(v_profit / j.value, 4) else 0 end,
    v_rate, v_base, v_comm, v_status, v_known, now()
  )
  on conflict (order_id) where order_id is not null do update set
    owner_id   = excluded.owner_id,
    period     = excluded.period,
    revenue    = excluded.revenue,
    cost       = excluded.cost,
    profit     = excluded.profit,
    margin     = excluded.margin,
    rate       = excluded.rate,
    base       = excluded.base,
    commission = excluded.commission,
    status     = case when commission_entries.status = 'vyplaceno' then 'vyplaceno' else excluded.status end,
    cost_known = excluded.cost_known,
    updated_at = now()
  where commission_entries.status <> 'vyplaceno';
end $$;

create or replace function trg_orders_commission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_job_commission(new.id);
  return null;
end $$;

drop trigger if exists trg_orders_commission on orders;
create trigger trg_orders_commission
  after insert or update of value, purchase_cost, owner_id, status, order_date on orders
  for each row execute function trg_orders_commission();

create or replace function trg_purchase_orders_commission()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_job_commission(old.job_id);
  else
    perform recompute_job_commission(new.job_id);
    if tg_op = 'UPDATE' and old.job_id is distinct from new.job_id then
      perform recompute_job_commission(old.job_id);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_purchase_orders_commission on purchase_orders;
create trigger trg_purchase_orders_commission
  after insert or update or delete on purchase_orders
  for each row execute function trg_purchase_orders_commission();

-- Změna smlouvy / sazby obchodníka → přepočet jeho běžících zakázek
create or replace function recompute_owner_commissions(p_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if p_owner is null then return; end if;
  for r in select id from orders where owner_id = p_owner loop
    perform recompute_job_commission(r.id);
  end loop;
end $$;

create or replace function trg_commission_rules_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_owner_commissions(old.owner_id);
  else
    perform recompute_owner_commissions(new.owner_id);
  end if;
  return null;
end $$;

drop trigger if exists trg_commission_rules_recompute on commission_rules;
create trigger trg_commission_rules_recompute
  after insert or update or delete on commission_rules
  for each row execute function trg_commission_rules_recompute();

create or replace function trg_profiles_commission_rate()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.commission_rate is distinct from old.commission_rate then
    perform recompute_owner_commissions(new.id);
  end if;
  return null;
end $$;

drop trigger if exists trg_profiles_commission_rate on profiles;
create trigger trg_profiles_commission_rate
  after update of commission_rate on profiles
  for each row execute function trg_profiles_commission_rate();

-- Dopočet pro už existující zakázky
do $$
declare r record;
begin
  for r in select id from orders loop
    perform recompute_job_commission(r.id);
  end loop;
end $$;

-- ── 4) RLS — nákupní ceny vidí jen obchodník a admin ────────
alter table supplier_quotes enable row level security;
alter table supplier_quote_items enable row level security;
alter table purchase_orders enable row level security;
alter table purchase_order_items enable row level security;

create policy "supplier_quotes_select" on supplier_quotes for select using (is_obchodnik_or_admin());
create policy "supplier_quotes_write" on supplier_quotes for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
create policy "supplier_quote_items_all" on supplier_quote_items for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
create policy "purchase_orders_select" on purchase_orders for select using (is_obchodnik_or_admin());
create policy "purchase_orders_write" on purchase_orders for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
create policy "purchase_order_items_all" on purchase_order_items for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
