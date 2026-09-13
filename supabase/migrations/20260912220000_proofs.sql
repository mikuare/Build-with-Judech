-- ============================================================================
-- JUDECH — 27 · proof of legitimacy
--
-- Someone landing here for the first time has no reason to trust a page. This
-- is where the evidence goes: a delivered build, a client's message, a receipt,
-- a certificate, a clip of a machine actually running. Each one is a tile with
-- a label saying what it is, a title, a line of explanation, and a photo or a
-- video behind it.
--
-- Read by anyone — that is the whole point — but only the published ones, and
-- only an admin can add or change them.
-- ============================================================================

create table if not exists public.proofs (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'Proof'
                check (char_length(btrim(kind)) between 2 and 40),
  title       text not null
                check (char_length(btrim(title)) between 2 and 140),
  description text check (char_length(description) <= 600),
  image_url   text,
  video_url   text,
  happened_on date,
  position    integer not null default 100,
  published   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- a tile with nothing to show is not proof of anything
  constraint proofs_has_something check (
    coalesce(nullif(btrim(image_url), ''), nullif(btrim(video_url), '')) is not null
  )
);

create index if not exists proofs_order_idx on public.proofs (position, created_at desc);

drop trigger if exists proofs_set_updated_at on public.proofs;
create trigger proofs_set_updated_at
  before update on public.proofs
  for each row execute function public.set_updated_at();

alter table public.proofs enable row level security;

drop policy if exists "anyone reads published proof" on public.proofs;
create policy "anyone reads published proof"
  on public.proofs for select
  to anon, authenticated
  using (published or public.is_admin());

drop policy if exists "admins manage proof" on public.proofs;
create policy "admins manage proof"
  on public.proofs for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.proofs to anon, authenticated;
grant select, insert, update, delete on public.proofs to authenticated;
