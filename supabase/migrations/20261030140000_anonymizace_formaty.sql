-- Anonymizace výkresů: VŠECHNY formáty, které zákazník reálně pošle („vždycky tam musí být anonymizace").
-- TS zrcadlo: src/lib/anonymize/candidate.ts (isAnonCandidate, isUnsupportedExt, unsupportedHowTo) —
-- shodu hlídá integrační test (formats.integration.test.ts).
--  * nově se anonymizuje: STL (název uvnitř), IGES (hlavička, popisky), GIF; ZIP a e-mail .eml se
--    rozbalí do samostatných souborů zakázky,
--  * nově „Nelze anonymizovat automaticky" (k dodavateli jen po potvrzení super admina): kancelářské
--    dokumenty (Word, Excel…), další nativní CAD, archivy RAR / 7z, Outlook .msg, BMP, SVG,
--  * e-mail zákazníka uložený jako soubor (.eml / .msg, druh korespondence) je kandidát,
--  * důvod „nelze" s návodem podle formátu (anon_unsupported_reason),
--  * anon_method: stl, iges,
--  * jednorázově: dřívější „nelze" u formátů, které už jdou (STL, IGES, HEIC, binární DXF), zpět do
--    fronty (staré výkresy, priorita 9); externí podklady bez stavu (DOCX, ZIP…) dostanou stav.
-- Idempotentní (create or replace, drop/add constraint, jednorázová značka).

-- ── 1) Formáty ───────────────────────────────────────────────
create or replace function anon_unsupported_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(dwg|dwf|dwfx|sldprt|sldasm|slddrw|ipt|iam|idw|ipn|catpart|catproduct|catdrawing|prt|asm|drw|par|psm|dft|x_t|x_b|xmt_txt|sat|sab|jt|3dm|f3d|3mf|obj|skp|doc|docx|docm|xls|xlsx|xlsm|ppt|pptx|odt|ods|odg|rtf|rar|7z|tar|gz|tgz|msg|bmp|svg)$'
$$;

create or replace function anon_supported_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(pdf|jpe?g|png|webp|gif|tiff?|heic|heif|dxf|stp|step|stl|igs|iges|zip|eml)$'
$$;

