-- ============================================================
-- 20261031160000 — Poptávky dodavatelům (poptávkové kolo, RFQ) — 31. 10.
-- Majitel: „Chybí mi flow, když mám poptávku od zákazníka, vytvořit poptávku pro naše dodavatele … pošlu 2, 3, 5
-- poptávek … všechno anonymizované, aby mi nevyfoukli zákazníka … To bude dělat hlavně Šponer."
-- + „Měl by z toho vyjít i doporučený dodavatel, především na základě ceny, termínu a kvality."
--
--  1) rfq_rounds — poptávkové kolo k zakázce (číslo PD-RRRR-NNN, co se poptává: celý díl / operace, položky a
--     množství vč. variant, požadovaný termín, „odpověď do", poznámka, PDF poptávky, kdo a kdy).
--  2) rfq_recipients — dodavatel v kole (VŽDY samostatný e-mail): stav odesláno → odpověděl / odmítl / bez odpovědi,
--     čeká na anonymizaci (fronta anon_send_queue), chyba odeslání (fronta K odeslání), urgence, odpověď (e-mail),
--     nabídka dodavatele (supplier_quotes), poděkování „tentokrát ne".
--  3) rfq_selections — výběr vítěze po položkách (nebo celé kolo): doporučený vs. vybraný, kdo / proč přebil doporučení.
--  4) supplier_quotes.rfq_recipient_id — nabídka dodavatele z poptávkového kola (čekající = bez ceny).
--  5) profiles.can_rfq — „Smí poptávat dodavatele" (zaměstnanec; obchodník a super admin vždy). Mění jen super admin
--     (profiles_guard). Jednorázově (značka rfq_sponer_v1): Šponer = smí (shoda jména / e-mailu, jen když je právě jeden).
--  6) supplier_quality_stats(p_ids) — kvalita dodavatele z historie: dokončené objednávky, včas / pozdě (dodáno k nám
--     vs. potvrzený / požadovaný termín), průměrné zpoždění, problémy (zmetek „výroba se nepovedla" / reklamace na
--     zakázkách, kde dodavatel dělal krok nebo měl objednávku).
--  RLS: čtení jako nákup (obchodník, super admin) + uživatel s can_rfq; zapisuje jen server (service role, autor v app_actor).
--
-- POZOR — PŘEDEFINOVANÁ FUNKCE: profiles_guard() — poslední definice 20261030200000_schvalovani_nabidek_per_uzivatel.sql
--   (zrcadlo + can_rfq). Další změny dělej od tohoto těla.
-- Idempotentní: druhé spuštění nic nezmění.
-- ============================================================

-- ── 5) Příznak uživatele (dřív než politiky, které ho čtou) ──
alter table profiles add column if not exists can_rfq boolean not null default false;
comment on column profiles.can_rfq is
  'Smí poptávat dodavatele (poptávkové kolo, ceny dodavatelů v porovnání) — jen zaměstnanec; obchodník a super admin vždy. Mění jen super admin.';

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
       or new.can_rfq is distinct from old.can_rfq then
      raise exception 'Změnu role a oprávnění smí provést jen super admin.';
    end if;
  end if;
  return new;
end $$;

/** Smí přihlášený poptávat dodavatele? Aktivní super admin / obchodník, nebo aktivní účet s can_rfq. (TS: permissions.ts „rfq") */
create or replace function rfq_user() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.active and (p.role in ('super_admin', 'obchodnik') or coalesce(p.can_rfq, false))
                   from profiles p where p.id = auth.uid()), false)
$$;
revoke all on function rfq_user() from public, anon;
grant execute on function rfq_user() to authenticated, service_role;

-- ── 1) Kolo ─────────────────────────────────────────────────
create table if not exists rfq_rounds (
  id               uuid primary key default gen_random_uuid(),
  job_id           uuid not null references orders(id) on delete cascade,
  number           text not null,
  status           text not null default 'otevrene',
  scope            text not null default 'dil',
  operation_kinds  text[],
  items            jsonb not null default '[]'::jsonb,
  required_date    date,
  reply_by         date,
  note             text,
  file_id          uuid references job_files(id) on delete set null,
  drawing_file_ids uuid[] not null default '{}',
  created_by       uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  closed_at        timestamptz,
  closed_by        uuid references profiles(id) on delete set null
);
do $$ begin
  alter table rfq_rounds add constraint rfq_rounds_check
    check (status in ('otevrene', 'vybrano', 'uzavrene', 'zrusene') and scope in ('dil', 'operace')
           and jsonb_typeof(items) = 'array');
