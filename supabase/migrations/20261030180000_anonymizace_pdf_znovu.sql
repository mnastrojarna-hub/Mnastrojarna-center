-- Anonymizace PDF: soubory nepravdivě označené „PDF je poškozené nebo zaheslované…" → znovu do fronty.
-- (majitel 30. 10.: „anonymizace stále nefunguje píše to: PDF je poškozené nebo zaheslované — nejde otevřít.
--  Požádej o nový soubor. to je blbost")
--
-- Příčina nebyla v souborech: pdf.js v bundlu Next.js si DOMMatrix / Path2D / ImageData doplňuje přes
-- createRequire(cesta ze stroje buildu) — ve funkci na Vercelu ta cesta neexistuje, vykreslení KAŽDÉHO PDF
-- spadlo („Path2D is not defined") a jakákoli chyba u PDF se hlásila jako „poškozené nebo zaheslované".
-- Oprava v kódu (pdf-node.ts doplní globály sám, poctivé hlášky + automatické opakování); tady se vrátí
-- do fronty i soubory, které už selhaly s touto hláškou (a s obecnou „technickou chybou"), aby je nikdo
-- nemusel spouštět ručně — zpracují se hned při otevření zakázky / Poptávek / Archivu výkresů a plánovačem.
--
-- Idempotentní: druhé spuštění nic nezmění (hlášky už nejsou). Vada souboru (heslo k otevření, nečitelné
-- PDF) se při novém běhu pozná poctivě a skončí „nelze" s pravdivým důvodem.

update job_files
   set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null
 where anon_status in ('failed', 'pending')
   and archived = false
   and anon_reason in (
     'PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.',
     'Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.'
   );

update drawings
   set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null
 where anon_status in ('failed', 'pending')
   and anon_reason in (
     'PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.',
     'Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.'
   );

update drawing_anon_adhoc
   set anon_status = 'pending', anon_reason = null, anon_attempts = 0, anon_lock_until = null
 where anon_status in ('failed', 'pending')
   and anon_reason in (
     'PDF je poškozené nebo zaheslované — nejde otevřít. Požádej o nový soubor.',
     'Anonymizace se nepovedla (technická chyba) — zkus Anonymizovat znovu.'
   );
