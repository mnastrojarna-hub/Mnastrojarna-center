-- ═══════════════════════════════════════════════════════════════════════════
--  Pošta → speciální stav zakázky (majitel 9. 11.): „Stejně by to mělo tyto stavy umět přečíst z pošty
--  a automaticky přiřadit k zakázkám." + „samozřejmě s korekcí".
--
--  E-mail zákazníka přiřazený k zakázce, který naznačuje reklamaci, nerealizování (jiný dodavatel, cena,
--  projekt zrušen), storno objednávky, pozastavení, pokračování nebo vyřízení reklamace:
--   * emails.ai_job_signal        — výstup AI klasifikace pošty ({kind, reason, confidence}),
--   * job_mail_stage_signals      — rozpoznaný signál k zakázce (jednou na vlákno + zakázku + druh):
--                                   návrh (fronta ke schválení / tlačítko ve vlákně), použitý (automaticky / ručně),
--                                   zamítnutý, vrácený (Vrátit) — a co bylo před změnou (pro Vrátit),
--   * approval_type 'job_stage'   — položka fronty „E-mail od … naznačuje reklamaci zakázky Z-… — přepnout?",
--   * automation_settings 'mail_job_stage' — výchozí „se schválením".
--  Zápisy jen aplikace (servisní klíč); čtení přihlášeným aktivním uživatelům (bez citace z e-mailu).
--  Idempotentní: druhé spuštění nic nezmění.
-- ═══════════════════════════════════════════════════════════════════════════

alter type approval_type add value if not exists 'job_stage';

alter table emails add column if not exists ai_job_signal jsonb;
comment on column emails.ai_job_signal is
  'AI klasifikace pošty: signál pro speciální stav zakázky {kind: reklamace|nerealizovano|zruseno|pozastaveno|pokracovat|reklamace_vyrizena|none, reason, confidence}.';

create table if not exists job_mail_stage_signals (
  id            uuid primary key default gen_random_uuid(),
  job_id        uuid not null references orders(id) on delete cascade,
  email_id      uuid references emails(id) on delete set null,
  -- vlákno (thread_id), jinak „e:<id e-mailu>" — signál se pro stejné vlákno + zakázku + druh nikdy neopakuje
  thread_key    text not null,
  kind          text not null,
  -- druh, který se opravdu použil (člověk ho mohl při potvrzení / korekci změnit; kind = rozpoznaný)
  final_kind    text,
  party         text,
  source        text not null default 'rules',
  confidence    numeric(4,3),
  reason        text,
  quote         text,
  lost_reason   text,
  claim_reason  text,
  from_name     text,
  status        text not null default 'pending',
  mode          text,
  approval_id   uuid references approval_queue(id) on delete set null,
  from_stage    job_stage,
  to_stage      job_stage,
  -- hodnoty zakázky před změnou (reklamace, pozastavení, nabídky) + razítko změny stavu (Vrátit jen beze změny od té doby)
  prev          jsonb,
  applied_at    timestamptz,
  applied_by    uuid references profiles(id) on delete set null,
  applied_kind  text,
  event_id      uuid,
  resolved_at   timestamptz,
  resolved_by   uuid references profiles(id) on delete set null,
  correction    text,
  created_at    timestamptz not null default now()
);

do $$ begin
  alter table job_mail_stage_signals add constraint job_mail_stage_signals_kind_check check (kind in
    ('reklamace', 'nerealizovano', 'zruseno', 'pozastaveno', 'pokracovat', 'reklamace_vyrizena'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table job_mail_stage_signals add constraint job_mail_stage_signals_status_check check (status in
    ('pending', 'applied', 'rejected', 'undone', 'stale'));
exception when duplicate_object then null; end $$;

alter table job_mail_stage_signals add column if not exists final_kind text;

create unique index if not exists uq_job_mail_stage_signals_once on job_mail_stage_signals (thread_key, job_id, kind);
create index if not exists idx_job_mail_stage_signals_job on job_mail_stage_signals (job_id, created_at desc);
create index if not exists idx_job_mail_stage_signals_email on job_mail_stage_signals (email_id);
create index if not exists idx_job_mail_stage_signals_approval on job_mail_stage_signals (approval_id) where approval_id is not null;

alter table job_mail_stage_signals enable row level security;
drop policy if exists "job_mail_stage_signals_select" on job_mail_stage_signals;
create policy "job_mail_stage_signals_select" on job_mail_stage_signals for select using (is_active_user());
revoke all on job_mail_stage_signals from anon, authenticated;
grant select (id, job_id, email_id, thread_key, kind, final_kind, party, source, confidence, reason, lost_reason, claim_reason, from_name, status,
              mode, approval_id, from_stage, to_stage, applied_at, applied_by, applied_kind, event_id, resolved_at, resolved_by,
              correction, created_at)
  on job_mail_stage_signals to authenticated;

-- sloučení zakázek (#24): pozdní zápis míří na cílovou zakázku
do $$ begin
  if exists (select 1 from pg_proc where proname = 'merge_redirect_job') then
    drop trigger if exists trg_000_merge_redirect on job_mail_stage_signals;
    create trigger trg_000_merge_redirect before insert or update of job_id on job_mail_stage_signals
      for each row execute function merge_redirect_job('job_id');
  end if;
end $$;

insert into automation_settings (module, mode) values
  ('mail_job_stage', 'approval')   -- speciální stav zakázky z pošty: výchozí jen návrh (fronta / tlačítko ve vlákně)
on conflict (module) do nothing;
