-- ═══════════════════════════════════════════════════════════════════════════
--  Rozložení Pošty pro každého uživatele + ochrana před blokací přihlášení u hostingu (2. 11.)
--
--  1) profiles.ui_prefs (jsonb, výchozí {}) — uživatelské předvolby vzhledu, ukládané hned bez potvrzení
--     (majitel: „úprava bude pak uložená okamžitě bez potvrzování jako defaultní pro daného uživatele"):
--       mail.listWidth (px, šířka seznamu vláken vedle detailu), mail.foldersCollapsed (bool, složky jen ikony).
--     Zápis jen přes RPC (sloučení jednoho klíče, ne přepis celého objektu):
--       * set_my_ui_pref(key, value)      — přihlášený uživatel, vždy jen svůj řádek (auth.uid()),
--       * ui_prefs_set(user, key, value)  — server (service role) po ověření session v aplikaci.
--     value = null klíč smaže (výchozí hodnota). Klíč: „modul.nazev" (a–z, 0–9), max 64 znaků; objekt max 8 kB.
--     Čtení: RLS profiles (sám sebe / super admin). Přímý UPDATE ui_prefs cizího profilu odmítne trigger
--     (ani super admin přes REST — předvolby jsou osobní; server = service role bez auth.uid()).
--  2) mailbox_status.auth_fail_* — odmítnuté přihlášení schránky (stahování, test připojení, SMTP, zkouška
--     odeslání): kdy, kolikrát za hodinu, otisk údajů (HMAC; změna hesla / uživatele blokaci ruší) a kde.
--     Do 60 min se schránka se stejnými údaji nepřihlašuje vůbec (ani ručně) — hosting90 po chybných heslech
--     dočasně blokuje IP a pak hlásí jen časový limit. Logika: src/lib/email/auth-lockout.ts.
--  Idempotentní (lze spustit opakovaně).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1) Předvolby vzhledu ─────────────────────────────────────
alter table profiles add column if not exists ui_prefs jsonb not null default '{}'::jsonb;
comment on column profiles.ui_prefs is
  'Osobní předvolby vzhledu (2. 11.): { "mail.listWidth": px, "mail.foldersCollapsed": bool } — zapisuje jen majitel (set_my_ui_pref) nebo server (ui_prefs_set).';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_ui_prefs_object') then
    alter table profiles add constraint profiles_ui_prefs_object
      check (jsonb_typeof(ui_prefs) = 'object' and pg_column_size(ui_prefs) <= 8192);
  end if;
end $$;

/** Předvolby smí přímo měnit jen jejich majitel (server = service role bez auth.uid()). */
create or replace function profiles_ui_prefs_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and auth.uid() is distinct from new.id and new.ui_prefs is distinct from old.ui_prefs then
    raise exception 'Předvolby vzhledu si upravuje každý sám.';
  end if;
  return new;
end $$;
revoke execute on function profiles_ui_prefs_guard() from public, anon, authenticated;
drop trigger if exists trg_profiles_ui_prefs_guard on profiles;
create trigger trg_profiles_ui_prefs_guard
  before update of ui_prefs on profiles
  for each row execute function profiles_ui_prefs_guard();

/** Sloučení jednoho klíče (null = smazat). Vrací nové předvolby; neplatný klíč / profil = výjimka. */
create or replace function ui_prefs_merge(p_user uuid, p_key text, p_value jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_out jsonb;
begin
  if p_user is null then raise exception 'Nepřihlášen.'; end if;
  if p_key is null or length(p_key) > 64 or p_key !~ '^[a-z][a-zA-Z0-9]*(\.[a-zA-Z0-9]+)+$' then
    raise exception 'Neplatný klíč předvolby.';
  end if;
  update profiles
     set ui_prefs = case
       when p_value is null or p_value = 'null'::jsonb then coalesce(ui_prefs, '{}'::jsonb) - p_key
       else coalesce(ui_prefs, '{}'::jsonb) || jsonb_build_object(p_key, p_value) end
   where id = p_user
  returning ui_prefs into v_out;
  if not found then raise exception 'Profil nenalezen.'; end if;
  return v_out;
end $$;
revoke execute on function ui_prefs_merge(uuid, text, jsonb) from public, anon, authenticated;

/** Přihlášený uživatel: vlastní předvolba (vždy jen svůj řádek). */
create or replace function set_my_ui_pref(p_key text, p_value jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select ui_prefs_merge(auth.uid(), p_key, p_value)
$$;
revoke execute on function set_my_ui_pref(text, jsonb) from public, anon;
grant execute on function set_my_ui_pref(text, jsonb) to authenticated;

/** Server (service role) po ověření session v aplikaci. */
create or replace function ui_prefs_set(p_user uuid, p_key text, p_value jsonb)
returns jsonb language sql security definer set search_path = public as $$
  select ui_prefs_merge(p_user, p_key, p_value)
$$;
revoke execute on function ui_prefs_set(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function ui_prefs_set(uuid, text, jsonb) to service_role;

-- ── 2) Odmítnutá přihlášení schránky ─────────────────────────
alter table mailbox_status add column if not exists auth_fail_at    timestamptz;
alter table mailbox_status add column if not exists auth_fail_count integer not null default 0;
alter table mailbox_status add column if not exists auth_fail_fp    text;
alter table mailbox_status add column if not exists auth_fail_where text;
comment on column mailbox_status.auth_fail_at is
  'Poslední odmítnuté přihlášení (stahování / test / SMTP / zkouška odeslání) — 60 min bez dalších pokusů se stejnými údaji.';
comment on column mailbox_status.auth_fail_fp is
  'Otisk přihlašovacích údajů při odmítnutí (HMAC, bez hesla) — změna hesla nebo uživatele blokaci ruší.';
comment on column mailbox_status.auth_fail_where is
  'sync | test | smtp | send | host (časový limit na známém serveru po odmítnutí = dočasná blokace u hostingu).';

-- PostgREST: nové sloupce / funkce hned viditelné
notify pgrst, 'reload schema';
