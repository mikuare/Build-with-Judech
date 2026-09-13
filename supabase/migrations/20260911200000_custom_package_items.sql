-- ============================================================================
-- JUDECH — 20 · flexible project package items
--
-- Stores ordered package cards with their type, custom title and description,
-- icon, uploaded attachment/public URL, and browser-opening preference. Legacy
-- `items`, `planned` and `links` remain populated for backwards compatibility.
-- ============================================================================

alter table public.projects
  add column if not exists package_items jsonb not null default '[]'::jsonb;

alter table public.projects
  drop constraint if exists projects_package_items_array;
alter table public.projects
  add constraint projects_package_items_array
  check (jsonb_typeof(package_items) = 'array');
