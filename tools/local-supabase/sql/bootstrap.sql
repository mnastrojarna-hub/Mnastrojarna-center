-- ============================================================
-- Lokální Supabase stack — základ databáze (idempotentní, spouští se při každém startu)
-- Napodobuje to, co obsahuje image supabase/postgres: role, schémata, granty, rozšíření.
-- Spouští se jako superuser "postgres":  psql -v pw=postgres -f bootstrap.sql
-- ============================================================
\set ON_ERROR_STOP 1

-- ── Role ────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_storage_admin') then
    create role supabase_storage_admin login noinherit createrole;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login superuser createdb createrole replication bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'dashboard_user') then
    create role dashboard_user nologin createrole createdb replication;
  end if;
end $$;

alter role service_role bypassrls;
alter role authenticator with login noinherit password :'pw';
alter role supabase_auth_admin with login password :'pw';
alter role supabase_storage_admin with login password :'pw';
alter role supabase_admin with login password :'pw';

grant anon, authenticated, service_role to authenticator;
-- storage-api přepíná roli (SET ROLE) podle JWT → musí být členem API rolí
grant anon, authenticated, service_role to supabase_storage_admin;
grant anon, authenticated, service_role to postgres;

-- ── Schémata ────────────────────────────────────────────────
create schema if not exists extensions;
create schema if not exists auth authorization supabase_auth_admin;
create schema if not exists storage authorization supabase_storage_admin;
alter schema auth owner to supabase_auth_admin;
alter schema storage owner to supabase_storage_admin;

grant usage on schema extensions to postgres, anon, authenticated, service_role;
grant usage on schema auth to postgres, anon, authenticated, service_role, dashboard_user;
grant usage on schema storage to postgres, anon, authenticated, service_role, dashboard_user;
grant all on schema auth to postgres;
grant all on schema storage to postgres;

-- ── Rozšíření (Supabase má uuid-ossp a pgcrypto předinstalované ve schématu extensions;
--    vector vytvoříme stejně, jako by ho vytvořila migrace "create extension vector" → public) ──
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector;

-- ── search_path jako na Supabase ────────────────────────────
alter database postgres set search_path to "$user", public, extensions;
alter role postgres set search_path to "$user", public, extensions;
alter role authenticator set search_path to "$user", public, extensions;
alter role anon set search_path to "$user", public, extensions;
alter role authenticated set search_path to "$user", public, extensions;
alter role service_role set search_path to "$user", public, extensions;
alter role supabase_auth_admin set search_path to auth;
alter role supabase_storage_admin set search_path to storage;
alter role authenticator set statement_timeout to '60s';

-- ── Oprávnění ve schématu public (výchozí granty jako na Supabase) ─
grant usage on schema public to postgres, anon, authenticated, service_role;
grant create on schema public to postgres;
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema extensions grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema extensions grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema extensions grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on functions to postgres, anon, authenticated, service_role;
alter default privileges for role supabase_storage_admin in schema storage grant all on sequences to postgres, anon, authenticated, service_role;

-- ── Publikace pro Realtime (aby migrace "alter publication supabase_realtime …" prošly) ─
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

-- ── PostgREST: automatický reload schématu po DDL (jako pgrst_ddl_watch na Supabase) ─
create or replace function extensions.pgrst_ddl_watch() returns event_trigger
language plpgsql as $$
begin
  notify pgrst, 'reload schema';
end $$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_ddl_watch') then
    create event trigger pgrst_ddl_watch on ddl_command_end
      execute procedure extensions.pgrst_ddl_watch();
  end if;
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_drop_watch') then
    create event trigger pgrst_drop_watch on sql_drop
      execute procedure extensions.pgrst_ddl_watch();
  end if;
end $$;

-- ── Evidence aplikovaných migrací (jako supabase CLI) ────────
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version    text primary key,
  name       text,
  statements text[],
  checksum   text,
  applied_at timestamptz not null default now()
);
