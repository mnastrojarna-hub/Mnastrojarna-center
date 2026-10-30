-- ============================================================
-- Pošta B (feedback majitele 29. 10.): komunikace k zakázce / poptávce.
--  * nová kategorie příchozí pošty „K zakázce" (k_zakazce)
--  * přiřazení e-mailu (celého vlákna) k zakázce: kdo / jak / jistota (emails.job_link_*),
--    nejisté přiřazení = návrh „Patří k Z-…?" (email_job_suggestions)
--  * technické a obchodní změny z e-mailu (job_mail_changes): historie zakázky, pokyn zákazníka
--    nadřazený výkresu (položka), návrh štítku / poznámky; vrácení jedním ťuknutím
--  * seznam vláken: složka „K zakázkám" (mail_threads p_folder = 'jobs') + zakázka a návrh vlákna
--  * sloučení zakázek (#24): nové tabulky s job_id → přesměrování pozdních zápisů (merge_redirect_job)
--    a přesun při sloučení triggerem na orders.merged_into_id (merge_jobs se NEpředefinovává — jeho
--    poslední definici drží jiná migrace; přesun proběhne ve stejné transakci sloučení)
-- Idempotentní. Nová hodnota enumu se v této migraci nikde nepoužívá jako literál enumu (jen ::text).
-- ============================================================

-- ── 1) Kategorie „K zakázce" ──
alter type email_category add value if not exists 'k_zakazce';

-- ── 2) E-mail ↔ zakázka: jak a kdo přiřadil ──
alter table emails add column if not exists job_link_source     text;          -- thread|reply|job_number|quote_number|po_number|customer_order|drawing|company|supplier|ai|manual|created|sent
alter table emails add column if not exists job_link_confidence numeric(4,3);
alter table emails add column if not exists job_link_actor      text;          -- ai|user|system
alter table emails add column if not exists job_linked_at       timestamptz;
alter table emails add column if not exists job_linked_by       uuid references profiles(id) on delete set null;
alter table emails add column if not exists job_match_at        timestamptz;   -- párování proběhlo (dopočet je idempotentní)
alter table emails add column if not exists job_info_at         timestamptz;   -- technické informace vytěženy
alter table emails add column if not exists purchase_order_id   uuid references purchase_orders(id) on delete set null;
do $$ begin
  alter table emails add constraint emails_job_link_actor_check check (job_link_actor is null or job_link_actor in ('ai', 'user', 'system'));
exception when duplicate_object then null; end $$;
-- příloha uložená do dokumentů zakázky (jednou — opakované přiřazení / stažení ji nezdvojí)
alter table email_attachments add column if not exists job_file_id uuid references job_files(id) on delete set null;
create index if not exists idx_emails_job_match_pending on emails(received_at desc) where job_match_at is null;
create index if not exists idx_emails_po on emails(purchase_order_id) where purchase_order_id is not null;

