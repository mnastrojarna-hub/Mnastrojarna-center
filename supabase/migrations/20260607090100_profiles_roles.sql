-- ============================================================
-- 0002 — Profily uživatelů, role a RLS pomocné funkce
-- ============================================================

create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text not null default '',
  email       text,
  role        user_role not null default 'zamestnanec',
  commission_rate numeric(5,4) not null default 0,   -- provizní sazba obchodníka
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_profiles_updated
  before update on profiles
  for each row execute function set_updated_at();

-- ── RLS pomocné funkce (SECURITY DEFINER, stabilní) ─────────
create or replace function current_role_name()
returns user_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid();
$$;

create or replace function is_super_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'super_admin' from profiles where id = auth.uid()), false);
$$;

create or replace function is_obchodnik_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('super_admin','obchodnik') from profiles where id = auth.uid()), false);
$$;

-- ── Automatické založení profilu při registraci ─────────────
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'zamestnanec')
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── RLS ─────────────────────────────────────────────────────
alter table profiles enable row level security;

create policy "profiles_select_self_or_admin" on profiles
  for select using (id = auth.uid() or is_super_admin());

create policy "profiles_update_self_or_admin" on profiles
  for update using (id = auth.uid() or is_super_admin());

create policy "profiles_admin_all" on profiles
  for all using (is_super_admin()) with check (is_super_admin());
