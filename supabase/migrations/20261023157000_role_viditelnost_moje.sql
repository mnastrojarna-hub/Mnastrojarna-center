-- ============================================================
-- 20261023157000 — Role a viditelnost (#25), krok 2: „moje", nákupní doklady, pojistky
--  * flow_mine_job_id_list(p_user) — „moje" zakázky jako jedno pole (seznam bez limitu řádků PostgRESTu)
--  * job_file_price_ids(p_ids) — které dokumenty jsou nákupní doklady (i přes sdílenou cestu v úložišti)
--  * job_files: session (REST) smí vložit dokument jen ze svého capture/<uid>/ a jen s cestou, kterou
--    žádný jiný dokument nepoužívá (jinak by „výkres" ukázal soubor nabídky dodavatele)
--  * orders.approved_by / approved_at („Schválil" u zakázky) zapisuje jen super admin (nebo DB / server bez autora)
--  * fronta schválení: čas vyřízení přes REST dává DB (nejde antedatovat)
--  * oprava job_file_is_price_doc: nikdy NULL (RLS jinak skryla zaměstnanci dokumenty bez vystavitele)
--  * úložiště: PDF neschválené / před schválením vzniklé nabídky přes REST stáhne jen super admin
--  * obchodník nové zakázky (REST i server s autorem): ne-admin jen sebe, nikoho, nebo obchodníka zákazníka;
--    obchodníka zákazníka mění jen super admin (REST založí jen sebe / nikoho)
--  * odznak „Nabídky": k odeslání jen ty, které viewer smí odeslat; vrácené jen jeho vlastní
-- POZOR: job_files_flow_before(), approval_queue_session_guard(), job_file_is_price_doc(),
--        orders_owner_guard(), flow_badge_counts() a politika job_files_bucket_read jsou zde
--        PŘEDEFINOVANÉ (předchozí definice 20261023155000_role_viditelnost.sql) — platí POSLEDNÍ
--        definice (tato); další změny dělej v nové migraci od těchto těl.
-- Idempotentní: druhé spuštění nic nezmění.
-- ============================================================

-- ── 1) „Moje" zakázky jako pole ─────────────────────────────
/** Totéž jako flow_mine_job_ids (session → vždy auth.uid()), ale jedno pole: PostgREST řádky omezuje (max_rows). */
create or replace function flow_mine_job_id_list(p_user uuid)
returns uuid[] language sql stable set search_path = public as $$
  select coalesce(array_agg(t.id order by t.id), '{}'::uuid[]) from flow_mine_job_ids(p_user) as t(id)
$$;

-- ── 2) Nákupní doklady v dávce ──────────────────────────────
/** Nákupní doklad (TS dvojče: src/lib/auth/price-visibility.ts isPriceDocument).
 *  Oprava 155000: u vystavitele NULL vracela funkce NULL (ne false) → politika „not …" řádek
 *  zaměstnanci skryla (poptávka, výkres, fotka bez vystavitele). Teď vždy true / false. */
create or replace function job_file_is_price_doc(p_id uuid, p_kind text, p_issuer text, p_origin text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(p_kind = 'objednavka_vydana', false)
      or coalesce(p_issuer = 'dodavatel' and p_kind not in ('vykres', 'model_3d'), false)
      or coalesce(p_kind in ('nabidka', 'faktura', 'naceneni', 'potvrzeni') and p_issuer is null
                  and p_origin is distinct from 'generated', false)
      or exists (select 1 from purchase_orders po where po.file_id = p_id)
      or exists (select 1 from supplier_quotes sq where sq.file_id = p_id)
$$;

/** Cestu v úložišti už používá nějaký dokument? (SECURITY DEFINER — RLS by nákupní řádky skryla.)
 *  Přihlášený (REST) se smí ptát jen na svou složku capture/<uid>/ — jinak by šlo ověřovat cizí cesty. */
create or replace function job_file_path_in_use(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_path is not null
     and (auth.uid() is null or p_path like 'capture/' || auth.uid()::text || '/%')
     and exists (select 1 from job_files f where f.storage_path = p_path)
$$;

/** Která z daných id jsou nákupní doklady — vlastním pravidlem, nebo sdílí cestu s nákupním dokladem
 *  (TS dvojče pravidla: src/lib/auth/price-visibility.ts isPriceDocument; použití lib/jobs/job-file-access.ts). */
create or replace function job_file_price_ids(p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(f.id order by f.id), '{}'::uuid[]) from job_files f
  where f.id = any (coalesce(p_ids, '{}'::uuid[]))
    and (job_file_is_price_doc(f.id, f.kind::text, f.issuer, f.origin) or job_file_path_is_price_doc(f.storage_path))
$$;

-- ── 3) Dokumenty: session vkládá jen ze svého capture/<uid>/ ──
-- Zrcadlo 20261023155000 (job_files_flow_before), jediná změna: blok „#25 (157000)" v INSERT větvi.
create or replace function job_files_flow_before()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ctx text := app_ctx();
begin
  if tg_op = 'INSERT' then
    -- #25 (157000): přes REST jen vlastní fotka (capture/<uid>/…) a jen cesta, kterou nemá jiný dokument
    if v_ctx = 'session' then
      if new.storage_path is null or new.storage_path not like 'capture/' || auth.uid()::text || '/%'
         or position('..' in new.storage_path) > 0 then
        raise exception 'Dokument zakázky přes REST vložíš jen ze své složky capture/ — soubory ukládá aplikace.' using errcode = '42501';
      end if;
      if job_file_path_in_use(new.storage_path) then
        raise exception 'Tento soubor už patří jinému dokumentu.' using errcode = '42501';
      end if;
    end if;
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

-- ── 4) „Schválil" u zakázky jen super admin ─────────────────
/** orders.approved_by / approved_at: přímý zápis člověka, který není super admin (REST i náš server s autorem),
 *  je odmítnut (insert je tiše vynuluje). Vnořené zápisy DB (zrušení schválení nabídky) a server bez autora projdou. */
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
    raise exception 'Schválení nabídky u zakázky zapisuje jen super admin.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_approval_guard on orders;
create trigger trg_orders_approval_guard before insert or update of approved_by, approved_at on orders
  for each row execute function orders_approval_guard();

-- ── 5) Fronta: čas vyřízení přes REST dává DB ───────────────
-- Zrcadlo 20261023155000 (approval_queue_session_guard), jediná změna: poslední řádek před return.
create or replace function approval_queue_session_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1 or is_super_admin() then return new; end if;
  if new.status is distinct from old.status and not (old.status = 'pending' and new.status = 'rejected') then
    raise exception 'Položku fronty vyřizuje super admin.' using errcode = '42501';
  end if;
  new := jsonb_populate_record(new, to_jsonb(old) - 'status' - 'resolved_by' - 'resolved_at');
  -- #25 (157000): odmítnutí = teď (žádné antedatování), jinak čas vyřízení beze změny
  new.resolved_at := case when new.status is distinct from old.status then now() else old.resolved_at end;
  return new;
