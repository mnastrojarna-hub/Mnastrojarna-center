-- ============================================================
-- 0003 — CRM: zákazníci, kontakty, dodavatelé
-- ============================================================

create table if not exists customers (
  id          uuid primary key default uuid_generate_v4(),
  name        text not null,
  ico         text,
  dic         text,
  country     text not null default 'CZ',
  phone       text,
  email       text,
  address     text,
  note        text,
  owner_id    uuid references profiles(id) on delete set null,  -- obchodník
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_customers_owner on customers(owner_id);
create index if not exists idx_customers_name on customers using gin (to_tsvector('simple', name));
create trigger trg_customers_updated before update on customers
  for each row execute function set_updated_at();

create table if not exists customer_contacts (
  id          uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references customers(id) on delete cascade,
  name        text not null,
  position    text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists idx_contacts_customer on customer_contacts(customer_id);

create table if not exists suppliers (
  id            uuid primary key default uuid_generate_v4(),
  name          text not null,
  country       text not null default 'CZ',
  email         text,
  phone         text,
  technologies  text[] not null default '{}',
  materials     text[] not null default '{}',
  certifications text[] not null default '{}',
  lead_days     int,
  rating        numeric(2,1),
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_suppliers_materials on suppliers using gin (materials);
create trigger trg_suppliers_updated before update on suppliers
  for each row execute function set_updated_at();

-- ── RLS ─────────────────────────────────────────────────────
alter table customers enable row level security;
alter table customer_contacts enable row level security;
alter table suppliers enable row level security;

-- Zákazníci: obchodník vidí své, admin vše, zaměstnanec nic citlivého
create policy "customers_select" on customers
  for select using (is_super_admin() or owner_id = auth.uid());
create policy "customers_insert" on customers
  for insert with check (is_obchodnik_or_admin());
create policy "customers_update" on customers
  for update using (is_super_admin() or owner_id = auth.uid());
create policy "customers_delete" on customers
  for delete using (is_super_admin());

create policy "contacts_all" on customer_contacts
  for all using (
    is_super_admin() or exists (
      select 1 from customers c where c.id = customer_id and c.owner_id = auth.uid()
    )
  );

-- Dodavatelé: sdílená databáze pro obchodníky a admina
create policy "suppliers_select" on suppliers
  for select using (is_obchodnik_or_admin());
create policy "suppliers_write" on suppliers
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
