-- ============================================================
-- 0019 — Kniha zakázek: zakázka jako páteř celého obchodního toku
--
-- Zakázka (tabulka orders) spojuje vše: poptávku, nacenění, více
-- nabídek, objednávku zákazníka, potvrzení, dodavatele, dodací listy,
-- faktury, výkresy a 3D modely. Každý doklad je v jednom řádku knihy.
--
--  * job_stage — nové stavy zakázky (barvy definuje aplikace)
--  * termíny: požadovaný zákazníkem / předpokládaný / slíbený
--    dodavatelem / maximální tolerovaný / potvrzený zákazníkovi
--  * osoby: obchodník, kdo zadal, kdo zpracovává, kdo nacenil, kdo schválil
--  * více nabídek na zakázku (verze, kdo zadal, kdo schválil)
--  * dokumenty zakázky s verzováním a archivem (job_files)
--  * historie zakázky (job_events)
--  * vlastník e-mailové schránky (každý vidí jen svou poštu)
--  * přístup k AI per uživatel + hlavní vypínač
--  * obnova hesla kódem z e-mailu (password_reset_codes)
--  * bezpečnost: registrace bez pozvánky = neaktivní účet, role jen od admina
-- ============================================================

-- ── 1) Stavy zakázky ────────────────────────────────────────
do $$ begin
  create type job_stage as enum (
    'poptavka',            -- Poptávka
    'naceneni',            -- Nacenění
    'nabidka',             -- Nabídka odeslaná
    'objednavka',          -- Objednávka přijata
    'potvrzeno',           -- Potvrzená objednávka
    've_vyrobe',           -- Ve výrobě / u dodavatele
    'dodano_k_nam',        -- Dodáno k nám
    'na_sklade',           -- Na skladě (speciální)
    'montaz',              -- Montáž (speciální)
    'dodano_zakaznikovi',  -- Dodáno zákazníkovi
    'fakturovano',         -- Vyfakturováno
    'dokonceno',           -- Dokončeno / uzavřeno
    'pozastaveno',         -- Pozastaveno (speciální)
    'reklamace',           -- Reklamace (speciální)
    'nerealizovano',       -- Nerealizováno — zákazník neobjednal
    'zruseno'              -- Zrušeno
  );
exception when duplicate_object then null; end $$;

-- Převod sloupce orders.status ze starého enumu order_status na job_stage
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name = 'status' and udt_name = 'order_status'
  ) then
    alter table orders alter column status drop default;
    alter table orders alter column status type job_stage using (
      case status::text
        when 'prijato'    then 'objednavka'
        when 'naceneni'   then 'naceneni'
        when 'objednano'  then 'potvrzeno'
        when 've_vyrobe'  then 've_vyrobe'
        when 'expedovano' then 'dodano_zakaznikovi'
        when 'dokonceno'  then 'dokonceno'
        when 'zruseno'    then 'zruseno'
        else 'poptavka'
      end
    )::job_stage;
  end if;
end $$;
alter table orders alter column status set default 'poptavka';

-- Starý enum už nic nepoužívá
do $$ begin
  drop type if exists order_status;
exception when dependent_objects_still_exist then null; end $$;

-- ── 2) Čísla dokladů: bez ořezu nad 999 (lpad dříve řezal) ──
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
  return p_prefix || '-' || y || '-' || lpad(n::text, greatest(3, length(n::text)), '0');
end $$;

-- Naše pořadové číslo zakázky: Z-2026-001, Z-2026-002, …
create or replace function next_job_number()
returns text language sql as $$
  select next_doc_number('Z');
$$;

-- ── 3) Zakázka (orders) — termíny, osoby, obchodní údaje ────
alter table orders add column if not exists customer_order_number   text;  -- číslo objednávky zákazníka
alter table orders add column if not exists customer_inquiry_number text;  -- číslo poptávky zákazníka
alter table orders add column if not exists customer_contact        text;  -- kontaktní osoba u zákazníka
alter table orders add column if not exists customer_contact_email  text;
alter table orders add column if not exists customer_contact_phone  text;

