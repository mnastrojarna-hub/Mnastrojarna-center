-- ============================================================
-- 0008 — Provize, znalostní DB (RAG), audit log
-- ============================================================

-- ── Provize ─────────────────────────────────────────────────
create table if not exists commission_rules (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  rate        numeric(5,4) not null default 0,   -- % z marže/obratu
  base        text not null default 'margin',     -- 'margin' | 'revenue'
  valid_from  date not null default now(),
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists commission_entries (
  id          uuid primary key default uuid_generate_v4(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  order_id    uuid references orders(id) on delete set null,
  period      date not null,                       -- první den měsíce
  revenue     numeric(14,2) not null default 0,
  margin      numeric(14,2) not null default 0,
  rate        numeric(5,4) not null default 0,
  commission  numeric(14,2) not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists idx_commission_owner on commission_entries(owner_id, period);

-- ── Znalostní databáze (RAG nad historií) ───────────────────
create table if not exists knowledge_documents (
  id          uuid primary key default uuid_generate_v4(),
  source_type text not null,                       -- 'quote' | 'order' | 'invoice' | 'email'
  title       text,
  content     text,
  metadata    jsonb not null default '{}',
  embedding   vector(1536),
  created_at  timestamptz not null default now()
);
create index if not exists idx_knowledge_embedding on knowledge_documents
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create or replace function match_knowledge(
  query_embedding vector(1536),
  match_count int default 5,
  filter_source text default null
)
returns table (id uuid, title text, content text, source_type text, similarity float)
language sql stable as $$
  select k.id, k.title, k.content, k.source_type,
         1 - (k.embedding <=> query_embedding) as similarity
  from knowledge_documents k
  where k.embedding is not null
    and (filter_source is null or k.source_type = filter_source)
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

-- ── Audit log ───────────────────────────────────────────────
create table if not exists audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references profiles(id) on delete set null,
  action      text not null,                       -- 'insert' | 'update' | 'delete' | custom
  entity      text not null,                       -- název tabulky / modulu
  entity_id   text,
  diff        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_audit_entity on audit_log(entity, entity_id);
create index if not exists idx_audit_created on audit_log(created_at desc);

-- ── RLS ─────────────────────────────────────────────────────
alter table commission_rules enable row level security;
alter table commission_entries enable row level security;
alter table knowledge_documents enable row level security;
alter table audit_log enable row level security;

-- Provize: obchodník vidí jen své, admin vše (NIKDY ne provize ostatních)
create policy "commission_rules_select" on commission_rules
  for select using (is_super_admin() or owner_id = auth.uid());
create policy "commission_rules_admin" on commission_rules
  for all using (is_super_admin()) with check (is_super_admin());

create policy "commission_entries_select" on commission_entries
  for select using (is_super_admin() or owner_id = auth.uid());
create policy "commission_entries_admin" on commission_entries
  for all using (is_super_admin()) with check (is_super_admin());

create policy "knowledge_select" on knowledge_documents
  for select using (is_obchodnik_or_admin());
create policy "knowledge_write" on knowledge_documents
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());

create policy "audit_admin_read" on audit_log
  for select using (is_super_admin());
