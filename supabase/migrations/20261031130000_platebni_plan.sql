-- ============================================================
-- 20261031130000 — Platební plán (zadání majitele 31. 10.)
--  Faktury dodavatelů → záložka „Platební plán": jednoduché poznámky, co se má v příštích dnech zaplatit —
--  Komu (volný text, např. „Franta Vomáčka"), Částka + měna, Kdy zaplatit, volitelně odkaz na fakturu
--  dodavatele a poznámka. Zaplaceno = datum + kdo. Vidí a mění JEN super admin (RLS + trigger);
--  aplikace zapisuje servisním klíčem s autorem (x-actor), smazání jde do audit_log.
-- Idempotentní (create … if not exists, create or replace, drop … if exists).
-- ============================================================

create table if not exists supplier_payment_plan (
  id          uuid primary key default uuid_generate_v4(),
  payee       text not null,
  amount      numeric(14,2) not null,
  currency    text not null default 'CZK',
  due_on      date not null,
  invoice_id  uuid references supplier_invoices(id) on delete set null,
  note        text,
  paid_at     date,
  paid_by     uuid references profiles(id) on delete set null,
  created_by  uuid references profiles(id) on delete set null,
  updated_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

do $$ begin
  alter table supplier_payment_plan add constraint supplier_payment_plan_payee_check
    check (length(btrim(payee)) between 1 and 200);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_payment_plan add constraint supplier_payment_plan_amount_check
    check (amount > 0 and amount < 10000000000);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_payment_plan add constraint supplier_payment_plan_currency_check
    check (currency ~ '^[A-Z]{3}$');
exception when duplicate_object then null; end $$;
do $$ begin
  alter table supplier_payment_plan add constraint supplier_payment_plan_note_check
    check (note is null or length(note) <= 1000);
exception when duplicate_object then null; end $$;

create index if not exists idx_supplier_payment_plan_open on supplier_payment_plan(due_on) where paid_at is null;
create index if not exists idx_supplier_payment_plan_paid on supplier_payment_plan(paid_at desc) where paid_at is not null;
create index if not exists idx_supplier_payment_plan_invoice on supplier_payment_plan(invoice_id) where invoice_id is not null;

-- ── Autor, zaplaceno, jen super admin ──────────────────────
create or replace function supplier_payment_plan_before() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- přes REST i ze serveru s autorem: jen super admin (servisní klíč bez autora / psql = systém)
  if app_ctx() in ('session', 'app') and app_actor() is not null and not app_actor_is_super_admin() then
    raise exception 'Platební plán vidí a mění jen super admin.' using errcode = '42501', hint = 'FORBIDDEN';
  end if;
  new.updated_at := now();
  new.payee := btrim(new.payee);
  new.currency := upper(coalesce(nullif(btrim(new.currency), ''), 'CZK'));
  new.note := nullif(btrim(coalesce(new.note, '')), '');
  if tg_op = 'INSERT' then
    new.created_by := app_pick(new.created_by);
    new.updated_by := null;
    new.paid_by := case when new.paid_at is null then null else app_pick(new.paid_by) end;
  else
    if app_ctx() <> 'db' then new.updated_by := app_pick(null); end if;
    new.created_by := app_keep(new.created_by, old.created_by);
    new.created_at := old.created_at;
    if new.paid_at is null then
      new.paid_by := null;
    elsif old.paid_at is null then
      new.paid_by := app_pick(case when new.paid_by is distinct from old.paid_by then new.paid_by end);
    else
      new.paid_by := app_keep(new.paid_by, old.paid_by);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_supplier_payment_plan_before on supplier_payment_plan;
create trigger trg_supplier_payment_plan_before before insert or update on supplier_payment_plan
  for each row execute function supplier_payment_plan_before();

-- smazání = vždy záznam v audit_log (kdo, co)
drop trigger if exists trg_supplier_payment_plan_audit_delete on supplier_payment_plan;
create trigger trg_supplier_payment_plan_audit_delete after delete on supplier_payment_plan
  for each row execute function audit_row_delete();

-- ── Práva: RLS jen super admin; zápis servisní role (aplikace) ─
alter table supplier_payment_plan enable row level security;
drop policy if exists "supplier_payment_plan_select" on supplier_payment_plan;
create policy "supplier_payment_plan_select" on supplier_payment_plan for select
  using (is_active_user() and is_super_admin());
drop policy if exists "supplier_payment_plan_write" on supplier_payment_plan;
create policy "supplier_payment_plan_write" on supplier_payment_plan for all
  using (is_active_user() and is_super_admin()) with check (is_active_user() and is_super_admin());

revoke all on supplier_payment_plan from anon, authenticated;
grant select on supplier_payment_plan to authenticated;
grant all on supplier_payment_plan to service_role;

revoke all on function supplier_payment_plan_before() from public, anon, authenticated;

notify pgrst, 'reload schema';
