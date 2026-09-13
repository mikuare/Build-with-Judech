-- ============================================================================
-- JUDECH — 16 · account-based contact messages and admin replies
-- ============================================================================

create table if not exists public.contact_messages (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  user_email    text not null,
  user_name     text,
  title         text not null check (char_length(btrim(title)) between 3 and 120),
  message       text not null check (char_length(btrim(message)) between 10 and 4000),
  status        text not null default 'open' check (status in ('open', 'replied', 'closed')),
  admin_reply   text check (admin_reply is null or char_length(btrim(admin_reply)) between 1 and 4000),
  replied_at    timestamptz,
  replied_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists contact_messages_admin_idx
  on public.contact_messages (status, created_at desc);
create index if not exists contact_messages_user_idx
  on public.contact_messages (user_id, created_at desc);

drop trigger if exists contact_messages_set_updated_at on public.contact_messages;
create trigger contact_messages_set_updated_at
  before update on public.contact_messages
  for each row execute function public.set_updated_at();

alter table public.contact_messages enable row level security;

drop policy if exists "buyers read their own messages" on public.contact_messages;
create policy "buyers read their own messages"
  on public.contact_messages for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "admins read every message" on public.contact_messages;
create policy "admins read every message"
  on public.contact_messages for select
  to authenticated
  using (public.is_admin());

grant select on public.contact_messages to authenticated;

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

  return v_id;
end;
$$;

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
  if char_length(btrim(coalesce(p_reply, ''))) not between 1 and 4000 then
    raise exception 'write a reply before sending it' using errcode = '22023';
  end if;

  update public.contact_messages
     set admin_reply = btrim(p_reply),
         status = 'replied',
         replied_at = now(),
         replied_by = auth.uid()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'message not found' using errcode = '22023';
  end if;
  return v_row;
end;
$$;

revoke all on function public.send_contact_message(text, text) from public, anon;
revoke all on function public.reply_contact_message(uuid, text) from public, anon;
grant execute on function public.send_contact_message(text, text) to authenticated;
grant execute on function public.reply_contact_message(uuid, text) to authenticated;
