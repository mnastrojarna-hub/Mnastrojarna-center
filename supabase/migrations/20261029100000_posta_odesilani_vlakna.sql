-- ============================================================
-- Pošta A (feedback majitele 29. 10.): odesílání, vlákna, vlaječka + priorita 1–5,
-- „Předat kolegovi", podpis, stažení celé schránky (kurzor, Odeslané na serveru), AI později.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

-- ── 1) E-maily: vlákna, složka/UID na serveru, vlaječka, priorita, AI později, kopie v Odeslaných ──
alter table emails add column if not exists in_reply_to text;
alter table emails add column if not exists message_refs text[];
alter table emails add column if not exists subject_key text;
alter table emails add column if not exists bcc_email text;
alter table emails add column if not exists imap_folder text;
alter table emails add column if not exists imap_uid bigint;
alter table emails add column if not exists flagged boolean not null default false;
alter table emails add column if not exists flagged_by uuid references profiles(id) on delete set null;
alter table emails add column if not exists flagged_at timestamptz;
alter table emails add column if not exists manual_priority smallint;
alter table emails add column if not exists priority_set_by uuid references profiles(id) on delete set null;
alter table emails add column if not exists priority_set_at timestamptz;
alter table emails add column if not exists ai_pending boolean not null default false;
alter table emails add column if not exists has_attachments boolean not null default false;
alter table emails add column if not exists sent_copy text;
alter table emails add column if not exists sent_copy_error text;
-- UIDVALIDITY složky v okamžiku stažení: příloha ze serveru jen ze STEJNÉ zprávy (UID platí jen s ní)
alter table emails add column if not exists imap_uidvalidity text;
-- Schránka, ze které e-mail zůstal po „Odpojit" (mailbox_id → null); opětovné připojení ho vrátí
alter table emails add column if not exists detached_mailbox_id uuid;

do $$ begin
  alter table emails add constraint emails_manual_priority_check check (manual_priority between 1 and 5);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table emails add constraint emails_sent_copy_check check (sent_copy in ('ok', 'failed', 'skipped'));
exception when duplicate_object then null; end $$;

-- Účinná priorita 1 (nejvyšší) – 5: ruční přednostně, jinak z AI (vysoká 2, střední 3, nízká 4)
do $$ begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'emails' and column_name = 'priority_rank') then
    alter table emails add column priority_rank smallint generated always as (
      coalesce(manual_priority, case priority when 'vysoka' then 2 when 'nizka' then 4 else 3 end)
    ) stored;
  end if;
end $$;

alter table email_attachments add column if not exists imap_part text;
alter table profiles add column if not exists mail_signature text;
alter table mailbox_status add column if not exists last_sync_total integer;

-- ── 2) Normalizace předmětu (TS dvojče: src/lib/email/threading.ts) ──
create or replace function mail_subject_norm(p text) returns text
language sql immutable set search_path = public as $$
  select lower(btrim(regexp_replace(
    regexp_replace(coalesce(p, ''), '^\s*((re|odp|aw|fw|fwd|wg|tr|sv|vs)\s*(\[\d+\])?\s*:\s*)+', '', 'i'),
    '\s+', ' ', 'g')))
$$;

create or replace function mail_subject_is_reply(p text) returns boolean
language sql immutable set search_path = public as $$
  select coalesce(p, '') ~* '^\s*(re|odp|aw|fw|fwd|wg|tr|sv|vs)\s*(\[\d+\])?\s*:'
$$;

create or replace function mail_first_address(p text) returns text
language sql immutable set search_path = public as $$
  select lower(substring(coalesce(p, '') from '[^\s<>",;]+@[^\s<>",;]+'))
$$;

