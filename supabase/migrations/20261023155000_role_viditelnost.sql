-- ============================================================
-- 20261023155000 — Role a viditelnost (#25)
--  * nabídky ne-adminů schvaluje super admin (quotes.admin_approval_required, R0–R7, otisk, vrácení)
--  * obchodní tok „moje" (flow_mine_job_ids, flow_counts p_mine, flow_badge_counts)
--  * RLS: pošta přes my_mailbox_ids(), fronta, soubory a úložiště, aktivní účty
--  * AI focení pro všechny (jednorázově, značkou)
--  * REST pojistky (review 25-A): sent_at a schválení odeslané nabídky ne-admin nemění, zamítnout jen odeslanou,
--    položka nejde přesunout mezi nabídkami, řádek fronty a e-mail přes session jen pro čtení (kromě příznaků),
--    zrušené schválení maže „Schválil“ u zakázky, úložiště jen aktivním účtům
--
-- POZOR — PŘEDEFINOVANÉ FUNKCE (zdrojové migrace už jsou aplikované a nemění se, proto zrcadlo tady):
--   flow_state_label(), quotes_flow_before(), job_files_flow_before(), flow_counts()
--       původně 20261023100000_podrobne_stavy_atribuce.sql (:179, :1448, :1905, :2398)
--   is_super_admin(), is_obchodnik_or_admin()
--       původně 20260607090100_profiles_roles.sql (:26, :31)
--   Platí POSLEDNÍ definice (tato). Další změny dělej v nové migraci od těchto těl, ne od původních;
--   test parity (flow-status.test.ts) čte poslední definici napříč seřazenými migracemi.
--   20261023160000 (WP4) nesmí znovu definovat job_files_select/update ani job_files_bucket_read.
-- Idempotentní: druhé spuštění nic nezmění (backfill 0 řádků, značka AI focení).
-- ============================================================

-- ── 1) Role a autor ─────────────────────────────────────────
/** Super admin — jen aktivní účet (#25; dřív bez kontroly active). */
create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' and active from profiles where id = auth.uid()), false);
$$;

/** Obchodník nebo super admin — jen aktivní účet (#25). */
create or replace function is_obchodnik_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin', 'obchodnik') and active from profiles where id = auth.uid()), false);
$$;

/** Autor zápisu (app_actor) je aktivní super admin. */
create or replace function app_actor_is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.role = 'super_admin' and p.active from profiles p where p.id = app_actor()), false)
$$;

/** Přímý zápis člověka (REST nebo náš server s autorem), který NENÍ super admin. */
create or replace function app_actor_is_non_admin_user() returns boolean
language sql stable security definer set search_path = public as $$
  select app_ctx() in ('session', 'app') and app_actor() is not null and not app_actor_is_super_admin()
$$;

/** Autor nabídky není super admin → odeslat ji lze až po schválení super adminem. Bez autora = ne. */
create or replace function quote_author_needs_admin(p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_author is not null and exists (select 1 from profiles p where p.id = p_author and p.role <> 'super_admin')
$$;

/** AI nabídka v režimu „se schválením" (zbytek M1; důvody „žádost" a „limit částky" #25 ruší). */
create or replace function quote_ai_needs_approval(p_ai boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_ai, false)
     and coalesce((select mode::text from automation_settings where module = 'quote'),
                  (select mode::text from automation_global limit 1), 'approval') = 'approval'
$$;

-- ── 2) Sloupce + indexy ─────────────────────────────────────
alter table quotes add column if not exists admin_approval_required boolean not null default false;
alter table quotes add column if not exists approved_snapshot_sha   text;
alter table quotes add column if not exists approval_returned_at    timestamptz;
alter table quotes add column if not exists approval_returned_by    uuid references profiles(id) on delete set null;
alter table quotes add column if not exists approval_return_note    text;
comment on column quotes.admin_approval_required is
  'Připravil (nebo před odesláním změnil) někdo jiný než super admin — odeslat ji lze až po schválení super adminem. Jen pro čtení (trigger).';
comment on column quotes.approved_snapshot_sha is 'Otisk obsahu nabídky při schválení (píše jen server aplikace).';
comment on column quotes.approval_returned_at is 'Super admin vrátil neschválenou nabídku autorovi k přepracování (důvod v approval_return_note).';