-- ── 3) Návrhy přiřazení (nejisté) — jedno ťuknutí „Patří k Z-…?" ──
create table if not exists email_job_suggestions (
  id          uuid primary key default gen_random_uuid(),
  thread_id   text not null,
  mailbox_id  uuid,                                   -- schránka vlákna (bez FK — jako email_shares)
  email_id    uuid references emails(id) on delete cascade,
  job_id      uuid not null references orders(id) on delete cascade,
  score       numeric(4,3) not null default 0,
  reasons     jsonb not null default '[]'::jsonb,
  source      text not null default 'rules',
  status      text not null default 'pending',
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references profiles(id) on delete set null
);
do $$ begin
  alter table email_job_suggestions add constraint email_job_suggestions_status_check check (status in ('pending', 'accepted', 'rejected', 'superseded'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table email_job_suggestions add constraint email_job_suggestions_source_check check (source in ('rules', 'ai'));
exception when duplicate_object then null; end $$;
-- otázka k JEDNÉ zprávě vlákna jiné zakázky: odpověď ve vlákně zakázky thread_job_id jmenuje zakázku job_id
-- (zpráva zůstane nepřiřazená, automatika ji vláknem nepřiřadí; rozhodne člověk)
alter table email_job_suggestions add column if not exists thread_job_id uuid references orders(id) on delete set null;
create unique index if not exists uq_email_job_suggestions on email_job_suggestions(thread_id, job_id);
create index if not exists idx_email_job_suggestions_pending on email_job_suggestions(thread_id) where status = 'pending';
create index if not exists idx_email_job_suggestions_job on email_job_suggestions(job_id);
alter table email_job_suggestions enable row level security;
drop policy if exists "email_job_suggestions_select" on email_job_suggestions;
-- vidí ten, kdo vidí e-mail vlákna (RLS e-mailů platí i v poddotazu)
create policy "email_job_suggestions_select" on email_job_suggestions for select using (
  is_active_user() and exists (select 1 from emails e where e.thread_id = email_job_suggestions.thread_id));

-- ── 4) Změny a upřesnění z e-mailu k zakázce ──
create table if not exists job_mail_changes (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references orders(id) on delete cascade,
  email_id      uuid references emails(id) on delete set null,
  order_item_id uuid references order_items(id) on delete set null,
  kind          text not null default 'info',          -- change (položka) | info (jen historie) | tag | note (návrh)
  field         text not null,                         -- quantity|material|heat|surface|hardness|dimension|tolerance|marking|revision|deadline|address|packaging|price|terms|cancel|other
  summary       text not null,
  value_new     text,
  value_prev    text,
  drawing_value text,                                  -- hodnota z výkresu, kterou pokyn přebíjí
  patch         jsonb,                                 -- sloupce položky po změně
  prev          jsonb,                                 -- hodnoty před změnou (vrácení)
  quote         text,                                  -- citace z e-mailu
  party         text,                                  -- customer|supplier|other
  from_name     text,
  mail_at       timestamptz,
  sensitive     boolean not null default false,        -- nákupní cena dodavatele → jen s právem na marže
  source        text not null default 'rules',
  status        text not null default 'info',          -- applied|suggested|info|undone|dismissed|superseded
  event_id      uuid,
  created_at    timestamptz not null default now(),
  applied_at    timestamptz,
  applied_by    uuid references profiles(id) on delete set null,
  applied_kind  text,                                  -- ai|user|system
  undone_at     timestamptz,
  undone_by     uuid references profiles(id) on delete set null
);
-- proč jen návrh, i když by šla propsat: other_job = e-mail ve vlákně jmenuje i jinou zakázku (hold_job_number),
-- mismatch = „X místo Y", ale na položce není Y (value_mail_old = Y podle e-mailu)
alter table job_mail_changes add column if not exists hold_reason     text;
alter table job_mail_changes add column if not exists hold_job_number text;
alter table job_mail_changes add column if not exists value_mail_old  text;
do $$ begin
  alter table job_mail_changes add constraint job_mail_changes_kind_check check (kind in ('change', 'info', 'tag', 'note'));
exception when duplicate_object then null; end $$;
alter table job_mail_changes drop constraint if exists job_mail_changes_hold_check;
alter table job_mail_changes add constraint job_mail_changes_hold_check check (hold_reason is null or hold_reason in ('other_job', 'mismatch'));
-- superseded = starší propsaná změna téhož pole položky, kterou přebila novější (vrátit jde jen nejnovější);
-- replaced = hodnotu na položce mezitím ručně přepsal člověk (nahrazeno ruční úpravou, nic k vrácení)
alter table job_mail_changes drop constraint if exists job_mail_changes_status_check;
alter table job_mail_changes add constraint job_mail_changes_status_check
  check (status in ('applied', 'suggested', 'info', 'undone', 'dismissed', 'superseded', 'replaced'));
do $$ begin
  alter table job_mail_changes add constraint job_mail_changes_party_check check (party is null or party in ('customer', 'supplier', 'other'));
exception when duplicate_object then null; end $$;
create index if not exists idx_job_mail_changes_job on job_mail_changes(job_id, created_at desc);
create index if not exists idx_job_mail_changes_email on job_mail_changes(email_id);
create index if not exists idx_job_mail_changes_item on job_mail_changes(order_item_id) where order_item_id is not null;
-- opakované vytěžení téhož e-mailu nic nezdvojí
create unique index if not exists uq_job_mail_changes_once on job_mail_changes
  (email_id, job_id, field, coalesce(order_item_id, '00000000-0000-0000-0000-000000000000'::uuid), md5(summary))
  where email_id is not null;
alter table job_mail_changes enable row level security;
drop policy if exists "job_mail_changes_select" on job_mail_changes;
create policy "job_mail_changes_select" on job_mail_changes for select using (
  is_active_user() and (not sensitive or is_obchodnik_or_admin()));
-- zápisy jen aplikace (servisní klíč). Citace z e-mailu (quote) přes REST nikomu — vidí ji jen ten, kdo
-- smí ten e-mail (aplikace čte servisním klíčem a hlídá viditelnost pošty); ostatní sloupce dle RLS.
revoke all on job_mail_changes from anon, authenticated;
grant select (id, job_id, email_id, order_item_id, kind, field, summary, value_new, value_prev, drawing_value, patch, prev,
              party, from_name, mail_at, sensitive, source, status, event_id, created_at, applied_at, applied_by, applied_kind,
              undone_at, undone_by, hold_reason, hold_job_number, value_mail_old)
  on job_mail_changes to authenticated;

-- ── 5) Sloučení zakázek (#24): pozdní zápis → cíl; při sloučení přesun na cíl ──
do $$
declare r record;
begin
  for r in select * from (values ('job_mail_changes', 'job_id'), ('email_job_suggestions', 'job_id')) v(tbl, col) loop
    execute format('drop trigger if exists trg_000_merge_redirect on %I', r.tbl);
    execute format('create trigger trg_000_merge_redirect before insert or update of %I on %I for each row execute function merge_redirect_job(%L)',
                   r.col, r.tbl, r.col);
  end loop;
end $$;

-- merge_jobs nastaví zdroji merged_into_id (krok g) — ve stejné transakci se sem přesunou změny z e-mailů
-- a návrhy přiřazení. Položka zdroje spojená s položkou cíle zůstává u zdroje → změna přejde na položku
-- cíle se stejným číslem výkresu.
create or replace function orders_mail_merge_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.merged_into_id is null or new.merged_into_id is not distinct from old.merged_into_id or new.merged_into_id = new.id then
    return new;
  end if;
  update job_mail_changes c set
    job_id = new.merged_into_id,
    order_item_id = case
      when c.order_item_id is null then null
      when exists (select 1 from order_items i where i.id = c.order_item_id and i.order_id = new.merged_into_id) then c.order_item_id
      else (select t.id from order_items si join order_items t on t.order_id = new.merged_into_id
              and drawing_norm(t.drawing_number) is not null and drawing_norm(t.drawing_number) = drawing_norm(si.drawing_number)
            where si.id = c.order_item_id order by t.position, t.created_at limit 1)
    end
  where c.job_id = new.id;
  delete from email_job_suggestions s
   where s.job_id = new.id
     and exists (select 1 from email_job_suggestions x where x.thread_id = s.thread_id and x.job_id = new.merged_into_id);
  update email_job_suggestions set job_id = new.merged_into_id where job_id = new.id;
  -- otázka „patří ke zprávě jiné zakázky?": po sloučení obou do jedné zakázky už není co řešit
  update email_job_suggestions set thread_job_id = new.merged_into_id where thread_job_id = new.id;
  update email_job_suggestions set status = 'superseded', resolved_at = now()
   where status = 'pending' and thread_job_id is not null and thread_job_id = job_id;
  return new;
end $$;
drop trigger if exists trg_orders_mail_merge on orders;
create trigger trg_orders_mail_merge after update of merged_into_id on orders
  for each row execute function orders_mail_merge_move();

-- ── 6) Režimy automatiky + limit AI ──
insert into automation_settings (module, mode) values
  ('mail_job_link', 'full'),      -- jisté přiřazení e-mailu k zakázce hned (nejisté = návrh)
  ('mail_job_changes', 'full')    -- pokyn zákazníka z e-mailu do položky hned (viditelně, vrátit jedním ťuknutím)
