-- ============================================================
-- 20261029140000 — Technologie položek (feedback majitele 29. 10.)
--  „Výrobu bych přejmenoval na technologii — technolog může napsat technologický postup ke každé
--   položce. Ale současně jde napsat ‚bez technologie, kompletně zadáno' někomu. … budou tam poznámky,
--   na co dát pozor — ty se budou generovat do objednávky (‚pozor popsat na čele', ‚změna materiálu')."
--  „Dodavatel a výrobce se bude brát vždy podle nějaké nabídky; nabídka bývá i mailem, někdy telefonicky."
--
--  * order_items: technologický postup (volný text, nepovinný), „Bez technologie — kompletně zadáno
--    {firma}" (kompletní dodávka → postup netřeba), poznámka pro dodavatele (do objednávky: PDF u položky
--    + souhrn v e-mailu; aplikace ji při vystavení objednávky vloží do poznámky položky jako „Pozor: …").
--  * supplier_quotes.source += 'telefon' (nabídka telefonem zapsaná při předání do výroby).
--  * merge_jobs: shodné výkresy při sloučení zakázek převezmou i technologii zdroje, když ji cíl nemá.
--    Funkce se NEpřepisuje celá — do aktuální definice (naposledy 20261029110000) se doplní čtyři
--    sloupce za řádek s poznámkou položky (kontrola, že se doplnily; opakované spuštění nic nemění).
-- Celý soubor je idempotentní a jen přidává.
-- ============================================================

-- ── 1) Sloupce položek ──────────────────────────────────────
alter table order_items add column if not exists tech_procedure text;
alter table order_items add column if not exists tech_complete boolean not null default false;
alter table order_items add column if not exists tech_complete_by text;
alter table order_items add column if not exists supplier_note text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_tech_procedure_len') then
    alter table order_items add constraint order_items_tech_procedure_len check (tech_procedure is null or length(tech_procedure) <= 8000);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_tech_complete_by_len') then
    alter table order_items add constraint order_items_tech_complete_by_len check (tech_complete_by is null or length(tech_complete_by) <= 300);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_items_supplier_note_len') then
    alter table order_items add constraint order_items_supplier_note_len check (supplier_note is null or length(supplier_note) <= 1000);
  end if;
end $$;

comment on column order_items.tech_procedure is 'Technologický postup položky (technolog; volný text). Nepovinný při kompletní dodávce.';
comment on column order_items.tech_complete is 'Bez technologie — položka je kompletně zadaná dodavateli (tech_complete_by).';
comment on column order_items.tech_complete_by is 'Komu je položka kompletně zadaná (název firmy, jak ho zapsal uživatel / předvyplnil krok).';
comment on column order_items.supplier_note is 'Poznámka pro dodavatele (např. „pozor popsat na čele") — tiskne se do objednávky u položky a do e-mailu.';

-- ── 2) Nabídka telefonem ────────────────────────────────────
do $$
declare v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint where conname = 'supplier_quotes_source_check';
  if v_def is null or position('telefon' in v_def) = 0 then
    alter table supplier_quotes drop constraint if exists supplier_quotes_source_check;
    alter table supplier_quotes add constraint supplier_quotes_source_check
      check (source in ('manual', 'foto', 'email', 'ai', 'telefon'));
  end if;
end $$;

-- ── 3) merge_jobs: technologie shodných výkresů ─────────────
do $$
declare
  v_oid oid;
  v_def text;
  v_anchor text := $a$note = coalesce(nullif(btrim(coalesce(ti.note, '')), ''), si.note),$a$;
  v_add text := $a$note = coalesce(nullif(btrim(coalesce(ti.note, '')), ''), si.note),
      tech_procedure = coalesce(nullif(btrim(coalesce(ti.tech_procedure, '')), ''), si.tech_procedure),
      tech_complete = coalesce(ti.tech_complete, false) or coalesce(si.tech_complete, false),
      tech_complete_by = coalesce(nullif(btrim(coalesce(ti.tech_complete_by, '')), ''), si.tech_complete_by),
      supplier_note = coalesce(nullif(btrim(coalesce(ti.supplier_note, '')), ''), si.supplier_note),$a$;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'merge_jobs' and p.pronargs >= 3 order by p.pronargs desc limit 1;
  if v_oid is null then
    raise notice 'merge_jobs neexistuje — technologie se při sloučení nepřenáší (žádná změna)';
    return;
  end if;
  v_def := pg_get_functiondef(v_oid);
  if position('tech_procedure' in v_def) > 0 then
    return; -- už doplněno
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'merge_jobs: nenalezen řádek poznámky položky — technologii doplň ručně do aktuální definice';
  end if;
  execute replace(v_def, v_anchor, v_add);
end $$;
