-- ============================================================
-- 20261023100000 — Podrobné stavy obchodního toku + „kdo to udělal"
--  * dílčí stavy: poptávka (orders.inquiry_status), objednávka zákazníka
--    (orders.order_status + job_order_revisions), potvrzení (fakta), nabídka
--    (quotes.state — odvozuje trigger), důvod prohry (lost_reason), návrhy (flow_proposal)
--  * dodání po položkách (order_items.delivered_quantity / delivery_closed),
--    převzetí od dodavatele (purchase_order_items.received_quantity),
--    úhrady (job_payments + zrcadlo přímých zápisů orders.paid_*)
--  * atribuce: hlavičky jen u servisní role → app_ctx()/app_actor();
--    triggery plní *_by/at/via a historii; session přes REST nic cizího nepřepíše
--  * historie jen přibývá; smazání audituje trigger; jméno autora i jako text
--  * odvozené stavy: view job_flow_v + flow_counts()
-- ============================================================

-- ── 0) Kdo změnu dělá ───────────────────────────────────────
create or replace function app_today() returns date
language sql stable set search_path = public as $$ select (now() at time zone 'Europe/Prague')::date $$;

/** Servisní klíč: claims (PostgREST, JWT z brány u sb_secret_…) nebo SET ROLE service_role (M9). */
create or replace function app_is_service() returns boolean
language sql stable set search_path = public as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role'
      or coalesce(current_setting('role', true), '') = 'service_role'
$$;

/** Hlavička požadavku — JEN u servisní role (session ani anon ji nepodvrhnou; minor 5). */
create or replace function app_header(p_name text) returns text
language sql stable set search_path = public as $$
  select case when app_is_service() then
    nullif(btrim(nullif(current_setting('request.headers', true), '')::jsonb ->> lower(p_name)), '')
  end
$$;

create or replace function app_uuid(p text) returns uuid
language plpgsql immutable set search_path = public as $$
begin
  if p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return p::uuid; end if;
  return null;
end $$;

/** session (REST s přihlášením) | app (náš server) | service (servisní klíč bez hlaviček) | db (psql, GoTrue, migrace). */
create or replace function app_ctx() returns text
language sql stable set search_path = public as $$
  select case
    when auth.uid() is not null then 'session'
    when app_is_service() and app_header('x-actor-kind') in ('user', 'ai', 'system') then 'app'
    when app_is_service() then 'service'
    else 'db' end
$$;

/** Autor: přihlášený (ověřený proti profiles) > hlavička serveru (jen servisní role, ověřená) > nikdo. */
create or replace function app_actor() returns uuid
language sql stable security definer set search_path = public as $$
  select p.id from profiles p
  where p.id = coalesce(auth.uid(), case when app_is_service() then app_uuid(app_header('x-actor-id')) end)
$$;

create or replace function app_actor_kind() returns text
language sql stable set search_path = public as $$
  select case app_ctx()
    when 'session' then 'user'
    when 'app' then app_header('x-actor-kind')
    else case when app_actor() is not null then 'user' else 'system' end end
$$;

create or replace function app_actor_via() returns text
language sql stable set search_path = public as $$
  select case app_ctx()
    when 'session' then 'rest'
    when 'app' then coalesce(
      case when app_header('x-actor-via') in ('rucne', 'ai', 'foto', 'email', 'automaticky', 'import', 'cron')
           then app_header('x-actor-via') end,
      case app_header('x-actor-kind') when 'ai' then 'ai' when 'system' then 'automaticky' else 'rucne' end)
    else 'db' end
$$;

create or replace function app_actor_agent() returns text
language sql stable set search_path = public as $$
  select h from (select app_header('x-actor-agent') as h) s where h ~ '^[a-z0-9_-]{1,40}$'
$$;

create or replace function app_request_id() returns uuid
language sql stable set search_path = public as $$ select app_uuid(app_header('x-actor-request')) $$;

/** Poznámka ke změně — UTF-8 v base64url (hlavičky jsou ASCII), max. 500 znaků. */
create or replace function app_change_note() returns text
language plpgsql stable set search_path = public as $$
declare
  v text := app_header('x-change-note');
  b text;
begin
  -- (PostgreSQL regex povolí opakování max. 255 → délka zvlášť)
  if v is null or length(v) > 1400 or v !~ '^[A-Za-z0-9_-]+$' then return null; end if;   -- bez subtransakce v běžném případě
  b := translate(v, '-_', '+/');
  b := b || repeat('=', (4 - length(b) % 4) % 4);
  begin
    return left(nullif(btrim(convert_from(decode(b, 'base64'), 'UTF8')), ''), 500);
  exception when others then
    return null;
  end;
end $$;

/** Kdo se zapíše do *_by: session = vždy přihlášený; náš server = hlavička, jinak hodnota zápisu;
 *  psql/skript = hodnota zápisu (seed). */
create or replace function app_pick(p_explicit uuid) returns uuid
language sql stable set search_path = public as $$
  select case app_ctx()
    when 'session' then app_actor()
    when 'app' then coalesce(app_actor(), p_explicit)
    else coalesce(p_explicit, app_actor()) end
$$;

/** Atribuční sloupec při NEZMĚNĚNÉM stavu: přes REST (session) ho nejde přepsat;
 *  NULL od FK kaskády (profil už neexistuje) a vše mimo session projde (B2). */
create or replace function app_keep(p_new uuid, p_old uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null or p_new is not distinct from p_old then p_new
    when p_new is null and not exists (select 1 from profiles where id = p_old) then null
    else p_old end
$$;

/** Totéž pro razítka a texty (bez FK). */
create or replace function app_keep_any(p_new anyelement, p_old anyelement) returns anyelement
language sql stable set search_path = public as $$ select case when auth.uid() is null then p_new else p_old end $$;

/** Druh autora do historie: náš server řekne sám (user/ai/system), jinak podle autora (M7). */
create or replace function app_event_kind(p_by uuid) returns text
language sql stable set search_path = public as $$
  select case when app_ctx() = 'app' then app_actor_kind() when p_by is not null then 'user' else 'system' end
$$;

/** Smí autor rozhodnout konec toku (odmítnutí, storno, zamítnutí, schválení, odeslání nabídky)?
 *  = právo „margins" v aplikaci (obchodník, super admin). Bez autora (systém, psql) ano. */
create or replace function app_actor_may_decide() returns boolean
language sql stable security definer set search_path = public as $$
  select case when app_actor() is null then true
    else coalesce((select p.role in ('super_admin', 'obchodnik') from profiles p where p.id = app_actor()), false) end
$$;

/** Hlídat práva rozhodnutí u tohoto zápisu? Přímý zápis člověka (REST nebo náš server), ne vnořený posun DB
 *  a ne zápis faktu z dokladu (fotka / e-mail / import — náš server, např. vyfocená odeslaná nabídka). */
create or replace function app_guard_decisions() returns boolean
language sql stable set search_path = public as $$
  select pg_trigger_depth() = 1 and app_ctx() in ('session', 'app') and app_actor_kind() = 'user'
     and app_actor_via() not in ('foto', 'email', 'import') and not app_actor_may_decide()
$$;

/** Diagnostika (testy, smoke po nasazení): co DB vidí jako autora. */
create or replace function app_whoami() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ctx', app_ctx(), 'uid', auth.uid(), 'actor', app_actor(), 'kind', app_actor_kind(), 'via', app_actor_via(),
    'agent', app_actor_agent(), 'request', app_request_id(), 'note', app_change_note(),
    'service', app_is_service(), 'today', app_today())
$$;

-- ── 1) Pořadí, popisky, výchozí dílčí stavy (TS test hlídá shodu) ──
create or replace function job_stage_rank(p job_stage) returns int
language sql immutable set search_path = public as $$
  select case p
    when 'poptavka' then 0 when 'naceneni' then 1 when 'nabidka' then 2 when 'objednavka' then 3
    when 'potvrzeno' then 4 when 've_vyrobe' then 5 when 'dodano_k_nam' then 6 when 'na_sklade' then 7
    when 'montaz' then 8 when 'dodano_zakaznikovi' then 9 when 'fakturovano' then 10 when 'dokonceno' then 11
    else -1 end
$$;

create or replace function job_stage_label(p job_stage) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'poptavka' then 'Poptávka' when 'naceneni' then 'Nacenění' when 'nabidka' then 'Nabídka odeslaná'
    when 'objednavka' then 'Objednávka' when 'potvrzeno' then 'Potvrzená objednávka' when 've_vyrobe' then 'Ve výrobě'
    when 'dodano_k_nam' then 'Dodáno k nám' when 'na_sklade' then 'Na skladě' when 'montaz' then 'Montáž'
    when 'dodano_zakaznikovi' then 'Dodáno zákazníkovi' when 'fakturovano' then 'Vyfakturováno'
    when 'dokonceno' then 'Dokončeno' when 'pozastaveno' then 'Pozastaveno' when 'reklamace' then 'Reklamace'
    when 'nerealizovano' then 'Nerealizováno' when 'zruseno' then 'Zrušeno' else '—' end
$$;

create or replace function flow_state_label(p_field text, p_key text) returns text
language sql immutable set search_path = public as $$
  select coalesce(case p_field
    when 'inquiry_status' then case p_key
      when 'prijata' then 'Přijatá' when 'v_reseni' then 'V řešení' when 'ceka_na_podklady' then 'Čeká na podklady'
      when 'zpracovana' then 'Zpracovaná' when 'odmitnuta' then 'Odmítnutá' when 'stazena' then 'Stažená zákazníkem' end
    when 'order_status' then case p_key
      when 'dorucena' then 'Doručená' when 'rozpor' then 'Rozpor s nabídkou' when 'potvrzena' then 'Potvrzená'
      when 'aktualizovana' then 'Aktualizovaná' when 'stornovana' then 'Stornovaná' end
    when 'quote_state' then case p_key
      when 'rozpracovana' then 'Rozpracovaná' when 'ke_schvaleni' then 'Čeká na schválení' when 'schvalena' then 'Schválená'
      when 'odeslana' then 'Odeslaná' when 'pripominky' then 'Připomínky zákazníka' when 'prijata' then 'Přijatá'
      when 'zamitnuta' then 'Zamítnutá' when 'archivovana' then 'Archivovaná' end
    when 'purchase_order_status' then case p_key
      when 'navrh' then 'Návrh' when 'vystavena' then 'Vystavena' when 'odeslana' then 'Odeslána'
      when 'potvrzena' then 'Potvrzena' when 'dodana' then 'Dodána' when 'zrusena' then 'Zrušena' end
    when 'operation_status' then case p_key
      when 'ceka' then 'Čeká' when 'probiha' then 'Probíhá' when 'hotovo' then 'Hotovo'
      when 'problem' then 'Problém' when 'preskoceno' then 'Přeskočeno' end
    when 'invoice_status' then case p_key
      when 'vystavena' then 'Vystavená' when 'odeslana' then 'Odeslaná' when 'uhrazena' then 'Uhrazená'
      when 'po_splatnosti' then 'Po splatnosti' when 'stornovana' then 'Stornovaná' end
  end, p_key, '—')
$$;

create or replace function lost_reason_label(p text) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'nevyrabime' then 'Nevyrábíme (technologie)' when 'kapacita' then 'Nestíháme (kapacita / termín)'
    when 'nevyplati_se' then 'Nevyplatí se (cena / objem)' when 'duplicita' then 'Duplicitní poptávka'
    when 'cena' then 'Cena' when 'termin' then 'Termín dodání' when 'jiny_dodavatel' then 'Vybral jiného dodavatele'
    when 'projekt_zrusen' then 'Projekt zrušen' when 'bez_odezvy' then 'Bez odezvy'
    when 'zakaznik_stahl' then 'Zákazník stáhl poptávku' when 'jine' then 'Jiný důvod'
    when 'neuvedeno' then 'Důvod neuveden' else coalesce(p, 'Důvod neuveden') end
$$;

create or replace function flow_cause_label(p text) returns text
language sql immutable set search_path = public as $$
  select case p
    when 'vyroba' then 'výroba začala' when 'platba' then 'platba' when 'nabidka' then 'nabídka'
    when 'dodani' then 'vše dodáno' when 'poptavka' then 'poptávka uzavřena' when 'objednavka' then 'objednávka'
    when 'obnoveni' then 'obnoveno' when 'podklady' then 'přišly podklady' when 'potvrzeni' then 'potvrzení odesláno'
    when 'uzavreni' then 'zakázka uzavřena' when 'prijeti' then 'objednáno — nabídka přijata'
    else p end
$$;

/** „1 rozdíl", „3 rozdíly", „5 rozdílů". */
create or replace function flow_count_label(p_n int, p_one text, p_few text, p_many text) returns text
language sql immutable set search_path = public as $$
  select p_n || ' ' || case when abs(p_n) = 1 then p_one when abs(p_n) between 2 and 4 then p_few else p_many end
$$;

/** Výchozí stav poptávky jen z polí zakázky — stejné pro INSERT i backfill (integrita minor 1). */
create or replace function flow_initial_inquiry(p_status job_stage, p_source text, p_inquiry_date date,
  p_inquiry_number text, p_order_date date, p_order_number text, p_priced_by uuid) returns text
language sql immutable set search_path = public as $$
  select case
    when job_stage_rank(p_status) >= 3 and p_inquiry_date is null
         and nullif(btrim(coalesce(p_inquiry_number, '')), '') is null
      then null                                                     -- bez poptávky (opakovaná objednávka)
    when job_stage_rank(p_status) >= 2 then 'zpracovana'
    when p_status = 'naceneni' then 'v_reseni'
    when p_status = 'poptavka' then
      case when coalesce(p_source, 'manual') = 'manual' or p_priced_by is not null then 'v_reseni' else 'prijata' end
    when p_status in ('pozastaveno', 'reklamace') then
      case when p_status = 'reklamace' or p_order_date is not null or p_order_number is not null
           then 'zpracovana' else 'v_reseni' end
    when p_status in ('nerealizovano', 'zruseno') then
      case when p_order_date is not null or p_order_number is not null then 'zpracovana' else 'stazena' end
    else 'prijata' end
$$;

create or replace function flow_initial_order(p_status job_stage, p_order_date date, p_order_number text,
  p_confirmed_at timestamptz) returns text
language sql immutable set search_path = public as $$
  select case
    when job_stage_rank(p_status) between 0 and 2 then null
    when p_status = 'objednavka' then 'dorucena'
    when job_stage_rank(p_status) >= 4 or p_status = 'reklamace' then 'potvrzena'
    when p_status = 'pozastaveno' then
      case when p_confirmed_at is not null then 'potvrzena'
           when p_order_date is not null or p_order_number is not null then 'dorucena' end
    when p_status = 'zruseno' and (p_order_date is not null or p_order_number is not null) then 'stornovana'
  end
$$;

create or replace function quote_state_of(p_status quote_status, p_approved_by uuid, p_archived boolean,
  p_feedback_at timestamptz, p_sent_at timestamptz, p_approval_required boolean) returns text
language sql immutable set search_path = public as $$
  select case
    when p_status = 'prijato' then 'prijata'
    when p_status = 'zamitnuto' then 'zamitnuta'
    when coalesce(p_archived, false) then 'archivovana'
    when p_status = 'odeslano' and p_feedback_at is not null and (p_sent_at is null or p_feedback_at >= p_sent_at) then 'pripominky'
    when p_status = 'odeslano' then 'odeslana'
    when p_approved_by is not null then 'schvalena'
    when coalesce(p_approval_required, false) then 'ke_schvaleni'
    else 'rozpracovana' end
$$;

/** Musí nabídku před odesláním schválit člověk? (AI v režimu se schválením / žádost / nad limitem — M1) */
create or replace function quote_approval_required(p_ai boolean, p_total numeric, p_requested timestamptz) returns boolean
language sql stable security definer set search_path = public as $$
  select (coalesce(p_ai, false)
          and coalesce((select mode::text from automation_settings where module = 'quote'),
                       (select mode::text from automation_global limit 1), 'approval') = 'approval')
      or p_requested is not null
      or coalesce(p_total, 0) > coalesce(
           (select case when btrim(value) ~ '^\d+([.,]\d+)?$' then replace(btrim(value), ',', '.')::numeric end
              from integration_settings where key = 'quote_approval_limit'),
           'Infinity'::numeric)
$$;

