-- ============================================================================
-- JUDECH — 01 · extensions, admin check, shared triggers
-- ============================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- updated_at
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -------------------------------------------------------------------- admins
-- One row per person allowed to see payments and approve them. After you sign
-- up in Supabase Auth, add yourself:
--   insert into public.admins (user_id, email)
--   select id, email from auth.users where email = 'you@example.com';
create table if not exists public.admins (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  email    text,
  added_at timestamptz not null default now()
);

alter table public.admins enable row level security;

drop policy if exists "admins see their own row" on public.admins;
create policy "admins see their own row"
  on public.admins for select
  to authenticated
  using (user_id = auth.uid());

-- security definer, so policies can call it without recursing into admins' RLS
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated, anon;