create or replace function anon_is_candidate(p_kind text, p_filename text, p_mime text, p_origin text, p_issuer text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_origin, 'upload') <> 'generated' and coalesce(p_issuer, '') <> 'my'
     -- nákupní doklad dodavatele (#25, cena) se neanonymizuje — kopie by obešla pravidlo o cenách
     and not (coalesce(p_issuer, '') = 'dodavatel' and coalesce(p_kind, '') not in ('vykres', 'model_3d'))
     and (
       -- e-mail zákazníka uložený jako soubor
       (coalesce(p_kind, '') = 'korespondence' and lower(coalesce(p_filename, '')) ~ '\.(eml|msg)$')
       or (coalesce(p_kind, '') in ('vykres', 'model_3d', 'ostatni', 'foto', 'poptavka', 'objednavka')
           and (lower(coalesce(p_mime, '')) in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/heic', 'image/heif')
                or anon_supported_ext(p_filename)
                or anon_unsupported_ext(p_filename)))
     )
$$;

-- Česká rada „co s tím" (zrcadlo unsupportedHowTo v candidate.ts — stejné texty).
create or replace function anon_unsupported_reason(p_filename text) returns text
language sql immutable set search_path = public as $$
  with e as (select coalesce(substring(lower(coalesce(p_filename, '')) from '\.([a-z0-9_]+)$'), '') as ext)
  select 'Nelze anonymizovat automaticky (' || case
      when ext in ('dwg', 'dwf', 'dwfx') then upper(ext) || ') — ulož výkres jako PDF nebo DXF (AutoCAD: Uložit jako → DXF) a nahraj znovu.'
      when ext in ('slddrw', 'idw', 'catdrawing', 'drw', 'dft') then 'výkres z CAD) — ulož ho jako PDF nebo DXF a nahraj znovu.'
      when ext in ('sldprt', 'sldasm', 'ipt', 'iam', 'ipn', 'catpart', 'catproduct', 'prt', 'asm', 'par', 'psm', 'x_t', 'x_b', 'xmt_txt', 'sat', 'sab', 'jt', '3dm', 'f3d', 'skp')
        then 'nativní CAD model) — exportuj ho jako STEP (Soubor → Uložit jako → STEP) a nahraj znovu.'
      when ext in ('3mf', 'obj') then 'model ' || upper(ext) || ') — exportuj ho jako STEP nebo STL a nahraj znovu.'
      when ext in ('doc', 'docx', 'docm', 'odt', 'rtf') then 'dokument Word) — ulož ho jako PDF (Soubor → Uložit jako → PDF) a nahraj znovu.'
      when ext in ('xls', 'xlsx', 'xlsm', 'ods') then 'tabulka Excel) — ulož ji jako PDF (Soubor → Uložit jako → PDF) a nahraj znovu.'
      when ext in ('ppt', 'pptx', 'odg') then 'prezentace) — ulož ji jako PDF a nahraj znovu.'
      when ext in ('rar', '7z', 'tar', 'gz', 'tgz') then 'archiv ' || upper(ext) || ') — rozbal ho a nahraj výkresy jednotlivě (nebo pošli ZIP — ten se rozbalí sám).'
      when ext = 'msg' then 'e-mail z Outlooku) — ulož přílohy a nahraj je zvlášť (nebo e-mail přepošli do firemní schránky).'
      when ext = 'bmp' then 'BMP) — ulož obrázek jako PNG nebo JPEG a nahraj znovu.'
      when ext = 'svg' then 'SVG) — ulož výkres jako PDF a nahraj znovu.'
      else 'neznámý formát) — pošli dodavateli PDF, DXF nebo STEP.'
    end
  from e
$$;

-- ── 2) Metody výstupu ────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['job_files', 'drawings', 'drawing_anon_adhoc'] loop
    execute format('alter table %I drop constraint if exists %I', t, t || '_anon_method_check');
    execute format('alter table %I add constraint %I check (anon_method is null or anon_method in (''raster_pdf'', ''image'', ''image_pdf'', ''dxf'', ''step'', ''stl'', ''iges''))',
      t, t || '_anon_method_check');
  end loop;
end $$;

-- ── 3) Strážce + zařazení (job_files) — beze změny kromě důvodu „nelze" ──
create or replace function job_files_anon_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s drawing_anon_settings;
  v_ctx text := app_ctx();
