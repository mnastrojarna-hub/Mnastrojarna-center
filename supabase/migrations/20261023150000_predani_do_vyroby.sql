-- ============================================================
-- 20261023150000 — Předání do výroby: kroky s kým a do kdy, mezitermín / konečný termín (zákazník),
-- nejlevnější nabídka, automatická objednávka dodavateli (atomicky, idempotentně).
-- Vynucení (brány) je vypnuté do 20261023160000_predani_brany.sql — production_handoff_enforced() = false.
--
-- Tento soubor PŘEDEFINUJE recompute_job_production (dříve 20261023100000), job_cost a
-- recompute_job_commission (dříve 20261022110000). Pozdější úpravy těch funkcí patří SEM (nebo do novější migrace).
--
-- Navíc (rozhodnutí majitele k provizím): zakázka s objednávkou dodavateli, která má položku bez ceny,
-- má náklad NEZNÁMÝ (job_cost.known = false). Provize se jí nezobrazuje jako 0 Kč, ale jako
-- „čeká na nákupní cenu" (commission_entries.cost_pending_po = čísla takových objednávek) a do
-- vyplácené částky se nepočítá (není „K výplatě", výplata měsíce ji nezamkne). Doplnění ceny položky
-- přepočítá provizi samo (trigger na položkách); když je její měsíc už vyplacený, padne do aktuálního.
--
-- Celý soubor je idempotentní (druhé spuštění nic nezmění).
-- ============================================================

create or replace function production_handoff_enforced() returns boolean
language sql stable set search_path = public as $$ select false $$;

-- ── 0) Předání (idempotence, vrácení) ───────────────────────
create table if not exists production_handoffs (
  id                uuid primary key default uuid_generate_v4(),
  job_id            uuid not null references orders(id) on delete cascade,
  token             uuid not null unique,
  kind              text not null check (kind in ('predani','doplneni','dalsi_krok','ukonceni','plan','zaznam','zpet')),
  stage_from        job_stage,
  stage_to          job_stage,
  result            jsonb,
  note              text,
  undone_at         timestamptz,
  undone_by         uuid references profiles(id) on delete set null,
  undone_handoff_id uuid references production_handoffs(id) on delete set null,
  created_by        uuid references profiles(id) on delete set null,
  created_via       text,
  created_at        timestamptz not null default now()
);
create index if not exists idx_production_handoffs_job on production_handoffs(job_id, created_at desc);
alter table production_handoffs enable row level security;
do $$ begin
  create policy "production_handoffs_select" on production_handoffs for select using (is_active_user());
exception when duplicate_object then null; end $$;          -- zápis jen RPC (servisní role)
revoke insert, update, delete on production_handoffs from anon, authenticated;
grant select on production_handoffs to authenticated;
grant all on production_handoffs to service_role;
drop trigger if exists trg_production_handoffs_audit_delete on production_handoffs;
create trigger trg_production_handoffs_audit_delete after delete on production_handoffs
  for each row execute function audit_row_delete();

-- ── 1) Výrobní kroky ────────────────────────────────────────
alter table job_operations add column if not exists order_item_ids        uuid[];
alter table job_operations add column if not exists ends_at_customer_date boolean not null default false;
alter table job_operations add column if not exists deadline_state        text;
alter table job_operations add column if not exists deadline_source       text;
alter table job_operations add column if not exists deadline_changed_at   timestamptz;
alter table job_operations add column if not exists deadline_changed_by   uuid references profiles(id) on delete set null;
alter table job_operations add column if not exists deadline_changed_via  text;
alter table job_operations add column if not exists who_source            text;
alter table job_operations add column if not exists who_changed_at        timestamptz;
alter table job_operations add column if not exists who_changed_by        uuid references profiles(id) on delete set null;
alter table job_operations add column if not exists who_changed_via       text;
alter table job_operations add column if not exists supplier_quote_id     uuid references supplier_quotes(id) on delete set null;
alter table job_operations add column if not exists po_mode               text;
alter table job_operations add column if not exists po_none_reason        text;
alter table job_operations add column if not exists handoff_id            uuid references production_handoffs(id) on delete set null;
create index if not exists idx_job_operations_po on job_operations(purchase_order_id);
create index if not exists idx_job_operations_handoff on job_operations(handoff_id) where handoff_id is not null;

alter table job_operations drop constraint if exists job_operations_kind_check;
alter table job_operations add constraint job_operations_kind_check check (kind in (
  'vyroba', 'soustruzeni', 'frezovani', 'brouseni', 'tepelne_zpracovani', 'povrchova_uprava',
  'dratove_rezani', 'elektroeroze', 'vrtani', 'svarovani', 'plech', 'montaz',
  'kontrola', 'doprava', 'kompletni_dodavka', 'jine'));
