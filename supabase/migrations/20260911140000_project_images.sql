-- ============================================================================
-- JUDECH — 14 · project cover images
--
-- The image itself is uploaded by an admin to the existing public
-- `project-files` bucket. The catalog stores only its public URL.
-- ============================================================================

alter table public.projects
  add column if not exists image_url text;

alter table public.projects
  drop constraint if exists projects_image_url_length;
alter table public.projects
  add constraint projects_image_url_length
  check (image_url is null or char_length(image_url) <= 2048);
