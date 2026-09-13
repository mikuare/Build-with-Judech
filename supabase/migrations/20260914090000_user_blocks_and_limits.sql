-- ============================================================================
-- JUDECH — 29 · blocking an account, and a limit on how fast it can write
--
-- Two defences, and they answer different problems.
--
-- A BLOCK is a judgement you make about a person: this one is a nuisance, stop
-- them. It is deliberate, reversible, and it says why. A blocked account cannot
-- open a conversation, add to one, submit a payment or redeem a code. What they
-- already bought and signed for stays theirs — being blocked is not a refund.
--
-- A RATE LIMIT is arithmetic that applies to everyone, including the polite. It
-- is set so that no honest person will meet it:
--
--   8 seconds     between one message and the next   — stops a double-tap and a
--                                                      held-down key
--   5 new threads per hour                            — spam arrives as new
--                                                      subjects, not as replies
--   25 messages   per hour, all threads together      — the ceiling on a flood
--
-- A single flat cooldown (say 30 seconds on everything) punishes the person who
-- remembers one more detail right after sending, which is most people. Short
-- gap, generous hour: the same protection, felt only by someone abusing it.
-- ============================================================================

create table if not exists public.user_blocks (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text,
  reason     text check (char_length(reason) <= 400),
  blocked_at timestamptz not null default now(),
  blocked_by uuid references auth.users (id),
  until      timestamptz            -- null = until you lift it
);

create index if not exists user_blocks_email_idx on public.user_blocks (lower(email));

alter table public.user_blocks enable row level security;

drop policy if exists "admins manage blocks" on public.user_blocks;
create policy "admins manage blocks"
  on public.user_blocks for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- a signed-in person may read their own block, so the page can say why
drop policy if exists "you can see your own block" on public.user_blocks;
create policy "you can see your own block"
  on public.user_blocks for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.user_blocks to authenticated;
grant insert, update, delete on public.user_blocks to authenticated;

-- ------------------------------------------------------------- is it on?
create or replace function public.is_blocked(p_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.user_blocks b
     where b.user_id = coalesce(p_user, auth.uid())
       and (b.until is null or b.until > now())
  );
$$;

grant execute on function public.is_blocked(uuid) to anon, authenticated;

-- --------------------------------------------------- you block / unblock
create or replace function public.set_user_block(
  p_user_id uuid,
  p_blocked boolean,
  p_reason  text default null,
  p_hours   integer default null      -- null with p_blocked = a block with no end
)
returns public.user_blocks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_blocks%rowtype;
  v_mail text;
begin
  if not public.is_admin() then
    raise exception 'only an admin can block an account' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'you cannot block yourself' using errcode = '22023';
  end if;
  if exists (select 1 from public.admins a where a.user_id = p_user_id) then
    raise exception 'that account is an admin' using errcode = '22023';
  end if;

  if not p_blocked then
    delete from public.user_blocks where user_id = p_user_id returning * into v_row;
    return v_row;
  end if;

  select max(s.email) into v_mail from public.user_sessions s where s.user_id = p_user_id;

  insert into public.user_blocks (user_id, email, reason, blocked_by, until)
  values (p_user_id, v_mail, nullif(btrim(coalesce(p_reason, '')), ''), auth.uid(),
          case when p_hours is null then null else now() + make_interval(hours => p_hours) end)
  on conflict (user_id) do update
     set reason = excluded.reason,
         blocked_at = now(),
         blocked_by = excluded.blocked_by,
         until = excluded.until,
         email = coalesce(excluded.email, public.user_blocks.email)
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_user_block(uuid, boolean, text, integer) from public;
grant execute on function public.set_user_block(uuid, boolean, text, integer) to authenticated;

-- ------------------------------------------------------- the rate limit
-- Raised as an ordinary error so the page can show it in the same place it
-- shows “the title is too short”.
create or replace function public.check_message_rate(p_new_thread boolean)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_last  timestamptz;
  v_hour  integer;
  v_fresh integer;
  v_wait  integer;
begin
  if public.is_blocked() then
    raise exception 'this account cannot send messages — reply to an earlier thread or contact JUDECH another way'
      using errcode = '42501';
  end if;

  select max(e.created_at) into v_last
    from public.contact_message_entries e
   where e.sender_id = auth.uid() and e.sender_role = 'user';

  if v_last is not null and v_last > now() - interval '8 seconds' then
    v_wait := ceil(extract(epoch from (v_last + interval '8 seconds' - now())));
    raise exception 'one moment — you can send the next message in % second%',
      v_wait, case when v_wait = 1 then '' else 's' end using errcode = '22023';
  end if;

  select count(*) into v_hour
    from public.contact_message_entries e
   where e.sender_id = auth.uid() and e.sender_role = 'user'
     and e.created_at > now() - interval '1 hour';

  if v_hour >= 25 then
    raise exception 'that is 25 messages in an hour — please wait a while before sending more'
      using errcode = '22023';
  end if;

  if p_new_thread then
    select count(*) into v_fresh
      from public.contact_messages m
     where m.user_id = auth.uid() and m.created_at > now() - interval '1 hour';
    if v_fresh >= 5 then
      raise exception 'you have started 5 conversations in an hour — please add to one of those instead'
        using errcode = '22023';
    end if;
  end if;
