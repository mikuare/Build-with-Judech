-- ============================================================================
-- JUDECH — 02 · the catalog
-- The page can keep reading its projects from js/landing.js; this table is here
-- so payments can reference a project and so the catalog can move server-side.
-- ============================================================================

create table if not exists public.projects (
  id             text primary key,                      -- 'envirosortpro'
  name           text not null,
  tagline        text,
  blurb          text,
  kind           text not null default 'web'
                   check (kind in ('web', 'mobile', 'embedded', 'any')),
  status         text not null default 'soon'
                   check (status in ('ready', 'soon')),
  rights         text not null default 'catalog'
                   check (rights in ('catalog', 'custom')),
  tags           text[] not null default '{}',
  items          text[] not null default '{}',          -- 'simulation','code',...
  price_amount   numeric(12,2) check (price_amount >= 0),
  price_currency text not null default 'PHP',
  position       integer not null default 100,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists projects_set_updated_at on public.projects;
create trigger projects_set_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

alter table public.projects enable row level security;

-- the catalog is public reading; only an admin may change it
drop policy if exists "anyone can read the catalog" on public.projects;
create policy "anyone can read the catalog"
  on public.projects for select
  to anon, authenticated
  using (true);

drop policy if exists "admins manage the catalog" on public.projects;
create policy "admins manage the catalog"
  on public.projects for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