on conflict (module) do nothing;
insert into integration_settings (key, value, is_secret, category, label) values
  ('mail_job_ai_max_per_run', '15', false, 'email', 'Pošta: max. e-mailů k zakázce, které při jednom stažení čte AI (přiřazení + technické informace)')
on conflict (key) do nothing;

-- ── 7) Seznam vláken: složka „K zakázkám", zakázka a návrh vlákna ──
drop function if exists mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category);
create or replace function mail_threads(
  p_user uuid,
  p_all boolean,
  p_owned uuid[],
  p_folder text default 'inbox',
  p_mailbox uuid default null,
  p_no_mailbox boolean default false,
  p_words text[] default null,
  p_priority_max int default null,
  p_unread_only boolean default false,
  p_sort text default 'date',
  p_limit int default 50,
  p_offset int default 0,
  p_category email_category default null
) returns table (
  thread_id text, email_id uuid, mailbox_id uuid, direction text, from_name text, from_email text, to_email text,
  subject text, snippet text, category email_category, priority priority_level, ai_confidence numeric, ai_summary text,
  received_at timestamptz, order_id uuid, job_number text, customer_name text, mailbox_email text, has_draft boolean,
  message_count int, unread_count int, flagged boolean, priority_rank int, manual_priority boolean,
  has_attachments boolean, ai_pending boolean, last_at timestamptz, share_note text, share_by_name text,
  share_unread boolean, total_count bigint,
  job_title text, job_link_source text, job_link_actor text,
  sugg_id uuid, sugg_job_id uuid, sugg_job_number text, sugg_job_title text, sugg_score numeric,
  -- zpráva otázky „Patří k …?" (u ní do rozhodnutí neutrální kategorie „K zakázce?")
  sugg_email_id uuid
) language sql stable set search_path = public as $$
  with vis as (
    select e.*, (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))) as own from emails e
    where (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))
           or exists (select 1 from email_shares s where s.shared_with = p_user and s.thread_id = e.thread_id
                      and s.mailbox_id is not distinct from e.mailbox_id))
      and (p_mailbox is null or e.mailbox_id = p_mailbox)
      and (not coalesce(p_no_mailbox, false) or e.mailbox_id is null)
  ),
  sh as (
    select distinct on (s.thread_id) s.thread_id, s.note, s.read_at, s.shared_by
    from email_shares s where s.shared_with = p_user
    order by s.thread_id, s.created_at desc
  ),
  t as (
    select v.thread_id as tid,
      count(*)::int as n,
      count(*) filter (where v.own and v.direction = 'in' and not v.is_read and not v.is_spam)::int as unread,
      bool_or(v.flagged) as flagged,
      min(v.priority_rank) filter (where v.direction = 'in' or v.manual_priority is not null)::int as prank,
      bool_or(v.manual_priority is not null) as manual,
      bool_or(v.has_attachments) as att,
      bool_or(v.ai_pending) as aip,
      max(v.received_at) as last_at,
      max(v.received_at) filter (where v.direction = 'out') as last_out,
      bool_or(v.direction = 'in' and not v.is_spam) as has_in,
      bool_or(v.direction = 'out') as has_out,
      bool_and(v.is_spam) as all_spam,
      -- zakázka vlákna = poslední přiřazená zpráva (přiřazení platí pro celé vlákno)
      (array_agg(v.order_id order by v.received_at desc) filter (where v.order_id is not null))[1] as job_id,
      (array_agg(v.job_link_source order by v.received_at desc) filter (where v.order_id is not null))[1] as link_source,
      (array_agg(v.job_link_actor order by v.received_at desc) filter (where v.order_id is not null))[1] as link_actor,
      bool_or(v.direction = 'in' and v.category::text = 'k_zakazce') as has_kz,
      bool_or(p_category is null or (v.direction = 'in' and v.category = p_category)) as cat_hit,
      bool_or(p_words is null or cardinality(p_words) = 0 or not exists (
        select 1 from unnest(p_words) w
        where (coalesce(v.subject, '') || ' ' || coalesce(v.from_name, '') || ' ' || coalesce(v.from_email, '') || ' '
               || coalesce(v.to_email, '') || ' ' || coalesce(v.cc_email, '') || ' ' || coalesce(v.body_text, '')) not ilike '%' || w || '%')) as hit
    from vis v group by v.thread_id
  ),
  -- návrh vlákna bez zakázky, nebo otázka k jedné zprávě vlákna jiné zakázky (odpověď jmenuje jinou zakázku)
  sg as (
    select distinct on (s.thread_id) s.thread_id, s.id, s.job_id, s.score, s.email_id
    from email_job_suggestions s join t on t.tid = s.thread_id
    where s.status = 'pending'
      and (t.job_id is null or (s.thread_job_id is not null and s.job_id <> t.job_id))
    order by s.thread_id, s.score desc, s.created_at desc
  ),
  f as (
    select t.*, sh.note as share_note, sh.read_at as share_read_at, sh.shared_by, (sh.thread_id is not null) as shared,
      sg.id as sugg_id, sg.job_id as sugg_job_id, sg.score as sugg_score, sg.email_id as sugg_email_id
    from t left join sh on sh.thread_id = t.tid
    left join sg on sg.thread_id = t.tid
    where t.hit
      and case coalesce(p_folder, 'inbox')
        when 'inbox' then (t.has_in or sh.thread_id is not null) and not t.all_spam
        when 'sent' then t.has_out
        when 'flagged' then t.flagged and not t.all_spam
        when 'spam' then t.all_spam
        when 'shared' then sh.thread_id is not null
        -- jen vlákna s příchozí poštou (ne naše odeslané nabídky / objednávky bez odpovědi)
        when 'jobs' then (t.job_id is not null or t.has_kz or (sg.id is not null and t.job_id is null)) and not t.all_spam
                         and (t.has_in or sh.thread_id is not null)
        else not t.all_spam end
      and t.cat_hit
      and (p_priority_max is null or coalesce(t.prank, 3) <= p_priority_max)
      and (not coalesce(p_unread_only, false) or t.unread > 0 or (sh.thread_id is not null and sh.read_at is null))
  ),
  pick as (
    select distinct on (v.thread_id) v.*
    from vis v join f on f.tid = v.thread_id
    order by v.thread_id,
      case when coalesce(p_folder, 'inbox') = 'sent' and v.direction = 'out' then 0
           when coalesce(p_folder, 'inbox') in ('inbox', 'spam', 'shared', 'flagged', 'jobs') and v.direction = 'in' then 0
           else 1 end,
      v.received_at desc
  )
  select f.tid, p.id, p.mailbox_id, p.direction, p.from_name, p.from_email, p.to_email, p.subject, p.snippet,
    p.category, p.priority, p.ai_confidence, p.ai_summary, p.received_at, f.job_id, o.number, c.name, m.email,
    p.has_draft, f.n, f.unread, f.flagged, coalesce(f.prank, 3), f.manual, f.att, f.aip,
    case when coalesce(p_folder, 'inbox') = 'sent' then coalesce(f.last_out, f.last_at) else f.last_at end,
    f.share_note, coalesce(nullif(btrim(pr.full_name), ''), pr.email), (f.shared and f.share_read_at is null),
    count(*) over (),
    o.title, f.link_source, f.link_actor,
    case when f.sugg_job_id is not null then f.sugg_id end, f.sugg_job_id, so.number, so.title, case when f.sugg_job_id is not null then f.sugg_score end,
    case when f.sugg_job_id is not null then f.sugg_email_id end
  from f
  join pick p on p.thread_id = f.tid
  left join orders o on o.id = f.job_id
  left join orders so on so.id = f.sugg_job_id
  left join customers c on c.id = p.customer_id
  left join mailboxes m on m.id = p.mailbox_id
  left join profiles pr on pr.id = f.shared_by
  order by
    -- „K zakázkám": vlákna jedné zakázky pohromadě (zakázka s nejčerstvější poštou nahoře), návrhy a
    -- nepřiřazené mezi nimi podle času
    case when coalesce(p_folder, 'inbox') = 'jobs'
      then max(f.last_at) over (partition by coalesce(f.job_id::text, 't:' || f.tid)) end desc nulls last,
    case when coalesce(p_folder, 'inbox') = 'jobs' then coalesce(f.job_id::text, 't:' || f.tid) end,
    case when p_sort = 'priority' then coalesce(f.prank, 3) end asc nulls last,
    case when p_sort = 'flag' then (case when f.flagged then 0 else 1 end) end asc nulls last,
    case when p_sort = 'unread' then (case when f.unread > 0 then 0 else 1 end) end asc nulls last,
    case when coalesce(p_folder, 'inbox') = 'sent' then coalesce(f.last_out, f.last_at) else f.last_at end desc,
    f.tid
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
$$;

