-- ============================================================================
-- JUDECH — 17 · message conversations, unread receipts, edits and admin delete
-- ============================================================================

create table if not exists public.contact_message_entries (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.contact_messages (id) on delete cascade,
  sender_role      text not null check (sender_role in ('user', 'admin')),
  sender_id        uuid not null references auth.users (id) on delete cascade,
  body             text not null check (char_length(btrim(body)) between 1 and 4000),
  read_at          timestamptz,
  edited_at        timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists contact_message_entries_thread_idx
  on public.contact_message_entries (conversation_id, created_at);
create index if not exists contact_message_entries_unread_idx
  on public.contact_message_entries (sender_role, read_at, created_at desc);

drop trigger if exists contact_message_entries_set_updated_at on public.contact_message_entries;
create trigger contact_message_entries_set_updated_at
  before update on public.contact_message_entries
  for each row execute function public.set_updated_at();

-- Keep messages and replies created before this migration.
insert into public.contact_message_entries
  (conversation_id, sender_role, sender_id, body, read_at, created_at, updated_at)
select m.id, 'user', m.user_id, m.message,
       case when m.admin_reply is not null then m.replied_at else null end,
       m.created_at, m.created_at
from public.contact_messages m
where not exists (
  select 1 from public.contact_message_entries e where e.conversation_id = m.id
);

insert into public.contact_message_entries
  (conversation_id, sender_role, sender_id, body, created_at, updated_at)
select m.id, 'admin', m.replied_by, m.admin_reply,
       coalesce(m.replied_at, m.updated_at), coalesce(m.replied_at, m.updated_at)
from public.contact_messages m
where m.admin_reply is not null
  and m.replied_by is not null
  and not exists (
    select 1 from public.contact_message_entries e
    where e.conversation_id = m.id and e.sender_role = 'admin'
  );

alter table public.contact_message_entries enable row level security;

drop policy if exists "buyers read entries in their conversations" on public.contact_message_entries;
create policy "buyers read entries in their conversations"
  on public.contact_message_entries for select
  to authenticated
  using (exists (
    select 1 from public.contact_messages m
    where m.id = conversation_id and m.user_id = auth.uid()
  ));

drop policy if exists "admins read every message entry" on public.contact_message_entries;
create policy "admins read every message entry"
  on public.contact_message_entries for select
  to authenticated
  using (public.is_admin());

grant select on public.contact_message_entries to authenticated;

create or replace function public.send_contact_message(p_title text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_meta jsonb;
begin
  if auth.uid() is null or
     coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    raise exception 'sign in with Google before sending a message' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 3 and 120 then
    raise exception 'the title must be between 3 and 120 characters' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 10 and 4000 then
    raise exception 'the message must be between 10 and 4000 characters' using errcode = '22023';
  end if;

  v_meta := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);
  insert into public.contact_messages
    (user_id, user_email, user_name, title, message)
  values
    (auth.uid(),
     coalesce(nullif(auth.jwt() ->> 'email', ''), 'unknown'),
     coalesce(nullif(v_meta ->> 'full_name', ''), nullif(v_meta ->> 'name', '')),
     btrim(p_title), btrim(p_message))
  returning id into v_id;

  insert into public.contact_message_entries
    (conversation_id, sender_role, sender_id, body)
  values (v_id, 'user', auth.uid(), btrim(p_message));

  return v_id;
end;
$$;

create or replace function public.send_contact_message_entry(p_conversation_id uuid, p_message text)
returns public.contact_message_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_owner uuid;
  v_row public.contact_message_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in before sending a message' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 4000 then
    raise exception 'write a message before sending it' using errcode = '22023';
  end if;

  select user_id into v_owner from public.contact_messages where id = p_conversation_id;
  if v_owner is null then
    raise exception 'conversation not found' using errcode = '22023';
  end if;
  if not v_admin and (v_owner <> auth.uid() or
      coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google') then
    raise exception 'you cannot send to this conversation' using errcode = '42501';
  end if;

  insert into public.contact_message_entries
    (conversation_id, sender_role, sender_id, body)
  values
    (p_conversation_id, case when v_admin then 'admin' else 'user' end,
     auth.uid(), btrim(p_message))
  returning * into v_row;

  if v_admin then
    update public.contact_messages
       set status = 'replied', admin_reply = v_row.body,
           replied_at = v_row.created_at, replied_by = auth.uid()
     where id = p_conversation_id;
  else
    update public.contact_messages set status = 'open' where id = p_conversation_id;
  end if;

  return v_row;
end;
$$;

create or replace function public.update_contact_message_entry(p_entry_id uuid, p_message text)
returns public.contact_message_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contact_message_entries%rowtype;
begin
  if auth.uid() is null then
    raise exception 'sign in before updating a message' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_message, ''))) not between 1 and 4000 then
    raise exception 'the message cannot be empty' using errcode = '22023';
  end if;

  update public.contact_message_entries
     set body = btrim(p_message), edited_at = now(), read_at = null
   where id = p_entry_id and sender_id = auth.uid()
  returning * into v_row;

  if not found then
    raise exception 'you can update only messages you sent' using errcode = '42501';
  end if;
  if v_row.sender_role = 'admin' and v_row.id = (
    select e.id from public.contact_message_entries e
    where e.conversation_id = v_row.conversation_id and e.sender_role = 'admin'
    order by e.created_at desc limit 1
  ) then
    update public.contact_messages set admin_reply = v_row.body
    where id = v_row.conversation_id;
  end if;
  return v_row;
