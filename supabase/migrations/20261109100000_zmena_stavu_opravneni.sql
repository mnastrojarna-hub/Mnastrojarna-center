-- ═══════════════════════════════════════════════════════════════════════════
--  Ruční změna stavu zakázky (9. 11.) — majitel: „Šponer má mít oprávnění změnit ručně stav zakázky dopředu
--  i dozadu." + „Každý by měl mít možnost — bez ohledu na to, jestli smí měnit stav dopředu či dozadu — přepnout
--  zakázku do speciálních stavů, kde se něco pokazilo nebo zakázka nedopadla: nerealizováno, reklamace a podobně."
--
--  1) profiles.can_change_stage (výchozí false) — „Smí ručně měnit stav zakázky (dopředu i dozadu, včetně koncových
--     stavů)": Korekce stavu na kterýkoli stav, i Vyfakturováno / Dokončeno, bez práva na marže. Marže, ceny ani
--     faktury tím uživatel nevidí. Obchodník a super admin smí vždy. Rozhoduje src/lib/auth/permissions.ts (funkce
--     „stage_any") + canMoveJobStage / transitionFeature (src/lib/jobs/flow-status.ts).
--  2) profiles_guard: can_change_stage smí měnit jen super admin (nikdo si ho nezapne sám).
--  3) orders_stage_change(): speciální stavy smí každý — DB pojistka rozhodnutí už NEhlídá uzavření zakázky
--     (nerealizováno / zrušeno); zaměstnanec ho ale musí zapsat s důvodem (lost_reason, jako aplikace). Ostatní
--     pojistky rozhodnutí (odmítnutí / stažení poptávky a jejich obnovení, storno objednávky a jeho zrušení;
--     schválení / zamítnutí nabídky) se NEMĚNÍ.
--  4) Jednorázově (značka stage_change_sponer_v1): Šponer = smí (shoda jména / e-mailu jako 20261031160000, jen když
--     je právě jeden; jinak NOTICE a nastaví se ve Správě uživatelů).
--
-- POZOR — PŘEDEFINOVANÉ FUNKCE:
--   profiles_guard()      — poslední definice 20261102100000_plny_pristup.sql (zrcadlo + can_change_stage).
--   orders_stage_change() — poslední definice 20261023100000_podrobne_stavy_atribuce.sql (zrcadlo, jediné změny:
--                           z pojistky rozhodnutí vypadla podmínka „new.status in ('nerealizovano', 'zruseno')", text
--                           chyby, nová pojistka „uzavřít jen s důvodem"). Další změny dělej od těchto těl.
-- Idempotentní: druhé spuštění nic nezmění.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Příznak uživatele ────────────────────────────────────
alter table profiles add column if not exists can_change_stage boolean not null default false;
comment on column profiles.can_change_stage is
  'Smí ručně měnit stav zakázky (dopředu i dozadu, včetně koncových stavů) — zaměstnanec; obchodník a super admin vždy. Marže a ceny tím nevidí. Mění jen super admin.';

-- ── 2) Ochrana: oprávnění mění jen super admin ───────────────
create or replace function profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_super_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.ai_access is distinct from old.ai_access
       or new.commission_rate is distinct from old.commission_rate
       or new.quote_needs_approval is distinct from old.quote_needs_approval
       or new.can_approve_quotes is distinct from old.can_approve_quotes
       or new.can_rfq is distinct from old.can_rfq
       or new.full_access is distinct from old.full_access
       or new.can_change_stage is distinct from old.can_change_stage then
      raise exception 'Změnu role a oprávnění smí provést jen super admin.';
    end if;
  end if;
  return new;
end $$;

-- ── 3) DB pojistka rozhodnutí: speciální stavy smí každý ────
-- Zrcadlo 20261023100000 (orders_stage_change), změny: bez podmínky uzavření nerealizováno / zrušeno v pojistce rozhodnutí,
-- místo ní „uzavřít jen s důvodem".
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

  -- konec toku dokladů (odmítnutí / stažení poptávky, storno objednávky) a jeho zrušení rozhoduje jen obchodník
  -- nebo admin; zaměstnanec ho navrhne (flow_proposal). REST i náš server. 9. 11.: speciální stavy zakázky
  -- (nerealizováno / zrušeno s důvodem, reklamace, pozastaveno) smí každý — tady se nehlídají.
  if app_guard_decisions() and (
       (new.inquiry_status in ('odmitnuta', 'stazena') and (tg_op = 'INSERT' or new.inquiry_status is distinct from old.inquiry_status))
    or (tg_op = 'UPDATE' and old.inquiry_status in ('odmitnuta', 'stazena') and new.inquiry_status is distinct from old.inquiry_status
        and new.status is not distinct from old.status)
    or (new.order_status = 'stornovana' and (tg_op = 'INSERT' or new.order_status is distinct from old.order_status))
    or (tg_op = 'UPDATE' and old.order_status = 'stornovana' and new.order_status is distinct from old.order_status
        and new.status is not distinct from old.status)) then
    raise exception 'Odmítnout poptávku nebo stornovat objednávku smí obchodník nebo admin — navrhni to.' using errcode = '42501';
  end if;
  -- 9. 11.: uzavřít zakázku (nerealizováno / zrušeno) smí každý, ale jen s důvodem (aplikace ho chce vždy; tady
  -- pojistka pro přímý zápis zaměstnance přes REST nebo náš server — obchodník / admin a vnořené posuny DB beze změny)
  if app_guard_decisions() and new.status in ('nerealizovano', 'zruseno')
     and (tg_op = 'INSERT' or new.status is distinct from old.status) and new.lost_reason is null then
    raise exception 'Uzavřít zakázku jde jen s důvodem.' using errcode = 'P0001';
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

-- ── 4) Šponer (jednorázově) ─────────────────────────────────
do $$
declare
  v_new  boolean;
  v_ids  uuid[];
  v_rows text;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('stage_change_sponer_v1', 'ai_access', 'Ruční změna stavu zakázky — Šponer smí (9. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Ruční změna stavu zakázky: výchozí nastavení už proběhlo dřív — beze změny.';
    return;
  end if;
  select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
    into v_ids, v_rows
    from profiles p
   where p.full_name ilike '%šponer%' or p.full_name ilike '%sponer%' or p.email ilike '%sponer%';
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    update profiles set can_change_stage = true where id = v_ids[1] and not can_change_stage;
    raise notice 'Ruční změna stavu zakázky: % — smí měnit stav zakázky.', v_rows;
  else
    raise notice 'Ruční změna stavu zakázky: Šponera nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, nastav ve Správě uživatelů.',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
  end if;
end $$;