-- ── 2) Nové sloupce ─────────────────────────────────────────
-- orders: dílčí stavy, revize, potvrzení, prohra, návrh, atribuce, agregáty položek, úhrady
alter table orders add column if not exists inquiry_status              text;           -- null = bez poptávky
alter table orders add column if not exists inquiry_status_changed_at   timestamptz;
alter table orders add column if not exists inquiry_status_changed_by   uuid references profiles(id) on delete set null;
alter table orders add column if not exists inquiry_status_changed_via  text;
alter table orders add column if not exists waiting_since               timestamptz;    -- čeká na podklady od
alter table orders add column if not exists waiting_note                text;           -- co chybí
alter table orders add column if not exists order_status                text;           -- null = objednávka ještě není
alter table orders add column if not exists order_status_changed_at     timestamptz;
alter table orders add column if not exists order_status_changed_by     uuid references profiles(id) on delete set null;
alter table orders add column if not exists order_status_changed_via    text;
alter table orders add column if not exists order_mismatch              jsonb;          -- rozpor proti nabídce (kap. 1.4)
alter table orders add column if not exists order_revision              int not null default 0;  -- poslední přijatá od zákazníka
alter table orders add column if not exists order_confirmed_revision    int;            -- kterou jsme přijali / potvrdili
alter table orders add column if not exists order_changed_at            timestamptz;
alter table orders add column if not exists order_changed_by            uuid references profiles(id) on delete set null;
alter table orders add column if not exists confirmed_by                uuid references profiles(id) on delete set null;
alter table orders add column if not exists confirmation_issued_at      timestamptz;    -- NÁŠ doklad vystaven (origin = generated)
alter table orders add column if not exists confirmation_issued_by      uuid references profiles(id) on delete set null;
alter table orders add column if not exists confirmation_issued_revision int;
alter table orders add column if not exists confirmation_sent_at        timestamptz;    -- jen fakta odeslání (e-mail / jinak)
alter table orders add column if not exists confirmation_sent_by        uuid references profiles(id) on delete set null;
alter table orders add column if not exists confirmation_sent_via       text;
alter table orders add column if not exists confirmation_sent_revision  int;
alter table orders add column if not exists lost_reason                 text;
alter table orders add column if not exists lost_note                   text;
alter table orders add column if not exists lost_at                     timestamptz;
alter table orders add column if not exists lost_by                     uuid references profiles(id) on delete set null;
alter table orders add column if not exists flow_proposal               jsonb;          -- návrh změny (kap. 1.9)
alter table orders add column if not exists flow_proposal_at            timestamptz;
alter table orders add column if not exists flow_proposal_by            uuid references profiles(id) on delete set null;
alter table orders add column if not exists stage_changed_by            uuid references profiles(id) on delete set null;
alter table orders add column if not exists stage_changed_via           text;
alter table orders add column if not exists stage_change_cause          text;
alter table orders add column if not exists stage_change_note           text;
alter table orders add column if not exists updated_by                  uuid references profiles(id) on delete set null;
alter table orders add column if not exists delivery_note_confirmed_by  uuid references profiles(id) on delete set null;
alter table orders add column if not exists invoiced_by                 uuid references profiles(id) on delete set null;
alter table orders add column if not exists invoice_sent_at             timestamptz;
alter table orders add column if not exists invoice_sent_by             uuid references profiles(id) on delete set null;
alter table orders add column if not exists paid_by                     uuid references profiles(id) on delete set null;
alter table orders add column if not exists paid_so_far                 numeric(14,2) not null default 0;  -- Σ úhrad (bez DPH)
alter table orders add column if not exists items_count                 int not null default 0;
alter table orders add column if not exists items_priced                int not null default 0;
alter table orders add column if not exists items_delivered             int not null default 0;  -- dodané nebo uzavřené
alter table orders add column if not exists items_partial               int not null default 0;
alter table orders add column if not exists last_delivery_at            timestamptz;
alter table orders add column if not exists partial_delivery_note       text;           -- zakázka bez položek
alter table orders add column if not exists partial_delivery_at         timestamptz;
alter table orders add column if not exists partial_delivery_by         uuid references profiles(id) on delete set null;

alter table order_items add column if not exists delivered_quantity     numeric(12,3) not null default 0;
alter table order_items add column if not exists delivered_changed_at   timestamptz;
alter table order_items add column if not exists delivered_changed_by   uuid references profiles(id) on delete set null;
alter table order_items add column if not exists delivery_closed        boolean not null default false;  -- uzavřeno s menším množstvím
alter table order_items add column if not exists delivery_closed_reason text;
alter table order_items add column if not exists delivery_closed_at     timestamptz;
alter table order_items add column if not exists delivery_closed_by     uuid references profiles(id) on delete set null;
alter table order_items add column if not exists created_by             uuid references profiles(id) on delete set null;
alter table order_items add column if not exists updated_by             uuid references profiles(id) on delete set null;

alter table quotes add column if not exists state                 text not null default 'rozpracovana';  -- jen pro čtení (trigger)
alter table quotes add column if not exists state_changed_at      timestamptz;
alter table quotes add column if not exists state_changed_by      uuid references profiles(id) on delete set null;
alter table quotes add column if not exists state_changed_via     text;
alter table quotes add column if not exists approval_required     boolean not null default false;        -- jen pro čtení (trigger)
alter table quotes add column if not exists approval_requested_at timestamptz;
alter table quotes add column if not exists approval_requested_by uuid references profiles(id) on delete set null;
alter table quotes add column if not exists sent_by               uuid references profiles(id) on delete set null;
alter table quotes add column if not exists sent_via              text;
alter table quotes add column if not exists accepted_at           timestamptz;
alter table quotes add column if not exists accepted_by           uuid references profiles(id) on delete set null;
alter table quotes add column if not exists rejected_at           timestamptz;
alter table quotes add column if not exists rejected_by           uuid references profiles(id) on delete set null;
alter table quotes add column if not exists lost_reason           text;
alter table quotes add column if not exists competitor_price      numeric(14,2);
alter table quotes add column if not exists feedback_at           timestamptz;    -- (quotes.feedback = text připomínek, existuje)
alter table quotes add column if not exists superseded_by         uuid references quotes(id) on delete set null;
alter table quotes add column if not exists updated_by            uuid references profiles(id) on delete set null;

alter table purchase_orders add column if not exists status_changed_at  timestamptz;
alter table purchase_orders add column if not exists status_changed_by  uuid references profiles(id) on delete set null;
alter table purchase_orders add column if not exists status_changed_via text;
alter table purchase_orders add column if not exists sent_by            uuid references profiles(id) on delete set null;
alter table purchase_orders add column if not exists confirmed_at       timestamptz;   -- kdy zapsáno (≠ confirmed_date = termín)
alter table purchase_orders add column if not exists confirmed_by       uuid references profiles(id) on delete set null;
alter table purchase_orders add column if not exists delivered_at       timestamptz;
alter table purchase_orders add column if not exists delivered_by       uuid references profiles(id) on delete set null;
alter table purchase_orders add column if not exists cancelled_at       timestamptz;
alter table purchase_orders add column if not exists cancelled_by       uuid references profiles(id) on delete set null;
alter table purchase_orders add column if not exists cancel_reason      text;
alter table purchase_orders add column if not exists updated_by         uuid references profiles(id) on delete set null;

alter table purchase_order_items add column if not exists received_quantity     numeric(12,3) not null default 0;
alter table purchase_order_items add column if not exists received_changed_at   timestamptz;
alter table purchase_order_items add column if not exists received_changed_by   uuid references profiles(id) on delete set null;
alter table purchase_order_items add column if not exists receipt_closed        boolean not null default false;
alter table purchase_order_items add column if not exists receipt_closed_reason text;
alter table purchase_order_items add column if not exists order_item_id         uuid references order_items(id) on delete set null;

alter table job_operations add column if not exists status_changed_at  timestamptz;
alter table job_operations add column if not exists status_changed_by  uuid references profiles(id) on delete set null;
alter table job_operations add column if not exists status_changed_via text;
alter table job_operations add column if not exists updated_by         uuid references profiles(id) on delete set null;

alter table supplier_quotes add column if not exists selected_at timestamptz;
alter table supplier_quotes add column if not exists selected_by uuid references profiles(id) on delete set null;
alter table supplier_quotes add column if not exists updated_by  uuid references profiles(id) on delete set null;

alter table invoices add column if not exists created_by        uuid references profiles(id) on delete set null;
alter table invoices add column if not exists updated_by        uuid references profiles(id) on delete set null;
alter table invoices add column if not exists status_changed_at timestamptz;
alter table invoices add column if not exists status_changed_by uuid references profiles(id) on delete set null;
alter table invoices add column if not exists sent_at           timestamptz;
alter table invoices add column if not exists sent_by           uuid references profiles(id) on delete set null;

alter table job_files add column if not exists origin         text;   -- generated | upload | capture | email | import
alter table job_files add column if not exists issuer         text;   -- my | zakaznik | dodavatel
alter table job_files add column if not exists order_revision int;    -- revize objednávky, kterou náš doklad pokrývá
alter table job_files add column if not exists archived_at    timestamptz;
alter table job_files add column if not exists archived_by    uuid references profiles(id) on delete set null;
alter table job_files add column if not exists updated_by     uuid references profiles(id) on delete set null;

alter table job_events add column if not exists actor_kind text not null default 'system';  -- user | ai | system
alter table job_events add column if not exists actor_name text;                            -- přežije smazání účtu
alter table job_events add column if not exists via        text;
alter table job_events add column if not exists agent      text;
alter table job_events add column if not exists entity     text not null default 'job';     -- job|inquiry|order|quote|…
alter table job_events add column if not exists entity_id  uuid;
alter table job_events add column if not exists request_id uuid;

alter table audit_log add column if not exists actor_kind text not null default 'system';
alter table audit_log add column if not exists actor_name text;
alter table audit_log add column if not exists via        text;
alter table audit_log add column if not exists request_id uuid;

alter table customers             add column if not exists created_by uuid references profiles(id) on delete set null;
alter table customers             add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table suppliers             add column if not exists created_by uuid references profiles(id) on delete set null;
alter table suppliers             add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table customer_contacts     add column if not exists created_by uuid references profiles(id) on delete set null;
alter table customer_contacts     add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table mailboxes             add column if not exists created_by uuid references profiles(id) on delete set null;
alter table mailboxes             add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table automation_global     add column if not exists updated_by uuid references profiles(id) on delete set null;
alter table commission_statements add column if not exists paid_by    uuid references profiles(id) on delete set null;
alter table commission_statements add column if not exists updated_by uuid references profiles(id) on delete set null;

