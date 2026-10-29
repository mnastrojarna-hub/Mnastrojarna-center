-- ============================================================
-- 20261023161000 — Sloučit zakázky (#24): oprava duplicit, které dřív vytvořila dávka focení
-- (např. Z-2026-013 = objednávka zákazníka + výkres + 3D model + fotka, Z-2026-014 = jen naše
-- odeslaná nabídka). Jedna RPC merge_jobs (atomicky, idempotentně podle tokenu) přesune VŠE, co
-- odkazuje na zakázku (orders.id), ze zdrojové zakázky do cílové:
--   order_items (+ shodné výkresy se sloučí do položky cíle), job_files (vč. anonymizace; shodný
--   obsah = archivovaná kopie), drawings, quotes (+ quote_items s nimi), emails, purchase_orders
--   (+ položky), supplier_quotes, job_operations, job_payments, job_order_revisions, production_handoffs,
--   job_events (kromě hlavního stavu zdroje), approval_queue, anon_send_queue, ai_training_examples,
--   invoices, delivery_notes, documents, capture_sessions / capture_apply_steps (odkazy v datech).
--   commission_entries se nepřesouvají — provize obou zakázek se přepočítají (zdroj ji ztratí).
-- Zdroj se NEMAŽE: zůstane jako „Zrušeno — duplicitní, sloučeno do Z-…" (orders.merged_into_id),
-- číslo se nikdy znovu nepoužije, odkaz na zdroj přesměruje na cíl. (Mazání by kaskádou smazalo
-- historii zdroje a to, co nejde přesunout bez kolize — revize objednávky, stavové události.)
-- Hodnoty: vyhrává cíl, prázdná pole cíle doplní zdroj, poznámky se připojí, štítky sjednotí.
-- Po sloučení je zdroj jen historie: aplikace ani REST ho nezmění (MERGED) a každý pozdní zápis na
-- zdroj (otevřená karta, focení, pošta, nákup…) trigger merge_redirect_job přesměruje na cíl —
-- i zápis, který čekal na zámek běžícího sloučení.
-- Celý soubor je idempotentní.
-- ============================================================

-- ── 1) Sloupce a tabulka sloučení ───────────────────────────
alter table orders add column if not exists merged_into_id uuid references orders(id) on delete set null;
alter table orders add column if not exists merged_at      timestamptz;
alter table orders add column if not exists merged_by      uuid references profiles(id) on delete set null;
create index if not exists idx_orders_merged_into on orders(merged_into_id) where merged_into_id is not null;

create table if not exists job_merges (
  id            uuid primary key default uuid_generate_v4(),
  token         uuid not null unique,
  target_id     uuid references orders(id) on delete set null,
  source_id     uuid references orders(id) on delete set null,
  target_number text not null,
  source_number text not null,
  forced        boolean not null default false,
  reason        text,
  result        jsonb not null default '{}'::jsonb,
  created_by    uuid references profiles(id) on delete set null,
  created_via   text,
  created_at    timestamptz not null default now()
);
create index if not exists idx_job_merges_target on job_merges(target_id, created_at desc);
create index if not exists idx_job_merges_source on job_merges(source_id, created_at desc);
alter table job_merges enable row level security;
-- výsledek nese čísla objednávek dodavatelům a hodnoty zakázek → jen obchodník / super admin (zápis jen RPC)
drop policy if exists "job_merges_select" on job_merges;
create policy "job_merges_select" on job_merges for select using (is_obchodnik_or_admin());
revoke insert, update, delete on job_merges from anon, authenticated;
grant select on job_merges to authenticated;
grant all on job_merges to service_role;

-- Příznak sloučení nastaví jen RPC (app.job_merge = on): REST (session) ani náš server (app) ho
-- nevloží ani nezmění. Sloučený zdroj je jen historie — přímá úprava (stará karta, REST, akce
-- serveru) skončí chybou MERGED; dorovnání z triggerů / FK kaskád (hloubka > 1) a servisní
-- skripty projdou. Smazaný cíl (FK set null) příznak smí vynulovat.
create or replace function orders_merge_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ctx text;
begin
  if coalesce(current_setting('app.job_merge', true), '') = 'on' then return new; end if;
  v_ctx := app_ctx();
  if v_ctx not in ('session', 'app') then return new; end if;
  if tg_op = 'INSERT' then
    new.merged_into_id := null; new.merged_at := null; new.merged_by := null;
    return new;
  end if;
  if old.merged_into_id is not null and pg_trigger_depth() = 1 then
    raise exception 'Zakázka % je sloučená do % — změny dělej tam.', old.number,
      coalesce((select number from orders where id = old.merged_into_id), 'jiné zakázky')
      using errcode = 'P0001', hint = 'MERGED';
  end if;
  if new.merged_into_id is distinct from old.merged_into_id
     and not (new.merged_into_id is null and not exists (select 1 from orders where id = old.merged_into_id)) then
    new.merged_into_id := old.merged_into_id; new.merged_at := old.merged_at;
  elsif new.merged_into_id is not distinct from old.merged_into_id then
    new.merged_at := old.merged_at;
  end if;
  if new.merged_by is distinct from old.merged_by
     and (new.merged_by is not null or exists (select 1 from profiles where id = old.merged_by)) then
    new.merged_by := old.merged_by;
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_merge_guard on orders;
create trigger trg_orders_merge_guard before insert or update on orders
  for each row execute function orders_merge_guard();

