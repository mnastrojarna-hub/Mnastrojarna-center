-- ============================================================
-- 20261030200000 — Schvalování nabídek PER UŽIVATEL (31. 10.)
-- Majitel: „Schvalovat nabídky bude nutné jen u Šponera — ten je vystaví, ale nemůže je bez schválení
-- odeslat. Volný a superadmin je budou moci posílat a vystavovat bez schvalování."
--
--  1) profiles.quote_needs_approval (výchozí true) — nabídky uživatele musí před odesláním schválit
--     super admin. Super admin schválení nepotřebuje nikdy (příznak se u něj ignoruje). Kdo a kdy ho
--     naposledy změnil: quote_approval_changed_by / _at (píše trigger). Mění jen super admin (profiles_guard).
--  2) quote_author_needs_admin(p_author) = ne-super-admin S příznakem → R1 (vložení i úprava obsahu),
--     položky nabídky i přepočet se řídí příznakem. Režim AI (quote_ai_needs_approval) beze změny.
--     Úprava uživatelem BEZ schvalování: schválení se zruší a nutnost se odvodí od autora nabídky
--     (cizí nabídku uživatele se schvalováním dál schvaluje super admin).
--     Autor bez schvalování smí svou nabídku, která schválení nepotřebuje (nebo ho má), odeslat sám
--     (i zaměstnanec — TS dvojče src/lib/jobs/flow-status.ts quoteSendBlock).
--  3) Změna příznaku (nebo role) přepočte autorovy NEODESLANÉ čekající nabídky (navrh_ai / ke_schvaleni,
--     bez schválení): bez schvalování → admin_approval_required false (kromě nabídek, které naposledy
--     upravil někdo se schvalováním); se schvalováním → true (jen zakázky v obchodní fázi, jako backfill #25).
--     Odeslané, přijaté, zamítnuté a už schválené nabídky se nemění. approval_required dopočte trigger (R2).
--  4) Jednorázově (značka quote_approval_per_user_v1): Vít Volný (obchodník) = bez schvalování,
--     Šponer = se schvalováním. Hledá se podle jména / e-mailu; když není právě jeden, nic se nenastaví
--     (RAISE NOTICE) — super admin to nastaví ve Správě uživatelů.
--  5) SCHVALOVATEL (31. 10., majitel: „Volný může schvalovat nabídky Šponera … vždycky jenom Šponera musí
--     někdo schválit — buď Volný, nebo superadmin"): profiles.can_approve_quotes (výchozí false; super admin
--     smí vždy; kdo a kdy: quote_approver_changed_by / _at; mění jen super admin). Schvalovatel (ne super
--     admin) schválí / vrátí k přepracování jen CIZÍ nabídku, kterou musí schválit kvůli autorovi / editorovi
--     (admin_approval_required) — nikdy vlastní (quote_user_may_approve). AI nabídky (režim se schválením)
--     a fronta AI dál jen super admin. „Schválil" u zakázky (orders.approved_by) zapíše schvalovatel sám
--     sebe jen ke zakázce, jejíž nabídku schválil. Jednorázově (značka quote_approvers_v1): Vít Volný
--     (obchodník) = smí schvalovat (stejná shoda jako v bodě 4).
--
-- POZOR — PŘEDEFINOVANÉ FUNKCE (zrcadlo poslední definice + změny označené „30. 10." / „31. 10."):
--   quote_author_needs_admin(), quotes_flow_before(), quote_items_admin_approval()
--       původně 20261023155000_role_viditelnost.sql (:48, :111, :331)
--   profiles_guard()  původně 20261022090000_kniha_zakazek.sql (:349)
--   profiles_audit()  původně 20261023100000_podrobne_stavy_atribuce.sql (:2210)
--   orders_approval_guard()  původně 20261023157000_role_viditelnost_moje.sql (:109)
-- Idempotentní: druhé spuštění nic nezmění (značky, přepočet 0 řádků).
-- ============================================================

