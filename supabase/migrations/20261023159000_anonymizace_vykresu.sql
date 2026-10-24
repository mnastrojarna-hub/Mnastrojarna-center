-- Anonymizace výkresů (#22): kopie výkresu pro sdílení s dodavatelem bez firmy zákazníka/projektanta,
-- jmen (kreslil, kontroloval…), loga, podpisů, kontaktů a cest na disku. Všechno ostatní zůstává.
-- Logika: src/lib/anonymize/** (služba service.ts, rozhodnutí decide.ts, výběr ke sdílení share.ts).
--  - anonymizovaná kopie = sloupce anon_* na STEJNÉM řádku job_files (originál storage_path se nemění)
--  - archiv výkresů (přímé nahrání, bucket documents) má stejné sloupce na drawings
--  - samostatný nástroj (Poptávky → „Anonymizovat výkres") = drawing_anon_adhoc
--  - čitelné texty smazaných oblastí jen v drawing_anon_texts (jen super admin)
--  - anon_* mění jen náš server (strážní trigger, stejně jako origin/issuer v atribuci)
--  - fronta odeslání čekajících na anonymizaci = anon_send_queue
-- Vše idempotentní (add column if not exists, constrainty jen když chybí, create or replace).

-- ── 1) Sloupce anon_* (job_files, drawings) ─────────────────
do $$
declare
  t text;
begin
  foreach t in array array['job_files', 'drawings'] loop
    execute format('alter table %I add column if not exists anon_status      text', t);
    execute format('alter table %I add column if not exists anon_priority    smallint not null default 0', t);
    execute format('alter table %I add column if not exists anon_source_path text', t);
    execute format('alter table %I add column if not exists anon_path        text', t);
    execute format('alter table %I add column if not exists anon_filename    text', t);
    execute format('alter table %I add column if not exists anon_mime        text', t);
    execute format('alter table %I add column if not exists anon_size        bigint', t);
    execute format('alter table %I add column if not exists anon_sha256      text', t);
    execute format('alter table %I add column if not exists anon_method      text', t);
    execute format('alter table %I add column if not exists anon_pages       jsonb', t);
    execute format('alter table %I add column if not exists anon_regions     jsonb', t);
    execute format('alter table %I add column if not exists anon_summary     jsonb', t);
    execute format('alter table %I add column if not exists anon_confidence  numeric(4,3)', t);
    execute format('alter table %I add column if not exists anon_reason      text', t);
    execute format('alter table %I add column if not exists anon_config_hash text', t);
    execute format('alter table %I add column if not exists anon_terms_hash  text', t);
    execute format('alter table %I add column if not exists anon_ai_cache    jsonb', t);
    execute format('alter table %I add column if not exists anon_at          timestamptz', t);
    execute format('alter table %I add column if not exists anon_by          uuid references profiles(id) on delete set null', t);
    execute format('alter table %I add column if not exists anon_actor_kind  text', t);
    execute format('alter table %I add column if not exists anon_via         text', t);
    execute format('alter table %I add column if not exists anon_reviewed_at timestamptz', t);
    execute format('alter table %I add column if not exists anon_reviewed_by uuid references profiles(id) on delete set null', t);
    execute format('alter table %I add column if not exists anon_attempts    int not null default 0', t);
    execute format('alter table %I add column if not exists anon_lock_until  timestamptz', t);
    execute format('alter table %I add column if not exists anon_usage       jsonb', t);

    if not exists (select 1 from pg_constraint where conname = t || '_anon_status_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check (anon_status is null or anon_status in (''pending'', ''processing'', ''done'', ''review'', ''failed'', ''unsupported'', ''skipped''))',
        t, t || '_anon_status_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_anon_method_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check (anon_method is null or anon_method in (''raster_pdf'', ''image'', ''image_pdf'', ''dxf'', ''step''))',
        t, t || '_anon_method_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_anon_actor_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check ((anon_actor_kind is null or anon_actor_kind in (''user'', ''ai'', ''system'')) and (anon_via is null or anon_via in (''automaticky'', ''rucne'', ''foto'', ''email'', ''import'', ''cron'', ''backfill'')))',
        t, t || '_anon_actor_check');
    end if;
    if not exists (select 1 from pg_constraint where conname = t || '_anon_json_check' and conrelid = t::regclass) then
      execute format('alter table %I add constraint %I check ((anon_regions is null or jsonb_typeof(anon_regions) = ''array'') and (anon_pages is null or jsonb_typeof(anon_pages) = ''object'') and (anon_summary is null or jsonb_typeof(anon_summary) = ''object''))',
        t, t || '_anon_json_check');
    end if;
    execute format($c$comment on column %I.anon_status is 'Anonymizace výkresu: null = netýká se | pending | processing | done | review | failed | unsupported | skipped (src/lib/anonymize/decide.ts)'$c$, t);
    execute format($c$comment on column %I.anon_regions is 'Smazané oblasti [{id,page,x,y,w,h,quad?,category,source,zone,textHash?,manual?}] — BEZ čitelných textů (ty jsou v drawing_anon_texts)'$c$, t);
  end loop;
end $$;

create index if not exists idx_job_files_anon_queue  on job_files(anon_priority, created_at) where anon_status in ('pending', 'processing');
create index if not exists idx_job_files_anon_review on job_files(job_id) where anon_status in ('review', 'failed');
create index if not exists idx_job_files_anon_sha    on job_files(content_sha256, anon_config_hash) where anon_status in ('done', 'review');
create index if not exists idx_drawings_anon_queue   on drawings(anon_priority, created_at) where anon_status in ('pending', 'processing');

-- ── 2) Samostatný nástroj (Poptávky → „Anonymizovat výkres", i bez zakázky) ──
create table if not exists drawing_anon_adhoc (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references profiles(id) on delete cascade,
  storage_path     text not null,                     -- job-files: capture/<uid>/anon/<uuid>-<název>
  content_sha256   text,
  filename         text not null,
  mime_type        text,
  size_bytes       bigint,
  anon_status      text not null default 'pending',
  anon_priority    smallint not null default 0,
  anon_source_path text,
  anon_path        text,
  anon_filename    text,
  anon_mime        text,
  anon_size        bigint,
  anon_sha256      text,
  anon_method      text,
  anon_pages       jsonb,
  anon_regions     jsonb,
  anon_summary     jsonb,
  anon_confidence  numeric(4,3),
  anon_reason      text,
  anon_config_hash text,
  anon_terms_hash  text,
  anon_ai_cache    jsonb,
  anon_at          timestamptz,
  anon_by          uuid references profiles(id) on delete set null,
  anon_actor_kind  text,
  anon_via         text,
  anon_reviewed_at timestamptz,
  anon_reviewed_by uuid references profiles(id) on delete set null,
  anon_attempts    int not null default 0,
  anon_lock_until  timestamptz,
  anon_usage       jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '7 days'
);
do $$ begin
  alter table drawing_anon_adhoc add constraint drawing_anon_adhoc_status_check
    check (anon_status in ('uploading', 'pending', 'processing', 'done', 'review', 'failed', 'unsupported', 'skipped'));
exception when duplicate_object then null; end $$;
create index if not exists idx_drawing_anon_adhoc_user  on drawing_anon_adhoc(user_id, created_at desc);
create index if not exists idx_drawing_anon_adhoc_queue on drawing_anon_adhoc(anon_priority, created_at) where anon_status in ('pending', 'processing');
alter table drawing_anon_adhoc enable row level security;
do $$ begin
  create policy "drawing_anon_adhoc_own" on drawing_anon_adhoc for select using (user_id = auth.uid() or is_super_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on drawing_anon_adhoc from anon, authenticated;
grant select on drawing_anon_adhoc to authenticated;
grant all on drawing_anon_adhoc to service_role;

-- ── 3) Čitelné texty smazaných oblastí: jen super admin (audit/ladění), mažou se se souborem ──
create table if not exists drawing_anon_texts (
  id          uuid primary key default gen_random_uuid(),
  job_file_id uuid references job_files(id) on delete cascade,
  drawing_id  uuid references drawings(id) on delete cascade,
  adhoc_id    uuid references drawing_anon_adhoc(id) on delete cascade,
  region_id   text not null,
  category    text not null,
  text        text not null,
  created_at  timestamptz not null default now(),
  constraint drawing_anon_texts_one_subject check (num_nonnulls(job_file_id, drawing_id, adhoc_id) = 1)
);
create unique index if not exists uq_drawing_anon_texts_region
  on drawing_anon_texts ((coalesce(job_file_id, drawing_id, adhoc_id)), region_id);
alter table drawing_anon_texts enable row level security;
do $$ begin
  create policy "drawing_anon_texts_admin" on drawing_anon_texts for select using (is_super_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on drawing_anon_texts from anon, authenticated;
grant select on drawing_anon_texts to authenticated;
grant all on drawing_anon_texts to service_role;

-- Výsledek AI podle obsahu (sha256 zpracovaného zdroje + verze nastavení) — převzetí bez volání API (M11).
-- Obsahuje přepisy textu (OCR) → jako drawing_anon_texts jen super admin; job_files.anon_ai_cache nese jen
-- odkaz/metadata bez textů (job_files čte každý aktivní uživatel).
create table if not exists drawing_anon_ai_cache (
  src_sha256  text not null,
  config_hash text not null,
  method      text,
  cache       jsonb not null,
  model       text,
  created_at  timestamptz not null default now(),
  primary key (src_sha256, config_hash)
);
alter table drawing_anon_ai_cache enable row level security;
do $$ begin
  create policy "drawing_anon_ai_cache_admin" on drawing_anon_ai_cache for select using (is_super_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on drawing_anon_ai_cache from anon, authenticated;
grant select on drawing_anon_ai_cache to authenticated;
grant all on drawing_anon_ai_cache to service_role;

-- ── 4) Fronta odeslání čekajících na anonymizaci ────────────
create table if not exists anon_send_queue (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null,                                   -- purchase_order | job_document | supplier_inquiry
  job_id      uuid references orders(id) on delete cascade,
  ref_id      uuid,                                            -- objednávka dodavateli / soubor
  payload     jsonb not null,                                  -- příjemci, předmět, text, volby (bez souborů)
  file_ids    uuid[] not null default '{}',                    -- výkresy, které se posílají anonymizované
  status      text not null default 'waiting',
  reason      text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    int not null default 0
);
do $$ begin
  alter table anon_send_queue add constraint anon_send_queue_check
    check (kind in ('purchase_order', 'job_document', 'supplier_inquiry')
           and status in ('waiting', 'sending', 'sent', 'blocked', 'cancelled', 'failed')
           and jsonb_typeof(payload) = 'object');
exception when duplicate_object then null; end $$;
create index if not exists idx_anon_send_queue_open on anon_send_queue(created_at) where status in ('waiting', 'sending', 'blocked');
create index if not exists idx_anon_send_queue_files on anon_send_queue using gin (file_ids) where status in ('waiting', 'blocked');
alter table anon_send_queue enable row level security;
do $$ begin
  create policy "anon_send_queue_select" on anon_send_queue for select using (created_by = auth.uid() or is_super_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on anon_send_queue from anon, authenticated;
grant select on anon_send_queue to authenticated;
grant all on anon_send_queue to service_role;

-- ── 5) Nastavení (jeden řádek) ──────────────────────────────
create table if not exists drawing_anon_settings (
  id                   int primary key default 1 check (id = 1),
  enabled              boolean not null default true,
  auto_capture         boolean not null default true,
  auto_upload          boolean not null default true,
  auto_email           boolean not null default true,
  hires_capture        boolean not null default true,
  redact               jsonb not null default '{"company":true,"logo":true,"person_drawn":true,"person_checked":true,"person_revisions":true,"signature":true,"path":true,"contact":true,"code":true,"copyright_owner":true,"copyright_whole":false,"filename":true}',
  extra_terms          text[] not null default '{}',
  keep_terms           text[] not null default '{"Mnástrojárna","Mnastrojarna"}',
  include_crm_customer boolean not null default true,
  fill_pdf             text not null default 'white',
  fill_photo           text not null default 'background',
  max_dpi              int not null default 300,
  max_mpx              int not null default 40,
  verify_photos        boolean not null default true,
  daily_usd            numeric(8,2) not null default 5,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references profiles(id) on delete set null
);
do $$ begin
  alter table drawing_anon_settings add constraint drawing_anon_settings_values_check
    check (fill_pdf in ('white', 'black') and fill_photo in ('background', 'white', 'black')
           and max_dpi between 100 and 600 and max_mpx between 4 and 60 and daily_usd >= 0
           and jsonb_typeof(redact) = 'object');
exception when duplicate_object then null; end $$;
insert into drawing_anon_settings (id) values (1) on conflict do nothing;
alter table drawing_anon_settings enable row level security;
do $$ begin
  create policy "drawing_anon_settings_read" on drawing_anon_settings for select using (is_active_user());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on drawing_anon_settings from anon, authenticated;
grant select on drawing_anon_settings to authenticated;
grant all on drawing_anon_settings to service_role;

insert into automation_settings (module, mode, enabled) values ('drawing_anonymize', 'full', true)
on conflict (module) do nothing;

-- ── 6) Kandidát = EXTERNÍ soubor vhodného typu (TS zrcadlo: src/lib/anonymize/candidate.ts) ──
create or replace function anon_unsupported_ext(p_filename text) returns boolean
language sql immutable set search_path = public as $$
  select lower(coalesce(p_filename, '')) ~ '\.(dwg|sldprt|sldasm|slddrw|ipt|iam|idw|catpart|catproduct|prt|asm|par|psm|x_t|x_b|jt|3dm|f3d|stl|3mf|igs|iges)$'
$$;

create or replace function anon_is_candidate(p_kind text, p_filename text, p_mime text, p_origin text, p_issuer text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p_origin, 'upload') <> 'generated' and coalesce(p_issuer, '') <> 'my'
     and coalesce(p_kind, '') in ('vykres', 'model_3d', 'ostatni', 'foto', 'poptavka', 'objednavka')
     -- nákupní doklad dodavatele (#25, cena) se neanonymizuje — kopie by obešla pravidlo o cenách
     and not (coalesce(p_issuer, '') = 'dodavatel' and coalesce(p_kind, '') not in ('vykres', 'model_3d'))
     and (lower(coalesce(p_mime, '')) in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/tiff', 'image/heic', 'image/heif')
          or lower(coalesce(p_filename, '')) ~ '\.(pdf|jpe?g|png|webp|tiff?|heic|heif|dxf|stp|step)$'
          or anon_unsupported_ext(p_filename))
$$;

-- ── 7) Strážce + automatické zařazení (job_files) ───────────
-- Jméno „zz_" → běží PO trg_job_files_flow_before (ten v session vrací origin/kind/… na staré hodnoty).
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
    new.anon_reason := 'Formát nelze anonymizovat — pošli dodavateli PDF, DXF nebo STEP.';
  elsif (new.origin = 'email' and s.auto_email) or (new.origin = 'capture' and s.auto_capture)
     or (coalesce(new.origin, 'upload') in ('upload', 'import') and s.auto_upload) then
    new.anon_status := 'pending';
    new.anon_via := case new.origin when 'email' then 'email' when 'capture' then 'foto' when 'import' then 'import' else 'automaticky' end;
  end if;
  return new;
end $$;
drop trigger if exists trg_job_files_zz_anon_before on job_files;
create trigger trg_job_files_zz_anon_before before insert or update on job_files
  for each row execute function job_files_anon_before();

-- ── 8) Strážce + zařazení (archiv výkresů — přímé nahrání bez job_file_id) ──
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
  if not (lower(new.storage_path) ~ '\.(pdf|jpe?g|png|webp|tiff?|heic|heif|dxf|stp|step)$' or anon_unsupported_ext(new.storage_path)) then
    return new;
  end if;
  select * into s from drawing_anon_settings where id = 1;
  if s is null or not s.enabled or not s.auto_upload then return new; end if;
  if anon_unsupported_ext(new.storage_path) then
    new.anon_status := 'unsupported';
    new.anon_reason := 'Formát nelze anonymizovat — pošli dodavateli PDF, DXF nebo STEP.';
  else
    new.anon_status := 'pending'; new.anon_via := 'automaticky';
  end if;
  return new;
end $$;
drop trigger if exists trg_drawings_zz_anon_before on drawings;
create trigger trg_drawings_zz_anon_before before insert or update on drawings
  for each row execute function drawings_anon_before();

-- ── 9) Fronta zpracování: claim (jen servisní role) ─────────
-- Vezme čekající (pending), prošlé zámky (processing po termínu); opakovaně prošlý zámek (≥ 3 pokusy) → failed.
-- p_ids = ruční běh (smí i failed s < 3 pokusy). Souběh: for update skip locked.
-- pending se zámkem v budoucnu = odloženo (denní limit AI pro automatiku → zítra).
create or replace function claim_drawing_anon(p_limit int, p_ids uuid[] default null) returns setof job_files
language plpgsql security definer set search_path = public as $$
begin
  update job_files set anon_status = 'failed', anon_lock_until = null, anon_reason = 'Opakovaně překročen čas zpracování.'
   where anon_status = 'processing' and anon_lock_until < now() and anon_attempts >= 3
     and (p_ids is null or id = any(p_ids));
  return query
  update job_files f set anon_status = 'processing', anon_lock_until = now() + interval '6 min', anon_attempts = f.anon_attempts + 1
   where f.id in (select q.id from job_files q
                   where (p_ids is null or q.id = any(p_ids))
                     and ((q.anon_status = 'pending' and (q.anon_lock_until is null or q.anon_lock_until < now()))
                          or (q.anon_status = 'failed' and q.anon_attempts < 3 and p_ids is not null)
                          or (q.anon_status = 'processing' and q.anon_lock_until < now()))
                   order by q.anon_priority, q.created_at desc
                   for update skip locked
                   limit greatest(1, least(coalesce(p_limit, 1), 50)))
  returning f.*;
end $$;

create or replace function claim_drawing_anon_drawings(p_limit int, p_ids uuid[] default null) returns setof drawings
language plpgsql security definer set search_path = public as $$
begin
  update drawings set anon_status = 'failed', anon_lock_until = null, anon_reason = 'Opakovaně překročen čas zpracování.'
   where anon_status = 'processing' and anon_lock_until < now() and anon_attempts >= 3
     and (p_ids is null or id = any(p_ids));
  return query
  update drawings f set anon_status = 'processing', anon_lock_until = now() + interval '6 min', anon_attempts = f.anon_attempts + 1
   where f.id in (select q.id from drawings q
                   where (p_ids is null or q.id = any(p_ids))
                     and ((q.anon_status = 'pending' and (q.anon_lock_until is null or q.anon_lock_until < now()))
                          or (q.anon_status = 'failed' and q.anon_attempts < 3 and p_ids is not null)
                          or (q.anon_status = 'processing' and q.anon_lock_until < now()))
                   order by q.anon_priority, q.created_at desc
                   for update skip locked
                   limit greatest(1, least(coalesce(p_limit, 1), 50)))
  returning f.*;
end $$;

create or replace function claim_drawing_anon_adhoc(p_limit int, p_ids uuid[] default null) returns setof drawing_anon_adhoc
language plpgsql security definer set search_path = public as $$
begin
  update drawing_anon_adhoc set anon_status = 'failed', anon_lock_until = null, anon_reason = 'Opakovaně překročen čas zpracování.'
   where anon_status = 'processing' and anon_lock_until < now() and anon_attempts >= 3
     and (p_ids is null or id = any(p_ids));
  return query
  update drawing_anon_adhoc f set anon_status = 'processing', anon_lock_until = now() + interval '6 min',
         anon_attempts = f.anon_attempts + 1, updated_at = now()
   where f.id in (select q.id from drawing_anon_adhoc q
                   where (p_ids is null or q.id = any(p_ids))
                     and ((q.anon_status = 'pending' and (q.anon_lock_until is null or q.anon_lock_until < now()))
                          or (q.anon_status = 'failed' and q.anon_attempts < 3 and p_ids is not null)
                          or (q.anon_status = 'processing' and q.anon_lock_until < now()))
                   order by q.anon_priority, q.created_at desc
                   for update skip locked
                   limit greatest(1, least(coalesce(p_limit, 1), 50)))
  returning f.*;
end $$;

revoke execute on function claim_drawing_anon(int, uuid[]) from public, anon, authenticated;
revoke execute on function claim_drawing_anon_drawings(int, uuid[]) from public, anon, authenticated;
revoke execute on function claim_drawing_anon_adhoc(int, uuid[]) from public, anon, authenticated;
grant execute on function claim_drawing_anon(int, uuid[]) to service_role;
grant execute on function claim_drawing_anon_drawings(int, uuid[]) to service_role;
grant execute on function claim_drawing_anon_adhoc(int, uuid[]) to service_role;
revoke execute on function job_files_anon_before() from public, anon, authenticated;
revoke execute on function drawings_anon_before() from public, anon, authenticated;

-- ── 10) Backfill: staré externí kandidáty do fronty s nízkou prioritou (zpracuje plánovač v denním limitu,
--         nebo líně při odeslání). Jen jednou za život DB (značka), pozdější „skipped/null" od člověka nepřepíše.
do $$
declare v_new boolean;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('drawing_anon_backfill_v1', 'ai_access', 'Anonymizace výkresů: staré výkresy zařazeny do fronty (#22)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if coalesce(v_new, false) then
    update job_files
       set anon_status = case when anon_unsupported_ext(filename) then 'unsupported' else 'pending' end,
           anon_reason = case when anon_unsupported_ext(filename) then 'Formát nelze anonymizovat — pošli dodavateli PDF, DXF nebo STEP.' end,
           anon_priority = 9, anon_via = 'backfill'
     where anon_status is null and not archived
       and anon_is_candidate(kind::text, filename, mime_type, origin, issuer);
    update drawings
       set anon_status = case when anon_unsupported_ext(storage_path) then 'unsupported' else 'pending' end,
           anon_priority = 9, anon_via = 'backfill'
     where anon_status is null and job_file_id is null and storage_path is not null
       and (lower(storage_path) ~ '\.(pdf|jpe?g|png|webp|tiff?|dxf|stp|step)$' or anon_unsupported_ext(storage_path));
  end if;
end $$;

-- ── 11) Ceny (#25): anonymizovaná kopie a master nákupního dokladu chráněné stejně jako originál ──
-- Zrcadlo 20261023155000 job_file_path_is_price_doc; jediná změna: shoda i na anon_path / anon_source_path.
create index if not exists idx_job_files_anon_path on job_files(anon_path) where anon_path is not null;
create index if not exists idx_job_files_anon_source_path on job_files(anon_source_path) where anon_source_path is not null;
create or replace function job_file_path_is_price_doc(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_files f
                  where (f.storage_path = p_path or f.anon_path = p_path or f.anon_source_path = p_path)
                    and job_file_is_price_doc(f.id, f.kind::text, f.issuer, f.origin))
$$;

-- ── 12) Útrata AI po bězích (denní limit automatiky) ────────
-- Každý běh s voláním AI (i navazující dávka stran, opakování po chybě, přepočet) = jeden řádek;
-- denní limit sčítá dnešní řádky bez ručních běhů (src/lib/anonymize/budget.ts).
create table if not exists drawing_anon_usage_log (
  id                 bigserial primary key,
  created_at         timestamptz not null default now(),
  subject_table      text not null,
  subject_id         uuid not null,
  via                text,
  manual             boolean not null default false,
  usd                numeric(12,4) not null default 0,
  input_tokens       bigint not null default 0,
  output_tokens      bigint not null default 0,
  cache_read_tokens  bigint not null default 0,
  cache_write_tokens bigint not null default 0,
  calls              int not null default 0
);
create index if not exists idx_drawing_anon_usage_log_day on drawing_anon_usage_log(created_at);
alter table drawing_anon_usage_log enable row level security;
do $$ begin
  create policy "drawing_anon_usage_log_admin" on drawing_anon_usage_log for select using (is_super_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on drawing_anon_usage_log from anon, authenticated;
grant select on drawing_anon_usage_log to authenticated;
grant all on drawing_anon_usage_log to service_role;
grant usage, select on sequence drawing_anon_usage_log_id_seq to service_role;