-- Pozdní zápis na sloučený zdroj → cíl (řetěz A→B→C max. 5 kroků). FOR KEY SHARE počká na běžící
-- sloučení (drží FOR UPDATE) a pak čte už potvrzený příznak — zápis, který čekal, skončí u cíle.
-- Vlastní přesuny RPC (app.job_merge = on) se nepřesměrovávají. Úprava řádku, který na zdroji už
-- je (spojené položky zůstávají v jeho historii), sloupec nemění → nepřesměruje se.
create or replace function merge_redirect_job() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_col  text := tg_argv[0];
  v_from uuid;
  v_id   uuid;
  v_next uuid;
  v_hops int := 0;
  v_row  jsonb;
begin
  if coalesce(current_setting('app.job_merge', true), '') = 'on' then return new; end if;
  v_row := to_jsonb(new);
  v_from := app_uuid(v_row ->> v_col);
  if v_from is null then return new; end if;
  if tg_op = 'UPDATE' and v_from is not distinct from app_uuid(to_jsonb(old) ->> v_col) then return new; end if;
  v_id := v_from;
  loop
    v_next := null;
    select merged_into_id into v_next from orders where id = v_id for key share;
    exit when v_next is null or v_next = v_from or v_hops >= 5;
    v_id := v_next; v_hops := v_hops + 1;
  end loop;
  if v_id = v_from then return new; end if;
  if tg_table_name = 'job_events' and (v_row ->> 'entity_id') = v_from::text then
    new := jsonb_populate_record(new, jsonb_build_object(v_col, v_id, 'entity_id', v_id));
  else
    new := jsonb_populate_record(new, jsonb_build_object(v_col, v_id));
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  -- název trg_000_* = před ostatními BEFORE triggery tabulky (ty už vidí cílovou zakázku)
  for r in select * from (values
      ('order_items', 'order_id'), ('job_files', 'job_id'), ('job_events', 'job_id'), ('emails', 'order_id'),
      ('quotes', 'job_id'), ('purchase_orders', 'job_id'), ('supplier_quotes', 'job_id'), ('job_operations', 'job_id'),
      ('job_payments', 'job_id'), ('drawings', 'job_id'), ('approval_queue', 'order_id'), ('anon_send_queue', 'job_id'),
      ('production_handoffs', 'job_id'), ('invoices', 'order_id'), ('delivery_notes', 'order_id'), ('documents', 'order_id'),
      ('ai_training_examples', 'job_id')) v(tbl, col) loop
    if to_regclass('public.' || r.tbl) is not null then
      execute format('drop trigger if exists trg_000_merge_redirect on %I', r.tbl);
      execute format('create trigger trg_000_merge_redirect before insert or update of %I on %I for each row execute function merge_redirect_job(%L)',
                     r.col, r.tbl, r.col);
    end if;
  end loop;
end $$;

-- ── 2) Pomocné funkce ───────────────────────────────────────
/** Hlavičky požadavku (jen servisní role je čte) — dočasná změna uvnitř RPC; mimo PostgREST nic. */
create or replace function merge_jobs_headers(p_set jsonb, p_drop text[]) returns void
language plpgsql set search_path = public as $$
declare v text := nullif(current_setting('request.headers', true), '');
begin
  if v is null then return; end if;
  perform set_config('request.headers', ((v::jsonb - coalesce(p_drop, '{}'::text[])) || coalesce(p_set, '{}'::jsonb))::text, true);
end $$;

/** Poznámka ke změně jako hlavička x-change-note (UTF-8 → base64url, viz app_change_note). */
create or replace function merge_jobs_note(p text) returns text
language sql immutable set search_path = public as $$
  select translate(encode(convert_to(left(coalesce(p, ''), 500), 'UTF8'), 'base64'), E'+/=\n', '-_')
