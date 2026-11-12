-- ============================================================
-- Interní připomínka „Počet doplň — v e-mailu není" se při založení zakázky z e-mailu ukládala do
-- poznámky položky (order_items.note) a odtud se kopírovala do nabídky (quote_items.note) — a tiskla
-- zákazníkovi na nabídku (NAB-2026-006, majitel 4. 11.). Poznámka položky je text pro zákazníka;
-- připomínka patří jen do historie zakázky (opraveno v aplikaci). Tady se z dat odstraní.
-- Idempotentní (lze spustit opakovaně).
-- ============================================================

update order_items
   set note = nullif(btrim(regexp_replace(note, 'Počet doplň — v e-mailu není', '', 'g')), '')
 where note like '%Počet doplň — v e-mailu není%';

update quote_items
   set note = nullif(btrim(regexp_replace(note, 'Počet doplň — v e-mailu není', '', 'g')), '')
 where note like '%Počet doplň — v e-mailu není%';

update purchase_order_items
   set note = nullif(btrim(regexp_replace(note, 'Počet doplň — v e-mailu není', '', 'g')), '')
 where note like '%Počet doplň — v e-mailu není%';