-- Počty do složek (+ vlákna k zakázkám s nepřečtenou poštou, návrhy přiřazení)
drop function if exists mail_folder_counts(uuid, boolean, uuid[], uuid, boolean);
create or replace function mail_folder_counts(
  p_user uuid, p_all boolean, p_owned uuid[], p_mailbox uuid default null, p_no_mailbox boolean default false
) returns table (inbox_unread int, flagged int, spam int, shared int, shared_unread int, ai_pending int, jobs_unread int, job_suggestions int)
language sql stable set search_path = public as $$
  with vis as (
    select e.thread_id, e.direction, e.is_read, e.is_spam, e.flagged, e.ai_pending, e.order_id, e.category,
      (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))) as own from emails e
    where (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))
           or exists (select 1 from email_shares s where s.shared_with = p_user and s.thread_id = e.thread_id
                      and s.mailbox_id is not distinct from e.mailbox_id))
      and (p_mailbox is null or e.mailbox_id = p_mailbox)
      and (not coalesce(p_no_mailbox, false) or e.mailbox_id is null)
  ),
  t as (
    select v.thread_id, bool_or(v.own and v.direction = 'in' and not v.is_read and not v.is_spam) as unread,
      bool_or(v.flagged) as flagged, bool_and(v.is_spam) as spam, bool_or(v.ai_pending) as aip,
      bool_or(v.order_id is not null or (v.direction = 'in' and v.category::text = 'k_zakazce')) as job
    from vis v group by v.thread_id
  ),
  sh as (select s.thread_id, bool_or(s.read_at is null) as unread from email_shares s where s.shared_with = p_user group by s.thread_id),
  sg as (select s.thread_id, s.job_id, s.thread_job_id from email_job_suggestions s where s.status = 'pending')
  select
    (select count(*) from t left join sh on sh.thread_id = t.thread_id where (t.unread or coalesce(sh.unread, false)) and not t.spam)::int,
    (select count(*) from t where t.flagged and not t.spam)::int,
    (select count(*) from t where t.spam)::int,
    (select count(*) from sh)::int,
    (select count(*) from sh where sh.unread)::int,
    (select count(*) from t where t.aip and not t.spam)::int,
    (select count(*) from t where t.job and t.unread and not t.spam)::int,
    -- vlákna bez zakázky s návrhem + vlákna s otázkou k jedné zprávě („patří k jiné zakázce?")
    (select count(distinct t.thread_id) from t join sg on sg.thread_id = t.thread_id where not t.spam
       and (not exists (select 1 from vis v where v.thread_id = t.thread_id and v.order_id is not null)
            or (sg.thread_job_id is not null
                and not exists (select 1 from vis v where v.thread_id = t.thread_id and v.order_id = sg.job_id))))::int
$$;

do $$ begin
  revoke execute on function mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) from public, anon, authenticated;
  grant execute on function mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) to service_role;
  revoke execute on function mail_folder_counts(uuid, boolean, uuid[], uuid, boolean) from public, anon, authenticated;
  grant execute on function mail_folder_counts(uuid, boolean, uuid[], uuid, boolean) to service_role;
  revoke execute on function orders_mail_merge_move() from public, anon, authenticated;
