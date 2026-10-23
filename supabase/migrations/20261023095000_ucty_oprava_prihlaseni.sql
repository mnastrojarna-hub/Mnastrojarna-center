-- Oprava přihlašování účtů založených přímo v databázi (idempotentní).
--
-- 1) Textové tokeny v auth.users nesmí být NULL — GoTrue (Supabase Auth) by
--    jinak při přihlášení vrátil „Database error querying schema". Které sloupce
--    existují, záleží na verzi Auth, proto se berou z information_schema.
-- 2) Účty Víta Volného a Dominika Šponera (migrace 20261022110000): dokud si
--    uživatel heslo nezměnil a nikdy se nepřihlásil, platí počáteční heslo 123456
--    (stejný hash jako v původní migraci), potvrzený e-mail, žádný ban, identita
--    „email" a aktivní profil.

do $$
declare
  col text;
begin
  foreach col in array array[
    'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change',
    'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'auth' and table_name = 'users' and column_name = col
    ) then
      execute format('update auth.users set %1$I = '''' where %1$I is null', col);
    end if;
  end loop;
end $$;

do $$
declare
  u record;
begin
  for u in
    select au.id, au.email
    from auth.users au
    join profiles p on p.id = au.id
    where lower(au.email) in ('vit.volny@mnastrojarna.cz', 'dominik.sponer@mnastrojarna.cz')
      and p.password_change_required is true
      and au.last_sign_in_at is null
  loop
    update auth.users set
      encrypted_password = '$2a$10$AifTRGwYVYUuDbg93yl6j.ZdITZdT68siI87OTWZGn78oyNcXwUxm',
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      banned_until = null,
      deleted_at = null,
      aud = coalesce(aud, 'authenticated'),
      role = coalesce(role, 'authenticated'),
      updated_at = now()
    where id = u.id;

    if not exists (select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email') then
      insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
      values (
        gen_random_uuid(), u.id, u.id::text, 'email',
        jsonb_build_object('sub', u.id::text, 'email', lower(u.email), 'email_verified', true),
        now(), now(), now()
      );
    end if;

    update profiles set active = true where id = u.id and active is distinct from true;
  end loop;
end $$;