-- ── 3) Nové tabulky ─────────────────────────────────────────
create table if not exists job_payments (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references orders(id) on delete cascade,
  paid_on       date not null default app_today(),
  amount        numeric(14,2) check (amount is null or amount >= 0),  -- bez DPH; null = celá / zbývající částka
  settles       boolean not null default false,                       -- vyrovnává zakázku („Zaplaceno")
  note          text,
  recorded_by   uuid references profiles(id) on delete set null,
  recorded_name text,
  via           text not null default 'rucne',
  updated_by    uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists job_order_revisions (
  id                    uuid primary key default gen_random_uuid(),
  job_id                uuid not null references orders(id) on delete cascade,
  revision              int not null check (revision >= 1),
  customer_order_number text,
  file_id               uuid references job_files(id) on delete set null,
  changes               jsonb,          -- [{ field, label, from, to }] — rozdíl proti předchozí revizi
  note                  text,
  decision              text not null default 'ceka',
  decided_at            timestamptz,
  decided_by            uuid references profiles(id) on delete set null,
  decision_note         text,
  created_by            uuid references profiles(id) on delete set null,
  created_via           text,
  created_at            timestamptz not null default now(),
  unique (job_id, revision)
);

-- ── 4) Backfill (triggery vypnuté: updated_at, provize ani historie se nehnou) ──
alter table orders              disable trigger user;
alter table quotes              disable trigger user;
alter table purchase_orders     disable trigger user;
alter table job_operations      disable trigger user;
alter table supplier_quotes     disable trigger user;
alter table invoices            disable trigger user;
alter table job_files           disable trigger user;
alter table job_payments        disable trigger user;
alter table job_order_revisions disable trigger user;

-- historie: druh, jméno, entita (značka: via is null)
update job_events e set
  actor_kind = case when e.actor_id is null then 'system' else 'user' end,
  actor_name = (select coalesce(nullif(btrim(p.full_name), ''), p.email) from profiles p where p.id = e.actor_id),
  via        = case when e.actor_id is null then 'db' else 'rucne' end,
  entity = case
    when e.type = 'stage' then 'job'                              -- i stage z nákupu (minor 2)
    when e.data ? 'purchaseOrderId' then 'purchase_order'
    when e.data->>'production' = 'status' then 'operation'
    when e.data ? 'supplierQuoteId' then 'supplier_quote'
    when e.data ? 'quoteId' then 'quote'
    when e.type = 'file' then 'file'
    else 'job' end,
  entity_id = coalesce(case
    when e.type = 'stage' then e.job_id
    when e.data ? 'purchaseOrderId' then app_uuid(e.data->>'purchaseOrderId')
    when e.data->>'production' = 'status' then app_uuid(e.data->>'operationId')
    when e.data ? 'supplierQuoteId' then app_uuid(e.data->>'supplierQuoteId')
    when e.data ? 'quoteId' then app_uuid(e.data->>'quoteId')
    when e.type = 'file' then app_uuid(e.data->>'fileId') end, e.job_id)
where e.via is null;

update audit_log a set
  actor_kind = case when a.actor_id is null then 'system' else 'user' end,
  actor_name = coalesce((select coalesce(nullif(btrim(p.full_name), ''), p.email) from profiles p where p.id = a.actor_id),
                        a.diff->>'byName'),
  via = case when a.actor_id is null then 'db' else 'rucne' end
where a.via is null;

-- naše vystavené doklady (podle události „Vystaven…") — jen ty se počítají jako vystavené potvrzení (M4)
update job_files f set origin = 'generated', issuer = 'my'
where f.origin is null
  and f.kind in ('potvrzeni', 'nabidka', 'dodaci_list', 'faktura', 'objednavka_vydana')
  and exists (select 1 from job_events e where e.job_id = f.job_id and e.type = 'file'
              and e.data->>'fileId' = f.id::text and e.message like 'Vystaven%');
-- doklady z (dávkového) focení
update job_files f set origin = 'capture' where f.origin is null and f.capture_id is not null;

-- dílčí stavy zakázky (značka: stage_changed_via is null)
update orders o set
  inquiry_status = flow_initial_inquiry(o.status, o.source, o.inquiry_date, o.customer_inquiry_number,
                                        o.order_date, o.customer_order_number, o.priced_by),
  order_status   = flow_initial_order(o.status, o.order_date, o.customer_order_number, o.confirmed_at)
where o.stage_changed_via is null;

update orders o set inquiry_status = 'v_reseni'          -- stejné pravidlo jako trigger nabídek při vložení
where o.stage_changed_via is null and o.inquiry_status = 'prijata'
  and exists (select 1 from quotes q where q.job_id = o.id);

update orders o set
  lost_reason = case when o.status in ('nerealizovano', 'zruseno') or o.inquiry_status in ('odmitnuta', 'stazena')
                       or o.order_status = 'stornovana' then 'neuvedeno' end,
  lost_at     = case when o.status in ('nerealizovano', 'zruseno') or o.inquiry_status in ('odmitnuta', 'stazena')
                       or o.order_status = 'stornovana' then o.stage_changed_at end,
  order_revision           = case when o.order_status is not null then 1 else 0 end,
  order_confirmed_revision = case when o.order_status = 'potvrzena' then 1 end,
  order_changed_at         = case when o.order_status is not null then coalesce(o.order_date::timestamptz, o.created_at) end,
  -- autoři JEN z faktů (odpovídající události), jinak NULL = „před zavedením evidence" (minor 2)
  stage_changed_by = (select e.actor_id from job_events e
                       where e.job_id = o.id and e.type = 'stage' and e.data->>'to' = o.status::text
                       order by e.created_at desc limit 1),
  confirmed_by = case when o.order_status = 'potvrzena' then
                   (select e.actor_id from job_events e where e.job_id = o.id and e.type = 'stage'
                      and e.data->>'to' = 'potvrzeno' order by e.created_at desc limit 1) end,
  delivery_note_confirmed_by = case when o.delivery_note_confirmed_at is not null then
                   (select e.actor_id from job_events e where e.job_id = o.id and e.data->>'production' = 'delivery_note'
                      order by e.created_at desc limit 1) end,
  invoiced_by = case when o.invoice_number is not null then
                   (select e.actor_id from job_events e where e.job_id = o.id and e.data->>'production' = 'invoice'
                      order by e.created_at desc limit 1) end,
  paid_by = case when o.paid_at is not null then
                   (select e.actor_id from job_events e where e.job_id = o.id and e.data->>'production' = 'paid'
                      and e.data->>'paidAt' is not null order by e.created_at desc limit 1) end,
  paid_so_far = case when o.paid_at is not null then coalesce(o.paid_amount, 0) else 0 end,
  inquiry_status_changed_via = case when o.inquiry_status is not null then 'db' end,
  order_status_changed_via   = case when o.order_status is not null then 'db' end,
  stage_changed_via = case when exists (select 1 from job_events e where e.job_id = o.id and e.type = 'stage'
                                          and e.data->>'to' = o.status::text) then 'rucne' else 'db' end
where o.stage_changed_via is null;

update orders o set order_status_changed_by = case
    when o.order_status = 'potvrzena' then o.confirmed_by
    else (select e.actor_id from job_events e where e.job_id = o.id and e.type = 'stage'
            and e.data->>'to' = 'objednavka' order by e.created_at desc limit 1) end
where o.order_status is not null and o.order_status_changed_via = 'db' and o.order_status_changed_by is null;

update orders o set confirmation_sent_at = e.created_at, confirmation_sent_by = e.actor_id,
                    confirmation_sent_via = 'email', confirmation_sent_revision = 1
from (select distinct on (job_id) job_id, created_at, actor_id from job_events
      where type = 'email' and data->>'kind' = 'potvrzeni' order by job_id, created_at desc) e
where e.job_id = o.id and o.confirmation_sent_at is null;

-- starší zakázky ve výrobě a dál: potvrzení proběhlo mimo systém (via db) — ne „bez dokladu"
-- (jinak by u všech svítilo „Odeslat potvrzení" místo dodání). Jen řádky z backfillu (via db).
update orders o set
  confirmation_sent_via = 'db',
  confirmation_sent_revision = coalesce(o.order_confirmed_revision, o.order_revision, 1)
where o.order_status = 'potvrzena' and o.order_status_changed_via = 'db'
  and o.confirmation_sent_at is null and o.confirmation_sent_revision is null
  and job_stage_rank(o.status) >= 5;

update orders o set confirmation_issued_at = f.created_at, confirmation_issued_by = f.uploaded_by,
                    confirmation_issued_revision = 1
from (select distinct on (job_id) job_id, created_at, uploaded_by from job_files
      where kind = 'potvrzeni' and origin = 'generated' and not archived order by job_id, created_at desc) f
where f.job_id = o.id and o.confirmation_issued_at is null;

update orders o set invoice_sent_at = e.created_at, invoice_sent_by = e.actor_id
from (select distinct on (job_id) job_id, created_at, actor_id from job_events
      where type = 'email' and data->>'kind' = 'faktura' order by job_id, created_at desc) e
where e.job_id = o.id and o.invoice_sent_at is null;

update orders o set items_count = s.cnt, items_priced = s.priced
from (select order_id, count(*)::int as cnt, (count(*) filter (where unit_price is not null))::int as priced
      from order_items group by order_id) s
where s.order_id = o.id;

insert into job_order_revisions (job_id, revision, customer_order_number, decision, decided_at, decided_by, created_via, created_at)
select o.id, 1, o.customer_order_number,
       case when o.order_status = 'potvrzena' or (o.order_status = 'stornovana' and o.confirmed_at is not null)
            then 'prijata' else 'ceka' end,
       case when o.order_status = 'potvrzena' then coalesce(o.confirmed_at, o.stage_changed_at) end,
       case when o.order_status = 'potvrzena' then o.confirmed_by end,
       'db', coalesce(o.order_date::timestamptz, o.created_at)
from orders o where o.order_status is not null
on conflict (job_id, revision) do nothing;

insert into job_payments (job_id, paid_on, amount, settles, recorded_by, recorded_name, via, note, created_at)
select o.id, o.paid_at, o.paid_amount, true, o.paid_by,
       (select coalesce(nullif(btrim(p.full_name), ''), p.email) from profiles p where p.id = o.paid_by),
       'db', 'Převzato při zavedení evidence úhrad', o.paid_at::timestamptz
from orders o
where o.paid_at is not null and not exists (select 1 from job_payments p where p.job_id = o.id);

-- nabídky: kdo odeslal / přijal / zamítl (z historie) → odvozený stav (značka: state_changed_via is null)
update quotes q set
  sent_by = case when q.status in ('odeslano', 'prijato', 'zamitnuto') then
    (select e.actor_id from job_events e where e.type = 'quote' and e.data->>'quoteId' = q.id::text
       and e.data->>'action' = 'sent' order by e.created_at desc limit 1) end,
  sent_via = case
    when exists (select 1 from job_events e join job_files f on f.id = app_uuid(e.data->>'fileId')
                 where e.type = 'email' and e.data->>'kind' = 'nabidka' and f.quote_id = q.id) then 'email'
    when q.sent_at is not null then 'rucne' end,
  accepted_by = case when q.status = 'prijato' then
    (select e.actor_id from job_events e where e.type = 'quote' and e.data->>'quoteId' = q.id::text
       and e.data->>'action' = 'accepted' order by e.created_at desc limit 1) end,
  accepted_at = case when q.status = 'prijato' then
    coalesce((select e.created_at from job_events e where e.type = 'quote' and e.data->>'quoteId' = q.id::text
       and e.data->>'action' = 'accepted' order by e.created_at desc limit 1), q.updated_at) end,
  rejected_by = case when q.status = 'zamitnuto' then
    (select e.actor_id from job_events e where e.type = 'quote' and e.data->>'quoteId' = q.id::text
       and e.data->>'action' = 'rejected' order by e.created_at desc limit 1) end,
  rejected_at = case when q.status = 'zamitnuto' then
    coalesce((select e.created_at from job_events e where e.type = 'quote' and e.data->>'quoteId' = q.id::text
       and e.data->>'action' = 'rejected' order by e.created_at desc limit 1), q.updated_at) end,
  lost_reason = case when q.status = 'zamitnuto' then 'neuvedeno' end,
  feedback_at = case when nullif(btrim(coalesce(q.feedback, '')), '') is not null then q.updated_at end,
  approval_required = quote_approval_required(q.ai_generated, q.total, null)
where q.state_changed_via is null;

update quotes q set
  state = quote_state_of(q.status, q.approved_by, q.archived, q.feedback_at, q.sent_at, q.approval_required),
  state_changed_via = 'db'
where q.state_changed_via is null;

update quotes q set
  state_changed_at = coalesce(case q.state when 'odeslana' then q.sent_at when 'prijata' then q.accepted_at
                                           when 'zamitnuta' then q.rejected_at when 'schvalena' then q.approved_at end,
                              q.updated_at, q.created_at),
  state_changed_by = case q.state when 'odeslana' then q.sent_by when 'prijata' then q.accepted_by
                                  when 'zamitnuta' then q.rejected_by when 'schvalena' then q.approved_by end
where q.state_changed_via = 'db' and q.state_changed_at is null;

update purchase_orders po set
  status_changed_at  = coalesce(ev.at, po.updated_at),
  status_changed_by  = coalesce(ev.actor, case when po.status = 'vystavena' then po.created_by end),
  status_changed_via = 'db',
  sent_by      = case when po.sent_at is not null then coalesce(snt.actor, case when po.status = 'odeslana' then ev.actor end) end,
  confirmed_at = case when po.status = 'potvrzena' then ev.at end,
  confirmed_by = case when po.status = 'potvrzena' then ev.actor end,
  delivered_at = case when po.status = 'dodana' then ev.at end,
  delivered_by = case when po.status = 'dodana' then ev.actor end,
  cancelled_at = case when po.status = 'zrusena' then ev.at end,
  cancelled_by = case when po.status = 'zrusena' then ev.actor end
from purchase_orders p2
left join lateral (select e.created_at as at, e.actor_id as actor from job_events e
                   where e.data->>'purchaseOrderId' = p2.id::text and e.data->>'statusTo' = p2.status::text
                   order by e.created_at desc limit 1) ev on true
left join lateral (select e.actor_id as actor from job_events e
                   where e.data->>'purchaseOrderId' = p2.id::text
                     and (e.type = 'email' or e.data->>'statusTo' = 'odeslana')
                   order by e.created_at desc limit 1) snt on true
where p2.id = po.id and po.status_changed_via is null;

update job_operations op set
  status_changed_at  = coalesce(ev.at, op.finished_at, op.started_at, op.updated_at),
  status_changed_by  = coalesce(ev.actor, case when op.status = 'ceka' then op.created_by end),
  status_changed_via = 'db'
from job_operations o2
left join lateral (select e.created_at as at, e.actor_id as actor from job_events e
                   where e.data->>'operationId' = o2.id::text and e.data->>'production' = 'status'
                     and e.data->>'to' = o2.status order by e.created_at desc limit 1) ev on true
where o2.id = op.id and op.status_changed_via is null;

update supplier_quotes sq set
  selected_at = coalesce(ev.at, sq.updated_at),
  selected_by = ev.actor
from supplier_quotes s2
left join lateral (select e.created_at as at, e.actor_id as actor from job_events e
                   where e.data->>'supplierQuoteId' = s2.id::text and e.data->>'action' = 'selected'
                   order by e.created_at desc limit 1) ev on true
where s2.id = sq.id and sq.selected and sq.selected_at is null;

update invoices set status_changed_at = updated_at where status_changed_at is null;

alter table orders              enable trigger user;
alter table quotes              enable trigger user;
alter table purchase_orders     enable trigger user;
alter table job_operations      enable trigger user;
alter table supplier_quotes     enable trigger user;
alter table invoices            enable trigger user;
alter table job_files           enable trigger user;
alter table job_payments        enable trigger user;
alter table job_order_revisions enable trigger user;

-- ── 5) Omezení (po backfillu) ───────────────────────────────
do $$ begin
  alter table orders add constraint orders_inquiry_status_check check (inquiry_status is null or inquiry_status in
    ('prijata', 'v_reseni', 'ceka_na_podklady', 'zpracovana', 'odmitnuta', 'stazena'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table orders add constraint orders_order_status_check check (order_status is null or order_status in
    ('dorucena', 'rozpor', 'potvrzena', 'aktualizovana', 'stornovana'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table orders add constraint orders_lost_reason_check check (lost_reason is null or lost_reason in
    ('nevyrabime', 'kapacita', 'nevyplati_se', 'duplicita', 'cena', 'termin', 'jiny_dodavatel',
     'projekt_zrusen', 'bez_odezvy', 'zakaznik_stahl', 'jine', 'neuvedeno'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table quotes add constraint quotes_lost_reason_check check (lost_reason is null or lost_reason in
    ('nevyrabime', 'kapacita', 'nevyplati_se', 'duplicita', 'cena', 'termin', 'jiny_dodavatel',
     'projekt_zrusen', 'bez_odezvy', 'zakaznik_stahl', 'jine', 'neuvedeno'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table quotes add constraint quotes_state_check check (state in
    ('rozpracovana', 'ke_schvaleni', 'schvalena', 'odeslana', 'pripominky', 'prijata', 'zamitnuta', 'archivovana'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table orders add constraint orders_via_check check (
        coalesce(stage_changed_via, 'rucne')          in ('rucne','ai','foto','email','automaticky','import','cron','rest','db')
    and coalesce(inquiry_status_changed_via, 'rucne') in ('rucne','ai','foto','email','automaticky','import','cron','rest','db')
    and coalesce(order_status_changed_via, 'rucne')   in ('rucne','ai','foto','email','automaticky','import','cron','rest','db')
    and coalesce(confirmation_sent_via, 'rucne')      in ('rucne','ai','foto','email','automaticky','import','cron','rest','db'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_events add constraint job_events_actor_kind_check check (actor_kind in ('user', 'ai', 'system'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table audit_log add constraint audit_log_actor_kind_check check (actor_kind in ('user', 'ai', 'system'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_payments add constraint job_payments_via_check check (via in
    ('rucne','ai','foto','email','automaticky','import','cron','rest','db'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_order_revisions add constraint job_order_revisions_decision_check
    check (decision in ('ceka', 'prijata', 'odmitnuta'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_files add constraint job_files_origin_check check (
    (origin is null or origin in ('generated', 'upload', 'capture', 'email', 'import'))
    and (issuer is null or issuer in ('my', 'zakaznik', 'dodavatel')));
exception when duplicate_object then null; end $$;

-- ── 6) Zakázka: dílčí stavy ↔ hlavní stav + kdo (nahrazuje verzi z 20261022120000) ──
create or replace function orders_stage_change()
returns trigger language plpgsql set search_path = public as $$
declare
  v_terms      int;
  v_ctx        text := app_ctx();
  v_actor      uuid := app_pick(null);
  v_nested     boolean := pg_trigger_depth() > 1;
  v_via        text := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
  v_cause      text := nullif(current_setting('app.flow_cause', true), '');
  v_auto_stage boolean := false;
  v_set_inq    text;
  v_set_ord    text;
  v_rank       int;
  v_old_rank   int;
  v_closing    boolean;
begin
  -- INSERT: výchozí dílčí stavy stejnou heuristikou jako backfill
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    v_actor := coalesce(v_actor, new.created_by);
    new.inquiry_status := coalesce(new.inquiry_status, flow_initial_inquiry(new.status, new.source, new.inquiry_date,
      new.customer_inquiry_number, new.order_date, new.customer_order_number, new.priced_by));
    new.order_status := coalesce(new.order_status,
      flow_initial_order(new.status, new.order_date, new.customer_order_number, new.confirmed_at));
  end if;
  v_set_inq := new.inquiry_status;   -- co poslal sám zápis (via „automaticky" vs. ručně)
  v_set_ord := new.order_status;

  -- konec toku (odmítnutí / stažení poptávky, storno objednávky, nerealizováno / zrušeno) a jeho
  -- zrušení rozhoduje jen obchodník nebo admin; zaměstnanec ho navrhne (flow_proposal). REST i náš server.
  if app_guard_decisions() and (
       (new.status in ('nerealizovano', 'zruseno') and (tg_op = 'INSERT' or new.status is distinct from old.status))
    or (new.inquiry_status in ('odmitnuta', 'stazena') and (tg_op = 'INSERT' or new.inquiry_status is distinct from old.inquiry_status))
    or (tg_op = 'UPDATE' and old.inquiry_status in ('odmitnuta', 'stazena') and new.inquiry_status is distinct from old.inquiry_status
        and new.status is not distinct from old.status)
    or (new.order_status = 'stornovana' and (tg_op = 'INSERT' or new.order_status is distinct from old.order_status))
    or (tg_op = 'UPDATE' and old.order_status = 'stornovana' and new.order_status is distinct from old.order_status
        and new.status is not distinct from old.status)) then
    raise exception 'Odmítnout, stornovat nebo uzavřít zakázku smí obchodník nebo admin — navrhni to.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    -- A) dílčí stav → hlavní stav (jen když zápis hlavní stav sám nemění — ruční rozhodnutí vyhrává)
    if new.status is not distinct from old.status then
      if new.inquiry_status is distinct from old.inquiry_status then
        if new.inquiry_status in ('odmitnuta', 'stazena') and old.status in ('poptavka', 'naceneni', 'pozastaveno') then
          new.status := 'nerealizovano'; v_auto_stage := true; v_cause := coalesce(v_cause, 'poptavka');
        elsif old.inquiry_status in ('odmitnuta', 'stazena')
              and new.inquiry_status in ('prijata', 'v_reseni', 'ceka_na_podklady')
              and old.status in ('nerealizovano', 'zruseno') then                       -- M6c
          new.status := 'poptavka'; v_auto_stage := true; v_cause := coalesce(v_cause, 'obnoveni');
        end if;
      end if;
      if not v_auto_stage and new.order_status is distinct from old.order_status then
        if new.order_status = 'stornovana'
           and new.items_delivered = 0 and new.items_partial = 0 and new.partial_delivery_at is null
           and (job_stage_rank(old.status) between 3 and 8 or old.status = 'pozastaveno') then
          new.status := 'zruseno'; v_auto_stage := true; v_cause := coalesce(v_cause, 'objednavka');
        elsif old.order_status = 'stornovana' and old.status = 'zruseno'
              and new.order_status in ('dorucena', 'rozpor', 'potvrzena', 'aktualizovana') then
          new.status := (case when new.order_status in ('dorucena', 'rozpor') then 'objednavka' else 'potvrzeno' end)::job_stage;
          v_auto_stage := true; v_cause := coalesce(v_cause, 'obnoveni');
        elsif new.order_status in ('dorucena', 'rozpor') and job_stage_rank(old.status) between 0 and 2 then
          new.status := 'objednavka'; v_auto_stage := true; v_cause := coalesce(v_cause, 'objednavka');
        elsif new.order_status = 'potvrzena' and job_stage_rank(old.status) between 0 and 3 then
          new.status := 'potvrzeno'; v_auto_stage := true; v_cause := coalesce(v_cause, 'objednavka');
        end if;
      end if;
    end if;

    -- B) vyrovnání úhrady u vyfakturované → Dokončeno (i přímý zápis — jako dnes);
    --    zrušení vyrovnání vrací do Vyfakturováno JEN z přepočtu úhrad (M6b)
    if new.paid_at is not null and old.paid_at is null and new.status = 'fakturovano' and old.status = 'fakturovano' then
      new.status := 'dokonceno'; v_auto_stage := true; v_cause := coalesce(v_cause, 'platba');
    elsif new.paid_at is null and old.paid_at is not null and new.status = 'dokonceno' and old.status = 'dokonceno'
          and v_cause = 'platba' then
      new.status := 'fakturovano'; v_auto_stage := true;
    end if;
  end if;

  -- C) razítka stavů (jako 20261022120000, pražské datum) + posun zpět smaže razítka pozdějších kroků
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.stage_changed_at := now();
    if new.status = 'potvrzeno' and new.confirmed_at is null then new.confirmed_at := now(); end if;
    if new.status = 've_vyrobe' and new.production_started_at is null then new.production_started_at := now(); end if;
    if new.status = 'dodano_k_nam' and new.received_at is null then new.received_at := now(); end if;
    if new.status = 'dodano_zakaznikovi' and new.delivered_at is null then new.delivered_at := now(); end if;
    if new.status = 'fakturovano' and new.invoiced_at is null then new.invoiced_at := now(); end if;
    if new.status = 'dokonceno' and new.paid_at is null then new.paid_at := app_today(); end if;
    if tg_op = 'UPDATE' then
      v_rank := job_stage_rank(new.status);
      v_old_rank := job_stage_rank(old.status);
      if v_rank >= 0 and v_old_rank > v_rank then
        if v_rank < 4 and new.confirmed_at is not distinct from old.confirmed_at then
          new.confirmed_at := null; new.confirmed_by := null;                       -- minor 7
        end if;
        if v_rank < 5 and new.production_started_at is not distinct from old.production_started_at then new.production_started_at := null; end if;
        if v_rank < 6 and new.received_at is not distinct from old.received_at then new.received_at := null; end if;
        if v_rank < 9 and new.delivered_at is not distinct from old.delivered_at then new.delivered_at := null; end if;
        if v_rank < 10 and new.invoiced_at is not distinct from old.invoiced_at then new.invoiced_at := null; end if;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    new.stage_changed_at := app_keep_any(new.stage_changed_at, old.stage_changed_at);
  end if;

  v_rank := job_stage_rank(new.status);

  -- D0) nová revize objednávky (revize nikdy neklesá)
  if tg_op = 'UPDATE' then
    if new.order_revision < old.order_revision then
      new.order_revision := old.order_revision;
    elsif new.order_revision > old.order_revision and old.order_revision >= 1 then
      new.order_changed_at := now();
      new.order_changed_by := v_actor;
      if old.order_status = 'potvrzena' and new.order_status is not distinct from old.order_status then
        new.order_status := 'aktualizovana';
        v_set_ord := 'aktualizovana';              -- přímý důsledek zápisu „zákazník změnil objednávku"
      end if;
    end if;
  end if;

  -- D1) poptávka podle hlavního stavu (NULL = bez poptávky zůstává, kromě ranku 0–1)
  if new.inquiry_status is not null or v_rank in (0, 1) then
    if v_rank >= 2 then
      new.inquiry_status := 'zpracovana';
    elsif v_rank = 1 then
      if new.inquiry_status is null or new.inquiry_status not in ('v_reseni', 'ceka_na_podklady') then
        new.inquiry_status := 'v_reseni';
      end if;
    elsif v_rank = 0 then
      if new.inquiry_status is null or new.inquiry_status not in ('prijata', 'v_reseni', 'ceka_na_podklady') then
        new.inquiry_status := case when new.inquiry_status in ('odmitnuta', 'stazena') then 'prijata' else 'v_reseni' end;
      end if;
    elsif new.status in ('nerealizovano', 'zruseno') and new.inquiry_status in ('prijata', 'v_reseni', 'ceka_na_podklady') then
      new.lost_reason := coalesce(new.lost_reason, 'neuvedeno');
      new.inquiry_status := case when new.lost_reason in ('nevyrabime', 'kapacita', 'nevyplati_se', 'duplicita')
                                 then 'odmitnuta' else 'stazena' end;
    end if;
  end if;

  -- D2) objednávka podle hlavního stavu
  if v_rank between 0 and 2 then
    new.order_status := null;
  elsif v_rank = 3 then
    if new.order_status is null then
      new.order_status := 'dorucena';
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status
          and (new.order_status = 'potvrzena' or (new.order_status = 'stornovana' and old.status = 'zruseno')) then
      new.order_status := 'dorucena';            -- ruční korekce zpět / obnovení ze Zrušeno
    end if;
  elsif v_rank >= 4 then
    if new.order_status is null or new.order_status = 'dorucena' then
      new.order_status := 'potvrzena';           -- dorovnání (potvrzení pak ukáže „bez dokladu")
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status
          and new.order_status = 'stornovana' and old.status = 'zruseno' then
      new.order_status := 'potvrzena';
    end if;
  elsif new.status = 'zruseno' and new.order_status is not null then
    new.order_status := 'stornovana';
  end if;

  -- D3) vznik objednávky = revize 1
  if new.order_status is not null and coalesce(new.order_revision, 0) = 0 then
    new.order_revision := 1;
    new.order_changed_at := now();
    new.order_changed_by := v_actor;
  end if;

  -- D4) potvrzení: kdo a kterou revizi (sent_revision se tu nikdy nemění — M5)
  if new.order_status = 'potvrzena' and (tg_op = 'INSERT' or old.order_status is distinct from 'potvrzena') then
    if tg_op = 'INSERT' then
      new.confirmed_by := app_pick(new.created_by);
      new.order_confirmed_revision := coalesce(new.order_confirmed_revision, new.order_revision);
    else
      new.confirmed_by := app_pick(case when new.confirmed_by is distinct from old.confirmed_by then new.confirmed_by end);
      if new.order_confirmed_revision is not distinct from old.order_confirmed_revision
         and (old.order_status is distinct from 'aktualizovana' or new.order_confirmed_revision is null) then
        new.order_confirmed_revision := new.order_revision;
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    new.confirmed_by := app_keep(new.confirmed_by, old.confirmed_by);
  end if;

  -- D5) čekání na podklady
  if new.inquiry_status = 'ceka_na_podklady' then
    if tg_op = 'INSERT' or old.inquiry_status is distinct from 'ceka_na_podklady' then new.waiting_since := now(); end if;
  elsif new.waiting_since is not null then
    new.waiting_since := null;
  end if;

  -- D6) prohra / odmítnutí / storno: důvod, kdo, kdy
  v_closing := new.status in ('nerealizovano', 'zruseno') or new.inquiry_status in ('odmitnuta', 'stazena')
               or new.order_status = 'stornovana';
  if v_closing then
    new.lost_reason := coalesce(new.lost_reason, 'neuvedeno');
    if tg_op = 'INSERT' or old.lost_reason is null or new.lost_reason is distinct from old.lost_reason then
      new.lost_at := now();
      new.lost_by := app_pick(case when tg_op = 'INSERT' then new.created_by
                                   when new.lost_by is distinct from old.lost_by then new.lost_by end);
    else
      new.lost_at := app_keep_any(new.lost_at, old.lost_at);
      new.lost_by := app_keep(new.lost_by, old.lost_by);
    end if;
  elsif new.lost_reason is not null or new.lost_at is not null or new.lost_note is not null then
    new.lost_reason := null; new.lost_note := null; new.lost_at := null; new.lost_by := null;
  end if;

  -- D7) návrh změny: kdo a kdy
  if (tg_op = 'INSERT' and new.flow_proposal is not null)
     or (tg_op = 'UPDATE' and new.flow_proposal is distinct from old.flow_proposal) then
    new.flow_proposal_at := case when new.flow_proposal is null then null else now() end;
    new.flow_proposal_by := case when new.flow_proposal is null then null
                                 else app_pick(app_uuid(new.flow_proposal->>'by')) end;
  elsif tg_op = 'UPDATE' then
    new.flow_proposal_at := app_keep_any(new.flow_proposal_at, old.flow_proposal_at);
    new.flow_proposal_by := app_keep(new.flow_proposal_by, old.flow_proposal_by);
  end if;

  -- E) atribuce stavu a dílčích stavů
  if tg_op = 'INSERT' then
    new.stage_changed_by := v_actor;
    new.stage_changed_via := v_via;
    new.stage_change_note := app_change_note();
    if new.inquiry_status is not null then
      new.inquiry_status_changed_at := now(); new.inquiry_status_changed_by := v_actor; new.inquiry_status_changed_via := v_via;
    end if;
    if new.order_status is not null then
      new.order_status_changed_at := now(); new.order_status_changed_by := v_actor; new.order_status_changed_via := v_via;
    end if;
    new.updated_by := v_actor;
  else
    if v_ctx <> 'db' then          -- GoTrue / FK kaskáda (ctx db) nepřepisuje posledního, kdo zakázku upravil
      new.updated_by := app_pick(case when new.updated_by is distinct from old.updated_by then new.updated_by end);
    end if;
    new.created_by := app_keep(new.created_by, old.created_by);
    if new.status is distinct from old.status then
      new.stage_changed_by := app_pick(case when new.stage_changed_by is distinct from old.stage_changed_by then new.stage_changed_by end);
      new.stage_changed_via := case when v_auto_stage then 'automaticky' else v_via end;
      new.stage_change_cause := case when v_auto_stage or v_nested then v_cause end;
      new.stage_change_note := case when v_nested then null else app_change_note() end;
    else
      new.stage_changed_by := app_keep(new.stage_changed_by, old.stage_changed_by);
      new.stage_changed_via := app_keep_any(new.stage_changed_via, old.stage_changed_via);
      new.stage_change_cause := app_keep_any(new.stage_change_cause, old.stage_change_cause);
      new.stage_change_note := app_keep_any(new.stage_change_note, old.stage_change_note);
    end if;
    if new.inquiry_status is distinct from old.inquiry_status then
      new.inquiry_status_changed_at := now();
      new.inquiry_status_changed_by := v_actor;
      new.inquiry_status_changed_via := case
        when new.inquiry_status is not distinct from v_set_inq and v_set_inq is distinct from old.inquiry_status then v_via
        else 'automaticky' end;
    else
      new.inquiry_status_changed_at := app_keep_any(new.inquiry_status_changed_at, old.inquiry_status_changed_at);
      new.inquiry_status_changed_by := app_keep(new.inquiry_status_changed_by, old.inquiry_status_changed_by);
      new.inquiry_status_changed_via := app_keep_any(new.inquiry_status_changed_via, old.inquiry_status_changed_via);
    end if;
    if new.order_status is distinct from old.order_status then
      new.order_status_changed_at := now();
      new.order_status_changed_by := v_actor;
      new.order_status_changed_via := case
        when new.order_status is not distinct from v_set_ord and v_set_ord is distinct from old.order_status then v_via
        else 'automaticky' end;
    else
      new.order_status_changed_at := app_keep_any(new.order_status_changed_at, old.order_status_changed_at);
      new.order_status_changed_by := app_keep(new.order_status_changed_by, old.order_status_changed_by);
      new.order_status_changed_via := app_keep_any(new.order_status_changed_via, old.order_status_changed_via);
    end if;
    if not (new.order_revision > old.order_revision) then
      new.order_changed_by := app_keep(new.order_changed_by, old.order_changed_by);
    end if;

    -- F) fakta dokladů a konce toku: kdo
    if new.confirmation_sent_at is distinct from old.confirmation_sent_at then
      new.confirmation_sent_by := case when new.confirmation_sent_at is null then null
        else app_pick(case when new.confirmation_sent_by is distinct from old.confirmation_sent_by then new.confirmation_sent_by end) end;
    else
      new.confirmation_sent_by := app_keep(new.confirmation_sent_by, old.confirmation_sent_by);
    end if;
    if new.confirmation_issued_at is distinct from old.confirmation_issued_at then
      new.confirmation_issued_by := case when new.confirmation_issued_at is null then null
        else app_pick(case when new.confirmation_issued_by is distinct from old.confirmation_issued_by then new.confirmation_issued_by end) end;
    else
      new.confirmation_issued_by := app_keep(new.confirmation_issued_by, old.confirmation_issued_by);
    end if;
    if new.partial_delivery_at is distinct from old.partial_delivery_at then
      new.partial_delivery_by := case when new.partial_delivery_at is null then null else v_actor end;
    else
      new.partial_delivery_by := app_keep(new.partial_delivery_by, old.partial_delivery_by);
    end if;
    if new.delivery_note_confirmed_at is distinct from old.delivery_note_confirmed_at then
      new.delivery_note_confirmed_by := case when new.delivery_note_confirmed_at is null then null else v_actor end;
    else
      new.delivery_note_confirmed_by := app_keep(new.delivery_note_confirmed_by, old.delivery_note_confirmed_by);
    end if;
    if new.invoice_number is distinct from old.invoice_number then
      new.invoiced_by := case when new.invoice_number is null then null else v_actor end;
    else
      new.invoiced_by := app_keep(new.invoiced_by, old.invoiced_by);
    end if;
    if new.paid_at is distinct from old.paid_at or new.paid_amount is distinct from old.paid_amount then
      new.paid_by := case when new.paid_at is null then null else coalesce(v_actor, app_keep(new.paid_by, old.paid_by)) end;
    else
      new.paid_by := app_keep(new.paid_by, old.paid_by);
    end if;
    new.invoice_sent_by := app_keep(new.invoice_sent_by, old.invoice_sent_by);
  end if;

  -- G) datum faktury a splatnost (pražský den — minor 8)
  if new.status in ('fakturovano', 'dokonceno') and new.invoice_date is null then
    new.invoice_date := coalesce((new.invoiced_at at time zone 'Europe/Prague')::date, app_today());
  end if;
  if new.invoice_date is not null and new.invoice_due_date is null then
    select payment_terms_days into v_terms from customers where id = new.customer_id;
    new.invoice_due_date := new.invoice_date + coalesce(v_terms, 14);
  end if;
  return new;
end $$;
-- trigger trg_orders_stage (BEFORE INSERT OR UPDATE) zůstává z 20261022090000 — volá novou verzi funkce

-- Zakázka: historie (jediný zapisovatel stavových událostí), revize, zrcadlo úhrad, synchronizace nabídek
create or replace function orders_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_note  text := case when pg_trigger_depth() > 1 then null else app_change_note() end;
  v_req   uuid := app_request_id();
  v_cause text := nullif(current_setting('app.flow_cause', true), '');
  v_by    uuid := app_actor();
  v_prev  text;
  v_msg   text;
  v_q     uuid;
  v_n     int;
begin
  if tg_op = 'INSERT' then
    if new.order_revision >= 1 then
      insert into job_order_revisions (job_id, revision, customer_order_number, decision, decided_at, decided_by,
                                       created_by, created_via)
      values (new.id, new.order_revision, new.customer_order_number,
              case when new.order_status = 'potvrzena' then 'prijata' else 'ceka' end,
              case when new.order_status = 'potvrzena' then now() end,
              case when new.order_status = 'potvrzena' then new.confirmed_by end,
              new.order_changed_by, new.stage_changed_via)
      on conflict (job_id, revision) do nothing;
    end if;
    return null;
  end if;

  -- hlavní stav
  if new.status is distinct from old.status then
    v_msg := 'Stav: ' || job_stage_label(old.status) || ' → ' || job_stage_label(new.status)
      || case when new.stage_change_note is not null then ' — ' || new.stage_change_note
              when new.stage_changed_via = 'automaticky'
                then ' — automaticky' || coalesce(' (' || flow_cause_label(new.stage_change_cause) || ')', '')
              else '' end
      || case when new.status in ('nerealizovano', 'zruseno') then ' · důvod: ' || lost_reason_label(new.lost_reason) else '' end;
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'stage', v_msg,
      jsonb_strip_nulls(jsonb_build_object(
        'from', old.status, 'to', new.status, 'origin', 'db', 'auto', new.stage_changed_via = 'automaticky',
        'cause', new.stage_change_cause, 'via', new.stage_changed_via, 'note', new.stage_change_note,
        'reason', case when new.status in ('nerealizovano', 'zruseno') then new.lost_reason end)),
      new.stage_changed_by, app_event_kind(new.stage_changed_by), new.stage_changed_via, 'job', new.id, v_req);
  end if;

  -- poptávka (dorovnání invariantem se nepíše, když se zároveň měnil hlavní stav)
  if new.inquiry_status is distinct from old.inquiry_status
     and (coalesce(new.inquiry_status_changed_via, '') <> 'automaticky' or new.status is not distinct from old.status) then
    v_msg := 'Poptávka: '
      || case when old.inquiry_status is null then 'bez poptávky' else flow_state_label('inquiry_status', old.inquiry_status) end
      || ' → '
      || case when new.inquiry_status is null then 'bez poptávky' else flow_state_label('inquiry_status', new.inquiry_status) end
      || case
           when new.inquiry_status in ('odmitnuta', 'stazena')
             then ' — ' || lost_reason_label(new.lost_reason) || coalesce(': ' || new.lost_note, '')
           when new.inquiry_status = 'ceka_na_podklady' then coalesce(' — ' || new.waiting_note, '')
           when new.inquiry_status_changed_via = 'automaticky' and v_cause is not null
             then ' — automaticky (' || flow_cause_label(v_cause) || ')'
           else coalesce(' — ' || v_note, '') end;
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'status', v_msg,
      jsonb_strip_nulls(jsonb_build_object(
        'entity', 'inquiry', 'field', 'inquiry_status', 'from', old.inquiry_status, 'to', new.inquiry_status,
        'origin', 'db', 'auto', new.inquiry_status_changed_via = 'automaticky', 'cause', v_cause,
        'via', new.inquiry_status_changed_via, 'note', coalesce(new.lost_note, new.waiting_note, v_note),
        'reason', case when new.inquiry_status in ('odmitnuta', 'stazena') then new.lost_reason end)),
      new.inquiry_status_changed_by, app_event_kind(new.inquiry_status_changed_by),
      new.inquiry_status_changed_via, 'inquiry', new.id, v_req);
  end if;

  -- objednávka zákazníka
  if new.order_status is distinct from old.order_status
     and (coalesce(new.order_status_changed_via, '') <> 'automaticky' or new.status is not distinct from old.status) then
    v_msg := 'Objednávka: ' || coalesce(flow_state_label('order_status', old.order_status), '—') || ' → '
      || coalesce(flow_state_label('order_status', new.order_status), '—')
      || case when new.order_status = 'aktualizovana' or old.order_status = 'aktualizovana'
                   or new.order_revision > old.order_revision
              then ' (rev ' || new.order_revision || ')' else '' end
      || case
           when new.order_status = 'stornovana'
             then ' — ' || lost_reason_label(new.lost_reason) || coalesce(': ' || new.lost_note, '')
           when old.order_status = 'aktualizovana' and new.order_status = 'potvrzena'
             then case when new.order_confirmed_revision is distinct from old.order_confirmed_revision
                       then ' — změna přijata' else ' — změna nepřijata' end || coalesce(': ' || v_note, '')
           when new.order_status_changed_via = 'automaticky' and v_cause is not null
             then ' — automaticky (' || flow_cause_label(v_cause) || ')'
           else coalesce(' — ' || v_note, '') end;
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'status', v_msg,
      jsonb_strip_nulls(jsonb_build_object(
        'entity', 'order', 'field', 'order_status', 'from', old.order_status, 'to', new.order_status,
        'revision', new.order_revision, 'confirmedRevision', new.order_confirmed_revision, 'origin', 'db',
        'auto', new.order_status_changed_via = 'automaticky', 'cause', v_cause, 'via', new.order_status_changed_via,
        'note', coalesce(new.lost_note, v_note),
        'reason', case when new.order_status = 'stornovana' then new.lost_reason end)),
      new.order_status_changed_by, app_event_kind(new.order_status_changed_by),
      new.order_status_changed_via, 'order', new.id, v_req);
  end if;

  -- revize objednávky: řádek + událost i beze změny stavu (M8)
  if new.order_revision > old.order_revision then
    insert into job_order_revisions (job_id, revision, customer_order_number, note, created_by, created_via)
    values (new.id, new.order_revision, new.customer_order_number, v_note, new.order_changed_by,
            case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end)
    on conflict (job_id, revision) do nothing;
    if new.order_status is not distinct from old.order_status and old.order_revision >= 1 then
      insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
      values (new.id, 'status',
        'Objednávka: přišla změna (rev ' || new.order_revision || ')'
          || coalesce(' — ' || coalesce(v_note, (select r.note from job_order_revisions r
                                                 where r.job_id = new.id and r.revision = new.order_revision)), ''),
        jsonb_build_object('entity', 'order', 'field', 'order_revision', 'from', old.order_revision,
                           'to', new.order_revision, 'origin', 'db'),
        new.order_changed_by, app_event_kind(new.order_changed_by), app_actor_via(), 'order', new.id, v_req);
    end if;
  end if;
  if new.order_status = 'potvrzena' and old.order_status is distinct from 'potvrzena' then
    update job_order_revisions set decision = 'prijata', decided_at = now(), decided_by = new.confirmed_by
    where job_id = new.id and revision = new.order_confirmed_revision and decision = 'ceka';
  end if;

  -- důvod, čekání, rozpor, návrh beze změny stavu (M8)
  if (new.lost_reason is distinct from old.lost_reason or new.lost_note is distinct from old.lost_note)
     and old.lost_reason is not null and new.lost_reason is not null
     and new.status is not distinct from old.status and new.inquiry_status is not distinct from old.inquiry_status
     and new.order_status is not distinct from old.order_status then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'status', 'Důvod: ' || lost_reason_label(old.lost_reason) || ' → ' || lost_reason_label(new.lost_reason)
                              || coalesce(': ' || new.lost_note, ''),
      jsonb_build_object('entity', 'job', 'field', 'lost_reason', 'from', old.lost_reason, 'to', new.lost_reason, 'origin', 'db'),
      v_by, app_event_kind(v_by), app_actor_via(), 'job', new.id, v_req);
  end if;
  if new.waiting_note is distinct from old.waiting_note and new.inquiry_status = 'ceka_na_podklady'
     and old.inquiry_status = 'ceka_na_podklady' then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'status', 'Čeká na podklady: ' || coalesce(new.waiting_note, '—'),
      jsonb_build_object('entity', 'inquiry', 'field', 'waiting_note', 'origin', 'db'),
      v_by, app_event_kind(v_by), app_actor_via(), 'inquiry', new.id, v_req);
  end if;
  if new.order_mismatch is distinct from old.order_mismatch and new.order_status is not distinct from old.order_status then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.id, 'status',
      case when new.order_mismatch is null or jsonb_typeof(new.order_mismatch->'resolved') = 'object'
             then 'Rozpor s nabídkou vyřešen' || coalesce(' — ' || v_note, '')
           when new.order_mismatch->>'fix_requested_at' is not null
                and (old.order_mismatch is null
                     or (new.order_mismatch->>'fix_requested_at') is distinct from (old.order_mismatch->>'fix_requested_at'))
             then 'Požádáno o opravu objednávky' || coalesce(' — ' || v_note, '')
           else 'Rozpor s nabídkou: ' || flow_count_label(coalesce(jsonb_array_length(new.order_mismatch->'items'), 0),
                                                          'rozdíl', 'rozdíly', 'rozdílů') end,
      jsonb_build_object('entity', 'order', 'field', 'order_mismatch', 'origin', 'db'),
      v_by, app_event_kind(v_by), app_actor_via(), 'order', new.id, v_req);
  end if;
  if new.flow_proposal is distinct from old.flow_proposal then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, agent, entity, entity_id, request_id)
    values (new.id, 'status',
      case when new.flow_proposal is null then 'Návrh uzavřen: ' || coalesce(old.flow_proposal->>'label', '—')
           else 'Návrh: ' || coalesce(new.flow_proposal->>'label', '—') || coalesce(' — ' || (new.flow_proposal->>'note'), '') end,
      jsonb_strip_nulls(jsonb_build_object('entity', 'proposal', 'field', 'flow_proposal', 'origin', 'db',
        'phase', coalesce(new.flow_proposal, old.flow_proposal)->>'phase',
        'to', coalesce(new.flow_proposal, old.flow_proposal)->>'to')),
      coalesce(new.flow_proposal_by, v_by),
      case when new.flow_proposal->>'kind' = 'ai' then 'ai' else app_event_kind(coalesce(new.flow_proposal_by, v_by)) end,
      app_actor_via(), nullif(new.flow_proposal->>'agent', ''), 'proposal', new.id, v_req);
  end if;

  -- úhrady: přímý zápis paid_* (stará markJobPaid, testy, psql) → job_payments (B1); změna hodnoty → přepočet
  if coalesce(current_setting('app.payments_sync', true), '') <> 'on' then
    if new.paid_at is distinct from old.paid_at or new.paid_amount is distinct from old.paid_amount then
      perform sync_payments_from_order(new.id, old.paid_at, old.paid_amount, new.paid_at, new.paid_amount);
    elsif new.value is distinct from old.value and exists (select 1 from job_payments where job_id = new.id) then
      perform recompute_job_payments(new.id);
    end if;
  end if;

  -- nabídky podle ruční korekce hlavního stavu (M2)
  if new.status is distinct from old.status then
    v_prev := current_setting('app.flow_cause', true);
    if new.status in ('nerealizovano', 'zruseno') and old.status not in ('nerealizovano', 'zruseno') then
      perform set_config('app.flow_cause', 'uzavreni', true);
      update quotes set status = 'zamitnuto', lost_reason = coalesce(new.lost_reason, 'neuvedeno'),
                        rejected_reason = coalesce(rejected_reason, new.lost_note)
      where job_id = new.id and not archived and status = 'odeslano';
      update quotes set archived = true
      where job_id = new.id and not archived and status in ('navrh_ai', 'ke_schvaleni');
      perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
    elsif job_stage_rank(new.status) >= 3 and job_stage_rank(old.status) between 0 and 2
          and not exists (select 1 from quotes where job_id = new.id and status = 'prijato') then
      select count(*)::int, (array_agg(id))[1] into v_n, v_q
      from quotes where job_id = new.id and not archived and status = 'odeslano';
      if v_n = 1 then
        perform set_config('app.flow_cause', 'prijeti', true);
        update quotes set status = 'prijato' where id = v_q;
        perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
      end if;
    end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_orders_flow_after on orders;
create trigger trg_orders_flow_after after insert or update on orders
  for each row execute function orders_flow_after();

-- Provize musí reagovat i na posun stavu vyvolaný dílčím stavem nebo přepočtem (UPDATE OF hlídá jen
-- sloupce v SET) — proto WHEN nad skutečnou změnou po BEFORE triggerech. Zároveň se provize zbytečně
-- nepřepočítávají při každém přepočtu výroby / dodávek (méně zámků na commission_statements).
drop trigger if exists trg_orders_commission on orders;
create trigger trg_orders_commission
  after update on orders
  for each row
  when (old.value is distinct from new.value or old.purchase_cost is distinct from new.purchase_cost
        or old.owner_id is distinct from new.owner_id or old.status is distinct from new.status
        or old.order_date is distinct from new.order_date or old.paid_at is distinct from new.paid_at
        or old.paid_amount is distinct from new.paid_amount)
  execute function trg_orders_commission();
drop trigger if exists trg_orders_commission_insert on orders;
create trigger trg_orders_commission_insert
  after insert on orders
  for each row execute function trg_orders_commission();

-- ── 7) Položky: dodané množství → agregáty → „vše dodáno" (jen ze ZVÝŠENÍ v UPDATE — M6a) ──
create or replace function recompute_job_flow(p_job uuid, p_advance boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  j        orders%rowtype;
  v_cnt    int;
  v_priced int;
  v_done   int;
  v_part   int;
  v_last   timestamptz;
  v_move   boolean;
  v_prev   text := current_setting('app.flow_cause', true);
begin
  select * into j from orders where id = p_job;
  if not found then return; end if;            -- mazání zakázky (kaskáda)
  select count(*)::int,
         (count(*) filter (where unit_price is not null))::int,
         (count(*) filter (where delivery_closed or quantity <= 0 or delivered_quantity >= quantity))::int,
         (count(*) filter (where not delivery_closed and quantity > 0 and delivered_quantity > 0
                                 and delivered_quantity < quantity))::int,
         max(delivered_changed_at) filter (where delivered_quantity > 0)
    into v_cnt, v_priced, v_done, v_part, v_last
  from order_items where order_id = p_job;
  v_move := p_advance and v_cnt > 0 and v_done = v_cnt and job_stage_rank(j.status) between 3 and 8;
  if not v_move and v_cnt = j.items_count and v_priced = j.items_priced and v_done = j.items_delivered
     and v_part = j.items_partial and v_last is not distinct from j.last_delivery_at then
    return;
  end if;
  perform set_config('app.flow_cause', 'dodani', true);
  update orders set
    items_count = v_cnt, items_priced = v_priced, items_delivered = v_done, items_partial = v_part,
    last_delivery_at = v_last,
    status = case when v_move then 'dodano_zakaznikovi'::job_stage else status end
  where id = p_job;
  perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
end $$;

create or replace function order_items_flow_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.delivered_quantity is null or new.delivered_quantity < 0 then new.delivered_quantity := 0; end if;
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    if new.delivered_quantity > 0 then
      new.delivered_changed_at := coalesce(new.delivered_changed_at, now());
      new.delivered_changed_by := app_pick(new.delivered_changed_by);
    end if;
    if new.delivery_closed then
      new.delivery_closed_at := coalesce(new.delivery_closed_at, now());
      new.delivery_closed_by := app_pick(new.delivery_closed_by);
    end if;
  else
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.created_by := app_keep(new.created_by, old.created_by);
    if new.delivered_quantity is distinct from old.delivered_quantity then
      new.delivered_changed_at := now();
      new.delivered_changed_by := app_pick(case when new.delivered_changed_by is distinct from old.delivered_changed_by
                                                then new.delivered_changed_by end);
    else
      new.delivered_changed_at := app_keep_any(new.delivered_changed_at, old.delivered_changed_at);
      new.delivered_changed_by := app_keep(new.delivered_changed_by, old.delivered_changed_by);
    end if;
    if new.delivery_closed is distinct from old.delivery_closed then
      new.delivery_closed_at := case when new.delivery_closed then now() end;
      new.delivery_closed_by := case when new.delivery_closed then app_pick(null) end;
      if not new.delivery_closed then new.delivery_closed_reason := null; end if;
    else
      new.delivery_closed_by := app_keep(new.delivery_closed_by, old.delivery_closed_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_order_items_flow_before on order_items;
create trigger trg_order_items_flow_before before insert or update on order_items
  for each row execute function order_items_flow_before();

create or replace function order_items_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    perform recompute_job_flow(old.order_id, false);
  else
    perform recompute_job_flow(new.order_id,
      tg_op = 'UPDATE' and (new.delivered_quantity > old.delivered_quantity
                            or (new.delivery_closed and not old.delivery_closed)));
    if tg_op = 'UPDATE' and old.order_id is distinct from new.order_id then
      perform recompute_job_flow(old.order_id, false);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_order_items_flow on order_items;
create trigger trg_order_items_flow after insert or update or delete on order_items
  for each row execute function order_items_flow_after();

-- ── 8) Výroba: stejná logika jako 20261022120000, navíc příčina posunu stavu ──
create or replace function recompute_job_production(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur     job_operations%rowtype;
  v_total   int;
  v_done    int;
  v_problem boolean;
  v_started boolean;
  v_loc     text;
  v_prev    text := current_setting('app.flow_cause', true);
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

  perform set_config('app.flow_cause', 'vyroba', true);
  update orders set
    production_step = case when v_cur.id is null then (case when v_total > 0 and v_done = v_total then 'hotovo' else null end) else v_cur.kind end,
    production_location = v_loc,
    production_done = coalesce(v_done, 0),
    production_total = coalesce(v_total, 0),
    production_problem = coalesce(v_problem, false),
    status = case when coalesce(v_started, false) and status in ('objednavka', 'potvrzeno') then 've_vyrobe'::job_stage else status end
  where id = p_job;
  perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
end $$;

-- ── 9) Nabídky: schvalování, odvozený stav, kdo odeslal / přijal / zamítl, synchronizace se zakázkou ──
create or replace function quotes_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx     text := app_ctx();
  v_actor   uuid := app_pick(null);
  v_via     text := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
  v_state   text;
  v_sending boolean;
begin
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    v_actor := coalesce(v_actor, new.created_by);
  else
    if v_ctx <> 'db' then
      new.updated_by := app_pick(case when new.updated_by is distinct from old.updated_by then new.updated_by end);
    end if;
    new.created_by := app_keep(new.created_by, old.created_by);
  end if;

  -- žádost o schválení + nutnost schválení (M1)
  if new.approval_requested_at is not null and (tg_op = 'INSERT' or old.approval_requested_at is null) then
    new.approval_requested_by := app_pick(new.approval_requested_by);
  elsif new.approval_requested_at is null then
    new.approval_requested_by := null;
  elsif tg_op = 'UPDATE' then
    new.approval_requested_by := app_keep(new.approval_requested_by, old.approval_requested_by);
  end if;
  new.approval_required := quote_approval_required(new.ai_generated, new.total, new.approval_requested_at);

  -- schválení: přes REST jen sebou (M2); razítko času doplní DB
  if new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by) then
    new.approved_by := app_pick(new.approved_by);
    new.approved_at := case when tg_op = 'UPDATE' and new.approved_at is not distinct from old.approved_at then now()
                            else coalesce(new.approved_at, now()) end;
  elsif new.approved_by is null then
    new.approved_at := null;
  end if;

  -- schválit, odeslat a zamítnout nabídku smí jen obchodník nebo admin (zaměstnanec předá ke schválení / navrhne)
  if app_guard_decisions() and (
       (new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by))
    or (new.status in ('odeslano', 'zamitnuto') and (tg_op = 'INSERT' or new.status is distinct from old.status))) then
    raise exception 'Schválit, odeslat nebo zamítnout nabídku smí obchodník nebo admin.' using errcode = '42501';
  end if;

  -- neschválenou nabídku (AI, žádost, limit) zákazník nedostal → nejde ji ani přijmout
  if new.status = 'prijato' and (tg_op = 'INSERT' or old.status in ('navrh_ai', 'ke_schvaleni'))
     and new.approval_required and new.approved_by is null and v_ctx <> 'db' then
    raise exception 'Nabídka čeká na schválení — přijmout ji lze až po schválení a odeslání.' using errcode = 'P0001';
  end if;

  -- odeslání (z rozpracované / ke schválení; znovuotevření zamítnuté autora odeslání nemění)
  v_sending := new.status = 'odeslano' and (tg_op = 'INSERT' or old.status in ('navrh_ai', 'ke_schvaleni'));
  if v_sending then
    if new.approval_required and new.approved_by is null and v_ctx <> 'db' then
      raise exception 'Nabídka čeká na schválení — odeslat ji lze až po schválení.' using errcode = 'P0001';
    end if;
    new.sent_at := coalesce(new.sent_at, now());
    new.sent_by := app_pick(case when tg_op = 'INSERT' then coalesce(new.sent_by, new.created_by)
                                 when new.sent_by is distinct from old.sent_by then new.sent_by end);
    new.sent_via := case when tg_op = 'UPDATE' and new.sent_via is distinct from old.sent_via
                               and new.sent_via in ('rucne', 'email', 'foto', 'ai', 'import') then new.sent_via
                         else v_via end;
  elsif tg_op = 'UPDATE' then
    new.sent_by := app_keep(new.sent_by, old.sent_by);
  end if;

  -- přijetí / zamítnutí
  if new.status = 'prijato' and (tg_op = 'INSERT' or old.status is distinct from 'prijato') then
    new.accepted_at := now();
    new.accepted_by := app_pick(case when tg_op = 'INSERT' then new.created_by
                                     when new.accepted_by is distinct from old.accepted_by then new.accepted_by end);
  elsif new.status <> 'prijato' then
    new.accepted_at := null; new.accepted_by := null;
  elsif tg_op = 'UPDATE' then
    new.accepted_at := app_keep_any(new.accepted_at, old.accepted_at);
    new.accepted_by := app_keep(new.accepted_by, old.accepted_by);
  end if;
  if new.status = 'zamitnuto' and (tg_op = 'INSERT' or old.status is distinct from 'zamitnuto') then
    new.rejected_at := now();
    new.rejected_by := app_pick(case when tg_op = 'INSERT' then new.created_by
                                     when new.rejected_by is distinct from old.rejected_by then new.rejected_by end);
    new.lost_reason := coalesce(new.lost_reason, 'neuvedeno');
  elsif new.status <> 'zamitnuto' then
    new.rejected_at := null; new.rejected_by := null; new.lost_reason := null; new.competitor_price := null;
  elsif tg_op = 'UPDATE' then
    new.rejected_at := app_keep_any(new.rejected_at, old.rejected_at);
    new.rejected_by := app_keep(new.rejected_by, old.rejected_by);
  end if;

  -- připomínky zákazníka: kdy přišly (text v quotes.feedback)
  if nullif(btrim(coalesce(new.feedback, '')), '') is null then
    new.feedback_at := null;
  elsif tg_op = 'INSERT' or new.feedback is distinct from old.feedback then
    new.feedback_at := now();
  end if;

  -- odvozený stav (sloupec je jen pro čtení)
  v_state := quote_state_of(new.status, new.approved_by, new.archived, new.feedback_at, new.sent_at, new.approval_required);
  if tg_op = 'INSERT' or v_state is distinct from old.state then
    new.state_changed_at := now();
    new.state_changed_by := v_actor;
    new.state_changed_via := v_via;
  else
    new.state_changed_at := old.state_changed_at;
    new.state_changed_by := app_keep(new.state_changed_by, old.state_changed_by);
    new.state_changed_via := old.state_changed_via;
  end if;
  new.state := v_state;
  return new;
end $$;
drop trigger if exists trg_quotes_flow on quotes;
create trigger trg_quotes_flow before insert or update on quotes
  for each row execute function quotes_flow_before();

create or replace function quotes_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ctx   text := app_ctx();
  v_prev  text := current_setting('app.flow_cause', true);
  v_cause text := nullif(current_setting('app.flow_cause', true), '');
begin
  if new.job_id is null then return null; end if;

  -- nabídka k poptávce = někdo na ní pracuje (stejné pravidlo jako backfill)
  if tg_op = 'INSERT' then
    perform set_config('app.flow_cause', 'nabidka', true);
    update orders set inquiry_status = 'v_reseni' where id = new.job_id and inquiry_status = 'prijata';
    perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
  end if;
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then return null; end if;

  -- záchranná síť: změna mimo náš server (skript, psql) nebo kaskádou
  if tg_op = 'UPDATE' and (v_ctx in ('service', 'db') or pg_trigger_depth() > 1) then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.job_id, 'quote',
      'Nabídka ' || coalesce(new.number, '') || ': ' || flow_state_label('quote_state', old.state)
        || ' → ' || flow_state_label('quote_state', new.state)
        || case when pg_trigger_depth() > 1 and v_cause is not null
                then ' — automaticky (' || flow_cause_label(v_cause) || ')' else '' end
        || case when new.state = 'zamitnuta' then ' · důvod: ' || lost_reason_label(new.lost_reason) else '' end,
      jsonb_strip_nulls(jsonb_build_object('quoteId', new.id, 'number', new.number, 'action', 'state',
        'from', old.state, 'to', new.state, 'origin', 'db', 'auto', pg_trigger_depth() > 1, 'cause', v_cause)),
      new.state_changed_by, app_event_kind(new.state_changed_by), new.state_changed_via, 'quote', new.id, app_request_id());
  end if;

  if new.state = 'odeslana' and (tg_op = 'INSERT' or old.state in ('rozpracovana', 'ke_schvaleni', 'schvalena')) then
    perform set_config('app.flow_cause', 'nabidka', true);
    update orders set status = 'nabidka' where id = new.job_id and status in ('poptavka', 'naceneni');
    perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
  elsif new.state = 'prijata' and (tg_op = 'INSERT' or old.state is distinct from 'prijata') then
    perform set_config('app.flow_cause', 'nabidka', true);
    update orders set status = 'objednavka' where id = new.job_id and job_stage_rank(status) between 0 and 2;
    update orders set quote_id = coalesce(quote_id, new.id), value = coalesce(value, new.total)
    where id = new.job_id and (quote_id is null or value is null);
    update quotes set archived = true, superseded_by = new.id
    where job_id = new.job_id and id <> new.id and not archived and status in ('navrh_ai', 'ke_schvaleni', 'odeslano');
    perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
  elsif new.state = 'zamitnuta' and tg_op = 'UPDATE' then
    update orders set quote_id = null where id = new.job_id and quote_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists trg_quotes_flow_after on quotes;
