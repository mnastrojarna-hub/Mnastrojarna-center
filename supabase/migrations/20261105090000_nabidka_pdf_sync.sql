-- Nabídka ↔ její PDF v Dokumentech (5. 11.): smazání nabídky dřív nechalo její vystavené PDF mezi
-- aktuálními dokumenty (FK quote_id „set null") a smazání PDF nechalo nabídku. Nové mazání je souměrné
-- v aplikaci (lib/jobs/quote-files, quote-file-sync); tady jen úklid dat: vystavené PDF nabídky, jejíž
-- záznam už neexistuje, se archivuje (nic se nemaže — v archivu Dokumentů zůstane dohledatelné).
-- Idempotentní.
update job_files
   set archived = true
 where kind = 'nabidka'
   and origin = 'generated'
   and quote_id is null
   and not archived;
