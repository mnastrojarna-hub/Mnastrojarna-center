-- ============================================================
-- Kontakty (30. 10.): kontaktní osoby dodavatelů, e-maily podle účelu (fakturace / nákup / nabídky /
-- běžná komunikace) u zákazníka i dodavatele a tykání / vykání každého uživatele s každým kontaktem.
--  1) supplier_contacts — kontaktní osoby dodavatele (jméno, pozice, telefon, e-mail) jako u zákazníka;
--     starý jediný údaj suppliers.contact_person (+ e-mail, telefon) se převede na kontaktní osobu.
--     customer_contacts dostane updated_at; customers.contact_person se stejně převede na kontakt.
--  2) party_role_emails — „kam co posílat": role fakturace | nakup | nabidky | komunikace u zákazníka
--     (customer_id) nebo dodavatele (supplier_id). Položka = kontaktní osoba (contact_id /
--     supplier_contact_id — e-mail se bere z ní, změna adresy se tak propíše) nebo samotná adresa
--     (email). Víc adres na roli, jedna výchozí. Zdroj: manual | ai (AI ji našla v poště / dokladu) |
--     migrace. Viditelnost = viditelnost zákazníka / dodavatele (RLS přes jejich tabulky).
--  3) contact_tone — tykání / vykání, oslovení a tón: VŽDY za jednoho uživatele (user_id) a jednu
--     adresu (email, malými písmeny). Volný si s Novákem tyká, Šponer ne. Každý čte a mění jen své řádky.
--     AI texty odesílané pod jménem uživatele (návrhy odpovědí, e-maily k dokladům, objednávky…) se
--     řídí nastavením ODESÍLATELE pro hlavního adresáta. Výchozí bez řádku = vykání, formální tón.
-- Zapisuje hlavně aplikace (servisní klíč, viditelnost hlídá server); RLS pro přímý přístup.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

-- ── 1) Kontaktní osoby ──────────────────────────────────────
alter table customer_contacts add column if not exists updated_at timestamptz not null default now();

create table if not exists supplier_contacts (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references suppliers(id) on delete cascade,
  name        text not null,
  position    text,
  email       text,
  phone       text,
  is_primary  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references profiles(id) on delete set null,
  updated_by  uuid references profiles(id) on delete set null
);
create index if not exists idx_supplier_contacts_supplier on supplier_contacts(supplier_id);
create index if not exists idx_supplier_contacts_email on supplier_contacts(lower(email)) where email is not null;
create index if not exists idx_customer_contacts_email on customer_contacts(lower(email)) where email is not null;

comment on table supplier_contacts is 'Kontaktní osoby dodavatele (jméno, pozice, telefon, e-mail) — jako customer_contacts';

alter table supplier_contacts enable row level security;
drop policy if exists "supplier_contacts_all" on supplier_contacts;
create policy "supplier_contacts_all" on supplier_contacts
  for all using (is_active_user() and exists (select 1 from suppliers s where s.id = supplier_id))
  with check (is_active_user() and exists (select 1 from suppliers s where s.id = supplier_id));
grant select, insert, update, delete on supplier_contacts to authenticated;
grant all on supplier_contacts to service_role;

-- kdo kontakt založil / změnil (stejně jako customer_contacts)
do $$ begin
  if exists (select 1 from pg_proc where proname = 'set_row_actor') then
    drop trigger if exists trg_supplier_contacts_actor on supplier_contacts;
    create trigger trg_supplier_contacts_actor before insert or update on supplier_contacts
      for each row execute function set_row_actor();
  end if;
end $$;

-- updated_at
create or replace function contacts_touch_updated() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_customer_contacts_touch on customer_contacts;
create trigger trg_customer_contacts_touch before update on customer_contacts
  for each row execute function contacts_touch_updated();
drop trigger if exists trg_supplier_contacts_touch on supplier_contacts;
create trigger trg_supplier_contacts_touch before update on supplier_contacts
  for each row execute function contacts_touch_updated();

-- převod starého jediného údaje „Kontaktní osoba" na kontaktní osobu (jen když tam ještě není)
insert into customer_contacts (customer_id, name, email, phone, is_primary)
select c.id, btrim(c.contact_person),
       case when not exists (select 1 from customer_contacts k where k.customer_id = c.id) then nullif(lower(btrim(c.email)), '') end,
       case when not exists (select 1 from customer_contacts k where k.customer_id = c.id) then nullif(btrim(c.phone), '') end,
       not exists (select 1 from customer_contacts k where k.customer_id = c.id and k.is_primary)
from customers c
where nullif(btrim(c.contact_person), '') is not null
  and not exists (select 1 from customer_contacts k where k.customer_id = c.id and lower(btrim(k.name)) = lower(btrim(c.contact_person)));

