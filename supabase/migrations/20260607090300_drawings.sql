-- ============================================================
-- 0004 — Archiv výkresů (s pgvector embeddingy)
-- ============================================================

create table if not exists drawings (
  id            uuid primary key default uuid_generate_v4(),
  drawing_number text not null,
  revision      text not null default 'A',
  customer_id   uuid references customers(id) on delete set null,
  material      text,
  dimensions    text,
  tolerances    text,
  quantity      int,
  file_type     text,                       -- PDF / STEP / DXF / IMG
  storage_path  text,                        -- Supabase Storage cesta
  ai_metadata   jsonb not null default '{}', -- co AI vytáhla (OCR/parse)
  embedding     vector(1536),                -- pro vyhledávání podobných dílů
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (drawing_number, revision)
);
create index if not exists idx_drawings_number on drawings(drawing_number);
create index if not exists idx_drawings_customer on drawings(customer_id);
create index if not exists idx_drawings_embedding on drawings
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create trigger trg_drawings_updated before update on drawings
  for each row execute function set_updated_at();

alter table drawings enable row level security;

create policy "drawings_select" on drawings
  for select using (is_obchodnik_or_admin());
create policy "drawings_write" on drawings
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());

-- ── Vyhledání podobných výkresů (RAG) ───────────────────────
create or replace function match_drawings(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (id uuid, drawing_number text, material text, similarity float)
language sql stable as $$
  select d.id, d.drawing_number, d.material,
         1 - (d.embedding <=> query_embedding) as similarity
  from drawings d
  where d.embedding is not null
  order by d.embedding <=> query_embedding
  limit match_count;
$$;
