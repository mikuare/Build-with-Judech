-- ============================================================================
-- JUDECH — 18 · optional admin overrides for the built-in hero slideshow
--
-- No default rows are inserted. When a slide has no row here, index.html keeps
-- using its bundled image and copy. Resetting an override therefore never
-- deletes or replaces the permanent default assets.
-- ============================================================================

create table if not exists public.hero_slides (
  slide_key    text primary key
                 check (slide_key in ('embedded', 'web', 'inventory', 'automation')),
  image_url    text check (image_url is null or char_length(image_url) <= 2048),
  eyebrow      text check (eyebrow is null or char_length(btrim(eyebrow)) between 1 and 80),
  headline     text check (headline is null or char_length(btrim(headline)) between 1 and 160),
  alt_text     text check (alt_text is null or char_length(btrim(alt_text)) between 1 and 240),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users (id)
);

drop trigger if exists hero_slides_set_updated_at on public.hero_slides;
create trigger hero_slides_set_updated_at
  before update on public.hero_slides
  for each row execute function public.set_updated_at();

alter table public.hero_slides enable row level security;

drop policy if exists "anyone can read hero slide overrides" on public.hero_slides;
create policy "anyone can read hero slide overrides"
  on public.hero_slides for select
  to anon, authenticated
  using (true);

drop policy if exists "admins manage hero slide overrides" on public.hero_slides;
create policy "admins manage hero slide overrides"
  on public.hero_slides for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.hero_slides to anon, authenticated;
grant insert, update, delete on public.hero_slides to authenticated;