insert into supplier_contacts (supplier_id, name, email, phone, is_primary)
select s.id, btrim(s.contact_person),
       case when not exists (select 1 from supplier_contacts k where k.supplier_id = s.id) then nullif(lower(btrim(s.email)), '') end,
       case when not exists (select 1 from supplier_contacts k where k.supplier_id = s.id) then nullif(btrim(s.phone), '') end,
       not exists (select 1 from supplier_contacts k where k.supplier_id = s.id and k.is_primary)
from suppliers s
where nullif(btrim(s.contact_person), '') is not null
  and not exists (select 1 from supplier_contacts k where k.supplier_id = s.id and lower(btrim(k.name)) = lower(btrim(s.contact_person)));

-- ── 2) E-maily podle účelu ──────────────────────────────────
create table if not exists party_role_emails (
  id                  uuid primary key default gen_random_uuid(),
  customer_id         uuid references customers(id) on delete cascade,
  supplier_id         uuid references suppliers(id) on delete cascade,
  role                text not null,
  contact_id          uuid references customer_contacts(id) on delete cascade,
  supplier_contact_id uuid references supplier_contacts(id) on delete cascade,
  email               text,
  is_default          boolean not null default false,
  source              text not null default 'manual',
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references profiles(id) on delete set null,
  updated_by          uuid references profiles(id) on delete set null
);

do $$ begin
  alter table party_role_emails add constraint party_role_emails_check check (
    (customer_id is null) <> (supplier_id is null)
    and role in ('fakturace', 'nakup', 'nabidky', 'komunikace')
    and source in ('manual', 'ai', 'migrace')
    and (contact_id is null or customer_id is not null)
    and (supplier_contact_id is null or supplier_id is not null)
    and (contact_id is not null or supplier_contact_id is not null or nullif(btrim(email), '') is not null)
  );
exception when duplicate_object then null; end $$;

comment on table party_role_emails is
  'Kam co posílat: e-maily zákazníka / dodavatele podle účelu (fakturace, nakup, nabidky, komunikace) — kontakt nebo adresa, jedna výchozí na roli';

create index if not exists idx_party_role_emails_customer on party_role_emails(customer_id, role) where customer_id is not null;
create index if not exists idx_party_role_emails_supplier on party_role_emails(supplier_id, role) where supplier_id is not null;
create unique index if not exists uq_party_role_default_customer on party_role_emails(customer_id, role) where is_default and customer_id is not null;
create unique index if not exists uq_party_role_default_supplier on party_role_emails(supplier_id, role) where is_default and supplier_id is not null;
create unique index if not exists uq_party_role_customer_entry
  on party_role_emails(customer_id, role, coalesce(contact_id::text, lower(btrim(email)))) where customer_id is not null;
create unique index if not exists uq_party_role_supplier_entry
  on party_role_emails(supplier_id, role, coalesce(supplier_contact_id::text, lower(btrim(email)))) where supplier_id is not null;

-- adresa malými písmeny; kontaktní osoba musí patřit stejnému zákazníkovi / dodavateli
create or replace function party_role_emails_before() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  if new.contact_id is not null then
    new.email := null;
    if not exists (select 1 from customer_contacts k where k.id = new.contact_id and k.customer_id = new.customer_id) then
      raise exception 'Kontaktní osoba nepatří k tomuto zákazníkovi.' using errcode = '23514';
    end if;
  end if;
  if new.supplier_contact_id is not null then
    new.email := null;
    if not exists (select 1 from supplier_contacts k where k.id = new.supplier_contact_id and k.supplier_id = new.supplier_id) then
      raise exception 'Kontaktní osoba nepatří k tomuto dodavateli.' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_party_role_emails_before on party_role_emails;
create trigger trg_party_role_emails_before before insert or update on party_role_emails
  for each row execute function party_role_emails_before();

do $$ begin
  if exists (select 1 from pg_proc where proname = 'set_row_actor') then
    drop trigger if exists trg_party_role_emails_actor on party_role_emails;
    create trigger trg_party_role_emails_actor before insert or update on party_role_emails
      for each row execute function set_row_actor();
  end if;
end $$;

alter table party_role_emails enable row level security;
drop policy if exists "party_role_emails_all" on party_role_emails;
-- viditelnost = viditelnost zákazníka / dodavatele (jejich RLS se uplatní v poddotazu)
create policy "party_role_emails_all" on party_role_emails
  for all using (
    is_active_user()
    and (customer_id is null or exists (select 1 from customers c where c.id = customer_id))
    and (supplier_id is null or exists (select 1 from suppliers s where s.id = supplier_id)))
  with check (
    is_active_user()
    and (customer_id is null or exists (select 1 from customers c where c.id = customer_id))
    and (supplier_id is null or exists (select 1 from suppliers s where s.id = supplier_id)));
