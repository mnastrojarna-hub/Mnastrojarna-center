-- Výkon (31. 10.): indexy pro dotazy, které stránky posílají při každém zobrazení a které dosud
-- končily sekvenčním průchodem tabulky (EXPLAIN ANALYZE na datech 300 zakázek / 2 000 položek /
-- 5 000 e-mailů). Idempotentní — druhé spuštění nic nezmění.

-- Karta zakázky (issuedNoteRefs, documentedQuantities): dodací listy zakázky
--   delivery_notes?order_id=eq.…&storage_path=like.zakazky/%&order=created_at.desc
create index if not exists idx_delivery_notes_order on delivery_notes (order_id, created_at desc);

-- Poptávky / Nacenění (odznaky anonymizace): fronta odeslání podle zakázek
--   anon_send_queue?select=job_id&job_id=in.(…)
create index if not exists idx_anon_send_queue_job on anon_send_queue (job_id);

-- Kniha zakázek a stránky toku: seznam bez sloučených zakázek, nejnovější první, stránkovaný po 1 000
--   orders?merged_into_id=is.null&order=created_at.desc,id.asc&offset=…&limit=1000
create index if not exists idx_orders_live_created on orders (created_at desc, id) where merged_into_id is null;
