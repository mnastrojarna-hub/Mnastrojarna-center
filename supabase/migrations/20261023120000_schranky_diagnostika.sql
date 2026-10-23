-- Stav e-mailových schránek: poslední stažení / chyba, poslední test připojení, stav inkrementálního
-- stahování (IMAP UID / POP3 UIDL) a zámek proti souběžnému stahování.
-- Samostatná tabulka: zápisy stahování (plánovač, kdokoli s přístupem) nesmí přepsat autora
-- nastavení schránky (mailboxes.updated_by). Hesla sem nikdy nepatří.

create table if not exists mailbox_status (
  mailbox_id            uuid primary key references mailboxes(id) on delete cascade,
  last_sync_attempt_at  timestamptz,
  last_sync_ok_at       timestamptz,
  last_sync_error       text,
  last_sync_fetched     integer,
  last_sync_new         integer,
  last_sync_remaining   integer,
  last_test_at          timestamptz,
  last_test_ok          boolean,
  last_test_error       text,
  last_test             jsonb,
  last_test_by          uuid references profiles(id) on delete set null,
  sync_state            jsonb not null default '{}'::jsonb,
  sync_lock_until       timestamptz,
  updated_at            timestamptz not null default now()
);

-- Druh poslední chyby + otisk údajů při odmítnutém hesle: automatické stahování (cron, otevření
-- pošty) se se známým špatným heslem znovu nepřihlašuje (hosting90 by mohl zablokovat IP).
alter table mailbox_status add column if not exists last_sync_error_kind text;
alter table mailbox_status add column if not exists last_sync_auth_fp text;

alter table mailbox_status enable row level security;

drop policy if exists "mailbox_status_admin" on mailbox_status;
create policy "mailbox_status_admin" on mailbox_status
  for all using (is_super_admin()) with check (is_super_admin());

-- Vlastník schránky vidí stav své schránky (Můj účet, Přijatá pošta)
drop policy if exists "mailbox_status_owner_read" on mailbox_status;
create policy "mailbox_status_owner_read" on mailbox_status
  for select using (exists (select 1 from mailboxes m where m.id = mailbox_status.mailbox_id and m.owner_id = auth.uid()));

-- Dosavadní „naposledy staženo" převezme stav
insert into mailbox_status (mailbox_id, last_sync_ok_at, last_sync_attempt_at)
select id, last_sync_at, last_sync_at from mailboxes where last_sync_at is not null
on conflict (mailbox_id) do nothing;

notify pgrst, 'reload schema';
