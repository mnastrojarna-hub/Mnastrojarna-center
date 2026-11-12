-- Anonymizace výkresů: všechny selhané výkresy znovu do fronty — ve všech tabulkách fronty (soubory zakázek,
-- archiv výkresů, samostatný nástroj). Majitel 5. 11.: „dej mi příkaz, aby se anonymizovaly všechny výkresy,
-- kde anonymizace selhala, a to ve všech flow".
--
-- Spolu s opravami v kódu (21a43e0: opakování a dořešení úniku názvu firmy v témže běhu, průběžná cache AI)
-- dostanou dřívější selhání nový běh bez klikání. Zpracují se při otevření Poptávek / zakázky / Archivu
-- výkresů (šťouchnutí z prohlížeče), plánovačem /api/cron/drawing-anonymize, nebo ručně („Anonymizovat").
--
-- Vynechávají se jen vady souboru, u kterých opakování nepomůže (heslo k otevření, nečitelné PDF, > 50 MB,
-- chybějící originál v úložišti) — ty zůstávají „selhalo" s pravdivým důvodem. Priorita ≤ 5 = běžná fronta
-- (ne backfill ≥ 9, který bere jen plánovač). Stejný příkaz pro ruční spuštění: supabase/sql/anonymizace_znovu_po_selhani.sql.
-- Idempotentní: druhé spuštění nic nezmění (řádky už nejsou „failed").

do $$
declare
  t text;
  n int;
begin
  foreach t in array array['job_files', 'drawings', 'drawing_anon_adhoc'] loop
    execute format($q$
      update %I
         set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
             anon_priority = least(coalesce(anon_priority, 0), 5)
       where anon_status = 'failed'
         and coalesce(anon_reason, '') not like 'PDF je zaheslované%%'
         and coalesce(anon_reason, '') not like 'Soubor není čitelné PDF%%'
         and coalesce(anon_reason, '') not like 'Soubor je větší než 50 MB%%'
         and coalesce(anon_reason, '') not like 'Soubor nemá uloženou cestu%%'
         and coalesce(anon_reason, '') not like 'Originál souboru v úložišti chybí%%'
         %s
    $q$, t, case when t = 'job_files' then 'and archived = false' else '' end);
    get diagnostics n = row_count;
    raise notice 'anonymizace znovu do fronty: % → % souborů', t, n;
  end loop;
end $$;
