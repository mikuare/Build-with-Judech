-- ============================================================================
-- JUDECH — 03 · payments waiting for your approval
--
-- Buyers never touch this table directly: RLS gives anon nothing at all, and
-- everything they do goes through the functions in migration 05. That way a
-- buyer cannot insert a row that is already "approved", and cannot read anyone
-- else's payment — not even their own, except through their claim token.
-- ============================================================================

do $$
begin
  create type public.payment_status as enum ('pending', 'approved', 'rejected');
exception
  when duplicate_object then null;
end;
$$;

create table if not exists public.payments (
  id            uuid primary key default gen_random_uuid(),
  claim_token   uuid not null default gen_random_uuid(),   -- the buyer's receipt stub
  project_id    text not null references public.projects (id) on update cascade,

  buyer_name    text not null check (char_length(btrim(buyer_name)) between 2 and 120),
  buyer_contact text check (char_length(buyer_contact) <= 200),

  method        text not null check (char_length(btrim(method)) between 2 and 40),
  reference     text not null check (char_length(btrim(reference)) between 4 and 80),
  amount        numeric(12,2) check (amount >= 0),
  currency      text not null default 'PHP',
  paid_on       date not null,
  receipt_path  text,                                       -- storage: receipts/<uuid>.jpg

  status        public.payment_status not null default 'pending',
  review_note   text,
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users (id),

  submitted_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- the same reference cannot be used twice for the same project
  constraint payments_reference_unique unique (project_id, reference),
  -- a reviewed row must say when it was reviewed
  constraint payments_reviewed_consistent
    check ((status = 'pending') = (reviewed_at is null))
);

create unique index if not exists payments_claim_token_idx on public.payments (claim_token);
create index if not exists payments_inbox_idx on public.payments (status, submitted_at desc);
create index if not exists payments_project_idx on public.payments (project_id, submitted_at desc);

drop trigger if exists payments_set_updated_at on public.payments;
create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

-- no policy for anon: the anon key cannot select, insert, update or delete here
drop policy if exists "admins see every payment" on public.payments;
create policy "admins see every payment"
  on public.payments for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins update payments" on public.payments;
create policy "admins update payments"
  on public.payments for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins delete payments" on public.payments;
create policy "admins delete payments"
  on public.payments for delete
  to authenticated
  using (public.is_admin());
