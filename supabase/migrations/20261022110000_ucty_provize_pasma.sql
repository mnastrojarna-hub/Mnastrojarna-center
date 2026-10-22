-- ============================================================
-- 0021 — Inkaso zakázek, pásmová měsíční provize ze zisku,
--        měsíční vyúčtování provizí, vynucená změna hesla,
--        účty Vít Volný (obchodní zástupce) a Dominik Šponer (technolog)
--
-- Dodatek ke smlouvě o obchodním zastoupení (Vít Volný):
--   * sleduje se INKASOVANÝ obrat v kalendářním měsíci (jen jeho zakázky),
--   * zisk = prodejní cena − nákupní cena,
--   * provize ze zisku pásmově podle měsíčního inkasa:
--       do 500 000 Kč 0 %, 500 001–1 000 000 Kč 10 %,
--       1 000 001–2 000 000 Kč 15 %, nad 2 000 000 Kč 20 %
--     (každé pásmo obratu nese svůj podíl zisku — viz modelové příklady),
--   * splatnost do 20 dnů po skončení kalendářního měsíce.
-- Obrat i zisk se počítají bez DPH (hodnoty zakázek jsou bez DPH).
-- ============================================================

-- ── 1) Inkaso zakázky ───────────────────────────────────────
alter table orders add column if not exists paid_at     date;           -- datum inkasa (úhrady zákazníkem)
alter table orders add column if not exists paid_amount numeric(14,2);  -- inkasováno bez DPH (prázdné = hodnota zakázky)
create index if not exists idx_orders_paid on orders(owner_id, paid_at);

-- Stav „Dokončeno" = zaplaceno → doplní datum inkasa, pokud chybí
create or replace function orders_stage_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.stage_changed_at := now();
    if new.status = 'potvrzeno' and new.confirmed_at is null then new.confirmed_at := now(); end if;
    if new.status = 've_vyrobe' and new.production_started_at is null then new.production_started_at := now(); end if;
    if new.status = 'dodano_k_nam' and new.received_at is null then new.received_at := now(); end if;
    if new.status = 'dodano_zakaznikovi' and new.delivered_at is null then new.delivered_at := now(); end if;
    if new.status = 'fakturovano' and new.invoiced_at is null then new.invoiced_at := now(); end if;
    if new.status = 'dokonceno' and new.paid_at is null then new.paid_at := current_date; end if;
  end if;
  return new;
end $$;

-- ── 2) Vynucená změna hesla po prvním přihlášení ────────────
alter table profiles add column if not exists password_change_required boolean not null default false;