-- ── 3) Vlákno při vložení e-mailu (všechny cesty: stahování, odeslání, import, testy) ──
-- 1. In-Reply-To / References → vlákno odkazované zprávy (stejná schránka)
-- 2. starší zpráva přišla později než odpověď (stahování od nejnovější) → vlákno odpovědi, která na ni odkazuje
-- 3. odpověď bez hlaviček („Re:" …) → stejný předmět + protistrana; původní zpráva → existující odpověď
-- 4. jinak nové vlákno 'm:<schránka>:<Message-ID>' — VŽDY v rámci schránky (stejná zpráva doručená do
--    dvou schránek = dvě vlákna; předání kolegovi tak nikdy neotevře cizí osobní schránku)
-- ruční priorita vlákna se dědí na nové zprávy
create or replace function emails_thread_assign()
returns trigger language plpgsql set search_path = public as $$
declare
  v_tid text;
  v_refs text[];
  v_norm text;
begin
  v_norm := mail_subject_norm(new.subject);
  new.subject_key := v_norm || '|' || coalesce(mail_first_address(case when new.direction = 'out' then new.to_email else new.from_email end), '');
  if new.thread_id is null then
    v_refs := array_remove(coalesce(new.message_refs, '{}'::text[]) || new.in_reply_to, null);
    if cardinality(v_refs) > 0 then
      v_refs := v_refs || array(select btrim(r, '<>') from unnest(v_refs) r);
      select e.thread_id into v_tid from emails e
       where e.message_id = any(v_refs) and e.thread_id is not null
         and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
       order by e.received_at desc limit 1;
    end if;
    if v_tid is null and nullif(new.message_id, '') is not null then
      select e.thread_id into v_tid from emails e
       where (e.in_reply_to = new.message_id or e.message_refs @> array[new.message_id]) and e.thread_id is not null
         and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
       order by e.received_at asc limit 1;
    end if;
    if v_tid is null and v_norm <> '' then
      select e.thread_id into v_tid from emails e
       where e.subject_key = new.subject_key and e.thread_id is not null
         and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
         and (mail_subject_is_reply(new.subject) or mail_subject_is_reply(e.subject))
       order by e.received_at desc limit 1;
    end if;
    new.thread_id := coalesce(v_tid, 'm:' || coalesce(new.mailbox_id::text, '-') || ':' || coalesce(nullif(new.message_id, ''), new.id::text));
  end if;
  if new.manual_priority is null and v_tid is not null then
    select e.manual_priority into new.manual_priority from emails e
     where e.thread_id = v_tid and e.manual_priority is not null
     order by e.priority_set_at desc nulls last limit 1;
  end if;
  return new;
end $$;

drop trigger if exists trg_emails_thread_assign on emails;
create trigger trg_emails_thread_assign before insert on emails
  for each row execute function emails_thread_assign();

create index if not exists idx_emails_thread on emails(thread_id);
create index if not exists idx_emails_subject_key on emails(mailbox_id, subject_key);

-- Dopočet starých e-mailů (stejná pravidla jako trigger): klíč předmětu; vlákno podle předmětu jen
-- tam, kde ve schránce existuje odpověď („Re:"/„Odp:" …) se stejným předmětem a protistranou —
-- dvě nezávislé „Poptávka" od stejného odesílatele zůstanou dvě vlákna; jinak vlákno zprávy.
update emails set subject_key = mail_subject_norm(subject) || '|'
  || coalesce(mail_first_address(case when direction = 'out' then to_email else from_email end), '')
 where subject_key is null;
with reply_keys as (
  select distinct coalesce(mailbox_id::text, '-') || '|' || subject_key as k
  from emails where mail_subject_is_reply(subject) and subject_key is not null
)
update emails set thread_id = case
    when mail_subject_norm(subject) <> '' and (coalesce(mailbox_id::text, '-') || '|' || subject_key) in (select k from reply_keys)
      then 's:' || md5(coalesce(mailbox_id::text, '-') || '|' || subject_key)
    else 'm:' || coalesce(mailbox_id::text, '-') || ':' || coalesce(nullif(message_id, ''), id::text) end
 where thread_id is null;
-- vlákna 'm:<Message-ID>' z dřívější verze triggeru (bez schránky) → 'm:<schránka>:<Message-ID>'
update emails set thread_id = 'm:' || coalesce(mailbox_id::text, '-') || ':' || substr(thread_id, 3)
 where thread_id like 'm:%' and thread_id !~ '^m:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|-):';
update emails set has_attachments = true
 where not has_attachments and exists (select 1 from email_attachments a where a.email_id = emails.id);

create index if not exists idx_emails_message_id on emails(message_id) where message_id is not null;
create index if not exists idx_emails_in_reply_to on emails(in_reply_to) where in_reply_to is not null;
create index if not exists idx_emails_refs on emails using gin (message_refs);
create index if not exists idx_emails_flagged on emails(thread_id) where flagged;
create index if not exists idx_emails_imap on emails(mailbox_id, imap_folder, imap_uid) where imap_uid is not null;
create index if not exists idx_emails_ai_pending on emails(mailbox_id, received_at desc) where ai_pending;

-- ── 4) „Předat kolegovi" (vlákno + krátká poznámka; příjemce vidí celé vlákno) ──
create table if not exists email_shares (
  id          uuid primary key default gen_random_uuid(),
  email_id    uuid not null references emails(id) on delete cascade,
  thread_id   text not null,
  shared_by   uuid references profiles(id) on delete set null,
  shared_with uuid not null references profiles(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
-- Schránka předaného e-mailu: příjemce vidí jen zprávy vlákna Z TÉTO schránky (null = pošta bez
-- schránky). Bez cizího klíče — po „Odpojit" zůstane staré id (příjemce nic nevidí, dokud se schránka
-- znovu nepřipojí; pak ji trigger mailboxes_reattach přepíše na nové id).
alter table email_shares add column if not exists mailbox_id uuid;
update email_shares s set mailbox_id = e.mailbox_id
  from emails e where e.id = s.email_id and s.mailbox_id is null and e.mailbox_id is not null;
update email_shares s set thread_id = e.thread_id
  from emails e where e.id = s.email_id and e.thread_id is not null and s.thread_id is distinct from e.thread_id;
create index if not exists idx_email_shares_with on email_shares(shared_with, read_at);
create index if not exists idx_email_shares_thread on email_shares(thread_id);
create index if not exists idx_email_shares_email on email_shares(email_id);
alter table email_shares enable row level security;
drop policy if exists "email_shares_select" on email_shares;
create policy "email_shares_select" on email_shares for select using (
  is_active_user() and (is_super_admin() or shared_with = auth.uid() or shared_by = auth.uid()));
-- zápisy jen aplikace (servisní klíč)

-- E-mail přes REST: navíc zprávy vlákna předaného mně — jen ze schránky předaného e-mailu
drop policy if exists "emails_select" on emails;
create policy "emails_select" on emails for select using (
  is_active_user() and (is_super_admin() or owner_id = auth.uid() or mailbox_id in (select unnest(my_mailbox_ids()))
    or exists (select 1 from email_shares s
               where s.shared_with = auth.uid() and s.thread_id = emails.thread_id
                 and s.mailbox_id is not distinct from emails.mailbox_id)));

-- ── 4b) „Odpojit" a znovu připojit stejnou schránku = stejná pošta (žádné duplicity) ──
-- Před smazáním schránky si e-maily pamatují, odkud jsou (mailbox_id pak FK nastaví na null);
-- připojení stejné adresy stejným vlastníkem je vrátí do nové schránky (deduplikace podle Message-ID
-- ve schránce pak nic nestáhne podruhé) a předání kolegům přepíše na nové id.
create table if not exists mailbox_detached (
  mailbox_id  uuid primary key,
  email       text not null,
  owner_id    uuid,
  detached_at timestamptz not null default now()
);
alter table mailbox_detached enable row level security; -- jen aplikace / triggery (bez politik)
create index if not exists idx_mailbox_detached_email on mailbox_detached(lower(email));
create index if not exists idx_emails_detached on emails(detached_mailbox_id) where detached_mailbox_id is not null;

