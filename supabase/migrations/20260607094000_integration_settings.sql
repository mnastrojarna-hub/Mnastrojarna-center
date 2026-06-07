-- ============================================================
-- 0010 — Nastavení integrací (API klíče a konfigurace v aplikaci)
-- Umožní přidávat klíče (Claude, IMAP, Graph…) přes UI místo .env
-- ============================================================

create table if not exists integration_settings (
  key         text primary key,            -- např. 'anthropic_api_key', 'imap_host'
  value       text,                         -- hodnota (u tajných nevracet do klienta)
  is_secret   boolean not null default false,
  category    text not null default 'obecne',
  label       text not null default '',
  updated_by  uuid references profiles(id) on delete set null,
  updated_at  timestamptz not null default now()
);

create trigger trg_integration_settings_updated
  before update on integration_settings
  for each row execute function set_updated_at();

alter table integration_settings enable row level security;

-- Pouze super_admin čte i zapisuje (obsahuje tajné klíče)
create policy "integration_settings_admin" on integration_settings
  for all using (is_super_admin()) with check (is_super_admin());

-- Předdefinované klíče (prázdné hodnoty — doplní se přes UI)
insert into integration_settings (key, category, label, is_secret) values
  ('anthropic_api_key', 'ai', 'Claude API klíč (Anthropic)', true),
  ('anthropic_model', 'ai', 'Claude model', false),
  ('imap_host', 'email', 'IMAP host (hosting90)', false),
  ('imap_port', 'email', 'IMAP port', false),
  ('imap_user', 'email', 'IMAP uživatel', false),
  ('imap_password', 'email', 'IMAP heslo', true),
  ('smtp_host', 'email', 'SMTP host', false),
  ('smtp_port', 'email', 'SMTP port', false),
  ('smtp_user', 'email', 'SMTP uživatel', false),
  ('smtp_password', 'email', 'SMTP heslo', true),
  ('ms_graph_client_id', 'email', 'Microsoft Graph Client ID', false),
  ('ms_graph_client_secret', 'email', 'Microsoft Graph Client Secret', true),
  ('ms_graph_tenant_id', 'email', 'Microsoft Graph Tenant ID', false)
on conflict (key) do nothing;
