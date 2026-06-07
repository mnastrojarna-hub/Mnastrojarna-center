-- ============================================================
-- 0014 — Pravidla AI agenta pro čtení z příloh (OCR/extrakce)
-- ============================================================

insert into ai_agent_rules (agent_key, label, instructions, always_rules, never_rules) values
(
  'extraction',
  'Čtení z příloh (výkresy, objednávky)',
  'Přečti přílohu (výkres, objednávku, poptávku — PDF i obrázek) a vytáhni strukturovaná data: typ dokumentu, číslo výkresu, materiál, rozměry, množství, zákazníka a specifické požadavky (tolerance, povrch, tepelné zpracování). Co nelze přečíst, nech prázdné a sniž confidence.',
  array[
    'Vždy přepiš číslo výkresu a revizi přesně tak, jak jsou na dokumentu',
    'Vždy rozpoznej tolerance, drsnost povrchu a tepelné zpracování',
    'Vždy uveď množství jako číslo (ks)'
  ],
  array[
    'Nikdy nedomýšlej údaje, které v dokumentu nejsou — nech prázdné',
    'Nikdy nezaměňuj číslo výkresu za číslo objednávky',
    'Nikdy nehádej materiál, pokud není uveden'
  ]
)
on conflict (agent_key) do nothing;