end;
$$;

grant execute on function public.check_message_rate(boolean) to authenticated;

-- ============================================================================
-- The two doors a buyer writes through now ask both questions first.
-- Everything else in these functions is exactly as migration 17 left it.
-- ============================================================================
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

  perform public.check_message_rate(true);

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

  -- the limit is for buyers; you are never rate-limited in your own inbox
  if not v_admin then perform public.check_message_rate(false); end if;

  insert into public.contact_message_entries
    (conversation_id, sender_role, sender_id, body)
  values
    (p_conversation_id, case when v_admin then 'admin' else 'user' end,
     auth.uid(), btrim(p_message))
  returning * into v_row;

  update public.contact_messages
     set status = case when v_admin then 'replied' else 'open' end,
         updated_at = now()
   where id = p_conversation_id;

  return v_row;
end;
$$;

-- ------------------------------------------- a block stops money too
create or replace function public.redeem_access_code(
  p_code       text,
  p_buyer_name text default null
)
returns table (payment_id uuid, claim_token uuid, status public.payment_status,
               project_id text, channel text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_grant public.access_grants%rowtype;
  v_pay   public.payments%rowtype;
begin
  if public.is_blocked() then
    raise exception 'this account cannot redeem a code — contact JUDECH' using errcode = '42501';
  end if;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) < 8 then
    raise exception 'that does not look like an access code' using errcode = '22023';
  end if;

  select * into v_grant
    from public.access_grants g
   where regexp_replace(g.code, '[^A-Z0-9]', '', 'g') = v_code;

  if not found then
    raise exception 'no access code matches' using errcode = '22023';
  end if;
  if v_grant.revoked_at is not null then
    raise exception 'that access code has been cancelled' using errcode = '22023';
  end if;
  if v_grant.expires_at is not null and v_grant.expires_at < now() then
    raise exception 'that access code has expired' using errcode = '22023';
  end if;

  if v_grant.payment_id is not null then
    select * into v_pay from public.payments p where p.id = v_grant.payment_id;
    if found then
      return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
      return;
    end if;
  end if;

  insert into public.payments
    (project_id, buyer_name, method, reference, amount, paid_on, status,
     review_note, reviewed_at, reviewed_by)
  values
    (v_grant.project_id,
     coalesce(nullif(btrim(coalesce(p_buyer_name, '')), ''), v_grant.buyer_name),
     v_grant.channel, v_grant.code, null, v_grant.created_at::date, 'approved',
     'Settled via ' || v_grant.channel || ' — access code' ||
       case when v_grant.note is null then '' else ': ' || v_grant.note end,
     now(), v_grant.created_by)
  returning * into v_pay;

  if array_length(v_grant.item_ids, 1) is not null then
    insert into public.payment_item_access (payment_id, item_id, state, note, decided_by)
    select v_pay.id, i.item_id,
           case when i.item_id = any (v_grant.item_ids) then 'released' else 'held' end,
           'Set by access code ' || v_grant.code,
           v_grant.created_by
      from public.project_package_items(v_grant.project_id) i
    on conflict (payment_id, item_id) do nothing;
  end if;

  update public.access_grants
     set redeemed_at = coalesce(redeemed_at, now()),
         payment_id  = v_pay.id
   where id = v_grant.id;

  return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
end;
$$;

grant execute on function public.redeem_access_code(text, text) to anon, authenticated;

-- ------------------------------------------- the dashboard's people list
create or replace view public.user_directory
with (security_invoker = on) as
select
  a.user_id, a.email, a.display_name, a.avatar_url, a.provider, a.is_admin,
  a.first_seen_at, a.last_signed_in_at, a.last_seen_at, a.session_count, a.is_active,
  (b.user_id is not null and (b.until is null or b.until > now())) as is_blocked,
  b.reason as block_reason,
  b.blocked_at,
  b.until as blocked_until,
  coalesce(m.threads, 0)  as thread_count,
  coalesce(m.messages, 0) as message_count,
  m.last_message_at,
  coalesce(p.payments, 0) as payment_count
from public.user_activity a
left join public.user_blocks b on b.user_id = a.user_id
left join lateral (
  select count(distinct c.id) as threads,
         count(e.id)          as messages,
         max(e.created_at)    as last_message_at
  from public.contact_messages c
  left join public.contact_message_entries e
         on e.conversation_id = c.id and e.sender_role = 'user'
  where c.user_id = a.user_id
) m on true
left join lateral (
  select count(*) as payments from public.payments pay where pay.user_id = a.user_id
) p on true;

grant select on public.user_directory to authenticated;
