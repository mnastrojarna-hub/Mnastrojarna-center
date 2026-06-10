-- ============================================================
-- 0018 — Nacenění v2: materiály, sazby strojů, zákaznické
--        cenové profily, historie kalkulací (samoučení),
--        rozšířené parametry kalkulace.
-- ============================================================

-- ── Databáze materiálů (přepisuje výchozí katalog v aplikaci) ─
create table if not exists materials (
  key             text primary key,
  label           text not null,
  material_group  text not null,
  density_kg_dm3  numeric(6,3) not null,
  price_per_kg    numeric(10,2) not null,
  machinability   numeric(4,2) not null default 1.0,  -- 1 = běžná ocel
  special         boolean not null default false,
  availability    text not null default 'bezna' check (availability in ('bezna','omezena','specialni')),
  aliases         text[] not null default '{}',
  updated_at      timestamptz not null default now()
);
create trigger trg_materials_updated before update on materials
  for each row execute function set_updated_at();

insert into materials (key, label, material_group, density_kg_dm3, price_per_kg, machinability, special, availability, aliases) values
  ('11373', 'Ocel 11 373 (S235JR)', 'konstrukcni_ocel', 7.85, 32, 1.0, false, 'bezna', array['s235','s235jr','1.0038','11 373']),
  ('11523', 'Ocel 11 523 (S355J2)', 'konstrukcni_ocel', 7.85, 35, 1.05, false, 'bezna', array['s355','s355j2','1.0577','11 523']),
  ('12050', 'Ocel 12 050 (C45)', 'konstrukcni_ocel', 7.85, 38, 1.0, false, 'bezna', array['c45','1.0503','12 050','12050.1']),
  ('11109', 'Automatová ocel 11 109 (11SMn30)', 'automatova_ocel', 7.85, 40, 0.8, false, 'bezna', array['11smn30','1.0715','11 109']),
  ('15142', 'Ocel 15 142 (42CrMo4)', 'legovana_ocel', 7.85, 48, 1.2, false, 'bezna', array['42crmo4','1.7225','15 142']),
  ('14220', 'Ocel 14 220 (16MnCr5)', 'legovana_ocel', 7.85, 45, 1.15, false, 'bezna', array['16mncr5','1.7131','14 220']),
  ('19312', 'Nástrojová ocel 19 312 (90MnCrV8)', 'nastrojova_ocel', 7.85, 95, 1.4, true, 'bezna', array['90mncrv8','1.2842','19 312']),
  ('19552', 'Nástrojová ocel 19 552 (X37CrMoV5-1)', 'nastrojova_ocel', 7.80, 145, 1.5, true, 'bezna', array['1.2343','h11','19 552']),
  ('19573', 'Nástrojová ocel 19 573 (X153CrMoV12)', 'nastrojova_ocel', 7.70, 160, 1.7, true, 'bezna', array['1.2379','d2','19 573']),
  ('19830', 'Rychlořezná ocel 19 830 (HS6-5-2)', 'nastrojova_ocel', 8.10, 380, 2.0, true, 'omezena', array['1.3343','hss','19 830']),
  ('17240', 'Nerez 17 240 (1.4301 / AISI 304)', 'nerez', 7.90, 95, 1.5, false, 'bezna', array['1.4301','aisi 304','304','17 240','x5crni18-10']),
  ('17349', 'Nerez 17 349 (1.4404 / AISI 316L)', 'nerez', 8.00, 125, 1.6, false, 'bezna', array['1.4404','aisi 316l','316l','316','17 349']),
  ('17029', 'Nerez kalitelná 17 029 (1.4034)', 'nerez', 7.70, 110, 1.5, true, 'bezna', array['1.4034','17 029']),
  ('422425', 'Litina šedá (GG25 / EN-GJL-250)', 'litina', 7.20, 45, 0.9, false, 'bezna', array['gg25','gjl-250','en-gjl-250','42 2425']),
  ('alu_6082', 'Hliník EN AW-6082 (AlSi1MgMn)', 'hlinik', 2.70, 120, 0.45, false, 'bezna', array['6082','en aw-6082','alsi1mgmn','424400']),
  ('alu_7075', 'Hliník EN AW-7075 (AlZnMgCu)', 'hlinik', 2.81, 190, 0.5, true, 'bezna', array['7075','en aw-7075','alznmgcu']),
  ('alu_2017', 'Hliník EN AW-2017 (dural)', 'hlinik', 2.79, 160, 0.5, false, 'bezna', array['2017','en aw-2017','dural']),
  ('ms58', 'Mosaz Ms58 (CuZn39Pb3)', 'mosaz', 8.50, 220, 0.4, false, 'bezna', array['cuzn39pb3','2.0401','ms 58','mosaz']),
  ('cu_etp', 'Měď Cu-ETP', 'med', 8.94, 280, 0.6, false, 'omezena', array['cu-etp','e-cu','med','měď']),
  ('cusn8', 'Bronz CuSn8', 'bronz', 8.80, 350, 0.7, false, 'omezena', array['bronz','cusn8','2.1030']),
  ('ti_gr5', 'Titan Grade 5 (Ti6Al4V)', 'titan', 4.43, 1400, 2.5, true, 'specialni', array['ti6al4v','titan','3.7165','grade 5']),
  ('pom', 'Plast POM-C', 'plast', 1.41, 110, 0.3, false, 'bezna', array['pom-c','delrin','ertacetal']),
  ('pa6', 'Plast PA6', 'plast', 1.14, 95, 0.3, false, 'bezna', array['silon','polyamid','pa 6']),
  ('peek', 'Plast PEEK', 'plast', 1.31, 2200, 0.5, true, 'specialni', array['peek'])