create trigger trg_quotes_flow_after after insert or update on quotes
  for each row execute function quotes_flow_after();

-- ── 10) Objednávky dodavatelům, převzaté množství ───────────
create or replace function purchase_orders_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx   text := app_ctx();
  v_actor uuid := app_pick(null);
  v_via   text := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
begin
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    v_actor := coalesce(v_actor, new.created_by);
  else
    if v_ctx <> 'db' then new.updated_by := v_actor; end if;
    new.created_by := app_keep(new.created_by, old.created_by);
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now(); new.status_changed_by := v_actor; new.status_changed_via := v_via;
    if new.status = 'odeslana' then new.sent_at := coalesce(new.sent_at, now()); new.sent_by := v_actor; end if;
    if new.status = 'potvrzena' then new.confirmed_at := now(); new.confirmed_by := v_actor; end if;
    if new.status = 'dodana' then new.delivered_at := now(); new.delivered_by := v_actor; end if;
    if new.status = 'zrusena' then new.cancelled_at := now(); new.cancelled_by := v_actor; end if;
  elsif v_ctx = 'session' then
    new.status_changed_at := old.status_changed_at; new.status_changed_via := old.status_changed_via;
    new.status_changed_by := app_keep(new.status_changed_by, old.status_changed_by);
    new.sent_by := app_keep(new.sent_by, old.sent_by);
    new.confirmed_by := app_keep(new.confirmed_by, old.confirmed_by);
    new.delivered_by := app_keep(new.delivered_by, old.delivered_by);
    new.cancelled_by := app_keep(new.cancelled_by, old.cancelled_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_purchase_orders_flow on purchase_orders;
create trigger trg_purchase_orders_flow before insert or update on purchase_orders
  for each row execute function purchase_orders_flow_before();

create or replace function purchase_orders_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and (app_ctx() in ('service', 'db') or pg_trigger_depth() > 1) then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.job_id, 'field',
      'Objednávka dodavateli ' || coalesce(new.number, '') || ': '
        || flow_state_label('purchase_order_status', old.status::text) || ' → '
        || flow_state_label('purchase_order_status', new.status::text),
      jsonb_build_object('purchaseOrderId', new.id, 'number', new.number, 'statusFrom', old.status,
                         'statusTo', new.status, 'origin', 'db', 'auto', pg_trigger_depth() > 1),
      new.status_changed_by, app_event_kind(new.status_changed_by), new.status_changed_via,
      'purchase_order', new.id, app_request_id());
  end if;
  return null;