$$;

create or replace function merge_jobs_ico(p text) returns text
language sql immutable set search_path = public as $$ select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') $$;

/** Je zakázka uzavřená (sloučit nejde)? */
create or replace function merge_jobs_closed(p job_stage) returns boolean
language sql immutable set search_path = public as $$ select p in ('nerealizovano', 'zruseno', 'dokonceno') $$;

/** Dvojice položek se stejným výkresem (zdroj → cíl): stejné číslo výkresu (drawing_norm) a shodná nebo
 *  chybějící revize; každá položka cíle nejvýš jednou (pořadí podle pozice). Ostatní položky se přesunou. */
create or replace function merge_jobs_item_pairs(p_target uuid, p_source uuid)
returns table (source_item uuid, target_item uuid)
language plpgsql stable security definer set search_path = public as $$
declare r record; v_match uuid; v_used uuid[] := '{}';
begin
  for r in select i.id, drawing_norm(i.drawing_number) as dn, upper(nullif(btrim(coalesce(i.revision, '')), '')) as rev
           from order_items i where i.order_id = p_source order by i.position, i.created_at, i.id loop
    if r.dn is null then continue; end if;
    select t.id into v_match from order_items t
    where t.order_id = p_target and drawing_norm(t.drawing_number) = r.dn and not (t.id = any(v_used))
      and (r.rev is null or nullif(btrim(coalesce(t.revision, '')), '') is null or upper(btrim(t.revision)) = r.rev)
    order by t.position, t.created_at, t.id limit 1;
    if v_match is not null then
      v_used := v_used || v_match;
      source_item := r.id; target_item := v_match;
      return next;
    end if;
  end loop;
end $$;

/** Pole zakázky pro sloučení: (sloupec, popisek, druh). Druhy: text, date, num, customer, profile,
 *  owner, supplier, quote, email, append, tags. */
create or replace function merge_jobs_fields() returns table (field text, label text, kind text)
language sql immutable set search_path = public as $$
  select * from (values
    ('title', 'Název zakázky', 'text'),
    ('customer_id', 'Zákazník', 'customer'),
    ('customer_order_number', 'Číslo objednávky zákazníka', 'text'),
    ('customer_inquiry_number', 'Číslo poptávky zákazníka', 'text'),
    ('quote_id', 'Naše nabídka', 'quote'),
    ('order_date', 'Datum objednávky', 'date'),
    ('inquiry_date', 'Datum poptávky', 'date'),
    ('customer_required_date', 'Požadovaný termín zákazníkem', 'date'),
    ('due_date', 'Potvrzený termín zákazníkovi', 'date'),
    ('expected_delivery_date', 'Očekávané dodání', 'date'),
    ('supplier_promised_date', 'Termín slíbený dodavatelem', 'date'),
    ('max_tolerated_date', 'Nejzazší termín', 'date'),
    ('value', 'Hodnota zakázky', 'num'),
    ('purchase_cost', 'Nákupní cena', 'num'),
    ('customer_contact', 'Kontaktní osoba', 'text'),
    ('customer_contact_email', 'E-mail kontaktu', 'text'),
    ('customer_contact_phone', 'Telefon kontaktu', 'text'),
    ('owner_id', 'Obchodník', 'owner'),
    ('assignee_id', 'Zpracovává', 'profile'),
    ('supplier_id', 'Dodavatel', 'supplier'),
    ('supplier_order_number', 'Naše objednávka u dodavatele', 'text'),
    ('technology', 'Technologie', 'text'),
    ('manufacturing_location', 'Místo výroby', 'text'),
    ('specific_requirements', 'Specifické požadavky', 'text'),
    ('delivery_method', 'Způsob dodání', 'text'),
    ('invoice_number', 'Číslo faktury', 'text'),
    ('delivery_note_number', 'Číslo dodacího listu', 'text'),
    ('email_id', 'Původní e-mail', 'email'),
    ('note', 'Poznámka', 'append'),
    ('customer_note', 'Poznámka zákazníka', 'append'),
    ('tags', 'Štítky', 'tags')
  ) as f(field, label, kind)
$$;

/** Čitelná hodnota pole pro náhled. */
create or replace function merge_jobs_display(p_kind text, p_value jsonb) returns text
language plpgsql stable security definer set search_path = public as $$
declare v text := case when p_value is null or jsonb_typeof(p_value) = 'null' then null
                       when jsonb_typeof(p_value) = 'string' then p_value #>> '{}' else p_value::text end;