-- ── 1) Sloupce ──────────────────────────────────────────────
alter table profiles add column if not exists quote_needs_approval boolean not null default true;
alter table profiles add column if not exists quote_approval_changed_by uuid references profiles(id) on delete set null;
alter table profiles add column if not exists quote_approval_changed_at timestamptz;
comment on column profiles.quote_needs_approval is
  'Nabídky uživatele musí před odesláním schválit super admin nebo schvalovatel (výchozí ano). U super admina se ignoruje. Mění jen super admin.';
comment on column profiles.quote_approval_changed_by is 'Kdo naposledy změnil quote_needs_approval (píše trigger).';
comment on column profiles.quote_approval_changed_at is 'Kdy se naposledy změnilo quote_needs_approval (píše trigger).';
-- 31. 10.: schvalovatel nabídek ostatních
alter table profiles add column if not exists can_approve_quotes boolean not null default false;
alter table profiles add column if not exists quote_approver_changed_by uuid references profiles(id) on delete set null;
alter table profiles add column if not exists quote_approver_changed_at timestamptz;
comment on column profiles.can_approve_quotes is
  'Smí schvalovat nabídky ostatních, které schválení potřebují (výchozí ne; vlastní nikdy). Super admin smí vždy. Mění jen super admin.';
comment on column profiles.quote_approver_changed_by is 'Kdo naposledy změnil can_approve_quotes (píše trigger).';
comment on column profiles.quote_approver_changed_at is 'Kdy se naposledy změnilo can_approve_quotes (píše trigger).';

-- ── 2) Pravidlo autora ─────────────────────────────────────
/** Nabídky autora musí schválit super admin: není super admin a má zapnuté „Nabídky musí schválit super admin".
 *  Bez autora = ne. (TS dvojče: src/lib/jobs/flow-status.ts userNeedsQuoteApproval.) */
