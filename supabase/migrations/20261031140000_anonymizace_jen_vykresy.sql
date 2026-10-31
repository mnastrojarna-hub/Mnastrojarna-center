-- Anonymizace JEN 2D výkresů, JEN název firmy, plná automatika (majitel 31. 10.):
--  „Anonymizovat to má výkresy, ne objednávky dodavatelů. A musí to anonymizovat s jistotou. Vlastně
--   stačí, když to smaže název firmy. Nic víc. A jenom na výkresech."
--  „3D modely taky nemají žádné razítko nebo žádný název firmy. Jde jen o výkresy."
--  „Žádný nic ke kontrole nepůjde. Prostě to automaticky bude fungovat."
-- TS zrcadlo: src/lib/anonymize/candidate.ts (isAnonCandidate, isAnonDrawingPath) — shodu hlídá
-- integrační test (anonymize.integration / formats.integration / jen-vykresy.integration).
--
--  1) kandidát = externí 2D výkres: druh „Výkres" (PDF / obrázek; BMP, SVG → „nelze"), 2D CAD podle
--     přípony (DXF; DWG, DWF, SLDDRW, IDW, CATDrawing, DRW, DFT → „nelze"), neznámý druh Ostatní / Fotka
--     ve formátu PDF / obrázek (výkres musí potvrdit klasifikace, jinak „Není výkres"), ZIP / e-mail .eml
--     (a nerozbalitelné .msg, RAR, 7z…) z podkladů zákazníka (rozbalí se, anonymizují se jen výkresy).
--     NIKDY: 3D modely, objednávky / poptávky zákazníka, nabídky, potvrzení, dodací listy, faktury,
--     korespondence, kancelářské dokumenty, naše doklady, doklady dodavatele (kromě jeho výkresu),
--  2) archiv výkresů: jen 2D formáty (3D model ne),
--  3) strážce job_files: změna druhu i z aplikace (REST) — soubor, který přestal být výkresem, ztratí
--     stav anonymizace (originál zůstává); druh změněný na „Výkres" u souboru vyřazeného klasifikací
--     („Není výkres") se zařadí znovu,
--  4) jednorázově (idempotentně): stav anonymizace u NE-výkresů pryč (fronty a odznaky; soubory ani
--     anonymní kopie se nemažou, audit do audit_log), „ke kontrole" → hotovo (kopie existuje) nebo
--     znovu do fronty, nastavení „co se maže" = jen název firmy, režim modulu = plná automatika.
-- Idempotentní (create or replace, podmíněné update, audit jen při změně).

-- ── 1) Přípony a kandidát ─────────────────────────────────────
create or replace function anon_cad2d_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(dxf|dwg|dwf|dwfx|slddrw|idw|catdrawing|drw|dft)$'
$$;

create or replace function anon_model3d_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(stp|step|igs|iges|stl|3mf|obj|x_t|x_b|xmt_txt|sat|sab|sldprt|sldasm|ipt|iam|ipn|catpart|catproduct|prt|asm|par|psm|jt|3dm|f3d|skp)$'
$$;

create or replace function anon_container_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(zip|eml|msg|rar|7z|tar|gz|tgz)$'
$$;

create or replace function anon_doc_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(pdf|jpe?g|png|webp|gif|tiff?|heic|heif)$'
$$;

create or replace function anon_is_candidate(p_kind text, p_filename text, p_mime text, p_origin text, p_issuer text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_origin, 'upload') <> 'generated' and coalesce(p_issuer, '') <> 'my'
     -- doklad dodavatele (#25, cena) se neanonymizuje — jen jeho výkres
     and not (coalesce(p_issuer, '') = 'dodavatel' and coalesce(p_kind, '') <> 'vykres')
     and case
       when anon_cad2d_ext(p_filename) then true
       when anon_model3d_ext(p_filename) then false
       when anon_container_ext(p_filename) then coalesce(p_kind, '') in ('vykres', 'model_3d', 'ostatni', 'foto', 'poptavka', 'objednavka', 'korespondence')
       when coalesce(p_kind, '') not in ('vykres', 'ostatni', 'foto') then false
       when lower(coalesce(p_mime, '')) in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/tiff', 'image/heic', 'image/heif')
         or anon_doc_ext(p_filename) then true
       else coalesce(p_kind, '') = 'vykres' and lower(coalesce(p_filename, '')) ~ '\.(bmp|svg)$'
     end
$$;

-- Archiv výkresů (přímé nahrání bez druhu): 2D výkres podle přípony.
create or replace function anon_drawing_path(p_path text) returns boolean
language sql immutable set search_path = public as $$
  select anon_doc_ext(p_path) or anon_cad2d_ext(p_path) or lower(coalesce(p_path, '')) ~ '\.(bmp|svg)$'
$$;

-- ── 2) Strážce + zařazení (job_files) ───────────────────────
create or replace function job_files_anon_before() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  s drawing_anon_settings;
  v_ctx text := app_ctx();