grant select, insert, update, delete on party_role_emails to authenticated;
grant all on party_role_emails to service_role;

-- ── 3) Tykání / vykání (za uživatele a adresu) ──────────────
create table if not exists contact_tone (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  email       text not null,
  address     text not null default 'vy',
  tone        text not null default 'formalni',
  salutation  text,
  source      text not null default 'manual',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
do $$ begin
  alter table contact_tone add constraint contact_tone_check check (
    address in ('ty', 'vy') and tone in ('formalni', 'neutralni', 'pratelsky') and source in ('manual', 'navrh')
    and length(email) between 3 and 320 and (salutation is null or length(salutation) <= 120));
exception when duplicate_object then null; end $$;
create unique index if not exists uq_contact_tone_user_email on contact_tone(user_id, email);

comment on table contact_tone is
  'Tykání / vykání, oslovení a tón uživatele (user_id) s adresátem (email) — řídí AI texty odesílané pod jeho jménem';

create or replace function contact_tone_before() returns trigger
language plpgsql set search_path = public as $$
begin
  new.email := lower(btrim(new.email));
  new.salutation := nullif(btrim(coalesce(new.salutation, '')), '');
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists trg_contact_tone_before on contact_tone;
create trigger trg_contact_tone_before before insert or update on contact_tone
  for each row execute function contact_tone_before();

alter table contact_tone enable row level security;
drop policy if exists "contact_tone_own" on contact_tone;
create policy "contact_tone_own" on contact_tone
  for all using (is_active_user() and user_id = auth.uid())
  with check (is_active_user() and user_id = auth.uid());
grant select, insert, update, delete on contact_tone to authenticated;
grant all on contact_tone to service_role;

-- ── 4) Našeptávač adres z konverzací ────────────────────────
-- Adresy z hlaviček e-mailů (Od / Komu / Kopie), které uživatel smí vidět (super admin vše, ostatní pošta
-- jeho schránek a přiřazená jemu — stejné pravidlo jako src/lib/email/visibility.ts), seřazené podle
-- četnosti a poslední zprávy. Bez vlastních adres uživatele. Volá jen server (servisní klíč) — p_user /
-- p_all ověřil server; přímo přes REST nejde (žádné execute pro anon / authenticated).
create or replace function mail_address_suggest(p_q text, p_user uuid, p_all boolean, p_limit int default 12)
returns table(email text, name text, hits int, last_at timestamptz)
language sql stable security definer set search_path = public as $$
  with q as (select lower(btrim(coalesce(p_q, ''))) as s),
  vis as (
    select e.from_name, e.from_email, e.to_email, e.cc_email, e.received_at
    from emails e, q
    where (p_all or e.owner_id = p_user or e.mailbox_id in (select m.id from mailboxes m where m.owner_id = p_user))
      and not e.is_spam
      and (q.s = '' or (coalesce(e.from_name, '') || ' ' || coalesce(e.from_email, '') || ' ' || coalesce(e.to_email, '')
                        || ' ' || coalesce(e.cc_email, '')) ilike '%' || q.s || '%')
    order by e.received_at desc
    limit 3000
  ),
  tok as (
    select btrim(t) as t, v.received_at
    from vis v, regexp_split_to_table(coalesce(v.to_email, '') || ',' || coalesce(v.cc_email, ''), '[,;]') as t
    where position('@' in t) > 0
  ),
  addr as (
    select lower(substring(t from '[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')) as email,
           nullif(btrim(regexp_replace(t, '<[^>]*>|[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '', 'g'), ' "''<>'), '') as name,
           received_at
    from tok
    union all
    select lower(substring(v.from_email from '[A-Za-z0-9._%+''-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')), nullif(btrim(v.from_name, ' "'''), ''), v.received_at
    from vis v where v.from_email is not null
  )
  select a.email,
         (array_agg(a.name order by a.received_at desc) filter (where a.name is not null and position('@' in a.name) = 0))[1],
         count(*)::int, max(a.received_at)
  from addr a, q
  where a.email is not null
    and (q.s = '' or a.email ilike '%' || q.s || '%' or coalesce(a.name, '') ilike '%' || q.s || '%')
    and a.email not in (select lower(m.email) from mailboxes m where m.owner_id = p_user)
    and a.email not in (select lower(p.email) from profiles p where p.id = p_user and p.email is not null)
  group by a.email
  order by count(*) desc, max(a.received_at) desc
  limit greatest(1, least(coalesce(p_limit, 12), 50))
$$;
revoke execute on function mail_address_suggest(text, uuid, boolean, int) from public, anon, authenticated;
grant execute on function mail_address_suggest(text, uuid, boolean, int) to service_role;
