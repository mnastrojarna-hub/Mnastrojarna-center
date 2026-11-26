-- ============================================================
-- 20261125100000 — Zrušit neodeslaný testovací e-mail „Test" → vitek.volny@seznam.cz (majitel 25. 11.)
-- „tu hlášku … o tom, že volnému neodešel nějaký mail, smaž … testovací mail je bezpředmětný"
-- Jen řádky fronty K odeslání s předmětem „Test" pro tuto adresu, které ještě neodešly. Idempotentní.
-- ============================================================

update mail_outbox
   set status = 'cancelled', updated_at = now(),
       last_error = left(coalesce(last_error, '') || ' · Zrušeno (testovací e-mail, majitel 25. 11.)', 1000)
 where status in ('waiting', 'failed', 'sending')
   and lower(btrim(coalesce(payload->>'subject', ''))) = 'test'
   and lower(coalesce(payload->>'to', '')) like '%vitek.volny@seznam.cz%';