end $$;

-- ── 6) Úložiště: neschválené / zastaralé PDF naší nabídky ──
/** Objekt úložiště je PDF naší nabídky, která čeká na schválení, nebo vzniklo před posledním schválením?
 *  (TS dvojče: src/lib/jobs/job-file-access.ts fileLocks „unapproved" / „stale" + quoteApprovalBlock.) */
create or replace function job_file_path_is_locked_quote(p_path text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from job_files f join quotes q on q.id = f.quote_id
    where f.storage_path = p_path and f.kind = 'nabidka' and f.issuer is distinct from 'dodavatel'
      and ((q.approved_by is null and (coalesce(q.admin_approval_required, false)
                                       or (coalesce(q.approval_required, false) and q.sent_at is null)))
           or (q.approved_at is not null and f.created_at < q.approved_at)))
$$;

-- Zrcadlo 20261023155000 (job_files_bucket_read), jediná změna: mimo capture/ i zámek nabídky (super admin vše).
drop policy if exists "job_files_bucket_read" on storage.objects;
create policy "job_files_bucket_read" on storage.objects for select using (
  bucket_id = 'job-files' and auth.role() = 'authenticated'
  and public.is_active_user()
  and case when (storage.foldername(name))[1] = 'capture' then (storage.foldername(name))[2] = auth.uid()::text
      else public.is_super_admin()
           or ((public.is_obchodnik_or_admin() or not public.job_file_path_is_price_doc(name))
               and not public.job_file_path_is_locked_quote(name)) end);

-- ── 7) Obchodník zakázky a zákazníka ────────────────────────
-- Zrcadlo 20261023155000 (orders_owner_guard) + INSERT: přímý zápis ne-admina (REST i server s autorem)
-- smí jako obchodníka nové zakázky dát jen sebe, nikoho, nebo obchodníka jejího zákazníka
-- (TS dvojče: src/app/actions/jobs.ts ownerChoiceError).
create or replace function orders_owner_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() <> 1 or not app_actor_is_non_admin_user() or app_actor_kind() is distinct from 'user' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.owner_id is not null and new.owner_id is distinct from app_actor()
       and not exists (select 1 from customers c where c.id = new.customer_id and c.owner_id = new.owner_id) then
      raise exception 'Obchodníka zakázky mění jen super admin.' using errcode = '42501';
    end if;
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'Obchodníka zakázky mění jen super admin.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_orders_owner_guard on orders;
create trigger trg_orders_owner_guard before insert or update of owner_id on orders
  for each row execute function orders_owner_guard();

/** Obchodník zákazníka (komu připadnou jeho další zakázky z pošty a fotek): mění jen super admin.
 *  Přes REST založí ne-admin zákazníka jen se sebou / bez obchodníka; náš server zakládá podle pravidel
 *  aplikace (createJob, focení). TS dvojče: src/app/actions/crm.ts (createCustomer / updateCustomer). */