alter table orders add column if not exists inquiry_date            date;  -- datum poptávky
alter table orders add column if not exists order_date              date;  -- datum objednávky zákazníka
alter table orders add column if not exists customer_required_date  date;  -- požadovaný termín zákazníkem
alter table orders add column if not exists expected_delivery_date  date;  -- předpokládaný termín dodání
alter table orders add column if not exists supplier_promised_date  date;  -- slíbený termín od dodavatele
alter table orders add column if not exists max_tolerated_date      date;  -- maximální tolerovaný termín
-- due_date (již existuje) = potvrzený termín dodání zákazníkovi
alter table orders add column if not exists received_at             timestamptz; -- skutečně dodáno k nám
alter table orders add column if not exists invoiced_at             timestamptz; -- vyfakturováno
alter table orders add column if not exists stage_changed_at        timestamptz not null default now();

alter table orders add column if not exists created_by   uuid references profiles(id) on delete set null; -- kdo zakázku zadal
alter table orders add column if not exists assignee_id  uuid references profiles(id) on delete set null; -- kdo ji zpracovává
alter table orders add column if not exists priced_by    uuid references profiles(id) on delete set null; -- kdo nacenil
alter table orders add column if not exists approved_by  uuid references profiles(id) on delete set null; -- kdo schválil
alter table orders add column if not exists approved_at  timestamptz;

alter table orders add column if not exists purchase_cost          numeric(14,2); -- nákupní náklady (dodavatel/kooperace)
alter table orders add column if not exists supplier_order_number  text;          -- naše objednávka u dodavatele
alter table orders add column if not exists invoice_number         text;
alter table orders add column if not exists delivery_note_number   text;
alter table orders add column if not exists priority  priority_level not null default 'stredni';
alter table orders add column if not exists note      text;                          -- interní poznámka
alter table orders add column if not exists tags      text[] not null default '{}';
alter table orders add column if not exists source    text not null default 'manual';
alter table orders add column if not exists email_id  uuid references emails(id) on delete set null;
alter table orders add column if not exists ai_filled boolean not null default false;
alter table orders add column if not exists ai_confidence numeric(4,3);

do $$ begin
  alter table orders add constraint orders_source_check
    check (source in ('manual', 'foto', 'email', 'import', 'ai'));
exception when duplicate_object then null; end $$;

create index if not exists idx_orders_customer_order_no on orders(customer_order_number);
create index if not exists idx_orders_required_date on orders(customer_required_date);
create index if not exists idx_orders_created on orders(created_at desc);
create index if not exists idx_orders_assignee on orders(assignee_id);

update orders set created_by = owner_id where created_by is null and owner_id is not null;

-- Změna stavu → časová razítka (jednotně pro UI, AI i import)
create or replace function orders_stage_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    new.stage_changed_at := now();
    if new.status = 'potvrzeno' and new.confirmed_at is null then new.confirmed_at := now(); end if;
    if new.status = 've_vyrobe' and new.production_started_at is null then new.production_started_at := now(); end if;
    if new.status = 'dodano_k_nam' and new.received_at is null then new.received_at := now(); end if;
    if new.status = 'dodano_zakaznikovi' and new.delivered_at is null then new.delivered_at := now(); end if;
    if new.status = 'fakturovano' and new.invoiced_at is null then new.invoiced_at := now(); end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_stage on orders;
create trigger trg_orders_stage
  before insert or update on orders
  for each row execute function orders_stage_change();

-- ── 4) Položky zakázky ──────────────────────────────────────
alter table order_items add column if not exists drawing_number      text;
alter table order_items add column if not exists revision            text;
alter table order_items add column if not exists name                text;
alter table order_items add column if not exists material            text;
alter table order_items add column if not exists unit                text not null default 'ks';
alter table order_items add column if not exists purchase_unit_price numeric(14,2);
alter table order_items add column if not exists note                text;
alter table order_items add column if not exists created_at          timestamptz not null default now();
-- Množství i v kg / m (materiál, kooperace) — ne jen celé kusy
alter table order_items alter column quantity type numeric(12,3);
create index if not exists idx_order_items_drawing on order_items(drawing_number);

-- ── 5) Nabídky — více nabídek (verzí) na zakázku ────────────
alter table quotes add column if not exists job_id        uuid references orders(id) on delete set null;
alter table quotes add column if not exists revision      int not null default 1;
alter table quotes add column if not exists title         text;
alter table quotes add column if not exists created_by    uuid references profiles(id) on delete set null; -- kdo nabídku zadal
alter table quotes add column if not exists approved_by   uuid references profiles(id) on delete set null; -- kdo ji schválil
alter table quotes add column if not exists approved_at   timestamptz;
alter table quotes add column if not exists lead_time_days int;
alter table quotes add column if not exists delivery_terms text;
alter table quotes add column if not exists payment_terms  text;
alter table quotes add column if not exists archived      boolean not null default false; -- nahrazena novější verzí
alter table quotes add column if not exists storage_path  text;
create index if not exists idx_quotes_job on quotes(job_id);

