-- ============================================================
-- 0015 — Korekce AI: uživatel opraví výstup → AI se z toho učí
-- Korekce se vkládají do promptů jako "naučené korekce",
-- aby AI v plné automatice stejnou chybu neopakovala.
-- ============================================================

create table if not exists ai_corrections (
  id              uuid primary key default uuid_generate_v4(),
  agent_key       text not null,            -- email/pricing/quote/confirmation/extraction
  field           text,                     -- co se opravovalo (category, reply, price…)
  context         text,                     -- co AI vidělo (zkráceně)
  ai_value        text,                     -- chybný výstup AI
  corrected_value text not null,            -- správná hodnota od uživatele
  note            text,                     -- proč / pravidlo k zapamatování
  created_by      uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_corrections_agent on ai_corrections(agent_key, created_at desc);

alter table ai_corrections enable row level security;

create policy "corrections_select" on ai_corrections
  for select using (is_obchodnik_or_admin());
create policy "corrections_write" on ai_corrections
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