create or replace function mailboxes_detach()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into mailbox_detached (mailbox_id, email, owner_id) values (old.id, lower(old.email), old.owner_id)
  on conflict (mailbox_id) do update set email = excluded.email, owner_id = excluded.owner_id, detached_at = now();
  update emails set detached_mailbox_id = old.id where mailbox_id = old.id;
  return old;
end $$;
drop trigger if exists trg_mailboxes_detach on mailboxes;
create trigger trg_mailboxes_detach before delete on mailboxes
  for each row execute function mailboxes_detach();

create or replace function mailboxes_reattach()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_old uuid[];
begin
  select coalesce(array_agg(d.mailbox_id), '{}') into v_old from mailbox_detached d
   where d.email = lower(new.email) and d.owner_id is not distinct from new.owner_id and d.mailbox_id <> new.id;
  -- e-maily odpojené schránky (jedna kopie na Message-ID, která v nové schránce ještě není); starší
  -- odpojení (před touto migrací, bez záznamu) — jen e-maily téhož vlastníka adresované na tuto adresu
  update emails e set mailbox_id = new.id, detached_mailbox_id = null
   where e.id in (
     select distinct on (x.message_id) x.id from emails x
      where x.mailbox_id is null and x.message_id is not null
        and (x.detached_mailbox_id = any(v_old)
             or (x.detached_mailbox_id is null and new.owner_id is not null and x.owner_id = new.owner_id
                 and x.direction = 'in' and position(lower(new.email) in lower(coalesce(x.to_email, '') || ' ' || coalesce(x.cc_email, ''))) > 0))
        and not exists (select 1 from emails y where y.mailbox_id = new.id and y.message_id = x.message_id)
      order by x.message_id, (x.detached_mailbox_id is null), x.received_at);
  if cardinality(v_old) > 0 then
    update email_shares set mailbox_id = new.id where mailbox_id = any(v_old);
    delete from mailbox_detached where mailbox_id = any(v_old);
  end if;
  return new;
