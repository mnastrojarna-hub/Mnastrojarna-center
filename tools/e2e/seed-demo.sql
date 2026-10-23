-- Demo data pro E2E testy a vizuální kontrolu Knihy zakázek (lokální stack).
-- Předpoklad: běží tools/local-supabase a proběhl seed-users.mjs.
--   tools/local-supabase/psql.sh -f tools/e2e/seed-demo.sql
-- Idempotentní: smaže a znovu založí demo záznamy (UUID s prefixem d0…).

begin;

-- ── Úklid předchozího běhu ─────────────────────────────────
delete from job_events where job_id::text like 'd0000000-%';
delete from job_files where job_id::text like 'd0000000-%';
delete from quote_items where quote_id::text like 'd1000000-%';
update orders set quote_id = null where id::text like 'd0000000-%';
delete from quotes where id::text like 'd1000000-%';
delete from order_items where order_id::text like 'd0000000-%';
delete from emails where id::text like 'd3000000-%';
delete from orders where id::text like 'd0000000-%';
delete from customer_contacts where customer_id::text like 'd2000000-%';
delete from customers where id::text like 'd2000000-%';
delete from suppliers where id::text like 'd4000000-%';
delete from mailboxes where id::text like 'd5000000-%';

-- ── Uživatelé (ze seed-users.mjs) ──────────────────────────
create temp table u as
select
  (select id from profiles where email = 'admin@local.test')  as admin_id,
  (select id from profiles where email = 'obchod@local.test') as obchod_id,
  (select id from profiles where email = 'dilna@local.test')  as dilna_id;

-- ── Zákazníci ──────────────────────────────────────────────
insert into customers (id, name, ico, dic, country, email, phone, street, city, zip, contact_person, supplier_number_at_customer, payment_terms_days, owner_id)
select * from (values
  ('d2000000-0000-0000-0000-000000000001'::uuid, 'Strojmetal a.s.', '45274649', 'CZ45274649', 'CZ', 'nakup@strojmetal.cz', '+420 312 555 101', 'Průmyslová 124', 'Kladno', '272 01', 'Ing. Jan Dvořák', 'D-88412', 30),
  ('d2000000-0000-0000-0000-000000000002'::uuid, 'TDK Precision s.r.o.', '27082440', 'CZ27082440', 'CZ', 'nakup@tdkprecision.cz', '+420 571 888 222', 'Za Drahou 18', 'Vsetín', '755 01', 'Petra Nováková', null, 14),
  ('d2000000-0000-0000-0000-000000000003'::uuid, 'Beneš CNC s.r.o.', '61852309', 'CZ61852309', 'CZ', 'info@benescnc.cz', null, 'Lipová 7', 'Plzeň', '301 00', 'Martin Beneš', null, 21),
  ('d2000000-0000-0000-0000-000000000004'::uuid, 'AeroParts EU GmbH', null, 'DE811234567', 'DE', 'weber@aeroparts.eu', '+49 89 5551234', 'Flughafenstraße 3', 'München', '85356', 'Klaus Weber', 'L-20931', 45)
) as c(id, name, ico, dic, country, email, phone, street, city, zip, contact_person, supplier_number_at_customer, payment_terms_days)
cross join lateral (select obchod_id from u) o;

insert into customer_contacts (customer_id, name, position, email, phone, is_primary) values
  ('d2000000-0000-0000-0000-000000000001', 'Ing. Jan Dvořák', 'Nákup', 'dvorak@strojmetal.cz', '+420 603 111 222', true),
  ('d2000000-0000-0000-0000-000000000002', 'Petra Nováková', 'Nákupčí', 'novakova@tdkprecision.cz', null, true);

-- ── Dodavatelé ─────────────────────────────────────────────
insert into suppliers (id, name, country, email, technologies, materials, lead_days, rating, ico) values
  ('d4000000-0000-0000-0000-000000000001', 'Kovoobrábění Hrubý s.r.o.', 'CZ', 'objednavky@hruby-cnc.cz', '{"Frézování 5-osé","Soustružení"}', '{"1.2379","1.2343","C45"}', 12, 4.6, '25874411'),
  ('d4000000-0000-0000-0000-000000000002', 'TepKal s.r.o.', 'CZ', 'zakazky@tepkal.cz', '{"Kalení","Nitridace"}', '{}', 5, 4.8, '26112233'),
  ('d4000000-0000-0000-0000-000000000003', 'CoatTech CZ', 'CZ', 'info@coattech.cz', '{"PVD povlaky"}', '{}', 6, 4.4, null);

