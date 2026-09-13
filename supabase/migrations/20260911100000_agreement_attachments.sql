-- ============================================================================
-- JUDECH — 10 · supporting files on a signed agreement
--
-- Screenshots of the Facebook chat where they agreed, a photo of a receipt, a
-- note — anything that backs up the agreement. ADMIN ONLY, on purpose: buyers
-- have no way to add or even see these. The anon role gets no policy here and
-- cannot upload to the bucket, unlike `receipts` and `signatures`.
-- ============================================================================

create table if not exists public.agreement_attachments (
  id           uuid primary key default gen_random_uuid(),
  agreement_id uuid not null references public.agreements (id) on delete cascade,
  path         text not null,                       -- storage: attachments/<uuid>.jpg
  mime         text,
  caption      text check (caption is null or char_length(caption) <= 400),
  kind         text not null default 'support'
                 check (kind in ('support', 'chat', 'receipt', 'id', 'other')),
  added_by     uuid references auth.users (id),
  created_at   timestamptz not null default now()
);

create index if not exists agreement_attachments_idx
  on public.agreement_attachments (agreement_id, created_at);

alter table public.agreement_attachments enable row level security;

-- no anon policy at all: buyers cannot read, add or remove these
drop policy if exists "admins manage agreement attachments" on public.agreement_attachments;
create policy "admins manage agreement attachments"
  on public.agreement_attachments for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, delete on public.agreement_attachments to authenticated;

-- ------------------------------------------------------------------ bucket
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('attachments', 'attachments', false, 10485760,
        array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- unlike receipts and signatures, nobody but an admin may put anything in here
drop policy if exists "admins upload attachments" on storage.objects;
create policy "admins upload attachments"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'attachments' and public.is_admin());

drop policy if exists "admins read attachments" on storage.objects;
create policy "admins read attachments"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'attachments' and public.is_admin());

drop policy if exists "admins delete attachments" on storage.objects;
create policy "admins delete attachments"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and public.is_admin());