-- ── 3) Smlouvy obchodníků: pásma, základ, sledované období ──
alter table commission_rules add column if not exists name        text;
alter table commission_rules add column if not exists tiers       jsonb;                         -- [{from, to|null, rate}]
alter table commission_rules add column if not exists basis       text not null default 'ordered';  -- ordered | collected
alter table commission_rules add column if not exists payout_days int  not null default 20;
do $$ begin
  alter table commission_rules add constraint commission_rules_base_check
    check (base in ('margin', 'revenue', 'margin_tiered'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table commission_rules add constraint commission_rules_basis_check
    check (basis in ('ordered', 'collected'));
exception when duplicate_object then null; end $$;

alter table commission_entries add column if not exists collected            boolean not null default false;
alter table commission_entries add column if not exists estimated_commission numeric(14,2);

-- ── 4) Měsíční vyúčtování provizí ───────────────────────────
create table if not exists commission_statements (
  id                uuid primary key default uuid_generate_v4(),
  owner_id          uuid not null references profiles(id) on delete cascade,
  period            date not null,                 -- první den měsíce
  rule_name         text,
  basis             text not null default 'ordered',
  revenue           numeric(14,2) not null default 0,  -- inkasovaný (u basis ordered objednaný) obrat
  cost              numeric(14,2) not null default 0,
  profit            numeric(14,2) not null default 0,
  commission        numeric(14,2) not null default 0,
  bands             jsonb not null default '[]',   -- rozpad do pásem
  jobs_count        int not null default 0,
  unknown_cost_jobs int not null default 0,        -- zakázky bez známé nákupní ceny
  due_date          date,                          -- splatnost provize
  status            text not null default 'otevrena', -- otevrena | k_vyplate | vyplaceno
  paid_at           date,
  updated_at        timestamptz not null default now(),
  unique (owner_id, period)
);
do $$ begin
  alter table commission_statements add constraint commission_statements_status_check
    check (status in ('otevrena', 'k_vyplate', 'vyplaceno'));
exception when duplicate_object then null; end $$;

alter table commission_statements enable row level security;
do $$ begin
  create policy "commission_statements_select" on commission_statements
    for select using (is_super_admin() or owner_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "commission_statements_admin" on commission_statements
    for all using (is_super_admin()) with check (is_super_admin());
exception when duplicate_object then null; end $$;

-- ── 5) Výpočty ──────────────────────────────────────────────

/** Rozpad provize do pásem: každé pásmo obratu nese poměrnou část zisku. */
create or replace function tiered_commission_bands(p_revenue numeric, p_profit numeric, p_tiers jsonb)
returns jsonb language plpgsql immutable as $$
declare
  t        jsonb;
  v_from   numeric;
  v_to     numeric;
  v_rate   numeric;
  v_slice  numeric;
  v_ratio  numeric := case when coalesce(p_revenue, 0) > 0 then greatest(coalesce(p_profit, 0), 0) / p_revenue else 0 end;
  v_out    jsonb := '[]'::jsonb;
begin
  if p_tiers is null or jsonb_typeof(p_tiers) <> 'array' then return v_out; end if;
  for t in select value from jsonb_array_elements(p_tiers) order by (value->>'from')::numeric loop
    v_from := coalesce((t->>'from')::numeric, 0);
    v_to := nullif(t->>'to', '')::numeric;
    v_rate := coalesce((t->>'rate')::numeric, 0);
    v_slice := greatest(0, least(coalesce(p_revenue, 0), coalesce(v_to, coalesce(p_revenue, 0))) - v_from);
    v_out := v_out || jsonb_build_object(
      'from', v_from, 'to', v_to, 'rate', v_rate,
      'revenue', round(v_slice, 2),
      'profit', round(v_slice * v_ratio, 2),
      'commission', round(v_slice * v_ratio * v_rate, 2)
    );
  end loop;
  return v_out;
end $$;

create or replace function tiered_commission(p_revenue numeric, p_profit numeric, p_tiers jsonb)
returns numeric language sql immutable as $$
  select coalesce(sum((b->>'commission')::numeric), 0)
  from jsonb_array_elements(tiered_commission_bands(p_revenue, p_profit, p_tiers)) b;
$$;

/** Platná smlouva obchodníka k datu (nejnovější valid_from ≤ datum). */
create or replace function commission_rule_for(p_owner uuid, p_at date)
returns commission_rules language sql stable security definer set search_path = public as $$
  select r.* from commission_rules r
  where r.owner_id = p_owner and r.valid_from <= coalesce(p_at, current_date)
  order by r.valid_from desc, r.created_at desc
  limit 1;
$$;

/** Náklad zakázky: Σ objednávek vydaných (bez zrušených), bez nich odhad orders.purchase_cost. */
create or replace function job_cost(p_job uuid, out cost numeric, out known boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  v_count int;
  v_total numeric;
  v_planned numeric;
begin
  select count(*), coalesce(sum(total), 0) into v_count, v_total
  from purchase_orders where job_id = p_job and status <> 'zrusena';
  select purchase_cost into v_planned from orders where id = p_job;
  known := v_count > 0 or v_planned is not null;
  cost := case when v_count > 0 then v_total else coalesce(v_planned, 0) end;
end $$;

/**
 * Měsíční vyúčtování obchodníka. U pásmové smlouvy (margin_tiered + collected)
 * spočítá provizi z měsíčního inkasa a rozpočítá ji na zakázky podle podílu
 * na zisku; jinak sečte provize zakázek daného měsíce.
 */
create or replace function recompute_owner_month(p_owner uuid, p_period date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_month   date := date_trunc('month', p_period)::date;
  v_rule    commission_rules;
  v_rev     numeric := 0;
  v_cost    numeric := 0;
  v_profit  numeric := 0;
  v_pos     numeric := 0;
  v_comm    numeric := 0;
  v_bands   jsonb := '[]'::jsonb;
  v_count   int := 0;
  v_unknown int := 0;
  v_due     date;
  v_status  text;
begin
  if p_owner is null or p_period is null then return; end if;
  v_rule := commission_rule_for(p_owner, (v_month + interval '1 month - 1 day')::date);
  v_due := (v_month + interval '1 month - 1 day')::date + coalesce(v_rule.payout_days, 20);

  if v_rule.base = 'margin_tiered' and v_rule.basis = 'collected' then
    select coalesce(sum(revenue), 0), coalesce(sum(cost), 0),
           coalesce(sum(case when cost_known then profit else 0 end), 0),
           coalesce(sum(case when cost_known then greatest(profit, 0) else 0 end), 0),
           count(*), count(*) filter (where not cost_known)
      into v_rev, v_cost, v_profit, v_pos, v_count, v_unknown
    from commission_entries
    where owner_id = p_owner and period = v_month and collected;

    v_bands := tiered_commission_bands(v_rev, v_profit, v_rule.tiers);
    v_comm := tiered_commission(v_rev, v_profit, v_rule.tiers);

    -- rozpočet na zakázky dle podílu na (kladném) zisku
    update commission_entries ce set
      commission = case when v_pos > 0 and ce.cost_known then round(v_comm * greatest(ce.profit, 0) / v_pos, 2) else 0 end,
      rate = case when ce.revenue > 0 and ce.profit > 0 and v_pos > 0
                  then round((v_comm * greatest(ce.profit, 0) / v_pos) / ce.profit, 4) else 0 end,
      updated_at = now()
    where ce.owner_id = p_owner and ce.period = v_month and ce.collected and ce.status <> 'vyplaceno';

    -- haléřový zbytek po zaokrouhlení připiš zakázce s největším ziskem (součet = provize měsíce)
    update commission_entries ce set
      commission = ce.commission + (v_comm - (
        select coalesce(sum(x.commission), 0) from commission_entries x
        where x.owner_id = p_owner and x.period = v_month and x.collected))
    where ce.id = (
      select x.id from commission_entries x
      where x.owner_id = p_owner and x.period = v_month and x.collected and x.cost_known and x.status <> 'vyplaceno'
      order by x.profit desc, x.id limit 1
    ) and v_pos > 0;
  else
    select coalesce(sum(revenue), 0), coalesce(sum(cost), 0), coalesce(sum(profit), 0),
           coalesce(sum(commission), 0), count(*), count(*) filter (where not cost_known)
      into v_rev, v_cost, v_profit, v_comm, v_count, v_unknown
    from commission_entries
    where owner_id = p_owner and period = v_month;
  end if;

  if v_count = 0 then
    delete from commission_statements where owner_id = p_owner and period = v_month and status = 'otevrena';
    return;
  end if;

  v_status := case when current_date > (v_month + interval '1 month - 1 day')::date then 'k_vyplate' else 'otevrena' end;

  insert into commission_statements (owner_id, period, rule_name, basis, revenue, cost, profit, commission, bands,
                                     jobs_count, unknown_cost_jobs, due_date, status, updated_at)
  values (p_owner, v_month, v_rule.name, coalesce(v_rule.basis, 'ordered'), v_rev, v_cost, v_profit, v_comm, v_bands,
          v_count, v_unknown, v_due, v_status, now())
  on conflict (owner_id, period) do update set
    rule_name = excluded.rule_name, basis = excluded.basis, revenue = excluded.revenue, cost = excluded.cost,
    profit = excluded.profit, commission = excluded.commission, bands = excluded.bands,
    jobs_count = excluded.jobs_count, unknown_cost_jobs = excluded.unknown_cost_jobs,
    due_date = excluded.due_date,
    status = case when commission_statements.status = 'vyplaceno' then 'vyplaceno' else excluded.status end,
    updated_at = now()
  where commission_statements.status <> 'vyplaceno';
end $$;

/**
 * Provize jedné zakázky (volají triggery). Pásmová smlouva: dokud zakázka
 * není inkasovaná, je provize předběžná (odhad dle aktuálního pásma); po inkasu
 * se započítá do měsíce inkasa. Jiné smlouvy: provize zakázky dle objednávky.
 */
create or replace function recompute_job_commission(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  j          orders%rowtype;
  v_old      commission_entries%rowtype;
  v_rule     commission_rules;
  v_cost     numeric;
  v_known    boolean;
  v_rev      numeric;
  v_profit   numeric;
  v_rate     numeric;
  v_base     text;
  v_comm     numeric;
  v_est      numeric;
  v_period   date;
  v_status   text;
  v_collected boolean := false;
  v_mtd      numeric;
  v_band     jsonb;
begin
  select * into v_old from commission_entries where order_id = p_job;

  select * into j from orders where id = p_job;
  if not found or j.owner_id is null or coalesce(j.value, 0) <= 0
     or j.status in ('poptavka', 'naceneni', 'nabidka', 'nerealizovano', 'zruseno') then
    delete from commission_entries where order_id = p_job and status <> 'vyplaceno';
    if v_old.id is not null then perform recompute_owner_month(v_old.owner_id, v_old.period); end if;
    return;
  end if;

  select c.cost, c.known into v_cost, v_known from job_cost(p_job) c;
  v_rev := coalesce(j.paid_amount, j.value);
  v_profit := case when v_known then v_rev - v_cost else 0 end;
  v_rule := commission_rule_for(j.owner_id, coalesce(j.paid_at, j.order_date, current_date));

  if v_rule.base = 'margin_tiered' and v_rule.basis = 'collected' then
    v_base := 'margin_tiered';
    v_collected := j.paid_at is not null;
    v_period := date_trunc('month', coalesce(j.paid_at, current_date))::date;
    v_comm := 0;   -- skutečnou provizi rozpočítá recompute_owner_month
    v_rate := 0;
    v_status := case when v_collected then 'k_vyplate' else 'predbezna' end;
    -- odhad pro neinkasovanou zakázku: pásmo, do kterého by padla při inkasu teď
    if not v_collected and v_known then
      select coalesce(sum(revenue), 0) into v_mtd from commission_entries
      where owner_id = j.owner_id and period = v_period and collected;
      select value into v_band from jsonb_array_elements(v_rule.tiers)
      where (value->>'from')::numeric <= v_mtd + v_rev
      order by (value->>'from')::numeric desc limit 1;
      v_est := round(greatest(v_profit, 0) * coalesce((v_band->>'rate')::numeric, 0), 2);
    end if;
  else
    v_rate := coalesce(v_rule.rate, (select p.commission_rate from profiles p where p.id = j.owner_id), 0);
    v_base := coalesce(v_rule.base, 'margin');
    v_comm := round(case
      when v_base = 'revenue' then v_rev * v_rate
      when v_known then greatest(v_profit, 0) * v_rate
      else 0 end, 2);
    v_period := date_trunc('month', coalesce(j.order_date, j.confirmed_at::date, j.created_at::date))::date;
    v_status := case when j.status in ('fakturovano', 'dokonceno') then 'k_vyplate' else 'predbezna' end;
    v_collected := j.paid_at is not null;
  end if;

  insert into commission_entries (owner_id, order_id, period, revenue, cost, profit, margin, rate, base, commission,
                                  estimated_commission, status, cost_known, collected, updated_at)
  values (
    j.owner_id, p_job, v_period, v_rev, v_cost, v_profit,
    case when v_rev > 0 and v_known then round(v_profit / v_rev, 4) else 0 end,
    v_rate, v_base, v_comm, v_est, v_status, v_known, v_collected, now()
  )
  on conflict (order_id) where order_id is not null do update set
    owner_id = excluded.owner_id, period = excluded.period, revenue = excluded.revenue, cost = excluded.cost,
    profit = excluded.profit, margin = excluded.margin, rate = excluded.rate, base = excluded.base,
    commission = excluded.commission, estimated_commission = excluded.estimated_commission,
    status = case when commission_entries.status = 'vyplaceno' then 'vyplaceno' else excluded.status end,
    cost_known = excluded.cost_known, collected = excluded.collected, updated_at = now()
  where commission_entries.status <> 'vyplaceno';

  perform recompute_owner_month(j.owner_id, v_period);
  if v_old.id is not null and (v_old.owner_id is distinct from j.owner_id or v_old.period is distinct from v_period) then
    perform recompute_owner_month(v_old.owner_id, v_old.period);
  end if;
end $$;

drop trigger if exists trg_orders_commission on orders;
create trigger trg_orders_commission
  after insert or update of value, purchase_cost, owner_id, status, order_date, paid_at, paid_amount on orders
  for each row execute function trg_orders_commission();

-- ── 6) Účty (počáteční heslo nastavil super admin; změna vynucena) ──
do $$
declare
  u record;
  v_id uuid;
  v_new boolean;
begin
  for u in select * from (values
    ('vit.volny@mnastrojarna.cz',      'Vít Volný',      'obchodnik',   'Obchodní zástupce'),
    ('dominik.sponer@mnastrojarna.cz', 'Dominik Šponer', 'zamestnanec', 'Technolog')
  ) as t(email, full_name, role, position) loop
    select id into v_id from auth.users where lower(email) = u.email;
    v_new := v_id is null;
    if v_new then
      v_id := gen_random_uuid();
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change
      ) values (
        '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', u.email,
        '$2a$10$AifTRGwYVYUuDbg93yl6j.ZdITZdT68siI87OTWZGn78oyNcXwUxm', now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'role', u.role, 'invited', true),
        jsonb_build_object('full_name', u.full_name), now(), now(),
        '', '', '', ''
      );
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (
        gen_random_uuid(), v_id, v_id::text, 'email',
        jsonb_build_object('sub', v_id::text, 'email', u.email, 'email_verified', true),
        now(), now(), now()
      );
    end if;
    -- profil (trigger handle_new_user ho založil; sjednoť roli, funkci a aktivitu)
    insert into profiles (id, email, full_name, role, active, position, password_change_required)
    values (v_id, u.email, u.full_name, u.role::user_role, true, u.position, true)
    on conflict (id) do update set
      full_name = excluded.full_name, role = excluded.role, active = true,
      position = excluded.position,
      -- nový účet má počáteční heslo od admina → při prvním přihlášení si ho změní
      password_change_required = profiles.password_change_required or v_new;
  end loop;
end $$;

-- Smlouva Víta Volného: pásmová měsíční provize ze zisku podle inkasa
insert into commission_rules (owner_id, rate, base, basis, valid_from, name, tiers, payout_days, note)
select p.id, 0, 'margin_tiered', 'collected', date '2000-01-01',
  'Dodatek — pásmová měsíční provize ze zisku',
  '[{"from": 0, "to": 500000, "rate": 0},
    {"from": 500000, "to": 1000000, "rate": 0.10},
    {"from": 1000000, "to": 2000000, "rate": 0.15},
    {"from": 2000000, "to": null, "rate": 0.20}]'::jsonb,
  20,
  'Sleduje se inkasovaný obrat v kalendářním měsíci, zisk = prodejní − nákupní cena, jen obchody sjednané obchodním zástupcem. Splatnost do 20 dnů po skončení měsíce.'
from profiles p
where p.email = 'vit.volny@mnastrojarna.cz'
  and not exists (select 1 from commission_rules r where r.owner_id = p.id and r.base = 'margin_tiered');

-- Přepočet všech zakázek dle nových pravidel
do $$
declare r record;
begin
  for r in select id from orders loop
    perform recompute_job_commission(r.id);
  end loop;
end $$;
