-- ═══════════════════════════════════════════════════════════════════════════
--  Fronta ke schválení a nákupní ceny / marže bez super admina (9. 11.) — majitel: Dominik Šponer (zaměstnanec,
--  technolog) má sám vyřizovat frontu ke schválení (odchozí e-maily, objednávky dodavatelům v režimu „se schválením",
--  návrhy stavu zakázky z pošty…), poptávat dodavatele, vidět nákupní ceny a marže a vyfakturovat / dokončit zakázku.
--  Provize ostatních, nastavení, uživatele, mazání, poštu ostatních, Nacenění ani obchodní tok všech NE (proto ne
--  „Plný přístup").
--
--  1) profiles.can_resolve_queue (výchozí false) — „Smí řešit frontu ke schválení": stránka Fronta ke schválení
--     (/approvals), schválit / upravit / zamítnout položku. AI návrh nabídky (typ quote) dál schvaluje jen super admin,
--     rozdělení faktury dodavatele (supplier_invoice) jen s přístupem k fakturám dodavatelů. Super admin smí vždy.
--     Rozhoduje aplikace (src/lib/auth/permissions.ts funkce „approval_queue" + src/lib/auth/approval-queue-access.ts);
--     aplikace čte a zapisuje frontu servisním klíčem s autorem — RLS fronty (REST) se NEMĚNÍ (zůstává přísnější).
--  2) profiles.can_see_margins (výchozí false) — „Vidí nákupní ceny a marže" (zaměstnanec; obchodník a super admin
--     vždy) → v aplikaci funkce „margins" se vším, co k ní patří (nákupní ceny, marže, nákupní doklady, objednávky
--     dodavatelům, faktura a úhrady, rozhodnutí konce toku). Provize ostatních tím NEvidí.
--  3) profiles_guard: oba příznaky mění jen super admin (nikdo si je nezapne sám).
--  4) DB pojistky, které jsou zrcadlem práva „margins" (rozhodnutí konce toku a odeslání nabídky), berou nový příznak:
--       app_actor_may_decide()  — „= právo margins v aplikaci" (pojistky orders_stage_change, quotes_flow_before,
--                                 flow_reject_quote, production_apply);
--       flow_badge_counts()     — viewer.sales = smí odeslat schválenou nabídku (TS dvojče quoteSendBlock → margins).
--     NEMĚNÍ se: vlastnictví obchodního toku (flow_mine_job_ids, obchodník zakázky / zákazníka, slučování zakázek),
--     vrácení předání do výroby (kdo ho udělal / obchodník), is_obchodnik_or_admin() (sdílená role pro řadu politik),
--     faktury dodavatelů (supplier_invoices_readable), Nacenění (materials, machine_rates, pricing_calculations).
--  5) REST (session): nová funkce is_margins_viewer() a doplňkové (permissive) SELECT politiky „margins_viewer_select"
--     na tabulkách s nákupními cenami — objednávky dodavatelům (+ položky), nabídky dodavatelů (+ položky), úhrady,
--     cenové doklady zakázky (job_files + úložiště job-files mimo capture/, zámek neschválené nabídky platí dál) a
--     citlivé změny z pošty. Jen čtení; zápisové politiky beze změny.
--  6) Jednorázově (značka sponer_queue_margins_v1): Šponer → can_resolve_queue, can_see_margins, can_rfq,
--     can_change_stage = true (shoda jména / e-mailu jako 20261109100000, jen když je právě jeden; jinak NOTICE a
--     nastaví se ve Správě uživatelů).
--
-- POZOR — PŘEDEFINOVANÉ FUNKCE:
--   profiles_guard()       — poslední definice 20261109100000_zmena_stavu_opravneni.sql (zrcadlo + 2 sloupce).
--   app_actor_may_decide() — poslední definice 20261023100000_podrobne_stavy_atribuce.sql (zrcadlo + příznak).
--   flow_badge_counts()    — poslední definice 20261023157000_role_viditelnost_moje.sql (zrcadlo; jediná změna viewer.sales).
--   Další změny dělej od těchto těl.
-- Idempotentní: druhé spuštění nic nezmění.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1+2) Příznaky uživatele ─────────────────────────────────
alter table profiles add column if not exists can_resolve_queue boolean not null default false;
comment on column profiles.can_resolve_queue is
  'Smí řešit frontu ke schválení (schválit / upravit / zamítnout; AI návrh nabídky dál jen super admin) — obchodník nebo zaměstnanec; super admin vždy. Mění jen super admin.';
alter table profiles add column if not exists can_see_margins boolean not null default false;
comment on column profiles.can_see_margins is
  'Vidí nákupní ceny a marže (právo „margins" — nákupní doklady, objednávky dodavatelům, faktura a úhrady) — zaměstnanec; obchodník a super admin vždy. Provize ostatních ne. Mění jen super admin.';

-- ── 3) Ochrana: oprávnění mění jen super admin ───────────────
-- Zrcadlo 20261109100000 (profiles_guard), změna: + can_resolve_queue, can_see_margins (9. 11.).
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
       or new.can_change_stage is distinct from old.can_change_stage
       -- 9. 11.: fronta ke schválení a nákupní ceny / marže
       or new.can_resolve_queue is distinct from old.can_resolve_queue
       or new.can_see_margins is distinct from old.can_see_margins then
      raise exception 'Změnu role a oprávnění smí provést jen super admin.';
    end if;
  end if;
  return new;
end $$;