on conflict (key) do nothing;

-- ── Sazby strojů (typ / velikost; země se řeší koeficientem) ─
create table if not exists machine_rates (
  key            text primary key,
  label          text not null,
  technology     text not null,
  size           text not null default 'stredni' check (size in ('maly','stredni','velky','portal')),
  rate_per_hour  numeric(10,2) not null,
  updated_at     timestamptz not null default now()
);
create trigger trg_machine_rates_updated before update on machine_rates
  for each row execute function set_updated_at();

insert into machine_rates (key, label, technology, size, rate_per_hour) values
  ('cnc_male', 'Malé CNC frézovací centrum', 'frezovani_3osy', 'maly', 900),
  ('cnc_stredni', 'Střední CNC frézovací centrum', 'frezovani_3osy', 'stredni', 1200),
  ('cnc_velke', 'Velké CNC frézovací centrum', 'frezovani_3osy', 'velky', 1600),
  ('cnc_portal', 'Portálové CNC centrum', 'frezovani_3osy', 'portal', 2200),
  ('cnc_4osy', 'CNC centrum 4 osy', 'frezovani_4osy', 'stredni', 1400),
  ('cnc_5os', 'Pětiosé CNC centrum', 'frezovani_5os', 'stredni', 1800),
  ('soustruh_maly', 'CNC soustruh malý', 'soustruzeni', 'maly', 850),
  ('soustruh', 'CNC soustruh', 'soustruzeni', 'stredni', 1000),
  ('soustruh_velky', 'CNC soustruh velký', 'soustruzeni', 'velky', 1400),
  ('dlouhotocny', 'Dlouhotočný automat', 'dlouhotocne_soustruzeni', 'maly', 1100),
  ('bruska', 'Bruska (rovinná/kruhová)', 'brouseni', 'stredni', 1000),
  ('dratovka', 'Drátová řezačka (WEDM)', 'dratove_rezani', 'stredni', 850),
  ('hloubicka', 'Hloubička (EDM)', 'hloubeni_edm', 'stredni', 950),
  ('laser', 'Laser', 'laser', 'stredni', 1400),
  ('vodni_paprsek', 'Vodní paprsek', 'vodni_paprsek', 'stredni', 1300),
  ('paleni', 'Pálicí stroj (plazma/plamen)', 'paleni', 'stredni', 800),
  ('svarovna', 'Svařovna', 'svarovani', 'stredni', 750),
  ('montaz', 'Montážní pracoviště', 'montaz', 'stredni', 600)