end $$;

-- Sloučená zakázka → ta, která zůstala (řetěz A→B→C, max. 5 kroků jako merge_redirect_job)
create or replace function mail_job_final(p uuid) returns uuid
language plpgsql stable set search_path = public as $$
declare
  v_id uuid := p;
  v_next uuid;
  v_hops int := 0;
begin
  loop
    select merged_into_id into v_next from orders where id = v_id;
    exit when v_next is null or v_next = p or v_hops >= 5;
    v_id := v_next; v_hops := v_hops + 1;
  end loop;
  return v_id;
end $$;

-- ── 8) Kandidáti zakázky pro e-mail (signály párování; rozhoduje aplikace — src/lib/email/job-match.ts) ──
-- p_numbers = naše čísla z textu (Z-…, NAB-…, OV-…, velkými písmeny), p_norms = normalizované tokeny
-- (drawing_norm) pro číslo objednávky zákazníka a čísla výkresů, p_msg_ids = In-Reply-To + References.
-- Vlákno: „thread" jen když e-mail nese hlavičky odpovědi (vlákno spojené hlavičkami); vlákno spojené
-- jen předmětem („Poptávka" = „Re: Poptávka") je slabé „thread_subject". open = zakázka není uzavřená
-- (dokončeno, zrušeno, nerealizováno, fakturováno) ani sloučená. supplier_id = dodavatel naší objednávky.
-- Výrazové indexy pro párování (každý stažený e-mail = jedno volání; bez nich plné průchody tabulek)
create index if not exists idx_order_items_drawing_norm on order_items (drawing_norm(drawing_number));
create index if not exists idx_orders_customer_order_norm on orders (drawing_norm(customer_order_number));
create index if not exists idx_orders_number_upper on orders (upper(number));
create index if not exists idx_quotes_number_base on quotes (upper(regexp_replace(number, '-R\d+$', '', 'i')));
create index if not exists idx_po_number_upper on purchase_orders (upper(number));
-- otevřené zakázky firmy odesílatele (signál company)
create index if not exists idx_orders_customer_open on orders (customer_id, updated_at desc) where merged_into_id is null;
drop function if exists mail_job_candidates(uuid, text, text[], text[], text[], uuid, uuid);
create or replace function mail_job_candidates(
  p_email uuid,
  p_thread text,
  p_msg_ids text[],
  p_numbers text[],
  p_norms text[],
  p_customer uuid,
  p_supplier uuid
) returns table (job_id uuid, number text, title text, status job_stage, customer_id uuid, signal text, detail text, open boolean, supplier_id uuid,
                 rejected boolean)
