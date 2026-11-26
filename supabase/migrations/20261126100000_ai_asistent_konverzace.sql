-- ============================================================
-- 20261126100000 — AI asistent: uložené konverzace (majitel 26. 11.)
-- „nepamatuje si moje historické konverzace a nedrží linku konverzace"
-- Každý uživatel vidí jen své konverzace (RLS). Zprávy: dotaz uživatele a odpověď asistenta (text).
-- ============================================================

create table if not exists assistant_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  title      text not null default 'Nová konverzace',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_assistant_conversations_user on assistant_conversations (user_id, updated_at desc);

create table if not exists assistant_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references assistant_conversations(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index if not exists idx_assistant_messages_conv on assistant_messages (conversation_id, created_at);

alter table assistant_conversations enable row level security;
alter table assistant_messages enable row level security;

do $$ begin
  create policy "assistant_conv_own" on assistant_conversations for all
    using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "assistant_msg_own" on assistant_messages for all
    using (exists (select 1 from assistant_conversations c where c.id = conversation_id and c.user_id = auth.uid()))
    with check (exists (select 1 from assistant_conversations c where c.id = conversation_id and c.user_id = auth.uid()));
exception when duplicate_object then null; end $$;

grant select, insert, update, delete on assistant_conversations, assistant_messages to authenticated, service_role;
