-- ============================================================================
-- JUDECH — 30 · the heartbeat that keeps a free project awake
--
-- Supabase pauses a Free-plan project that sees no "user database activity"
-- for a week. Visitors loading the catalog count, so a site with any traffic
-- stays up on its own — but a quiet week must not take the shop offline. So:
--
--   heartbeat(source)   one insert, callable with the anon key from anywhere:
--                       a GitHub Actions cron, cron-job.org, the admin's own
--                       "Ping now" button. A write, because a write is the
--                       unambiguous kind of activity.
--   heartbeat_status()  what the dashboard shows: when the last one landed and
--                       how many in the past seven days.
--   pg_cron             a daily insert from inside the database as well, where
--                       the extension is available. Belt and braces: the outside
--                       ping is what the pausing rule is written against.
-- ============================================================================

create table if not exists public.heartbeats (
  id     bigserial primary key,
  source text not null default 'ping' check (char_length(source) between 1 and 60),
  at     timestamptz not null default now()
);

create index if not exists heartbeats_at_idx on public.heartbeats (at desc);

alter table public.heartbeats enable row level security;
-- nobody reads or writes the table directly; both go through the functions

create or replace function public.heartbeat(p_source text default 'ping')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_at    timestamptz;
  v_week  integer;
begin
  insert into public.heartbeats (source)
  values (left(coalesce(nullif(btrim(p_source), ''), 'ping'), 60))
  returning at into v_at;

  -- the log is a pulse, not a history: sixty days is plenty
  delete from public.heartbeats where at < now() - interval '60 days';

  select count(*) into v_week from public.heartbeats where at > now() - interval '7 days';

  return jsonb_build_object('at', v_at, 'source', p_source, 'last_7_days', v_week);
end;
$$;

create or replace function public.heartbeat_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'last_at',     (select max(at) from public.heartbeats),
    'last_source', (select source from public.heartbeats order by at desc limit 1),
    'last_7_days', (select count(*) from public.heartbeats where at > now() - interval '7 days'),
    'last_30_days',(select count(*) from public.heartbeats where at > now() - interval '30 days'),
    'sources_7d',  (select coalesce(jsonb_object_agg(source, n), '{}'::jsonb) from (
                      select source, count(*) as n from public.heartbeats
                       where at > now() - interval '7 days' group by source) s)
  );
$$;

revoke all on function public.heartbeat(text) from public;
revoke all on function public.heartbeat_status() from public;
grant execute on function public.heartbeat(text) to anon, authenticated;
grant execute on function public.heartbeat_status() to authenticated;

-- ---------------------------------------------------------------- pg_cron
-- Enabled in Supabase under Database → Extensions if this block reports it
-- could not. It never fails the migration: the outside ping does not need it.
do $$
begin
  begin
    create extension if not exists pg_cron with schema extensions;
  exception when others then
    create extension if not exists pg_cron;
  end;

  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'judech-heartbeat';
    perform cron.schedule(
      'judech-heartbeat',
      '17 3 * * *',                          -- every day at 03:17 UTC (11:17 Manila)
      $job$ select public.heartbeat('pg_cron'); $job$
    );
    raise notice 'judech-heartbeat scheduled daily via pg_cron';
  end if;
exception when others then
  raise notice 'pg_cron is not available here (%). The outside ping keeps the project awake on its own.', sqlerrm;
end;
$$;

-- the first beat, so the dashboard has something to show straight away
select public.heartbeat('migration');
