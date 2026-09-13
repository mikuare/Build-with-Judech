-- ============================================================================
-- JUDECH — 28 · more than one photo per proof, and room for a video file
--
-- A delivered build is rarely one photograph: there is the machine, the wiring
-- inside it, the handover, the message afterwards. So a proof now carries an
-- ordered gallery, each picture with its own caption, and the tile opens into
-- a viewer you can page through.
--
--   images  [{ "url": "...", "caption": "..." }, …]   the gallery, in order
--   image_url                                          the cover — the first one
--   video_url   a platform link (YouTube, TikTok) OR a file you uploaded here;
--               a file plays inside the viewer, a link opens on its platform
--
-- The bucket limit goes up to 64 MB so a phone clip can be uploaded directly.
-- ============================================================================

alter table public.proofs
  add column if not exists images jsonb not null default '[]'::jsonb;

alter table public.proofs drop constraint if exists proofs_images_array;
alter table public.proofs add constraint proofs_images_array
  check (jsonb_typeof(images) = 'array');

-- a gallery on its own is now enough to make a tile worth showing
alter table public.proofs drop constraint if exists proofs_has_something;
alter table public.proofs add constraint proofs_has_something check (
  coalesce(nullif(btrim(image_url), ''), nullif(btrim(video_url), '')) is not null
  or jsonb_array_length(images) > 0
);

-- ---------------------------------------------------------------- storage
-- 64 MB, so a short clip off a phone goes straight in. Note: a Supabase
-- project also has a global upload ceiling (Dashboard → Storage → Settings);
-- if that is lower than this, the lower one wins and uploads will be refused
-- with "Payload too large" until it is raised.
update storage.buckets
   set file_size_limit = 67108864
 where id = 'project-files';

insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', true, 67108864)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;