create index if not exists idx_quotes_created_by          on quotes(created_by);
create index if not exists idx_quotes_pending             on quotes(state) where state = 'ke_schvaleni' and not archived;
create index if not exists idx_orders_created_by          on orders(created_by);
create index if not exists idx_orders_email               on orders(email_id) where email_id is not null;
create index if not exists idx_emails_order               on emails(order_id) where order_id is not null;
create index if not exists idx_emails_owner               on emails(owner_id) where owner_id is not null;
create index if not exists idx_job_files_uploaded_by      on job_files(uploaded_by);
create index if not exists idx_job_files_storage_path     on job_files(storage_path);
create index if not exists idx_purchase_orders_created_by on purchase_orders(created_by);
create index if not exists idx_purchase_orders_file       on purchase_orders(file_id) where file_id is not null;
create index if not exists idx_supplier_quotes_file       on supplier_quotes(file_id) where file_id is not null;

-- ── 3) Popisek stavu (zrcadlo 20261023100000:179-202; jediná změna: ke_schvaleni = „Neschválená") ──
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
      when 'rozpracovana' then 'Rozpracovaná' when 'ke_schvaleni' then 'Neschválená' when 'schvalena' then 'Schválená'
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

-- ── 4) Nabídky (zrcadlo 20261023100000:1448 + pravidla #25 R0–R7) ──
create or replace function quotes_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx      text    := app_ctx();
  v_actor    uuid    := app_pick(null);
  v_via      text    := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
  v_direct   boolean := pg_trigger_depth() = 1 and app_ctx() in ('session', 'app');
  v_admin    boolean := app_actor_is_super_admin();
  v_nonadmin boolean := app_actor_is_non_admin_user();
  v_terms    boolean := false;
  v_content  boolean := false;
  v_state    text;
  v_sending  boolean;
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

  -- R0 (#25): schvalovací sloupce jsou pro přímý zápis kohokoli kromě super admina jen pro čtení
  if v_direct and not v_admin then
    if tg_op = 'INSERT' then
      new.admin_approval_required := false;
      new.approved_snapshot_sha := null;
      new.approval_returned_at := null; new.approval_returned_by := null; new.approval_return_note := null;
    else
      new.admin_approval_required := old.admin_approval_required;
      new.ai_generated            := old.ai_generated;
      new.approved_snapshot_sha   := old.approved_snapshot_sha;
      new.approval_returned_at    := old.approval_returned_at;
      new.approval_returned_by    := old.approval_returned_by;
      new.approval_return_note    := old.approval_return_note;
    end if;
    -- R0b (#25): „odesláno“ (sent_at) mění jen odeslání — neodeslaná nabídka by jinak vypadala jako odeslaná
    -- (aplikace podle sent_at přeskakuje otisk a blok AI nabídky); opětovné odeslání odeslané projde
    if tg_op = 'INSERT' then
      if new.status in ('navrh_ai', 'ke_schvaleni') then new.sent_at := null; end if;
    else
      if new.status <> 'odeslano' and (new.status = old.status or old.status in ('navrh_ai', 'ke_schvaleni')) then
        new.sent_at := old.sent_at;
      end if;
      -- schválení odeslané / uzavřené nabídky ne-admin nezruší (pak by ji nešlo přijmout ani znovu schválit)
      if old.status in ('odeslano', 'prijato', 'zamitnuto') then new.approved_by := old.approved_by; end if;
    end if;
  end if;

  -- R0c (#25): zamítnout lze jen odeslanou nabídku (= flow_reject_quote / rejectJobQuote); jinak by
  -- „zamítnout → znovu otevřít jako odeslanou“ obešlo schválení
  if tg_op = 'UPDATE' and v_direct and new.status = 'zamitnuto' and old.status in ('navrh_ai', 'ke_schvaleni') then
    raise exception 'Zamítnout lze jen odeslanou nabídku.' using errcode = 'P0001';
  end if;

  -- R1 (#25): autor / editor není super admin → odeslat až po schválení super adminem (nikdy se samo nevypne)
  if tg_op = 'INSERT' then
    new.admin_approval_required := coalesce(new.admin_approval_required, false) or quote_author_needs_admin(new.created_by);
  else
    v_terms := new.total is distinct from old.total or new.title is distinct from old.title
      or new.lead_time_days is distinct from old.lead_time_days or new.payment_terms is distinct from old.payment_terms
      or new.delivery_terms is distinct from old.delivery_terms or new.note is distinct from old.note
      or new.currency is distinct from old.currency or new.customer_id is distinct from old.customer_id
      or new.job_id is distinct from old.job_id;
    v_content := v_terms or new.valid_until is distinct from old.valid_until;
    -- R5 (#25): odeslanou / uzavřenou nabídku ne-admin obsahově nezmění (platnost prodloužit smí)
    if v_terms and v_direct and v_nonadmin and old.status in ('odeslano', 'prijato', 'zamitnuto') then
      raise exception 'Odeslanou nabídku nejde upravit — vytvoř novou verzi.' using errcode = 'P0001';
    end if;
    if v_content and old.status in ('navrh_ai', 'ke_schvaleni') then
      if v_direct and v_nonadmin then
        new.admin_approval_required := true;
        new.approved_by := null;
      elsif v_direct and v_admin and new.approved_by is not null and new.approved_by is not distinct from old.approved_by then
        new.approved_at := now();   -- úprava super admina = nové schválení (server dopočte otisk)
      end if;
      new.approval_returned_at := null; new.approval_returned_by := null; new.approval_return_note := null;
    end if;
  end if;

  -- žádost o schválení (M1; od #25 jen informace, schválení nevyžaduje)
  if new.approval_requested_at is not null and (tg_op = 'INSERT' or old.approval_requested_at is null) then
    new.approval_requested_by := app_pick(new.approval_requested_by);
  elsif new.approval_requested_at is null then
    new.approval_requested_by := null;
  elsif tg_op = 'UPDATE' then
    new.approval_requested_by := app_keep(new.approval_requested_by, old.approval_requested_by);
  end if;
  -- R2 (#25): schválení nutné = AI v režimu se schválením NEBO nabídka ne-admina
  new.approval_required := quote_ai_needs_approval(new.ai_generated) or new.admin_approval_required;

  -- schválení: přes REST jen sebou (M2); R4: čas vždy DB, otisk píše jen náš server
  if new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by) then
    new.approved_by := app_pick(new.approved_by);
    new.approved_at := case when v_ctx = 'db' then coalesce(new.approved_at, now()) else now() end;
    if v_ctx = 'session' then new.approved_snapshot_sha := null; end if;
    new.approval_returned_at := null; new.approval_returned_by := null; new.approval_return_note := null;
  elsif new.approved_by is null then
    new.approved_at := null;
    new.approved_snapshot_sha := null;
  elsif tg_op = 'UPDATE' and v_direct and not (v_admin and v_content) then
    new.approved_at := old.approved_at;
  end if;

  -- R3 (#25): schvaluje jen super admin; bez autora (systém, psql, servisní skript) projde
  if new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by)
     and v_ctx in ('session', 'app') and app_actor() is not null and not v_admin then
    raise exception 'Nabídku schvaluje jen super admin.' using errcode = '42501';
  end if;

  -- R6 (#25): vrácení k přepracování (zapsat smí jen super admin — R0)
  if new.approval_returned_at is not null and (tg_op = 'INSERT' or old.approval_returned_at is null) then
    if new.status not in ('navrh_ai', 'ke_schvaleni') or new.approved_by is not null then
      raise exception 'Vrátit k přepracování jde jen neschválenou nabídku.' using errcode = 'P0001';
    end if;
    new.approval_returned_at := now();
    new.approval_returned_by := app_pick(new.approval_returned_by);
  elsif new.approval_returned_at is null then
    new.approval_returned_by := null; new.approval_return_note := null;
  elsif tg_op = 'UPDATE' then
    new.approval_returned_by := app_keep(new.approval_returned_by, old.approval_returned_by);
  end if;

  -- R7 (#25): neschválenou nabídku ne-admina nikdo neodešle ani nepřijme — z jakéhokoli stavu;
  -- AI nabídku ke schválení ani po zamítnutí, které nikdy neodešlo (z rozpracované hlídá stráž níže)
  if new.approved_by is null and v_ctx <> 'db'
     and new.status in ('odeslano', 'prijato') and (tg_op = 'INSERT' or new.status is distinct from old.status)
     and (new.admin_approval_required
          or (new.approval_required and tg_op = 'UPDATE' and old.status = 'zamitnuto' and old.sent_at is null)) then
    raise exception '%', case when new.status = 'prijato'
      then 'Nabídka čeká na schválení — přijmout ji lze až po schválení a odeslání.'
      else 'Nabídka čeká na schválení — odeslat ji lze až po schválení.' end using errcode = 'P0001';
  end if;

  -- schválit, odeslat a zamítnout smí obchodník nebo admin; #25: schválenou nabídku ne-admina smí odeslat
  -- i její autor, obchodník nebo řešitel zakázky
  if app_guard_decisions() and (
       (new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by))
    or (new.status = 'zamitnuto' and (tg_op = 'INSERT' or new.status is distinct from old.status))
    or (new.status = 'odeslano' and (tg_op = 'INSERT' or new.status is distinct from old.status)
        and not (tg_op = 'UPDATE' and old.status in ('navrh_ai', 'ke_schvaleni')
                 and new.admin_approval_required and new.approved_by is not null
                 and (app_actor() = new.created_by
                      or exists (select 1 from orders o where o.id = new.job_id
                                 and app_actor() in (o.owner_id, o.assignee_id)))))) then
    raise exception 'Schválit, odeslat nebo zamítnout nabídku smí obchodník nebo admin.' using errcode = '42501';
  end if;

  -- neschválenou nabídku (AI) zákazník nedostal → nejde ji ani přijmout
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
-- trg_quotes_flow zůstává (mění se jen funkce)

/** Položky nabídky (#25): změna od ne-admina = nové schválení; u odeslané nabídky ne-admin položky nemění.
 *  Každá větev zapíše řádek nabídky → quotes.updated_at se posune (souběh se schválením ze seznamu). */
create or replace function quote_items_admin_approval()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_quote  uuid := case when tg_op = 'DELETE' then old.quote_id else new.quote_id end;
  v_status quote_status;
begin
  -- položku nejde přesunout do jiné nabídky (odeslaná by přišla o položky bez R5, schválená bez nového schválení)
  if tg_op = 'UPDATE' and new.quote_id is distinct from old.quote_id and app_ctx() <> 'db' then
    raise exception 'Položku nejde přesunout do jiné nabídky.' using errcode = 'P0001';
  end if;
  select status into v_status from quotes where id = v_quote;
  if not found then return null; end if;                        -- nabídka se právě maže (kaskáda)
  if app_actor_is_non_admin_user() then
    if v_status in ('odeslano', 'prijato', 'zamitnuto') then
      raise exception 'Odeslanou nabídku nejde upravit — vytvoř novou verzi.' using errcode = 'P0001';
    end if;
    update quotes set admin_approval_required = true, approved_by = null,
           approval_returned_at = null, approval_returned_by = null, approval_return_note = null
     where id = v_quote;
  elsif v_status in ('navrh_ai', 'ke_schvaleni') then
    -- super admin / systém: posun verze; úprava super admina schválenou nabídku znovu schválí (nový čas)
    update quotes set approved_at = case when app_actor_is_super_admin() and approved_by is not null then now() else approved_at end,
           approval_returned_at = null, approval_returned_by = null, approval_return_note = null
     where id = v_quote;
  end if;
  return null;
end $$;
drop trigger if exists trg_quote_items_admin_approval on quote_items;
create trigger trg_quote_items_admin_approval after insert or update or delete on quote_items
  for each row execute function quote_items_admin_approval();

-- ── 5) Zakázka: obchodníka mění jen super admin (#25) ───────
create or replace function orders_owner_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.owner_id is distinct from old.owner_id and pg_trigger_depth() = 1
     and app_actor_is_non_admin_user() and app_actor_kind() = 'user' then
    raise exception 'Obchodníka zakázky mění jen super admin.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_owner_guard on orders;
create trigger trg_orders_owner_guard before update of owner_id on orders
  for each row execute function orders_owner_guard();

/** Zrušené schválení nabídky → zakázka nehlásí „Schválil …“ (orders.approved_by/at), pokud ho nenese
 *  jiná schválená nabídka zakázky. Platí pro každé zrušení (úprava ne-admina, položky, otisk, „Vrátit k úpravě“). */
create or replace function quotes_order_approval_reset()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.approved_by is not null and new.approved_by is null and new.job_id is not null then
    update orders o set approved_by = null, approved_at = null
     where o.id = new.job_id and o.approved_by = old.approved_by
       and not exists (select 1 from quotes q where q.job_id = new.job_id and q.id <> new.id
                         and q.approved_by = old.approved_by and not q.archived);
  end if;
  return null;
end $$;
drop trigger if exists trg_quotes_order_approval_reset on quotes;
-- (ne „update of approved_by“: R1 ruší schválení v BEFORE triggeru, což sloupcový trigger nevidí)
create trigger trg_quotes_order_approval_reset after update on quotes
  for each row when (old.approved_by is not null and new.approved_by is null)
  execute function quotes_order_approval_reset();

-- ── 6) Backfill (triggery ZAPNUTÉ, ctx db: stav se přepočte, quotes_flow_after zapíše historii) ──
-- 6a) příznak + zrušení schválení ne-adminem: neodeslané (i zamítnuté, které nikdy neodešly; i archivní verze)
--     nabídky zakázek, které jsou ještě v obchodní fázi (nebo bez zakázky). Staré koncepty zakázek, které už
--     běží dál (objednávka, výroba, dokončeno), se neoznačují — nehlásily by se jako „Neschválená“ a nebraly
--     by ceny do potvrzení / faktury. Jejich pozdější úprava ne-adminem je označí (R1).
update quotes q set
  admin_approval_required = q.admin_approval_required or quote_author_needs_admin(q.created_by),
  approved_by = case when q.approved_by is not null and quote_author_needs_admin(q.approved_by) then null else q.approved_by end
where (q.status in ('navrh_ai', 'ke_schvaleni') or (q.status = 'zamitnuto' and q.sent_at is null))
  and (q.job_id is null or exists (select 1 from orders o where o.id = q.job_id
                                     and o.status in ('poptavka', 'naceneni', 'nabidka', 'pozastaveno')))
  and ((not q.admin_approval_required and quote_author_needs_admin(q.created_by))
    or (q.approved_by is not null and quote_author_needs_admin(q.approved_by)));
-- 6b) schválení nutné jen z důvodů #25 (AI / příznak) — „žádost“ a „limit částky“ už nerozhodují (R2 přepočte)
update quotes q set admin_approval_required = q.admin_approval_required
where q.status in ('navrh_ai', 'ke_schvaleni')
  and q.approval_required is distinct from (quote_ai_needs_approval(q.ai_generated) or q.admin_approval_required);
-- 6c) zakázka v obchodní fázi bez odeslané / přijaté nabídky nehlásí schválení ne-adminem
update orders o set approved_by = null, approved_at = null
where o.approved_by is not null and quote_author_needs_admin(o.approved_by)
  and o.status in ('poptavka', 'naceneni', 'nabidka')
  and not exists (select 1 from quotes q where q.job_id = o.id and q.status in ('odeslano', 'prijato'));

-- ── 7) „Moje" ───────────────────────────────────────────────
/** Moje schránky (aktivní přihlášený); pro politiky pošty (tabulku mailboxes čte jen admin). */
create or replace function my_mailbox_ids() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(m.id), '{}'::uuid[]) from mailboxes m
  where auth.uid() is not null and is_active_user() and m.owner_id = auth.uid()
$$;

/** Moje zakázky obchodního toku (TS dvojče: src/lib/auth/flow-scope.ts isMineJob). Session → vždy auth.uid(). */
create or replace function flow_mine_job_ids(p_user uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with me as (
    select case when auth.uid() is not null then (case when is_active_user() then auth.uid() end) else p_user end as id),
  boxes as (select m.id from mailboxes m, me where me.id is not null and m.owner_id = me.id),
  mail as (select e.id, e.order_id from emails e, me
           where me.id is not null and (e.owner_id = me.id or e.mailbox_id in (select id from boxes)))
  select o.id from orders o, me
   where me.id is not null and (o.owner_id = me.id or o.assignee_id = me.id or o.created_by = me.id)
  union select o.id from orders o where o.email_id in (select id from mail)
  union select m.order_id from mail m where m.order_id is not null
  union select q.job_id from quotes q, me
   where me.id is not null and q.job_id is not null
     and (q.created_by = me.id or q.owner_id = me.id or q.approval_requested_by = me.id)
$$;

drop function if exists flow_counts(uuid, integer);
/** Počty chipů pro záložky toku (uzavřené stavy jen za posledních N dní); p_mine = jen „moje" (session → auth.uid()). */
create or replace function flow_counts(p_owner uuid default null, p_closed_days int default 30, p_mine uuid default null)
returns table (flow_phase text, flow_key text, n int)
language sql stable set search_path = public as $$
  with me as (select case when p_mine is null then null::uuid else coalesce(auth.uid(), p_mine) end as uid),
  mine as (select t.id from me cross join lateral flow_mine_job_ids(me.uid) as t(id) where me.uid is not null),
  v as (select f.* from job_flow_v f
        where (p_owner is null or f.owner_id = p_owner)
          and ((select uid from me) is null or f.id in (select id from mine))),
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
    where (p_owner is null or coalesce(q.owner_id, o.owner_id) = p_owner)
      and ((select uid from me) is null or q.job_id in (select id from mine)
           or (select uid from me) in (q.created_by, q.owner_id, q.approval_requested_by))
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

/** Odznaky menu (= getBadgeCounts; p_mine null = všichni). Nabídky uzavřených zakázek a archivní verze se nepočítají. */
create or replace function flow_badge_counts(p_mine uuid default null)
returns table (inquiries int, pricing int, quotes_pending int, quotes_pending_manual int,
               quotes_ready int, quotes_returned int, confirmations int)
language sql stable set search_path = public as $$
  with me as (select case when p_mine is null then null::uuid else coalesce(auth.uid(), p_mine) end as uid),
  mine as (select t.id from me cross join lateral flow_mine_job_ids(me.uid) as t(id) where me.uid is not null),
  o as (select o.id, o.status, o.inquiry_status, o.order_status from orders o
        where (select uid from me) is null or o.id in (select id from mine)),
  q as (select q.id, q.state, q.approval_returned_at from quotes q left join orders j on j.id = q.job_id
        where not q.archived and (j.id is null or j.status not in ('dokonceno', 'nerealizovano', 'zruseno'))
          and ((select uid from me) is null or q.job_id in (select id from mine)
               or (select uid from me) in (q.created_by, q.owner_id, q.approval_requested_by)))
  select
    (select count(*) from o where o.inquiry_status in ('prijata', 'v_reseni', 'ceka_na_podklady') and o.status in ('poptavka', 'naceneni'))::int,
    (select count(*) from o where o.status in ('poptavka', 'naceneni'))::int,
    (select count(*) from q where q.state = 'ke_schvaleni' and q.approval_returned_at is null)::int,
    (select count(*) from q where q.state = 'ke_schvaleni' and q.approval_returned_at is null
       and not exists (select 1 from approval_queue a where a.quote_id = q.id and a.status = 'pending'))::int,
    (select count(*) from q where q.state = 'schvalena')::int,
    (select count(*) from q where q.state = 'ke_schvaleni' and q.approval_returned_at is not null)::int,
    (select count(*) from o where o.order_status in ('dorucena', 'rozpor', 'aktualizovana')
       and o.status not in ('nerealizovano', 'zruseno', 'pozastaveno', 'reklamace'))::int
$$;

-- ── 8) RLS ──────────────────────────────────────────────────
-- Pošta: politiky dřív četly mailboxes přímo — tu vidí jen admin, takže vlastník schránky nic neviděl
drop policy if exists "emails_select" on emails;
create policy "emails_select" on emails for select using (
  is_active_user() and (is_super_admin() or owner_id = auth.uid() or mailbox_id in (select unnest(my_mailbox_ids()))));
drop policy if exists "emails_update" on emails;
create policy "emails_update" on emails for update using (
  is_active_user() and (is_super_admin() or owner_id = auth.uid() or mailbox_id in (select unnest(my_mailbox_ids()))));
/** E-mail přes REST (session, ne super admin): mění jen příznaky (přečteno, spam, kategorie, priorita,
 *  důležitost, koncept) — ne schránku, vlastníka, obsah ani vazby (jinak by šel „podstrčit“ do cizí schránky).
 *  Aplikace (servisní klíč) a vnořené zápisy DB beze změny. */
create or replace function emails_session_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or is_super_admin() then return new; end if;
  new := jsonb_populate_record(new, to_jsonb(old) || jsonb_build_object(
    'is_read', new.is_read, 'is_spam', new.is_spam, 'category', new.category, 'priority', new.priority,
    'importance', new.importance, 'has_draft', new.has_draft));
  return new;
end $$;
drop trigger if exists trg_emails_session_guard on emails;
create trigger trg_emails_session_guard before update on emails
  for each row execute function emails_session_guard();

drop policy if exists "mailbox_status_owner_read" on mailbox_status;
create policy "mailbox_status_owner_read" on mailbox_status for select using (mailbox_id in (select unnest(my_mailbox_ids())));
drop policy if exists "email_attachments_all" on email_attachments;
drop policy if exists "email_attachments_select" on email_attachments;
create policy "email_attachments_select" on email_attachments for select using (exists (select 1 from emails e where e.id = email_id));

-- Fronta ke schválení: anon a cizí řádky nic; vkládá a maže jen super admin (aplikace servisním klíčem)
drop policy if exists "approval_select" on approval_queue;
create policy "approval_select" on approval_queue for select using (
  is_super_admin() or (is_obchodnik_or_admin() and owner_id = auth.uid()));
drop policy if exists "approval_write" on approval_queue;
drop policy if exists "approval_update" on approval_queue;
create policy "approval_update" on approval_queue for update
  using (is_super_admin() or (is_obchodnik_or_admin() and owner_id = auth.uid()))
  with check (is_super_admin() or (is_obchodnik_or_admin() and owner_id = auth.uid()));
drop policy if exists "approval_insert" on approval_queue;
create policy "approval_insert" on approval_queue for insert with check (is_super_admin());
drop policy if exists "approval_delete" on approval_queue;
create policy "approval_delete" on approval_queue for delete using (is_super_admin());

/** Fronta přes REST (session, ne super admin): obsah řádku je jen pro čtení (jinak by si obchodník přepsal
 *  svůj řádek na „schválení nabídky“ nebo e-mail na cizí adresu a super admin by ho jedním klikem provedl);
 *  smí jen odmítnout čekající řádek. Aplikace (servisní klíč) a vnořené zápisy DB beze změny. */
create or replace function approval_queue_session_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or is_super_admin() then return new; end if;
  if new.status is distinct from old.status and not (old.status = 'pending' and new.status = 'rejected') then
    raise exception 'Položku fronty vyřizuje super admin.' using errcode = '42501';
  end if;
  new := jsonb_populate_record(new, to_jsonb(old) - 'status' - 'resolved_by' - 'resolved_at');
  return new;
end $$;
drop trigger if exists trg_approval_queue_session_guard on approval_queue;
create trigger trg_approval_queue_session_guard before update on approval_queue
  for each row execute function approval_queue_session_guard();

-- Nabídky: zápis aktivním, mazání jen super admin
drop policy if exists "quotes_write" on quotes;
drop policy if exists "quotes_insert" on quotes;
create policy "quotes_insert" on quotes for insert with check (is_active_user());
drop policy if exists "quotes_update" on quotes;
create policy "quotes_update" on quotes for update using (is_active_user()) with check (is_active_user());
drop policy if exists "quotes_delete" on quotes;
create policy "quotes_delete" on quotes for delete using (is_super_admin());

/** Nákupní doklad (TS dvojče: src/lib/auth/price-visibility.ts isPriceDocument). */
create or replace function job_file_is_price_doc(p_id uuid, p_kind text, p_issuer text, p_origin text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_kind = 'objednavka_vydana'
      or (p_issuer = 'dodavatel' and p_kind not in ('vykres', 'model_3d'))
      or (p_kind in ('nabidka', 'faktura', 'naceneni', 'potvrzeni') and p_issuer is null and p_origin is distinct from 'generated')
      or exists (select 1 from purchase_orders po where po.file_id = p_id)
      or exists (select 1 from supplier_quotes sq where sq.file_id = p_id)
$$;

/** Objekt úložiště patří nákupnímu dokladu? (SECURITY DEFINER — RLS job_files by nákupní řádky skryla
 *  a politika úložiště by je pak „neviděla"; stačí jeden řádek s tou cestou). */
create or replace function job_file_path_is_price_doc(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_files f where f.storage_path = p_path
                   and job_file_is_price_doc(f.id, f.kind::text, f.issuer, f.origin))
$$;

drop policy if exists "job_files_select" on job_files;
create policy "job_files_select" on job_files for select using (
  is_active_user() and (is_obchodnik_or_admin() or not job_file_is_price_doc(id, kind::text, issuer, origin)));
drop policy if exists "job_files_update" on job_files;
create policy "job_files_update" on job_files for update
  using (is_active_user() and (is_obchodnik_or_admin() or not job_file_is_price_doc(id, kind::text, issuer, origin)))
  with check (is_active_user() and (is_obchodnik_or_admin() or not job_file_is_price_doc(id, kind::text, issuer, origin)));

-- Úložiště job-files: čtení (vlastní capture/, jinak bez nákupních dokladů), zápis jen do capture/<uid>/, bez přepisu.
-- Aplikace nahrává podepsanými URL (createSignedUploadUrl) a čte servisním klíčem — tyto politiky hlídají jen REST.
drop policy if exists "job_files_bucket_read" on storage.objects;
create policy "job_files_bucket_read" on storage.objects for select using (
  bucket_id = 'job-files' and auth.role() = 'authenticated'
  and public.is_active_user()
  and case when (storage.foldername(name))[1] = 'capture' then (storage.foldername(name))[2] = auth.uid()::text
      else public.is_obchodnik_or_admin() or not public.job_file_path_is_price_doc(name) end);
drop policy if exists "job_files_bucket_insert" on storage.objects;
create policy "job_files_bucket_insert" on storage.objects for insert with check (
  bucket_id = 'job-files' and auth.role() = 'authenticated' and public.is_active_user()
  and (storage.foldername(name))[1] = 'capture' and (storage.foldername(name))[2] = auth.uid()::text);
drop policy if exists "job_files_bucket_update" on storage.objects;
-- Archiv dokladů (bucket documents): jen super admin (aplikace servisním klíčem)
drop policy if exists "documents_bucket_read" on storage.objects;
create policy "documents_bucket_read" on storage.objects for select using (bucket_id = 'documents' and public.is_super_admin());
drop policy if exists "documents_bucket_write" on storage.objects;
create policy "documents_bucket_write" on storage.objects for insert with check (bucket_id = 'documents' and public.is_super_admin());

-- Dokumenty (zrcadlo 20261023100000:1905-1934): přes REST (session) nejde přepsat obsah souboru
create or replace function job_files_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx text := app_ctx();
begin
  if tg_op = 'INSERT' then
    new.uploaded_by := app_pick(new.uploaded_by);
    if v_ctx = 'session' and new.origin = 'generated' then new.origin := 'upload'; end if;  -- „náš doklad" označí jen server
    if v_ctx = 'session' then new.created_at := now(); new.content_sha256 := null; end if;  -- #25: čas a otisk jen server
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
      -- #25: obsah a zařazení souboru (cesta, druh, nabídka, otisk, čas) mění jen náš server
      new.storage_path := old.storage_path; new.kind := old.kind; new.quote_id := old.quote_id;
      new.content_sha256 := old.content_sha256; new.created_at := old.created_at; new.job_id := old.job_id;
      new.filename := old.filename; new.mime_type := old.mime_type; new.size_bytes := old.size_bytes;
    end if;
  end if;
  return new;
end $$;

-- ── 9) AI focení pro všechny — jednou za život databáze (značka), pozdější volbu super admina nepřepíše ──
do $$
declare v_new boolean;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('ai_capture_default_v25', 'ai_access', 'Výchozí „AI focení pro všechny" nastaveno (#25)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if coalesce(v_new, false) then
    insert into integration_settings (key, category, label, is_secret, value)
    values ('ai_capture_for_all', 'ai_access', 'AI focení pro všechny uživatele', false, 'true')
    on conflict (key) do update set value = 'true', label = excluded.label;
  end if;
end $$;

-- ── 10) Práva funkcí ────────────────────────────────────────
do $$
declare f text;
begin
  foreach f in array array[
    'app_actor_is_super_admin()', 'app_actor_is_non_admin_user()', 'quote_author_needs_admin(uuid)',
    'quote_ai_needs_approval(boolean)', 'my_mailbox_ids()', 'flow_mine_job_ids(uuid)',
    'flow_counts(uuid,integer,uuid)', 'flow_badge_counts(uuid)', 'job_file_is_price_doc(uuid,text,text,text)',
    'job_file_path_is_price_doc(text)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  revoke execute on function quote_items_admin_approval() from public, anon, authenticated;
  revoke execute on function orders_owner_guard() from public, anon, authenticated;
  revoke execute on function quotes_order_approval_reset() from public, anon, authenticated;
  revoke execute on function approval_queue_session_guard() from public, anon, authenticated;
  revoke execute on function emails_session_guard() from public, anon, authenticated;
end $$;
notify pgrst, 'reload schema';
