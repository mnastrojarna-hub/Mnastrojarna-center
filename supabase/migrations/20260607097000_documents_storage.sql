-- ============================================================
-- 0013 — Storage bucket pro archiv dokumentů (PDF)
-- ============================================================

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- Čtení/zápis pro přihlášené (servisní klíč RLS obchází).
do $$ begin
  create policy "documents_bucket_read" on storage.objects
    for select using (bucket_id = 'documents' and auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "documents_bucket_write" on storage.objects
    for insert with check (bucket_id = 'documents' and auth.role() = 'authenticated');
exception when duplicate_object then null; end $$;