exception when duplicate_object then null; end $$;
create unique index if not exists uq_rfq_rounds_number on rfq_rounds(number);
create index if not exists idx_rfq_rounds_job on rfq_rounds(job_id, created_at desc);
comment on table rfq_rounds is 'Poptávkové kolo u dodavatelů k zakázce (PD-RRRR-NNN) — anonymně: bez jména zákazníka a jeho čísel.';
comment on column rfq_rounds.items is
  '[{orderItemId, ref, drawingNumber, revision, name, material, unit, quantities[], customerQty}] — naše čísla položek (PD-…/n), množství vč. variant.';

-- ── 2) Dodavatelé kola ──────────────────────────────────────
create table if not exists rfq_recipients (
  id                uuid primary key default gen_random_uuid(),
  round_id          uuid not null references rfq_rounds(id) on delete cascade,
  supplier_id       uuid references suppliers(id) on delete set null,
  supplier_name     text not null,
  emails            text[] not null default '{}',
  status            text not null default 'k_odeslani',
  rank              int,
  recommend_reason  text,
  sent_at           timestamptz,
  sent_by           uuid references profiles(id) on delete set null,
  email_id          uuid references emails(id) on delete set null,
  send_queue_id     uuid references anon_send_queue(id) on delete set null,
  outbox_id         uuid references mail_outbox(id) on delete set null,
  error             text,
  reminded_at       timestamptz,
  reminded_by       uuid references profiles(id) on delete set null,
  reminder_count    int not null default 0,
  replied_at        timestamptz,
  reply_email_id    uuid references emails(id) on delete set null,
  supplier_quote_id uuid references supplier_quotes(id) on delete set null,
  declined_at       timestamptz,
  decline_note      text,
  thanked_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
do $$ begin
  alter table rfq_recipients add constraint rfq_recipients_check
    check (status in ('k_odeslani', 'ceka_na_anonymizaci', 'odeslano', 'odpovedel', 'nabidka', 'odmitl', 'bez_odpovedi', 'chyba', 'zruseno'));
exception when duplicate_object then null; end $$;
create index if not exists idx_rfq_recipients_round on rfq_recipients(round_id);
create index if not exists idx_rfq_recipients_supplier on rfq_recipients(supplier_id) where supplier_id is not null;
create index if not exists idx_rfq_recipients_queue on rfq_recipients(send_queue_id) where send_queue_id is not null;
create index if not exists idx_rfq_recipients_outbox on rfq_recipients(outbox_id) where outbox_id is not null;
create unique index if not exists uq_rfq_recipients_supplier on rfq_recipients(round_id, supplier_id) where supplier_id is not null;

-- ── 3) Výběr vítěze ─────────────────────────────────────────
create table if not exists rfq_selections (
  id                       uuid primary key default gen_random_uuid(),
  round_id                 uuid not null references rfq_rounds(id) on delete cascade,
  order_item_id            uuid references order_items(id) on delete cascade,
  recipient_id             uuid not null references rfq_recipients(id) on delete cascade,
  supplier_quote_id        uuid references supplier_quotes(id) on delete set null,
  recommended_recipient_id uuid references rfq_recipients(id) on delete set null,
  overridden               boolean not null default false,
  override_reason          text,
  quantity                 numeric(12,3),
  unit_price               numeric(14,2),
  selected_by              uuid references profiles(id) on delete set null,
  selected_at              timestamptz not null default now()
);
create unique index if not exists uq_rfq_selections_item on rfq_selections(round_id, coalesce(order_item_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ── 4) Nabídka dodavatele z kola ────────────────────────────
alter table supplier_quotes add column if not exists rfq_recipient_id uuid references rfq_recipients(id) on delete set null;
create index if not exists idx_supplier_quotes_rfq on supplier_quotes(rfq_recipient_id) where rfq_recipient_id is not null;

drop trigger if exists trg_rfq_rounds_updated on rfq_rounds;
create trigger trg_rfq_rounds_updated before update on rfq_rounds for each row execute function set_updated_at();
drop trigger if exists trg_rfq_recipients_updated on rfq_recipients;
create trigger trg_rfq_recipients_updated before update on rfq_recipients for each row execute function set_updated_at();

-- ── RLS: čtení nákup + can_rfq, zápis jen server ────────────
alter table rfq_rounds enable row level security;
alter table rfq_recipients enable row level security;
alter table rfq_selections enable row level security;
do $$ begin
  create policy "rfq_rounds_select" on rfq_rounds for select using (rfq_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "rfq_recipients_select" on rfq_recipients for select using (rfq_user());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "rfq_selections_select" on rfq_selections for select using (rfq_user());
exception when duplicate_object then null; end $$;
revoke insert, update, delete on rfq_rounds, rfq_recipients, rfq_selections from anon, authenticated;
grant select on rfq_rounds, rfq_recipients, rfq_selections to authenticated;
grant all on rfq_rounds, rfq_recipients, rfq_selections to service_role;

-- ── 6) Kvalita dodavatele z historie ────────────────────────
/**
 * Pro každého dodavatele z p_ids: dokončené objednávky (dodáno k nám), včas / pozdě proti potvrzenému (jinak
 * požadovanému) termínu, průměrné zpoždění pozdních (dny), problémy = zakázky, kde dodavatel dělal krok nebo měl
 * objednávku a zakázka má zmetek (událost production_failed) nebo reklamaci. Bez historie = 0 (UI „bez historie").
 */
create or replace function supplier_quality_stats(p_ids uuid[])
returns table (supplier_id uuid, orders_done int, on_time int, late int, avg_delay_days numeric, issues int, jobs int)
language sql stable security definer set search_path = public as $$
  with po as (
    select p.supplier_id, p.job_id,
           (p.delivered_at at time zone 'Europe/Prague')::date as got,
           coalesce(p.confirmed_date, p.required_date) as due
      from purchase_orders p
     where p.supplier_id = any(p_ids) and p.status = 'dodana' and p.delivered_at is not null
  ), sj as (
    select p.supplier_id, p.job_id from purchase_orders p where p.supplier_id = any(p_ids) and p.status <> 'zrusena'
    union
    select o.supplier_id, o.job_id from job_operations o where o.supplier_id = any(p_ids) and not o.in_house
  ), bad as (
    select distinct sj.supplier_id, sj.job_id
      from sj join orders j on j.id = sj.job_id
     where j.claim_opened_at is not null
        or exists (select 1 from job_events e where e.job_id = sj.job_id and e.data->>'exception' = 'production_failed')
  )
  select s.id,
         (select count(*)::int from po where po.supplier_id = s.id),
         (select count(*)::int from po where po.supplier_id = s.id and po.due is not null and po.got <= po.due),
         (select count(*)::int from po where po.supplier_id = s.id and po.due is not null and po.got > po.due),
         (select round(avg(po.got - po.due), 1) from po where po.supplier_id = s.id and po.due is not null and po.got > po.due),
         (select count(*)::int from bad where bad.supplier_id = s.id),
         (select count(distinct sj.job_id)::int from sj where sj.supplier_id = s.id)
    from suppliers s where s.id = any(p_ids)
$$;
revoke all on function supplier_quality_stats(uuid[]) from public, anon;
grant execute on function supplier_quality_stats(uuid[]) to authenticated, service_role;

-- ── 5b) Šponer smí poptávat (jednorázově) ────────────────────
do $$
declare
  v_new  boolean;
  v_ids  uuid[];
  v_rows text;
begin
  insert into integration_settings (key, category, label, is_secret, value)
  values ('rfq_sponer_v1', 'ai_access', 'Poptávky dodavatelům — Šponer smí poptávat (31. 10.)', false, 'done')
  on conflict (key) do nothing
  returning true into v_new;
  if not coalesce(v_new, false) then
    raise notice 'Poptávky dodavatelům: výchozí nastavení už proběhlo dřív — beze změny.';
    return;
  end if;
  select array_agg(p.id order by p.created_at), string_agg(coalesce(p.full_name, '') || ' <' || coalesce(p.email, '') || '>', ', ')
    into v_ids, v_rows
    from profiles p
   where p.full_name ilike '%šponer%' or p.full_name ilike '%sponer%' or p.email ilike '%sponer%';
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    update profiles set can_rfq = true where id = v_ids[1] and not can_rfq;
    raise notice 'Poptávky dodavatelům: % — smí poptávat dodavatele.', v_rows;
  else
    raise notice 'Poptávky dodavatelům: Šponera nelze jednoznačně určit (nalezeno %: %) — nic nenastaveno, nastav ve Správě uživatelů.',
      coalesce(array_length(v_ids, 1), 0), coalesce(v_rows, '—');
  end if;
end $$;
