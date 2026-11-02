-- ═══════════════════════════════════════════════════════════════════════════
--  Obchodník zakázky = obchodník zákazníka (2. 11.) — majitel: „obchodník se musí automaticky přiřazovat na
--  základě zákazníka … v kartě zákazníka se bude nově určovat obchodník a obchodník bude vždycky pro všechny
--  zakázky toho zákazníka. U jednotlivé zakázky se to může změnit, ale může to změnit pouze superadmin."
--
--  1) orders.owner_override — obchodník zakázky ručně změněn super adminem (jiný než obchodník zákazníka);
--     taková zakázka se změnou zákazníka / jeho obchodníka nehýbe. Nastavení zpět na obchodníka zákazníka
--     příznak zruší (zakázka zase „jde se zákazníkem").
--  2) trg_orders_owner_sync (BEFORE, po trg_orders_owner_guard — abecedně): pro každou cestu (ručně, pošta,
--     fotka, AI, import):
--       * nová zakázka bez ručního obchodníka → obchodník zákazníka (je-li a je aktivní),
--       * změna zákazníka na zakázce → obchodník nového zákazníka (není-li ruční),
--       * přímá změna obchodníka (super admin; ostatní zastaví orders_owner_guard) → owner_override podle toho,
--         zda se liší od obchodníka zákazníka.
--  3) trg_customers_owner_sync (AFTER UPDATE OF owner_id na customers): nový obchodník zákazníka se propíše do
--     jeho zakázek bez ručního obchodníka — kromě uzavřených / fakturovaných / zaplacených (provize za ně už
--     vznikla a přepočet by ji přesunul jinému obchodníkovi). Odebrání obchodníka zákazníka zakázky nemění.
--  4) Jednorázově (značka owner_from_customer_v1):
--       a) zákazník bez obchodníka, jehož zakázky mají právě jednoho aktivního obchodníka / super admina
--          → ten se stane obchodníkem zákazníka,
--       b) otevřené zakázky se srovnají s obchodníkem zákazníka (stejné vyloučení jako v bodě 3).
--  TS dvojče: src/lib/jobs/owner-from-customer.ts (texty, kontrola v akcích), src/app/actions/jobs.ts.
-- ═══════════════════════════════════════════════════════════════════════════

alter table orders add column if not exists owner_override boolean not null default false;
comment on column orders.owner_override is
  'Obchodník zakázky ručně změněn super adminem (jiný než obchodník zákazníka) — nesleduje obchodníka zákazníka.';

/** Aktivní obchodník zákazníka (null = nemá / neaktivní). */
create or replace function customer_active_owner(p_customer uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select c.owner_id from customers c join profiles p on p.id = c.owner_id
   where c.id = p_customer and p.active
$$;
revoke execute on function customer_active_owner(uuid) from public, anon;
grant execute on function customer_active_owner(uuid) to authenticated, service_role;

/** Zakázka, které se změna obchodníka zákazníka ještě týká (provize za ni nevznikla). */
create or replace function order_follows_customer_owner(p_status text, p_paid date) returns boolean
language sql immutable as $$
  select p_paid is null and coalesce(p_status, '') not in ('dokonceno', 'zruseno', 'nerealizovano', 'fakturovano')
$$;

-- ── 2) Zakázka ───────────────────────────────────────────────
create or replace function orders_owner_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_cust uuid;
begin
  -- propsání ze zákazníka (trg_customers_owner_sync) — hodnotu nastavil on, nic dalšího nepočítat
  if coalesce(current_setting('app.owner_sync', true), '') = '1' then return new; end if;

  if tg_op = 'INSERT' then
    v_cust := customer_active_owner(new.customer_id);
    if v_cust is null then
      new.owner_override := false;
    elsif coalesce(new.owner_override, false) and new.owner_id is distinct from v_cust then
      null; -- super admin výslovně zvolil jiného obchodníka (createJob)
    else
      new.owner_id := v_cust;
      new.owner_override := false;
    end if;
    return new;
  end if;

  -- UPDATE
  if new.owner_id is distinct from old.owner_id then
    -- přímá změna obchodníka (ne-admina zastavil orders_owner_guard) → ruční, pokud se liší od zákazníka
    v_cust := customer_active_owner(new.customer_id);
    new.owner_override := v_cust is not null and new.owner_id is distinct from v_cust;
  elsif new.customer_id is distinct from old.customer_id and not coalesce(new.owner_override, false) then
    v_cust := customer_active_owner(new.customer_id);
    if v_cust is not null then new.owner_id := v_cust; end if;
  end if;
  return new;
end $$;
revoke execute on function orders_owner_sync() from public, anon, authenticated;

drop trigger if exists trg_orders_owner_sync on orders;
create trigger trg_orders_owner_sync before insert or update of owner_id, customer_id on orders
  for each row execute function orders_owner_sync();

-- ── 3) Zákazník → jeho zakázky ───────────────────────────────
create or replace function customers_owner_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.owner_id is null or new.owner_id is not distinct from old.owner_id then return new; end if;
  if not exists (select 1 from profiles p where p.id = new.owner_id and p.active) then return new; end if;
  perform set_config('app.owner_sync', '1', true);
  update orders o
     set owner_id = new.owner_id
   where o.customer_id = new.id
     and not o.owner_override
     and o.owner_id is distinct from new.owner_id
     and order_follows_customer_owner(o.status::text, o.paid_at);
  perform set_config('app.owner_sync', '', true);
  return new;
end $$;
revoke execute on function customers_owner_sync() from public, anon, authenticated;

drop trigger if exists trg_customers_owner_sync on customers;
create trigger trg_customers_owner_sync after update of owner_id on customers
  for each row execute function customers_owner_sync();

-- ── 4) Jednorázové srovnání ──────────────────────────────────
do $$
declare
  v_new       boolean;
  v_customers integer := 0;
  v_jobs      integer := 0;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('owner_from_customer_v1', 'ai_access', 'Obchodník zakázky podle zákazníka — srovnání (2. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Obchodník podle zákazníka: srovnání už proběhlo dřív — beze změny.';
    return;
  end if;

  -- a) zákazník bez obchodníka ← jediný obchodník jeho zakázek (aktivní obchodník / super admin)
  with single as (
    select o.customer_id, min(o.owner_id::text)::uuid as owner_id
      from orders o
      join profiles p on p.id = o.owner_id and p.active and p.role in ('obchodnik', 'super_admin')
     where o.customer_id is not null
     group by o.customer_id
    having count(distinct o.owner_id) = 1
  )
  update customers c set owner_id = s.owner_id
    from single s
   where c.id = s.customer_id and c.owner_id is null;
  get diagnostics v_customers = row_count;

  -- b) otevřené zakázky ← obchodník zákazníka (propsání z bodu a) proběhlo triggerem; tady zbytek)
  update orders o set owner_id = c.owner_id
    from customers c
    join profiles p on p.id = c.owner_id and p.active
   where o.customer_id = c.id
     and o.owner_id is distinct from c.owner_id
     and not o.owner_override
     and order_follows_customer_owner(o.status::text, o.paid_at);
  get diagnostics v_jobs = row_count;

  raise notice 'Obchodník podle zákazníka: % zákazníků dostalo obchodníka, % otevřených zakázek srovnáno.', v_customers, v_jobs;
end $$;
