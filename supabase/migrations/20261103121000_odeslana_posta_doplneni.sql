-- ============================================================
-- Pošta → Odeslané: doplnění odeslaných dokladů, jejichž záznam v odeslané poště chybí (majitel 3. 11.:
-- „Pošlu objednávku dodavateli a v Poště nevidím, že jsme mu něco poslali").
--
-- Příčina: e-mail odešel, ale zápis do `emails` (direction out) selhal a chyba se tiše zahodila
-- (send.ts: catch {}). Typicky souběh s živým stažením složky Odeslané — kopie zprávy (IMAP APPEND /
-- server M365 ukládá sám) se uložila dřív a zápis aplikace narazil na stejné Message-ID (uq_emails_message);
-- uložená kopie pak patřila majiteli schránky, bez zakázky a objednávky, odesílatel ji neviděl.
-- Opraveno v aplikaci (zápis hned po odeslání, při kolizi doplnění vazeb, při chybě znovu bez vazeb + log).
--
-- Tady se doplní historie ze stop, které odeslání prokazatelně zanechalo (s adresátem, časem a odesílatelem):
--  1) historie zakázky (job_events typu „email"): objednávka dodavateli (vystavení / změna / storno /
--     pozastavení) s emailId = null, doklad zákazníkovi (předmět v datech), odeslání po anonymizaci výkresů
--     (předmět a text z fronty anon_send_queue),
--  2) poptávka dodavateli (rfq_recipients odeslané bez email_id, předmět „Poptávka PD-…"),
--  3) fronta K odeslání (mail_outbox „sent" bez email_id — předmět i text v payloadu).
-- Odeslaný e-mail, který v `emails` už je (stejný adresát, předmět / číslo dokladu, ±15 min — např. kopie
-- ze složky Odeslané bez vazeb), se nezakládá znovu: jen se mu doplní zakázka / objednávka / dodavatel
-- a odesílatel (jen u kopie bez zakázky). Doplněné záznamy nesou message_id „backfill:<zdroj>:<id>".
-- Text e-mailu se u objednávek a dokladů nedochoval → v náhledu je popis z historie zakázky.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

create or replace function pg_temp.odp_first_rcpt(p_to text) returns text language sql immutable as $$
  select lower(btrim(split_part(replace(coalesce(p_to, ''), ';', ','), ',', 1)))
$$;

-- Zdroje (jeden řádek = jeden odeslaný e-mail)
drop table if exists pg_temp.odp_src;
create temp table odp_src as
with ev as (
  select e.*, (select string_agg(x, ', ') from jsonb_array_elements_text(
           case when jsonb_typeof(e.data->'to') = 'array' then e.data->'to' else '[]'::jsonb end) x) as to_list
  from job_events e
  where e.type = 'email'
)
-- 1a) objednávka dodavateli přímo (sendPurchaseOrderCore) — emailId zapsané jako null = zápis selhal
select 'je:' || ev.id::text as src, ev.created_at as at, ev.actor_id as owner_id, ev.job_id as order_id,
  po.id as po_id, po.supplier_id, null::uuid as customer_id,
  case when (ev.data->>'mailboxId') ~* '^[0-9a-f-]{36}$' and exists (select 1 from mailboxes m where m.id = (ev.data->>'mailboxId')::uuid)
       then (ev.data->>'mailboxId')::uuid end as mailbox_id,
  ev.to_list as to_email,
  case coalesce(ev.data->>'mailKind', 'issue')
    when 'change' then 'Změna objednávky ' when 'cancel' then 'Storno objednávky ' when 'hold' then 'Pozastavení objednávky '
    else 'Objednávka ' end || coalesce(ev.data->>'number', po.number, '') as subject,
  coalesce(ev.data->>'number', po.number) as number,
  ev.message || E'\n\n(Záznam doplněn z historie zakázky — přesný text e-mailu se nedochoval.)' as body,
  'objednavka'::email_category as category
from ev
left join purchase_orders po on po.id = case when (ev.data->>'purchaseOrderId') ~* '^[0-9a-f-]{36}$' then (ev.data->>'purchaseOrderId')::uuid end
where ev.entity = 'purchase_order' and ev.data ? 'mailKind' and ev.data ? 'emailId' and ev.data->>'emailId' is null
  and not (ev.data ? 'sendQueueId') and ev.to_list is not null