begin
  if v_ctx = 'session' then
    if tg_op = 'UPDATE' then
      -- přes REST (přihlášený uživatel) se anon_* nikdy nemění — jen náš server
      new.anon_status := old.anon_status; new.anon_priority := old.anon_priority; new.anon_source_path := old.anon_source_path;
      new.anon_path := old.anon_path; new.anon_filename := old.anon_filename; new.anon_mime := old.anon_mime;
      new.anon_size := old.anon_size; new.anon_sha256 := old.anon_sha256; new.anon_method := old.anon_method;
      new.anon_pages := old.anon_pages; new.anon_regions := old.anon_regions; new.anon_summary := old.anon_summary;
      new.anon_confidence := old.anon_confidence; new.anon_reason := old.anon_reason; new.anon_config_hash := old.anon_config_hash;
      new.anon_terms_hash := old.anon_terms_hash; new.anon_ai_cache := old.anon_ai_cache; new.anon_at := old.anon_at;
      new.anon_by := old.anon_by; new.anon_actor_kind := old.anon_actor_kind; new.anon_via := old.anon_via;
      new.anon_reviewed_at := old.anon_reviewed_at; new.anon_reviewed_by := old.anon_reviewed_by;
      new.anon_attempts := old.anon_attempts; new.anon_lock_until := old.anon_lock_until; new.anon_usage := old.anon_usage;
      return new;
    end if;
    -- INSERT přes REST: klient si nesmí nic předvyplnit
    new.anon_status := null; new.anon_priority := 0; new.anon_source_path := null; new.anon_path := null;
    new.anon_filename := null; new.anon_mime := null; new.anon_size := null; new.anon_sha256 := null;
    new.anon_method := null; new.anon_pages := null; new.anon_regions := null; new.anon_summary := null;
    new.anon_confidence := null; new.anon_reason := null; new.anon_config_hash := null; new.anon_terms_hash := null;
    new.anon_ai_cache := null; new.anon_at := null; new.anon_by := null; new.anon_actor_kind := null; new.anon_via := null;
    new.anon_reviewed_at := null; new.anon_reviewed_by := null; new.anon_attempts := 0; new.anon_lock_until := null; new.anon_usage := null;
  end if;

  -- server rozhodl sám (skipped s autorem, výsledek služby, ruční zařazení)
  if tg_op = 'INSERT' and new.anon_status is not null then return new; end if;
  if tg_op = 'UPDATE' and new.anon_status is distinct from old.anon_status then return new; end if;

  if not anon_is_candidate(new.kind::text, new.filename, new.mime_type, new.origin, new.issuer) then
    if tg_op = 'UPDATE' and new.anon_status in ('pending', 'failed') then new.anon_status := null; end if;
    return new;
  end if;
  -- změna druhu u už rozhodnutého souboru: výsledek platí (obsah se nezměnil; skipped = rozhodl člověk/AI)
  if tg_op = 'UPDATE' and old.anon_status is not null then return new; end if;
  if new.archived then return new; end if;

  select * into s from drawing_anon_settings where id = 1;
  if s is null or not s.enabled then return new; end if;
  if anon_unsupported_ext(new.filename) then
    new.anon_status := 'unsupported';
    new.anon_reason := anon_unsupported_reason(new.filename);
  elsif (new.origin = 'email' and s.auto_email) or (new.origin = 'capture' and s.auto_capture)
     or (coalesce(new.origin, 'upload') in ('upload', 'import') and s.auto_upload) then
    new.anon_status := 'pending';
    new.anon_via := case new.origin when 'email' then 'email' when 'capture' then 'foto' when 'import' then 'import' else 'automaticky' end;
  end if;
  return new;
end $$;

