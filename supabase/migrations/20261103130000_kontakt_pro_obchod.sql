-- ============================================================
-- 20261103130000 — „Kontakt pro obchod a ceny" (3. 11.)
-- Majitel / Vít Volný: e-mail s nabídkou, kterou posílá technolog Dominik Šponer, má výrobní a technologické
-- dotazy směrovat na něj a obchodní záležitosti a ceny na obchodníka („Ohledně obchodních záležitostí a cen
-- se s Vámi rád spojí kolega pan Vít Volný. tel. … e-mail: …").
--
--  1) profiles.sales_contact_id — kolega, na kterého text e-mailu k nabídce odkáže obchod a ceny (jméno,
--     telefon a e-mail z jeho profilu). Bez nastavení = dosavadní text. Nastavuje super admin ve Správě
--     uživatelů. Smazání kolegy → null.
--  2) Jednorázově Šponer → Volný (podle e-mailu profilu; jen když ještě není nastaveno — změnu admina
--     nepřepíše). Když některý z účtů neexistuje, nic se nenastaví.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

alter table profiles add column if not exists sales_contact_id uuid references profiles(id) on delete set null;
comment on column profiles.sales_contact_id is
  'Kontakt pro obchod a ceny: kolega, na kterého e-mail k nabídce odkáže obchodní záležitosti a ceny (např. technolog → obchodník). Nastavuje super admin.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_sales_contact_not_self' and conrelid = 'public.profiles'::regclass
  ) then
    alter table profiles add constraint profiles_sales_contact_not_self
      check (sales_contact_id is null or sales_contact_id <> id);
  end if;
end $$;

update profiles s
   set sales_contact_id = v.id
  from profiles v
 where lower(s.email) = 'dominik.sponer@mnastrojarna.cz'
   and lower(v.email) = 'vit.volny@mnastrojarna.cz'
   and s.sales_contact_id is null
   and s.id <> v.id;
