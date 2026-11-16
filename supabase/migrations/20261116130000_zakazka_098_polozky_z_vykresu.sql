-- ============================================================
-- 20261116130000 — Zakázka 2026/098: položky z výkresů (majitel 16. 11.)
-- „zakázka 098 má 25 výkresů a jednu položku … z výkresů se nevygenerují položky"
--
-- Příčina (opraveno v kódu, capture-batch-reconcile hasOrphanNumberedItem): skupina už měla 1 položku
-- (z textu e-mailu) → výkresy bez shodné položky dostaly „Nepřiřazovat" místo „Založit novou položku".
--
-- Jednorázově (značka job_098_items_from_drawings_v1): ke každému výkresu zakázky bez položky
--  • položka se stejným číslem výkresu už je → výkres se k ní jen připojí;
--  • jinak nová položka: číslo výkresu, revize, název, materiál z výkresu; počet z výkresu (i ručně
--    dopsaný / zapsaný v kontrole), jinak z poznámek výkresu („25 ks"), jinak 1 s poznámkou „doplň počet".
-- Když zakázku 2026/098 nelze určit právě jednu, nic se nemění (jen hláška). Idempotentní (značka +
-- jen výkresy bez položky).
-- ============================================================

do $$
declare
  v_new   boolean;
  v_jobs  uuid[];
  v_job   uuid;
  v_pos   integer;
  v_item  uuid;
  v_qty   numeric;
  v_txt   text;
  v_added integer := 0;
  v_linked integer := 0;
  r record;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('job_098_items_from_drawings_v1', 'ai_access', 'Zakázka 2026/098: položky z výkresů (16. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Zakázka 098: oprava už proběhla dřív — beze změny.';
    return;
  end if;

  select array_agg(o.id) into v_jobs from orders o
   where o.merged_into_id is null and job_po_base(o.number) = '2026/098';
  if coalesce(array_length(v_jobs, 1), 0) <> 1 then
    raise notice 'Zakázka 098: nalezeno % zakázek s číslem 2026/098 — nic se nemění.', coalesce(array_length(v_jobs, 1), 0);
    return;
  end if;
  v_job := v_jobs[1];
  select coalesce(max(position), -1) into v_pos from order_items where order_id = v_job;

  for r in
    select jf.id, jf.ai_extracted as a
      from job_files jf
     where jf.job_id = v_job and jf.kind = 'vykres' and not coalesce(jf.archived, false)
       and jf.order_item_id is null
       and coalesce(btrim(jf.ai_extracted->>'drawingNumber'), '') <> ''
     order by jf.created_at, jf.id
  loop
    select i.id into v_item from order_items i
     where i.order_id = v_job and search_compact(i.drawing_number) = search_compact(r.a->>'drawingNumber')
     order by i.position limit 1;
    if v_item is null then
      v_qty := case when coalesce(r.a->>'quantity', '') ~ '^[0-9]+([.,][0-9]+)?$'
                    then nullif(replace(r.a->>'quantity', ',', '.')::numeric, 0) end;
      if v_qty is null then
        v_txt := coalesce(r.a->>'drawingNotes', '') || ' ' || coalesce(r.a->>'notes', '');
        v_qty := nullif((substring(v_txt from '([0-9]{1,5})\s*(?:ks|kus|pcs|Stk)'))::numeric, 0);
      end if;
      v_pos := v_pos + 1;
      insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, note)
      values (v_job, v_pos, btrim(r.a->>'drawingNumber'), nullif(btrim(coalesce(r.a->>'revision', '')), ''),
              nullif(btrim(coalesce(r.a->>'title', '')), ''), nullif(btrim(coalesce(r.a->>'material', '')), ''),
              coalesce(v_qty, 1), 'ks',
              case when v_qty is null then 'Počet kusů doplň — z výkresu se nepřečetl.' end)
      returning id into v_item;
      v_added := v_added + 1;
    end if;
    update job_files set order_item_id = v_item where id = r.id;
    v_linked := v_linked + 1;
  end loop;

  raise notice 'Zakázka 098: % nových položek z výkresů, % výkresů připojeno k položce.', v_added, v_linked;
end $$;
