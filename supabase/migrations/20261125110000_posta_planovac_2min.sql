-- ============================================================
-- 20261125110000 — Pošta se stahuje každé 2 minuty i bez otevřené aplikace (majitel 25. 11.)
-- „v Outlooku ho vidím hodinu, v systému mi naběhne za dlouho"
--
-- Vercel Hobby smí cron jen 1× denně → plánovač v databázi: pg_cron každé 2 min zavolá (pg_net)
-- /api/cron/mail-tick. Adresu a interní tajemství zapíše do mail_tick_target sama aplikace (při prvním
-- požadavku živé pošty) — v repozitáři není nic tajného. Tabulka jen pro servisní roli (RLS bez politik).
-- Bez pg_cron / pg_net jen hláška (zapnout: Supabase → Database → Extensions) — vše ostatní funguje dál.
-- ============================================================

create table if not exists mail_tick_target (
  id         int primary key default 1 check (id = 1),
  url        text not null,
  secret     text not null,
  bypass     text,
  updated_at timestamptz not null default now()
);
alter table mail_tick_target enable row level security;
revoke all on mail_tick_target from public, anon, authenticated;
grant select, insert, update on mail_tick_target to service_role;

do $$ begin
  create extension if not exists pg_net;
exception when others then
  raise notice 'pg_net není dostupné — plánovač pošty zapni: Supabase → Database → Extensions → pg_net a spusť migraci znovu.';
end $$;

do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron není dostupné — plánovač pošty zapni: Supabase → Database → Extensions → pg_cron.';
end $$;

create or replace function mail_tick_call() returns void
language plpgsql security definer set search_path = public as $$
declare t mail_tick_target%rowtype;
begin
  select * into t from mail_tick_target where id = 1;
  if t.url is null then return; end if;
  perform net.http_get(
    url := t.url,
    headers := jsonb_strip_nulls(jsonb_build_object(
      'Authorization', 'Bearer ' || t.secret,
      'x-vercel-protection-bypass', t.bypass
    )),
    timeout_milliseconds := 5000
  );
exception when others then
  raise notice 'mail_tick_call: %', sqlerrm;
end $$;
revoke execute on function mail_tick_call() from public, anon, authenticated;

do $$ begin
  perform cron.unschedule('mail-tick') where exists (select 1 from cron.job where jobname = 'mail-tick');
  perform cron.schedule('mail-tick', '*/2 * * * *', 'select mail_tick_call()');
exception when others then
  raise notice 'Plánovač pošty (pg_cron) se nepodařilo naplánovat: %', sqlerrm;
end $$;
