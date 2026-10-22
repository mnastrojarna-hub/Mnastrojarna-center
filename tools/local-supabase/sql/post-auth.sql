-- ============================================================
-- Po migracích GoTrue: zajistí SQL funkce auth.uid()/role()/email()/jwt()
-- (GoTrue je běžně vytváří samo — tady jen záloha, kdyby chyběly) a granty.
-- ============================================================
\set ON_ERROR_STOP 1

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    create function auth.uid() returns uuid language sql stable as $f$
      select coalesce(
        nullif(current_setting('request.jwt.claim.sub', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $f$;
  end if;
  if to_regprocedure('auth.role()') is null then
    create function auth.role() returns text language sql stable as $f$
      select coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text
    $f$;
  end if;
  if to_regprocedure('auth.email()') is null then
    create function auth.email() returns text language sql stable as $f$
      select coalesce(
        nullif(current_setting('request.jwt.claim.email', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
      )::text
    $f$;
  end if;
  if to_regprocedure('auth.jwt()') is null then
    create function auth.jwt() returns jsonb language sql stable as $f$
      select coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
      )::jsonb
    $f$;
  end if;
end $$;

grant execute on function auth.uid(), auth.role(), auth.email(), auth.jwt()
  to postgres, anon, authenticated, service_role, dashboard_user;
