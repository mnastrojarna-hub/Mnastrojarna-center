-- ═══════════════════════════════════════════════════════════════════════════
--  Plný přístup (2. 11.) — majitel: „potřebuji Volnému a Šponerovi dát komplet práva na vše kromě mého
--  mailu a změny uživatelů … každý bude vidět jen svůj mail, jinak budou moci vše".
--
--  1) profiles.full_access (výchozí false; u super admina nemá význam): aplikace takového uživatele bere
--     jako super admina (obchodní tok všech, nacenění, marže, provize všech, schvalování, AI, nastavení,
--     mazání …) KROMĚ: pošty ostatních schránek (mail_all — vidí jen svou), správy schránek a správy
--     uživatelů (users). Rozhoduje src/lib/auth/permissions.ts (FULL_ACCESS_DENIED) + current-user.ts.
--  2) profiles_guard: full_access smí měnit jen super admin (nikdo si ho nezapne sám).
--  2b) app_actor_is_super_admin(): DB pojistky zápisů z našeho serveru (obchodník zakázky / zákazníka, schvalování
--     nabídek, platby, faktury dodavatelů …) berou plný přístup jako super admina — jinak by DB odmítla, co aplikace
--     dovolí. Pošta ani správa uživatelů na této funkci nestojí (hlídá je aplikace + profiles_guard / is_super_admin).
--  3) Jednorázově (značka full_access_v1): Vít Volný a Dominik Šponer → plný přístup + bez schvalování
--     nabídek, smí schvalovat nabídky ostatních, smí poptávat dodavatele, AI přístup.
--     Shoda podle e-mailu, jinak jména — jen když je právě jeden; jinak NOTICE a nastaví se ve Správě uživatelů.
-- ═══════════════════════════════════════════════════════════════════════════

alter table profiles add column if not exists full_access boolean not null default false;
comment on column profiles.full_access is
  'Plný přístup (2. 11.): vše jako super admin kromě pošty ostatních schránek a správy uživatelů. Mění jen super admin.';

-- ── 2) Ochrana: oprávnění mění jen super admin ───────────────
create or replace function profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_super_admin() then
    if new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.ai_access is distinct from old.ai_access
       or new.commission_rate is distinct from old.commission_rate
       or new.quote_needs_approval is distinct from old.quote_needs_approval
       or new.can_approve_quotes is distinct from old.can_approve_quotes
       or new.can_rfq is distinct from old.can_rfq
       or new.full_access is distinct from old.full_access then
      raise exception 'Změnu role a oprávnění smí provést jen super admin.';
    end if;
  end if;
  return new;
end $$;

-- ── 2b) DB pojistky: plný přístup = super admin ─────────────
create or replace function app_actor_is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (p.role = 'super_admin' or coalesce(p.full_access, false)) and p.active
                   from profiles p where p.id = app_actor()), false)
$$;

-- ── 3) Volný + Šponer (jednorázově) ──────────────────────────
do $$
declare
  v_new  boolean;
  v_who  record;
  v_ids  uuid[];
  v_rows text;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('full_access_v1', 'ai_access', 'Plný přístup — Volný a Šponer (2. 11.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Plný přístup: výchozí nastavení už proběhlo dřív — beze změny.';
    return;
  end if;

  for v_who in
    select * from (values
      ('Vít Volný',      'vit.volny@mnastrojarna.cz',      '%voln%'),
      ('Dominik Šponer', 'dominik.sponer@mnastrojarna.cz', '%sponer%')
    ) as t(label, email, pattern)
  loop
    select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
      into v_ids, v_rows
      from profiles p
     where lower(p.email) = v_who.email and p.role <> 'super_admin';
    if coalesce(array_length(v_ids, 1), 0) = 0 then
      select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
        into v_ids, v_rows
        from profiles p
       where p.role <> 'super_admin'
         and (p.email ilike v_who.pattern
              or translate(lower(p.full_name), 'áčďéěíňóřšťúůýž', 'acdeeinorstuuyz') ilike v_who.pattern);
    end if;
    if coalesce(array_length(v_ids, 1), 0) = 1 then
      -- trigger trg_profiles_quote_approval_after přepočte jeho čekající nabídky (už schválení nepotřebují)
      update profiles
         set full_access = true, quote_needs_approval = false, can_approve_quotes = true, can_rfq = true, ai_access = true
       where id = v_ids[1];
      raise notice 'Plný přístup: % — zapnut.', v_rows;
    else
      raise notice 'Plný přístup: % nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, zapni ve Správě uživatelů.',
        v_who.label, coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
    end if;
  end loop;
end $$;