end $$;
drop trigger if exists trg_mailboxes_reattach on mailboxes;
create trigger trg_mailboxes_reattach after insert on mailboxes
  for each row execute function mailboxes_reattach();
drop trigger if exists trg_mailboxes_reattach_upd on mailboxes;
create trigger trg_mailboxes_reattach_upd after update of email, owner_id on mailboxes
  for each row when (lower(old.email) is distinct from lower(new.email) or old.owner_id is distinct from new.owner_id)
  execute function mailboxes_reattach();

-- ── 5) Nastavení AI třídění pošty (náklady) ──
insert into integration_settings (key, value, is_secret, category, label) values
  ('mail_ai_recent_days', '30', false, 'email', 'Pošta: AI třídí jen e-maily mladší než (dní) — starší dostanou pravidla, AI na požádání'),
  ('mail_ai_max_per_run', '25', false, 'email', 'Pošta: max. e-mailů roztříděných AI při jednom stažení')
on conflict (key) do nothing;

-- ── 6) Seznam vláken (Přijatá pošta) — volá jen aplikace servisním klíčem; viditelnost předává
--      aplikace (p_all = super admin, p_owned = moje schránky) a funkce ji vynucuje ──
drop function if exists mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int);
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
  share_unread boolean, total_count bigint
) language sql stable set search_path = public as $$
  with vis as (
    -- own = vidím vlastním právem (jinak jen přes předání: nepřečtené řídí email_shares.read_at)
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
      bool_or(p_category is null or (v.direction = 'in' and v.category = p_category)) as cat_hit,
      bool_or(p_words is null or cardinality(p_words) = 0 or not exists (
        select 1 from unnest(p_words) w
        where (coalesce(v.subject, '') || ' ' || coalesce(v.from_name, '') || ' ' || coalesce(v.from_email, '') || ' '
               || coalesce(v.to_email, '') || ' ' || coalesce(v.cc_email, '') || ' ' || coalesce(v.body_text, '')) not ilike '%' || w || '%')) as hit
    from vis v group by v.thread_id
  ),
  f as (
    select t.*, sh.note as share_note, sh.read_at as share_read_at, sh.shared_by, (sh.thread_id is not null) as shared
    from t left join sh on sh.thread_id = t.tid
    where t.hit
      and case coalesce(p_folder, 'inbox')
        when 'inbox' then (t.has_in or sh.thread_id is not null) and not t.all_spam
        when 'sent' then t.has_out
        when 'flagged' then t.flagged and not t.all_spam
        when 'spam' then t.all_spam
        when 'shared' then sh.thread_id is not null
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
           when coalesce(p_folder, 'inbox') in ('inbox', 'spam', 'shared', 'flagged') and v.direction = 'in' then 0
           else 1 end,
      v.received_at desc
  )
  select f.tid, p.id, p.mailbox_id, p.direction, p.from_name, p.from_email, p.to_email, p.subject, p.snippet,
    p.category, p.priority, p.ai_confidence, p.ai_summary, p.received_at, p.order_id, o.number, c.name, m.email,
    p.has_draft, f.n, f.unread, f.flagged, coalesce(f.prank, 3), f.manual, f.att, f.aip,
    case when coalesce(p_folder, 'inbox') = 'sent' then coalesce(f.last_out, f.last_at) else f.last_at end,
    f.share_note, coalesce(nullif(btrim(pr.full_name), ''), pr.email), (f.shared and f.share_read_at is null),
    count(*) over ()
  from f
  join pick p on p.thread_id = f.tid
  left join orders o on o.id = p.order_id
  left join customers c on c.id = p.customer_id
  left join mailboxes m on m.id = p.mailbox_id
  left join profiles pr on pr.id = f.shared_by
  order by
    case when p_sort = 'priority' then coalesce(f.prank, 3) end asc nulls last,
    case when p_sort = 'flag' then (case when f.flagged then 0 else 1 end) end asc nulls last,
    case when p_sort = 'unread' then (case when f.unread > 0 then 0 else 1 end) end asc nulls last,
    case when coalesce(p_folder, 'inbox') = 'sent' then coalesce(f.last_out, f.last_at) else f.last_at end desc,
    f.tid
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
$$;

