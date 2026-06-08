-- ============================================================
-- 0016 — Parametry naceňování (laditelné) + historická cena
-- ============================================================

-- Laditelné parametry kalkulace v integration_settings (kategorie 'pricing')
insert into integration_settings (key, category, label, is_secret, value) values
  ('hourly_rate_czk', 'pricing', 'Hodinová sazba stroje (Kč/h)', false, '1200'),
  ('handling_rate_czk', 'pricing', 'Sazba manipulace (Kč/h)', false, '600'),
  ('default_margin_percent', 'pricing', 'Výchozí marže (%)', false, '15'),
  ('inflation_percent', 'pricing', 'Roční inflace pro historické ceny (%)', false, '5'),
  ('transport_default_czk', 'pricing', 'Výchozí doprava na zakázku (Kč)', false, '500')
on conflict (key) do nothing;

-- Rozšíření výchozích pravidel technologa o kompletní rozsah
update ai_agent_rules
set instructions =
  'Oceň díl jako zkušený technolog/kalkulant CNC nástrojárny. Z výkresu a zadání zjisti VŠE: ' ||
  'typ dílu (obráběný díl / plech / svařenec / výkovek / odlitek), typ zakázky (výroba dílu / nástroj na výrobu dílu / pouze úprava dílu dodaného zákazníkem), ' ||
  'materiál, rozměry a váhu polotovaru, váhu hotového obrobku a úběr materiálu, povrchovou a tepelnou úpravu, požadované jakosti povrchů (Ra), ' ||
  'technologie obrábění a jejich časy (vč. seřízení), počty přesných rozměrů rozdělené dle tolerance (≤0,005 / ≤0,01 / ≤0,04 / ≤0,1 mm) zvlášť před a po tepelném zpracování, ' ||
  'manipulaci a dopravu. Zohledni množství (sériovost) i konkrétního zákazníka (různé ceníky). ' ||
  'Pokud se díl historicky vyráběl, vyjdi z původní ceny a navyš o inflaci.',
  always_rules = array[
    'Vždy nejdřív zkontroluj, zda se díl (číslo výkresu) historicky nevyráběl — pokud ano, použij původní cenu + inflaci',
    'Vždy rozděl přesné rozměry dle tolerancí (≤0,005 / ≤0,01 / ≤0,04 / ≤0,1 mm) a zvlášť před a po tepelce',
    'Vždy započítej manipulaci a dopravu',
    'Vždy zohledni množství i zákazníka (zákaznický ceník)',
    'Vždy vyčísli materiál (z váhy polotovaru), úběr, operace a jejich časy, kooperace (povrch/tepelka) a marži zvlášť',
    'Při nejistotě sniž confidence a uveď, co je třeba upřesnit'
  ],
  never_rules = array[
    'Nikdy nevydávej odhad za závaznou cenu bez schválení člověka',
    'Nikdy nepodhodnocuj úzké tolerance, kalení a povrchové úpravy',
    'Nikdy nehádej materiál, váhu ani úpravy, pokud z výkresu nevyplývají — označ k doplnění',
    'Nikdy nepoužívej zahraniční měnu bez požadavku zákazníka'
  ]
where agent_key = 'pricing';