on conflict (key) do nothing;

-- ── Zákaznický cenový profil ─────────────────────────────────
alter table customers add column if not exists margin_percent numeric(5,2);
alter table customers add column if not exists price_level text check (price_level in ('nizka','standard','premium'));
alter table customers add column if not exists business_priority text check (business_priority in ('nizka','stredni','vysoka','strategicky'));
alter table customers add column if not exists payment_morale text check (payment_morale in ('vyborna','dobra','prumerna','spatna'));
alter table customers add column if not exists risk_level text check (risk_level in ('nizke','stredni','vysoke'));
alter table customers add column if not exists annual_revenue_czk numeric(14,2);
alter table customers add column if not exists repeat_customer boolean not null default false;

-- ── Historie kalkulací: každý výpočet + korekce + skutečnost ─
create table if not exists pricing_calculations (
  id               uuid primary key default uuid_generate_v4(),
  drawing_number   text,
  customer_id      uuid references customers(id) on delete set null,
  customer_name    text,
  material         text,
  quantity         int not null default 1,
  inputs           jsonb not null default '{}'::jsonb,   -- kompletní vstupy
  baseline         jsonb not null default '{}'::jsonb,   -- deterministická kalkulace
  estimate         jsonb not null default '{}'::jsonb,   -- AI kalkulace
  unit_price       numeric(12,2),
  total_price      numeric(14,2),
  margin_percent   numeric(6,2),
  lead_time_days   int,
  strategy_level   int,
  confidence       numeric(4,3),
  -- korekce uživatele (samoučení)
  corrected        boolean not null default false,
  user_unit_price  numeric(12,2),
  user_lead_time_days int,
  user_margin_percent numeric(6,2),
  user_note        text,
  corrected_at     timestamptz,
  -- skutečnost z výroby (budoucí učení)
  actual_minutes   numeric(12,2),
  actual_cost      numeric(14,2),
  quote_id         uuid references quotes(id) on delete set null,
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now()
);
create index if not exists idx_pricing_calc_drawing on pricing_calculations(drawing_number);
create index if not exists idx_pricing_calc_customer on pricing_calculations(customer_id);
create index if not exists idx_pricing_calc_created on pricing_calculations(created_at desc);

-- ── RLS ──────────────────────────────────────────────────────
alter table materials enable row level security;
alter table machine_rates enable row level security;
alter table pricing_calculations enable row level security;

create policy "materials_select" on materials for select using (is_obchodnik_or_admin());
create policy "materials_write" on materials for all using (is_super_admin());
create policy "machine_rates_select" on machine_rates for select using (is_obchodnik_or_admin());
create policy "machine_rates_write" on machine_rates for all using (is_super_admin());
create policy "pricing_calc_select" on pricing_calculations for select using (is_obchodnik_or_admin());
create policy "pricing_calc_insert" on pricing_calculations for insert with check (is_obchodnik_or_admin());
create policy "pricing_calc_update" on pricing_calculations for update using (is_obchodnik_or_admin());

