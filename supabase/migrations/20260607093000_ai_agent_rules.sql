-- ============================================================
-- 0009 — Pravidla AI agentů (řízení slovními příkazy)
-- VŽDY / NIKDY / pokyny pro agenty čtoucí a třídící poštu
-- ============================================================

create table if not exists ai_agent_rules (
  agent_key     text primary key,            -- 'email' = agent na čtení/třídění pošty
  label         text not null default '',
  instructions  text not null default '',    -- volný popis: co má agent dělat
  always_rules  text[] not null default '{}',-- co musí VŽDY
  never_rules   text[] not null default '{}',-- co nesmí NIKDY
  updated_by    uuid references profiles(id) on delete set null,
  updated_at    timestamptz not null default now()
);

create trigger trg_ai_agent_rules_updated
  before update on ai_agent_rules
  for each row execute function set_updated_at();

alter table ai_agent_rules enable row level security;

create policy "ai_rules_read" on ai_agent_rules
  for select using (is_obchodnik_or_admin());
create policy "ai_rules_admin" on ai_agent_rules
  for all using (is_super_admin()) with check (is_super_admin());

-- Výchozí pravidla pro agenta pošty
insert into ai_agent_rules (agent_key, label, instructions, always_rules, never_rules) values
(
  'email',
  'Agent pošty (čtení a třídění)',
  'Čti a třiď veškerou příchozí poštu nástrojárny Mnástrojárna. Ke každému e-mailu urči kategorii, prioritu a důležitost, propoj ho se zákazníkem nebo dodavatelem a u relevantních zpráv připrav návrh odpovědi.',
  array[
    'Odpovídej vždy česky, zdvořile a věcně',
    'Poptávky a reklamace označ vysokou prioritou',
    'Spam vždy rozpoznej a odfiltruj',
    'U firemních zpráv se vždy podepiš jako „Mnástrojárna s.r.o."'
  ],
  array[
    'Nikdy neodesílej nabídku s vymyšlenou cenou — cenu doplní člověk',
    'Nikdy neslibuj dodací termín, který není potvrzený',
    'Nikdy nemaž ani trvale neodstraňuj e-maily',
    'Nikdy nesděluj interní marže, provize ani citlivá obchodní data zákazníkům'
  ]
)
on conflict (agent_key) do nothing;
