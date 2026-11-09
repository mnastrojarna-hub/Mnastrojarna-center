-- ═══════════════════════════════════════════════════════════════════════════
--  Poslední aktivita uživatele (9. 11.) — majitel: „Mělo by být vidět já jako super admin, kdy kdo naposledy užíval
--  systém. Ideálně ne kdy se přihlásil, ale kdy naposledy kliknul … Přihlášení je irelevantní."
--
--  1) profiles.last_active_at / last_active_path — čas posledního kliknutí / klávesy v aplikaci a stránka, kde k němu
--     došlo (max 200 znaků, jen cesta začínající „/"). Píše je prohlížeč (src/components/activity-heartbeat.tsx →
--     POST /api/activity) nejvýš 1× za minutu a jen po skutečné akci uživatele (ne otevřená karta, polling, realtime).
--     last_seen_at (přihlášení) zůstává beze změny.
--  2) Zápis jen přes RPC (vždy jen vlastní řádek, a jen když je uložený čas starší než 30 s — žádná smršť zápisů):
--       * touch_my_activity(path)            — přihlášený uživatel (auth.uid()),
--       * user_activity_touch(user, path)    — server (service role) po ověření session v aplikaci.
--     Neaktivní účet se nezapisuje. Přímý UPDATE těchto sloupců přes REST (i vlastního řádku, i super admin) odmítne
--     trigger profiles_activity_guard — čas si nikdo „nepřikreslí".
--  3) Tep NEmění profiles.updated_at (profilová funkce místo obecné set_updated_at: změna jen těchto sloupců =
--     updated_at zůstává) a NEzapisuje audit (profiles_audit hlídá jen roli / aktivitu účtu / sazbu / schvalování).
--     profiles_guard se nemění (sloupce v něm nejsou).
--  Čtení: RLS profiles beze změny (sám sebe / super admin); správa uživatelů čte servisním klíčem (jen super admin).
--  Idempotentní: druhé spuštění nic nezmění.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Sloupce ───────────────────────────────────────────────
alter table profiles add column if not exists last_active_at timestamptz;
alter table profiles add column if not exists last_active_path text;
comment on column profiles.last_active_at is
  'Poslední skutečná akce uživatele v aplikaci (kliknutí / klávesa; 9. 11.) — přesnost ~1 min. Píše jen touch_my_activity / user_activity_touch.';
comment on column profiles.last_active_path is
  'Stránka (cesta, max 200 znaků), kde k poslední akci došlo (9. 11.).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_last_active_path_len') then
    alter table profiles add constraint profiles_last_active_path_len
      check (last_active_path is null or length(last_active_path) <= 200);
  end if;
end $$;

-- ── 2) Zápis ─────────────────────────────────────────────────
/** Vnitřní: zapíše tep (jen aktivní účet, jen když je uložený čas starší než 30 s). Vrací true = zapsáno. */
create or replace function activity_touch_impl(p_user uuid, p_path text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_path text := nullif(left(btrim(coalesce(p_path, '')), 200), '');
  v_rows int;
begin
  if p_user is null then return false; end if;
  if v_path is not null and v_path !~ '^/' then v_path := null; end if;
  perform set_config('app.activity_touch', '1', true);
  update profiles
     set last_active_at = now(), last_active_path = v_path
   where id = p_user
     and active
     and (last_active_at is null or last_active_at < now() - interval '30 seconds');
  get diagnostics v_rows = row_count;   -- před perform (ten FOUND přepíše)
  perform set_config('app.activity_touch', '', true);
  return v_rows > 0;
end $$;
revoke execute on function activity_touch_impl(uuid, text) from public, anon, authenticated;

/** Přihlášený uživatel: vlastní tep (vždy jen svůj řádek). */
create or replace function touch_my_activity(p_path text default null)
returns boolean language sql security definer set search_path = public as $$
  select activity_touch_impl(auth.uid(), p_path)
$$;
revoke execute on function touch_my_activity(text) from public, anon;
grant execute on function touch_my_activity(text) to authenticated;

/** Server (service role) po ověření session v aplikaci. */
create or replace function user_activity_touch(p_user uuid, p_path text default null)
returns boolean language sql security definer set search_path = public as $$
  select activity_touch_impl(p_user, p_path)
$$;
revoke execute on function user_activity_touch(uuid, text) from public, anon, authenticated;
grant execute on function user_activity_touch(uuid, text) to service_role;

/** Přímý zápis last_active_* přes REST (uživatel i super admin) ne — jen RPC výše (server = service role bez auth.uid()). */
create or replace function profiles_activity_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null
     and coalesce(current_setting('app.activity_touch', true), '') <> '1'
     and (new.last_active_at is distinct from old.last_active_at
          or new.last_active_path is distinct from old.last_active_path) then
    raise exception 'Poslední aktivitu zapisuje jen aplikace.';
  end if;
  return new;
end $$;
revoke execute on function profiles_activity_guard() from public, anon, authenticated;
drop trigger if exists trg_profiles_activity_guard on profiles;
create trigger trg_profiles_activity_guard
  before update of last_active_at, last_active_path on profiles
  for each row execute function profiles_activity_guard();

-- ── 3) updated_at: tep ho nemění ─────────────────────────────
/** Jako set_updated_at, ale změna jen last_active_* (tep aktivity) updated_at nechá. */
create or replace function profiles_set_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  if (to_jsonb(new) - array['last_active_at', 'last_active_path', 'updated_at'])
     = (to_jsonb(old) - array['last_active_at', 'last_active_path', 'updated_at']) then
    new.updated_at := old.updated_at;
  else
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke execute on function profiles_set_updated_at() from public, anon, authenticated;
drop trigger if exists trg_profiles_updated on profiles;
create trigger trg_profiles_updated
  before update on profiles
  for each row execute function profiles_set_updated_at();