union all
-- 1b) doklad zákazníkovi (sendJobDocument): předmět v datech, emailId chybí
select 'je:' || ev.id::text, ev.created_at, ev.actor_id, ev.job_id, null, null, o.customer_id, null,
  concat_ws(', ', ev.to_list, nullif((select string_agg(x, ', ') from jsonb_array_elements_text(
    case when jsonb_typeof(ev.data->'cc') = 'array' then ev.data->'cc' else '[]'::jsonb end) x), '')),
  ev.data->>'subject', ev.data->>'number',
  ev.message || E'\n\n(Záznam doplněn z historie zakázky — přesný text e-mailu se nedochoval.)',
  (case ev.data->>'kind' when 'faktura' then 'faktura' when 'potvrzeni' then 'potvrzeni_objednavky' else 'k_zakazce' end)::email_category
from ev
left join orders o on o.id = ev.job_id
where ev.data ? 'fileId' and ev.data ? 'subject' and ev.data ? 'kind' and coalesce(ev.data->>'emailId', '') = ''
  and ev.entity is distinct from 'purchase_order' and ev.to_list is not null
union all
-- 1c) odeslání po anonymizaci výkresů (fronta odeslání): předmět a text z fronty
select 'je:' || ev.id::text, coalesce(q.sent_at, ev.created_at), coalesce(q.created_by, ev.actor_id), ev.job_id,
  po.id, po.supplier_id, case when q.kind = 'job_document' then o.customer_id end, null,
  (select string_agg(x, ', ') from jsonb_array_elements_text(case when jsonb_typeof(q.payload->'to') = 'array' then q.payload->'to' else '[]'::jsonb end) x),
  q.payload->>'subject', po.number, q.payload->>'body',
  (case q.kind when 'purchase_order' then 'objednavka' else 'k_zakazce' end)::email_category
from ev
join anon_send_queue q on q.id = case when (ev.data->>'sendQueueId') ~* '^[0-9a-f-]{36}$' then (ev.data->>'sendQueueId')::uuid end
left join purchase_orders po on q.kind = 'purchase_order' and po.id = case when (q.payload->>'purchaseOrderId') ~* '^[0-9a-f-]{36}$' then (q.payload->>'purchaseOrderId')::uuid end
left join orders o on o.id = ev.job_id
where ev.data ? 'emailId' and ev.data->>'emailId' is null and q.status = 'sent' and coalesce(q.payload->>'subject', '') <> ''
union all
-- 2) poptávka dodavateli odeslaná přímo (bez fronty / K odeslání) bez záznamu
select 'rfq:' || r.id::text, r.sent_at, r.sent_by, rr.job_id, null, r.supplier_id, null, null,
  array_to_string(r.emails, ', '), 'Poptávka ' || rr.number, rr.number,
  'Poptávka ' || rr.number || ' odeslána dodavateli ' || r.supplier_name
    || E'.\n\n(Záznam doplněn z poptávky — přesný text e-mailu se nedochoval.)',
  'k_zakazce'::email_category
from rfq_recipients r
join rfq_rounds rr on rr.id = r.round_id
where r.sent_at is not null and r.email_id is null and r.send_queue_id is null and r.outbox_id is null
  and cardinality(r.emails) > 0 and r.status not in ('k_odeslani', 'ceka_na_anonymizaci', 'chyba', 'zruseno')
union all
-- 3) fronta K odeslání (odesláno, záznam chybí) — celý e-mail v payloadu
select 'ob:' || b.id::text, coalesce(b.sent_at, b.updated_at), b.created_by,
  case when (b.payload->>'jobId') ~* '^[0-9a-f-]{36}$' and exists (select 1 from orders o where o.id = (b.payload->>'jobId')::uuid)
       then (b.payload->>'jobId')::uuid end,
  null, null, null, null,
  b.payload->>'to', b.payload->>'subject', null, b.payload->>'body',
  (case when (b.payload->>'jobId') is not null then 'k_zakazce' else 'ostatni' end)::email_category
from mail_outbox b
where b.status = 'sent' and b.email_id is null and coalesce(b.payload->>'to', '') <> '' and coalesce(b.payload->>'subject', '') <> '';