-- ── 4a) Rozhodnutí konce toku = právo „margins" ─────────────
-- Zrcadlo 20261023100000 (app_actor_may_decide), změna 9. 11.: i zaměstnanec s „Vidí nákupní ceny a marže"
-- (aplikace mu dává „margins" → stejná tlačítka; bez toho by DB jeho rozhodnutí odmítla).
/** Smí autor rozhodnout konec toku (odmítnutí, storno, zamítnutí, schválení, odeslání nabídky)?
 *  = právo „margins" v aplikaci (obchodník, super admin; 9. 11. i profiles.can_see_margins). Bez autora (systém, psql) ano. */
create or replace function app_actor_may_decide() returns boolean
language sql stable security definer set search_path = public as $$
  select case when app_actor() is null then true
    else coalesce((select p.role in ('super_admin', 'obchodnik') or coalesce(p.can_see_margins, false)   -- 9. 11.
                   from profiles p where p.id = app_actor()), false) end
$$;

-- ── 4b) Odznak „Nabídky": schválené k odeslání ──────────────
-- Zrcadlo 20261023157000 (flow_badge_counts), jediná změna 9. 11.: viewer.sales i s can_see_margins (smí odeslat
-- schválenou nabídku jako obchodník — TS dvojče src/lib/jobs/flow-status.ts quoteSendBlock → margins).
create or replace function flow_badge_counts(p_mine uuid default null)
returns table (inquiries int, pricing int, quotes_pending int, quotes_pending_manual int,
               quotes_ready int, quotes_returned int, confirmations int)
language sql stable set search_path = public as $$
  with me as (select case when p_mine is null then null::uuid else coalesce(auth.uid(), p_mine) end as uid),
  viewer as (select me.uid,
                    coalesce((select p.role in ('super_admin', 'obchodnik') or coalesce(p.can_see_margins, false)   -- 9. 11.
                              from profiles p where p.id = me.uid), false) as sales
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
revoke execute on function flow_badge_counts(uuid) from public, anon;
grant execute on function flow_badge_counts(uuid) to authenticated, service_role;

-- ── 5) REST: čtení nákupních cen s příznakem ────────────────
/** Přihlášený (REST) smí vidět nákupní ceny a marže: aktivní obchodník / super admin, nebo „Vidí nákupní ceny a
 *  marže" (9. 11.). Dvojče práva „margins" v src/lib/auth/permissions.ts. */
create or replace function is_margins_viewer()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.active and (p.role in ('super_admin', 'obchodnik') or coalesce(p.can_see_margins, false))
                   from profiles p where p.id = auth.uid()), false)
$$;

-- doplňkové SELECT politiky (permissive = NEBO k dosavadním; obchodník a super admin je mají už dnes)
drop policy if exists "margins_viewer_select" on purchase_orders;
create policy "margins_viewer_select" on purchase_orders for select using (is_margins_viewer());
drop policy if exists "margins_viewer_select" on purchase_order_items;
create policy "margins_viewer_select" on purchase_order_items for select using (is_margins_viewer());
drop policy if exists "margins_viewer_select" on supplier_quotes;
create policy "margins_viewer_select" on supplier_quotes for select using (is_margins_viewer());
drop policy if exists "margins_viewer_select" on supplier_quote_items;
create policy "margins_viewer_select" on supplier_quote_items for select using (is_margins_viewer());
drop policy if exists "margins_viewer_select" on job_payments;
create policy "margins_viewer_select" on job_payments for select using (is_margins_viewer());
-- cenové doklady zakázky (job_files_select: is_obchodnik_or_admin() OR není cenový doklad)
drop policy if exists "margins_viewer_select" on job_files;
create policy "margins_viewer_select" on job_files for select using (is_active_user() and is_margins_viewer());
-- citlivé změny z pošty (job_mail_changes_select: not sensitive OR is_obchodnik_or_admin())
drop policy if exists "margins_viewer_select" on job_mail_changes;
create policy "margins_viewer_select" on job_mail_changes for select using (is_active_user() and is_margins_viewer());
-- úložiště: cenové doklady mimo capture/ (zámek neschválené / zastaralé nabídky platí dál — jako job_files_bucket_read)
drop policy if exists "job_files_bucket_read_margins" on storage.objects;
create policy "job_files_bucket_read_margins" on storage.objects for select using (
  bucket_id = 'job-files' and auth.role() = 'authenticated'
  and public.is_active_user()
  and coalesce((storage.foldername(name))[1], '') <> 'capture'
  and public.is_margins_viewer()
  and not public.job_file_path_is_locked_quote(name));

-- ── 6) Šponer (jednorázově) ─────────────────────────────────
do $$
declare
  v_new  boolean;
  v_ids  uuid[];
  v_rows text;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('sponer_queue_margins_v1', 'ai_access', 'Šponer — fronta ke schválení, nákupní ceny a marže, poptávky, stav zakázky (9. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Šponer (fronta, marže): výchozí nastavení už proběhlo dřív — beze změny.';
    return;
  end if;
  select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
    into v_ids, v_rows
    from profiles p
   where p.full_name ilike '%šponer%' or p.full_name ilike '%sponer%' or p.email ilike '%sponer%';
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    update profiles
       set can_resolve_queue = true, can_see_margins = true, can_rfq = true, can_change_stage = true
     where id = v_ids[1]
       and not (can_resolve_queue and can_see_margins and can_rfq and can_change_stage);
    raise notice 'Šponer (fronta, marže): % — řeší frontu ke schválení, vidí nákupní ceny a marže, poptává dodavatele, mění stav zakázky.', v_rows;
  else
    raise notice 'Šponer (fronta, marže): Šponera nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, nastav ve Správě uživatelů.',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
  end if;
end $$;

notify pgrst, 'reload schema';
