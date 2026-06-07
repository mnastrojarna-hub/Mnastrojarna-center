-- ============================================================
-- 0011 — Reálné flow: výroba, dodání, fakturace + archiv dokladů
-- Tok: poptávka → potvrzení → nabídka → (zamítnutí|objednávka)
--      → potvrzení objednávky → výroba → dodání → faktura + DL
-- ============================================================

-- ── Nabídky: životní cyklus poptávka↔nabídka ────────────────
alter table quotes add column if not exists inquiry_received_at timestamptz;  -- přijatá poptávka
alter table quotes add column if not exists confirmed_at timestamptz;          -- potvrzení poptávky
alter table quotes add column if not exists sent_at timestamptz;               -- odeslání nabídky
alter table quotes add column if not exists feedback text;                     -- zpětná vazba zákazníka
alter table quotes add column if not exists rejected_reason text;              -- důvod zamítnutí

-- ── Objednávky: parametry výroby a dodání ───────────────────
alter table orders add column if not exists confirmed_at timestamptz;          -- potvrzení objednávky
alter table orders add column if not exists technology text;                   -- technologie výroby (frézování, soustružení…)
alter table orders add column if not exists manufacturing_location text;       -- kde se vyrábí (interně / kooperace / dodavatel)
alter table orders add column if not exists supplier_id uuid references suppliers(id) on delete set null;
alter table orders add column if not exists specific_requirements text;        -- specifické požadavky zákazníka
alter table orders add column if not exists production_started_at timestamptz;
alter table orders add column if not exists produced_at timestamptz;
alter table orders add column if not exists shipped_at timestamptz;
alter table orders add column if not exists delivered_at timestamptz;
alter table orders add column if not exists delivery_method text;              -- způsob dodání

-- ── Číselník dokladů: typy ──────────────────────────────────
do $$ begin
  create type document_type as enum ('nabidka', 'objednavka', 'potvrzeni', 'faktura', 'dodaci_list', 'vykres', 'ostatni');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('vystavena', 'odeslana', 'uhrazena', 'po_splatnosti', 'stornovana');
exception when duplicate_object then null; end $$;

-- ── Faktury (náležitosti dle českých zákonů) ────────────────
create table if not exists invoices (
  id              uuid primary key default uuid_generate_v4(),
  number          text unique,                  -- evidenční číslo daňového dokladu
  order_id        uuid references orders(id) on delete set null,
  customer_id     uuid references customers(id) on delete set null,
  variable_symbol text,
  issue_date      date not null default current_date,   -- datum vystavení
  taxable_date    date not null default current_date,   -- DUZP (datum uskutečnění zdanitelného plnění)
  due_date        date not null,                        -- datum splatnosti
  payment_method  text not null default 'bankovni_prevod',
  currency        text not null default 'CZK',
  subtotal        numeric(14,2) not null default 0,     -- základ daně
  vat_rate        numeric(5,2) not null default 21,     -- sazba DPH %
  vat_amount      numeric(14,2) not null default 0,     -- výše DPH
  total           numeric(14,2) not null default 0,     -- celkem k úhradě
  status          invoice_status not null default 'vystavena',
  note            text,
  storage_path    text,                                  -- PDF v Supabase Storage
  owner_id        uuid references profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_invoices_customer on invoices(customer_id);
create index if not exists idx_invoices_status on invoices(status);
create trigger trg_invoices_updated before update on invoices
  for each row execute function set_updated_at();

create table if not exists invoice_items (
  id          uuid primary key default uuid_generate_v4(),
  invoice_id  uuid not null references invoices(id) on delete cascade,
  description text not null,
  quantity    numeric(12,3) not null default 1,
  unit        text not null default 'ks',
  unit_price  numeric(14,2) not null default 0,
  vat_rate    numeric(5,2) not null default 21,
  position    int not null default 0
);
create index if not exists idx_invoice_items_invoice on invoice_items(invoice_id);

-- ── Dodací listy ────────────────────────────────────────────
create table if not exists delivery_notes (
  id           uuid primary key default uuid_generate_v4(),
  number       text unique,
  order_id     uuid references orders(id) on delete set null,
  customer_id  uuid references customers(id) on delete set null,
  issue_date   date not null default current_date,
  delivery_address text,
  note         text,
  storage_path text,
  created_at   timestamptz not null default now()
);

create table if not exists delivery_note_items (
  id               uuid primary key default uuid_generate_v4(),
  delivery_note_id uuid not null references delivery_notes(id) on delete cascade,
  description      text not null,
  quantity         numeric(12,3) not null default 1,
  unit             text not null default 'ks',
  position         int not null default 0
);

-- ── Jednotný archiv vystavených dokumentů ───────────────────
create table if not exists documents (
  id           uuid primary key default uuid_generate_v4(),
  doc_type     document_type not null,
  number       text,
  title        text,
  customer_id  uuid references customers(id) on delete set null,
  order_id     uuid references orders(id) on delete set null,
  quote_id     uuid references quotes(id) on delete set null,
  invoice_id   uuid references invoices(id) on delete set null,
  storage_path text,                              -- PDF / soubor v Supabase Storage
  total        numeric(14,2),
  issued_at    timestamptz not null default now(),
  created_by   uuid references profiles(id) on delete set null
);
create index if not exists idx_documents_type on documents(doc_type);
create index if not exists idx_documents_customer on documents(customer_id);
create index if not exists idx_documents_issued on documents(issued_at desc);

-- ── RLS ─────────────────────────────────────────────────────
alter table invoices enable row level security;
alter table invoice_items enable row level security;
alter table delivery_notes enable row level security;
alter table delivery_note_items enable row level security;
alter table documents enable row level security;

create policy "invoices_select" on invoices
  for select using (is_super_admin() or owner_id = auth.uid());
create policy "invoices_write" on invoices
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());

create policy "invoice_items_all" on invoice_items
  for all using (is_obchodnik_or_admin() and exists (select 1 from invoices i where i.id = invoice_id));

create policy "delivery_notes_all" on delivery_notes
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
create policy "delivery_note_items_all" on delivery_note_items
  for all using (is_obchodnik_or_admin() and exists (select 1 from delivery_notes d where d.id = delivery_note_id));

create policy "documents_select" on documents
  for select using (is_obchodnik_or_admin());
create policy "documents_write" on documents
  for all using (is_obchodnik_or_admin()) with check (is_obchodnik_or_admin());
