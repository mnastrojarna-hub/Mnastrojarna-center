-- ============================================================
-- 20261116120000 — Hledání v Knize zakázek a poptávkách (majitel 16. 11.)
--  • část čísla stačí („026" najde 2026/026, Z-2026-026), mezery a oddělovače nevadí („2026 026", „2026/26")
--  • hledá v zakázce, položkách a všech dokladech: nabídky, objednávky zákazníka i dodavatelům, nabídky
--    dodavatelů, dodací listy, faktura, výkresy, poznámky a obsah příloh (co AI přečetla z dokumentu)
--  • relevance: číslo zakázky a dokladů nejvýš, pak čísla výkresů a data položek, pak poznámky a ostatní
--    text; přesná shoda vždy před částečnou
-- job_search(p_words) → (job_id, score); každé slovo musí najít aspoň jedno pole zakázky.
-- Jen service_role (volá server za ověřeného uživatele — viditelnost řeší Kniha jako dosud).
-- ============================================================

create or replace function search_compact(p text) returns text language sql immutable as $$
  select regexp_replace(lower(translate(coalesce(p, ''),
    'áäčďéěëíňóöřšťúůüýžÁÄČĎÉĚËÍŇÓÖŘŠŤÚŮÜÝŽ', 'aacdeeeinoorstuuuyzAACDEEEINOORSTUUUYZ')), '[^a-z0-9]+', '', 'g')
$$;

create or replace function search_plain(p text) returns text language sql immutable as $$
  select lower(translate(coalesce(p, ''),
    'áäčďéěëíňóöřšťúůüýžÁÄČĎÉĚËÍŇÓÖŘŠŤÚŮÜÝŽ', 'aacdeeeinoorstuuuyzAACDEEEINOORSTUUUYZ'))
$$;

create or replace function job_search(p_words text[], p_limit int default 500)
returns table (job_id uuid, score int)
language sql stable set search_path = public as $$
  with w as (
    select distinct search_plain(x) as plain, search_compact(x) as compact
    from unnest(coalesce(p_words, '{}'::text[])) x
    where length(search_compact(x)) >= 1
  ),
  -- pole zakázky s vahou: 100 číslo zakázky, 90 čísla dokladů, 60 výkres / položka, 40 název a zákazník,
  -- 20 poznámky a obsah dokumentů
  f as (
    select o.id as jid, 100 as wt, o.number as t from orders o where o.merged_into_id is null
    union all select o.id, 90, x from orders o, unnest(array[o.customer_order_number, o.customer_inquiry_number,
      o.invoice_number, o.delivery_note_number, o.supplier_order_number]) x where o.merged_into_id is null and x is not null
    union all select q.job_id, 90, q.number from quotes q where q.job_id is not null
    union all select po.job_id, 90, po.number from purchase_orders po where po.job_id is not null
    union all select sq.job_id, 90, sq.number from supplier_quotes sq where sq.job_id is not null and sq.number is not null
    union all select d.order_id, 90, d.number from delivery_notes d where d.order_id is not null
    union all select i.order_id, 60, x from order_items i, unnest(array[i.drawing_number, i.name, i.description, i.material,
      i.material_designation, i.material_group]) x where x is not null
    union all select o.id, 40, x from orders o, unnest(array[o.title, o.production_step_title]) x where o.merged_into_id is null and x is not null
    union all select o.id, 40, c.name from orders o join customers c on c.id = o.customer_id where o.merged_into_id is null
    union all select o.id, 20, x from orders o, unnest(array[o.note, o.customer_note, o.claim_note, o.lost_note, o.waiting_note,
      o.awaiting_po_note, o.corrected_note, o.stage_change_note, o.partial_delivery_note]) x where o.merged_into_id is null and x is not null
    union all select i.order_id, 20, x from order_items i, unnest(array[i.note, i.supplier_note, i.drawing_notes]) x where x is not null
    union all select q.job_id, 20, q.title from quotes q where q.job_id is not null and q.title is not null
    union all select q.job_id, 20, q.note from quotes q where q.job_id is not null and q.note is not null
    union all select po.job_id, 20, po.note from purchase_orders po where po.job_id is not null and po.note is not null
    union all select sq.job_id, 20, sq.note from supplier_quotes sq where sq.job_id is not null and sq.note is not null
    union all select jf.job_id, 20, concat_ws(' ', jf.filename, jf.title, jf.note, jf.ai_extracted::text) from job_files jf
      where jf.job_id is not null and not coalesce(jf.archived, false)
  ),
  hits as (
    select f.jid, w.compact as word,
      max(f.wt + case
        when search_compact(f.t) = w.compact then 30                         -- přesná shoda
        when f.wt >= 90 and search_compact(f.t) like '%' || w.compact then 15 -- konec čísla („026" → Z-2026-026)
        else 0 end) as s
    from f join w on (search_plain(f.t) like '%' || w.plain || '%' or search_compact(f.t) like '%' || w.compact || '%')
    group by f.jid, w.compact
  )
  select h.jid, sum(h.s)::int
  from hits h
  group by h.jid
  having count(distinct h.word) = (select count(*) from w)
  order by 2 desc
  limit greatest(1, least(coalesce(p_limit, 500), 2000))
$$;

do $$ begin
  revoke execute on function job_search(text[], int) from public, anon, authenticated;
  grant execute on function job_search(text[], int) to service_role;
end $$;