-- ── 4) Strážce + zařazení (archiv výkresů) — rozšířené přípony, důvod „nelze" ──
create or replace function drawings_anon_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s drawing_anon_settings;
begin
  if app_ctx() = 'session' then
    if tg_op = 'UPDATE' then
      new.anon_status := old.anon_status; new.anon_priority := old.anon_priority; new.anon_source_path := old.anon_source_path;
      new.anon_path := old.anon_path; new.anon_filename := old.anon_filename; new.anon_mime := old.anon_mime;
      new.anon_size := old.anon_size; new.anon_sha256 := old.anon_sha256; new.anon_method := old.anon_method;
      new.anon_pages := old.anon_pages; new.anon_regions := old.anon_regions; new.anon_summary := old.anon_summary;
      new.anon_confidence := old.anon_confidence; new.anon_reason := old.anon_reason; new.anon_config_hash := old.anon_config_hash;
      new.anon_terms_hash := old.anon_terms_hash; new.anon_ai_cache := old.anon_ai_cache; new.anon_at := old.anon_at;
      new.anon_by := old.anon_by; new.anon_actor_kind := old.anon_actor_kind; new.anon_via := old.anon_via;
      new.anon_reviewed_at := old.anon_reviewed_at; new.anon_reviewed_by := old.anon_reviewed_by;
      new.anon_attempts := old.anon_attempts; new.anon_lock_until := old.anon_lock_until; new.anon_usage := old.anon_usage;
      return new;
    end if;
    new.anon_status := null; new.anon_priority := 0; new.anon_source_path := null; new.anon_path := null;
    new.anon_filename := null; new.anon_mime := null; new.anon_size := null; new.anon_sha256 := null;
    new.anon_method := null; new.anon_pages := null; new.anon_regions := null; new.anon_summary := null;
    new.anon_confidence := null; new.anon_reason := null; new.anon_config_hash := null; new.anon_terms_hash := null;
    new.anon_ai_cache := null; new.anon_at := null; new.anon_by := null; new.anon_actor_kind := null; new.anon_via := null;
    new.anon_reviewed_at := null; new.anon_reviewed_by := null; new.anon_attempts := 0; new.anon_lock_until := null; new.anon_usage := null;
  end if;
  if tg_op = 'INSERT' and new.anon_status is not null then return new; end if;
  if tg_op = 'UPDATE' and new.anon_status is distinct from old.anon_status then return new; end if;
  -- výkres z dokumentu zakázky čte anonymizaci přes job_files
  if new.job_file_id is not null or new.storage_path is null then return new; end if;
  if tg_op = 'UPDATE' and old.anon_status is not null and new.storage_path is not distinct from old.storage_path then return new; end if;
  if not (anon_supported_ext(new.storage_path) or anon_unsupported_ext(new.storage_path)) then
    return new;
  end if;
  select * into s from drawing_anon_settings where id = 1;
  if s is null or not s.enabled or not s.auto_upload then return new; end if;
  if anon_unsupported_ext(new.storage_path) then
    new.anon_status := 'unsupported';
    new.anon_reason := anon_unsupported_reason(new.storage_path);
  else
    new.anon_status := 'pending'; new.anon_via := 'automaticky';
  end if;
  return new;
end $$;

revoke execute on function job_files_anon_before() from public, anon, authenticated;
revoke execute on function drawings_anon_before() from public, anon, authenticated;

-- ── 5) Jednorázově: stávající soubory podle nových pravidel ──
do $$
declare v_new boolean;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('drawing_anon_formats_v2', 'ai_access', 'Anonymizace výkresů: nové formáty (STL, IGES, ZIP, e-mail, HEIC, Office) zařazeny', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if coalesce(v_new, false) then
    -- „nelze" u formátů, které už jdou (STL, IGES, HEIC z iPhonu, binární DXF) → fronta starých výkresů
    update job_files
       set anon_status = 'pending', anon_reason = null, anon_priority = 9, anon_via = 'backfill', anon_attempts = 0, anon_lock_until = null
     where anon_status = 'unsupported' and not archived and not anon_unsupported_ext(filename) and anon_supported_ext(filename);
    update drawings
       set anon_status = 'pending', anon_reason = null, anon_priority = 9, anon_via = 'backfill', anon_attempts = 0, anon_lock_until = null
     where anon_status = 'unsupported' and job_file_id is null and storage_path is not null
       and not anon_unsupported_ext(storage_path) and anon_supported_ext(storage_path);
    -- „nelze" s novým návodem
    update job_files set anon_reason = anon_unsupported_reason(filename)
     where anon_status = 'unsupported' and anon_unsupported_ext(filename);
    update drawings set anon_reason = anon_unsupported_reason(storage_path)
     where anon_status = 'unsupported' and job_file_id is null and anon_unsupported_ext(storage_path);
    -- externí podklady bez stavu, které jsou nově kandidáty (Word, Excel, ZIP, e-mail…)
    update job_files
       set anon_status = case when anon_unsupported_ext(filename) then 'unsupported' else 'pending' end,
           anon_reason = case when anon_unsupported_ext(filename) then anon_unsupported_reason(filename) end,
           anon_priority = 9, anon_via = 'backfill'
     where anon_status is null and not archived
       and anon_is_candidate(kind::text, filename, mime_type, origin, issuer)
       and exists (select 1 from drawing_anon_settings d where d.id = 1 and d.enabled);
  end if;
end $$;
