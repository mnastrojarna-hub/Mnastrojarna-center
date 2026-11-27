-- ============================================================
-- 20261127100000 — Dodání: stav až po potvrzeném DL; faktura před dodáním (majitel 27. 11.)
-- „když je u nás a vystavím dodací list, zůstává stav; až nahraju potvrzený dodací list, bude Dodáno
--  zákazníkovi a bude se moct fakturovat" + „přidej možnost vystavit fakturu před dodáním"
--
--  • recompute_job_flow: dodání všech kusů (zápis dodání / DL) už zakázku neposune na „Dodáno zákazníkovi"
--    (posun dělá potvrzený DL — aplikace, confirmDeliveryNoteCore)
--  • orders.invoice_before_delivery (+ kdo, kdy, poznámka): výjimka „Fakturovat před dodáním"
-- ============================================================

alter table orders add column if not exists invoice_before_delivery boolean not null default false;
alter table orders add column if not exists invoice_before_delivery_note text;
alter table orders add column if not exists invoice_before_delivery_by uuid references profiles(id) on delete set null;
alter table orders add column if not exists invoice_before_delivery_at timestamptz;

create or replace function recompute_job_flow(p_job uuid, p_advance boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  j        orders%rowtype;
  v_cnt    int;
  v_priced int;
  v_done   int;
  v_part   int;
  v_last   timestamptz;
  v_move   boolean;
  v_prev   text := current_setting('app.flow_cause', true);
begin
  select * into j from orders where id = p_job;
  if not found then return; end if;            -- mazání zakázky (kaskáda)
  select count(*)::int,
         (count(*) filter (where unit_price is not null))::int,
         (count(*) filter (where delivery_closed or quantity <= 0 or delivered_quantity >= quantity))::int,
         (count(*) filter (where not delivery_closed and quantity > 0 and delivered_quantity > 0
                                 and delivered_quantity < quantity))::int,
         max(delivered_changed_at) filter (where delivered_quantity > 0)
    into v_cnt, v_priced, v_done, v_part, v_last
  from order_items where order_id = p_job;
  -- majitel 27. 11.: samotné dodání (vystavený DL) stav NEPOSOUVÁ — „Dodáno zákazníkovi" až s potvrzeným DL;
  -- posun tu jen když je potvrzený DL už zapsaný a není starší než poslední dodávka (např. zbytek uzavřen s menším množstvím)
  v_move := p_advance and v_cnt > 0 and v_done = v_cnt and job_stage_rank(j.status) between 3 and 8
    and j.delivery_note_confirmed_at is not null
    and (v_last is null or j.delivery_note_confirmed_at::date >= (v_last at time zone 'Europe/Prague')::date);
  if not v_move and v_cnt = j.items_count and v_priced = j.items_priced and v_done = j.items_delivered
     and v_part = j.items_partial and v_last is not distinct from j.last_delivery_at then
    return;
  end if;
  perform set_config('app.flow_cause', 'dodani', true);
  update orders set
    items_count = v_cnt, items_priced = v_priced, items_delivered = v_done, items_partial = v_part,
    last_delivery_at = v_last,
    status = case when v_move then 'dodano_zakaznikovi'::job_stage else status end
  where id = p_job;
  perform set_config('app.flow_cause', coalesce(v_prev, ''), true);
end $$;