-- ── Schránky (vlastník = uživatel) ─────────────────────────
-- Obchodník odesílá nabídky / doklady ze SVÉ schránky (bez SMTP by se neodeslalo — žádná záloha na
-- cizí / firemní adresu) → odchozí server = lokální mail catcher (bez TLS jen na localhostu).
insert into mailboxes (id, provider, email, display_name, config, active, owner_id)
select 'd5000000-0000-0000-0000-000000000001'::uuid, 'imap'::mailbox_provider, 'obchod@mnastrojarna.test', 'Obchod — Petr',
  '{"smtp_host": "127.0.0.1", "smtp_port": 54325, "smtp_user": "obchod@mnastrojarna.test", "smtp_password": "test"}'::jsonb, true, obchod_id from u
union all
select 'd5000000-0000-0000-0000-000000000002', 'imap', 'dilna@mnastrojarna.test', 'Dílna — Jana', '{}'::jsonb, true, dilna_id from u
union all
select 'd5000000-0000-0000-0000-000000000003', 'imap', 'info@mnastrojarna.test', 'Firemní info', '{}'::jsonb, true, null from u;

-- ── Zakázky ve všech stavech ───────────────────────────────
-- d0…01 poptávka · 02 nacenění · 03 nabídka · 04 objednávka · 05 potvrzeno · 06 ve výrobě (po termínu)
-- 07 dodáno k nám · 08 na skladě · 09 montáž · 10 dodáno zákazníkovi · 11 vyfakturováno · 12 dokončeno
-- 13 pozastaveno · 14 reklamace · 15 nerealizováno · 16 zrušeno
insert into orders (id, number, title, status, customer_id, owner_id, created_by, assignee_id, supplier_id,
  customer_order_number, customer_inquiry_number, inquiry_date, order_date, customer_required_date, due_date,
  expected_delivery_date, supplier_promised_date, max_tolerated_date, value, purchase_cost, priority, source, note, created_at)
select v.id::uuid, v.number, v.title, v.status::job_stage, v.customer_id::uuid, u.obchod_id, u.obchod_id,
  case when v.assign then u.dilna_id else null end, v.supplier_id::uuid,
  v.cpo, v.cinq, v.inq::date, v.ord::date, (current_date + v.req)::date,
  case when v.due is null then null else (current_date + v.due)::date end,
  case when v.exp is null then null else (current_date + v.exp)::date end,
  case when v.sup is null then null else (current_date + v.sup)::date end,
  case when v.maxd is null then null else (current_date + v.maxd)::date end,
  v.val, v.cost, v.prio::priority_level, v.src, v.note, now() - (v.age || ' days')::interval
