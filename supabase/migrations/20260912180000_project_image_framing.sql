-- ============================================================================
-- JUDECH — 25 · framing the cover image
--
-- A 16:9 card crops whatever you upload, and the interesting part of a photo is
-- rarely in the middle of it. So a project now remembers how its cover should
-- sit: filled and cropped to a point you chose by dragging, or shown whole with
-- nothing cut off.
--
--   image_fit    'cover'   fill the frame, crop what does not fit (default)
--                'contain' show the whole image, letterboxed
--   image_focus  the object-position kept from the drag, e.g. '38% 22%'
--   image_zoom   1 – 4, how far the image is pushed into the frame
-- ============================================================================

alter table public.projects
  add column if not exists image_fit   text         not null default 'cover',
  add column if not exists image_focus text         not null default '50% 50%',
  add column if not exists image_zoom  numeric(4,2) not null default 1;

alter table public.projects drop constraint if exists projects_image_fit_valid;
alter table public.projects add constraint projects_image_fit_valid
  check (image_fit in ('cover', 'contain'));

alter table public.projects drop constraint if exists projects_image_zoom_range;
alter table public.projects add constraint projects_image_zoom_range
  check (image_zoom >= 1 and image_zoom <= 4);

-- '38% 22%' — two percentages, nothing else, so the value can go straight into
-- a style attribute on the page
alter table public.projects drop constraint if exists projects_image_focus_shape;
alter table public.projects add constraint projects_image_focus_shape
  check (image_focus ~ '^[0-9]{1,3}(\.[0-9]+)?% [0-9]{1,3}(\.[0-9]+)?%$');
