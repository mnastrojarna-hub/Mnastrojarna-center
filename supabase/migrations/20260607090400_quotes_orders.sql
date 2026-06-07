-- ============================================================
-- 0005 — Nabídky a objednávky (zakázky) + položky
-- ============================================================

-- ── Sekvence pro čísla dokladů ──────────────────────────────
create table if not exists doc_counters (
  doc_type text primary key,
  year     int not null,
  counter  int not null default 0
);

create or replace function next_doc_number(p_prefix text)
returns text language plpgsql as $$
declare
  y int := extract(year from now());
  n int;
begin
  insert into doc_counters(doc_type, year, counter)
  values (p_prefix, y, 1)
  on conflict (doc_type) do update
    set counter = case when doc_counters.year = y then doc_counters.counter + 1 else 1 end,
        year = y
  returning counter into n;
  return p_prefix || '-' || y || '-' || lpad(n::text, 3, '0');
end $$;

-- ── Nabídky ─────────────────────────────────────────────────
create table if not exists quotes (
  id           uuid primary key default uuid_generate_v4(),
  number       text unique,
  customer_id  uuid references customers(id) on delete set null,
  status       quote_status not null default 'navrh_ai',
  currency     text not null default 'CZK',
  total        numeric(14,2),
  valid_until  date,
  note         text,
  ai_generated boolean not null default false,
  ai_confidence numeric(4,3),
  owner_id     uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_quotes_customer on quotes(customer_id);
create index if not exists idx_quotes_owner on quotes(owner_id);
create trigger trg_quotes_updated before update on quotes
  for each row execute function set_updated_at();

create table if not exists quote_items (
  id          uuid primary key default uuid_generate_v4(),
  quote_id    uuid not null references quotes(id) on delete cascade,
  drawing_id  uuid references drawings(id) on delete set null,
  description text,
  quantity    int not null default 1,
  unit_price  numeric(14,2),
  position    int not null default 0
);
create index if not exists idx_quote_items_quote on quote_items(quote_id);

-- ── Objednávky / zakázky ────────────────────────────────────
create table if not exists orders (
  id           uuid primary key default uuid_generate_v4(),
  number       text unique,
  customer_id  uuid references customers(id) on delete set null,
  quote_id     uuid references quotes(id) on delete set null,
  status       order_status not null default 'prijato',
  title        text,
  value        numeric(14,2),
  margin       numeric(5,4),
  currency     text not null default 'CZK',
  due_date     date,
  owner_id     uuid references profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_orders_customer on orders(customer_id);
create index if not exists idx_orders_owner on orders(owner_id);
create index if not exists idx_orders_status on orders(status);
create trigger trg_orders_updated before update on orders
  for each row execute function set_updated_at();

create table if not exists order_items (
  id          uuid primary key default uuid_generate_v4(),
  order_id    uuid not null references orders(id) on delete cascade,
  drawing_id  uuid references drawings(id) on delete set null,
  description text,
  quantity    int not null default 1,
  unit_price  numeric(14,2),
  position    int not null default 0
);
create index if not exists idx_order_items_order on order_items(order_id);

-- ── RLS ─────────────────────────────────────────────────────
alter table quotes enable row level security;
alter table quote_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;

create policy "quotes_select" on quotes
  for select using (is_super_admin() or owner_id = auth.uid());
create policy "quotes_write" on quotes
  for all using (is_super_admin() or owner_id = auth.uid())
  with check (is_obchodnik_or_admin());

create policy "quote_items_all" on quote_items
  for all using (
    is_super_admin() or exists (select 1 from quotes q where q.id = quote_id and q.owner_id = auth.uid())
  );

create policy "orders_select" on orders
  for select using (is_super_admin() or owner_id = auth.uid());
create policy "orders_write" on orders
  for all using (is_super_admin() or owner_id = auth.uid())
  with check (is_obchodnik_or_admin());

create policy "order_items_all" on order_items
  for all using (
    is_super_admin() or exists (select 1 from orders o where o.id = order_id and o.owner_id = auth.uid())
  );
