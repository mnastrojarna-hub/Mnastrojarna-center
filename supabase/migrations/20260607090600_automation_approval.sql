-- ============================================================
-- 0007 — Režim automatizace + fronta ke schválení
-- ============================================================

-- Per-modul nastavení režimu (full / approval)
create table if not exists automation_settings (
  module      text primary key,             -- 'categorize', 'reply', 'quote', ...
  mode        automation_mode not null default 'approval',
  enabled     boolean not null default true,
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

-- Globální výchozí režim (jeden řádek)
create table if not exists automation_global (
  id          boolean primary key default true check (id),
  mode        automation_mode not null default 'approval',
  updated_at  timestamptz not null default now()
);
insert into automation_global (id, mode) values (true, 'approval')
  on conflict (id) do nothing;

-- Fronta ke schválení — AI připraví akci, člověk schválí/upraví/zamítne
create table if not exists approval_queue (
  id            uuid primary key default uuid_generate_v4(),
  type          approval_type not null,
  title         text not null,
  summary       text,
  payload       jsonb not null default '{}',  -- návrh akce (tělo e-mailu, položky nabídky…)
  target        text,                          -- adresát / zákazník
  status        approval_status not null default 'pending',
  ai_confidence numeric(4,3),
  email_id      uuid references emails(id) on delete set null,
  quote_id      uuid references quotes(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  owner_id      uuid references profiles(id) on delete set null,
  resolved_by   uuid references profiles(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists idx_approval_status on approval_queue(status);
create index if not exists idx_approval_owner on approval_queue(owner_id);

alter table automation_settings enable row level security;
alter table automation_global enable row level security;
alter table approval_queue enable row level security;

create policy "automation_settings_read" on automation_settings
  for select using (is_obchodnik_or_admin());
create policy "automation_settings_admin" on automation_settings
  for all using (is_super_admin()) with check (is_super_admin());

create policy "automation_global_read" on automation_global
  for select using (is_obchodnik_or_admin());
create policy "automation_global_admin" on automation_global
  for all using (is_super_admin()) with check (is_super_admin());

create policy "approval_select" on approval_queue
  for select using (is_super_admin() or owner_id = auth.uid() or owner_id is null);
create policy "approval_write" on approval_queue
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());

-- Výchozí režimy modulů (doporučení dle CLAUDE.md)
insert into automation_settings (module, mode) values
  ('categorize', 'full'),
  ('spam', 'full'),
  ('reply', 'approval'),
  ('quote', 'approval'),
  ('supplier_request', 'approval'),
  ('order_match', 'full'),
  ('drawing_extract', 'full')
on conflict (module) do nothing;