from u, (values
  ('d0000000-0000-0000-0000-000000000001','Z-2026-101','Frézované upínky VK-2291','poptavka','d2000000-0000-0000-0000-000000000001',false,null,null,'POP-7781','2026-10-20',null,30,null,null,null,null,null::numeric,null::numeric,'vysoka','email','Poptávka z e-mailu, výkres v příloze.',2),
  ('d0000000-0000-0000-0000-000000000002','Z-2026-102','Hřídel Ø40 × 160, kaleno','naceneni','d2000000-0000-0000-0000-000000000002',true,null,null,'RFQ-2026-118','2026-10-15',null,40,null,null,null,null,null,null,'stredni','foto',null,7),
  ('d0000000-0000-0000-0000-000000000003','Z-2026-103','Matrice MT-14 pro lis','nabidka','d2000000-0000-0000-0000-000000000003',false,null,null,null,'2026-10-01',null,35,null,null,null,null,186000,121000,'stredni','manual',null,21),
  ('d0000000-0000-0000-0000-000000000004','Z-2026-104','Příruby AL 7075 — 200 ks','objednavka','d2000000-0000-0000-0000-000000000004',true,'d4000000-0000-0000-0000-000000000001','PO-4500021877',null,'2026-09-25','2026-10-19',28,null,null,null,40,94000,61000,'vysoka','foto','Zákazník chce měřicí protokol 3D.',27),
  ('d0000000-0000-0000-0000-000000000005','Z-2026-105','Vodicí lišty 1.2379 — 12 ks','potvrzeno','d2000000-0000-0000-0000-000000000001',true,'d4000000-0000-0000-0000-000000000001','4711-2026',null,'2026-09-10','2026-09-20',14,14,12,12,21,58200,37400,'stredni','manual',null,40),
  ('d0000000-0000-0000-0000-000000000006','Z-2026-106','Pouzdra bronz CuSn8','ve_vyrobe','d2000000-0000-0000-0000-000000000002',true,'d4000000-0000-0000-0000-000000000001','OBJ-23-9981',null,'2026-08-30','2026-09-05',-3,-3,2,2,4,41800,30100,'vysoka','manual','Dodavatel hlásí zpoždění materiálu.',52),
  ('d0000000-0000-0000-0000-000000000007','Z-2026-107','Kalené čepy Ø12','dodano_k_nam','d2000000-0000-0000-0000-000000000003',false,'d4000000-0000-0000-0000-000000000002','PO-778',null,'2026-08-20','2026-08-28',5,5,null,null,10,12600,7800,'nizka','manual',null,60),
  ('d0000000-0000-0000-0000-000000000008','Z-2026-108','Náhradní díly lisu — sada','na_sklade','d2000000-0000-0000-0000-000000000001',false,null,'4730-2026',null,'2026-08-15','2026-08-22',9,9,null,null,15,23900,15200,'stredni','manual','Čeká na vyzvednutí zákazníkem.',66),
  ('d0000000-0000-0000-0000-000000000009','Z-2026-109','Svařenec rámu RM-3 + montáž','montaz','d2000000-0000-0000-0000-000000000004',true,'d4000000-0000-0000-0000-000000000001','PO-4500021333',null,'2026-08-01','2026-08-12',6,6,null,null,12,132000,88000,'vysoka','manual',null,80),
  ('d0000000-0000-0000-0000-000000000010','Z-2026-110','Rozpěrky nerez 1.4301','dodano_zakaznikovi','d2000000-0000-0000-0000-000000000002',false,null,'OBJ-23-9702',null,'2026-07-20','2026-07-28',-10,-10,null,null,null,8700,5100,'nizka','manual',null,92),
  ('d0000000-0000-0000-0000-000000000011','Z-2026-111','Tvárník TV-08','fakturovano','d2000000-0000-0000-0000-000000000003',false,null,'BEN-2026-55',null,'2026-07-01','2026-07-10',-20,-20,null,null,null,64500,40100,'stredni','manual',null,110),
  ('d0000000-0000-0000-0000-000000000012','Z-2026-112','Desky 1.2311 — frézování','dokonceno','d2000000-0000-0000-0000-000000000001',false,null,'4602-2026',null,'2026-06-01','2026-06-10',-60,-60,null,null,null,47200,30800,'nizka','manual',null,140),
  ('d0000000-0000-0000-0000-000000000013','Z-2026-113','Ozubená kola m2','pozastaveno','d2000000-0000-0000-0000-000000000004',false,null,'PO-4500021901',null,'2026-09-28','2026-10-05',20,20,null,null,30,73000,null,'stredni','manual','Zákazník mění výkres — čekáme na rev. C.',24),
  ('d0000000-0000-0000-0000-000000000014','Z-2026-114','Držáky senzorů — reklamace rozměru','reklamace','d2000000-0000-0000-0000-000000000002',true,'d4000000-0000-0000-0000-000000000001','OBJ-23-9640',null,'2026-07-10','2026-07-15',7,7,null,null,10,15400,9800,'vysoka','manual','Rozměr 24h7 mimo toleranci u 6 ks.',100),
  ('d0000000-0000-0000-0000-000000000015','Z-2026-115','Lisovací nástroj LN-2','nerealizovano','d2000000-0000-0000-0000-000000000003',false,null,null,'BEN-RFQ-12','2026-06-20',null,60,null,null,null,null,410000,null,'stredni','manual','Zákazník zvolil levnější nabídku.',125),
  ('d0000000-0000-0000-0000-000000000016','Z-2026-116','Prototyp krytu — zrušeno','zruseno','d2000000-0000-0000-0000-000000000001',false,null,'4699-2026',null,'2026-06-12','2026-06-18',-30,null,null,null,null,18000,null,'nizka','manual','Projekt zákazníka zrušen.',130)
) as v(id, number, title, status, customer_id, assign, supplier_id, cpo, cinq, inq, ord, req, due, exp, sup, maxd, val, cost, prio, src, note, age);