language sql stable set search_path = public as $$
  -- Message-ID s i bez „<>" (uloženo bývá s nimi) — jedno „= any" přes idx_emails_message_id místo btrim()
  with ids as (
    select coalesce(array_agg(distinct v), '{}'::text[]) as a
    from unnest(coalesce(p_msg_ids, '{}'::text[])) x(m)
    cross join lateral (values (m), (btrim(m, '<>')), ('<' || btrim(m, '<>') || '>')) t(v)
    where btrim(m, '<>') <> ''
  ),
  raw as (
    -- vlákno: jiná zpráva téhož vlákna je přiřazená (silné jen se spojením hlavičkami)
    select e.order_id as jid,
      (case when cardinality(coalesce(p_msg_ids, '{}')) > 0 then 'thread' else 'thread_subject' end)::text as signal,
      coalesce(e.subject, '') as detail, null::uuid as sup
      from emails e where p_thread is not null and e.thread_id = p_thread and e.order_id is not null and e.id <> p_email
    union all
    -- odpověď na naši / přiřazenou zprávu (i z jiné schránky — nabídka odeslaná z firemní)
    select e.order_id, 'reply', coalesce(e.subject, ''), null::uuid
      from emails e where cardinality(coalesce(p_msg_ids, '{}')) > 0 and e.order_id is not null and e.id <> p_email
       and e.message_id = any((select a from ids)::text[])
    union all
    -- čísla a tokeny: výrazové indexy idx_orders_number_upper, idx_quotes_number_base, idx_po_number_upper,
    -- idx_orders_customer_order_norm, idx_order_items_drawing_norm (níže)
    select o.id, 'job_number', o.number, null::uuid from orders o where upper(o.number) = any(coalesce(p_numbers, '{}'))
    union all
    -- p_numbers jsou vždy bez revize (NAB-2026-031) → stačí číslo nabídky bez „-R2"
    select q.job_id, 'quote_number', q.number, null::uuid from quotes q
     where q.job_id is not null and upper(regexp_replace(q.number, '-R\d+$', '', 'i')) = any(coalesce(p_numbers, '{}'))
    union all
    select po.job_id, 'po_number', po.number, po.supplier_id from purchase_orders po
     where po.job_id is not null and upper(po.number) = any(coalesce(p_numbers, '{}'))
    union all
    select o.id, 'customer_order', o.customer_order_number, null::uuid from orders o
     where o.customer_order_number is not null and drawing_norm(o.customer_order_number) = any(coalesce(p_norms, '{}'))
       and length(drawing_norm(o.customer_order_number)) >= 4
    union all
    select i.order_id, 'drawing', i.drawing_number, null::uuid from order_items i
     where i.drawing_number is not null and drawing_norm(i.drawing_number) = any(coalesce(p_norms, '{}'))
       and length(drawing_norm(i.drawing_number)) >= 4
    union all
    -- firma odesílatele: otevřené zakázky zákazníka (max. 8)
    (select o.id, 'company', o.number, null::uuid from orders o
      where p_customer is not null and o.customer_id = p_customer and o.merged_into_id is null
        and o.status not in ('dokonceno', 'zruseno', 'nerealizovano', 'fakturovano')
      order by o.updated_at desc nulls last limit 8)
    union all
    -- dodavatel: zakázky s naší otevřenou objednávkou u něj (max. 8)
    (select po.job_id, 'supplier', po.number, po.supplier_id from purchase_orders po join orders o on o.id = po.job_id
      where p_supplier is not null and po.supplier_id = p_supplier and po.status not in ('zrusena', 'dodana')
        and o.merged_into_id is null and o.status not in ('dokonceno', 'zruseno', 'nerealizovano', 'fakturovano')
      order by po.created_at desc limit 8)
  ),
  -- sloučená zakázka → ta, která zůstala
  res as (
    select r.signal, r.detail, r.sup, mail_job_final(r.jid) as jid
    from raw r where r.jid is not null
  )
  -- rejected = u vlákna už někdo řekl „Ne, nepatří" (aplikace ji nepřiřadí ani nenavrhne, ale zmínka
  -- v nové zprávě pořád brzdí automatické změny na zakázce vlákna)
  -- jeden řádek na zakázku, signál a HODNOTU (dvě nabídky / OV / výkresy jedné zakázky = dva řádky — konflikt
  -- s vláknem musí najít tu, kterou zpráva jmenuje; u vlákna = dřívější předměty); skóre bere nejsilnější
  select distinct on (o.id, res.signal, coalesce(drawing_norm(res.detail), ''))
    o.id, o.number, o.title, o.status, o.customer_id, res.signal, left(res.detail, 200),
    (o.status not in ('dokonceno', 'zruseno', 'nerealizovano', 'fakturovano') and o.merged_into_id is null), res.sup,
    exists (select 1 from email_job_suggestions s where s.thread_id = p_thread and s.job_id = o.id and s.status = 'rejected')
  from res join orders o on o.id = res.jid
  order by o.id, res.signal, coalesce(drawing_norm(res.detail), '')
$$;
do $$ begin
  revoke execute on function mail_job_candidates(uuid, text, text[], text[], text[], uuid, uuid) from public, anon, authenticated;
  grant execute on function mail_job_candidates(uuid, text, text[], text[], text[], uuid, uuid) to service_role;
  revoke execute on function mail_job_final(uuid) from public, anon, authenticated;
  grant execute on function mail_job_final(uuid) to service_role;
end $$;

notify pgrst, 'reload schema';
