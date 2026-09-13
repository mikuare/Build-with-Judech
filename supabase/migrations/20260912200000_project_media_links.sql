-- ============================================================================
-- JUDECH — 26 · public preview links on a project
--
-- A package item can already point anywhere, but package items are behind the
-- payment. A demo video is the opposite: it is the thing that convinces someone
-- to pay, so it has to be watchable before they do.
--
-- media is an ordered array of {label, url, note} objects. They show on the
-- project as buttons that open in a new tab, to anyone, signed in or not.
-- ============================================================================

alter table public.projects
  add column if not exists media jsonb not null default '[]'::jsonb;

alter table public.projects drop constraint if exists projects_media_array;
alter table public.projects add constraint projects_media_array
  check (jsonb_typeof(media) = 'array');