begin
  if v_ctx = 'session' then
    if tg_op = 'UPDATE' then
      -- přes REST (přihlášený uživatel) se anon_* nikdy nemění — jen náš server; změna druhu ale
      -- rozhoduje dál (níže): přestal-li být výkresem, stav pryč; nově výkres → do fronty
      new.anon_status := old.anon_status; new.anon_priority := old.anon_priority; new.anon_source_path := old.anon_source_path;
      new.anon_path := old.anon_path; new.anon_filename := old.anon_filename; new.anon_mime := old.anon_mime;
      new.anon_size := old.anon_size; new.anon_sha256 := old.anon_sha256; new.anon_method := old.anon_method;
      new.anon_pages := old.anon_pages; new.anon_regions := old.anon_regions; new.anon_summary := old.anon_summary;
      new.anon_confidence := old.anon_confidence; new.anon_reason := old.anon_reason; new.anon_config_hash := old.anon_config_hash;
      new.anon_terms_hash := old.anon_terms_hash; new.anon_ai_cache := old.anon_ai_cache; new.anon_at := old.anon_at;
      new.anon_by := old.anon_by; new.anon_actor_kind := old.anon_actor_kind; new.anon_via := old.anon_via;
      new.anon_reviewed_at := old.anon_reviewed_at; new.anon_reviewed_by := old.anon_reviewed_by;
      new.anon_attempts := old.anon_attempts; new.anon_lock_until := old.anon_lock_until; new.anon_usage := old.anon_usage;
      if new.kind is not distinct from old.kind and new.filename is not distinct from old.filename
         and new.origin is not distinct from old.origin and new.issuer is not distinct from old.issuer then
        return new;
      end if;
    else
      -- INSERT přes REST: klient si nesmí nic předvyplnit
      new.anon_status := null; new.anon_priority := 0; new.anon_source_path := null; new.anon_path := null;
      new.anon_filename := null; new.anon_mime := null; new.anon_size := null; new.anon_sha256 := null;
      new.anon_method := null; new.anon_pages := null; new.anon_regions := null; new.anon_summary := null;
      new.anon_confidence := null; new.anon_reason := null; new.anon_config_hash := null; new.anon_terms_hash := null;
      new.anon_ai_cache := null; new.anon_at := null; new.anon_by := null; new.anon_actor_kind := null; new.anon_via := null;
      new.anon_reviewed_at := null; new.anon_reviewed_by := null; new.anon_attempts := 0; new.anon_lock_until := null; new.anon_usage := null;
    end if;
  end if;

  -- server rozhodl sám (skipped s autorem, výsledek služby, ruční zařazení)
  if tg_op = 'INSERT' and new.anon_status is not null then return new; end if;
  if tg_op = 'UPDATE' and new.anon_status is distinct from old.anon_status then return new; end if;

  if not anon_is_candidate(new.kind::text, new.filename, new.mime_type, new.origin, new.issuer) then
    -- přestal být výkresem (druh změněn na objednávku, 3D model…) → stav anonymizace pryč (běžící
    -- zpracování dokončí služba a sama ho vynuluje; ruční „Neanonymizovat" zůstává)
    if tg_op = 'UPDATE' and new.anon_status in ('pending', 'failed', 'review', 'done', 'unsupported') then
      new.anon_status := null; new.anon_reason := null; new.anon_lock_until := null; new.anon_attempts := 0;
    end if;
    return new;
  end if;
  if new.archived then return new; end if;
  select * into s from drawing_anon_settings where id = 1;
  -- druh změněn na „Výkres" u souboru, který klasifikace vyřadila („Není výkres") → znovu do fronty
  if tg_op = 'UPDATE' and old.anon_status = 'skipped' and coalesce(old.anon_actor_kind, '') <> 'user'
     and new.kind::text = 'vykres' and old.kind::text is distinct from 'vykres' then
    -- (s is not null by u řádku s prázdným sloupcem vyšlo false — proto coalesce)
    if coalesce(s.enabled, false) then
      new.anon_status := 'pending'; new.anon_reason := null; new.anon_attempts := 0; new.anon_lock_until := null;
      new.anon_priority := 0; new.anon_via := 'automaticky';
    end if;
    return new;
  end if;
  -- změna druhu u už rozhodnutého souboru: výsledek platí (obsah se nezměnil; skipped = rozhodl člověk/AI)
  if tg_op = 'UPDATE' and old.anon_status is not null then return new; end if;

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

-- ── 3) Strážce + zařazení (archiv výkresů) — jen 2D formáty ──
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
  if not anon_drawing_path(new.storage_path) then
    -- 3D model / jiný formát v archivu: žádná anonymizace
    if tg_op = 'UPDATE' and new.anon_status in ('pending', 'failed', 'review', 'done', 'unsupported') then
      new.anon_status := null; new.anon_reason := null; new.anon_lock_until := null; new.anon_attempts := 0;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.anon_status is not null and new.storage_path is not distinct from old.storage_path then return new; end if;
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

