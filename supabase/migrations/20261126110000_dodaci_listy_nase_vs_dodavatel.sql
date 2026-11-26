-- ============================================================
-- 20261126110000 — Dodací list: náš, nebo od dodavatele? (majitel 26. 11.)
-- „kniha dodáků od dodavatelů … dodací listy budou vždy u zakázky v dokumentech a bude tak správně podle
--  jednoho nebo druhého klíče třídit i AI všude — z mailu, z fotek, z jakéhokoliv vstupu"
--
-- Pravidlo v DB (platí pro KAŽDÝ vstup — pošta, focení, dávka, nahrání, ruční změna): u dokumentu zakázky
-- druhu „dodací list" (kromě dokladů vygenerovaných systémem) se vystavitel určí z obsahu, který přečetla AI:
--   1) jako dodavatel je na dokladu naše firma (IČO z Nastavení / název Mnástrojárna) → my
--   2) číslo dokladu = číslo našeho dodacího listu u zakázky                     → my
--   3) odkazuje na naši objednávku dodavateli (customerOrderNumber = číslo PO)      → dodavatel
--   4) AI vystavitele neurčila a dodavatel na dokladu je (cizí firma)              → dodavatel
-- Jinak zůstane, co určila AI / uživatel. Jednorázově se přepočítají i stávající dodací listy.
-- ============================================================

create or replace function delivery_note_issuer(p_job uuid, p_ai jsonb, p_issuer text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_our_ico text;
  v_sup_ico text := regexp_replace(coalesce(p_ai->'supplier'->>'ico', ''), '\D', '', 'g');
  v_sup_name text := coalesce(p_ai->'supplier'->>'name', '');
  v_no text := upper(regexp_replace(coalesce(p_ai->>'documentNumber', ''), '[^0-9A-Za-z]', '', 'g'));
  v_po text := upper(regexp_replace(coalesce(p_ai->>'customerOrderNumber', ''), '[^0-9A-Za-z]', '', 'g'));
begin
  if p_ai is null then return p_issuer; end if;
  select regexp_replace(coalesce(value, ''), '\D', '', 'g') into v_our_ico from integration_settings where key = 'company_ico';
  if (v_our_ico <> '' and v_sup_ico = v_our_ico) or search_plain(v_sup_name) ~ 'm\s*nastrojarn' then return 'my'; end if;
  if v_no <> '' and exists (
    select 1 from delivery_notes d where d.order_id = p_job and upper(regexp_replace(d.number, '[^0-9A-Za-z]', '', 'g')) = v_no
  ) then return 'my'; end if;
  if v_po <> '' and exists (
    select 1 from purchase_orders po where upper(regexp_replace(po.number, '[^0-9A-Za-z]', '', 'g')) = v_po
  ) then return 'dodavatel'; end if;
  if (p_issuer is null or p_issuer not in ('my', 'dodavatel')) and btrim(v_sup_name) <> '' then return 'dodavatel'; end if;
  return p_issuer;
end $$;

create or replace function trg_job_files_dl_issuer() returns trigger
language plpgsql security definer set search_path = public as $$
declare v text;
begin
  if new.kind::text = 'dodaci_list' and coalesce(new.origin::text, '') <> 'generated' and new.job_id is not null then
    v := delivery_note_issuer(new.job_id, new.ai_extracted, new.issuer::text);
    if v is distinct from new.issuer::text then new.issuer := v; end if;
  end if;
  return new;
end $$;

drop trigger if exists job_files_dl_issuer on job_files;
create trigger job_files_dl_issuer before insert or update of kind, ai_extracted, issuer on job_files
  for each row execute function trg_job_files_dl_issuer();

-- stávající dodací listy (trigger přepočítá vystavitele)
update job_files set issuer = issuer
 where kind::text = 'dodaci_list' and coalesce(origin::text, '') <> 'generated' and job_id is not null;