end $$;
drop trigger if exists trg_purchase_orders_flow_after on purchase_orders;
create trigger trg_purchase_orders_flow_after after update on purchase_orders
  for each row execute function purchase_orders_flow_after();

create or replace function purchase_order_items_flow_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.received_quantity is null or new.received_quantity < 0 then new.received_quantity := 0; end if;
  if tg_op = 'INSERT' then
    if new.received_quantity > 0 then
      new.received_changed_at := now(); new.received_changed_by := app_pick(new.received_changed_by);
    end if;
  else
    if new.received_quantity is distinct from old.received_quantity then
      new.received_changed_at := now(); new.received_changed_by := app_pick(null);
    else
      new.received_changed_by := app_keep(new.received_changed_by, old.received_changed_by);
    end if;
    if not new.receipt_closed then new.receipt_closed_reason := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_purchase_order_items_flow on purchase_order_items;
create trigger trg_purchase_order_items_flow before insert or update on purchase_order_items
  for each row execute function purchase_order_items_flow_before();

-- ── 11) Výrobní operace: kdo přepnul stav ───────────────────
create or replace function job_operations_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx   text := app_ctx();
  v_actor uuid := app_pick(null);
begin
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
  else
    if v_ctx <> 'db' then new.updated_by := v_actor; end if;
    new.created_by := app_keep(new.created_by, old.created_by);
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.status_changed_at := now();
    new.status_changed_by := coalesce(v_actor, case when tg_op = 'INSERT' then new.created_by end);
    new.status_changed_via := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
  elsif v_ctx = 'session' then
    new.status_changed_at := old.status_changed_at; new.status_changed_via := old.status_changed_via;
    new.status_changed_by := app_keep(new.status_changed_by, old.status_changed_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_job_operations_actor on job_operations;
create trigger trg_job_operations_actor before insert or update on job_operations
  for each row execute function job_operations_flow_before();

create or replace function job_operations_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status and (app_ctx() in ('service', 'db') or pg_trigger_depth() > 1) then
    insert into job_events (job_id, type, message, data, actor_id, actor_kind, via, entity, entity_id, request_id)
    values (new.job_id, 'field',
      'Výroba: ' || coalesce(nullif(new.title, ''), replace(new.kind, '_', ' ')) || ' → '
        || flow_state_label('operation_status', new.status),
      jsonb_build_object('production', 'status', 'operationId', new.id, 'from', old.status, 'to', new.status,
                         'origin', 'db', 'auto', pg_trigger_depth() > 1),
      new.status_changed_by, app_event_kind(new.status_changed_by), new.status_changed_via,
      'operation', new.id, app_request_id());
  end if;
  return null;
end $$;
drop trigger if exists trg_job_operations_flow_after on job_operations;
create trigger trg_job_operations_flow_after after update on job_operations
  for each row execute function job_operations_flow_after();

-- ── 12) Faktury, nabídky dodavatelů, výkazy provizí ─────────
create or replace function invoices_flow_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    new.status_changed_at := now(); new.status_changed_by := new.created_by;
  else
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.created_by := app_keep(new.created_by, old.created_by);
    if new.status is distinct from old.status then
      new.status_changed_at := now(); new.status_changed_by := app_pick(null);
      if new.status = 'odeslana' then new.sent_at := coalesce(new.sent_at, now()); new.sent_by := app_pick(null); end if;
    else
      new.status_changed_by := app_keep(new.status_changed_by, old.status_changed_by);
      new.sent_by := app_keep(new.sent_by, old.sent_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_invoices_flow on invoices;
create trigger trg_invoices_flow before insert or update on invoices
  for each row execute function invoices_flow_before();

create or replace function supplier_quotes_flow_before()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
  else
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.created_by := app_keep(new.created_by, old.created_by);
  end if;
  if new.selected and (tg_op = 'INSERT' or not old.selected) then
    new.selected_at := now(); new.selected_by := app_pick(null);   -- žádný odhad z created_by (minor 2)
  elsif not new.selected then
    new.selected_at := null; new.selected_by := null;
  elsif tg_op = 'UPDATE' then
    new.selected_by := app_keep(new.selected_by, old.selected_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_supplier_quotes_flow on supplier_quotes;
create trigger trg_supplier_quotes_flow before insert or update on supplier_quotes
  for each row execute function supplier_quotes_flow_before();

create or replace function commission_statements_actor()
returns trigger language plpgsql set search_path = public as $$
begin
  if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
  if new.status = 'vyplaceno' and old.status is distinct from 'vyplaceno' then
    new.paid_by := app_pick(case when new.paid_by is distinct from old.paid_by then new.paid_by end);
  elsif new.status <> 'vyplaceno' then
    new.paid_by := null;
  else
    new.paid_by := app_keep(new.paid_by, old.paid_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_commission_statements_actor on commission_statements;
create trigger trg_commission_statements_actor before update on commission_statements
  for each row execute function commission_statements_actor();

-- ── 13) Úhrady → orders.paid_at / paid_amount / paid_so_far (R8, B1) ──
create or replace function job_payments_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.recorded_by := app_pick(new.recorded_by);
    if new.via = 'rucne' then
      new.via := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
    end if;
  else
    new.updated_at := now();
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.recorded_by := app_keep(new.recorded_by, old.recorded_by);
    if app_ctx() = 'session' then                -- REST nepřepíše uložené jméno ani způsob zápisu
      new.recorded_name := old.recorded_name;
      new.via := old.via;
    end if;
  end if;
  if new.recorded_by is not null and (tg_op = 'INSERT' or new.recorded_by is distinct from old.recorded_by) then
    select coalesce(nullif(btrim(full_name), ''), email) into new.recorded_name from profiles where id = new.recorded_by;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_payments_before on job_payments;
create trigger trg_job_payments_before before insert or update on job_payments
  for each row execute function job_payments_before();

create or replace function recompute_job_payments(p_job uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cnt     int;
  v_null    int;
  v_sum     numeric;
  v_last    date;
  v_settle  boolean;
  v_value   numeric;
  v_settled boolean;
  v_at      date;
  v_amount  numeric;
  v_prev    text := current_setting('app.flow_cause', true);
  v_prev_s  text := current_setting('app.payments_sync', true);
begin
  -- zámek řádku zakázky: souběžné úhrady se sečtou postupně (READ COMMITTED by je navzájem neviděl)
  select value into v_value from orders where id = p_job for update;
  if not found then return; end if;            -- mazání zakázky (kaskáda)
  select count(*)::int, (count(*) filter (where amount is null))::int, coalesce(sum(amount), 0), max(paid_on),
         coalesce(bool_or(settles), false)
    into v_cnt, v_null, v_sum, v_last, v_settle
  from job_payments where job_id = p_job;
  v_settled := v_cnt > 0 and (v_settle or (v_value is not null and v_sum >= v_value - 1));
  v_at := case when v_settled then v_last end;
  v_amount := case when not v_settled or v_null > 0 then null else v_sum end;   -- null = celá částka (provize: value)
  perform set_config('app.payments_sync', 'on', true);
  perform set_config('app.flow_cause', 'platba', true);
  update orders set paid_at = v_at, paid_amount = v_amount, paid_so_far = v_sum
  where id = p_job
    and (paid_at is distinct from v_at or paid_amount is distinct from v_amount or paid_so_far is distinct from v_sum);
  perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
  perform set_config('app.payments_sync', coalesce(v_prev_s, ''), true);
end $$;

/** Přímý zápis orders.paid_* (stará markJobPaid, úklid testů, psql) → job_payments. Nikdy NULL místo částky (B1). */
create or replace function sync_payments_from_order(p_job uuid, p_old_at date, p_old_amount numeric,
  p_new_at date, p_new_amount numeric)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_last   uuid;
  v_prev_s text := current_setting('app.payments_sync', true);
begin
  perform set_config('app.payments_sync', 'on', true);
  if p_new_at is null and p_new_amount is null then
    delete from job_payments where job_id = p_job;
  elsif p_new_amount is distinct from p_old_amount then
    delete from job_payments where job_id = p_job;
    insert into job_payments (job_id, paid_on, amount, settles, via, note)
    values (p_job, coalesce(p_new_at, app_today()), p_new_amount, p_new_at is not null, 'automaticky',
            'Převzato ze zápisu úhrady');
  elsif p_new_at is null then
    update job_payments set settles = false where job_id = p_job and settles;
  else
    select id into v_last from job_payments where job_id = p_job and settles
    order by paid_on desc, created_at desc limit 1;
    if v_last is null then
      insert into job_payments (job_id, paid_on, amount, settles, via, note)
      values (p_job, p_new_at, null, true, 'automaticky', 'Celá / zbývající částka (uzavření zakázky)');
    else
      update job_payments set paid_on = p_new_at where id = v_last;
    end if;
  end if;
  perform recompute_job_payments(p_job);
  perform set_config('app.payments_sync', coalesce(v_prev_s, ''), true);
end $$;

create or replace function job_payments_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform recompute_job_payments(case when tg_op = 'DELETE' then old.job_id else new.job_id end);
  return null;
end $$;
drop trigger if exists trg_job_payments_after on job_payments;
create trigger trg_job_payments_after after insert or update or delete on job_payments
  for each row execute function job_payments_after();

-- ── 14) Dokumenty: kdo archivoval; NAŠE potvrzení vystaveno (jen generated — M4); konec čekání na podklady ──
create or replace function job_files_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx text := app_ctx();
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := app_pick(new.uploaded_by);
    if v_ctx = 'session' and new.origin = 'generated' then new.origin := 'upload'; end if;  -- „náš doklad" označí jen server
    if new.origin is null and new.capture_id is not null then new.origin := 'capture'; end if;
    if new.origin = 'generated' and new.issuer is null then new.issuer := 'my'; end if;
    if new.kind = 'potvrzeni' and new.origin = 'generated' and new.order_revision is null then
      select order_revision into new.order_revision from orders where id = new.job_id;
    end if;
  else
    if v_ctx <> 'db' then new.updated_by := app_pick(null); end if;
    new.uploaded_by := app_keep(new.uploaded_by, old.uploaded_by);
    if new.archived is distinct from old.archived then
      new.archived_at := case when new.archived then now() end;
      new.archived_by := case when new.archived then app_pick(null) end;
    else
      new.archived_by := app_keep(new.archived_by, old.archived_by);
    end if;
    if v_ctx = 'session' then
      new.origin := old.origin; new.issuer := old.issuer; new.order_revision := old.order_revision;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_files_flow_before on job_files;
create trigger trg_job_files_flow_before before insert or update on job_files
  for each row execute function job_files_flow_before();

create or replace function job_files_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_prev text := current_setting('app.flow_cause', true);
begin
  if new.archived then return null; end if;
  if new.kind = 'potvrzeni' and new.origin = 'generated' then
    update orders set confirmation_issued_at = new.created_at,
                      confirmation_issued_revision = coalesce(new.order_revision, order_revision),
                      confirmation_issued_by = new.uploaded_by
    where id = new.job_id and (confirmation_issued_at is null or confirmation_issued_at <= new.created_at);
  end if;
  if new.kind in ('vykres', 'model_3d', 'poptavka', 'korespondence', 'foto') then
    perform set_config('app.flow_cause', 'podklady', true);
    update orders set inquiry_status = case when status = 'naceneni' or assignee_id is not null then 'v_reseni' else 'prijata' end
    where id = new.job_id and inquiry_status = 'ceka_na_podklady';
    perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
  end if;
  return null;
end $$;
drop trigger if exists trg_job_files_flow_after on job_files;
create trigger trg_job_files_flow_after after insert on job_files
  for each row execute function job_files_flow_after();

-- ── 15) Historie a audit: autor vždy, proti podvrhu, sloučení starých „stage" událostí ──
create or replace function job_events_before_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_ctx text := app_ctx();
  v_id  uuid;
begin
  if pg_trigger_depth() > 1 then
    null;                                        -- vložil trigger DB: autor, druh i data už jsou vyplněné
  elsif v_ctx = 'session' then                   -- REST se session: autor = přihlášený, žádné rezervované klíče (M1)
    new.actor_id := app_actor(); new.actor_kind := 'user'; new.via := 'rest'; new.agent := null;
    new.actor_name := null;                      -- jméno jen z profilu (níže), ne od klienta
    new.entity := 'job'; new.entity_id := new.job_id;
    new.data := coalesce(new.data, '{}'::jsonb) - 'origin' - 'auto' - 'cause' - 'merged' - 'via';
  else                                           -- náš server / skript / psql
    new.actor_id := coalesce(new.actor_id, app_actor());
    new.actor_kind := case when new.actor_kind in ('user', 'ai') then new.actor_kind
                           when v_ctx = 'app' then app_actor_kind()
                           when new.actor_id is not null then 'user' else 'system' end;
    new.via := coalesce(new.via, nullif(new.data->>'via', ''), app_actor_via());
    new.agent := coalesce(new.agent, app_actor_agent());
  end if;
  new.request_id := coalesce(new.request_id, app_request_id());
  new.entity_id := coalesce(new.entity_id, new.job_id);
  if new.actor_id is not null and new.actor_name is null then
    select coalesce(nullif(btrim(full_name), ''), email) into new.actor_name from profiles where id = new.actor_id;
  end if;

  -- Starší kód zapisuje změnu stavu i sám → doplní text k DB události místo duplicity.
  -- Jen servisní klíč (náš server, skript), nebo session do VLASTNÍ události (M1).
  if pg_trigger_depth() = 1 and new.type = 'stage' and new.data ? 'to'
     and coalesce(new.data->>'origin', '') <> 'db' and (app_is_service() or v_ctx = 'session') then
    select e.id into v_id
    from job_events e
    where e.job_id = new.job_id and e.type = 'stage' and e.data->>'origin' = 'db'
      and not (e.data ? 'merged')
      and e.data->>'to' = new.data->>'to'
      and (new.data->>'from' is null or e.data->>'from' = new.data->>'from')
      and e.created_at > now() - interval '2 minutes'
      and (case when v_ctx = 'session' then e.actor_id is not distinct from new.actor_id
                else new.request_id is null or e.request_id is null or e.request_id = new.request_id end)
    order by (e.request_id is not distinct from new.request_id) desc, e.created_at desc
    limit 1;
    if v_id is not null then
      update job_events e set
        message = new.message || case when e.data ? 'reason' and position('důvod' in new.message) = 0
                                      then ' · důvod: ' || lost_reason_label(e.data->>'reason') else '' end,
        data = e.data || (new.data - 'from' - 'to' - 'origin' - 'merged') || jsonb_build_object('merged', true),
        actor_id   = case when v_ctx = 'session' then e.actor_id else coalesce(e.actor_id, new.actor_id) end,
        actor_name = case when v_ctx = 'session' then e.actor_name else coalesce(e.actor_name, new.actor_name) end,
        actor_kind = case when v_ctx <> 'session' and e.actor_id is null and new.actor_id is not null
                          then new.actor_kind else e.actor_kind end
      where e.id = v_id;
      return null;                               -- druhý řádek se nevloží
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_events_before_insert on job_events;
create trigger trg_job_events_before_insert before insert on job_events
  for each row execute function job_events_before_insert();

-- Fakta dokladů ze strukturovaných událostí e-mailu (sendJobDocument: data.kind, data.fileId)
create or replace function job_events_flow_after()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_kind  text := new.data->>'kind';
  v_file  uuid := app_uuid(new.data->>'fileId');
  v_rev   int;
  v_quote uuid;
  v_prev  text := current_setting('app.flow_cause', true);
begin
  if new.type <> 'email' or v_kind is null then return null; end if;
  -- REST se session: fakt „odesláno" jen s opravdu odeslaným e-mailem k této zakázce (odeslaná pošta
  -- zapisuje jen server) — vložená událost sama nic nepotvrdí
  if app_ctx() = 'session' and not exists (
       select 1 from emails m where m.id = app_uuid(new.data->>'emailId') and m.direction = 'out' and m.order_id = new.job_id) then
    return null;
  end if;
  if v_kind = 'potvrzeni' then
    -- revize, kterou odeslaný soubor pokrývá: z metadat, jinak platná v době jeho vytvoření (M5)
    select coalesce(f.order_revision,
                    (select max(r.revision) from job_order_revisions r where r.job_id = f.job_id and r.created_at <= f.created_at))
      into v_rev from job_files f where f.id = v_file;
    select coalesce(v_rev, o.order_revision, 1) into v_rev from orders o where o.id = new.job_id;
    perform set_config('app.flow_cause', 'potvrzeni', true);
    update orders set
      confirmation_sent_at = new.created_at,
      confirmation_sent_by = new.actor_id,
      confirmation_sent_via = 'email',
      confirmation_sent_revision = greatest(coalesce(confirmation_sent_revision, 0), v_rev),
      order_confirmed_revision = case when order_status = 'aktualizovana' and v_rev >= order_revision then v_rev
                                      else order_confirmed_revision end,
      order_status = case when order_status in ('dorucena', 'rozpor') then 'potvrzena'
                          when order_status = 'aktualizovana' and v_rev >= order_revision then 'potvrzena'
                          else order_status end
    where id = new.job_id;
    perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
  elsif v_kind = 'nabidka' and v_file is not null then
    select quote_id into v_quote from job_files where id = v_file;
    if v_quote is not null then
      update quotes set sent_via = 'email' where id = v_quote and status in ('odeslano', 'prijato', 'zamitnuto');
    end if;
  elsif v_kind = 'faktura' then
    update orders set invoice_sent_at = new.created_at, invoice_sent_by = new.actor_id where id = new.job_id;
  end if;
  return null;
