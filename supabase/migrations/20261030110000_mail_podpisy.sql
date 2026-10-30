-- ============================================================
-- Pošta D (beta 29. 10.): grafický podpis s logem, kategorie pošty zpět (i u odeslané), oprava kategorie.
--  * profiles.mail_signatures (jsonb) — grafický podpis uživatele pro každou schránku zvlášť
--    ({ v: 1, default?, mailboxes?: { "adresa@schranky": podpis } }, viz src/lib/email/signature.ts).
--    Starý textový podpis profiles.mail_signature (migrace 20261029100000) zůstává jako záloha:
--    platí, dokud si uživatel v Pošta → Nastavení pošty neuloží grafický (pak ho grafický nahradí).
--    Podpis (oba sloupce) smí měnit jen jeho majitel — ani super admin přes REST (server = service role).
--  * Firemní údaje pro podpis: doručovací a korespondenční adresa, certifikace (Nastavení → Firemní údaje).
--  * AI pravidla „podepiš se jako …" pryč — podpis doplní aplikace (jinak by ve zprávě byly dva).
--  * Oprava kategorie e-mailu: kdo a kdy (emails.category_set_by / category_set_at), u přijaté i odeslané.
--  * Seznam vláken: filtr kategorie ve složce Odeslané podle odeslaných zpráv (dřív jen podle přijatých).
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

-- ── 1) Grafický podpis ──
alter table profiles add column if not exists mail_signatures jsonb;
comment on column profiles.mail_signatures is
  'Grafický podpis e-mailu po schránkách: { v: 1, default?, mailboxes?: { "adresa": podpis } } — upravuje jen majitel (Pošta → Nastavení pošty)';

create or replace function profiles_mail_signature_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- přihlášený uživatel (REST / klient) smí měnit podpis jen sám sobě; server (service role) bez auth.uid()
  if auth.uid() is not null and auth.uid() is distinct from new.id
     and (new.mail_signatures is distinct from old.mail_signatures or new.mail_signature is distinct from old.mail_signature) then
    raise exception 'Podpis e-mailu si upravuje každý sám (Pošta → Nastavení pošty).';
  end if;
  return new;
end $$;
drop trigger if exists trg_profiles_mail_signature_guard on profiles;
create trigger trg_profiles_mail_signature_guard
  before update of mail_signatures, mail_signature on profiles
  for each row execute function profiles_mail_signature_guard();

-- ── 2) Firemní údaje do podpisu ──
insert into integration_settings (key, category, label, is_secret, value) values
  ('company_correspondence_address', 'firma', 'Doručovací a korespondenční adresa (podpis e-mailu)', false, 'Mezná 9, 393 01 Pelhřimov'),
  ('company_certifications',         'firma', 'Certifikace (podpis e-mailu, oddělené čárkou)',      false, 'ISO 9001, ISO 14001')
on conflict (key) do nothing;

-- ── 3) AI se nepodepisuje (podpis s logem vkládá aplikace) ──
update ai_agent_rules
   set always_rules = array_replace(always_rules, 'U firemních zpráv se vždy podepiš jako „Mnástrojárna s.r.o."',
                                    'Nepodepisuj se a nepiš závěrečný pozdrav — pozdrav a podpis odesílatele (s logem) doplní aplikace')
 where agent_key = 'email' and 'U firemních zpráv se vždy podepiš jako „Mnástrojárna s.r.o."' = any(always_rules);
update ai_agent_rules
   set always_rules = array_replace(always_rules, 'Vždy se podepiš jako MNástrojárna s.r.o.',
                                    'Nepodepisuj se a nepiš závěrečný pozdrav — pozdrav a podpis odesílatele (s logem) doplní aplikace')
 where agent_key = 'confirmation' and 'Vždy se podepiš jako MNástrojárna s.r.o.' = any(always_rules);

-- ── 4) Oprava kategorie: kdo a kdy ──
alter table emails add column if not exists category_set_by uuid references profiles(id) on delete set null;
alter table emails add column if not exists category_set_at timestamptz;

-- ── 5) Seznam vláken: filtr kategorie podle zpráv složky (Odeslané = odeslané, Vše = jakákoli) ──
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
      -- kategorie se hledá u zpráv, které složka ukazuje: Odeslané = odeslané, Vše = jakékoli, jinak přijaté
      bool_or(p_category is null or (v.category = p_category and case coalesce(p_folder, 'inbox')
        when 'sent' then v.direction = 'out' when 'all' then true else v.direction = 'in' end)) as cat_hit,
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
      -- s filtrem kategorie řádek ukazuje zprávu té kategorie (štítek řádku = filtr)
      case when p_category is not null and v.category = p_category then 0 else 1 end,
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

do $$ begin
  revoke execute on function mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) from public, anon, authenticated;
  grant execute on function mail_threads(uuid, boolean, uuid[], text, uuid, boolean, text[], int, boolean, text, int, int, email_category) to service_role;
  revoke execute on function profiles_mail_signature_guard() from public, anon, authenticated;
end $$;