-- ── Rozšířené parametry kalkulace ───────────────────────────
insert into integration_settings (key, category, label, is_secret, value) values
  ('programming_rate_czk', 'pricing', 'Sazba programování (Kč/h)', false, '900'),
  ('setup_rate_czk', 'pricing', 'Sazba seřizování (Kč/h)', false, '800'),
  ('inspection_rate_czk', 'pricing', 'Sazba kontroly (Kč/h)', false, '700'),
  ('price_strategy_level', 'pricing', 'Cenová strategie 1–10 (5 = standard)', false, '5'),
  ('shop_utilization_percent', 'pricing', 'Vytížení výroby (%)', false, '70'),
  ('small_qty_surcharge_pct', 'pricing', 'Přirážka — malé množství materiálu (%)', false, '20'),
  ('special_material_surcharge_pct', 'pricing', 'Přirážka — speciální materiál (%)', false, '15'),
  ('certification_surcharge_pct', 'pricing', 'Přirážka — materiálový certifikát (%)', false, '10'),
  ('scarce_material_surcharge_pct', 'pricing', 'Přirážka — hůře dostupný materiál (%)', false, '25'),
  ('material_transport_czk', 'pricing', 'Doprava materiálu na zakázku (Kč)', false, '300'),
  ('max_price_step_pct', 'pricing', 'Max. cenový skok vs. historie (%)', false, '15'),
  ('express_surcharge_pct', 'pricing', 'Přirážka — expresní termín (%)', false, '25'),
  ('fast_surcharge_pct', 'pricing', 'Přirážka — rychlý termín (%)', false, '10'),
  ('production_country', 'pricing', 'Země výroby (kód, např. CZ)', false, 'CZ')
on conflict (key) do nothing;

-- ── Aktualizace pravidel technologa na rozsah v2 ────────────
update ai_agent_rules
set instructions =
  'Oceň díl jako zkušený technolog/kalkulant CNC nástrojárny. Dostaneš BASELINE deterministické kalkulace ' ||
  '(polotovar, materiál, operace, časy, složitost, sériovost, strategie, termín) — vyjdi z ní a uprav ji tam, ' ||
  'kde tvá expertíza říká jinak (zdůvodni). Postupuj komplexně: návrh polotovaru (kulatina/trubka/přířez/plech/' ||
  'výpalek/výkovek/odlitek/výlisek) s objemem, hmotností, odpadem a využitím materiálu; materiálové náklady včetně ' ||
  'přirážek; technologie (soustružení, frézování 3/4/5 os, dlouhotočné, broušení, drátovka, hloubení EDM, laser, ' ||
  'vodní paprsek, pálení, svařování, montáž, tepelka, povrch, kooperace); časy po operacích (seřízení, programování, ' ||
  '1. kus, série, kontrola, balení, expedice); koeficient složitosti; sériovost (rozpočítání fixů); cenovou strategii ' ||
  '1–10 a zákaznický profil; termín dodání (expres/rychlý/standard/dlouhý s přirážkou za zkrácení); vyhlazení ceny ' ||
  'vůči historii (žádné skokové změny). Pokud existuje historická cena, vyjdi z ní + inflace.',
  always_rules = array[
    'Vždy nejdřív zkontroluj historii dílu (číslo výkresu) — pokud existuje, vyjdi z původní ceny + inflace a drž cenový skok v limitu',
    'Vždy navrhni polotovar včetně rozměru s přídavky, hmotnosti, odpadu a % využití materiálu',
    'Vždy rozepiš časy po operacích: seřízení, programování, první kus, sériový čas/ks, kontrola, balení',
    'Vždy rozděl přesné rozměry dle tolerancí (≤0,005 / ≤0,01 / ≤0,04 / ≤0,1 mm) zvlášť před a po tepelce a promítni je do složitosti',
    'Vždy zohledni sériovost (1 ks / prototyp / malá / střední / velká série) a rozpočítej fixní časy na kus',
    'Vždy aplikuj cenovou strategii (1–10) a zákaznický profil (marže, priorita, rizikovost)',
    'Vždy uveď míru jistoty (confidence) a srozumitelné zdůvodnění kalkulace po krocích',
    'Při nejistotě sniž confidence a uveď, co je třeba upřesnit'
  ],
  never_rules = array[
    'Nikdy nevydávej odhad za závaznou cenu bez schválení člověka',
    'Nikdy nepodhodnocuj úzké tolerance, geometrické tolerance, kalení a povrchové úpravy',
    'Nikdy nehádej materiál, váhu ani úpravy, pokud z výkresu nevyplývají — označ k doplnění',
    'Nikdy neměň cenu skokově vůči historii (drž max. povolený krok) a nereaguj na jediný extrémní případ',
    'Nikdy nepoužívej zahraniční měnu bez požadavku zákazníka'
  ]
where agent_key = 'pricing';