end $$;
drop trigger if exists trg_job_events_flow_after on job_events;
create trigger trg_job_events_flow_after after insert on job_events
  for each row execute function job_events_flow_after();

create or replace function audit_log_fill()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then
    null;                                        -- audit z triggeru DB (smazání, profily) — vyplněno
  elsif auth.uid() is not null then
    new.actor_id := app_actor(); new.actor_kind := 'user'; new.via := 'rest';
  else
    new.actor_id := coalesce(new.actor_id, app_actor());
    new.actor_kind := case when new.actor_kind in ('user', 'ai') then new.actor_kind
                           when app_ctx() = 'app' then app_actor_kind()
                           when new.actor_id is not null then 'user' else 'system' end;
    new.via := coalesce(new.via, app_actor_via());
  end if;
  new.request_id := coalesce(new.request_id, app_request_id());
  if new.actor_name is null then
    new.actor_name := coalesce((select coalesce(nullif(btrim(full_name), ''), email) from profiles where id = new.actor_id),
                               new.diff->>'byName');
  end if;
  return new;
end $$;
drop trigger if exists trg_audit_log_fill on audit_log;
create trigger trg_audit_log_fill before insert on audit_log
  for each row execute function audit_log_fill();

create or replace function approval_queue_resolve()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then              -- např. auto_executed z ingestu (AI bez uživatele → NULL)
      new.resolved_at := coalesce(new.resolved_at, now());
      new.resolved_by := app_pick(new.resolved_by);
    end if;
  elsif new.status is distinct from old.status and old.status = 'pending' then
    new.resolved_by := app_pick(case when new.resolved_by is distinct from old.resolved_by then new.resolved_by end);
    new.resolved_at := coalesce(new.resolved_at, now());
  else
    new.resolved_by := app_keep(new.resolved_by, old.resolved_by);
  end if;
  return new;