-- Počty do složek (nepřečtená vlákna v Přijatých vč. neotevřených předání, označená, spam, předaná)
create or replace function mail_folder_counts(
  p_user uuid, p_all boolean, p_owned uuid[], p_mailbox uuid default null, p_no_mailbox boolean default false
) returns table (inbox_unread int, flagged int, spam int, shared int, shared_unread int, ai_pending int)
language sql stable set search_path = public as $$
  with vis as (
    select e.thread_id, e.direction, e.is_read, e.is_spam, e.flagged, e.ai_pending,
      (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))) as own from emails e
    where (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))
           or exists (select 1 from email_shares s where s.shared_with = p_user and s.thread_id = e.thread_id
                      and s.mailbox_id is not distinct from e.mailbox_id))
      and (p_mailbox is null or e.mailbox_id = p_mailbox)
      and (not coalesce(p_no_mailbox, false) or e.mailbox_id is null)
  ),
  t as (
    select v.thread_id, bool_or(v.own and v.direction = 'in' and not v.is_read and not v.is_spam) as unread,
      bool_or(v.flagged) as flagged, bool_and(v.is_spam) as spam, bool_or(v.ai_pending) as aip
    from vis v group by v.thread_id
  ),
  sh as (select s.thread_id, bool_or(s.read_at is null) as unread from email_shares s where s.shared_with = p_user group by s.thread_id)
  select
    -- Přijaté = nepřečtená vlákna (nepřečtený příchozí e-mail nebo neotevřené předání) = odznak v menu
    (select count(*) from t left join sh on sh.thread_id = t.thread_id where (t.unread or coalesce(sh.unread, false)) and not t.spam)::int,
    (select count(*) from t where t.flagged and not t.spam)::int,
    (select count(*) from t where t.spam)::int,
    (select count(*) from sh)::int,
    (select count(*) from sh where sh.unread)::int,
    (select count(*) from t where t.aip and not t.spam)::int
$$;

do $$ begin
  revoke execute on function mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) from public, anon, authenticated;
  grant execute on function mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) to service_role;
  revoke execute on function mail_folder_counts(uuid, boolean, uuid[], uuid, boolean) from public, anon, authenticated;
  grant execute on function mail_folder_counts(uuid, boolean, uuid[], uuid, boolean) to service_role;
  revoke execute on function emails_thread_assign() from public, anon, authenticated;
  revoke execute on function mailboxes_detach() from public, anon, authenticated;
  revoke execute on function mailboxes_reattach() from public, anon, authenticated;
end $$;

notify pgrst, 'reload schema';
