-- ============================================================
-- Konec toku (beta 29. 10.): číslo faktury zakázky přidělené atomicky.
--  Dřív server přečetl orders.invoice_number a když bylo prázdné, vzal next_doc_number('FV') a zapsal
--  ho — dvě souběžná vystavení (dvě záložky, dva uživatelé, dvakrát otevřený odkaz) daly jedné
--  zakázce dvě faktury (dvě čísla, dva řádky invoices, dvě PDF).
--  assign_invoice_number(p_job) zamkne řádek zakázky (select … for update), číslo z řady FV vezme
--  jen když zakázka žádné nemá, a vrátí uložené číslo + příznak, jestli ho přidělilo právě toto
--  volání. Kdo souboj prohraje, dostane číslo vítěze — z řady se nic nespotřebuje.
-- Idempotentní (create or replace).
-- ============================================================

create or replace function assign_invoice_number(p_job uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_cur text;
  v_new text;
begin
  select nullif(btrim(invoice_number), '') into v_cur from orders where id = p_job for update;
  if not found then
    raise exception 'Zakázka nenalezena.' using errcode = 'P0002';
  end if;
  if v_cur is not null then
    return jsonb_build_object('number', v_cur, 'created', false);
  end if;
  v_new := next_doc_number('FV');
  update orders set invoice_number = v_new where id = p_job;
  return jsonb_build_object('number', v_new, 'created', true);
end $$;

-- mění data (číslo dokladu) → jen servisní role (server hlídá oprávnění „marže")
revoke all on function assign_invoice_number(uuid) from public, anon, authenticated;
grant execute on function assign_invoice_number(uuid) to service_role;

notify pgrst, 'reload schema';
