-- ============================================================
-- Pošta E (30. 10.): „Přijmout a odeslat" — fronta K odeslání (outbox) pro zprávy napsané v Poště.
--  * Když odeslání z okna psaní selže (špatné heslo / SMTP server, výpadek spojení), zpráva se neztratí:
--    uloží se sem (status failed + důvod) a odejde tlačítkem „Přijmout a odeslat", jakmile uživatel
--    opraví nastavení schránky (Pošta → Nastavení pošty → Schránka). Opakuje se jen na kliknutí, nikdy
--    samo na pozadí (žádné dvojí odeslání bez vědomí uživatele).
--  * payload = obsah okna psaní (komu, kopie, předmět, text, přílohy jako odkazy, odpověď na …) — bez hesel.
--  * Vidí jen autor (a super admin); zapisuje jen server (service role).
-- + Vlákna JEN podle skutečné konverzace (majitel: „Poptávka Brisk" ≠ jedno vlákno) — viz oddíl 2 níže:
--    nový trigger emails_thread_assign (bez párování podle předmětu) a jednorázové rozdělení špatně
--    spojených vláken (mail_rethread_split) včetně zrušení automatického přiřazení zděděného z vlákna.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

create table if not exists mail_outbox (
  id          uuid primary key default gen_random_uuid(),
  created_by  uuid not null references profiles(id) on delete cascade,
  payload     jsonb not null,
  status      text not null default 'failed',
  last_error  text,
  attempts    int not null default 0,
  email_id    uuid references emails(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  sent_at     timestamptz
);

do $$ begin
  alter table mail_outbox add constraint mail_outbox_check
    check (status in ('waiting', 'sending', 'sent', 'failed', 'cancelled') and jsonb_typeof(payload) = 'object');
exception when duplicate_object then null; end $$;

comment on table mail_outbox is
  'Pošta → K odeslání: zprávy, jejichž odeslání selhalo; odejdou tlačítkem „Přijmout a odeslat" (jen autor, jen na kliknutí)';

create index if not exists idx_mail_outbox_open on mail_outbox(created_by, created_at) where status in ('waiting', 'sending', 'failed');

alter table mail_outbox enable row level security;
do $$ begin
  create policy "mail_outbox_select" on mail_outbox for select using (created_by = auth.uid() or is_super_admin());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on mail_outbox from anon, authenticated;
grant select on mail_outbox to authenticated;
grant all on mail_outbox to service_role;

-- ============================================================
-- 2) Vlákna jen podle skutečné konverzace (TS dvojče: assignThread v src/lib/email/threading.ts)
--  1. In-Reply-To / References → vlákno odkazované zprávy (stejná schránka)
--  2. starší zpráva přišla později než odpověď → vlákno odpovědi, která na ni odkazuje (hlavičkami, nebo
--     „Re:" bez hlaviček, která ji prokazatelně cituje)
--  3. Microsoft 365 conversationId — jen bez hlaviček odpovědi a jen u „Re:/Fw:" (hlavičky mají přednost)
--  4. „Re:/Fw:" bez hlaviček jen s prokazatelnou citací dřívější zprávy se stejným předmětem a protistranou
--  (+ odpovědi stažené dřív než původní zpráva se k ní po jejím stažení připojí — emails_thread_adopt)
--  5. jinak nové vlákno. Stejný předmět bez „Re:/Fw:" = VŽDY nové vlákno (dřív se párovalo podle předmětu,
--     když ve schránce existovala jakákoli odpověď se stejným předmětem → víc poptávek v jednom vlákně).
-- ============================================================
alter table emails add column if not exists conversation_id text;
create index if not exists idx_emails_conversation on emails(mailbox_id, conversation_id) where conversation_id is not null;

-- text bez mezer a „>" (citace se zalamuje jinak) — TS dvojče quotesMessage
create or replace function mail_squash(p text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(lower(coalesce(p, '')), '[[:space:]>]+', '', 'g')
$$;

-- cituje tělo začátek dřívější zprávy (aspoň 30 znaků bez mezer)?
create or replace function mail_quotes(p_body text, p_snippet text) returns boolean
language sql immutable set search_path = public as $$
  select length(left(mail_squash(p_snippet), 60)) >= 30 and strpos(mail_squash(p_body), left(mail_squash(p_snippet), 60)) > 0
$$;

create or replace function emails_thread_assign()
returns trigger language plpgsql set search_path = public as $$
declare
  v_tid text;
  v_refs text[];
  v_norm text;
  v_reply boolean;
begin
  v_norm := mail_subject_norm(new.subject);
  new.subject_key := v_norm || '|' || coalesce(mail_first_address(case when new.direction = 'out' then new.to_email else new.from_email end), '');
  if new.thread_id is null then
    v_refs := array_remove(coalesce(new.message_refs, '{}'::text[]) || new.in_reply_to, null);
    if cardinality(v_refs) > 0 then
      v_refs := v_refs || array(select btrim(r, '<>') from unnest(v_refs) r) || array(select '<' || btrim(r, '<>') || '>' from unnest(v_refs) r);
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
    -- původní zpráva stažená až po „Re:" bez hlaviček, která ji prokazatelně cituje → vlákno té odpovědi
    if v_tid is null and v_norm <> '' then
      select e.thread_id into v_tid from emails e
       where e.subject_key = new.subject_key and e.thread_id is not null
         and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
         and mail_subject_is_reply(e.subject) and e.in_reply_to is null and cardinality(coalesce(e.message_refs, '{}'::text[])) = 0
         and e.received_at >= coalesce(new.received_at, now())
         and mail_quotes(e.body_text, coalesce(new.snippet, left(new.body_text, 200)))
       order by e.received_at asc limit 1;
    end if;
    v_reply := mail_subject_is_reply(new.subject);
    if v_tid is null and cardinality(v_refs) = 0 and v_reply and nullif(new.conversation_id, '') is not null then
      select e.thread_id into v_tid from emails e
       where e.conversation_id = new.conversation_id and e.thread_id is not null
         and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
       order by e.received_at desc limit 1;
    end if;
    if v_tid is null and v_reply and v_norm <> '' then
      select e.thread_id into v_tid from emails e
       where e.subject_key = new.subject_key and e.thread_id is not null
         and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
         and e.received_at <= coalesce(new.received_at, now())
         and mail_quotes(new.body_text, coalesce(e.snippet, left(e.body_text, 200)))
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

-- Původní zpráva stažená až po odpovědích (první stažení jde od nejnovější): odpovědi, které na ni odkazují
-- hlavičkami nebo ji jako „Re:" bez hlaviček prokazatelně citují, mezitím založily vlastní vlákna — ta se
-- připojí k ní (jen vlákna, která nemají nic staršího než tato zpráva, tj. čekala právě na ni).
create or replace function emails_thread_adopt()
returns trigger language plpgsql set search_path = public as $$
declare
  v_ids text[];
  v_kids text[];
begin
  if new.thread_id is null then return null; end if;
  v_ids := case when nullif(new.message_id, '') is null then '{}'::text[]
                else array[new.message_id, btrim(new.message_id, '<>'), '<' || btrim(new.message_id, '<>') || '>'] end;
  select coalesce(array_agg(distinct e.thread_id), '{}') into v_kids from emails e
   where e.id <> new.id and e.thread_id is not null and e.thread_id <> new.thread_id
     and ((new.mailbox_id is null and e.mailbox_id is null) or e.mailbox_id = new.mailbox_id)
     and e.received_at >= coalesce(new.received_at, now())
     and ((cardinality(v_ids) > 0 and (e.in_reply_to = any(v_ids) or coalesce(e.message_refs, '{}'::text[]) && v_ids))
       or (mail_subject_is_reply(e.subject) and nullif(e.in_reply_to, '') is null and cardinality(coalesce(e.message_refs, '{}'::text[])) = 0
           and e.subject_key = new.subject_key and mail_quotes(e.body_text, coalesce(new.snippet, left(new.body_text, 200)))))
     and not exists (select 1 from emails o where o.thread_id = e.thread_id and o.received_at < coalesce(new.received_at, now()));
  if cardinality(v_kids) = 0 then return null; end if;
  update emails set thread_id = new.thread_id where thread_id = any(v_kids);
  update email_job_suggestions s set thread_id = new.thread_id
   where s.thread_id = any(v_kids) and not exists (select 1 from email_job_suggestions x where x.thread_id = new.thread_id and x.job_id = s.job_id);
  update email_shares set thread_id = new.thread_id where thread_id = any(v_kids);
  return null;
end $$;

drop trigger if exists trg_emails_thread_adopt on emails;
create trigger trg_emails_thread_adopt after insert on emails
  for each row execute function emails_thread_adopt();

-- Rozdělení špatně spojených vláken (stará data): vlákno = jen zprávy propojené hlavičkami (In-Reply-To /
-- References, i odpověď z jiné schránky odeslaná z aplikace), stejným conversationId u „Re:" bez hlaviček,
-- nebo „Re:/Fw:" s prokazatelnou citací. Každá další skupina dostane vlastní vlákno; původní id zůstává
-- skupině s nejstarší zprávou (předání, návrhy a ruční přiřazení tam zůstávají). Zprávy odtržené skupiny
-- s AUTOMATICKÝM přiřazením zděděným z vlákna (stejná zakázka jako zbytek vlákna, nepřiřadil člověk)
-- se od zakázky odpojí a posoudí znovu (návrh); ruční přiřazení zůstává. Opakované spuštění nic nezmění.
create or replace function mail_rethread_split() returns integer
language plpgsql set search_path = public as $$
declare
  v_rows integer;
  v_iter integer := 0;
  v_moved integer := 0;
begin
  drop table if exists _rt_m, _rt_e, _rt_c, _rt_keep, _rt_new;
  create temp table _rt_m as
    select e.id, e.thread_id, e.mailbox_id, e.message_id, e.in_reply_to, coalesce(e.message_refs, '{}'::text[]) as refs, e.subject, e.subject_key,
           coalesce(e.snippet, left(e.body_text, 200)) as snip, e.body_text, e.received_at, e.conversation_id, e.order_id, e.id::text as comp
      from emails e
     where e.thread_id in (select thread_id from emails where thread_id is not null group by thread_id having count(*) > 1);
  create index on _rt_m(thread_id);
  -- hrany (neorientované) jen uvnitř současného vlákna
  create temp table _rt_e as
    select a.id as a, b.id as b from _rt_m a join _rt_m b on a.thread_id = b.thread_id and a.id <> b.id
     where nullif(b.message_id, '') is not null and (
             btrim(coalesce(a.message_id, ''), '<>') = btrim(b.message_id, '<>')  -- tatáž zpráva (kopie)
             or btrim(coalesce(a.in_reply_to, ''), '<>') = btrim(b.message_id, '<>')
             or btrim(b.message_id, '<>') = any(array(select btrim(r, '<>') from unnest(a.refs) r)))
        or (mail_subject_is_reply(a.subject) and cardinality(a.refs) = 0 and a.in_reply_to is null
            and nullif(a.conversation_id, '') is not null and a.conversation_id = b.conversation_id)
        or (mail_subject_is_reply(a.subject) and a.subject_key = b.subject_key and b.received_at <= a.received_at
            and mail_quotes(a.body_text, b.snip));
  insert into _rt_e select b, a from _rt_e;
  create index on _rt_e(a);
  loop
    update _rt_m m set comp = x.mn
      from (select e.a, min(n.comp) as mn from _rt_e e join _rt_m n on n.id = e.b group by e.a) x
     where m.id = x.a and x.mn < m.comp;
    get diagnostics v_rows = row_count;
    v_iter := v_iter + 1;
    exit when v_rows = 0 or v_iter > 500;
  end loop;
  create temp table _rt_c as
    select thread_id, comp, min(received_at) as first_at, (array_agg(id order by received_at, id))[1] as first_id
      from _rt_m group by thread_id, comp;
  create temp table _rt_keep as
    select distinct on (thread_id) thread_id, comp from _rt_c order by thread_id, first_at, comp;
  create temp table _rt_new as
    select c.thread_id as old_tid, c.comp,
           'm:' || coalesce(f.mailbox_id::text, '-') || ':' || coalesce(nullif(f.message_id, ''), f.id::text) as new_tid
      from _rt_c c join emails f on f.id = c.first_id
     where not exists (select 1 from _rt_keep k where k.thread_id = c.thread_id and k.comp = c.comp);
  update _rt_new n set new_tid = n.new_tid || ':r' || substr(md5(n.old_tid || n.comp), 1, 6)
   where exists (select 1 from emails e where e.thread_id = n.new_tid);
  -- automatické přiřazení zděděné z vlákna (stejná zakázka jako ponechaná část, nepřiřadil člověk) → odpojit
  update job_mail_changes ch set status = 'dismissed', undone_at = now()
    from _rt_m m join _rt_new n on n.old_tid = m.thread_id and n.comp = m.comp
   where ch.email_id = m.id and ch.status in ('suggested', 'info')
     and m.order_id is not null and ch.job_id = m.order_id
     and exists (select 1 from _rt_m k join _rt_keep kk on kk.thread_id = k.thread_id and kk.comp = k.comp
                  where k.thread_id = m.thread_id and k.order_id = m.order_id)
     and exists (select 1 from emails e where e.id = m.id and coalesce(e.job_link_actor, '') <> 'user');
  update emails e set order_id = null, job_link_source = null, job_link_confidence = null, job_link_actor = null,
         job_linked_at = null, job_linked_by = null, job_match_at = null,
         category = case when e.category = 'k_zakazce' then 'ostatni'::email_category else e.category end
    from _rt_m m join _rt_new n on n.old_tid = m.thread_id and n.comp = m.comp
   where e.id = m.id and e.order_id is not null and coalesce(e.job_link_actor, '') <> 'user'
     and exists (select 1 from _rt_m k join _rt_keep kk on kk.thread_id = k.thread_id and kk.comp = k.comp
                  where k.thread_id = m.thread_id and k.order_id = m.order_id);
  update emails e set thread_id = n.new_tid
    from _rt_m m join _rt_new n on n.old_tid = m.thread_id and n.comp = m.comp
   where e.id = m.id;
  get diagnostics v_moved = row_count;
  -- otevřené návrhy „Patří k …?" k odtržené zprávě jdou s ní
  update email_job_suggestions s set thread_id = n.new_tid
    from _rt_m m join _rt_new n on n.old_tid = m.thread_id and n.comp = m.comp
   where s.email_id = m.id and s.status = 'pending'
     and not exists (select 1 from email_job_suggestions x where x.thread_id = n.new_tid and x.job_id = s.job_id);
  -- předání kolegovi platí i pro odtržené části
  insert into email_shares (email_id, thread_id, shared_by, shared_with, note, created_at, read_at, mailbox_id)
  select c.first_id, n.new_tid, s.shared_by, s.shared_with, s.note, s.created_at, s.read_at, s.mailbox_id
    from email_shares s join _rt_new n on n.old_tid = s.thread_id join _rt_c c on c.thread_id = n.old_tid and c.comp = n.comp
   where not exists (select 1 from email_shares x where x.thread_id = n.new_tid and x.shared_with = s.shared_with);
  drop table if exists _rt_m, _rt_e, _rt_c, _rt_keep, _rt_new;
  return v_moved;
end $$;
do $$ begin
  revoke execute on function mail_rethread_split() from public, anon, authenticated;
  grant execute on function mail_rethread_split() to service_role;
end $$;

select mail_rethread_split();

notify pgrst, 'reload schema';