-- Už uložený odeslaný e-mail (stejný adresát, předmět nebo číslo dokladu, ±15 min) → shoda
drop table if exists pg_temp.odp_match;
create temp table odp_match as
select s.src, (
  select e.id from emails e
  where e.direction = 'out'
    and e.received_at between s.at - interval '15 minutes' and s.at + interval '15 minutes'
    and position(pg_temp.odp_first_rcpt(s.to_email) in lower(coalesce(e.to_email, '') || ',' || coalesce(e.cc_email, ''))) > 0
    and (e.subject = s.subject or (s.number is not null and s.number <> '' and e.subject ilike '%' || s.number || '%'))
  order by abs(extract(epoch from e.received_at - s.at)) limit 1
) as email_id
from odp_src s
where pg_temp.odp_first_rcpt(s.to_email) <> '';

-- a) shoda (např. kopie ze složky Odeslané bez vazeb) → doplnit vazby; odesílatele jen u kopie bez zakázky
update emails e set
  owner_id = case when e.order_id is null and s.owner_id is not null and exists (select 1 from profiles p where p.id = s.owner_id) then s.owner_id else e.owner_id end,
  order_id = coalesce(e.order_id, case when exists (select 1 from orders o where o.id = s.order_id) then s.order_id end),
  purchase_order_id = coalesce(e.purchase_order_id, case when exists (select 1 from purchase_orders p where p.id = s.po_id) then s.po_id end),
  supplier_id = coalesce(e.supplier_id, case when exists (select 1 from suppliers x where x.id = s.supplier_id) then s.supplier_id end),
  customer_id = coalesce(e.customer_id, case when exists (select 1 from customers x where x.id = s.customer_id) then s.customer_id end),
  category = case when e.category is null or e.category::text = 'ostatni' then s.category else e.category end
from odp_src s join odp_match m on m.src = s.src
where m.email_id = e.id
  and (e.order_id is null or e.purchase_order_id is null and s.po_id is not null
       or e.supplier_id is null and s.supplier_id is not null or e.customer_id is null and s.customer_id is not null);

-- b) bez shody → doplnit záznam odeslané pošty
insert into emails (
  mailbox_id, direction, message_id, from_name, from_email, to_email, subject, body_text, snippet,
  owner_id, order_id, purchase_order_id, supplier_id, customer_id, category, is_read, has_draft, has_attachments,
  sent_copy, sent_copy_error, received_at
)
select s.mailbox_id, 'out', 'backfill:' || s.src,
  coalesce(nullif(btrim(p.full_name), ''), (select value from integration_settings where key = 'company_name')),
  coalesce(m.email, p.email),
  s.to_email, s.subject, s.body, left(regexp_replace(coalesce(s.body, ''), '\s+', ' ', 'g'), 200),
  case when exists (select 1 from profiles x where x.id = s.owner_id) then s.owner_id end,
  case when exists (select 1 from orders o where o.id = s.order_id) then s.order_id end,
  case when exists (select 1 from purchase_orders x where x.id = s.po_id) then s.po_id end,
  case when exists (select 1 from suppliers x where x.id = s.supplier_id) then s.supplier_id end,
  case when exists (select 1 from customers x where x.id = s.customer_id) then s.customer_id end,
  s.category, true, false, false,
  'skipped', 'záznam doplněn zpětně (historie zakázky)', s.at
from odp_src s
join odp_match mt on mt.src = s.src
left join profiles p on p.id = s.owner_id
left join mailboxes m on m.id = s.mailbox_id
where mt.email_id is null
  and coalesce(s.subject, '') <> ''
  and not exists (select 1 from emails x where x.message_id = 'backfill:' || s.src);

-- c) vazby zpět: objednávka / poptávka / K odeslání → záznam v odeslané poště
update rfq_recipients r set email_id = e.id
from emails e
where e.message_id = 'backfill:rfq:' || r.id::text and r.email_id is null;
update rfq_recipients r set email_id = m.email_id
from odp_match m
where m.src = 'rfq:' || r.id::text and m.email_id is not null and r.email_id is null;
update mail_outbox b set email_id = coalesce(m.email_id, (select e.id from emails e where e.message_id = 'backfill:ob:' || b.id::text limit 1))
from odp_match m
where m.src = 'ob:' || b.id::text and b.email_id is null;

drop table if exists pg_temp.odp_match;
drop table if exists pg_temp.odp_src;
drop function if exists pg_temp.odp_first_rcpt(text);
