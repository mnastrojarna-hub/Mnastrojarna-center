-- ============================================================
-- 0006 — E-maily a připojené schránky (AI Email Centrum)
-- ============================================================

create table if not exists mailboxes (
  id           uuid primary key default uuid_generate_v4(),
  provider     mailbox_provider not null,
  email        text not null,
  display_name text,
  config       jsonb not null default '{}',   -- host/port/oauth ref (tajné v secret store)
  active       boolean not null default true,
  last_sync_at timestamptz,
  created_at   timestamptz not null default now()
);

create table if not exists emails (
  id            uuid primary key default uuid_generate_v4(),
  mailbox_id    uuid references mailboxes(id) on delete set null,
  message_id    text,                          -- původní Message-ID
  thread_id     text,
  from_name     text,
  from_email    text,
  to_email      text,
  subject       text,
  body_text     text,
  body_html     text,
  snippet       text,
  category      email_category,
  priority      priority_level default 'stredni',
  importance    int default 0,                 -- 0–100 skóre AI
  ai_confidence numeric(4,3),
  ai_summary    text,
  customer_id   uuid references customers(id) on delete set null,
  supplier_id   uuid references suppliers(id) on delete set null,
  owner_id      uuid references profiles(id) on delete set null,
  quote_id      uuid references quotes(id) on delete set null,
  order_id      uuid references orders(id) on delete set null,
  is_read       boolean not null default false,
  is_spam       boolean not null default false,
  has_draft     boolean not null default false,
  received_at   timestamptz not null default now(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_emails_category on emails(category);
create index if not exists idx_emails_owner on emails(owner_id);
create index if not exists idx_emails_customer on emails(customer_id);
create index if not exists idx_emails_received on emails(received_at desc);
create unique index if not exists uq_emails_message on emails(mailbox_id, message_id);

create table if not exists email_attachments (
  id          uuid primary key default uuid_generate_v4(),
  email_id    uuid not null references emails(id) on delete cascade,
  filename    text,
  mime_type   text,
  size_bytes  bigint,
  storage_path text,
  drawing_id  uuid references drawings(id) on delete set null
);

-- ── RLS ─────────────────────────────────────────────────────
alter table mailboxes enable row level security;
alter table emails enable row level security;
alter table email_attachments enable row level security;

create policy "mailboxes_admin" on mailboxes
  for all using (is_super_admin()) with check (is_super_admin());

-- E-mail vidí přiřazený obchodník, admin vše
create policy "emails_select" on emails
  for select using (is_super_admin() or owner_id = auth.uid() or owner_id is null);
create policy "emails_write" on emails
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());

create policy "email_attachments_all" on email_attachments
  for all using (
    is_obchodnik_or_admin() and exists (select 1 from emails e where e.id = email_id)
  );