update quotes q set job_id = o.id from orders o where o.quote_id = q.id and q.job_id is null;
update quotes set created_by = owner_id where created_by is null and owner_id is not null;

alter table quote_items add column if not exists drawing_number      text;
alter table quote_items add column if not exists name                text;
alter table quote_items add column if not exists material            text;
alter table quote_items add column if not exists unit                text not null default 'ks';
alter table quote_items add column if not exists vat_rate            numeric(5,2) not null default 21;
alter table quote_items add column if not exists purchase_unit_price numeric(14,2);
alter table quote_items add column if not exists note                text;
alter table quote_items alter column quantity type numeric(12,3);

-- ── 6) Zákazníci a dodavatelé — čísla a adresy pro doklady ──
alter table customers add column if not exists customer_number             text;  -- naše číslo zákazníka (ZK0001)
alter table customers add column if not exists supplier_number_at_customer text;  -- naše číslo dodavatele u zákazníka
alter table customers add column if not exists street           text;
alter table customers add column if not exists city             text;
alter table customers add column if not exists zip              text;
alter table customers add column if not exists contact_person   text;
alter table customers add column if not exists website          text;
alter table customers add column if not exists payment_terms_days int;
alter table customers add column if not exists delivery_address text;

create sequence if not exists customer_number_seq;
create or replace function next_customer_number()
returns text language sql as $$
  select 'ZK' || lpad(n::text, greatest(4, length(n::text)), '0')
  from (select nextval('customer_number_seq') as n) s;
$$;

do $$
declare r record;
begin
  for r in select id from customers where customer_number is null order by created_at loop
    update customers set customer_number = next_customer_number() where id = r.id;
  end loop;
end $$;
alter table customers alter column customer_number set default next_customer_number();
create unique index if not exists uq_customers_number on customers(customer_number) where customer_number is not null;
create index if not exists idx_customers_ico on customers(ico);

alter table suppliers add column if not exists ico            text;
alter table suppliers add column if not exists dic            text;
alter table suppliers add column if not exists contact_person text;
alter table suppliers add column if not exists website        text;
alter table suppliers add column if not exists address        text;

-- ── 7) Dokumenty zakázky (výkresy, modely, nabídky, objednávky…) ──
do $$ begin
  create type job_file_kind as enum (
    'poptavka', 'naceneni', 'nabidka', 'objednavka', 'potvrzeni', 'vykres', 'model_3d',
    'dodaci_list', 'faktura', 'foto', 'korespondence', 'ostatni'
  );
exception when duplicate_object then null; end $$;

create table if not exists job_files (
  id            uuid primary key default uuid_generate_v4(),
  job_id        uuid not null references orders(id) on delete cascade,
  kind          job_file_kind not null default 'ostatni',
  title         text,
  filename      text not null,
  mime_type     text,
  size_bytes    bigint,
  storage_path  text not null,
  version       int not null default 1,
  archived      boolean not null default false,          -- nahrazeno novější verzí / ručně archivováno
  replaced_by   uuid references job_files(id) on delete set null,
  quote_id      uuid references quotes(id) on delete set null,
  drawing_id    uuid references drawings(id) on delete set null,
  ai_extracted  jsonb,                                     -- co AI z dokladu přečetla
  ai_confidence numeric(4,3),
  note          text,
  uploaded_by   uuid references profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_job_files_job on job_files(job_id, created_at desc);
create index if not exists idx_job_files_kind on job_files(kind);

-- ── 8) Historie zakázky ─────────────────────────────────────
create table if not exists job_events (
  id          uuid primary key default uuid_generate_v4(),
  job_id      uuid not null references orders(id) on delete cascade,
  type        text not null,          -- created | stage | field | file | quote | comment | ai | email
  message     text not null,
  data        jsonb not null default '{}',
  actor_id    uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_job_events_job on job_events(job_id, created_at desc);

-- ── 9) Učení AI z ručně i automaticky vyplněných dokladů ────
create table if not exists ai_training_examples (
  id          uuid primary key default uuid_generate_v4(),
  kind        text not null default 'capture',
  job_id      uuid references orders(id) on delete set null,
  job_file_id uuid references job_files(id) on delete set null,
  doc_kind    text,
  source      text not null default 'ai',     -- ai | manual | corrected
  extracted   jsonb,                          -- výstup AI (pokud běžela)
  final       jsonb,                          -- finální údaje po kontrole člověkem
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ai_training_kind on ai_training_examples(kind, created_at desc);

do $$ begin
  alter table ai_training_examples add constraint ai_training_source_check
    check (source in ('ai', 'manual', 'corrected'));
exception when duplicate_object then null; end $$;

insert into ai_agent_rules (agent_key, label, instructions, always_rules, never_rules) values
(
  'capture',
  'Čtení dokladů z fotky (Kniha zakázek)',
  'Z fotky nebo PDF obchodního dokladu (poptávka, nabídka, objednávka, potvrzení, dodací list, faktura) vytáhni zákazníka, čísla dokladů, data, termíny a položky, aby se zakázka vyplnila sama a spárovala se správným řádkem v Knize zakázek.',
  array[
    'Čísla dokladů (objednávka, poptávka, nabídka, výkres) přepiš přesně znak po znaku',
    'Data vracej ve formátu RRRR-MM-DD',
    'Rozliš, kdo doklad vystavil — zákazník, my (Mnástrojárna), nebo dodavatel'
  ],
  array[
    'Nikdy nedomýšlej údaje, které na dokladu nejsou — nech prázdné a sniž confidence',
    'Nikdy nezaměňuj číslo výkresu za číslo objednávky'
  ]
)
on conflict (agent_key) do nothing;

-- ── 10) Uživatelé: přístup k AI, kontakty ───────────────────
alter table profiles add column if not exists ai_access    boolean not null default false;
alter table profiles add column if not exists phone        text;
alter table profiles add column if not exists position     text;   -- funkce (technolog, nákup…)
alter table profiles add column if not exists last_seen_at timestamptz;

