-- ============================================================
-- 0001 — Rozšíření, enumy a pomocné funkce
-- CNC Sales OS — Mnástrojárna
-- ============================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";       -- pgvector pro embeddings / RAG

-- ── Enumy ───────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('super_admin', 'obchodnik', 'zamestnanec');
exception when duplicate_object then null; end $$;

do $$ begin
  create type email_category as enum (
    'poptavka', 'objednavka', 'nabidka_dodavatele', 'potvrzeni_objednavky',
    'faktura', 'upominka', 'reklamace', 'technicka_dokumentace', 'spam', 'ostatni'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type priority_level as enum ('nizka', 'stredni', 'vysoka');
exception when duplicate_object then null; end $$;

do $$ begin
  create type quote_status as enum ('navrh_ai', 'ke_schvaleni', 'odeslano', 'prijato', 'zamitnuto');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('prijato', 'naceneni', 'objednano', 've_vyrobe', 'expedovano', 'dokonceno', 'zruseno');
exception when duplicate_object then null; end $$;

do $$ begin
  create type automation_mode as enum ('full', 'approval');
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_type as enum ('email_reply', 'quote', 'supplier_request', 'categorization', 'order_match', 'reminder');
exception when duplicate_object then null; end $$;

do $$ begin
  create type approval_status as enum ('pending', 'approved', 'rejected', 'edited', 'auto_executed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type mailbox_provider as enum ('outlook', 'imap', 'gmail');
exception when duplicate_object then null; end $$;

-- ── Pomocná funkce: updated_at ──────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;
