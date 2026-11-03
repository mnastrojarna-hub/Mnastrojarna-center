-- Anonymizace výkresů v2 — přepočet starých kopií (majitel 2.–3. 11.: „oprav tu anonymizaci výkresů";
--  „výkresy, které jsou vedeny jako anonymizované, mají furt v hlavičce název firmy").
--
-- Příčiny (opraveno v kódu, detektor anon-v2.0 — src/lib/anonymize/company-names.ts, company-check.ts,
-- pdf-pipeline.ts textCompanyLeaks, dxf.ts):
--  a) mazal se jen zákazník zakázky z CRM — v razítku ale bývá JINÁ firma (koncový zákazník, OEM,
--     konstrukční kancelář); buňka s firmou nad popisky razítka navíc ležela mimo zónu razítka, takže ani
--     právní forma („a.s.") se pravidlem nesmazala,
--  b) název jako křivky / logo / font bez Unicode nemá textovou vrstvu,
--  c) holé jméno na dalším listu, prostrkané / rozdělené do více položek, jméno vlastníka v doložce zůstávalo,
--  d) kopie se na název firmy vůbec nekontrolovala.
-- Nově: jména firem z výkresu (pravidla + AI) jsou termíny pro celý soubor a výstup se kontroluje textem
-- (i bez diakritiky, prostrkaně, přes řádky / entity) a obrazem (AI) — zbylý název = kopie se NIKDY
-- nepoužije (jeden automatický pokus znovu, pak „selhalo" s důvodem), nic „ke kontrole".
--
-- Tady: hotové kopie 2D výkresů vzniklé starším detektorem (anon_summary->>'detector' chybí nebo není
-- 'anon-v2.0') → zpět do fronty. Jen kandidáti (2D výkres: PDF / obrázek / DXF; ne objednávky, doklady,
-- 3D modely — jejich anon_method step / stl / iges se nevrací). Nové kopie mají detector = 'anon-v2.0'.
--
-- Fronta a náklady: priorita backfillu 9 (claim řadí podle priority → nová nahrání mají vždy přednost),
-- zpracuje je plánovač (/api/cron/drawing-anonymize, každých 5 min, ≤ 10 souborů na tabulku a běh +
-- rozvětvení) postupně V RÁMCI DENNÍHO LIMITU AI automatiky (drawing_anon_settings.daily_usd, 50 USD —
-- po vyčerpání se další soubory odloží do zítřka, src/lib/anonymize/budget.ts + service.ts). Výsledek AI
-- staré verze se nepoužije (cache je klíčovaná anon_config_hash, ve kterém je verze detektoru).
-- Do přepočtu se stará kopie NEPOUŽIJE (stav „čeká" — odeslání dodavateli počká ve frontě odeslání
-- a výkres zpracuje hned, ručním během mimo denní limit): stará kopie je právě ta s názvem firmy v razítku.
-- Soubor staré kopie zůstává v úložišti (anon_path) a smaže se, až ho nová kopie nahradí.
--
-- Idempotentní: druhé spuštění nic nezmění (přepočítané kopie mají detector 'anon-v2.0', čekající už nejsou
-- 'done'); audit do audit_log jen při změně.

do $$
declare
  v_ids uuid[];
  v_n int;
begin
  with upd as (
    update job_files
       set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
           anon_priority = greatest(coalesce(anon_priority, 0), 9), anon_via = 'backfill'
     where anon_status in ('done', 'review')
       and archived = false
       and coalesce(anon_summary->>'detector', '') <> 'anon-v2.0'
       and (anon_method is null or anon_method in ('raster_pdf', 'image', 'image_pdf', 'dxf'))
       and anon_is_candidate(kind::text, filename, mime_type, origin, issuer)
    returning id
  )
  select array_agg(id), count(*) into v_ids, v_n from upd;
  if v_n > 0 then
    insert into audit_log (action, entity, entity_id, diff)
    values ('anon_regenerate', 'job_files', null,
            jsonb_build_object('count', v_n, 'ids', to_jsonb(v_ids[1:500]), 'detector', 'anon-v2.0',
                               'reason', 'V kopii zůstával název firmy — přepočet novým detektorem (majitel 2. 11.)'));
  end if;

  -- archiv výkresů: jen 2D formát s vlastním souborem (výkres z dokumentu zakázky čte stav přes job_files)
  with upd as (
    update drawings
       set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
           anon_priority = greatest(coalesce(anon_priority, 0), 9), anon_via = 'backfill'
     where anon_status in ('done', 'review')
       and coalesce(anon_summary->>'detector', '') <> 'anon-v2.0'
       and (anon_method is null or anon_method in ('raster_pdf', 'image', 'image_pdf', 'dxf'))
       and storage_path is not null and anon_drawing_path(storage_path)
    returning id
  )
  select array_agg(id), count(*) into v_ids, v_n from upd;
  if v_n > 0 then
    insert into audit_log (action, entity, entity_id, diff)
    values ('anon_regenerate', 'drawings', null,
            jsonb_build_object('count', v_n, 'ids', to_jsonb(v_ids[1:500]), 'detector', 'anon-v2.0',
                               'reason', 'V kopii zůstával název firmy — přepočet novým detektorem (majitel 2. 11.)'));
  end if;

  -- samostatný nástroj (dočasné soubory uživatele, dokud neexpirují)
  with upd as (
    update drawing_anon_adhoc
       set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
           anon_priority = greatest(coalesce(anon_priority, 0), 9), anon_via = 'backfill', updated_at = now()
     where anon_status in ('done', 'review')
       and coalesce(anon_summary->>'detector', '') <> 'anon-v2.0'
       and (anon_method is null or anon_method in ('raster_pdf', 'image', 'image_pdf', 'dxf'))
       and (expires_at is null or expires_at > now())
    returning id
  )
  select array_agg(id), count(*) into v_ids, v_n from upd;
  if v_n > 0 then
    insert into audit_log (action, entity, entity_id, diff)
    values ('anon_regenerate', 'drawing_anon_adhoc', null,
            jsonb_build_object('count', v_n, 'ids', to_jsonb(v_ids[1:500]), 'detector', 'anon-v2.0',
                               'reason', 'V kopii zůstával název firmy — přepočet novým detektorem (majitel 2. 11.)'));
  end if;
end $$;