insert into integration_settings (key, category, label, is_secret, value) values
  ('company_swift',      'firma',     'BIC / SWIFT banky',                                 false, null),
  ('ai_enabled',         'ai_access', 'AI zapnuto (hlavní vypínač)',                       false, 'true'),
  ('ai_capture_for_all', 'ai_access', 'AI čtení dokladů z fotky pro všechny uživatele',     false, 'false')
on conflict (key) do nothing;

-- Registrace bez pozvánky: role jen z app_metadata (nastavuje pouze servisní klíč),
-- účet bez pozvánky je neaktivní → nevidí žádná data, dokud ho admin neaktivuje.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  meta_role text := new.raw_app_meta_data->>'role';
begin
  insert into public.profiles (id, email, full_name, role, active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    case when meta_role in ('super_admin', 'obchodnik', 'zamestnanec')
         then meta_role::user_role else 'zamestnanec'::user_role end,
    coalesce((new.raw_app_meta_data->>'invited')::boolean, false)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- Roli, aktivitu, AI přístup a provize smí měnit jen super admin (nebo server).
create or replace function profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_super_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.ai_access is distinct from old.ai_access
       or new.commission_rate is distinct from old.commission_rate then
      raise exception 'Změnu role a oprávnění smí provést jen super admin.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_profiles_guard on profiles;
create trigger trg_profiles_guard
  before update on profiles
  for each row execute function profiles_guard();

create or replace function is_active_user()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select active from profiles where id = auth.uid()), false);
$$;

-- ── 11) Schránky mají vlastníka; e-maily směr (přijatá/odeslaná) ──
alter table mailboxes add column if not exists owner_id uuid references profiles(id) on delete set null;
create index if not exists idx_mailboxes_owner on mailboxes(owner_id);

alter table emails add column if not exists direction text not null default 'in';
alter table emails add column if not exists cc_email text;
do $$ begin
  alter table emails add constraint emails_direction_check check (direction in ('in', 'out'));
exception when duplicate_object then null; end $$;
create index if not exists idx_emails_mailbox on emails(mailbox_id, received_at desc);
create index if not exists idx_emails_direction on emails(direction);

-- ── 12) Obnova hesla kódem z e-mailu ────────────────────────
create table if not exists password_reset_codes (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  email       text not null,
  code_hash   text not null,               -- sha256(salt:code), nikdy ne čistý kód
  expires_at  timestamptz not null,
  attempts    int not null default 0,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists idx_reset_codes_email on password_reset_codes(email, created_at desc);
alter table password_reset_codes enable row level security;
-- Bez politik: čte a zapisuje pouze server se servisním klíčem.

-- ── 13) Úložiště souborů zakázek ────────────────────────────
insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', false)
on conflict (id) do nothing;