end $$;
drop trigger if exists trg_approval_queue_resolve on approval_queue;
create trigger trg_approval_queue_resolve before insert or update on approval_queue
  for each row execute function approval_queue_resolve();

-- Obecné created_by / updated_by (adresáře a nastavení)
create or replace function set_row_actor()
returns trigger language plpgsql set search_path = public as $$
declare
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
  v_set jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    if v_new ? 'created_by' then v_set := v_set || jsonb_build_object('created_by', app_pick(app_uuid(v_new->>'created_by'))); end if;
    if v_new ? 'updated_by' then v_set := v_set || jsonb_build_object('updated_by', app_pick(app_uuid(v_new->>'updated_by'))); end if;
  else
    v_old := to_jsonb(old);
    if v_new ? 'updated_by' and app_ctx() <> 'db' then
      v_set := v_set || jsonb_build_object('updated_by', app_pick(
        case when v_new->'updated_by' is distinct from v_old->'updated_by' then app_uuid(v_new->>'updated_by') end));
    end if;
    if v_new ? 'created_by' then
      v_set := v_set || jsonb_build_object('created_by', app_keep(app_uuid(v_new->>'created_by'), app_uuid(v_old->>'created_by')));
    end if;
  end if;
  if v_set <> '{}'::jsonb then new := jsonb_populate_record(new, v_set); end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['customers', 'suppliers', 'customer_contacts', 'mailboxes', 'automation_settings',
                           'automation_global', 'ai_agent_rules', 'integration_settings'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_%s_actor on %I', t, t);
      execute format('create trigger trg_%s_actor before insert or update on %I for each row execute function set_row_actor()', t, t);
    end if;
  end loop;
end $$;

create or replace function drawings_actor()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.uploaded_by := app_pick(new.uploaded_by);
  else new.uploaded_by := app_keep(new.uploaded_by, old.uploaded_by); end if;
  return new;
end $$;
drop trigger if exists trg_drawings_actor on drawings;
create trigger trg_drawings_actor before insert or update on drawings
  for each row execute function drawings_actor();

-- Smazání = vždy záznam s autorem (M8). Celý řádek vidí jen super admin (audit_admin_read).
create or replace function audit_row_delete()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v    jsonb := to_jsonb(old) - 'embedding' - 'ai_extracted' - 'payload' - 'body_text' - 'config';
  v_by uuid := app_actor();
begin
  -- GDPR: u firem a kontaktů jen identifikace (kdo co smazal), žádné osobní údaje navždy
  if tg_table_name in ('customers', 'suppliers') then
    v := jsonb_strip_nulls(jsonb_build_object('id', v->'id', 'name', v->'name', 'ico', v->'ico'));
  elsif tg_table_name = 'customer_contacts' then
    v := jsonb_strip_nulls(jsonb_build_object('id', v->'id', 'customer_id', v->'customer_id'));
  end if;
  insert into audit_log (action, entity, entity_id, diff, actor_id, actor_kind, via, request_id)
  values (tg_table_name || '_deleted', tg_table_name, v->>'id',
          jsonb_strip_nulls(jsonb_build_object('row', v, 'jobId', coalesce(v->>'job_id', v->>'order_id'))),
          v_by, app_event_kind(v_by), case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end,
          app_request_id());
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'quotes', 'job_operations', 'job_files', 'purchase_orders', 'supplier_quotes',
                           'job_payments', 'customers', 'suppliers', 'customer_contacts', 'commission_rules', 'mailboxes'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_%s_audit_delete on %I', t, t);
      execute format('create trigger trg_%s_audit_delete after delete on %I for each row execute function audit_row_delete()', t, t);
    end if;
  end loop;
end $$;

-- dřívější záznamy smazání: osobní údaje pryč (idempotentní)
update audit_log set diff = jsonb_set(diff, '{row}',
    jsonb_strip_nulls(jsonb_build_object('id', diff->'row'->'id', 'name', diff->'row'->'name', 'ico', diff->'row'->'ico')))
where action in ('customers_deleted', 'suppliers_deleted') and diff ? 'row'
  and (diff->'row') - 'id' - 'name' - 'ico' <> '{}'::jsonb;
update audit_log set diff = jsonb_set(diff, '{row}',
    jsonb_strip_nulls(jsonb_build_object('id', diff->'row'->'id', 'customer_id', diff->'row'->'customer_id')))
where action = 'customer_contacts_deleted' and diff ? 'row'
  and (diff->'row') - 'id' - 'customer_id' <> '{}'::jsonb;

-- Role / aktivita / sazba profilu — záchranná síť mimo náš server (users.ts audituje sám)
create or replace function profiles_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_by uuid := app_actor();
begin
  if app_ctx() = 'app' then return null; end if;
  if new.role is distinct from old.role or new.active is distinct from old.active
     or new.commission_rate is distinct from old.commission_rate then
    insert into audit_log (action, entity, entity_id, diff, actor_id, actor_kind, via, request_id)
    values ('profile_changed', 'profiles', new.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'name', new.full_name,
        'role', case when new.role is distinct from old.role then jsonb_build_array(old.role, new.role) end,
        'active', case when new.active is distinct from old.active then jsonb_build_array(old.active, new.active) end,
        'commissionRate', case when new.commission_rate is distinct from old.commission_rate
                               then jsonb_build_array(old.commission_rate, new.commission_rate) end)),
      v_by, app_event_kind(v_by), app_actor_via(), app_request_id());
  end if;
  return null;
