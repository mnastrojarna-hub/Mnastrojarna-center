-- ============================================================
-- 20261116100000 — Číslo objednávky dodavateli podle zakázky (16. 11.)
-- Majitel: „Vystavená objednávka musí mít prefix OV + číslo zakázky + pořadové číslo objednávky v rámci zakázky.
-- Příklad pro zakázku 2026/026: OV2026/026-1, OV2026/026-2 … Více objednávek pro jednu zakázku (materiál,
-- operace, různí dodavatelé)."
--
-- job_po_base(number): „Z-2026-026" → „2026/026" (jiný tvar čísla zakázky zůstane, jak je).
-- next_job_po_number(p_job): OV<základ>-<n>, n = nejvyšší pořadí u zakázky + 1 (zámek na zakázku).
-- Trigger na purchase_orders: objednávka zakázky s číslem ze staré řady (OV-RRRR-NNN) nebo bez čísla dostane
-- číslo podle zakázky — platí pro všechny cesty vystavení (předání do výroby, Nákup, automatika) bez přepisu
-- jejich funkcí. Objednávky bez zakázky a už vystavená čísla se nemění. Idempotentní.
-- ============================================================

create or replace function job_po_base(p_number text) returns text
language sql immutable set search_path = public as $$
  select case
    when p_number ~ '^\s*[Zz]?[-\s]?\d{4}[-/]\d+\s*$'
      then regexp_replace(trim(p_number), '^[Zz]?[-\s]?(\d{4})[-/](\d+)$', '\1/\2')
    else trim(coalesce(p_number, ''))
  end
$$;

create or replace function next_job_po_number(p_job uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_base text;
  v_prefix text;
  v_n int;
begin
  select job_po_base(number) into v_base from orders where id = p_job;
  if v_base is null or v_base = '' then
    return next_doc_number('OV');
  end if;
  perform pg_advisory_xact_lock(hashtext('job_po_number:' || p_job::text));
  v_prefix := 'OV' || v_base || '-';
  select coalesce(max(nullif(substring(number from length(v_prefix) + 1), '')::int), 0) + 1 into v_n
    from purchase_orders
   where job_id = p_job and number like v_prefix || '%' and substring(number from length(v_prefix) + 1) ~ '^\d+$';
  return v_prefix || v_n;
end $$;

revoke execute on function next_job_po_number(uuid) from public, anon;
grant execute on function next_job_po_number(uuid) to authenticated, service_role;

create or replace function purchase_orders_job_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- jen číslo ze staré číselné řady (OV-RRRR-NNN); návrh bez čísla zůstane bez čísla, ruční číslo se nemění
  if new.job_id is not null and new.number ~ '^OV-\d{4}-\d+$'
     and (tg_op = 'INSERT' or new.number is distinct from old.number) then
    new.number := next_job_po_number(new.job_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_purchase_orders_job_number on purchase_orders;
create trigger trg_purchase_orders_job_number before insert or update of number on purchase_orders
  for each row execute function purchase_orders_job_number();

-- Předání do výroby (production_apply, 20261023150000): číslo objednávky rovnou podle zakázky, aby se
-- stejné číslo propsalo do fronty, výsledku a „číslo objednávky u dodavatele" zakázky. Jinak beze změny.
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
    v_number := next_job_po_number(p_job); -- OV + číslo zakázky + pořadí (16. 11.)
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