-- Položky
insert into order_items (order_id, position, drawing_number, revision, name, material, quantity, unit, unit_price, purchase_unit_price, description) values
  ('d0000000-0000-0000-0000-000000000001', 0, 'VK-2291', 'B', 'Upínka frézovaná', '1.2379', 50, 'ks', null, null, 'Frézovaný díl dle výkresu'),
  ('d0000000-0000-0000-0000-000000000002', 0, 'HR-4016', 'A', 'Hřídel Ø40 × 160', '42CrMo4', 120, 'ks', null, null, 'Kaleno 52 HRC'),
  ('d0000000-0000-0000-0000-000000000003', 0, 'MT-14', 'C', 'Matrice', '1.2379', 1, 'ks', 186000, 121000, 'Kompletní matrice vč. tepelného zpracování'),
  ('d0000000-0000-0000-0000-000000000004', 0, 'PR-7075-20', 'A', 'Příruba', 'AL 7075-T6', 200, 'ks', 470, 305, null),
  ('d0000000-0000-0000-0000-000000000005', 0, 'VL-2379-08', 'B', 'Vodicí lišta', '1.2379', 12, 'ks', 4850, 3116, null),
  ('d0000000-0000-0000-0000-000000000006', 0, 'PB-118', 'A', 'Pouzdro', 'CuSn8', 220, 'ks', 190, 136.8, null),
  ('d0000000-0000-0000-0000-000000000007', 0, 'CP-12', 'A', 'Čep kalený', '1.7225', 300, 'ks', 42, 26, null),
  ('d0000000-0000-0000-0000-000000000009', 0, 'RM-3', 'D', 'Svařenec rámu', 'S355J2', 2, 'ks', 54000, 36000, null),
  ('d0000000-0000-0000-0000-000000000009', 1, 'RM-3-MON', null, 'Montáž a zkouška', null, 1, 'ks', 24000, 16000, null),
  ('d0000000-0000-0000-0000-000000000011', 0, 'TV-08', 'A', 'Tvárník', '1.2343', 3, 'ks', 21500, 13366, null);

-- Nabídky (více na zakázku — verze)
insert into quotes (id, number, job_id, customer_id, status, total, currency, valid_until, revision, created_by, owner_id, approved_by, approved_at, lead_time_days, archived, sent_at, created_at)
select q.id::uuid, q.number, q.job_id::uuid, q.cust::uuid, q.status::quote_status, q.total, 'CZK', current_date + 30, q.rev,
  u.obchod_id, u.obchod_id, case when q.appr then u.admin_id else null end, case when q.appr then now() - interval '5 days' else null end,
  q.lead, q.arch, case when q.status in ('odeslano','prijato','zamitnuto') then now() - interval '6 days' else null end, now() - (q.age || ' days')::interval
from u, (values
  ('d1000000-0000-0000-0000-000000000001','NAB-2026-031','d0000000-0000-0000-0000-000000000003','d2000000-0000-0000-0000-000000000003','odeslano',198000::numeric,1,true,true,25,20),
  ('d1000000-0000-0000-0000-000000000002','NAB-2026-031-R2','d0000000-0000-0000-0000-000000000003','d2000000-0000-0000-0000-000000000003','odeslano',186000,2,true,false,25,12),
  ('d1000000-0000-0000-0000-000000000003','NAB-2026-028','d0000000-0000-0000-0000-000000000004','d2000000-0000-0000-0000-000000000004','prijato',94000,1,true,false,20,26),
  ('d1000000-0000-0000-0000-000000000004','NAB-2026-019','d0000000-0000-0000-0000-000000000005','d2000000-0000-0000-0000-000000000001','prijato',58200,1,true,false,14,38),
  ('d1000000-0000-0000-0000-000000000005','NAB-2026-034','d0000000-0000-0000-0000-000000000002','d2000000-0000-0000-0000-000000000002','ke_schvaleni',null,1,false,false,null,1)
) as q(id, number, job_id, cust, status, total, rev, appr, arch, lead, age);

