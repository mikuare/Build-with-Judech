-- ============================================================================
-- JUDECH — 06 · storage for receipts and signatures
--
-- Both buckets are private. A buyer may upload into them and nothing else:
-- they cannot list, read, overwrite or delete — not even their own file. You
-- read them as an admin, or through a signed URL you generate.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('receipts',   'receipts',   false, 8388608,  array['image/jpeg','image/png','image/webp','application/pdf']),
  ('signatures', 'signatures', false, 2097152,  array['image/png','image/jpeg','image/webp'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ------------------------------------------------------------- upload only
drop policy if exists "anyone may upload a receipt" on storage.objects;
create policy "anyone may upload a receipt"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'receipts');

drop policy if exists "anyone may upload a signature" on storage.objects;
create policy "anyone may upload a signature"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'signatures');

-- ------------------------------------------------------------- admins read
drop policy if exists "admins read the private buckets" on storage.objects;
create policy "admins read the private buckets"
  on storage.objects for select
  to authenticated
  using (bucket_id in ('receipts', 'signatures') and public.is_admin());

drop policy if exists "admins tidy the private buckets" on storage.objects;
create policy "admins tidy the private buckets"
  on storage.objects for delete
  to authenticated
  using (bucket_id in ('receipts', 'signatures') and public.is_admin());