end $$;
drop trigger if exists trg_profiles_audit on profiles;
create trigger trg_profiles_audit after update on profiles
  for each row execute function profiles_audit();

-- ── 16) RPC toku (vícekrokové akce atomicky; autor jen z app_actor(), žádný parametr autora — M3) ──
create or replace function flow_register_order_change(p_job uuid, p_note text default null, p_file uuid default null,
  p_changes jsonb default null, p_customer_order_number text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_rev    int;
  v_status text;
begin
  if auth.uid() is not null and not is_active_user() then
    raise exception 'Účet není aktivní.' using errcode = '42501';
  end if;
  select order_revision, order_status into v_rev, v_status from orders where id = p_job for update;
  if not found then raise exception 'Zakázka nenalezena.' using errcode = 'P0002'; end if;
  if v_status is null or v_status = 'stornovana' then
    raise exception 'Zakázka nemá platnou objednávku.' using errcode = 'P0001';
  end if;
  v_rev := greatest(coalesce(v_rev, 0), 1) + 1;
  insert into job_order_revisions (job_id, revision, customer_order_number, file_id, changes, note, created_by, created_via)
  values (p_job, v_rev, nullif(btrim(coalesce(p_customer_order_number, '')), ''), p_file, p_changes,
          left(nullif(btrim(coalesce(p_note, '')), ''), 2000), app_actor(), app_actor_via());
  update orders set order_revision = v_rev where id = p_job;
  return v_rev;
end $$;

create or replace function flow_decide_order_change(p_job uuid, p_accept boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rev    int;
  v_status text;
begin
  if auth.uid() is not null and not is_active_user() then
    raise exception 'Účet není aktivní.' using errcode = '42501';
  end if;
  select order_revision, order_status into v_rev, v_status from orders where id = p_job for update;
  if not found then raise exception 'Zakázka nenalezena.' using errcode = 'P0002'; end if;
  if v_status is distinct from 'aktualizovana' then
    raise exception 'Objednávka nečeká na rozhodnutí o změně.' using errcode = 'P0001';
  end if;
  update job_order_revisions
     set decision = case when p_accept then 'prijata' else 'odmitnuta' end,
         decided_at = now(), decided_by = app_actor(),
         decision_note = left(nullif(btrim(coalesce(p_note, '')), ''), 2000)
   where job_id = p_job and revision = v_rev and decision = 'ceka';
  update orders set order_status = 'potvrzena',
                    order_confirmed_revision = case when p_accept then v_rev else order_confirmed_revision end
  where id = p_job;
end $$;

create or replace function flow_reject_quote(p_quote uuid, p_reason text, p_note text default null,
  p_competitor_price numeric default null, p_close_job boolean default false)
returns job_stage language plpgsql security definer set search_path = public as $$
declare
  v_job    uuid;
  v_status quote_status;
  v_note   text := left(nullif(btrim(coalesce(p_note, '')), ''), 2000);
  v_stage  job_stage;
  v_arch   boolean;
begin
  if auth.uid() is not null and not is_active_user() then
    raise exception 'Účet není aktivní.' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('nevyrabime', 'kapacita', 'nevyplati_se', 'duplicita', 'cena', 'termin',
       'jiny_dodavatel', 'projekt_zrusen', 'bez_odezvy', 'zakaznik_stahl', 'jine') then
    raise exception 'Vyber důvod zamítnutí.' using errcode = 'P0001';
  end if;
  if p_reason = 'jine' and v_note is null then
    raise exception 'U důvodu „Jiný“ doplň poznámku.' using errcode = 'P0001';
  end if;
  if not app_actor_may_decide() then
    raise exception 'Zamítnout nabídku smí obchodník nebo admin — navrhni zamítnutí.' using errcode = '42501';
  end if;
  select job_id, status, archived into v_job, v_status, v_arch from quotes where id = p_quote for update;
  if not found then raise exception 'Nabídka nenalezena.' using errcode = 'P0002'; end if;
  if v_arch then
    raise exception 'Archivovanou verzi nabídky zamítnout nejde — platí novější verze.' using errcode = 'P0001';
  end if;
  if v_status <> 'odeslano' then
    raise exception 'Zamítnout lze jen odeslanou nabídku.' using errcode = 'P0001';
  end if;
  update quotes set status = 'zamitnuto', lost_reason = p_reason, rejected_reason = v_note,
                    competitor_price = p_competitor_price
  where id = p_quote;
  if p_close_job and v_job is not null then
    update orders set lost_reason = p_reason, lost_note = v_note, status = 'nerealizovano'
    where id = v_job and status in ('poptavka', 'naceneni', 'nabidka');
  end if;
  select status into v_stage from orders where id = v_job;
  return v_stage;
end $$;

-- ── 17) Odvozené stavy pro filtry a počty (zrcadlo v TS: flow-status.ts, test parity) ──
create or replace view job_flow_v with (security_invoker = true) as
with q as (
  select distinct on (q.job_id) q.job_id, q.id as quote_id, q.number as quote_number, q.revision as quote_revision,
         q.state as quote_state, q.valid_until, q.sent_at as quote_sent_at, q.ai_generated, q.approval_required
  from quotes q where q.job_id is not null
  order by q.job_id, (q.state = 'prijata') desc, q.archived, q.revision desc, q.created_at desc
), sq as (
  select job_id, (count(*) filter (where total is null))::int as pending_supplier_quotes
  from supplier_quotes group by job_id
), b as (
  select o.*, job_stage_rank(o.status) as stage_rank,
    (o.items_count > 0 and o.items_delivered = o.items_count) as delivered_all,
    ((o.items_count > 0 and (o.items_delivered > 0 or o.items_partial > 0) and o.items_delivered < o.items_count)
      or (o.items_count = 0 and o.partial_delivery_at is not null and job_stage_rank(o.status) < 9)) as delivered_partial
  from orders o
)
select
  b.id, b.number, b.status, b.owner_id, b.assignee_id, b.customer_id, b.stage_changed_at, b.stage_rank,
  b.inquiry_status as inquiry_key,
  case when b.status not in ('poptavka', 'naceneni') then null
       when b.items_count > 0 and b.items_priced = b.items_count then 'naceneno'
       when coalesce(sq.pending_supplier_quotes, 0) > 0 then 'ceka_na_dodavatele'
       when b.items_priced > 0 then 'rozpracovano'
       else 'ceka' end as pricing_key,
  q.quote_id, q.quote_number, q.quote_revision, q.ai_generated as quote_ai, q.approval_required as quote_approval_required,
  case when q.quote_state in ('odeslana', 'pripominky') and q.valid_until < app_today() then 'vyprsela'
       else q.quote_state end as quote_key,
  b.order_status as order_key,
  case when b.order_status is null or b.order_status not in ('potvrzena', 'aktualizovana')
            or b.status in ('reklamace', 'nerealizovano', 'zruseno') then null
       when b.delivered_all or (b.stage_rank >= 9 and not b.delivered_partial) then 'dokoncena'
       when b.delivered_partial then 'castecne_dodana'
       when b.stage_rank between 5 and 8 then 've_vyrobe'
  end as fulfilment_key,
  case when b.order_status = 'potvrzena' then
         case when coalesce(b.confirmation_sent_revision, 0) >= coalesce(b.order_confirmed_revision, b.order_revision)
              then 'odeslano' else 'bez_dokladu' end
       when b.order_status in ('dorucena', 'rozpor', 'aktualizovana') then
         case when coalesce(b.confirmation_issued_revision, 0) >= b.order_revision
                   and coalesce(b.confirmation_sent_revision, 0) < b.order_revision then 'vystaveno'
              else 'k_vystaveni' end
  end as confirmation_key,
  case when b.order_status is null or b.status in ('reklamace', 'nerealizovano', 'zruseno') then null
       when b.delivered_all or (b.stage_rank >= 9 and not b.delivered_partial) then
         case when b.delivery_note_confirmed_at is not null
                   and (b.last_delivery_at is null
                        or b.delivery_note_confirmed_at >= (b.last_delivery_at at time zone 'Europe/Prague')::date)
              then 'dl_potvrzen' else 'dodano' end
       when b.delivered_partial then 'castecne'
       when b.stage_rank between 5 and 8
            and ((b.production_total > 0 and b.production_done = b.production_total) or b.status in ('dodano_k_nam', 'na_sklade'))
         then 'k_expedici'
  end as delivery_key,
  case when b.status in ('nerealizovano', 'zruseno') then null
       when b.paid_at is not null or b.status = 'dokonceno' then 'zaplaceno'
       when b.invoice_number is null and b.paid_so_far = 0 and b.status <> 'fakturovano' then null
       when b.invoice_due_date is not null and b.invoice_due_date < app_today() then 'po_splatnosti'
       when b.paid_so_far > 0 then 'castecne_zaplaceno'
       else 'ceka_na_uhradu' end as payment_key,
  case when b.inquiry_status = 'ceka_na_podklady' and b.waiting_since is not null
         then app_today() - (b.waiting_since at time zone 'Europe/Prague')::date
       when q.quote_state in ('odeslana', 'pripominky') and q.quote_sent_at is not null
         then app_today() - (q.quote_sent_at at time zone 'Europe/Prague')::date
       when b.order_status = 'rozpor' and b.order_status_changed_at is not null
         then app_today() - (b.order_status_changed_at at time zone 'Europe/Prague')::date
  end as waiting_days,
  b.flow_proposal is not null as has_proposal,
  b.items_count, b.items_delivered, b.items_partial, b.production_done, b.production_total, b.paid_so_far
from b
left join q on q.job_id = b.id
left join sq on sq.job_id = b.id;

/** Počty chipů pro záložky toku (uzavřené stavy jen za posledních N dní). */
create or replace function flow_counts(p_owner uuid default null, p_closed_days int default 30)
returns table (flow_phase text, flow_key text, n int)
language sql stable set search_path = public as $$
  with v as (select * from job_flow_v where p_owner is null or owner_id = p_owner),
  x as (
    select 'inquiry' as ph, inquiry_key as k, stage_changed_at as t from v
    union all select 'pricing', pricing_key, stage_changed_at from v
    union all select 'order', order_key, stage_changed_at from v
    union all select 'fulfilment', fulfilment_key, stage_changed_at from v
    union all select 'confirmation', confirmation_key, stage_changed_at from v
    union all select 'delivery', delivery_key, stage_changed_at from v
    union all select 'payment', payment_key, stage_changed_at from v
  ),
  y as (
    select 'quote' as ph,
           case when q.state in ('odeslana', 'pripominky') and q.valid_until < app_today() then 'vyprsela' else q.state end as k,
           q.state_changed_at as t
    from quotes q left join orders o on o.id = q.job_id
    where p_owner is null or coalesce(q.owner_id, o.owner_id) = p_owner
  )
  select ph, k, count(*)::int from x
  where k is not null
    and (k not in ('zpracovana', 'odmitnuta', 'stazena', 'stornovana', 'dokoncena', 'zaplaceno')
         or t > now() - make_interval(days => greatest(p_closed_days, 1)))
  group by ph, k
  union all
  select ph, k, count(*)::int from y
  where k not in ('prijata', 'zamitnuta', 'archivovana')
     or t > now() - make_interval(days => greatest(p_closed_days, 1))
  group by ph, k
$$;

-- ── 18) RLS ─────────────────────────────────────────────────
drop policy if exists "job_events_admin" on job_events;   -- historie jen přibývá (servisní role mazat smí)

alter table job_payments enable row level security;
alter table job_order_revisions enable row level security;
do $$ begin
  create policy "job_payments_select" on job_payments for select using (is_obchodnik_or_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "job_payments_write" on job_payments for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "job_order_revisions_select" on job_order_revisions for select using (is_obchodnik_or_admin());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "job_order_revisions_admin" on job_order_revisions for all using (is_super_admin()) with check (is_super_admin());
exception when duplicate_object then null; end $$;

-- ── 19) Práva na funkce (M3) ────────────────────────────────
do $$
declare f text;
begin
  -- volané z triggerů typu INVOKER (spouští je i session klient) nebo bezpečné RPC: anon ne
  foreach f in array array[
    'app_today()', 'app_is_service()', 'app_header(text)', 'app_uuid(text)', 'app_ctx()', 'app_actor()',
    'app_actor_kind()', 'app_actor_via()', 'app_actor_agent()', 'app_request_id()', 'app_change_note()',
    'app_pick(uuid)', 'app_keep(uuid,uuid)', 'app_keep_any(anyelement,anyelement)', 'app_event_kind(uuid)',
    'app_actor_may_decide()', 'app_guard_decisions()',
    'app_whoami()', 'quote_approval_required(boolean,numeric,timestamptz)', 'flow_counts(uuid,integer)',
    'flow_register_order_change(uuid,text,uuid,jsonb,text)', 'flow_decide_order_change(uuid,boolean,text)',
    'flow_reject_quote(uuid,text,text,numeric,boolean)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- vnitřní přepočty (SECURITY DEFINER, mění data) a čtení nákladů: jen DB a servisní role
  foreach f in array array[
    'recompute_job_flow(uuid,boolean)', 'recompute_job_payments(uuid)',
    'sync_payments_from_order(uuid,date,numeric,date,numeric)', 'recompute_job_production(uuid)',
    'recompute_job_commission(uuid)', 'recompute_owner_month(uuid,date)', 'recompute_owner_commissions(uuid)',
    'job_cost(uuid)', 'commission_rule_for(uuid,date)'] loop
    if to_regprocedure(f) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', f);
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end $$;
revoke all on job_flow_v from anon;
grant select on job_flow_v to authenticated, service_role;

-- ── 20) Indexy ──────────────────────────────────────────────
create index if not exists idx_orders_inquiry_status   on orders(inquiry_status);
create index if not exists idx_orders_order_status     on orders(order_status) where order_status is not null;
create index if not exists idx_orders_stage_changed_by on orders(stage_changed_by, stage_changed_at desc);
create index if not exists idx_quotes_state            on quotes(state);
create index if not exists idx_job_events_entity       on job_events(entity, entity_id, created_at desc);
create index if not exists idx_job_events_actor        on job_events(actor_id, created_at desc);
create index if not exists idx_job_events_stage_merge  on job_events(job_id, created_at desc) where type = 'stage';
create index if not exists idx_job_payments_job        on job_payments(job_id, paid_on);
create index if not exists idx_audit_log_actor         on audit_log(actor_id, created_at desc);
create index if not exists idx_job_events_moves_recent on job_events(created_at desc) where type in ('stage', 'status');  -- přehled „Co kdo dnes posunul"
-- job_order_revisions: unique (job_id, revision) stačí (minor 9)

-- ── 21) Číselné řady dokladů přeskočí čísla, která už existují ──
-- Import, demo data nebo ruční zápis můžou obsadit číslo před čítačem (NAB-2026-034 při čítači 32):
-- další číslo by narazilo na unikátní klíč a nabídka / doklad by nešel vytvořit. Řada proto přeskočí
-- obsazená čísla (čítač se jen zvyšuje, nikdy neresetuje). SECURITY DEFINER: kontrola musí vidět
-- všechny doklady bez ohledu na RLS volajícího.
create or replace function next_doc_number(p_prefix text)
returns text language plpgsql security definer set search_path = public as $$
declare
  y    int := extract(year from now());
  n    int;
  cand text;
  used boolean;
begin
  for i in 1..1000 loop
    insert into doc_counters(doc_type, year, counter)
    values (p_prefix, y, 1)
    on conflict (doc_type) do update
      set counter = case when doc_counters.year = y then doc_counters.counter + 1 else 1 end,
          year = y
    returning counter into n;
    cand := p_prefix || '-' || y || '-' || lpad(n::text, greatest(3, length(n::text)), '0');
    used := case p_prefix
      when 'NAB' then exists (select 1 from quotes where number = cand)
      when 'Z'   then exists (select 1 from orders where number = cand)
      when 'OV'  then exists (select 1 from purchase_orders where number = cand)
      when 'FV'  then exists (select 1 from orders where invoice_number = cand) or exists (select 1 from invoices where number = cand)
      when 'DL'  then exists (select 1 from orders where delivery_note_number = cand)
      else false end;
    if not used then return cand; end if;
  end loop;
  raise exception 'Číselná řada % je vyčerpaná (1000 obsazených čísel po sobě).', p_prefix using errcode = 'P0001';
end $$;
revoke all on function next_doc_number(text) from public, anon;
grant execute on function next_doc_number(text) to authenticated, service_role;

-- Čítače číslování: jen DB (next_doc_number je SECURITY DEFINER) a servisní role — publishable klíčem nic
alter table doc_counters enable row level security;
revoke all on doc_counters from anon, authenticated;
grant all on doc_counters to service_role;

notify pgrst, 'reload schema';

