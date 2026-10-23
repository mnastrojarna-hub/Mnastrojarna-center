-- Dávkové focení: relace v DB, idempotence ukládání, vazby dokumentů, archiv výkresů z dokumentů zakázky

-- 1) Storage job-files: složka capture/ jen vlastní a bez přepisu (relace dávky je v DB)
drop policy if exists "job_files_bucket_read"   on storage.objects;
drop policy if exists "job_files_bucket_insert" on storage.objects;
drop policy if exists "job_files_bucket_update" on storage.objects;
create policy "job_files_bucket_read" on storage.objects for select using (
  bucket_id = 'job-files' and auth.role() = 'authenticated'
  and ((storage.foldername(name))[1] <> 'capture' or (storage.foldername(name))[2] = auth.uid()::text));
create policy "job_files_bucket_insert" on storage.objects for insert with check (
  bucket_id = 'job-files' and auth.role() = 'authenticated'
  and ((storage.foldername(name))[1] <> 'capture' or (storage.foldername(name))[2] = auth.uid()::text));
create policy "job_files_bucket_update" on storage.objects for update using (
  bucket_id = 'job-files' and auth.role() = 'authenticated' and (storage.foldername(name))[1] <> 'capture');

-- 2) Relace dávky (jen servisní klíč)
create table if not exists capture_sessions (
  id          uuid primary key,
  user_id     uuid not null references profiles(id) on delete cascade,
  status      text not null default 'open' check (status in ('open','partial','done','discarded')),
  data        jsonb not null,
  lock_token  uuid,
  lock_until  timestamptz,
  expires_at  timestamptz not null default now() + interval '24 hours',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_capture_sessions_user on capture_sessions(user_id, expires_at);
create table if not exists capture_doc_extracts (
  capture_id  uuid not null references capture_sessions(id) on delete cascade,
  doc_id      text not null,
  pages_key   text not null,
  doc_type    text not null,
  status      text not null check (status in ('reading','ready','manual','error')),
  data        jsonb,
  error       text,
  usage       jsonb,
  started_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (capture_id, doc_id, pages_key, doc_type)
);
create table if not exists capture_apply_steps (
  capture_id  uuid not null references capture_sessions(id) on delete cascade,
  step        text not null,
  status      text not null check (status in ('started','done','failed')),
  result      jsonb,
  updated_at  timestamptz not null default now(),
  primary key (capture_id, step)
);
alter table capture_sessions     enable row level security;
alter table capture_doc_extracts enable row level security;
alter table capture_apply_steps  enable row level security;

create or replace function capture_try_lock(p_capture uuid, p_user uuid, p_token uuid, p_ttl_seconds int)
returns boolean language sql as $$
  with u as (
    update capture_sessions
       set lock_token = p_token, lock_until = now() + make_interval(secs => p_ttl_seconds), updated_at = now()
     where id = p_capture and user_id = p_user and status in ('open','partial')
       and (lock_until is null or lock_until < now())
    returning 1)
  select exists (select 1 from u);
$$;
create or replace function capture_unlock(p_capture uuid, p_token uuid)
returns void language sql as $$
  update capture_sessions set lock_token = null, lock_until = null where id = p_capture and lock_token = p_token;
$$;
revoke all on function capture_try_lock(uuid, uuid, uuid, int) from public, anon, authenticated;
revoke all on function capture_unlock(uuid, uuid) from public, anon, authenticated;
grant execute on function capture_try_lock(uuid, uuid, uuid, int) to service_role;
grant execute on function capture_unlock(uuid, uuid) to service_role;

-- 3) Idempotence ukládání
alter table orders          add column if not exists capture_key text;   -- "<captureId>:<groupKey>"
create unique index if not exists uq_orders_capture_key on orders(capture_key) where capture_key is not null;
alter table order_items     add column if not exists capture_key text;   -- "<captureId>:<groupKey>:<itemKey>"
create unique index if not exists uq_order_items_capture_key on order_items(capture_key) where capture_key is not null;
alter table supplier_quotes add column if not exists capture_id uuid;
alter table supplier_quotes add column if not exists capture_doc_id text;
create unique index if not exists uq_supplier_quotes_capture on supplier_quotes(capture_id, capture_doc_id)
  where capture_id is not null;

-- 4) Vazby dokumentů
alter table job_files add column if not exists order_item_id  uuid references order_items(id) on delete set null;
alter table job_files add column if not exists capture_id     uuid;
alter table job_files add column if not exists content_sha256 text;
create index if not exists idx_job_files_item    on job_files(order_item_id);
create index if not exists idx_job_files_capture on job_files(capture_id);
create index if not exists idx_job_files_sha     on job_files(content_sha256);

-- 5) Archiv výkresů z dokumentů zakázky
alter table drawings add column if not exists storage_bucket text not null default 'documents';
alter table drawings add column if not exists job_file_id    uuid references job_files(id) on delete set null;
alter table drawings add column if not exists title          text;
alter table drawings add column if not exists job_id         uuid references orders(id) on delete set null;
