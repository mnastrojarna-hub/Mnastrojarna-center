-- ============================================================
-- Kontakty (31. 10.): nový účel „Dodací listy" a uložení celého adresáře firmy z dialogu najednou.
--  1) party_role_emails.role smí být i 'dodaci_listy' (zákazník: kam posílat dodací listy; odeslání DL
--     ho použije, jinak Objednávky / potvrzení → kontakt zakázky → běžná komunikace). Stávající řádky
--     se nemění (účel 'nakup' = „Objednávky / potvrzení" zůstává).
--  2) save_party_book(p_kind, p_party, p_book) — dialog „Upravit zákazníka / dodavatele" uloží kontaktní
--     osoby (jméno, pozice, e-mail, telefon, hlavní) a e-maily podle účelu v JEDNÉ transakci: buď vše,
--     nebo nic. Maže jen osoby / položky, které uživatel v dialogu odebral (knownContactIds /
--     knownRoleIds minus odeslané) — co mezitím přidala AI, zůstane. Kdo změnu udělal, zapíše
--     set_row_actor z hlaviček servisního klienta (created_by / updated_by). Volá jen server
--     (servisní klíč; oprávnění hlídá akce), přes REST pro anon / authenticated nejde.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

-- ── 1) Účel „Dodací listy" ──────────────────────────────────
do $$ begin
  if to_regclass('public.party_role_emails') is not null then
    alter table party_role_emails drop constraint if exists party_role_emails_check;
    alter table party_role_emails add constraint party_role_emails_check check (
      (customer_id is null) <> (supplier_id is null)
      and role in ('fakturace', 'nakup', 'dodaci_listy', 'nabidky', 'komunikace')
      and source in ('manual', 'ai', 'migrace')
      and (contact_id is null or customer_id is not null)
      and (supplier_contact_id is null or supplier_id is not null)
      and (contact_id is not null or supplier_contact_id is not null or nullif(btrim(email), '') is not null)
    );
    comment on table party_role_emails is
      'Kam co posílat: e-maily zákazníka / dodavatele podle účelu (fakturace, dodaci_listy, nakup = objednávky / potvrzení, nabidky, komunikace) — kontakt nebo adresa, jedna výchozí na roli';
  end if;
end $$;

