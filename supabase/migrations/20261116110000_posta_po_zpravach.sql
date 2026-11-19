-- ============================================================
-- 20261116110000 — Pošta jako Outlook: seznam po zprávách, hledání i v přílohách (majitel 16. 11.)
-- „neměla by tam být konverzace — každý mail je v seznamu pošty příchozí nebo odchozí"
--
--  • email_attachments.content_text — text přílohy (PDF s textem, txt/csv/…) uložený při stahování pošty
--  • mail_messages(…) — stejné parametry i sloupce jako mail_threads, ale JEDEN ŘÁDEK = JEDNA ZPRÁVA
--    (Přijaté = příchozí, Odeslané = odeslané; message_count = 1). Vlákna (mail_threads) zůstávají pro
--    Komunikaci v zakázce.
--  • hledání: předmět, text, jméno a e-mail odesílatele, příjemci (komu, kopie), názvy příloh, text příloh
--    a text, který AI přečetla z dokumentu přílohy (i sken / OCR — job_files.ai_extracted).
-- Idempotentní (add column if not exists, create or replace).
-- ============================================================

alter table email_attachments add column if not exists content_text text;

create or replace function mail_messages(
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
  sugg_email_id uuid
) language sql stable set search_path = public as $$
  with sh as (
    select distinct on (s.thread_id) s.thread_id, s.note, s.read_at, s.shared_by
    from email_shares s where s.shared_with = p_user
    order by s.thread_id, s.created_at desc
  ),
  vis as (
    select e.*, (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))) as own,
      sh.thread_id is not null as shared, sh.note as share_note, sh.read_at as share_read_at, sh.shared_by
    from emails e
    left join sh on sh.thread_id = e.thread_id
    where (p_all or e.owner_id = p_user or e.mailbox_id = any(coalesce(p_owned, '{}'::uuid[]))
           or exists (select 1 from email_shares s where s.shared_with = p_user and s.thread_id = e.thread_id
                      and s.mailbox_id is not distinct from e.mailbox_id))
      and (p_mailbox is null or e.mailbox_id = p_mailbox)
      and (not coalesce(p_no_mailbox, false) or e.mailbox_id is null)
  ),
  sg as (
    select distinct on (s.email_id) s.email_id, s.id, s.job_id, s.score
    from email_job_suggestions s
    where s.status = 'pending' and s.email_id is not null
    order by s.email_id, s.score desc, s.created_at desc
  ),
  f as (
    select v.*, sg.id as sugg_id, sg.job_id as sugg_job_id, sg.score as sugg_score
    from vis v
    left join sg on sg.email_id = v.id and (v.order_id is null or sg.job_id <> v.order_id)
    where case coalesce(p_folder, 'inbox')
        when 'inbox' then v.direction = 'in' and not v.is_spam
        when 'sent' then v.direction = 'out'
        when 'flagged' then v.flagged and not v.is_spam
        when 'spam' then v.is_spam
        when 'shared' then v.shared
        when 'jobs' then v.direction = 'in' and not v.is_spam
                         and (v.order_id is not null or v.category::text = 'k_zakazce' or sg.id is not null)
        else not v.is_spam end
      and (p_category is null or (v.direction = 'in' and v.category = p_category))
      and (p_priority_max is null or coalesce(v.priority_rank, 3) <= p_priority_max)
      and (not coalesce(p_unread_only, false) or (v.own and v.direction = 'in' and not v.is_read)
           or (v.shared and v.share_read_at is null))
      and (p_words is null or cardinality(p_words) = 0 or not exists (
        select 1 from unnest(p_words) w
        where (coalesce(v.subject, '') || ' ' || coalesce(v.from_name, '') || ' ' || coalesce(v.from_email, '') || ' '
               || coalesce(v.to_email, '') || ' ' || coalesce(v.cc_email, '') || ' ' || coalesce(v.body_text, '')) not ilike '%' || w || '%'
          and not exists (
            select 1 from email_attachments a
            left join job_files jf on jf.id = a.job_file_id
            where a.email_id = v.id
              and (coalesce(a.filename, '') || ' ' || coalesce(a.content_text, '') || ' '
                   || coalesce(jf.ai_extracted::text, '')) ilike '%' || w || '%')))
  )
  select f.thread_id, f.id, f.mailbox_id, f.direction, f.from_name, f.from_email, f.to_email, f.subject, f.snippet,
    f.category, f.priority, f.ai_confidence, f.ai_summary, f.received_at, f.order_id, o.number, c.name, m.email,
    f.has_draft, 1, (case when f.own and f.direction = 'in' and not f.is_read and not f.is_spam then 1 else 0 end)::int,
    coalesce(f.flagged, false), coalesce(f.priority_rank, 3), (f.manual_priority is not null), coalesce(f.has_attachments, false),
    coalesce(f.ai_pending, false), f.received_at,
    f.share_note, coalesce(nullif(btrim(pr.full_name), ''), pr.email), (f.shared and f.share_read_at is null),
    count(*) over (),
    o.title, f.job_link_source, f.job_link_actor,
    f.sugg_id, f.sugg_job_id, so.number, so.title, f.sugg_score,
    case when f.sugg_id is not null then f.id end
  from f
  left join orders o on o.id = f.order_id
  left join orders so on so.id = f.sugg_job_id
  left join customers c on c.id = f.customer_id
  left join mailboxes m on m.id = f.mailbox_id
  left join profiles pr on pr.id = f.shared_by
  order by
    case when p_sort = 'priority' then coalesce(f.priority_rank, 3) end asc nulls last,
    case when p_sort = 'flag' then (case when f.flagged then 0 else 1 end) end asc nulls last,
    case when p_sort = 'unread' then (case when f.direction = 'in' and not f.is_read then 0 else 1 end) end asc nulls last,
    f.received_at desc,
    f.id
  limit greatest(1, least(coalesce(p_limit, 50), 200)) offset greatest(0, coalesce(p_offset, 0))
$$;

do $$ begin
  revoke execute on function mail_messages(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) from public, anon, authenticated;
  grant execute on function mail_messages(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) to service_role;
end $$;
