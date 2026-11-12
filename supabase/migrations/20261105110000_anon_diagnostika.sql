-- Anonymizace výkresů — diagnostika pokusů (majitel 5. 11.: „často ještě selže anonymizace výkresu, někdy to
-- musí dělat na třikrát; chtělo by, aby to fungovalo na první pokus").
--
-- Kód (src/lib/anonymize/service.ts, runner.ts, pdf-pipeline.ts, company-check.ts) nově:
--  a) přechodnou chybu (přetížená AI, výpadek, čas) a navazující dávku stran zopakuje HNED v témže běhu
--     (dřív čekala na další šťouchnutí z prohlížeče nebo klik), výsledky AI ukládá průběžně (přerušený běh
--     o ně nepřijde),
--  b) zbylý název firmy v kopii dořeší v témže běhu (jména z kontroly kopie → termíny → stránka znovu),
--     automatické pokusy po úniku 3 (dřív 2 a pak „Klikni Anonymizovat znovu"),
--  c) KAŽDÝ pokus zapíše technický záznam do nového sloupce anon_debug (fáze, čas, surová chyba, číslo pokusu,
--     id běhu) — surová chyba se uživateli neukazuje (anon_reason zůstává česká věta s radou), UI ji ukáže
--     jen super adminovi (editor anonymizace, sekce „Anonymizace výkresů").
--
-- Tady: sloupec anon_debug jsonb (pole posledních ≤ 12 záznamů) u všech tří tabulek fronty. Hodnotu zapisuje
-- jen server (servisní klient); přes REST ji strážce anon_* nehlídá — je to jen diagnostika bez tajných údajů.
-- Idempotentní (add column if not exists, comment).

do $$
declare
  t text;
begin
  foreach t in array array['job_files', 'drawings', 'drawing_anon_adhoc'] loop
    execute format('alter table %I add column if not exists anon_debug jsonb', t);
    execute format($c$comment on column %I.anon_debug is 'Anonymizace: diagnostika posledních pokusů (pole {at, run, attempt, stage, ms, status, reason, error, kind, calls, usd, next, delayMs, retryNow}); jen super admin (src/lib/anonymize/types.ts AnonDebugEntry)'$c$, t);
  end loop;
end $$;
