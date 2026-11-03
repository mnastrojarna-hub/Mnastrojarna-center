-- ============================================================
-- Kontaktní osoba zakázky = kontakt z Karty zákazníka (majitel 3. 11.)
--  * orders.customer_contact_id → customer_contacts(id): kontaktní osoba se na zakázce VYBÍRÁ ze
--    seznamu kontaktů zákazníka; e-mail a telefon jdou vždy s ní (nejde mít jméno jedné osoby
--    a telefon druhé). E-mail a telefon se mění jen v Kartě zákazníka.
--  * Textové sloupce customer_contact / _email / _phone zůstávají (doklady, pošta, AI, historie) —
--    u propojené zakázky je ale plní DB z kontaktu (jediná pravda):
--      - trg_orders_contact_guard: propojená zakázka → tři sloupce = hodnoty kontaktu; kontakt jiného
--        zákazníka (změna zákazníka) se odpojí; nepropojená zakázka s e-mailem, který má právě jeden
--        kontakt jejího zákazníka → propojí se (AI / focení / pošta vyplní text, vazba vznikne sama);
--      - trg_customer_contacts_sync_orders: úprava jména / e-mailu / telefonu v Kartě zákazníka se
--        propíše do všech propojených zakázek.
--  * Smazání kontaktu vazbu zruší (on delete set null) — text na zakázce zůstane jako starý údaj.
--  * Zpětně: existující zakázky se propojí s kontaktem svého zákazníka podle e-mailu (bez e-mailu
--    podle přesného jména), jen když je shoda jednoznačná.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

alter table orders add column if not exists customer_contact_id uuid references customer_contacts(id) on delete set null;
create index if not exists idx_orders_customer_contact on orders(customer_contact_id) where customer_contact_id is not null;
comment on column orders.customer_contact_id is
  'Kontaktní osoba zakázky z Karty zákazníka — jméno, e-mail a telefon (customer_contact*) plní DB z ní';

-- ── Pojistka na zakázce (jediná pravda = kontakt) ──────────
create or replace function orders_contact_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k customer_contacts%rowtype;
  v_email text;
  v_id uuid;
  v_n int;
begin
  if new.customer_contact_id is not null then
    select * into k from customer_contacts where id = new.customer_contact_id;
    if k.id is not null and new.customer_id is not null and k.customer_id = new.customer_id then
      new.customer_contact := k.name;
      new.customer_contact_email := k.email;
      new.customer_contact_phone := k.phone;
      return new;
    end if;
    -- kontakt jiného zákazníka (změna zákazníka) / neexistující → odpojit; údaje osoby zmizí s ní
    new.customer_contact_id := null;
    if tg_op = 'UPDATE' and old.customer_contact_id is not null
       and new.customer_contact is not distinct from old.customer_contact
       and new.customer_contact_email is not distinct from old.customer_contact_email
       and new.customer_contact_phone is not distinct from old.customer_contact_phone then
      new.customer_contact := null;
      new.customer_contact_email := null;
      new.customer_contact_phone := null;
    end if;
    return new;
  end if;

  -- nepropojená zakázka: e-mail jednoznačně patří kontaktu zákazníka → propojit
  v_email := lower(nullif(btrim(coalesce(new.customer_contact_email, '')), ''));
  if v_email is not null and new.customer_id is not null
     and (tg_op = 'INSERT'
          or new.customer_id is distinct from old.customer_id
          or new.customer_contact_email is distinct from old.customer_contact_email) then
    select count(*), (array_agg(id))[1] into v_n, v_id
      from customer_contacts where customer_id = new.customer_id and lower(btrim(email)) = v_email;
    if v_n = 1 then
      select * into k from customer_contacts where id = v_id;
      new.customer_contact_id := k.id;
      new.customer_contact := k.name;
      new.customer_contact_email := k.email;
      new.customer_contact_phone := k.phone;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_orders_contact_guard on orders;
create trigger trg_orders_contact_guard before insert or update on orders
  for each row execute function orders_contact_guard();

-- ── Úprava kontaktu v Kartě zákazníka → propojené zakázky ──
create or replace function customer_contacts_sync_orders() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update orders o
     set customer_contact = new.name,
         customer_contact_email = new.email,
         customer_contact_phone = new.phone
   where o.customer_contact_id = new.id
     and (o.customer_contact is distinct from new.name
          or o.customer_contact_email is distinct from new.email
          or o.customer_contact_phone is distinct from new.phone);
  return new;
end $$;

drop trigger if exists trg_customer_contacts_sync_orders on customer_contacts;
create trigger trg_customer_contacts_sync_orders after update of name, email, phone on customer_contacts
  for each row execute function customer_contacts_sync_orders();

-- ── Zpětné propojení (jen jednoznačné shody, jen dosud nepropojené) ──
-- údaje osoby se srovnají s kontaktem; bez spouštěčů zakázky (jako dřívější hromadné převody —
-- nehýbe „Změněno", tokem ani provizemi; FK zůstávají, vypínají se jen uživatelské spouštěče)
alter table orders disable trigger user;
with by_email as (
  select o.id as order_id, min(k.id::text)::uuid as contact_id, count(*) as n
    from orders o
    join customer_contacts k on k.customer_id = o.customer_id
     and lower(btrim(k.email)) = lower(btrim(o.customer_contact_email))
   where o.customer_contact_id is null
     and nullif(btrim(coalesce(o.customer_contact_email, '')), '') is not null
   group by o.id
), by_name as (
  select o.id as order_id, min(k.id::text)::uuid as contact_id, count(*) as n
    from orders o
    join customer_contacts k on k.customer_id = o.customer_id
     and lower(btrim(k.name)) = lower(btrim(o.customer_contact))
   where o.customer_contact_id is null
     and nullif(btrim(coalesce(o.customer_contact_email, '')), '') is null
     and nullif(btrim(coalesce(o.customer_contact, '')), '') is not null
   group by o.id
), pick as (
  select order_id, contact_id from by_email where n = 1
  union all
  select order_id, contact_id from by_name where n = 1
)
update orders o
   set customer_contact_id = k.id,
       customer_contact = k.name,
       customer_contact_email = k.email,
       customer_contact_phone = k.phone
  from pick p
  join customer_contacts k on k.id = p.contact_id
 where o.id = p.order_id and o.customer_contact_id is null;
alter table orders enable trigger user;