do $$ begin
  alter table job_operations add constraint job_operations_deadline_state_check check (deadline_state is null or deadline_state in
    ('odhad','dohodnuto','pozadovano','potvrzeno','zmena_ceka','plan'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_operations add constraint job_operations_deadline_source_check check (deadline_source is null or deadline_source in
    ('nabidka_dodavatele','lhuta_dodavatele','potvrzeni_dodavatele','termin_zakaznika','posledni_dodavatel','odhad','rucne','ai','import'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_operations add constraint job_operations_who_source_check check (who_source is null or who_source in
    ('objednavka','nejlevnejsi_nabidka','nabidka','posledni_vykres','posledni_operace','technologie','rucne','ai','import'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_operations add constraint job_operations_po_mode_check check (
    (po_mode is null or po_mode in ('vystavit','existujici','neobjednavat','pri_predani'))
    and (po_mode is distinct from 'neobjednavat' or nullif(btrim(coalesce(po_none_reason,'')),'') is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_operations add constraint job_operations_item_scope_check check (order_item_ids is null or cardinality(order_item_ids) > 0);
exception when duplicate_object then null; end $$;
create unique index if not exists uq_job_operations_final on job_operations(job_id)
  where ends_at_customer_date and status <> 'preskoceno';

-- ── 2) Nabídky a objednávky dodavatelům ─────────────────────
alter table supplier_quotes add column if not exists operation_kinds text[];
do $$ begin
  alter table supplier_quotes add constraint supplier_quotes_operation_kinds_check check (operation_kinds is null or operation_kinds <@ array[
    'vyroba','soustruzeni','frezovani','brouseni','tepelne_zpracovani','povrchova_uprava','dratove_rezani','elektroeroze',
    'vrtani','svarovani','plech','montaz','kontrola','doprava','kompletni_dodavka','jine']::text[]);
exception when duplicate_object then null; end $$;
alter table purchase_orders add column if not exists revision        int not null default 1;
alter table purchase_orders add column if not exists handoff_id      uuid references production_handoffs(id) on delete set null;
alter table purchase_orders add column if not exists sent_mailbox_id uuid references mailboxes(id) on delete set null;

/** Číslo výkresu pro porovnání: velká písmena, bez mezer, teček, pomlček a lomítek (= TS normalizeDrawingNumber). */
create or replace function drawing_norm(p text) returns text
language sql immutable set search_path = public as $$
  select nullif(upper(regexp_replace(coalesce(p, ''), '[\s.\-/]', '', 'g')), '')
$$;
create index if not exists idx_poi_drawing_norm on purchase_order_items (drawing_norm(drawing_number));

-- ── 3) Fronta ke schválení + režim automatiky ───────────────
-- (nová hodnota výčtu se v tomto souboru nepoužívá; RPC ji čte až za běhu)
alter type approval_type add value if not exists 'purchase_order';
alter table approval_queue add column if not exists purchase_order_id uuid references purchase_orders(id) on delete cascade;
create unique index if not exists uq_approval_queue_po_pending on approval_queue
  (purchase_order_id, (coalesce(payload->>'kind', 'issue'))) where status = 'pending' and purchase_order_id is not null;
insert into automation_settings (module, mode) values ('purchase_order', 'approval') on conflict (module) do nothing;

-- ── 4) Zakázka: souhrn aktuálního kroku pro Knihu ──────────
alter table orders add column if not exists production_step_no      int;
alter table orders add column if not exists production_step_kind_no int;
alter table orders add column if not exists production_step_title   text;
alter table orders add column if not exists production_due          date;
alter table orders add column if not exists production_due_final    boolean;
alter table orders add column if not exists production_due_state    text;
alter table orders add column if not exists production_po_status    text;
alter table orders add column if not exists production_end          date;   -- nejzazší termín otevřených kroků
alter table orders add column if not exists production_final_end    date;   -- termín kroku s konečným termínem
alter table orders add column if not exists production_finished_at  timestamptz;
alter table orders add column if not exists production_finished_by  uuid references profiles(id) on delete set null;
create index if not exists idx_orders_production_due on orders(production_due) where status = 've_vyrobe';

-- ── 5) Provize: náklad čeká na nákupní cenu ─────────────────
-- čísla aktivních objednávek dodavatelům s položkou bez ceny (null = nic nečeká); plní trigger níže
alter table commission_entries add column if not exists cost_pending_po text[];

-- ============================================================
-- Pomocné funkce
-- ============================================================
create or replace function operation_kind_label(p text) returns text
language sql immutable set search_path = public as $$
  select case p when 'vyroba' then 'Výroba' when 'soustruzeni' then 'Soustružení' when 'frezovani' then 'Frézování'
    when 'brouseni' then 'Broušení' when 'tepelne_zpracovani' then 'Tepelné zpracování' when 'povrchova_uprava' then 'Povrchová úprava'
    when 'dratove_rezani' then 'Drátové řezání' when 'elektroeroze' then 'Elektroeroze (hloubení)' when 'vrtani' then 'Vrtání / závitování'
    when 'svarovani' then 'Svařování' when 'plech' then 'Plech (laser, ohyb)' when 'montaz' then 'Montáž' when 'kontrola' then 'Kontrola / měření'
    when 'doprava' then 'Doprava' when 'kompletni_dodavka' then 'Kompletní dodávka' else 'Jiná operace' end
$$;

/** Název kroku pro historii (= TS stepLabel): vlastní název; „Výroba k" když má postup víc kroků; jinak druh. */
create or replace function production_step_label(p_op uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(btrim(coalesce(o.title, '')), ''),
    case when o.kind = 'vyroba' then
      case when (select count(*) from job_operations x where x.job_id = o.job_id and x.status <> 'preskoceno') > 1
           then 'Výroba ' || (select count(*) from job_operations x
                              where x.job_id = o.job_id and x.kind = 'vyroba' and x.status <> 'preskoceno'
                                and (x.position, x.created_at) <= (o.position, o.created_at))
           else 'Výroba' end
    else operation_kind_label(o.kind) end)
  from job_operations o where o.id = p_op
$$;

create or replace function production_step_ready(p_in_house boolean, p_supplier uuid, p_name text, p_end date)
returns boolean language sql immutable set search_path = public as $$
  select (coalesce(p_in_house, false) or p_supplier is not null or nullif(btrim(coalesce(p_name, '')), '') is not null)
     and p_end is not null
$$;

create or replace function production_step_startable(p_in_house boolean, p_supplier uuid, p_name text, p_end date,
                                                     p_po uuid, p_po_mode text)
returns boolean language sql immutable set search_path = public as $$
  select production_step_ready(p_in_house, p_supplier, p_name, p_end)
     and (coalesce(p_in_house, false) or p_po is not null or p_po_mode = 'neobjednavat')
$$;

/** Objednávka kroku, jen když není zrušená (zrušená objednávka = krok objednávku nemá). */
create or replace function production_active_po(p_po uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from purchase_orders where id = p_po and status <> 'zrusena'
$$;

/** Plán připravený: existuje otevřený krok a aktuální krok je připravený (běží) / spustitelný (čeká). Bez otevřeného kroku = NE. */
create or replace function production_plan_ready(p_job uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select case when status in ('probiha', 'problem')
                then production_step_ready(in_house, supplier_id, supplier_name, planned_end)
                else production_step_startable(in_house, supplier_id, supplier_name, planned_end, production_active_po(purchase_order_id), po_mode) end
    from job_operations where job_id = p_job and status in ('ceka', 'probiha', 'problem')
    order by (status in ('probiha', 'problem')) desc, position, created_at limit 1), false)
$$;

/** Verze postupu (optimistický zámek předání): mění se s každou změnou kroku. */
create or replace function production_route_version(p_job uuid) returns text
language sql stable security definer set search_path = public as $$
  select md5(coalesce(string_agg(id::text || ':' || status || ':' || extract(epoch from updated_at)::text, ','
                                 order by position, created_at, id), ''))
  from job_operations where job_id = p_job
$$;

/** Událost z triggeru / RPC s explicitní atribucí (job_events_before_insert ve vnořeném triggeru nic nedoplní). */
create or replace function production_event(p_job uuid, p_message text, p_data jsonb, p_entity text, p_entity_id uuid,
                                            p_type text default 'field')
returns void language plpgsql security definer set search_path = public as $$
declare v_actor uuid := app_actor();
begin
  -- clock_timestamp: události jednoho předání (jedna transakce) mají pořadí, v jakém vznikly
  insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id, created_at)
  values (p_job, p_type, left(p_message, 2000), coalesce(p_data, '{}'::jsonb), v_actor, app_event_kind(v_actor),
          case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end,
          p_entity, coalesce(p_entity_id, p_job), app_request_id(), clock_timestamp());
end $$;

/** „20. 11. 2026" */
create or replace function production_cz_date(p date) returns text
language sql immutable set search_path = public as $$ select to_char(p, 'FMDD. FMMM. YYYY') $$;

revoke all on function production_active_po(uuid) from public, anon;
grant execute on function production_active_po(uuid) to authenticated, service_role;   -- volá brána kroků (i REST)
revoke all on function production_plan_ready(uuid) from public, anon;
grant execute on function production_plan_ready(uuid) to authenticated, service_role;
revoke all on function production_route_version(uuid) from public, anon;
grant execute on function production_route_version(uuid) to authenticated, service_role;
revoke all on function production_event(uuid, text, jsonb, text, uuid, text) from public, anon, authenticated;
grant execute on function production_event(uuid, text, jsonb, text, uuid, text) to service_role;
revoke all on function production_step_label(uuid) from public, anon;
grant execute on function production_step_label(uuid) to authenticated, service_role;

-- ============================================================
-- Brány (zatím NEAKTIVNÍ — production_handoff_enforced() = false)
-- ============================================================
create or replace function orders_production_gate() returns trigger
language plpgsql set search_path = public as $$
declare v_h text := nullif(current_setting('app.production_handoff', true), '');
begin
  if not production_handoff_enforced() or app_ctx() not in ('session', 'app') then return new; end if;
  if new.status = 've_vyrobe'
     and (tg_op = 'INSERT' or (old.status is distinct from 've_vyrobe' and job_stage_rank(old.status) < 5)) then
    if tg_op = 'INSERT' or v_h is null
       or not exists (select 1 from production_handoffs h where h.id = app_uuid(v_h) and h.job_id = new.id)
       or not production_plan_ready(new.id) then
      raise exception 'Do výroby zakázku předáš tlačítkem „Předat do výroby…“ — zeptá se, kdo to dělá a do kdy.'
        using errcode = 'P0001', hint = 'HANDOFF_REQUIRED';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_production_gate on orders;
create trigger trg_orders_production_gate before insert or update of status on orders
  for each row execute function orders_production_gate();

create or replace function job_operations_ready_gate() returns trigger
language plpgsql set search_path = public as $$
declare
  v_entering_run boolean;
  v_rank int;
  v_h text := nullif(current_setting('app.production_handoff', true), '');
begin
  if not production_handoff_enforced() or app_ctx() not in ('session', 'app') then return new; end if;
  v_entering_run := new.status in ('probiha', 'problem') and (tg_op = 'INSERT' or old.status not in ('probiha', 'problem'));
  -- R1: spuštění jen se vším (kdo, termín, u dodavatele objednávka nebo „objednáno jinak")
  if v_entering_run and not production_step_startable(new.in_house, new.supplier_id, new.supplier_name, new.planned_end,
                                                     production_active_po(new.purchase_order_id), new.po_mode) then
    raise exception 'Krok výroby nejde spustit bez toho, kdo ho dělá, bez termínu a (u dodavatele) bez objednávky — předej ho („Předat do kroku…“).'
      using errcode = 'P0001', hint = 'STEP_NOT_READY';
  end if;
  -- R4: spuštění před předáním zakázky jen uvnitř předání
  if v_entering_run then
    select job_stage_rank(status) into v_rank from orders where id = new.job_id;
    if v_rank < 5 and (v_h is null or not exists (select 1 from production_handoffs h where h.id = app_uuid(v_h) and h.job_id = new.job_id)) then
      raise exception 'Zakázka ještě není ve výrobě — předej ji do výroby („Předat do výroby…“).'
        using errcode = 'P0001', hint = 'HANDOFF_REQUIRED';
    end if;
  end if;
  -- R2: hotovo bez toho, kdo to udělal, ne
  if new.status = 'hotovo' and (tg_op = 'INSERT' or old.status = 'ceka')
     and not (coalesce(new.in_house, false) or new.supplier_id is not null or nullif(btrim(coalesce(new.supplier_name, '')), '') is not null) then
    raise exception 'Doplň, kdo krok udělal.' using errcode = 'P0001', hint = 'STEP_NOT_READY';
  end if;
  -- R3: běžícímu kroku nejde smazat kdo / termín (kaskáda FK = vnořený trigger → projde)
  if tg_op = 'UPDATE' and pg_trigger_depth() = 1
     and new.status in ('probiha', 'problem') and old.status in ('probiha', 'problem')
     and (new.in_house, new.supplier_id, new.supplier_name, new.planned_end)
         is distinct from (old.in_house, old.supplier_id, old.supplier_name, old.planned_end)
     and not production_step_ready(new.in_house, new.supplier_id, new.supplier_name, new.planned_end) then
    raise exception 'Probíhající krok musí mít, kdo ho dělá, a termín.' using errcode = 'P0001', hint = 'STEP_NOT_READY';
  end if;
  return new;
end $$;
drop trigger if exists trg_job_operations_ready on job_operations;
create trigger trg_job_operations_ready before insert or update on job_operations
  for each row execute function job_operations_ready_gate();

-- ============================================================
-- Razítka „kdo a kdy změnil termín / kdo to dělá", kdo z objednávky, ochrana souhrnu
-- ============================================================
create or replace function job_operations_field_stamps() returns trigger
language plpgsql set search_path = public as $$
declare
  v_ctx   text := app_ctx();
  v_actor uuid := app_pick(case when tg_op = 'INSERT' then new.created_by else null end);
  v_via   text := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
begin
  -- kdo z objednávky, když chybí (dodávka objednávky uzavře krok i bez ručně vyplněné firmy)
  if new.purchase_order_id is not null and not coalesce(new.in_house, false) and new.supplier_id is null
     and nullif(btrim(coalesce(new.supplier_name, '')), '') is null then
    select supplier_id into new.supplier_id from purchase_orders where id = new.purchase_order_id;
  end if;
  -- stav termínu (A.4) i pro kroky mimo předání (dialog kroku, šablona): termín bez stavu = odhad / plán dílny;
  -- změna toho, kdo krok dělá, mimo předání vrací dohodnutý / požadovaný / potvrzený termín na odhad
  if new.planned_end is null then
    null;
  elsif new.deadline_state is null then
    new.deadline_state := case when coalesce(new.in_house, false) then 'plan' else 'odhad' end;
  elsif tg_op = 'UPDATE' and nullif(current_setting('app.production_handoff', true), '') is null
        and new.deadline_state is not distinct from old.deadline_state
        and (new.in_house, new.supplier_id, new.supplier_name) is distinct from (old.in_house, old.supplier_id, old.supplier_name) then
    new.deadline_state := case when coalesce(new.in_house, false) then 'plan' else 'odhad' end;
  end if;
  if tg_op = 'INSERT' then
    if new.planned_end is not null then
      new.deadline_changed_at := now(); new.deadline_changed_by := v_actor; new.deadline_changed_via := v_via;
    end if;
    if coalesce(new.in_house, false) or new.supplier_id is not null or nullif(btrim(coalesce(new.supplier_name, '')), '') is not null then
      new.who_changed_at := now(); new.who_changed_by := v_actor; new.who_changed_via := v_via;
    end if;
    return new;
  end if;
  if (new.planned_end, new.ends_at_customer_date, new.deadline_state) is distinct from (old.planned_end, old.ends_at_customer_date, old.deadline_state) then
    new.deadline_changed_at := now(); new.deadline_changed_by := v_actor; new.deadline_changed_via := v_via;
  elsif v_ctx = 'session' then
    new.deadline_changed_at := old.deadline_changed_at; new.deadline_changed_via := old.deadline_changed_via;
    new.deadline_changed_by := app_keep(new.deadline_changed_by, old.deadline_changed_by);
  end if;
  if (new.in_house, new.supplier_id, new.supplier_name) is distinct from (old.in_house, old.supplier_id, old.supplier_name) then
    new.who_changed_at := now(); new.who_changed_by := v_actor; new.who_changed_via := v_via;
  elsif v_ctx = 'session' then
    new.who_changed_at := old.who_changed_at; new.who_changed_via := old.who_changed_via;
    new.who_changed_by := app_keep(new.who_changed_by, old.who_changed_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_job_operations_field_stamps on job_operations;
create trigger trg_job_operations_field_stamps before insert or update on job_operations
  for each row execute function job_operations_field_stamps();

-- souhrn výroby na zakázce přes REST nepřepíšeš (přímý zápis = hloubka 1; přepočet z triggeru = hloubka 2 projde)
create or replace function orders_production_protect() returns trigger
language plpgsql set search_path = public as $$
begin
  if app_ctx() = 'session' and pg_trigger_depth() = 1 then
    new.production_step_no := old.production_step_no;           new.production_step_kind_no := old.production_step_kind_no;
    new.production_step_title := old.production_step_title;     new.production_due := old.production_due;
    new.production_due_final := old.production_due_final;       new.production_due_state := old.production_due_state;
    new.production_po_status := old.production_po_status;       new.production_end := old.production_end;
    new.production_final_end := old.production_final_end;       new.production_finished_at := old.production_finished_at;
    new.production_finished_by := app_keep(new.production_finished_by, old.production_finished_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_production_protect on orders;
create trigger trg_orders_production_protect before update on orders
  for each row execute function orders_production_protect();

-- ============================================================
-- recompute_job_production — PŘEDEFINOVÁNO (základ 20261023100000 §8)
--  * souhrn aktuálního kroku pro Knihu (číslo kroku, termín, konečný termín, stav termínu, objednávka)
--  * pojistka „výroba začala → Ve výrobě" jen mimo aplikaci/REST, jakmile platí brány, a nikdy
--    uvnitř předání (stav zakázky tam řídí předání samo)
-- ============================================================
create or replace function recompute_job_production(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur job_operations%rowtype; v_total int; v_done int; v_problem boolean; v_started boolean; v_loc text;
  v_prev text := current_setting('app.flow_cause', true);
  v_in_handoff boolean := nullif(current_setting('app.production_handoff', true), '') is not null;
  v_no int; v_kind_no int; v_po_status text; v_end date; v_final_end date;
begin
  select count(*) filter (where status <> 'preskoceno'), count(*) filter (where status = 'hotovo'),
         bool_or(status = 'problem'), bool_or(status in ('probiha', 'hotovo', 'problem')),
         max(planned_end) filter (where status in ('ceka', 'probiha', 'problem')),
         max(planned_end) filter (where ends_at_customer_date and status <> 'preskoceno')
    into v_total, v_done, v_problem, v_started, v_end, v_final_end
  from job_operations where job_id = p_job;

  select * into v_cur from job_operations where job_id = p_job and status in ('probiha', 'problem') order by position, created_at limit 1;
  if v_cur.id is null then
    select * into v_cur from job_operations where job_id = p_job and status = 'ceka' order by position, created_at limit 1;
  end if;
  if v_cur.id is not null then
    v_loc := case when v_cur.in_house then 'U nás'
                  when v_cur.supplier_id is not null then (select name from suppliers where id = v_cur.supplier_id)
                  else nullif(v_cur.supplier_name, '') end;
    select count(*), count(*) filter (where kind = v_cur.kind) into v_no, v_kind_no
    from job_operations where job_id = p_job and status <> 'preskoceno'
      and (position, created_at) <= (v_cur.position, v_cur.created_at);
    select status::text into v_po_status from purchase_orders where id = v_cur.purchase_order_id;
  end if;

  perform set_config('app.flow_cause', 'vyroba', true);
  update orders set
    production_step = case when v_cur.id is null then (case when v_total > 0 and v_done = v_total then 'hotovo' else null end) else v_cur.kind end,
    production_location = v_loc,
    production_done = coalesce(v_done, 0), production_total = coalesce(v_total, 0), production_problem = coalesce(v_problem, false),
    production_step_no = v_no, production_step_kind_no = v_kind_no,
    production_step_title = nullif(btrim(coalesce(v_cur.title, '')), ''),
    production_due = v_cur.planned_end,
    production_due_final = case when v_cur.id is null then null else v_cur.ends_at_customer_date end,
    production_due_state = v_cur.deadline_state, production_po_status = v_po_status,
    production_end = v_end, production_final_end = v_final_end,
    status = case when coalesce(v_started, false) and status in ('objednavka', 'potvrzeno') and not v_in_handoff
                       and (not production_handoff_enforced() or app_ctx() in ('service', 'db'))
                  then 've_vyrobe'::job_stage else status end
  where id = p_job;
  perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
end $$;

-- ============================================================
-- Objednávka dodavateli → kroky, fronta ke schválení a souhrn (jeden trigger)
-- ============================================================
create or replace function purchase_orders_production_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if new.status is distinct from old.status then
    -- fronta: jen řádky „issue" (change/cancel/hold řeší aplikace)
    if new.status = 'odeslana' then
      update approval_queue set status = 'approved', resolved_at = now()
      where purchase_order_id = new.id and status = 'pending' and coalesce(payload->>'kind', 'issue') = 'issue';
    elsif new.status in ('potvrzena', 'dodana') and old.status in ('navrh', 'vystavena') then
      update approval_queue set status = 'rejected', resolved_at = now(),
             summary = coalesce(summary, '') || ' · Neodesláno — objednávka vyřízena jinak'
      where purchase_order_id = new.id and status = 'pending' and coalesce(payload->>'kind', 'issue') = 'issue';
    elsif new.status = 'zrusena' then
      update approval_queue set status = 'rejected', resolved_at = now()
      where purchase_order_id = new.id and status = 'pending' and coalesce(payload->>'kind', 'issue') in ('issue', 'change');
    end if;
    -- stav termínu navázaných otevřených kroků
    if new.status = 'odeslana' then
      update job_operations set deadline_state = 'pozadovano'
      where purchase_order_id = new.id and status in ('ceka', 'probiha', 'problem')
        and coalesce(deadline_state, 'odhad') = 'odhad' and not coalesce(in_house, false) and planned_end is not null;
    elsif new.status = 'potvrzena' then
      update job_operations set deadline_state = 'potvrzeno'
      where purchase_order_id = new.id and status in ('ceka', 'probiha', 'problem') and not ends_at_customer_date
        and deadline_state is distinct from 'potvrzeno';
    end if;
  end if;

  -- potvrzený termín → poslední navázaný otevřený krok; konečný termín se nemění (jen varování)
  if new.confirmed_date is not null and new.confirmed_date is distinct from old.confirmed_date then
    select o.id, o.planned_end, o.ends_at_customer_date, production_step_label(o.id) as name into r
    from job_operations o where o.purchase_order_id = new.id and o.status in ('ceka', 'probiha', 'problem')
    order by o.position desc, o.created_at desc limit 1;
    if r.id is not null then
      if r.ends_at_customer_date then
        if r.planned_end is not null and new.confirmed_date > r.planned_end then
          perform production_event(new.job_id, 'Dodavatel potvrdil ' || to_char(new.confirmed_date, 'FMDD. FMMM.')
            || ' — později než konečný termín (zákazník) ' || to_char(r.planned_end, 'FMDD. FMMM.')
            || ' (objednávka ' || coalesce(new.number, '') || ')',
            jsonb_build_object('production', 'warning', 'operationId', r.id, 'purchaseOrderId', new.id, 'origin', 'db'), 'operation', r.id);
        else
          update job_operations set deadline_state = 'potvrzeno' where id = r.id and deadline_state is distinct from 'potvrzeno';
        end if;
      -- „Potvrzena" v Nákupu kopíruje požadovaný termín do potvrzeného: to není nový termín od dodavatele,
      -- termín kroku se nehýbe (jen stav); posouvá ho jen jiné datum, než jsme požadovali
      elsif r.planned_end is distinct from new.confirmed_date and new.confirmed_date is distinct from new.required_date then
        update job_operations set planned_end = new.confirmed_date, deadline_source = 'potvrzeni_dodavatele', deadline_state = 'potvrzeno'
        where id = r.id;
        perform production_event(new.job_id, 'Výroba: ' || r.name || ' — termín ' || coalesce(to_char(r.planned_end, 'FMDD. FMMM.'), '—')
          || ' → ' || to_char(new.confirmed_date, 'FMDD. FMMM.') || ' (potvrdil dodavatel, objednávka ' || coalesce(new.number, '') || ')',
          jsonb_build_object('production', 'updated', 'operationId', r.id, 'purchaseOrderId', new.id,
                             'fields', jsonb_build_array('planned_end'), 'origin', 'db'),
          'operation', r.id);
      else
        update job_operations set deadline_state = 'potvrzeno' where id = r.id and deadline_state is distinct from 'potvrzeno';
      end if;
    end if;
  end if;

  if new.status is distinct from old.status and exists (select 1 from job_operations where purchase_order_id = new.id) then
    perform recompute_job_production(new.job_id);      -- production_po_status pro řádek Knihy
  end if;
  return null;
end $$;
drop trigger if exists trg_purchase_orders_production_sync on purchase_orders;
create trigger trg_purchase_orders_production_sync after update of status, confirmed_date on purchase_orders
  for each row execute function purchase_orders_production_sync();

-- ============================================================
-- job_cost — PŘEDEFINOVÁNO (základ 20261022110000 §job_cost)
-- objednávka s položkou bez ceny = náklad neznámý → provize ze zisku „čeká na nákupní cenu"
-- ============================================================
create or replace function job_cost(p_job uuid, out cost numeric, out known boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_count int; v_total numeric; v_planned numeric; v_unpriced boolean;
begin
  select count(*), coalesce(sum(po.total), 0),
         coalesce(bool_or(exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id and i.unit_price is null)), false)
    into v_count, v_total, v_unpriced
  from purchase_orders po where po.job_id = p_job and po.status <> 'zrusena';
  select purchase_cost into v_planned from orders where id = p_job;
  known := case when v_count > 0 then not v_unpriced else v_planned is not null end;  -- objednávka bez ceny = náklad neznámý
  cost  := case when v_count > 0 then v_total else coalesce(v_planned, 0) end;
end $$;

/** Čísla aktivních objednávek zakázky, které mají položku bez nákupní ceny (null = žádná). */
create or replace function job_unpriced_purchase_orders(p_job uuid) returns text[]
language sql stable security definer set search_path = public as $$
  select array_agg(coalesce(po.number, '—') order by po.order_date, po.number)
  from purchase_orders po
  where po.job_id = p_job and po.status <> 'zrusena'
    and exists (select 1 from purchase_order_items i where i.purchase_order_id = po.id and i.unit_price is null)
$$;
revoke all on function job_unpriced_purchase_orders(uuid) from public, anon, authenticated;
grant execute on function job_unpriced_purchase_orders(uuid) to service_role;

-- záznam provize nese, na které objednávky čeká (jen když náklad není známý). Provize ze zisku, která
-- čeká na nákupní cenu, není k výplatě a výplata měsíce ji nezamkne (jinak by po doplnění ceny zůstala 0 Kč navždy).
create or replace function commission_entries_cost_pending() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.cost_pending_po := case when new.order_id is not null and not new.cost_known
                              then job_unpriced_purchase_orders(new.order_id) end;
  if not new.cost_known and new.base is distinct from 'revenue' then
    if tg_op = 'UPDATE' and old.status = 'vyplaceno' then
      null;                                   -- dřív vyplacená zůstává historií výplat
    elsif new.status in ('k_vyplate', 'vyplaceno') then
      new.status := 'predbezna';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_commission_entries_cost_pending on commission_entries;
create trigger trg_commission_entries_cost_pending before insert or update on commission_entries
  for each row execute function commission_entries_cost_pending();

-- doplnění / smazání ceny položky objednávky → přepočet provize (dřív jen při změně hlavičky objednávky);
-- po příkazech (replaceItems = 2 příkazy, ne 2 × N řádků), každá zakázka jednou — i stará při přesunu položky
create or replace function purchase_order_items_commission() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pos uuid[]; v_job uuid;
begin
  -- (každý dotaz smí číst jen přechodovou tabulku, kterou jeho trigger má)
  if tg_op = 'INSERT' then
    select array_agg(distinct n.purchase_order_id) into v_pos from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.purchase_order_id) into v_pos from old_rows o;
  else
    select array_agg(distinct x.po) into v_pos from (
      select n.purchase_order_id as po from new_rows n join old_rows o on o.id = n.id
      where (n.unit_price, n.purchase_order_id) is distinct from (o.unit_price, o.purchase_order_id)
      union all
      select o.purchase_order_id from new_rows n join old_rows o on o.id = n.id
      where n.purchase_order_id is distinct from o.purchase_order_id) x;
  end if;
  if v_pos is null then return null; end if;
  for v_job in select distinct po.job_id from purchase_orders po where po.id = any(v_pos) and po.job_id is not null loop
    perform recompute_job_commission(v_job);
  end loop;
  return null;
end $$;
drop trigger if exists trg_purchase_order_items_commission on purchase_order_items;
drop trigger if exists trg_purchase_order_items_commission_ins on purchase_order_items;
drop trigger if exists trg_purchase_order_items_commission_del on purchase_order_items;
drop trigger if exists trg_purchase_order_items_commission_upd on purchase_order_items;
create trigger trg_purchase_order_items_commission_ins after insert on purchase_order_items
  referencing new table as new_rows for each statement execute function purchase_order_items_commission();
create trigger trg_purchase_order_items_commission_del after delete on purchase_order_items
  referencing old table as old_rows for each statement execute function purchase_order_items_commission();
create trigger trg_purchase_order_items_commission_upd after update on purchase_order_items
  referencing old table as old_rows new table as new_rows for each statement execute function purchase_order_items_commission();

-- ============================================================
-- recompute_job_commission — PŘEDEFINOVÁNO (základ 20261022110000 §recompute_job_commission)
-- Navíc: když je měsíc záznamu už vyplacený a záznam ne (provize čekala na nákupní cenu, nebo zakázka
-- přibyla do vyplaceného měsíce), započítá se do aktuálního měsíce — vyplacené vyúčtování se nemění.
-- ============================================================
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

  -- vyplacený měsíc se už nemění: nevyplacený záznam jde do aktuálního měsíce
  if coalesce(v_old.status, '') <> 'vyplaceno' and exists (
       select 1 from commission_statements s where s.owner_id = j.owner_id and s.period = v_period and s.status = 'vyplaceno') then
    v_period := date_trunc('month', app_today())::date;
  end if;

  -- odhad pro neinkasovanou zakázku (pásmová): pásmo, do kterého by padla při inkasu teď
  if v_base = 'margin_tiered' and not v_collected and v_known then
    select coalesce(sum(revenue), 0) into v_mtd from commission_entries
    where owner_id = j.owner_id and period = v_period and collected;
    select value into v_band from jsonb_array_elements(v_rule.tiers)
    where (value->>'from')::numeric <= v_mtd + v_rev
    order by (value->>'from')::numeric desc limit 1;
    v_est := round(greatest(v_profit, 0) * coalesce((v_band->>'rate')::numeric, 0), 2);
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

-- ============================================================
-- RPC production_apply — jediná cesta předání do výroby (atomicky, idempotentně)
--  p_payload (sestaví server, ceny NIKDY od klienta) — viz ProductionApplyPayload v
--  src/lib/jobs/production-handoff-types.ts
-- ============================================================
create or replace function production_apply(p_job uuid, p_token uuid, p_kind text, p_expected_stage job_stage,
                                            p_expected_route text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_job orders%rowtype; v_prev production_handoffs%rowtype; v_undo production_handoffs%rowtype;
  v_handoff uuid; v_rank int; v_ctx text := app_ctx();
  v_actor uuid := app_actor(); v_today date := app_today();
  v_step jsonb; v_po jsonb; v_sup jsonb; v_rec jsonb;
  v_op uuid; v_po_id uuid; v_sup_id uuid; v_number text; v_total numeric; v_name text; v_label text; v_text text;
  v_suppliers jsonb := '{}'; v_groups jsonb := '{}'; v_ops uuid[] := '{}'; v_pos jsonb := '[]';
  v_start uuid; v_starts int := 0; v_items uuid[]; v_position int; v_existing uuid; v_cur_status text;
  v_complete uuid := app_uuid(p_payload #>> '{complete,operationId}');
  v_stage_to job_stage := nullif(p_payload->>'stageTo', '')::job_stage;
  v_final_date date; v_final_old date; v_reason text; v_skipped int := 0; v_complete_po uuid;
  v_all_received boolean; v_finish_step boolean := true; v_skipped_ids uuid[] := '{}'; v_summary text; v_who boolean; v_prev_po uuid;
  v_undo_ops uuid[] := '{}'; v_reused uuid[] := '{}'; v_zaznam_done boolean := false;
  v_result jsonb; r record;
begin
  if v_ctx not in ('app', 'service', 'db') then raise exception 'K této akci nemáš oprávnění.' using errcode = '42501'; end if;
  if p_kind is null or p_kind not in ('predani','doplneni','dalsi_krok','ukonceni','plan','zaznam','zpet') then
    raise exception 'Neznámý druh předání.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  if p_token is null then raise exception 'Chybí identifikátor požadavku.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  p_payload := coalesce(p_payload, '{}'::jsonb);
  select * into v_job from orders where id = p_job for update;
  if not found then raise exception 'Zakázka nenalezena.' using errcode = 'P0002'; end if;

  -- idempotence: stejný token = výsledek prvního volání (druhé čeká na zámek zakázky a vidí potvrzený řádek)
  select * into v_prev from production_handoffs where token = p_token;
  if found then
    if v_prev.job_id <> p_job then raise exception 'Neplatný požadavek.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    return coalesce(v_prev.result, '{}'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  if v_job.status is distinct from p_expected_stage then
    raise exception 'Stav zakázky se mezitím změnil — obnov stránku.' using errcode = 'P0001', hint = 'STAGE_CHANGED'; end if;
  if production_route_version(p_job) is distinct from p_expected_route then
    raise exception 'Postup výroby se mezitím změnil — obnov stránku.' using errcode = 'P0001', hint = 'STEP_CHANGED'; end if;

  v_rank := job_stage_rank(v_job.status);
  if v_job.status in ('nerealizovano', 'zruseno', 'dokonceno') then
    raise exception 'Uzavřenou zakázku nelze předat do výroby — nejdřív ji obnov.' using errcode = 'P0001', hint = 'STAGE_CHANGED';
  elsif p_kind = 'predani' and v_rank between 0 and 2 then
    raise exception 'Zákazník ještě neobjednal — nejdřív zapiš objednávku zákazníka.' using errcode = 'P0001', hint = 'NO_CUSTOMER_ORDER';
  elsif p_kind = 'predani' and not (v_rank in (3, 4) or v_job.status in ('pozastaveno', 'reklamace') or v_rank between 6 and 8) then
    raise exception 'Zakázka je už ve výrobě.' using errcode = 'P0001', hint = 'STAGE_CHANGED';
  elsif p_kind in ('doplneni', 'dalsi_krok', 'ukonceni', 'zpet') and v_job.status <> 've_vyrobe' then
    raise exception 'Zakázka není ve výrobě.' using errcode = 'P0001', hint = 'STAGE_CHANGED';
  elsif p_kind = 'zaznam' and v_rank not in (3, 4) then
    raise exception 'Zápis výroby jde jen před výrobou.' using errcode = 'P0001', hint = 'STAGE_CHANGED';
  elsif p_kind = 'plan' and v_rank > 8 then
    raise exception 'Postup výroby už nejde plánovat — zakázka je dodaná zákazníkovi.' using errcode = 'P0001', hint = 'STAGE_CHANGED';
  elsif p_kind in ('ukonceni', 'zaznam') and (v_stage_to is null or job_stage_rank(v_stage_to) < 6) then
    raise exception 'Neplatný cílový stav.' using errcode = 'P0001', hint = 'VALIDATION';
  end if;
  if jsonb_array_length(coalesce(p_payload->'purchaseOrders', '[]')) > 0 and v_rank between 0 and 2 then
    raise exception 'Objednat u dodavatele lze až po objednávce zákazníka.' using errcode = 'P0001', hint = 'NO_CUSTOMER_ORDER';
  end if;
  if jsonb_array_length(coalesce(p_payload->'steps', '[]')) > 12 then
    raise exception 'Najednou lze předat nejvýš 12 kroků.' using errcode = 'P0001', hint = 'VALIDATION';
  end if;
  -- jen obchodník / admin (margins): potvrzený termín zákazníkovi, převzetí po položkách, storno odeslané objednávky
  if v_ctx = 'app' and app_actor_kind() = 'user' and not app_actor_may_decide()
     and ((coalesce((p_payload #>> '{finalDate,confirmed}')::boolean, false)
           and nullif(p_payload #>> '{finalDate,date}', '') is not null
           and (p_payload #>> '{finalDate,date}')::date is distinct from v_job.due_date)
          or (jsonb_typeof(p_payload #> '{complete,receipts}') = 'array' and jsonb_array_length(p_payload #> '{complete,receipts}') > 0)
          or (jsonb_typeof(p_payload #> '{finish,cancelSentPurchaseOrderIds}') = 'array'
              and jsonb_array_length(p_payload #> '{finish,cancelSentPurchaseOrderIds}') > 0)) then
    raise exception 'K této akci nemáš oprávnění.' using errcode = '42501', hint = 'FORBIDDEN';
  end if;

  insert into production_handoffs (job_id, token, kind, stage_from, note, created_by, created_via)
  values (p_job, p_token, p_kind, v_job.status, left(nullif(btrim(coalesce(p_payload->>'note', '')), ''), 2000), v_actor,
          case when v_ctx = 'db' then 'db' else app_actor_via() end)
  returning id into v_handoff;
  perform set_config('app.production_handoff', v_handoff::text, true);

  -- a) konečný termín (zákazník): confirmed → due_date (práva ověří server), jinak požadavek jen když chybí
  if jsonb_typeof(p_payload->'finalDate') = 'object' and nullif(p_payload #>> '{finalDate,date}', '') is not null then
    v_final_date := (p_payload #>> '{finalDate,date}')::date;
    if coalesce((p_payload #>> '{finalDate,confirmed}')::boolean, false) then
      v_final_old := v_job.due_date;
      if v_final_old is distinct from v_final_date then
        update orders set due_date = v_final_date where id = p_job;
        perform production_event(p_job, 'Potvrzený termín zákazníkovi: ' || coalesce(production_cz_date(v_final_old), '—') || ' → '
          || production_cz_date(v_final_date) || ' (při předání do výroby)',
          jsonb_build_object('handoffId', v_handoff, 'changes', jsonb_build_array(jsonb_build_object(
            'field', 'due_date', 'label', 'Potvrzený termín zákazníkovi', 'from', v_final_old, 'to', v_final_date,
            'fromText', coalesce(production_cz_date(v_final_old), '—'), 'toText', production_cz_date(v_final_date)))), 'job', p_job);
      end if;
    elsif v_job.customer_required_date is null then
      update orders set customer_required_date = v_final_date where id = p_job;
      perform production_event(p_job, 'Požadovaný termín zákazníkem: — → ' || production_cz_date(v_final_date) || ' (při předání do výroby)',
        jsonb_build_object('handoffId', v_handoff, 'changes', jsonb_build_array(jsonb_build_object(
          'field', 'customer_required_date', 'label', 'Požadovaný termín zákazníkem', 'from', null, 'to', v_final_date,
          'fromText', '—', 'toText', production_cz_date(v_final_date)))), 'job', p_job);
    end if;
  end if;

  -- b) zpet: vrátí poslední předání (kroky čekají, nevyslané objednávky zrušené, stav zpět)
  if p_kind = 'zpet' then
    select * into v_undo from production_handoffs
    where id = app_uuid(p_payload->>'undoHandoffId') and job_id = p_job and kind = 'predani' and undone_at is null;
    if v_undo.id is null then
      raise exception 'Předání do výroby nejde vrátit (není poslední nebo už bylo vráceno).' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if exists (select 1 from production_handoffs h where h.job_id = p_job and h.id <> v_handoff and h.id <> v_undo.id
               and h.undone_at is null and h.created_at > v_undo.created_at and h.kind in ('predani', 'dalsi_krok', 'ukonceni', 'zaznam')) then
      raise exception 'Po tomto předání už výroba pokračovala — vrátit jde jen poslední předání.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    -- kroky vraceného předání z jeho výsledku (handoff_id kroku přepíše pozdější doplnění / plán)
    v_undo_ops := array(select app_uuid(x) from jsonb_array_elements_text(coalesce(v_undo.result->'operationIds', '[]'::jsonb)) x);
    if exists (select 1 from job_operations where id = any(v_undo_ops) and job_id = p_job and status = 'hotovo') then
      raise exception 'Krok z tohoto předání je už hotový — předání nejde vrátit.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    select number into v_number from purchase_orders
    where handoff_id = v_undo.id and status not in ('navrh', 'vystavena', 'zrusena') order by number limit 1;
    if v_number is not null then
      raise exception 'Objednávka % už odešla dodavateli — nejdřív ji stornuj v Nákupu (obchodník/admin), pak předání vrať.', v_number
        using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if v_actor is not null and v_undo.created_by is distinct from v_actor
       and not exists (select 1 from profiles p where p.id = v_actor and p.role in ('super_admin', 'obchodnik')) then
      raise exception 'Předání vrátí ten, kdo ho udělal, nebo obchodník / admin.' using errcode = '42501', hint = 'FORBIDDEN'; end if;

    for r in select id, status from job_operations where id = any(v_undo_ops) and job_id = p_job and status in ('probiha', 'problem') loop
      update job_operations set status = 'ceka' where id = r.id;
      if v_ctx = 'app' then
        perform production_event(p_job, 'Výroba: ' || production_step_label(r.id) || ' → Čeká (předání vráceno)',
          jsonb_build_object('production', 'status', 'operationId', r.id, 'from', r.status, 'to', 'ceka', 'handoffId', v_handoff), 'operation', r.id);
      end if;
    end loop;
    for r in select id, number from purchase_orders where handoff_id = v_undo.id and status in ('navrh', 'vystavena') loop
      update job_operations set purchase_order_id = null, po_mode = 'vystavit' where purchase_order_id = r.id and job_id = p_job;
      update purchase_orders set status = 'zrusena', cancel_reason = 'Předání vráceno' where id = r.id;
      if v_ctx = 'app' then
        perform production_event(p_job, 'Objednávka ' || coalesce(r.number, '') || ' zrušena — Předání vráceno',
          jsonb_build_object('purchaseOrderId', r.id, 'reason', 'Předání vráceno', 'handoffId', v_handoff), 'purchase_order', r.id);
      end if;
    end loop;
    update orders set status = coalesce(v_undo.stage_from, 'potvrzeno'), production_finished_at = null, production_finished_by = null
    where id = p_job;
    update production_handoffs set undone_at = now(), undone_by = v_actor where id = v_undo.id;
    perform production_event(p_job, 'Předání do výroby vráceno' || coalesce(' — ' || nullif(btrim(coalesce(p_payload->>'note', '')), ''), ''),
      jsonb_build_object('production', 'zpet', 'handoffId', v_handoff, 'undoneHandoffId', v_undo.id), 'job', p_job);
    v_result := jsonb_build_object('handoffId', v_handoff, 'kind', p_kind, 'stageFrom', v_job.status,
      'stage', (select status from orders where id = p_job), 'operationIds', '[]'::jsonb, 'startedOperationId', null,
      'completedOperationId', null, 'purchaseOrders', '[]'::jsonb, 'undoneHandoffId', v_undo.id, 'replayed', false);
    update production_handoffs set result = v_result, undone_handoff_id = v_undo.id,
                                   stage_to = (select status from orders where id = p_job) where id = v_handoff;
    perform set_config('app.production_handoff', '', true);     -- „uvnitř předání" jen po dobu volání
    return v_result;
  end if;

  -- c) dokončení: JEN běžící krok; převzetí od dodavatele po položkách (jen server s právem margins)
  if v_complete is not null then
    select purchase_order_id into v_complete_po from job_operations
    where id = v_complete and job_id = p_job and status in ('probiha', 'problem') for update;
    if not found then raise exception 'Krok mezitím změnil stav — obnov stránku.' using errcode = 'P0001', hint = 'STEP_CHANGED'; end if;
    if jsonb_typeof(p_payload #> '{complete,receipts}') = 'array' and jsonb_array_length(p_payload #> '{complete,receipts}') > 0 then
      if v_complete_po is null or not exists (select 1 from purchase_orders where id = v_complete_po and job_id = p_job
                                                and status in ('vystavena', 'odeslana', 'potvrzena')) then
        raise exception 'Krok nemá otevřenou objednávku k převzetí.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
      v_text := null;
      for v_rec in select * from jsonb_array_elements(p_payload #> '{complete,receipts}') loop
        if (v_rec->>'received')::numeric < 0 then raise exception 'Převzaté množství musí být 0 a víc.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
        update purchase_order_items set received_quantity = round((v_rec->>'received')::numeric, 3)
        where id = app_uuid(v_rec->>'itemId') and purchase_order_id = v_complete_po
          and received_quantity is distinct from round((v_rec->>'received')::numeric, 3)
        returning coalesce(nullif(drawing_number, ''), nullif(name, ''), 'položka') || ' ' || trim(to_char(received_quantity, 'FM999999990.###'), '.')
                  || '/' || trim(to_char(quantity, 'FM999999990.###'), '.') || ' ' || coalesce(nullif(unit, ''), 'ks') into v_label;
        if v_label is not null then v_text := coalesce(v_text || '; ', '') || v_label; end if;
        if not exists (select 1 from purchase_order_items where id = app_uuid(v_rec->>'itemId') and purchase_order_id = v_complete_po) then
          raise exception 'Položka nepatří k objednávce kroku.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
      end loop;
      select coalesce(bool_and(receipt_closed or received_quantity + 0.0000001 >= quantity), true) into v_all_received
      from purchase_order_items where purchase_order_id = v_complete_po;
      select number, (select name from suppliers s where s.id = po.supplier_id) into v_number, v_name
      from purchase_orders po where po.id = v_complete_po;
      if v_text is not null then
        perform production_event(p_job, 'Převzato od ' || coalesce(v_name, 'dodavatele') || ': ' || v_text || ' (objednávka ' || coalesce(v_number, '') || ')',
          jsonb_build_object('purchaseOrderId', v_complete_po, 'lines', v_text, 'handoffId', v_handoff), 'purchase_order', v_complete_po);
      end if;
      if v_all_received then
        update purchase_orders set status = 'dodana' where id = v_complete_po and status in ('vystavena', 'odeslana', 'potvrzena');
        if v_ctx = 'app' then
          perform production_event(p_job, 'Objednávka ' || coalesce(v_number, '') || ' dodána',
            jsonb_build_object('purchaseOrderId', v_complete_po, 'handoffId', v_handoff), 'purchase_order', v_complete_po);
        end if;
      elsif not coalesce((p_payload #>> '{complete,continueWithoutRest}')::boolean, false) then
        v_finish_step := false;     -- „Počkat na zbytek": krok běží dál, objednávka zůstává otevřená
      end if;
    end if;
    if v_finish_step then
      select status into v_cur_status from job_operations where id = v_complete;
      update job_operations set status = 'hotovo' where id = v_complete;
      if v_ctx = 'app' then
        perform production_event(p_job, 'Výroba: ' || production_step_label(v_complete) || ' → Hotovo'
          || coalesce(' · díl jde dál: ' || nullif(p_payload #>> '{complete,nextText}', ''), ''),
          jsonb_build_object('production', 'status', 'operationId', v_complete, 'from', v_cur_status, 'to', 'hotovo', 'handoffId', v_handoff),
          'operation', v_complete);
      end if;
    else
      v_complete := null;
    end if;
  end if;

  -- d) ukonceni: zbylé čekající kroky přeskočit; jejich nevyslané objednávky zrušit (jen když už žádný
  --    navázaný krok nezůstává), odeslané jen ze seznamu cancelSentPurchaseOrderIds (server: margins)
  if p_kind = 'ukonceni' then
    v_reason := nullif(btrim(coalesce(p_payload #>> '{finish,skipReason}', '')), '');
    if exists (select 1 from job_operations where job_id = p_job and status = 'ceka') and v_reason is null then
      raise exception 'Napiš, proč končíš výrobu dřív (zbylé kroky se přeskočí).' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    for r in select o.id, o.purchase_order_id from job_operations o where o.job_id = p_job and o.status = 'ceka'
             order by o.position, o.created_at loop
      v_label := production_step_label(r.id);
      update job_operations set status = 'preskoceno', note = left(coalesce(nullif(note, '') || E'\n', '') || 'Přeskočeno: ' || v_reason, 10000)
      where id = r.id;
      v_skipped := v_skipped + 1;
      v_skipped_ids := v_skipped_ids || r.id;
      if v_ctx = 'app' then
        perform production_event(p_job, 'Výroba: ' || v_label || ' → Přeskočeno — ' || v_reason,
          jsonb_build_object('production', 'status', 'operationId', r.id, 'from', 'ceka', 'to', 'preskoceno', 'handoffId', v_handoff), 'operation', r.id);
      end if;
    end loop;
    for r in select distinct po.id, po.number, po.status from purchase_orders po
             join job_operations o on o.purchase_order_id = po.id
             where po.job_id = p_job and o.id = any(v_skipped_ids)
               and po.status in ('navrh', 'vystavena', 'odeslana', 'potvrzena') loop
      if exists (select 1 from job_operations o where o.purchase_order_id = r.id and o.status <> 'preskoceno') then
        update job_operations set purchase_order_id = null where purchase_order_id = r.id and id = any(v_skipped_ids);  -- sdílená: jen odpojit
      elsif r.status in ('navrh', 'vystavena')
            or r.id in (select app_uuid(x) from jsonb_array_elements_text(coalesce(p_payload #> '{finish,cancelSentPurchaseOrderIds}', '[]')) x) then
        update purchase_orders set status = 'zrusena', cancel_reason = 'Výroba ukončena dřív — krok přeskočen' where id = r.id;
        if v_ctx = 'app' then
          perform production_event(p_job, 'Objednávka ' || coalesce(r.number, '') || ' zrušena — Výroba ukončena dřív — krok přeskočen',
            jsonb_build_object('purchaseOrderId', r.id, 'reason', 'Výroba ukončena dřív — krok přeskočen', 'handoffId', v_handoff), 'purchase_order', r.id);
        end if;
      else
        raise exception 'Krok má odeslanou objednávku % — ukončení udělá obchodník nebo admin.', coalesce(r.number, '')
          using errcode = 'P0001', hint = 'VALIDATION';
      end if;
    end loop;
    if exists (select 1 from job_operations where job_id = p_job and status in ('probiha', 'problem')) then
      raise exception 'Krok výroby ještě běží — nejdřív ho dokonči.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  end if;

  -- e) noví dodavatelé (firma mimo adresář s objednávkou) — v transakci, rollback nezanechá sirotka
  for v_sup in select * from jsonb_array_elements(coalesce(p_payload->'newSuppliers', '[]')) loop
    if nullif(btrim(coalesce(v_sup->>'name', '')), '') is null or nullif(v_sup->>'key', '') is null then
      raise exception 'Nový dodavatel nemá název.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    insert into suppliers (name, email, ico) values (left(btrim(v_sup->>'name'), 300), nullif(btrim(coalesce(v_sup->>'email', '')), ''),
      nullif(btrim(coalesce(v_sup->>'ico', '')), '')) returning id into v_sup_id;
    v_suppliers := v_suppliers || jsonb_build_object(v_sup->>'key', v_sup_id);
    perform production_event(p_job, 'Nový dodavatel v adresáři: ' || btrim(v_sup->>'name') || ' (při předání do výroby)',
      jsonb_build_object('supplierId', v_sup_id, 'handoffId', v_handoff), 'job', p_job);
  end loop;

  -- f) posuny pozic (server spočítá insertPositions) + odebrání konečného termínu před zápisem kroků (C.4)
  for v_step in select * from jsonb_array_elements(coalesce(p_payload->'shifts', '[]')) loop
    update job_operations set position = (v_step->>'position')::int where id = app_uuid(v_step->>'id') and job_id = p_job;
  end loop;
  if coalesce((p_payload->>'resetFinal')::boolean, false) then
    update job_operations set ends_at_customer_date = false where job_id = p_job and ends_at_customer_date;
  end if;

  -- g) objednávky (skupina = jedna objednávka pro souvislé kroky stejné firmy)
  v_reused := array(select distinct app_uuid(s->>'existingPurchaseOrderId') from jsonb_array_elements(coalesce(p_payload->'steps', '[]')) s
                    where app_uuid(s->>'existingPurchaseOrderId') is not null);
  for v_po in select * from jsonb_array_elements(coalesce(p_payload->'purchaseOrders', '[]')) loop
    v_sup_id := coalesce(app_uuid(v_po->>'supplierId'), app_uuid(v_suppliers->>(v_po->>'supplierKey')));
    v_name := null;
    select name into v_name from suppliers where id = v_sup_id;
    if v_name is null then raise exception 'Dodavatel nenalezen.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if nullif(v_po->>'group', '') is null then raise exception 'Objednávka bez skupiny kroků.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if jsonb_typeof(v_po->'items') is distinct from 'array' or jsonb_array_length(v_po->'items') = 0 then
      raise exception 'Objednávka % nemá položky.', v_name using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if app_uuid(v_po->>'supplierQuoteId') is not null and not exists (
         select 1 from supplier_quotes where id = app_uuid(v_po->>'supplierQuoteId') and job_id = p_job) then
      raise exception 'Nabídka dodavatele nepatří k této zakázce.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if exists (select 1 from jsonb_array_elements(v_po->'items') i where app_uuid(i->>'order_item_id') is not null
               and not exists (select 1 from order_items oi where oi.id = app_uuid(i->>'order_item_id') and oi.order_id = p_job)) then
      raise exception 'Položka objednávky nepatří k zakázce.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if exists (select 1 from jsonb_array_elements(v_po->'items') i
               where coalesce(nullif(i->>'quantity', '')::numeric, 0) <= 0 or coalesce(nullif(i->>'unit_price', '')::numeric, 0) < 0) then
      raise exception 'Neplatné množství nebo cena položky objednávky.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    -- druhá volná objednávka u stejné firmy ne; objednávky tohoto předání (A,B,A) a existující, které
    -- tohle předání použije u jiného kroku, volné nejsou; objednávka bez čísla se počítá taky
    select coalesce(po.number, '(bez čísla)') into v_number from purchase_orders po
    where po.job_id = p_job and po.supplier_id = v_sup_id
      and po.status in ('navrh', 'vystavena', 'odeslana', 'potvrzena')
      and po.handoff_id is distinct from v_handoff
      and po.id <> all(v_reused)
      and not exists (select 1 from job_operations o where o.purchase_order_id = po.id) limit 1;
    if found then
      raise exception '% už má k zakázce objednávku % — použij ji, nebo ji nejdřív zruš.', v_name, v_number
        using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if v_groups ? (v_po->>'group') then
      raise exception 'Dvě objednávky pro stejnou skupinu kroků.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    update supplier_quotes set supplier_id = v_sup_id where id = app_uuid(v_po->>'supplierQuoteId') and supplier_id is null;
    v_number := next_doc_number('OV');
    select coalesce(sum(round((i->>'quantity')::numeric * coalesce(nullif(i->>'unit_price', '')::numeric, 0), 2)), 0) into v_total
      from jsonb_array_elements(v_po->'items') i;
    insert into purchase_orders (job_id, supplier_id, supplier_quote_id, number, status, order_date, required_date, currency, total,
      delivery_terms, payment_terms, delivery_address, note, created_by, handoff_id)
    values (p_job, v_sup_id, app_uuid(v_po->>'supplierQuoteId'), v_number, 'vystavena', v_today, nullif(v_po->>'requiredDate', '')::date,
      coalesce(nullif(v_po->>'currency', ''), v_job.currency, 'CZK'), v_total, nullif(v_po->>'deliveryTerms', ''), nullif(v_po->>'paymentTerms', ''),
      nullif(v_po->>'deliveryAddress', ''), nullif(v_po->>'note', ''), v_actor, v_handoff)
    returning id into v_po_id;
    insert into purchase_order_items (purchase_order_id, position, drawing_number, name, material, quantity, unit, unit_price, note, order_item_id)
    select v_po_id, coalesce(nullif(i->>'position', '')::int, (o.n - 1)::int), nullif(i->>'drawing_number', ''), nullif(i->>'name', ''),
           nullif(i->>'material', ''), round((i->>'quantity')::numeric, 3), coalesce(nullif(i->>'unit', ''), 'ks'),
           nullif(i->>'unit_price', '')::numeric, nullif(i->>'note', ''), app_uuid(i->>'order_item_id')
    from jsonb_array_elements(v_po->'items') with ordinality as o(i, n);
    update orders set supplier_id = coalesce(supplier_id, v_sup_id),
                      supplier_order_number = coalesce(nullif(btrim(supplier_order_number), ''), v_number)
    where id = p_job;
    insert into approval_queue (type, title, summary, payload, target, status, order_id, owner_id, purchase_order_id)
    values ('purchase_order', coalesce(nullif(v_po #>> '{queue,title}', ''), 'Objednávka ' || v_number || ' — ' || v_name),
            nullif(v_po #>> '{queue,summary}', ''),
            (case when jsonb_typeof(v_po #> '{queue,payload}') = 'object' then v_po #> '{queue,payload}' else '{}'::jsonb end)
              || jsonb_build_object('kind', 'issue', 'purchaseOrderId', v_po_id, 'number', v_number),
            nullif(v_po #>> '{queue,target}', ''), 'pending', p_job, coalesce(v_job.owner_id, v_actor), v_po_id)
    on conflict (purchase_order_id, (coalesce(payload->>'kind', 'issue'))) where status = 'pending' and purchase_order_id is not null do nothing;
    v_groups := v_groups || jsonb_build_object(v_po->>'group', v_po_id);
    v_pos := v_pos || jsonb_build_object('id', v_po_id, 'number', v_number, 'supplierId', v_sup_id, 'supplierName', v_name, 'group', v_po->>'group',
                                         'queueId', (select id from approval_queue where purchase_order_id = v_po_id and status = 'pending' limit 1));
    perform production_event(p_job, 'Vystavena objednávka ' || v_number || ' dodavateli ' || v_name
      || coalesce(' — požadovaný termín ' || production_cz_date(nullif(v_po->>'requiredDate', '')::date), '')
      || coalesce(' (' || nullif(v_po->>'stepsLabel', '') || ')', ''),
      jsonb_build_object('purchaseOrderId', v_po_id, 'number', v_number, 'supplierId', v_sup_id, 'requiredDate', v_po->>'requiredDate',
                         'auto', true, 'handoffId', v_handoff), 'purchase_order', v_po_id);
  end loop;

  -- h) kroky: úprava existujícího (čekající; u predani/doplneni i běžící aktuální — jen kdo/termín/objednávka, NIKDY stav ani druh)
  --    nebo nový krok; objednávka kroku = nová ze skupiny, existující (ověřená) nebo dosavadní
  if p_kind = 'zaznam' then
    -- zápis výroby zpětně: stav zakázky dřív než hotové kroky (bez mezikroku „Ve výrobě")
    update orders set status = v_stage_to, production_finished_at = now(), production_finished_by = v_actor where id = p_job;
  end if;
  for v_step in select * from jsonb_array_elements(coalesce(p_payload->'steps', '[]')) loop
    v_op := app_uuid(v_step->>'operationId');
    v_prev_po := null;
    v_zaznam_done := false;
    v_sup_id := coalesce(app_uuid(v_step->>'supplierId'), app_uuid(v_suppliers->>(v_step->>'supplierKey')));
    if v_sup_id is not null and not exists (select 1 from suppliers where id = v_sup_id) then
      raise exception 'Dodavatel kroku nenalezen.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if jsonb_typeof(v_step->'orderItemIds') = 'array' and jsonb_array_length(v_step->'orderItemIds') = 0 then
      raise exception 'Krok %: vyber aspoň jeden díl.', coalesce(v_step->>'index', '?') using errcode = 'P0001', hint = 'VALIDATION';
    elsif jsonb_typeof(v_step->'orderItemIds') = 'array' then
      select array_agg(app_uuid(x)) into v_items from jsonb_array_elements_text(v_step->'orderItemIds') x;
      if v_items is null or exists (select 1 from unnest(v_items) u where u is null
                                    or not exists (select 1 from order_items oi where oi.id = u and oi.order_id = p_job)) then
        raise exception 'Díly kroku nepatří k zakázce.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    else
      v_items := null;
    end if;
    v_existing := app_uuid(v_step->>'existingPurchaseOrderId');
    if v_existing is not null and not exists (
         select 1 from purchase_orders po where po.id = v_existing and po.job_id = p_job and po.status <> 'zrusena'
           and (v_sup_id is null or po.supplier_id = v_sup_id)) then
      raise exception 'Objednávka kroku nepatří k zakázce nebo dodavateli kroku.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    v_po_id := coalesce(app_uuid(v_groups->>(v_step->>'poGroup')), v_existing);
    v_who := coalesce((v_step->>'inHouse')::boolean, false) or v_sup_id is not null
             or nullif(btrim(coalesce(v_step->>'supplierName', '')), '') is not null;
    if nullif(v_step->>'plannedEnd', '') is null then
      raise exception 'Krok %: doplň termín.', coalesce(v_step->>'index', '?') using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if not v_who and (coalesce((v_step->>'start')::boolean, false) or coalesce((v_step->>'done')::boolean, false) or v_po_id is not null
                      or exists (select 1 from job_operations where id = v_op and status in ('probiha', 'problem'))) then
      raise exception 'Krok %: vyber, kdo to dělá (firma z adresáře, firma mimo adresář, nebo „U nás“).', coalesce(v_step->>'index', '?')
        using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if nullif(v_step->>'poGroup', '') is not null and app_uuid(v_groups->>(v_step->>'poGroup')) is null then
      raise exception 'Objednávka kroku chybí.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if app_uuid(v_step->>'supplierQuoteId') is not null and not exists (
         select 1 from supplier_quotes where id = app_uuid(v_step->>'supplierQuoteId') and job_id = p_job) then
      raise exception 'Nabídka dodavatele nepatří k této zakázce.' using errcode = 'P0001', hint = 'VALIDATION'; end if;

    if v_op is not null then
      select status, purchase_order_id into v_cur_status, v_prev_po from job_operations where id = v_op and job_id = p_job for update;
      if v_cur_status is null or not (v_cur_status = 'ceka'
           or (p_kind in ('predani', 'doplneni') and v_cur_status in ('probiha', 'problem'))) then
        raise exception 'Krok %: mezitím se změnil — obnov stránku.', coalesce(v_step->>'index', '?')
          using errcode = 'P0001', hint = 'STEP_CHANGED'; end if;
      if v_cur_status = 'ceka' then
        update job_operations set
          kind = coalesce(nullif(v_step->>'kind', ''), kind),
          title = case when v_step ? 'title' then nullif(btrim(coalesce(v_step->>'title', '')), '') else title end,
          position = coalesce(nullif(v_step->>'position', '')::int, position),
          order_item_ids = case when v_step ? 'orderItemIds' then v_items else order_item_ids end,
          planned_start = case when v_step ? 'plannedStart' then nullif(v_step->>'plannedStart', '')::date else planned_start end,
          note = case when v_step ? 'note' then nullif(btrim(coalesce(v_step->>'note', '')), '') else note end
        where id = v_op;
      end if;
      v_zaznam_done := p_kind = 'zaznam' and v_cur_status = 'ceka' and coalesce((v_step->>'done')::boolean, false);
      update job_operations set
        in_house = coalesce((v_step->>'inHouse')::boolean, false),
        supplier_id = case when coalesce((v_step->>'inHouse')::boolean, false) then null else v_sup_id end,
        supplier_name = case when coalesce((v_step->>'inHouse')::boolean, false) or v_sup_id is not null then null
                             else nullif(btrim(coalesce(v_step->>'supplierName', '')), '') end,
        planned_end = nullif(v_step->>'plannedEnd', '')::date,
        ends_at_customer_date = coalesce((v_step->>'endsAtCustomerDate')::boolean, false),
        deadline_state = nullif(v_step->>'deadlineState', ''),
        deadline_source = coalesce(nullif(v_step->>'deadlineSource', ''), deadline_source),
        who_source = coalesce(nullif(v_step->>'whoSource', ''), who_source),
        supplier_quote_id = case when v_step ? 'supplierQuoteId' then app_uuid(v_step->>'supplierQuoteId') else supplier_quote_id end,
        po_mode = case when coalesce((v_step->>'inHouse')::boolean, false) then null else nullif(v_step->>'poMode', '') end,
        po_none_reason = nullif(btrim(coalesce(v_step->>'poNoneReason', '')), ''),
        purchase_order_id = coalesce(v_po_id, purchase_order_id),
        handoff_id = v_handoff
      where id = v_op;
      -- zápis výroby zpětně: naplánovaný krok, který je hotový, se uzavře (jinak by zůstal „čeká" u dodané zakázky)
      if v_zaznam_done then
        update job_operations set status = 'hotovo' where id = v_op;
        if v_ctx = 'app' then
          perform production_event(p_job, 'Výroba: ' || production_step_label(v_op) || ' → Hotovo (zapsáno zpětně)',
            jsonb_build_object('production', 'status', 'operationId', v_op, 'from', 'ceka', 'to', 'hotovo', 'handoffId', v_handoff), 'operation', v_op);
        end if;
      end if;
    else
      v_position := nullif(v_step->>'position', '')::int;
      if v_position is null then
        select coalesce(max(position) + 1, 0) into v_position from job_operations where job_id = p_job;
      end if;
      insert into job_operations (job_id, position, kind, title, in_house, supplier_id, supplier_name, status, planned_start, planned_end,
        note, purchase_order_id, created_by, order_item_ids, ends_at_customer_date, deadline_state, deadline_source, who_source,
        supplier_quote_id, po_mode, po_none_reason, handoff_id)
      values (p_job, v_position, coalesce(nullif(v_step->>'kind', ''), 'vyroba'), nullif(btrim(coalesce(v_step->>'title', '')), ''),
        coalesce((v_step->>'inHouse')::boolean, false),
        case when coalesce((v_step->>'inHouse')::boolean, false) then null else v_sup_id end,
        case when coalesce((v_step->>'inHouse')::boolean, false) or v_sup_id is not null then null
             else nullif(btrim(coalesce(v_step->>'supplierName', '')), '') end,
        case when p_kind = 'zaznam' and coalesce((v_step->>'done')::boolean, false) then 'hotovo' else 'ceka' end,
        nullif(v_step->>'plannedStart', '')::date, nullif(v_step->>'plannedEnd', '')::date,
        nullif(btrim(coalesce(v_step->>'note', '')), ''), v_po_id, v_actor, v_items,
        coalesce((v_step->>'endsAtCustomerDate')::boolean, false), nullif(v_step->>'deadlineState', ''),
        nullif(v_step->>'deadlineSource', ''), nullif(v_step->>'whoSource', ''), app_uuid(v_step->>'supplierQuoteId'),
        case when coalesce((v_step->>'inHouse')::boolean, false) then null else nullif(v_step->>'poMode', '') end,
        nullif(btrim(coalesce(v_step->>'poNoneReason', '')), ''), v_handoff)
      returning id into v_op;
    end if;
    if v_existing is not null and app_uuid(v_groups->>(v_step->>'poGroup')) is null and v_existing is distinct from v_prev_po then
      select number into v_number from purchase_orders where id = v_existing;
      perform production_event(p_job, 'Objednávka ' || coalesce(v_number, '') || ' přiřazena ke kroku '
        || coalesce(nullif(v_step->>'index', '') || ': ', '') || production_step_label(v_op),
        jsonb_build_object('purchaseOrderId', v_existing, 'operationId', v_op, 'handoffId', v_handoff), 'purchase_order', v_existing);
    end if;
    v_ops := v_ops || v_op;
    if coalesce((v_step->>'start')::boolean, false) then v_start := v_op; v_starts := v_starts + 1; end if;
  end loop;

  -- invarianty: jeden start, konečný termín jen u posledního kroku, objednávky jen tohoto dodavatele
  if v_starts > 1 then raise exception 'Najednou může začít jen jeden krok.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  if v_starts > 0 and p_kind in ('plan', 'zaznam', 'ukonceni') then
    raise exception 'Při plánování se krok nespouští.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  if exists (select 1 from job_operations f where f.job_id = p_job and f.ends_at_customer_date and f.status <> 'preskoceno'
             and exists (select 1 from job_operations l where l.job_id = p_job and l.status <> 'preskoceno'
                         and (l.position, l.created_at) > (f.position, f.created_at))) then
    raise exception 'Konečný termín (zákazník) může mít jen poslední krok.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  if exists (select 1 from job_operations o join purchase_orders po on po.id = o.purchase_order_id
             where o.handoff_id = v_handoff and o.supplier_id is not null and po.supplier_id is distinct from o.supplier_id) then
    raise exception 'Objednávka kroku je u jiného dodavatele než krok.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
  -- každá nově vystavená objednávka patří aspoň jednomu kroku (žádná osiřelá objednávka ve frontě)
  if exists (select 1 from jsonb_array_elements(v_pos) p
             where not exists (select 1 from job_operations o where o.purchase_order_id = app_uuid(p->>'id') and o.job_id = p_job)) then
    raise exception 'Objednávka % nepatří k žádnému kroku.', (select p->>'number' from jsonb_array_elements(v_pos) p
      where not exists (select 1 from job_operations o where o.purchase_order_id = app_uuid(p->>'id')) limit 1)
      using errcode = 'P0001', hint = 'VALIDATION'; end if;
  -- zápis výroby zpětně: po zápisu nesmí zůstat otevřený krok (zakázka je za výrobou)
  if p_kind = 'zaznam' then
    select production_step_label(o.id) into v_label from job_operations o
    where o.job_id = p_job and o.status in ('ceka', 'probiha', 'problem') order by o.position, o.created_at limit 1;
    if found then
      raise exception 'Krok „%“ je ještě otevřený — v zápisu výroby ho označ jako hotový (nebo ho nejdřív přeskoč).', v_label
        using errcode = 'P0001', hint = 'VALIDATION'; end if;
  end if;

  -- i) stav zakázky (brána O1 vidí předání a připravený plán)
  if p_kind = 'predani' and v_job.status <> 've_vyrobe' then
    update orders set status = 've_vyrobe', production_finished_at = null, production_finished_by = null where id = p_job;
  elsif p_kind = 'ukonceni' then
    update orders set status = v_stage_to, production_finished_at = now(), production_finished_by = v_actor where id = p_job;
    v_summary := 'Výroba ukončena — '
      || flow_count_label((select count(*)::int from job_operations where job_id = p_job and status = 'hotovo'), 'krok hotový', 'kroky hotové', 'kroků hotových')
      || coalesce('; přeskočeno ' || nullif(v_skipped, 0), '') || '; ' || lower(job_stage_label(v_stage_to));
  end if;

  -- j) start kroku
  if v_start is not null then
    if exists (select 1 from job_operations where job_id = p_job and status in ('probiha', 'problem') and id <> v_start) then
      raise exception 'Jiný krok výroby ještě běží — nejdřív ho dokonči.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    if exists (select 1 from job_operations o, job_operations s where s.id = v_start and o.job_id = p_job and o.status = 'ceka'
               and (o.position, o.created_at) < (s.position, s.created_at)) then
      raise exception 'Krok, který začíná, musí být první nedokončený v postupu.' using errcode = 'P0001', hint = 'VALIDATION'; end if;
    select status into v_cur_status from job_operations where id = v_start;
    if v_cur_status = 'ceka' then
      update job_operations set status = 'probiha' where id = v_start;
      if v_ctx = 'app' then
        perform production_event(p_job, 'Výroba: ' || production_step_label(v_start) || ' → Probíhá ('
          || case when p_kind = 'predani' then 'předáno do výroby' else 'předáno dalšímu kroku' end || ')',
          jsonb_build_object('production', 'status', 'operationId', v_start, 'from', 'ceka', 'to', 'probiha', 'handoffId', v_handoff),
          'operation', v_start);
      end if;
    end if;
  end if;
  if jsonb_array_length(v_pos) > 0 then perform recompute_job_commission(p_job); end if;

  -- k) souhrn
  perform production_event(p_job, coalesce(nullif(p_payload->>'summary', ''), v_summary, case p_kind
      when 'predani' then 'Předáno do výroby' when 'doplneni' then 'Výroba: doplněno, kdo to dělá a termín'
      when 'dalsi_krok' then 'Výroba: předáno dalšímu kroku' when 'plan' then 'Výroba: postup naplánován'
      when 'zaznam' then 'Výroba zapsána zpětně' else 'Výroba: předání' end),
    jsonb_build_object('production', p_kind, 'handoffId', v_handoff, 'operationIds', to_jsonb(v_ops), 'purchaseOrders', v_pos,
                       'started', v_start, 'completed', v_complete)
      || case when p_kind in ('ukonceni', 'zaznam') then jsonb_build_object('target', v_stage_to, 'skipped', v_skipped) else '{}'::jsonb end,
    'job', p_job);
  v_result := jsonb_build_object('handoffId', v_handoff, 'kind', p_kind, 'stageFrom', v_job.status,
    'stage', (select status from orders where id = p_job), 'operationIds', to_jsonb(v_ops), 'startedOperationId', v_start,
    'completedOperationId', v_complete, 'purchaseOrders', v_pos, 'replayed', false);
  update production_handoffs set result = v_result, stage_to = (select status from orders where id = p_job) where id = v_handoff;
  perform set_config('app.production_handoff', '', true);       -- „uvnitř předání" jen po dobu volání
  return v_result;
end $$;
revoke all on function production_apply(uuid, uuid, text, job_stage, text, jsonb) from public, anon, authenticated;
grant execute on function production_apply(uuid, uuid, text, job_stage, text, jsonb) to service_role;

-- ============================================================
-- Dopočet starých dat (triggery vypnuté: žádné události, žádný auto-posun, updated_at beze změny).
-- Jako funkce: migrace ji zavolá jednou, test ji smí zavolat znovu (idempotentní) bez opakování celé migrace.
-- ============================================================
create or replace function production_handoff_backfill() returns void
language plpgsql security definer set search_path = public as $fn$
declare r record;
begin
alter table job_operations disable trigger user;
alter table orders         disable trigger user;

update job_operations o set
  deadline_state = case when o.in_house then 'plan'
                        when exists (select 1 from purchase_orders p where p.id = o.purchase_order_id and p.status in ('potvrzena', 'dodana')) then 'potvrzeno'
                        when exists (select 1 from purchase_orders p where p.id = o.purchase_order_id and p.status = 'odeslana') then 'pozadovano'
                        else 'odhad' end,
  deadline_source = coalesce(o.deadline_source, 'import'),
  deadline_changed_via = coalesce(o.deadline_changed_via, 'import')    -- *_changed_at/by zůstávají NULL: autoři jen z faktů
where o.planned_end is not null and o.deadline_state is null;
update job_operations set who_source = 'import', who_changed_via = coalesce(who_changed_via, 'import')
where who_source is null and (in_house or supplier_id is not null or nullif(btrim(coalesce(supplier_name, '')), '') is not null);
update job_operations set po_mode = 'existujici' where purchase_order_id is not null and po_mode is null and not in_house;
with last as (
  select distinct on (o.job_id) o.id, o.job_id, o.planned_end from job_operations o
  where o.status <> 'preskoceno' order by o.job_id, o.position desc, o.created_at desc)
update job_operations o set ends_at_customer_date = true
from last l join orders j on j.id = l.job_id
where o.id = l.id and l.planned_end is not null and l.planned_end = j.due_date      -- jen potvrzený termín, ne požadavek
  and not o.ends_at_customer_date
  and not exists (select 1 from job_operations x where x.job_id = o.job_id and x.ends_at_customer_date and x.status <> 'preskoceno');

-- souhrny řádků (= recompute_job_production, ale bez změny stavu zakázky a bez událostí)
with agg as (
  select job_id, max(planned_end) filter (where status in ('ceka','probiha','problem')) as end_open,
         max(planned_end) filter (where ends_at_customer_date and status <> 'preskoceno') as end_final
  from job_operations group by job_id),
cur as (
  select distinct on (o.job_id) o.* from job_operations o where o.status in ('ceka', 'probiha', 'problem')
  order by o.job_id, (o.status in ('probiha', 'problem')) desc, o.position, o.created_at),
num as (
  select c.id, c.job_id,
    (select count(*) from job_operations x where x.job_id = c.job_id and x.status <> 'preskoceno' and (x.position, x.created_at) <= (c.position, c.created_at))::int as n,
    (select count(*) from job_operations x where x.job_id = c.job_id and x.status <> 'preskoceno' and x.kind = c.kind and (x.position, x.created_at) <= (c.position, c.created_at))::int as k
  from cur c),
calc as (
  select agg.job_id, num.n, num.k, nullif(btrim(coalesce(cur.title, '')), '') as title, cur.planned_end as due,
         case when cur.id is null then null else cur.ends_at_customer_date end as due_final, cur.deadline_state as due_state,
         (select status::text from purchase_orders p where p.id = cur.purchase_order_id) as po_status,
         agg.end_open, agg.end_final
  from agg left join cur on cur.job_id = agg.job_id left join num on num.id = cur.id)
update orders j set
  production_step_no = calc.n, production_step_kind_no = calc.k, production_step_title = calc.title,
  production_due = calc.due, production_due_final = calc.due_final, production_due_state = calc.due_state,
  production_po_status = calc.po_status, production_end = calc.end_open, production_final_end = calc.end_final
from calc
where j.id = calc.job_id
  and (j.production_step_no, j.production_step_kind_no, j.production_step_title, j.production_due, j.production_due_final,
       j.production_due_state, j.production_po_status, j.production_end, j.production_final_end)
      is distinct from (calc.n, calc.k, calc.title, calc.due, calc.due_final, calc.due_state, calc.po_status, calc.end_open, calc.end_final);

alter table orders         enable trigger user;
alter table job_operations enable trigger user;

-- provize: zakázky, kterým se změnil náklad (objednávka bez ceny = neznámý), doplnění „čeká na objednávky"
-- a čekající provize ze zisku, která by byla „K výplatě"
for r in
  select e.order_id from commission_entries e cross join lateral job_cost(e.order_id) c
  where e.order_id is not null and e.status <> 'vyplaceno'
    and (e.cost_known is distinct from c.known or e.cost is distinct from round(c.cost, 2)
         or e.cost_pending_po is distinct from (case when not c.known then job_unpriced_purchase_orders(e.order_id) end)
         or (not e.cost_known and e.base is distinct from 'revenue' and e.status = 'k_vyplate'))
loop
  perform recompute_job_commission(r.order_id);
end loop;
end $fn$;
revoke all on function production_handoff_backfill() from public, anon, authenticated;
grant execute on function production_handoff_backfill() to service_role;

do $$ begin perform production_handoff_backfill(); end $$;

-- oprávnění nových funkcí (vnitřní přepočty jen DB a servisní role)
do $$
declare f text;
begin
  foreach f in array array['production_cz_date(date)', 'operation_kind_label(text)', 'drawing_norm(text)',
                           'production_step_ready(boolean,uuid,text,date)', 'production_step_startable(boolean,uuid,text,date,uuid,text)',
                           'production_handoff_enforced()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
end $$;

notify pgrst, 'reload schema';