-- ── 2) Uložení adresáře najednou ────────────────────────────
-- p_book = { contacts: [{key, id|null, name, position, email, phone, isPrimary}],
--            roles:    [{id|null, role, contactKey|null, email|null, isDefault}],
--            knownContactIds: [uuid], knownRoleIds: [uuid] }
-- Vrací { contacts: {added, updated, removed}, roles: {added, updated, removed}, moved: [{from, to}], ids: {key: id} }.
create or replace function save_party_book(p_kind text, p_party uuid, p_book jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  v_party_table text;
  v_ct text;
  v_pc text;
  v_rc text;
  v_contacts jsonb := coalesce(p_book->'contacts', '[]'::jsonb);
  v_roles jsonb := coalesce(p_book->'roles', '[]'::jsonb);
  v_known_c uuid[];
  v_known_r uuid[];
  v_present_c uuid[];
  v_present_r uuid[];
  v_map jsonb := '{}'::jsonb;
  v_moved jsonb := '[]'::jsonb;
  c jsonb;
  r jsonb;
  v_id uuid;
  v_n int;
  v_primary uuid;
  v_role text;
  v_cid uuid;
  v_remail text;
  v_def boolean;
  n_name text; n_pos text; n_email text; n_phone text; n_primary boolean;
  o_name text; o_pos text; o_email text; o_phone text; o_primary boolean;
  o_role text; o_cid uuid; o_remail text; o_def boolean;
  c_added int := 0; c_updated int := 0; c_removed int := 0;
  r_added int := 0; r_updated int := 0; r_removed int := 0;
begin
  if p_kind = 'customer' then
    v_party_table := 'customers'; v_ct := 'customer_contacts'; v_pc := 'customer_id'; v_rc := 'contact_id';
  elsif p_kind = 'supplier' then
    v_party_table := 'suppliers'; v_ct := 'supplier_contacts'; v_pc := 'supplier_id'; v_rc := 'supplier_contact_id';
  else
    raise exception 'Neplatný druh firmy.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_contacts) <> 'array' or jsonb_typeof(v_roles) <> 'array' then
    raise exception 'Neplatný adresář.' using errcode = '22023';
  end if;

  -- firma existuje; souběžná uložení téže firmy jdou po sobě
  execute format('select 1 from %I where id = $1 for update', v_party_table) using p_party;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Firma nenalezena (možná ji někdo smazal).' using errcode = 'P0002'; end if;

  select coalesce(array_agg(x::uuid), '{}') into v_known_c from jsonb_array_elements_text(coalesce(p_book->'knownContactIds', '[]'::jsonb)) x;
  select coalesce(array_agg(x::uuid), '{}') into v_known_r from jsonb_array_elements_text(coalesce(p_book->'knownRoleIds', '[]'::jsonb)) x;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_present_c from jsonb_array_elements(v_contacts) e where nullif(e->>'id', '') is not null;
  select coalesce(array_agg((e->>'id')::uuid), '{}') into v_present_r from jsonb_array_elements(v_roles) e where nullif(e->>'id', '') is not null;

  -- 1) odebrané osoby (jejich položky v účelech smaže cizí klíč)
  execute format('delete from %I where %I = $1 and id = any($2) and not (id = any($3))', v_ct, v_pc)
    using p_party, v_known_c, v_present_c;
  get diagnostics c_removed = row_count;

  -- 2) osoby: úprava jen změněných, nové
  for c in select value from jsonb_array_elements(v_contacts) loop
    n_name := btrim(coalesce(c->>'name', ''));
    n_pos := nullif(btrim(coalesce(c->>'position', '')), '');
    n_email := nullif(lower(btrim(coalesce(c->>'email', ''))), '');
    n_phone := nullif(btrim(coalesce(c->>'phone', '')), '');
    n_primary := coalesce((c->>'isPrimary')::boolean, false);
    if n_name = '' then raise exception 'Kontaktní osoba bez jména.' using errcode = '23514'; end if;
    if nullif(c->>'key', '') is null then raise exception 'Kontaktní osoba bez klíče.' using errcode = '22023'; end if;
    v_id := nullif(c->>'id', '')::uuid;
    v_n := 0;
    if v_id is not null then
      execute format('select name, position, email, phone, is_primary from %I where id = $1 and %I = $2 for update', v_ct, v_pc)
        into o_name, o_pos, o_email, o_phone, o_primary using v_id, p_party;
      get diagnostics v_n = row_count;
    end if;
    if v_n = 1 then
      if (o_name, o_pos, o_email, o_phone, o_primary) is distinct from (n_name, n_pos, n_email, n_phone, n_primary) then
        execute format('update %I set name = $2, position = $3, email = $4, phone = $5, is_primary = $6 where id = $1', v_ct)
          using v_id, n_name, n_pos, n_email, n_phone, n_primary;
        c_updated := c_updated + 1;
        if o_email is not null and n_email is not null and lower(btrim(o_email)) <> n_email then
          v_moved := v_moved || jsonb_build_array(jsonb_build_object('from', lower(btrim(o_email)), 'to', n_email));
        end if;
      end if;
    else
      -- nová (nebo ji mezitím někdo smazal → založí se znovu, jak ji uživatel vidí)
      execute format('insert into %I (%I, name, position, email, phone, is_primary) values ($1, $2, $3, $4, $5, $6) returning id', v_ct, v_pc)
        into v_id using p_party, n_name, n_pos, n_email, n_phone, n_primary;
      c_added := c_added + 1;
    end if;
    v_map := v_map || jsonb_build_object(c->>'key', v_id);
    if n_primary then v_primary := v_id; end if;
  end loop;
  -- hlavní kontakt je jen jeden
  if v_primary is not null then
    execute format('update %I set is_primary = false where %I = $1 and is_primary and id <> $2', v_ct, v_pc) using p_party, v_primary;
  end if;

  -- 3) e-maily podle účelu: odebrané
  execute format('delete from party_role_emails where %I = $1 and id = any($2) and not (id = any($3))', v_pc)
    using p_party, v_known_r, v_present_r;
  get diagnostics v_n = row_count;
  r_removed := v_n;

  -- výchozí je v účelu jen jedna (unikátní index) → nejdřív zrušit u ostatních
  for v_role in select distinct e->>'role' from jsonb_array_elements(v_roles) e where coalesce((e->>'isDefault')::boolean, false) loop
    select nullif(e->>'id', '')::uuid into v_id from jsonb_array_elements(v_roles) e
      where e->>'role' = v_role and coalesce((e->>'isDefault')::boolean, false) limit 1;
    execute format('update party_role_emails set is_default = false where %I = $1 and role = $2 and is_default and id is distinct from $3', v_pc)
      using p_party, v_role, v_id;
  end loop;

  for r in select value from jsonb_array_elements(v_roles) loop
    v_role := r->>'role';
    v_cid := null;
    if nullif(r->>'contactKey', '') is not null then
      v_cid := nullif(v_map->>(r->>'contactKey'), '')::uuid;
      if v_cid is null then raise exception 'Kontaktní osoba v účelu e-mailu chybí.' using errcode = '23514'; end if;
    end if;
    v_remail := case when v_cid is null then nullif(lower(btrim(coalesce(r->>'email', ''))), '') end;
    v_def := coalesce((r->>'isDefault')::boolean, false);
    v_id := nullif(r->>'id', '')::uuid;
    v_n := 0;
    if v_id is not null then
      execute format('select role, %I, email, is_default from party_role_emails where id = $1 and %I = $2 for update', v_rc, v_pc)
        into o_role, o_cid, o_remail, o_def using v_id, p_party;
      get diagnostics v_n = row_count;
    end if;
    if v_n = 1 then
      if (o_role, o_cid, case when o_cid is null then o_remail end) is distinct from (v_role, v_cid, v_remail) then
        execute format('update party_role_emails set role = $2, %I = $3, email = $4, is_default = $5, source = ''manual'' where id = $1', v_rc)
          using v_id, v_role, v_cid, v_remail, v_def;
        r_updated := r_updated + 1;
      elsif o_def is distinct from v_def then
        update party_role_emails set is_default = v_def, source = case when v_def then 'manual' else source end where id = v_id;
        r_updated := r_updated + 1;
      end if;
    else
      execute format('insert into party_role_emails (%I, role, %I, email, is_default, source) values ($1, $2, $3, $4, $5, ''manual'') on conflict do nothing', v_pc, v_rc)
        using p_party, v_role, v_cid, v_remail, v_def;
      get diagnostics v_n = row_count;
      r_added := r_added + v_n;
    end if;
  end loop;

  -- každý použitý účel má výchozí adresu (nejstarší)
  execute format($q$
    update party_role_emails set is_default = true
    where id in (
      select distinct on (x.role) x.id from party_role_emails x
      where x.%1$I = $1
        and not exists (select 1 from party_role_emails y where y.%1$I = $1 and y.role = x.role and y.is_default)
      order by x.role, x.created_at, x.id)
  $q$, v_pc) using p_party;

  return jsonb_build_object(
    'contacts', jsonb_build_object('added', c_added, 'updated', c_updated, 'removed', c_removed),
    'roles', jsonb_build_object('added', r_added, 'updated', r_updated, 'removed', r_removed),
    'moved', v_moved,
    'ids', v_map);
end $$;

comment on function save_party_book(text, uuid, jsonb) is
  'Dialog zákazníka / dodavatele: uloží kontaktní osoby a e-maily podle účelu najednou (jedna transakce); volá jen server';
revoke execute on function save_party_book(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function save_party_book(text, uuid, jsonb) to service_role;
