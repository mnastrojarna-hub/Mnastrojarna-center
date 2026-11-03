-- ── Sdílení dokumentů Mnástrojárna CAD odkazem (web mnastrojarna.cz/cad) ──────────────────────
-- Web ukládá do bucketu `cad-share` POUZE šifrované soubory (AES-GCM 256); klíč je jen v odkazu za `#`,
-- který server nikdy nevidí. Název souboru je náhodný (128 bitů), složka `dN/` = platnost N dní.
-- Čtení: veřejná adresa objektu (bucket public) – obsah je bez klíče nečitelný, seznam objektů anon nevidí.
-- Zápis: anon smí jen vkládat (ne přepisovat, ne mazat) soubory s přesně daným tvarem názvu, max. 25 MB.
-- Úklid: pg_cron denně smaže metadata objektů po vypršení platnosti → soubor přestane být dostupný
-- (fyzický soubor Supabase doúklidí; obsah je i tak šifrovaný).
--
-- Web (statický export) potřebuje při buildu:  NEXT_PUBLIC_CAD_SHARE_URL=https://<projekt>.supabase.co
--                                              NEXT_PUBLIC_CAD_SHARE_KEY=<anon key>

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cad-share', 'cad-share', true, 26214400, array['application/octet-stream'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

do $$ begin
  create policy "cad_share_insert" on storage.objects
    for insert to anon, authenticated
    with check (
      bucket_id = 'cad-share'
      and name ~ '^d(1|7|10|30|90)/[A-Za-z0-9_-]{22}\.bin$'
    );
exception when duplicate_object then null; end $$;

-- Denní úklid vypršelých sdílení (03:23 UTC). Rozšíření pg_cron: Supabase → Database → Extensions → pg_cron.
do $$ begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron není dostupné – úklid cad-share zapněte ručně (Database → Extensions → pg_cron) a spusťte tento blok znovu.';
end $$;

do $$ begin
  perform cron.schedule(
    'cad-share-purge',
    '23 3 * * *',
    $job$
      delete from storage.objects
      where bucket_id = 'cad-share'
        and created_at < now() - (substring(name from '^d(\d+)/')::int * interval '1 day');
    $job$
  );
exception when others then
  raise notice 'Naplánování úklidu cad-share se nezdařilo: %', sqlerrm;
end $$;
