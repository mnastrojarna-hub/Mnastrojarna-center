-- ═══════════════════════════════════════════════════════════════════════════
--  Prémioví zákazníci (9. 11.) — majitel: „Chtěl bych výrazně zvýrazňovat zakázky pro důležité zákazníky — označit
--  některé zákazníky jako prémiové. Pro začátek Hitachi, Expertbuy, Charvát Pacovské strojírny a Eden Europe. Všechny
--  zakázky pro ně budou mít jasně danou prioritu — červený, výstražný ‚Pozor, prémiový zákazník‘ … A pak to půjde
--  nastavit v kartě zákazníka."
--
--  1) customers.is_premium (výchozí false) — „Prémiový zákazník". Zvýraznění zakázek se NEKOPÍRUJE do orders:
--     Kniha zakázek, tabule, karta zakázky, stránky toku, přehled i hledání ho čtou živě ze zákazníka (embed
--     customer:customers!customer_id(… is_premium) — src/lib/jobs/mapping.ts, JobListItem.customerPremium), takže
--     přepnutí u zákazníka se hned projeví na všech jeho zakázkách.
--  2) Kdo smí přepnout: stejně jako upravit zákazníka (RLS customers_update = aktivní uživatel; aplikace
--     checkFeature("customers") — src/app/actions/crm.ts setCustomerPremium / updateCustomer). Žádná nová pojistka.
--  3) Historie změn: náš server zapisuje audit sám (customer_premium_changed); mimo něj (REST, psql, tato migrace)
--     záchranná síť customers_premium_audit — stejně jako profiles_audit (20261023100000).
--  4) Jednorázově (značka premium_customers_v1): prémioví = názvy (bez diakritiky, malými) obsahující „hitachi",
--     „expertbuy" / „expert buy", „charvat" nebo „pacovske strojirny", „eden europe". Všechny shody (víc firem
--     Hitachi), NOTICE se seznamem a s těmi ze čtyř, které nemají žádnou shodu. Nikdy neodznačuje.
-- Idempotentní: druhé spuštění nic nezmění.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Příznak zákazníka ────────────────────────────────────
alter table customers add column if not exists is_premium boolean not null default false;
comment on column customers.is_premium is
  'Prémiový zákazník — všechny jeho zakázky jsou výrazně označené „Pozor, prémiový zákazník" (čte se živě ze zákazníka, nekopíruje se do zakázek). Mění každý, kdo smí upravit zákazníka.';

-- ── 3) Audit mimo náš server ────────────────────────────────
create or replace function customers_premium_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_by uuid := app_actor();
begin
  if app_ctx() = 'app' then return null; end if;           -- náš server audituje sám (crm.ts)
  if new.is_premium is distinct from old.is_premium then
    insert into audit_log (action, entity, entity_id, diff, actor_id, actor_kind, via, request_id)
    values ('customer_premium_changed', 'customers', new.id::text,
      jsonb_build_object('name', new.name, 'isPremium', jsonb_build_array(old.is_premium, new.is_premium)),
      v_by, app_event_kind(v_by), app_actor_via(), app_request_id());
  end if;
  return null;
end $$;
drop trigger if exists trg_customers_premium_audit on customers;
create trigger trg_customers_premium_audit after update of is_premium on customers
  for each row execute function customers_premium_audit();

-- ── 4) Výchozí prémioví zákazníci (jednorázově) ─────────────
do $$
declare
  v_new    boolean;
  v_group  record;
  v_rows   text;
  v_ids    uuid[];
  v_count  int;
  v_marked int := 0;
  v_n      int;
  v_missing text[] := '{}';
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('premium_customers_v1', 'ai_access', 'Prémioví zákazníci — Hitachi, Expertbuy, Charvát Pacovské strojírny, Eden Europe (9. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Prémioví zákazníci: výchozí nastavení už proběhlo dřív — beze změny.';
    return;
  end if;

  for v_group in
    select * from (values
      (1, 'Hitachi',                        '%hitachi%',      null::text),
      (2, 'Expertbuy',                      '%expertbuy%',    '%expert buy%'),
      (3, 'Charvát Pacovské strojírny',     '%charvat%',      '%pacovske strojirny%'),
      (4, 'Eden Europe',                    '%eden europe%',  null::text)
    ) as g(ord, label, p1, p2)
    order by ord
  loop
    -- název bez diakritiky a malými (translate i pro velká písmena — lower() při ctype C diakritiku nezmenší),
    -- mezery / pomlčky / podtržítka / tečky sjednocené na jednu mezeru („Expert-Buy", „EDEN  Europe")
    select array_agg(c.id), count(*), string_agg(c.name || coalesce(' (' || c.customer_number || ')', ''), ', ' order by c.name)
      into v_ids, v_count, v_rows
      from customers c
     cross join lateral (
       select regexp_replace(
         translate(lower(c.name), 'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ', 'acdeeinorstuuyzacdeeinorstuuyz'),
         '[[:space:]_.-]+', ' ', 'g') as n
     ) x
     where x.n like v_group.p1 or (v_group.p2 is not null and x.n like v_group.p2);
    if v_count = 0 then
      v_missing := v_missing || v_group.label::text;
      continue;
    end if;
    update customers set is_premium = true where id = any(v_ids) and not is_premium;   -- nikdy neodznačuje
    get diagnostics v_n = row_count;
    v_marked := v_marked + v_n;
    raise notice 'Prémioví zákazníci — %: % (%).', v_group.label, v_rows, v_count;
  end loop;

  raise notice 'Prémioví zákazníci: nově označeno % zákazníků.', v_marked;
  if array_length(v_missing, 1) > 0 then
    raise notice 'Prémioví zákazníci: bez shody v adresáři — % (označ v kartě zákazníka, až bude založený).',
      array_to_string(v_missing, ', ');
  end if;
end $$;
