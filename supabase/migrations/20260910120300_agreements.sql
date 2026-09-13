-- ============================================================================
-- JUDECH — 04 · signed terms & conditions
-- One row per buyer per project: who signed, how they signed, and against which
-- version of the terms. The drawn signature itself lives in storage.
-- ============================================================================

create table if not exists public.agreements (
  id             uuid primary key default gen_random_uuid(),
  project_id     text not null references public.projects (id) on update cascade,
  payment_id     uuid references public.payments (id) on delete set null,

  seller         text not null default 'JUDECH',
  buyer_name     text not null check (char_length(btrim(buyer_name)) between 2 and 120),

  signature_type text not null default 'drawn'
                   check (signature_type in ('drawn', 'typed')),
  signature_path text,                       -- storage: signatures/<uuid>.png
  signature_text text,                       -- when they typed it instead

  rights         text not null default 'catalog'
                   check (rights in ('catalog', 'custom')),
  terms_version  text not null default '2026-09-10 · sections 1-12',
  signed_on      date not null,
  accepted_at    timestamptz not null default now(),
  user_agent     text,

  constraint agreements_signature_present check (
    (signature_type = 'drawn' and signature_path is not null) or
    (signature_type = 'typed' and char_length(btrim(coalesce(signature_text, ''))) >= 2)
  )
);

create index if not exists agreements_project_idx on public.agreements (project_id, accepted_at desc);
create index if not exists agreements_payment_idx on public.agreements (payment_id);

alter table public.agreements enable row level security;

-- same as payments: anon gets nothing directly, admins get everything
drop policy if exists "admins read agreements" on public.agreements;
create policy "admins read agreements"
  on public.agreements for select
  to authenticated
  using (public.is_admin());

drop policy if exists "admins write agreements" on public.agreements;
create policy "admins write agreements"
  on public.agreements for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());