begin
  if v is null or btrim(v) = '' or v = '[]' then return null; end if;
  return case p_kind
    when 'date' then to_char(v::date, 'FMDD. FMMM. YYYY')
    -- česky jako formatMoney v aplikaci („48 000 Kč", „1 234,50 Kč") — nezávisle na locale DB
    when 'num' then replace(replace(to_char(v::numeric, case when v::numeric = trunc(v::numeric) then 'FM999,999,999,990'
                                                             else 'FM999,999,999,990.00' end), ',', chr(160)), '.', ',') || ' Kč'
    when 'customer' then (select name from customers where id = app_uuid(v))
    when 'supplier' then (select name from suppliers where id = app_uuid(v))
    when 'profile' then (select coalesce(nullif(btrim(full_name), ''), email) from profiles where id = app_uuid(v))
    when 'owner' then (select coalesce(nullif(btrim(full_name), ''), email) from profiles where id = app_uuid(v))
    when 'quote' then (select number from quotes where id = app_uuid(v))
    when 'email' then (select left(coalesce(nullif(subject, ''), '(bez předmětu)'), 120) from emails where id = app_uuid(v))
    when 'tags' then (select string_agg(x, ', ') from jsonb_array_elements_text(p_value) x)
    else left(v, 500) end;
end $$;

/** Smí autor (app_actor) sloučit tyto zakázky? NULL = ano, jinak důvod. Super admin vždy; obchodník
 *  jen své zakázky (obchodník / zpracovává / založil / jeho nabídka nebo pošta = flow_mine_job_ids)
 *  a jen se stejným obchodníkem zakázky (jinak by převzal cizí obrat a provizi — obchodníka mění jen
 *  super admin); zaměstnanec ne. Bez autora (psql, servisní skript) ano. */