create or replace function customers_owner_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if pg_trigger_depth() <> 1 or not app_actor_is_non_admin_user() or app_actor_kind() is distinct from 'user' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if app_ctx() = 'session' and new.owner_id is not null and new.owner_id is distinct from app_actor() then
      raise exception 'Obchodníka zákazníka mění jen super admin.' using errcode = '42501';
    end if;
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'Obchodníka zákazníka mění jen super admin.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_customers_owner_guard on customers;
create trigger trg_customers_owner_guard before insert or update of owner_id on customers
  for each row execute function customers_owner_guard();

-- ── 8) Odznak „Nabídky": jen co viewer opravdu může udělat ──
-- Zrcadlo 20261023155000 (flow_badge_counts), změny: quotes_ready jen nabídky, které viewer smí odeslat
-- (obchodník / super admin, jinak autor / Obchodník / Zpracovává schválené nabídky — TS dvojče
-- src/lib/jobs/flow-status.ts quoteSendBlock); quotes_returned jen viewerovy vlastní (opraví je autor).
create or replace function flow_badge_counts(p_mine uuid default null)
returns table (inquiries int, pricing int, quotes_pending int, quotes_pending_manual int,
               quotes_ready int, quotes_returned int, confirmations int)
language sql stable set search_path = public as $$
  with me as (select case when p_mine is null then null::uuid else coalesce(auth.uid(), p_mine) end as uid),
  viewer as (select me.uid,
                    coalesce((select p.role in ('super_admin', 'obchodnik') from profiles p where p.id = me.uid), false) as sales
             from me),
  mine as (select t.id from me cross join lateral flow_mine_job_ids(me.uid) as t(id) where me.uid is not null),
  o as (select o.id, o.status, o.inquiry_status, o.order_status from orders o
        where (select uid from me) is null or o.id in (select id from mine)),
  q as (select q.id, q.state, q.approval_returned_at, q.created_by, q.admin_approval_required,
               j.owner_id as job_owner, j.assignee_id as job_assignee
        from quotes q left join orders j on j.id = q.job_id
        where not q.archived and (j.id is null or j.status not in ('dokonceno', 'nerealizovano', 'zruseno'))
          and ((select uid from me) is null or q.job_id in (select id from mine)
               or (select uid from me) in (q.created_by, q.owner_id, q.approval_requested_by)))
  select
    (select count(*) from o where o.inquiry_status in ('prijata', 'v_reseni', 'ceka_na_podklady') and o.status in ('poptavka', 'naceneni'))::int,
    (select count(*) from o where o.status in ('poptavka', 'naceneni'))::int,
    (select count(*) from q where q.state = 'ke_schvaleni' and q.approval_returned_at is null)::int,
    (select count(*) from q where q.state = 'ke_schvaleni' and q.approval_returned_at is null
       and not exists (select 1 from approval_queue a where a.quote_id = q.id and a.status = 'pending'))::int,
    (select count(*) from q, viewer v where q.state = 'schvalena'
       and (v.uid is null or v.sales
            or (coalesce(q.admin_approval_required, false) and v.uid in (q.created_by, q.job_owner, q.job_assignee))))::int,
    (select count(*) from q, viewer v where q.state = 'ke_schvaleni' and q.approval_returned_at is not null
       and (v.uid is null or q.created_by = v.uid))::int,
    (select count(*) from o where o.order_status in ('dorucena', 'rozpor', 'aktualizovana')
       and o.status not in ('nerealizovano', 'zruseno', 'pozastaveno', 'reklamace'))::int
$$;

-- ── 9) Práva funkcí ─────────────────────────────────────────
do $$
begin
  revoke execute on function flow_mine_job_id_list(uuid) from public, anon;
  grant execute on function flow_mine_job_id_list(uuid) to authenticated, service_role;
  -- volá ji trigger job_files_flow_before v session (REST) → authenticated ji potřebuje
  revoke execute on function job_file_path_in_use(text) from public, anon;
  grant execute on function job_file_path_in_use(text) to authenticated, service_role;
  revoke execute on function job_file_price_ids(uuid[]) from public, anon, authenticated;
  grant execute on function job_file_price_ids(uuid[]) to service_role;
  revoke execute on function orders_approval_guard() from public, anon, authenticated;
  -- politika úložiště ji volá jako přihlášený → authenticated ji potřebuje
  revoke execute on function job_file_path_is_locked_quote(text) from public, anon;
  grant execute on function job_file_path_is_locked_quote(text) to authenticated, service_role;
  revoke execute on function orders_owner_guard() from public, anon, authenticated;
  revoke execute on function customers_owner_guard() from public, anon, authenticated;
  revoke execute on function flow_badge_counts(uuid) from public, anon;
  grant execute on function flow_badge_counts(uuid) to authenticated, service_role;
end $$;
notify pgrst, 'reload schema';