insert into quote_items (quote_id, position, drawing_number, name, material, quantity, unit, unit_price, vat_rate, description) values
  ('d1000000-0000-0000-0000-000000000001', 0, 'MT-14', 'Matrice', '1.2379', 1, 'ks', 198000, 21, 'Matrice MT-14'),
  ('d1000000-0000-0000-0000-000000000002', 0, 'MT-14', 'Matrice', '1.2379', 1, 'ks', 186000, 21, 'Matrice MT-14 — sleva za opakování'),
  ('d1000000-0000-0000-0000-000000000003', 0, 'PR-7075-20', 'Příruba', 'AL 7075-T6', 200, 'ks', 470, 21, 'Příruba AL'),
  ('d1000000-0000-0000-0000-000000000004', 0, 'VL-2379-08', 'Vodicí lišta', '1.2379', 12, 'ks', 4850, 21, 'Vodicí lišta'),
  ('d1000000-0000-0000-0000-000000000005', 0, 'HR-4016', 'Hřídel', '42CrMo4', 120, 'ks', null, 21, 'Hřídel Ø40');

update orders set quote_id = 'd1000000-0000-0000-0000-000000000003' where id = 'd0000000-0000-0000-0000-000000000004';
update orders set quote_id = 'd1000000-0000-0000-0000-000000000004' where id = 'd0000000-0000-0000-0000-000000000005';

-- Historie
insert into job_events (job_id, type, message, data, actor_id, created_at)
select o.id, 'created', 'Zakázka založena', '{}'::jsonb, u.obchod_id, o.created_at from orders o, u where o.id::text like 'd0000000-%';
insert into job_events (job_id, type, message, data, actor_id, created_at)
select 'd0000000-0000-0000-0000-000000000006', 'comment', 'Dodavatel hlásí zpoždění materiálu o 5 dní.', '{}'::jsonb, dilna_id, now() - interval '1 day' from u;

-- Pošta (přijatá) — po jedné do každé schránky
insert into emails (id, mailbox_id, direction, from_name, from_email, to_email, subject, snippet, body_text, category, priority, customer_id, owner_id, is_read, received_at)
select * from (values
  ('d3000000-0000-0000-0000-000000000001'::uuid, 'd5000000-0000-0000-0000-000000000001'::uuid, 'in', 'Ing. Jan Dvořák', 'dvorak@strojmetal.cz', 'obchod@mnastrojarna.test', 'Poptávka — upínky VK-2291, 50 ks', 'Dobrý den, poptáváme 50 ks upínek dle výkresu VK-2291 rev. B…', 'Dobrý den,\npoptáváme 50 ks upínek dle výkresu VK-2291 rev. B, materiál 1.2379.\nTermín do 30 dnů.\nS pozdravem Jan Dvořák', 'poptavka'::email_category, 'vysoka'::priority_level, 'd2000000-0000-0000-0000-000000000001'::uuid, null::uuid, false, now() - interval '3 hours'),
  ('d3000000-0000-0000-0000-000000000002', 'd5000000-0000-0000-0000-000000000002', 'in', 'TepKal s.r.o.', 'zakazky@tepkal.cz', 'dilna@mnastrojarna.test', 'Kalení čepů — hotovo', 'Dobrý den, čepy CP-12 jsou zakalené, můžete si je vyzvednout.', 'Dobrý den,\nčepy CP-12 jsou zakalené.\nTepKal', 'ostatni', 'stredni', null, null, false, now() - interval '1 day'),
  ('d3000000-0000-0000-0000-000000000003', 'd5000000-0000-0000-0000-000000000003', 'in', 'Klaus Weber', 'weber@aeroparts.eu', 'info@mnastrojarna.test', 'Order PO-4500021877', 'Please find attached our purchase order…', 'Please find attached our purchase order PO-4500021877.', 'objednavka', 'vysoka', 'd2000000-0000-0000-0000-000000000004', null, true, now() - interval '2 days')
) as e(id, mailbox_id, direction, from_name, from_email, to_email, subject, snippet, body_text, category, priority, customer_id, owner_id, is_read, received_at);

-- vlastník e-mailu = vlastník schránky
update emails e set owner_id = m.owner_id from mailboxes m where e.mailbox_id = m.id and e.id::text like 'd3000000-%';

-- SMTP do mail catcheru (obnova hesla, odeslání nabídek)
insert into integration_settings (key, category, label, is_secret, value) values
  ('smtp_host', 'email', 'SMTP host', false, '127.0.0.1'),
  ('smtp_port', 'email', 'SMTP port', false, '54325'),
  ('smtp_user', 'email', 'SMTP uživatel', false, 'test'),
  ('smtp_password', 'email', 'SMTP heslo', true, 'test')
on conflict (key) do update set value = excluded.value;

commit;