end;
$$;

create or replace function public.mark_contact_conversation_read(p_conversation_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean := public.is_admin();
  v_owner uuid;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'sign in before reading messages' using errcode = '42501';
  end if;
  select user_id into v_owner from public.contact_messages where id = p_conversation_id;
  if v_owner is null or (not v_admin and v_owner <> auth.uid()) then
    raise exception 'conversation not found' using errcode = '42501';
  end if;

  update public.contact_message_entries
     set read_at = now()
   where conversation_id = p_conversation_id
     and sender_role = case when v_admin then 'user' else 'admin' end
     and read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.delete_contact_message_entry(p_entry_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation uuid;
  v_latest public.contact_message_entries%rowtype;
  v_last_role text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can delete messages' using errcode = '42501';
  end if;
  delete from public.contact_message_entries where id = p_entry_id
  returning conversation_id into v_conversation;
  if not found then raise exception 'message not found' using errcode = '22023'; end if;

  select * into v_latest
  from public.contact_message_entries
  where conversation_id = v_conversation and sender_role = 'admin'
  order by created_at desc limit 1;

  select sender_role into v_last_role
  from public.contact_message_entries
  where conversation_id = v_conversation
  order by created_at desc limit 1;

  if v_latest.id is not null then
    update public.contact_messages
       set status = case when v_last_role = 'admin' then 'replied' else 'open' end,
           admin_reply = v_latest.body,
           replied_at = v_latest.created_at, replied_by = v_latest.sender_id
     where id = v_conversation;
  else
    update public.contact_messages
       set status = 'open', admin_reply = null, replied_at = null, replied_by = null
     where id = v_conversation;
  end if;
end;
$$;

create or replace function public.delete_contact_conversation(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'only an admin can delete conversations' using errcode = '42501';
  end if;
  delete from public.contact_messages where id = p_conversation_id;
  if not found then raise exception 'conversation not found' using errcode = '22023'; end if;
end;
$$;

-- Keep the earlier RPC working, but make each reply a new conversation entry.
create or replace function public.reply_contact_message(p_id uuid, p_reply text)
returns public.contact_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.contact_messages%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can reply to messages' using errcode = '42501';
  end if;
  perform public.send_contact_message_entry(p_id, p_reply);
  select * into v_row from public.contact_messages where id = p_id;
  return v_row;
end;
$$;

revoke all on function public.send_contact_message_entry(uuid, text) from public, anon;
revoke all on function public.update_contact_message_entry(uuid, text) from public, anon;
revoke all on function public.mark_contact_conversation_read(uuid) from public, anon;
revoke all on function public.delete_contact_message_entry(uuid) from public, anon;
revoke all on function public.delete_contact_conversation(uuid) from public, anon;
grant execute on function public.send_contact_message_entry(uuid, text) to authenticated;
grant execute on function public.update_contact_message_entry(uuid, text) to authenticated;
grant execute on function public.mark_contact_conversation_read(uuid) to authenticated;
grant execute on function public.delete_contact_message_entry(uuid) to authenticated;
grant execute on function public.delete_contact_conversation(uuid) to authenticated;