do $$ begin
  create policy "job_files_bucket_read" on storage.objects
    for select using (bucket_id = 'job-files' and auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "job_files_bucket_insert" on storage.objects
    for insert with check (bucket_id = 'job-files' and auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "job_files_bucket_update" on storage.objects
    for update using (bucket_id = 'job-files' and auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

-- ── 14) RLS — Kniha zakázek, zákazníci a dodavatelé pro všechny aktivní ──
-- (Aplikace čte přes servisní klíč a oprávnění hlídá sama; RLS je druhá pojistka.)
drop policy if exists "customers_select" on customers;
drop policy if exists "customers_insert" on customers;
drop policy if exists "customers_update" on customers;
create policy "customers_select" on customers for select using (is_active_user());
create policy "customers_insert" on customers for insert with check (is_active_user());
create policy "customers_update" on customers for update using (is_active_user());

drop policy if exists "contacts_all" on customer_contacts;
create policy "contacts_all" on customer_contacts
  for all using (is_active_user()) with check (is_active_user());

drop policy if exists "suppliers_select" on suppliers;
drop policy if exists "suppliers_write" on suppliers;
create policy "suppliers_select" on suppliers for select using (is_active_user());
create policy "suppliers_write" on suppliers
  for all using (is_active_user()) with check (is_active_user());

drop policy if exists "orders_select" on orders;
drop policy if exists "orders_write" on orders;
create policy "orders_select" on orders for select using (is_active_user());
create policy "orders_insert" on orders for insert with check (is_active_user());
create policy "orders_update" on orders for update using (is_active_user());
create policy "orders_delete" on orders for delete using (is_super_admin());

drop policy if exists "order_items_all" on order_items;
create policy "order_items_all" on order_items
  for all using (is_active_user()) with check (is_active_user());

drop policy if exists "quotes_select" on quotes;
drop policy if exists "quotes_write" on quotes;
create policy "quotes_select" on quotes for select using (is_active_user());
create policy "quotes_write" on quotes
  for all using (is_active_user()) with check (is_active_user());

drop policy if exists "quote_items_all" on quote_items;
create policy "quote_items_all" on quote_items
  for all using (is_active_user()) with check (is_active_user());

drop policy if exists "drawings_select" on drawings;
create policy "drawings_select" on drawings for select using (is_active_user());

drop policy if exists "documents_select" on documents;
create policy "documents_select" on documents for select using (is_active_user());

alter table job_files enable row level security;
alter table job_events enable row level security;
alter table ai_training_examples enable row level security;

create policy "job_files_select" on job_files for select using (is_active_user());
create policy "job_files_insert" on job_files for insert with check (is_active_user());
create policy "job_files_update" on job_files for update using (is_active_user());
create policy "job_files_delete" on job_files for delete using (is_super_admin());

create policy "job_events_select" on job_events for select using (is_active_user());
create policy "job_events_insert" on job_events for insert with check (is_active_user());
create policy "job_events_admin" on job_events for delete using (is_super_admin());

create policy "ai_training_select" on ai_training_examples for select using (is_super_admin());
create policy "ai_training_insert" on ai_training_examples for insert with check (is_active_user());

-- Pošta: každý vidí jen svou schránku, super admin vše
drop policy if exists "emails_select" on emails;
drop policy if exists "emails_write" on emails;
create policy "emails_select" on emails for select using (
  is_super_admin()
  or owner_id = auth.uid()
  or exists (select 1 from mailboxes m where m.id = emails.mailbox_id and m.owner_id = auth.uid())
);
create policy "emails_update" on emails for update using (
  is_super_admin()
  or owner_id = auth.uid()
  or exists (select 1 from mailboxes m where m.id = emails.mailbox_id and m.owner_id = auth.uid())
);
create policy "emails_insert" on emails for insert with check (is_super_admin());
create policy "emails_delete" on emails for delete using (is_super_admin());

drop policy if exists "email_attachments_all" on email_attachments;
create policy "email_attachments_all" on email_attachments
  for all using (exists (select 1 from emails e where e.id = email_id));

-- Znalostní databáze a AI ladění — zatím jen super admin
drop policy if exists "knowledge_select" on knowledge_documents;
drop policy if exists "knowledge_write" on knowledge_documents;
create policy "knowledge_select" on knowledge_documents for select using (is_super_admin());
create policy "knowledge_write" on knowledge_documents
  for all using (is_super_admin()) with check (is_super_admin());
