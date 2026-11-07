-- ============================================================
-- Výkres DXF / DWG → PDF (majitel 7. 11.: „málo kdo otevře DXF — chybí převést na PDF, případně hromadně").
--  Převedené PDF je samostatný dokument zakázky (druh výkres); source_file_id = dokument DXF / DWG, ze
--  kterého vzniklo. Podle něj hromadný převod přeskočí výkresy, které PDF už mají, a opakovaný převod
--  téhož výkresu vytvoří novou verzi PDF místo dalšího souboru. Smazání zdroje vazbu jen zruší (PDF zůstává).
-- Idempotentní.
-- ============================================================

alter table job_files add column if not exists source_file_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'job_files_source_file_id_fkey') then
    alter table job_files
      add constraint job_files_source_file_id_fkey foreign key (source_file_id) references job_files(id) on delete set null;
  end if;
end $$;

create index if not exists job_files_source_file_id_idx on job_files (source_file_id) where source_file_id is not null;

comment on column job_files.source_file_id is 'Dokument (DXF / DWG), ze kterého byl tento soubor převeden (PDF výkresu).';