create or replace function merge_jobs_forbidden(p_target uuid, p_source uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_actor uuid := app_actor(); v_role user_role; v_active boolean; v_t_owner uuid; v_s_owner uuid;
begin
  if app_ctx() = 'session' then return 'K této akci nemáš oprávnění.'; end if;
  if app_ctx() = 'app' and app_actor_kind() is distinct from 'user' then return 'Zakázky slučuje jen člověk.'; end if;
  if v_actor is null then
    return case when app_ctx() = 'app' then 'K této akci nemáš oprávnění.' end;
  end if;
  select role, active into v_role, v_active from profiles where id = v_actor;
  if not coalesce(v_active, false) then return 'K této akci nemáš oprávnění.'; end if;
  if v_role = 'super_admin' then return null; end if;
  if v_role <> 'obchodnik' then return 'Zakázky slučuje obchodník nebo super admin.'; end if;
  if not exists (select 1 from flow_mine_job_ids(v_actor) m(id) where m.id = p_target)
     or not exists (select 1 from flow_mine_job_ids(v_actor) m(id) where m.id = p_source) then
    return 'Sloučit můžeš jen své zakázky (jsi u nich obchodník, zpracováváš je nebo jsi je založil) — jinak požádej super admina.';
  end if;
  select owner_id into v_t_owner from orders where id = p_target;
  select owner_id into v_s_owner from orders where id = p_source;
  if v_s_owner is not null and v_s_owner is distinct from v_t_owner then
    return 'Zakázky mají různé obchodníky' || case when v_t_owner is null then ' (cílová žádného)' else '' end
      || ' — sloučí je super admin, aby se obrat a provize nepřevedly omylem.';
  end if;
  return null;
end $$;

-- ── 3) Plán sloučení (náhled i kontrola RPC — jedna pravda) ──
create or replace function merge_jobs_plan(p_target uuid, p_source uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t orders%rowtype; s orders%rowtype;
  tj jsonb; sj jsonb; f record;
  v_conf jsonb := '[]'; v_fields jsonb := '[]'; v_counts jsonb; v_tv jsonb; v_sv jsonb; v_rule text; v_res jsonb;
  v_forbid text; v_actor uuid := app_actor(); v_admin boolean;
  tc customers%rowtype; sc customers%rowtype;
  v_t_rank int; v_s_rank int; v_stage_to job_stage; v_acc_n int := 0; v_acc_id uuid; v_acc_no text; v_sent_t text[]; v_sent_s text[];
  v_acc_blocked boolean := false; v_pdf text; v_pdf_since timestamptz;
  v_sup_t uuid[]; v_sup_s uuid[]; v_paid text[]; v_n int; v_items_merged int; v_files_dup int;
begin
  select * into t from orders where id = p_target;
  select * into s from orders where id = p_source;
  if t.id is null or s.id is null then
    return jsonb_build_object('ok', false, 'conflicts', jsonb_build_array(jsonb_build_object(
      'code', 'NOT_FOUND', 'level', 'block', 'message', 'Zakázka nenalezena.')));
  end if;
  v_admin := v_actor is null or exists (select 1 from profiles where id = v_actor and role = 'super_admin' and active);

  -- ── konflikty ──
  if t.id = s.id then
    v_conf := v_conf || jsonb_build_object('code', 'SAME_JOB', 'level', 'block', 'message', 'Zakázku nejde sloučit samu se sebou.');
  end if;
  v_forbid := merge_jobs_forbidden(t.id, s.id);
  if v_forbid is not null then
    v_conf := v_conf || jsonb_build_object('code', 'FORBIDDEN', 'level', 'block', 'message', v_forbid);
  end if;
  if s.merged_into_id is not null then
    v_conf := v_conf || jsonb_build_object('code', case when s.merged_into_id = t.id then 'ALREADY_MERGED' else 'MERGED' end,
      'level', 'block', 'message', 'Zakázka ' || s.number || ' už je sloučená do '
        || coalesce((select number from orders where id = s.merged_into_id), '—') || '.');
  end if;
  if t.merged_into_id is not null then
    v_conf := v_conf || jsonb_build_object('code', 'MERGED', 'level', 'block', 'message', 'Zakázka ' || t.number
      || ' je sloučená do ' || coalesce((select number from orders where id = t.merged_into_id), '—') || ' — slučuj do ní.');
  end if;
  if s.merged_into_id is null and merge_jobs_closed(s.status) then
    v_conf := v_conf || jsonb_build_object('code', 'CLOSED', 'level', 'block', 'message', 'Zakázka ' || s.number || ' je uzavřená ('
      || job_stage_label(s.status) || ') — nejdřív ji obnov, pak slučuj.');
  end if;
  if t.merged_into_id is null and merge_jobs_closed(t.status) then
    v_conf := v_conf || jsonb_build_object('code', 'CLOSED', 'level', 'block', 'message', 'Zakázka ' || t.number || ' je uzavřená ('
      || job_stage_label(t.status) || ') — nejdřív ji obnov, pak slučuj.');
  end if;
  -- Reklamace / Pozastaveno nemá pořadí — sloučením zdroje by se ztratila (i s objednávkou zákazníka)
  if s.merged_into_id is null and job_stage_rank(s.status) < 0 and not merge_jobs_closed(s.status) and s.status <> t.status then
    v_conf := v_conf || jsonb_build_object('code', 'SPECIAL_STAGE', 'level', 'block', 'message',
      'Zakázka ' || s.number || ' je ve stavu ' || job_stage_label(s.status) || ' — sloučením by se ztratil. Prohoď směr a slučuj do ní.');
  end if;
  select array_agg(o.number order by o.number) into v_paid from commission_entries c join orders o on o.id = c.order_id
  where c.order_id in (t.id, s.id) and c.status = 'vyplaceno';
  if v_paid is not null then
    v_conf := v_conf || jsonb_build_object('code', 'COMMISSION_PAID', 'level', 'block', 'message',
      'Provize zakázky ' || array_to_string(v_paid, ', ') || ' je už vyplacená — sloučení by změnilo vyplacené vyúčtování.');
  end if;
  if t.customer_id is not null and s.customer_id is not null and t.customer_id <> s.customer_id then
    select * into tc from customers where id = t.customer_id;
    select * into sc from customers where id = s.customer_id;
    if merge_jobs_ico(tc.ico) is not null and merge_jobs_ico(sc.ico) is not null and merge_jobs_ico(tc.ico) <> merge_jobs_ico(sc.ico) then
      v_conf := v_conf || jsonb_build_object('code', 'CUSTOMER_DIFFERENT', 'level', 'force', 'message',
        'Různí zákazníci: ' || coalesce(tc.name, '—') || ' (IČO ' || tc.ico || ') a ' || coalesce(sc.name, '—') || ' (IČO ' || sc.ico
        || '). Sloučit to může jen super admin s důvodem.');
    else
      v_conf := v_conf || jsonb_build_object('code', 'CUSTOMER_NAME', 'level', 'warn', 'message',
        'Zákazník je zapsaný dvakrát („' || coalesce(tc.name, '—') || '“ / „' || coalesce(sc.name, '—') || '“) — zůstane „'
        || coalesce(tc.name, '—') || '“.');
    end if;
  end if;
  if nullif(btrim(coalesce(t.customer_order_number, '')), '') is not null and nullif(btrim(coalesce(s.customer_order_number, '')), '') is not null
     and drawing_norm(t.customer_order_number) <> drawing_norm(s.customer_order_number) then
    v_conf := v_conf || jsonb_build_object('code', 'ORDER_DIFFERENT', 'level', 'force', 'message',
      'Každá zakázka má jinou objednávku zákazníka (' || t.customer_order_number || ' / ' || s.customer_order_number
      || ') — nejspíš nejde o duplicitu. Sloučit to může jen super admin s důvodem.');
  end if;
  select array_remove(array_agg(distinct po.supplier_id), null), array_agg(po.number order by po.number) into v_sup_t, v_sent_t
  from purchase_orders po where po.job_id = t.id and po.status in ('odeslana', 'potvrzena', 'dodana');
  select array_remove(array_agg(distinct po.supplier_id), null), array_agg(po.number order by po.number) into v_sup_s, v_sent_s
  from purchase_orders po where po.job_id = s.id and po.status in ('odeslana', 'potvrzena', 'dodana');
  if v_sent_t is not null and v_sent_s is not null
     and not (v_sup_t @> v_sup_s and v_sup_s @> v_sup_t) then
    v_conf := v_conf || jsonb_build_object('code', 'PO_SUPPLIER_CONFLICT', 'level', 'force', 'message',
      'Obě zakázky mají odeslané objednávky u různých dodavatelů (' || array_to_string(v_sent_t, ', ') || ' × '
      || array_to_string(v_sent_s, ', ') || ') — zkontroluj, že se neobjednalo dvakrát. Sloučit to může jen super admin s důvodem.',
      'purchaseOrders', to_jsonb(v_sent_t || v_sent_s));
  end if;
  -- odeslané objednávky u STEJNÉHO dodavatele v obou duplicitách = díl je nejspíš objednaný dvakrát
  if v_sent_t is not null and v_sent_s is not null and v_sup_t && v_sup_s then
    v_conf := v_conf || jsonb_build_object('code', 'PO_DUPLICATE', 'level', 'force', 'message',
      'Obě zakázky mají odeslanou objednávku u stejného dodavatele (' || array_to_string(v_sent_t, ', ') || ' × '
      || array_to_string(v_sent_s, ', ') || ') — díl je možná objednaný dvakrát a náklady by se sečetly. Zkontroluj to; '
      || 'sloučit to může jen super admin s důvodem.',
      'purchaseOrders', to_jsonb(v_sent_t || v_sent_s));
  end if;
  if exists (select 1 from job_operations where job_id = t.id and status <> 'preskoceno')
     and exists (select 1 from job_operations where job_id = s.id and status <> 'preskoceno') then
    v_conf := v_conf || jsonb_build_object('code', 'PRODUCTION_BOTH', 'level', 'warn', 'message',
      'Obě zakázky mají postup výroby — kroky zakázky ' || s.number || ' se připojí za kroky ' || t.number || '.');
  end if;
  if exists (select 1 from job_payments where job_id = t.id) and exists (select 1 from job_payments where job_id = s.id) then
    v_conf := v_conf || jsonb_build_object('code', 'PAYMENTS_BOTH', 'level', 'warn', 'message',
      'Obě zakázky mají zapsané úhrady — sečtou se.');
  end if;
  if s.order_revision >= 1 and t.order_revision >= 1 and exists (select 1 from job_order_revisions where job_id = s.id) then
    v_conf := v_conf || jsonb_build_object('code', 'REVISIONS_KEPT', 'level', 'warn', 'message',
      'Revize objednávky zakázky ' || s.number || ' zůstanou v její historii (platí objednávka ' || t.number || ').');
  end if;

  -- ── stav ──
  v_t_rank := job_stage_rank(t.status); v_s_rank := job_stage_rank(s.status);
  v_stage_to := case when v_t_rank >= 0 and v_s_rank > v_t_rank then s.status else t.status end;
  if v_stage_to <> t.status then
    v_conf := v_conf || jsonb_build_object('code', 'STAGE_ADVANCE', 'level', 'info', 'message',
      'Zakázka ' || s.number || ' je dál (' || job_stage_label(s.status) || ') — po sloučení bude ' || t.number || ' ve stavu '
      || job_stage_label(v_stage_to) || '. Tip: prohoď směr a ponech ' || s.number || '.');
  end if;
  -- přijetí nabídky: zakázka s objednávkou zákazníka a jedinou odeslanou nabídkou (stejné pravidlo jako ruční posun)
  if job_stage_rank(v_stage_to) >= 3
     and not exists (select 1 from quotes where job_id in (t.id, s.id) and status = 'prijato') then
    select count(*)::int, (array_agg(id order by created_at desc))[1], (array_agg(number order by created_at desc))[1],
           coalesce(bool_or(admin_approval_required and approved_by is null), false)
      into v_acc_n, v_acc_id, v_acc_no, v_acc_blocked
    from quotes where job_id in (t.id, s.id) and not archived and status = 'odeslano';
    -- neschválenou nabídku ne-admina přijmout nejde (stráž R7) → nepřislibovat
    if v_acc_n = 1 and v_acc_blocked then
      v_conf := v_conf || jsonb_build_object('code', 'QUOTE_WONT_ACCEPT', 'level', 'warn', 'message',
        'Nabídka ' || coalesce(v_acc_no, '') || ' čeká na schválení super adminem — po sloučení zůstane „Odeslaná“; '
        || 'jako přijatou ji označ po schválení.');
    end if;
  end if;
  -- naše nabídka jen jako PDF (starší dávka focení ji k záznamu nabídky nepřipojila)
  if job_stage_rank(s.status) >= 2 and not exists (select 1 from quotes where job_id = s.id) then
    select string_agg(distinct coalesce(nullif(btrim(jf.ai_extracted->>'documentNumber'), ''),
                                        nullif(btrim(regexp_replace(coalesce(jf.title, ''), '^\s*nabídka\s*', '', 'i')), ''), jf.filename), ', ')
      into v_pdf
    from job_files jf where jf.job_id = s.id and not jf.archived and jf.kind = 'nabidka' and jf.issuer = 'my' and jf.quote_id is null;
    if v_pdf is not null then
      select min(e.created_at) into v_pdf_since from job_events e
      where e.job_id = s.id and e.type = 'stage' and e.data->>'to' = 'nabidka';
      v_pdf_since := coalesce(v_pdf_since, case when s.status = 'nabidka' then s.stage_changed_at end);
      v_conf := v_conf || jsonb_build_object('code', 'QUOTE_PDF_ONLY', 'level', 'warn', 'message',
        'Nabídka ' || v_pdf || ' je u ' || s.number || ' jen jako PDF (bez záznamu nabídky) — přesune se do Dokumentů a do historie '
        || 'se zapíše, že byla odeslaná; v průběhu bude krok Nabídka „přeskočen“.');
    end if;
  end if;

  -- ── pole ──
  tj := to_jsonb(t); sj := to_jsonb(s);
  for f in select * from merge_jobs_fields() loop
    v_tv := tj->f.field; v_sv := sj->f.field;
    if v_sv is null or jsonb_typeof(v_sv) = 'null' or (jsonb_typeof(v_sv) = 'string' and btrim(v_sv #>> '{}') = '')
       or v_sv = '[]'::jsonb then continue; end if;
    if f.kind = 'append' then
      if v_tv is null or jsonb_typeof(v_tv) = 'null' or btrim(v_tv #>> '{}') = '' then v_rule := 'fill'; v_res := v_sv;
      elsif position(btrim(v_sv #>> '{}') in v_tv #>> '{}') > 0 then continue;
      else v_rule := 'append';
        v_res := to_jsonb((v_tv #>> '{}') || E'\n\n— ze zakázky ' || s.number || ': ' || (v_sv #>> '{}'));
      end if;
    elsif f.kind = 'tags' then
      select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) into v_res
      from (select jsonb_array_elements_text(coalesce(v_tv, '[]'::jsonb)) x union select jsonb_array_elements_text(v_sv)) u;
      if v_res = coalesce(v_tv, '[]'::jsonb) then continue; end if;
      v_rule := case when v_tv is null or v_tv = '[]'::jsonb then 'fill' else 'union' end;
    elsif v_tv is null or jsonb_typeof(v_tv) = 'null' or (jsonb_typeof(v_tv) = 'string' and btrim(v_tv #>> '{}') = '') then
      if f.kind = 'owner' and not v_admin then v_rule := 'admin_only'; v_res := v_tv;
      else v_rule := 'fill'; v_res := v_sv; end if;
    elsif v_tv = v_sv or (f.kind = 'text' and lower(btrim(v_tv #>> '{}')) = lower(btrim(v_sv #>> '{}'))) then
      continue;
    else
      v_rule := 'keep'; v_res := v_tv;
    end if;
    v_fields := v_fields || jsonb_build_object('field', f.field, 'label', f.label, 'kind', f.kind, 'rule', v_rule,
      'target', merge_jobs_display(f.kind, v_tv), 'source', merge_jobs_display(f.kind, v_sv),
      'result', merge_jobs_display(f.kind, v_res), 'value', v_res);
  end loop;

  -- ── počty ──
  select count(*)::int into v_items_merged from merge_jobs_item_pairs(t.id, s.id);
  select count(*)::int into v_files_dup from job_files sf
  where sf.job_id = s.id and not sf.archived and sf.content_sha256 is not null
    and exists (select 1 from job_files tf where tf.job_id = t.id and not tf.archived and tf.content_sha256 = sf.content_sha256);
  v_counts := jsonb_build_object(
    'items', (select count(*) from order_items where order_id = s.id) - v_items_merged,
    'itemsMerged', v_items_merged,
    'files', (select count(*) from job_files where job_id = s.id and not archived),
    'filesArchived', (select count(*) from job_files where job_id = s.id and archived),
    'filesDuplicate', v_files_dup,
    'drawings', (select count(*) from drawings where job_id = s.id),
    'quotes', (select count(*) from quotes where job_id = s.id),
    'emails', (select count(*) from emails where order_id = s.id),
    'purchaseOrders', (select count(*) from purchase_orders where job_id = s.id),
    'supplierQuotes', (select count(*) from supplier_quotes where job_id = s.id),
    'operations', (select count(*) from job_operations where job_id = s.id),
    'payments', (select count(*) from job_payments where job_id = s.id),
    'revisions', case when t.order_revision >= 1 then 0 else (select count(*) from job_order_revisions where job_id = s.id) end,
    'handoffs', (select count(*) from production_handoffs where job_id = s.id),
    'events', (select count(*) from job_events where job_id = s.id and type <> 'stage'),
    'approvals', (select count(*) from approval_queue where order_id = s.id),
    'anonQueue', (select count(*) from anon_send_queue where job_id = s.id),
    'training', (select count(*) from ai_training_examples where job_id = s.id),
    'invoices', (select count(*) from invoices where order_id = s.id),
    'deliveryNotes', (select count(*) from delivery_notes where order_id = s.id),
    'documents', (select count(*) from documents where order_id = s.id),
    'captureSessions', (select count(*) from capture_sessions where data::text like '%' || s.id::text || '%'));

  return jsonb_build_object(
    'ok', not exists (select 1 from jsonb_array_elements(v_conf) c where c->>'level' = 'block'),
    'needsForce', exists (select 1 from jsonb_array_elements(v_conf) c where c->>'level' = 'force'),
    'canForce', v_admin,
    'target', jsonb_build_object('id', t.id, 'number', t.number, 'title', t.title, 'stage', t.status, 'customerId', t.customer_id,
      'customer', (select name from customers where id = t.customer_id), 'customerOrderNumber', t.customer_order_number,
      'value', t.value, 'createdAt', t.created_at),
    'source', jsonb_build_object('id', s.id, 'number', s.number, 'title', s.title, 'stage', s.status, 'customerId', s.customer_id,
      'customer', (select name from customers where id = s.customer_id), 'customerOrderNumber', s.customer_order_number,
      'value', s.value, 'createdAt', s.created_at),
    'stage', jsonb_build_object('from', t.status, 'to', v_stage_to, 'source', s.status),
    'acceptQuote', case when v_acc_n = 1 and not v_acc_blocked then jsonb_build_object('id', v_acc_id, 'number', v_acc_no) end,
    'quotePdf', case when v_pdf is not null then jsonb_build_object('label', v_pdf, 'since', v_pdf_since) end,
    'counts', v_counts, 'fields', v_fields, 'conflicts', v_conf);
end $$;

-- ── 4) RPC merge_jobs ───────────────────────────────────────
/** Sloučí zdroj do cíle (jedna transakce). Stejný p_token = výsledek prvního volání (replayed). Zdroj už
 *  sloučený do cíle = také výsledek prvního sloučení. p_force (jen super admin, s důvodem) přebije konflikty
 *  úrovně „force" (různé IČO, jiná objednávka zákazníka, odeslané objednávky u různých dodavatelů). */
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

/** Náhled sloučení (nic nemění): počty po druzích, konflikty, které hodnoty vyhrají, výsledný stav. */
create or replace function merge_jobs_preview(p_target uuid, p_source uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if app_ctx() not in ('app', 'service', 'db') then raise exception 'K této akci nemáš oprávnění.' using errcode = '42501'; end if;
  return merge_jobs_plan(p_target, p_source);
end $$;

-- ── 5) Práva ────────────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array['merge_jobs(uuid, uuid, uuid, boolean, text)', 'merge_jobs_preview(uuid, uuid)',
                           'merge_jobs_plan(uuid, uuid)', 'merge_jobs_forbidden(uuid, uuid)', 'merge_jobs_item_pairs(uuid, uuid)',
                           'merge_jobs_headers(jsonb, text[])', 'merge_jobs_display(text, jsonb)'] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