-- ── 4) Nastavení: jen název firmy, plná automatika ───────────
alter table drawing_anon_settings alter column redact set default
  '{"company":true,"logo":false,"person_drawn":false,"person_checked":false,"person_revisions":false,"signature":false,"path":false,"contact":false,"code":false,"copyright_owner":false,"copyright_whole":false,"filename":false}';
insert into drawing_anon_settings (id) values (1) on conflict do nothing;
-- i ve stávající instalaci (rozhodnutí majitele „nic víc"; dřívější volby super admina se přepíšou)
update drawing_anon_settings
   set redact = '{"company":true,"logo":false,"person_drawn":false,"person_checked":false,"person_revisions":false,"signature":false,"path":false,"contact":false,"code":false,"copyright_owner":false,"copyright_whole":false,"filename":false}'::jsonb,
       updated_at = now()
 where id = 1
   and redact is distinct from '{"company":true,"logo":false,"person_drawn":false,"person_checked":false,"person_revisions":false,"signature":false,"path":false,"contact":false,"code":false,"copyright_owner":false,"copyright_whole":false,"filename":false}'::jsonb
   and not exists (select 1 from integration_settings where key = 'drawing_anon_company_only_v1');
-- značka: přepis jen jednou (pozdější volba super admina v Nastavení platí)
insert into integration_settings (key, category, label, is_secret, value)
values ('drawing_anon_company_only_v1', 'ai_access', 'Anonymizace výkresů: výchozí jen název firmy (31. 10.)', false, 'done')
on conflict (key) do nothing;

insert into automation_settings (module, mode, enabled) values ('drawing_anonymize', 'full', true)
on conflict (module) do update set mode = 'full', enabled = true
 where automation_settings.mode is distinct from 'full' or automation_settings.enabled is distinct from true;

-- ── 5) Stávající soubory podle nových pravidel (idempotentně) ──
do $$
declare
  v_ids uuid[];
  v_n int;
begin
  -- a) NE-výkresy (objednávky, doklady, 3D modely, korespondence…) z front a odznaků; soubory, kopie
  --    i historie zůstávají. Běžící zpracování (processing) vynuluje služba sama.
  with upd as (
    update job_files
       set anon_status = null, anon_reason = null, anon_lock_until = null, anon_attempts = 0, anon_priority = 0
     where anon_status in ('pending', 'review', 'failed', 'done', 'unsupported')
       and not anon_is_candidate(kind::text, filename, mime_type, origin, issuer)
    returning id
  )
  select array_agg(id), count(*) into v_ids, v_n from upd;
  if v_n > 0 then
    insert into audit_log (action, entity, entity_id, diff)
    values ('anon_not_drawing_cleared', 'job_files', null,
            jsonb_build_object('count', v_n, 'ids', to_jsonb(v_ids[1:500]), 'reason', 'Anonymizují se jen 2D výkresy (majitel 31. 10.)'));
  end if;

  with upd as (
    update drawings
       set anon_status = null, anon_reason = null, anon_lock_until = null, anon_attempts = 0, anon_priority = 0
     where anon_status in ('pending', 'review', 'failed', 'done', 'unsupported')
       and job_file_id is null and storage_path is not null and not anon_drawing_path(storage_path)
    returning id
  )
  select array_agg(id), count(*) into v_ids, v_n from upd;
  if v_n > 0 then
    insert into audit_log (action, entity, entity_id, diff)
    values ('anon_not_drawing_cleared', 'drawings', null,
            jsonb_build_object('count', v_n, 'ids', to_jsonb(v_ids[1:500]), 'reason', 'Anonymizují se jen 2D výkresy (majitel 31. 10.)'));
  end if;

  -- b) „Ke kontrole" už nevzniká: s ověřenou kopií → hotovo, bez kopie → znovu do fronty
  with upd as (
    update job_files
       set anon_status = case when anon_path is not null and anon_sha256 is not null then 'done' else 'pending' end,
           anon_reason = null, anon_lock_until = null, anon_attempts = 0,
           anon_priority = case when anon_path is not null and anon_sha256 is not null then anon_priority else 5 end
     where anon_status = 'review'
    returning id, anon_status
  )
  select array_agg(id), count(*) into v_ids, v_n from upd;
  if v_n > 0 then
    insert into audit_log (action, entity, entity_id, diff)
    values ('anon_review_resolved', 'job_files', null,
            jsonb_build_object('count', v_n, 'ids', to_jsonb(v_ids[1:500]), 'reason', 'Plná automatika — „Ke kontrole" zrušeno (majitel 31. 10.)'));
  end if;

  update drawings
     set anon_status = case when anon_path is not null and anon_sha256 is not null then 'done' else 'pending' end,
         anon_reason = null, anon_lock_until = null, anon_attempts = 0,
         anon_priority = case when anon_path is not null and anon_sha256 is not null then anon_priority else 5 end
   where anon_status = 'review';

  update drawing_anon_adhoc
     set anon_status = case when anon_path is not null and anon_sha256 is not null then 'done' else 'pending' end,
         anon_reason = null, anon_lock_until = null, anon_attempts = 0, updated_at = now()
   where anon_status = 'review';
end $$;