create or replace function quote_author_needs_admin(p_author uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_author is not null and exists (
    select 1 from profiles p where p.id = p_author and p.role <> 'super_admin' and coalesce(p.quote_needs_approval, true))
$$;

/** 31. 10.: smí uživatel schvalovat nabídky (ostatních)? Aktivní super admin, nebo aktivní účet se „Smí schvalovat
 *  nabídky ostatních" (can_approve_quotes). Bez uživatele = ne. (TS dvojče: src/lib/auth/permissions.ts quote_approval.) */
create or replace function quote_user_is_approver(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from profiles p where p.id = p_user and p.active and (p.role = 'super_admin' or coalesce(p.can_approve_quotes, false)))
$$;

/** 31. 10.: smí uživatel schválit (vrátit k přepracování) TUTO nabídku? Aktivní super admin vždy; schvalovatel jen
 *  cizí nabídku, kterou musí schválit kvůli autorovi / editorovi (admin_approval_required) — vlastní nikdy.
 *  (TS dvojče: src/lib/jobs/flow-status.ts mayManageQuoteApproval.) */
create or replace function quote_user_may_approve(p_user uuid, p_author uuid, p_admin_required boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and exists (
    select 1 from profiles p where p.id = p_user and p.active
      and (p.role = 'super_admin'
           or (coalesce(p.can_approve_quotes, false) and coalesce(p_admin_required, false) and p_author is distinct from p_user)))
$$;

-- ── 3) Profil: příznaky mění jen super admin; kdo a kdy ─────
-- Zrcadlo 20261022090000 (profiles_guard), jediná změna: i quote_needs_approval a can_approve_quotes.
create or replace function profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_super_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.ai_access is distinct from old.ai_access
       or new.commission_rate is distinct from old.commission_rate
       or new.quote_needs_approval is distinct from old.quote_needs_approval
       or new.can_approve_quotes is distinct from old.can_approve_quotes then
      raise exception 'Změnu role a oprávnění smí provést jen super admin.';
    end if;
  end if;
  return new;
end $$;

/** Kdo a kdy změnil quote_needs_approval / can_approve_quotes — píše jen DB (přímý zápis údaje nezfalšuje). */
create or replace function profiles_quote_approval_before()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.quote_approval_changed_by := null;
    new.quote_approval_changed_at := null;
    new.quote_approver_changed_by := null;
    new.quote_approver_changed_at := null;
    return new;
  end if;
  if new.quote_needs_approval is distinct from old.quote_needs_approval then
    new.quote_approval_changed_by := app_actor();
    new.quote_approval_changed_at := now();
  else
    new.quote_approval_changed_by := old.quote_approval_changed_by;
    new.quote_approval_changed_at := old.quote_approval_changed_at;
  end if;
  if new.can_approve_quotes is distinct from old.can_approve_quotes then
    new.quote_approver_changed_by := app_actor();
    new.quote_approver_changed_at := now();
  else
    new.quote_approver_changed_by := old.quote_approver_changed_by;
    new.quote_approver_changed_at := old.quote_approver_changed_at;
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_quote_approval_before on profiles;
create trigger trg_profiles_quote_approval_before before insert or update on profiles
  for each row execute function profiles_quote_approval_before();

-- Zrcadlo 20261023100000 (profiles_audit), jediná změna: i quote_needs_approval a can_approve_quotes
-- (záchranná síť mimo náš server).
create or replace function profiles_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_by uuid := app_actor();
begin
  if app_ctx() = 'app' then return null; end if;
  if new.role is distinct from old.role or new.active is distinct from old.active
     or new.commission_rate is distinct from old.commission_rate
     or new.quote_needs_approval is distinct from old.quote_needs_approval
     or new.can_approve_quotes is distinct from old.can_approve_quotes then
    insert into audit_log (action, entity, entity_id, diff, actor_id, actor_kind, via, request_id)
    values ('profile_changed', 'profiles', new.id::text,
      jsonb_strip_nulls(jsonb_build_object(
        'name', new.full_name,
        'role', case when new.role is distinct from old.role then jsonb_build_array(old.role, new.role) end,
        'active', case when new.active is distinct from old.active then jsonb_build_array(old.active, new.active) end,
        'commissionRate', case when new.commission_rate is distinct from old.commission_rate
                               then jsonb_build_array(old.commission_rate, new.commission_rate) end,
        'quoteNeedsApproval', case when new.quote_needs_approval is distinct from old.quote_needs_approval
                                   then jsonb_build_array(old.quote_needs_approval, new.quote_needs_approval) end,
        'canApproveQuotes', case when new.can_approve_quotes is distinct from old.can_approve_quotes
                                 then jsonb_build_array(old.can_approve_quotes, new.can_approve_quotes) end)),
      v_by, app_event_kind(v_by), app_actor_via(), app_request_id());
  end if;
  return null;
end $$;

-- ── 4) Nabídky (zrcadlo 20261023155000:111 + změny 30. 10. a 31. 10.) ──
create or replace function quotes_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx      text    := app_ctx();
  v_actor    uuid    := app_pick(null);
  v_via      text    := case when pg_trigger_depth() > 1 then 'automaticky' else app_actor_via() end;
  v_direct   boolean := pg_trigger_depth() = 1 and app_ctx() in ('session', 'app');
  v_admin    boolean := app_actor_is_super_admin();
  v_nonadmin boolean := app_actor_is_non_admin_user();
  v_approver boolean := false;
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
  -- 31. 10.: schvalovatel TÉTO nabídky = super admin, nebo kolega se „Smí schvalovat nabídky ostatních" u cizí
  -- nabídky, která schválení potřebuje kvůli autorovi / editorovi (podle stavu PŘED zápisem; vlastní nikdy)
  v_approver := v_admin or (tg_op = 'UPDATE' and v_nonadmin
                            and quote_user_may_approve(app_actor(), old.created_by, old.admin_approval_required));

  -- R0 (#25): schvalovací sloupce jsou pro přímý zápis kohokoli kromě super admina jen pro čtení
  -- (31. 10.: schvalovatel nabídky smí vrátit k přepracování; otisk schválení zapíše jen náš server)
  if v_direct and not v_admin then
    if tg_op = 'INSERT' then
      new.admin_approval_required := false;
      new.approved_snapshot_sha := null;
      new.approval_returned_at := null; new.approval_returned_by := null; new.approval_return_note := null;
    else
      new.admin_approval_required := old.admin_approval_required;
      new.ai_generated            := old.ai_generated;
      if not (v_approver and v_ctx = 'app') then
        new.approved_snapshot_sha := old.approved_snapshot_sha;
      end if;
      if not v_approver then
        new.approval_returned_at  := old.approval_returned_at;
        new.approval_returned_by  := old.approval_returned_by;
        new.approval_return_note  := old.approval_return_note;
      end if;
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

  -- R1 (#25): autor / editor se schvalováním (30. 10. per uživatel) → odeslat až po schválení super adminem
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
        -- 30. 10.: editor se schvalováním = nové schválení super adminem; editor bez schvalování schválení
        -- zruší a nutnost odvodí od autora (cizí nabídku autora se schvalováním dál schvaluje super admin)
        new.admin_approval_required := case when quote_author_needs_admin(app_actor()) then true
                                            else quote_author_needs_admin(new.created_by) end;
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
  -- R2 (#25): schválení nutné = AI v režimu se schválením NEBO nabídka uživatele se schvalováním
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

  -- R3 (#25): schvaluje jen super admin; 31. 10. i schvalovatel cizí nabídky, která schválení potřebuje
  -- (vlastní nikdo); bez autora (systém, psql, servisní skript) projde
  if new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by)
     and v_ctx in ('session', 'app') and app_actor() is not null and not v_approver then
    raise exception 'Nabídku schvaluje jen super admin nebo kolega s právem schvalovat nabídky — vlastní nabídku nikdo neschvaluje sám.'
      using errcode = '42501';
  end if;

  -- R6 (#25): vrácení k přepracování (zapsat smí jen super admin a 31. 10. schvalovatel nabídky — R0)
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
  -- i její autor, obchodník nebo řešitel zakázky; 30. 10.: autor bez schvalování svou nabídku, která
  -- schválení nepotřebuje (nebo ho má), odešle sám; 31. 10.: schválit smí i schvalovatel nabídky (R3)
  if app_guard_decisions() and (
       (new.approved_by is not null and (tg_op = 'INSERT' or new.approved_by is distinct from old.approved_by)
        and not v_approver)
    or (new.status = 'zamitnuto' and (tg_op = 'INSERT' or new.status is distinct from old.status))
    or (new.status = 'odeslano' and (tg_op = 'INSERT' or new.status is distinct from old.status)
        and not (tg_op = 'UPDATE' and old.status in ('navrh_ai', 'ke_schvaleni')
                 and ((new.admin_approval_required and new.approved_by is not null
                       and (app_actor() = new.created_by
                            or exists (select 1 from orders o where o.id = new.job_id
                                       and app_actor() in (o.owner_id, o.assignee_id))))
                   or (not new.admin_approval_required and (new.approved_by is not null or not new.approval_required)
                       and app_actor() = new.created_by and not quote_author_needs_admin(app_actor())))))) then
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

/** Položky nabídky (#25; zrcadlo 20261023155000:331): změna od ne-admina zruší schválení; nutnost schválení
 *  podle editora (se schvalováním → ano) jinak podle autora nabídky (30. 10.); u odeslané nabídky ne-admin
 *  položky nemění. Každá větev zapíše řádek nabídky → quotes.updated_at se posune. */
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
    update quotes set admin_approval_required = case when quote_author_needs_admin(app_actor()) then true
                                                     else quote_author_needs_admin(created_by) end,
           approved_by = null,
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
-- trg_quote_items_admin_approval zůstává (mění se jen funkce)

-- ── 4b) „Schválil" u zakázky (zrcadlo 20261023157000:109 + změna 31. 10.) ──
/** orders.approved_by / approved_at: přímý zápis člověka, který není super admin (REST i náš server s autorem),
 *  je odmítnut (insert je tiše vynuluje) — 31. 10. kromě schvalovatele, který zapíše sebe ke zakázce, jejíž
 *  nabídku právě schválil (approveQuoteCore). Vnořené zápisy DB (zrušení schválení nabídky) a server bez autora projdou. */
create or replace function orders_approval_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or not app_actor_is_non_admin_user() then return new; end if;
  if tg_op = 'INSERT' then
    new.approved_by := null;
    new.approved_at := null;
    return new;
  end if;
  if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
    if new.approved_by is not null and new.approved_by = app_actor() and quote_user_is_approver(app_actor())
       and exists (select 1 from quotes q where q.job_id = new.id and q.approved_by = app_actor()) then
      return new;
    end if;
    raise exception 'Schválení nabídky u zakázky zapisuje jen ten, kdo nabídku schválil (super admin nebo schvalovatel).'
      using errcode = '42501';
  end if;
  return new;
end $$;
-- trg_orders_approval_guard zůstává (mění se jen funkce)

-- ── 5) Přepočet čekajících nabídek autora ──────────────────
/** Po změně „Nabídky musí schválit super admin" (nebo role) přepočte autorovy NEODESLANÉ čekající nabídky
 *  bez schválení. Bez schvalování → admin_approval_required false (ne u nabídek, které naposledy upravil
 *  někdo se schvalováním); se schvalováním → true (jen zakázky v obchodní fázi / bez zakázky — jako
 *  backfill #25 6a). Stav a approval_required dopočte quotes_flow_before (R2; AI režim beze změny).
 *  Vrací počet změněných nabídek. */
create or replace function quote_approval_recompute_author(p_user uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
begin
  if p_user is null then return 0; end if;
  if quote_author_needs_admin(p_user) then
    update quotes q set admin_approval_required = true
     where q.created_by = p_user and not q.admin_approval_required and q.approved_by is null
       and q.status in ('navrh_ai', 'ke_schvaleni') and q.sent_at is null
       and (q.job_id is null or exists (select 1 from orders o where o.id = q.job_id
                                          and o.status in ('poptavka', 'naceneni', 'nabidka', 'pozastaveno')));
  else
    update quotes q set admin_approval_required = false
     where q.created_by = p_user and q.admin_approval_required and q.approved_by is null
       and q.status in ('navrh_ai', 'ke_schvaleni') and q.sent_at is null
       and not quote_author_needs_admin(q.updated_by);
  end if;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function profiles_quote_approval_after()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform quote_approval_recompute_author(new.id);
  return null;
end $$;
drop trigger if exists trg_profiles_quote_approval_after on profiles;
create trigger trg_profiles_quote_approval_after after update of quote_needs_approval, role on profiles
  for each row when (old.quote_needs_approval is distinct from new.quote_needs_approval or old.role is distinct from new.role)
  execute function profiles_quote_approval_after();

-- ── 6) Výchozí nastavení podle majitele (jednorázově) ──────
do $$
declare
  v_new    boolean;
  v_ids    uuid[];
  v_rows   text;
  v_before integer;
  v_after  integer;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('quote_approval_per_user_v1', 'ai_access', 'Schvalování nabídek per uživatel — výchozí nastavení (31. 10.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Schvalování nabídek per uživatel: výchozí nastavení už proběhlo dřív — beze změny.';
  else
    -- Vít Volný (obchodník) → bez schvalování
    select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
      into v_ids, v_rows
      from profiles p
     where p.role = 'obchodnik' and (p.full_name ilike '%voln%' or p.email ilike '%voln%');
    if coalesce(array_length(v_ids, 1), 0) = 1 then
      select count(*) into v_before from quotes q
       where q.created_by = v_ids[1] and q.admin_approval_required and q.approved_by is null
         and q.status in ('navrh_ai', 'ke_schvaleni') and q.sent_at is null;
      -- trigger trg_profiles_quote_approval_after hned přepočte jeho čekající nabídky
      update profiles set quote_needs_approval = false where id = v_ids[1];
      select count(*) into v_after from quotes q
       where q.created_by = v_ids[1] and q.admin_approval_required and q.approved_by is null
         and q.status in ('navrh_ai', 'ke_schvaleni') and q.sent_at is null;
      raise notice 'Schvalování nabídek: % — bez schvalování (odesílá sám); % čekajících nabídek už schválení nepotřebuje.',
        v_rows, v_before - v_after;
    else
      raise notice 'Schvalování nabídek: Volného nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, nastav ve Správě uživatelů.',
        coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
    end if;

    -- Šponer → se schvalováním (výchozí hodnota; tady jen výslovně a do logu)
    select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
      into v_ids, v_rows
      from profiles p
     where p.full_name ilike '%šponer%' or p.full_name ilike '%sponer%' or p.email ilike '%sponer%';
    if coalesce(array_length(v_ids, 1), 0) = 1 then
      update profiles set quote_needs_approval = true where id = v_ids[1] and not quote_needs_approval;
      raise notice 'Schvalování nabídek: % — se schvalováním (super admin nebo schvalovatel).', v_rows;
    else
      raise notice 'Schvalování nabídek: Šponera nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, nastav ve Správě uživatelů.',
        coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
    end if;
  end if;
end $$;

-- ── 6b) Schvalovatel podle majitele (jednorázově, 31. 10.) ──
-- „Volný může schvalovat nabídky Šponera" → Vít Volný (obchodník) smí schvalovat nabídky ostatních.
-- Stejná shoda jako v bodě 6; když není právě jeden, nic se nenastaví (NOTICE) — super admin to zapne ve Správě uživatelů.
do $$
declare
  v_new  boolean;
  v_ids  uuid[];
  v_rows text;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('quote_approvers_v1', 'ai_access', 'Schvalovatelé nabídek — výchozí nastavení (31. 10.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Schvalovatelé nabídek: výchozí nastavení už proběhlo dřív — beze změny.';
    return;
  end if;
  select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
    into v_ids, v_rows
    from profiles p
   where p.role = 'obchodnik' and (p.full_name ilike '%voln%' or p.email ilike '%voln%');
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    update profiles set can_approve_quotes = true where id = v_ids[1] and not can_approve_quotes;
    raise notice 'Schvalovatelé nabídek: % — smí schvalovat nabídky ostatních (kromě vlastních).', v_rows;
  else
    raise notice 'Schvalovatelé nabídek: Volného nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, zapni ve Správě uživatelů.',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
  end if;
end $$;

-- ── 7) Přepočet čekajících nabídek všech uživatelů bez schvalování ──
do $$
declare
  r   record;
  v_n integer;
  v_t integer := 0;
begin
  for r in select p.id, p.full_name from profiles p where p.role <> 'super_admin' and not p.quote_needs_approval loop
    v_n := quote_approval_recompute_author(r.id);
    v_t := v_t + v_n;
    if v_n > 0 then raise notice 'Schvalování nabídek: % — % čekajících nabídek už schválení nepotřebuje.', r.full_name, v_n; end if;
  end loop;
  raise notice 'Schvalování nabídek: kontrolní přepočet uživatelů bez schvalování — změněno dalších % nabídek.', v_t;
end $$;

-- ── 8) Práva funkcí ─────────────────────────────────────────
do $$
begin
  revoke execute on function quote_author_needs_admin(uuid) from public, anon;
  grant execute on function quote_author_needs_admin(uuid) to authenticated, service_role;
  revoke execute on function quote_approval_recompute_author(uuid) from public, anon, authenticated;
  grant execute on function quote_approval_recompute_author(uuid) to service_role;
  revoke execute on function profiles_quote_approval_before() from public, anon, authenticated;
  revoke execute on function profiles_quote_approval_after() from public, anon, authenticated;
  revoke execute on function profiles_guard() from public, anon, authenticated;
  revoke execute on function profiles_audit() from public, anon, authenticated;
  -- trigger nabídek běží i v session (REST) → authenticated je potřebuje
  revoke execute on function quote_user_is_approver(uuid) from public, anon;
  grant execute on function quote_user_is_approver(uuid) to authenticated, service_role;
  revoke execute on function quote_user_may_approve(uuid, uuid, boolean) from public, anon;
  grant execute on function quote_user_may_approve(uuid, uuid, boolean) to authenticated, service_role;
  revoke execute on function orders_approval_guard() from public, anon, authenticated;
end $$;
notify pgrst, 'reload schema';
