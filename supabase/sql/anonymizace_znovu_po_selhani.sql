-- Anonymizace výkresů: všechny selhané výkresy znovu do fronty (ve všech tabulkách fronty).
-- Ruční spuštění kdykoli: Supabase → SQL Editor → vložit a spustit. Totéž jednorázově udělá migrace
-- 20261105120000 při nasazení. Bezpečné opakovat (mění jen řádky ve stavu „failed").
--
-- 1) Náhled: kolik souborů se vrátí do fronty
select 'job_files' as tabulka, count(*) from job_files
 where anon_status = 'failed' and archived = false
   and coalesce(anon_reason, '') not like 'PDF je zaheslované%'
   and coalesce(anon_reason, '') not like 'Soubor není čitelné PDF%'
   and coalesce(anon_reason, '') not like 'Soubor je větší než 50 MB%'
   and coalesce(anon_reason, '') not like 'Soubor nemá uloženou cestu%'
   and coalesce(anon_reason, '') not like 'Originál souboru v úložišti chybí%'
union all
select 'drawings', count(*) from drawings where anon_status = 'failed'
union all
select 'drawing_anon_adhoc', count(*) from drawing_anon_adhoc where anon_status = 'failed';

-- 2) Znovu do fronty (soubory zakázek, archiv výkresů, samostatný nástroj). Vady souboru, u kterých opakování
--    nepomůže (heslo k otevření, nečitelné PDF, > 50 MB, chybějící originál), zůstávají „selhalo".
update job_files
   set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
       anon_priority = least(coalesce(anon_priority, 0), 5)
 where anon_status = 'failed' and archived = false
   and coalesce(anon_reason, '') not like 'PDF je zaheslované%'
   and coalesce(anon_reason, '') not like 'Soubor není čitelné PDF%'
   and coalesce(anon_reason, '') not like 'Soubor je větší než 50 MB%'
   and coalesce(anon_reason, '') not like 'Soubor nemá uloženou cestu%'
   and coalesce(anon_reason, '') not like 'Originál souboru v úložišti chybí%';

update drawings
   set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
       anon_priority = least(coalesce(anon_priority, 0), 5)
 where anon_status = 'failed'
   and coalesce(anon_reason, '') not like 'PDF je zaheslované%'
   and coalesce(anon_reason, '') not like 'Soubor není čitelné PDF%'
   and coalesce(anon_reason, '') not like 'Soubor je větší než 50 MB%'
   and coalesce(anon_reason, '') not like 'Soubor nemá uloženou cestu%'
   and coalesce(anon_reason, '') not like 'Originál souboru v úložišti chybí%';

update drawing_anon_adhoc
   set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null,
       anon_priority = least(coalesce(anon_priority, 0), 5)
 where anon_status = 'failed'
   and coalesce(anon_reason, '') not like 'PDF je zaheslované%'
   and coalesce(anon_reason, '') not like 'Soubor není čitelné PDF%'
   and coalesce(anon_reason, '') not like 'Soubor je větší než 50 MB%'
   and coalesce(anon_reason, '') not like 'Soubor nemá uloženou cestu%'
   and coalesce(anon_reason, '') not like 'Originál souboru v úložišti chybí%';

-- 3) Spuštění zpracování hned (jinak při otevření Poptávek / zakázky, nebo denním plánovačem v 5:41):
--    curl -H "Authorization: Bearer <CRON_SECRET>" https://<adresa-aplikace>/api/cron/drawing-anonymize
--    (každé volání zpracuje až 10 souborů na tabulku a zbytek rozvětví; lze opakovat)
--
-- 4) Kontrola stavu fronty
select anon_status, count(*) from job_files where archived = false and anon_status is not null group by 1 order by 1;
