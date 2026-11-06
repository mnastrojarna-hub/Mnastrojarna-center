-- ============================================================
-- Faktura: smazání PDF faktury v Dokumentech = zrušení vystavení (majitel 6. 11.: „vystavím fakturu,
-- potřebuju ji předělat, smažu ji v dokumentech, vrátím zakázku ručně — a nemůžu vystavit novou").
--  Dřív smazání odstranilo jen soubor; číslo faktury zůstalo u zakázky (orders.invoice_number), a podle
--  něj aplikace bere zakázku jako vyfakturovanou → „Vystavit fakturu" se nikde nenabídlo.
--
--  release_job_invoice(p_job, p_number): u zakázky vymaže číslo, datum, splatnost a příznaky vyfakturování /
--  odeslání faktury, smaže záznam faktury z knihy vydaných faktur (položky kaskádou) a uvolní číslo v řadě FV,
--  pokud bylo v řadě poslední — nová faktura pak dostane STEJNÉ číslo (bez díry v řadě). Platby zakázky
--  zůstávají (jsou vázané na zakázku). Uhrazenou fakturu nezruší.
--
--  Oprava dat: zakázky, kde už PDF faktury z aplikace smazané je (faktura z aplikace = invoices.storage_path),
--  se uvolní stejně; stav „Vyfakturováno" se vrátí na „Dodáno zákazníkovi".
-- Idempotentní (create or replace; oprava dat jen tam, kde PDF chybí).
-- ============================================================

create or replace function release_job_invoice(p_job uuid, p_number text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cur  text;
  v_inv  record;
  v_year int;
  v_n    int;
  v_reused boolean := false;
  v_back boolean := false;
begin
  select nullif(btrim(invoice_number), '') into v_cur from orders where id = p_job for update;
  if not found then
    raise exception 'Zakázka nenalezena.' using errcode = 'P0002';
  end if;
  if v_cur is null or v_cur <> btrim(p_number) then
    return jsonb_build_object('released', false, 'reason', 'other_number');
  end if;
  select id, status into v_inv from invoices where number = v_cur and (order_id = p_job or order_id is null) limit 1;
  if found and v_inv.status = 'uhrazena' then
    return jsonb_build_object('released', false, 'reason', 'paid');
  end if;

  -- stav „Vyfakturováno" zpět na „Dodáno zákazníkovi" v TÉŽE změně (trigger by u vyfakturované zakázky
  -- datum faktury hned doplnil zpět)
  select status = 'fakturovano' into v_back from orders where id = p_job;
  update orders
     set invoice_number = null, invoice_date = null, invoice_due_date = null,
         invoiced_at = null, invoiced_by = null, invoice_sent_at = null, invoice_sent_by = null,
         status = case when status = 'fakturovano' then 'dodano_zakaznikovi'::job_stage else status end
   where id = p_job;
  delete from invoices where number = v_cur and (order_id = p_job or order_id is null);

  -- poslední číslo v řadě → vrátit čítač (nová faktura dostane totéž číslo)
  if v_cur ~ '^FV-[0-9]{4}-[0-9]+$' then
    v_year := split_part(v_cur, '-', 2)::int;
    v_n := split_part(v_cur, '-', 3)::int;
    update doc_counters set counter = counter - 1
     where doc_type = 'FV' and year = v_year and counter = v_n;
    v_reused := found;
  end if;
  return jsonb_build_object('released', true, 'number', v_cur, 'numberFree', v_reused, 'stageReturned', coalesce(v_back, false));
end $$;

revoke all on function release_job_invoice(uuid, text) from public, anon, authenticated;
grant execute on function release_job_invoice(uuid, text) to service_role;

-- ── Oprava dat: PDF faktury z aplikace už smazané ──────────────────────────
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select o.id, o.invoice_number
      from orders o
      join invoices i on i.number = o.invoice_number and (i.order_id = o.id or i.order_id is null)
     where nullif(btrim(o.invoice_number), '') is not null
       and i.storage_path is not null
       and i.status <> 'uhrazena'
       and not exists (
         select 1 from job_files f
          where f.job_id = o.id and f.kind = 'faktura' and not f.archived
       )
  loop
    perform release_job_invoice(r.id, r.invoice_number);
    n := n + 1;
  end loop;
  raise notice 'faktury bez PDF uvolněny: %', n;
end $$;

notify pgrst, 'reload schema';
