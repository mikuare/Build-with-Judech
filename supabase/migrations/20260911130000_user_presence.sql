-- ============================================================================
-- JUDECH — 13 · signed-in account activity
--
-- Presence is stored per Supabase Auth session. "Active now" is intentionally
-- derived from a recent heartbeat: closing a browser or losing a connection does
-- not reliably send a sign-out request, but the heartbeat simply expires.
-- ============================================================================

create table if not exists public.user_sessions (
  session_id     text primary key,
  user_id        uuid not null references auth.users (id) on delete cascade,
  email          text,
  display_name   text,
  avatar_url     text,
  provider       text,
  is_admin       boolean not null default false,
  signed_in_at   timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  signed_out_at  timestamptz
);

create index if not exists user_sessions_user_idx
  on public.user_sessions (user_id, last_seen_at desc);
create index if not exists user_sessions_online_idx
  on public.user_sessions (last_seen_at desc)
  where signed_out_at is null;

alter table public.user_sessions enable row level security;

drop policy if exists "admins read account activity" on public.user_sessions;
create policy "admins read account activity"
  on public.user_sessions for select
  to authenticated
  using (public.is_admin());

grant select on public.user_sessions to authenticated;

-- All identity values come from the verified JWT. The browser supplies only the
-- event name, and can update only the session named by its own access token.
create or replace function public.record_presence(p_event text default 'heartbeat')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session_id text;
  v_meta       jsonb;
begin
  if auth.uid() is null then
    raise exception 'sign in before recording account activity' using errcode = '42501';
  end if;
  if p_event not in ('heartbeat', 'signout') then
    raise exception 'unknown presence event %', p_event using errcode = '22023';
  end if;

  v_session_id := coalesce(nullif(auth.jwt() ->> 'session_id', ''), auth.uid()::text);
  v_meta := coalesce(auth.jwt() -> 'user_metadata', '{}'::jsonb);

  insert into public.user_sessions
    (session_id, user_id, email, display_name, avatar_url, provider, is_admin,
     signed_in_at, last_seen_at, signed_out_at)
  values
    (v_session_id,
     auth.uid(),
     nullif(auth.jwt() ->> 'email', ''),
     coalesce(nullif(v_meta ->> 'full_name', ''), nullif(v_meta ->> 'name', '')),
     coalesce(nullif(v_meta ->> 'avatar_url', ''), nullif(v_meta ->> 'picture', '')),
     nullif(auth.jwt() -> 'app_metadata' ->> 'provider', ''),
     public.is_admin(),
     now(), now(), case when p_event = 'signout' then now() else null end)
  on conflict (session_id) do update
    set email         = excluded.email,
        display_name  = excluded.display_name,
        avatar_url    = excluded.avatar_url,
        provider      = excluded.provider,
        is_admin      = excluded.is_admin,
        last_seen_at  = now(),
        signed_out_at = case when p_event = 'signout' then now() else null end;
end;
$$;

revoke all on function public.record_presence(text) from public, anon;
grant execute on function public.record_presence(text) to authenticated;

-- One dashboard row per account, aggregated across phones, browsers and tabs.
create or replace view public.user_activity
with (security_invoker = on) as
select
  s.user_id,
  max(s.email) as email,
  max(s.display_name) as display_name,
  max(s.avatar_url) as avatar_url,
  max(s.provider) as provider,
  bool_or(s.is_admin) as is_admin,
  min(s.signed_in_at) as first_seen_at,
  max(s.signed_in_at) as last_signed_in_at,
  max(s.last_seen_at) as last_seen_at,
  max(s.signed_out_at) as last_signed_out_at,
  count(*) as session_count,
  count(*) filter (
    where s.signed_out_at is null
      and s.last_seen_at >= now() - interval '2 minutes'
  ) as active_sessions,
  bool_or(
    s.signed_out_at is null
    and s.last_seen_at >= now() - interval '2 minutes'
  ) as is_active
from public.user_sessions s
group by s.user_id;

grant select on public.user_activity to authenticated;
