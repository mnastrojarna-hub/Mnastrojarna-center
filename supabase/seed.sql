-- Demo data pro lokální vývoj (supabase db reset / supabase start).
-- NEspouští se při `supabase db push` na produkci.

insert into customers (id, name, ico, dic, country, email, phone)
values
  ('11111111-1111-1111-1111-111111111111', 'Strojmetal a.s.', '45274649', 'CZ45274649', 'CZ', 'dvorak@strojmetal.cz', '+420123456789'),
  ('22222222-2222-2222-2222-222222222222', 'TDK Precision s.r.o.', '27082440', 'CZ27082440', 'CZ', 'nakup@tdkprecision.com', '+420987654321'),
  ('33333333-3333-3333-3333-333333333333', 'Beneš CNC', '61852309', 'CZ61852309', 'CZ', 'info@benescnc.cz', null),
  ('44444444-4444-4444-4444-444444444444', 'AeroParts EU', 'DE811234567', null, 'DE', 'weber@aeroparts.eu', null)
on conflict (id) do nothing;

insert into suppliers (name, country, technologies, materials, lead_days, rating)
values
  ('Hofmann Tools GmbH', 'DE', '{"Nástrojová ocel","Dodávka materiálu"}', '{"1.2343","1.2379","1.2311"}', 7, 4.7),
  ('Kovohutě Trade', 'CZ', '{"Hliník","Neželezné kovy"}', '{"7075","6082","AlCu4Mg"}', 4, 4.4),
  ('TepKal s.r.o.', 'CZ', '{"Kalení","Tepelné zpracování"}', '{}', 5, 4.8),
  ('CoatTech', 'CZ', '{"Povlakování PVD","TiN / TiAlN"}', '{}', 6, 4.5)
on conflict do nothing;

insert into drawings (drawing_number, revision, customer_id, material, dimensions, quantity, file_type)
values
  ('VK-2291', 'B', '11111111-1111-1111-1111-111111111111', '1.2379', '120 × 80 × 25', 50, 'STEP'),
  ('VK-2188', 'C', '22222222-2222-2222-2222-222222222222', '1.2343', 'Ø40 × 60', 120, 'PDF'),
  ('VK-2271', 'A', '33333333-3333-3333-3333-333333333333', '1.2311', '300 × 200 × 40', 8, 'STEP'),
  ('VK-2255', 'A', '44444444-4444-4444-4444-444444444444', '7075-T6', '150 × 60 × 12', 200, 'DXF')
on conflict (drawing_number, revision) do nothing;

insert into emails (from_name, from_email, subject, snippet, category, priority, customer_id, ai_confidence, is_read, has_draft, received_at)
values
  ('Jan Dvořák', 'dvorak@strojmetal.cz', 'Poptávka — frézované díly dle výkresu VK-2291', 'Dobrý den, poptáváme výrobu 50 ks dílu…', 'poptavka', 'vysoka', '11111111-1111-1111-1111-111111111111', 0.97, false, true, now()),
  ('Petra Nováková', 'nakup@tdkprecision.com', 'Objednávka č. OBJ-4471 — potvrzení', 'Tímto závazně objednáváme…', 'objednavka', 'vysoka', '22222222-2222-2222-2222-222222222222', 0.99, false, true, now() - interval '1 hour'),
  ('Casino Royale', 'win@promo-blast.ru', 'Vyhráli jste 50 000 €', 'Klikněte zde…', 'spam', 'nizka', null, 0.99, false, false, now() - interval '1 day')
on conflict do nothing;

insert into approval_queue (type, title, summary, target, ai_confidence)
values
  ('email_reply', 'Odpověď na poptávku VK-2291', 'Potvrzení přijetí poptávky + příslib nabídky do 2 prac. dnů.', 'dvorak@strojmetal.cz', 0.96),
  ('quote', 'Nabídka NAB-2026-119 — Strojmetal', '50 ks dílu VK-2291, materiál 1.2379. Cena k doplnění.', 'Strojmetal a.s.', 0.88),
  ('supplier_request', 'Poptávka materiálu u Hofmann Tools', '300 kg 1.2343 dle nejlepší historické ceny.', 'sales@hofmann-tools.de', 0.92)
on conflict do nothing;
