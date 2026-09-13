-- ============================================================================
-- JUDECH — 12 · buyers sign in with Google
--
-- Every payment and every signed agreement now carries the account that made
-- it, stamped by the server from the session — never from anything the browser
-- sends. Buyers can read their own rows back; they still cannot see anyone
-- else's, and they still cannot write to either table directly.
-- ============================================================================

alter table public.payments
  add column if not exists user_id    uuid references auth.users (id),
  add column if not exists user_email text;

alter table public.agreements
  add column if not exists user_id    uuid references auth.users (id),
  add column if not exists user_email text;

create index if not exists payments_user_idx   on public.payments (user_id, submitted_at desc);
create index if not exists agreements_user_idx on public.agreements (user_id, accepted_at desc);

-- a signed-in buyer may read their own history
drop policy if exists "buyers read their own payments" on public.payments;
create policy "buyers read their own payments"
  on public.payments for select
  to authenticated
  using (user_id is not null and user_id = auth.uid());

drop policy if exists "buyers read their own agreements" on public.agreements;
create policy "buyers read their own agreements"
  on public.agreements for select
  to authenticated
  using (user_id is not null and user_id = auth.uid());

-- ---------------------------------------------------------------- the RPCs
create or replace function public.submit_payment(
  p_project_id    text,
  p_buyer_name    text,
  p_method        text,
  p_reference     text,
  p_amount        numeric,
  p_paid_on       date,
  p_receipt_path  text default null,
  p_buyer_contact text default null
)
returns table (payment_id uuid, claim_token uuid, status public.payment_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready boolean;
begin
  if auth.uid() is null or
     coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    raise exception 'sign in with Google before submitting a payment' using errcode = '42501';
  end if;

  select (pr.status = 'ready') into v_ready from public.projects pr where pr.id = p_project_id;
  if v_ready is null then
    raise exception 'unknown project %', p_project_id using errcode = '22023';
  end if;
  if not v_ready then
    raise exception 'project % is not available yet', p_project_id using errcode = '22023';
  end if;
  if p_paid_on > current_date + 1 then
    raise exception 'the payment date cannot be in the future' using errcode = '22023';
  end if;

  return query
  insert into public.payments
    (project_id, buyer_name, buyer_contact, method, reference, amount, paid_on,
     receipt_path, user_id, user_email)
  values
    (p_project_id, btrim(p_buyer_name), nullif(btrim(coalesce(p_buyer_contact, '')), ''),
     btrim(p_method), btrim(p_reference), p_amount, p_paid_on,
     nullif(btrim(coalesce(p_receipt_path, '')), ''),
     auth.uid(), nullif(auth.jwt() ->> 'email', ''))
  returning payments.id, payments.claim_token, payments.status;
end;
$$;

-- A claim token is not enough on its own anymore: it must be checked by the
-- same signed-in Google account that submitted or redeemed the payment.
create or replace function public.payment_status(p_claim_token uuid)
returns table (
  status       public.payment_status,
  project_id   text,
  reference    text,
  review_note  text,
  reviewed_at  timestamptz,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.status, p.project_id, p.reference, p.review_note, p.reviewed_at, p.submitted_at
  from public.payments p
  where p.claim_token = p_claim_token
    and p.user_id = auth.uid()
    and coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google';
$$;

create or replace function public.sign_agreement(
  p_claim_token    uuid,
  p_buyer_name     text,
  p_signature_type text,
  p_signature_path text default null,
  p_signature_text text default null,
  p_signed_on      date default current_date,
  p_user_agent     text default null,
  p_buyer_type     text default null,
  p_school         text default null,
  p_location       text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_rights  text;
  v_id      uuid;
begin
  if auth.uid() is null or
     coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    raise exception 'sign in with Google before signing the agreement' using errcode = '42501';
  end if;

  select * into v_payment from public.payments where claim_token = p_claim_token;
  if not found then
    raise exception 'no payment matches that token' using errcode = '22023';
  end if;
  if v_payment.status <> 'approved' then
    raise exception 'that payment has not been approved yet' using errcode = '22023';
  end if;
  -- a payment made while signed in can only be signed for by that same account
  if v_payment.user_id is not null and auth.uid() is distinct from v_payment.user_id then
    raise exception 'that payment belongs to a different account' using errcode = '42501';
  end if;

  select pr.rights into v_rights from public.projects pr where pr.id = v_payment.project_id;

  insert into public.agreements
    (project_id, payment_id, buyer_name, signature_type, signature_path,
     signature_text, rights, signed_on, user_agent, buyer_type, school, location,
     user_id, user_email)
  values
    (v_payment.project_id, v_payment.id, btrim(p_buyer_name), p_signature_type,
     nullif(btrim(coalesce(p_signature_path, '')), ''),
     nullif(btrim(coalesce(p_signature_text, '')), ''),
     coalesce(v_rights, 'catalog'), p_signed_on, left(coalesce(p_user_agent, ''), 400),
     nullif(btrim(coalesce(p_buyer_type, '')), ''),
     nullif(btrim(coalesce(p_school, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''),
     coalesce(auth.uid(), v_payment.user_id),
     coalesce(nullif(auth.jwt() ->> 'email', ''), v_payment.user_email))
  returning id into v_id;

  return v_id;
end;
$$;

-- an access code redeemed while signed in belongs to that account too
create or replace function public.redeem_access_code(
  p_code       text,
  p_buyer_name text default null
)
returns table (payment_id uuid, claim_token uuid, status public.payment_status,
               project_id text, channel text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code  text;
  v_grant public.access_grants%rowtype;
  v_pay   public.payments%rowtype;
begin
  if auth.uid() is null or
     coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') <> 'google' then
    raise exception 'sign in with Google before redeeming an access code' using errcode = '42501';
  end if;

  v_code := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if length(v_code) < 8 then
    raise exception 'that does not look like an access code' using errcode = '22023';
  end if;

  select * into v_grant
    from public.access_grants g
   where regexp_replace(g.code, '[^A-Z0-9]', '', 'g') = v_code;

  if not found then
    raise exception 'no access code matches' using errcode = '22023';
  end if;
  if v_grant.revoked_at is not null then
    raise exception 'that access code has been cancelled' using errcode = '22023';
  end if;
  if v_grant.expires_at is not null and v_grant.expires_at < now() then
    raise exception 'that access code has expired' using errcode = '22023';
  end if;

  if v_grant.payment_id is not null then
    select * into v_pay from public.payments p where p.id = v_grant.payment_id;
    if found then
      -- the first account to redeem it keeps it
      if v_pay.user_id is not null and auth.uid() is not null and auth.uid() <> v_pay.user_id then
        raise exception 'that access code has already been used by another account'
          using errcode = '42501';
      end if;
      if v_pay.user_id is null and auth.uid() is not null then
        update public.payments
           set user_id = auth.uid(), user_email = nullif(auth.jwt() ->> 'email', '')
         where id = v_pay.id
        returning * into v_pay;
      end if;
      return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
      return;
    end if;
  end if;

  insert into public.payments
    (project_id, buyer_name, method, reference, amount, paid_on, status,
     review_note, reviewed_at, reviewed_by, user_id, user_email)
  values
    (v_grant.project_id,
     coalesce(nullif(btrim(coalesce(p_buyer_name, '')), ''), v_grant.buyer_name),
     v_grant.channel, v_grant.code, null, v_grant.created_at::date, 'approved',
     'Settled via ' || v_grant.channel || ' — access code' ||
       case when v_grant.note is null then '' else ': ' || v_grant.note end,
     now(), v_grant.created_by,
     auth.uid(), nullif(auth.jwt() ->> 'email', ''))
  returning * into v_pay;

  update public.access_grants
     set redeemed_at = coalesce(redeemed_at, now()),
         payment_id  = v_pay.id
   where id = v_grant.id;

  return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
end;
$$;

-- The browser gate is for a smooth experience; these grants are the real
-- boundary. A caller without a Supabase session cannot create or claim a
-- payment, check its status, or sign its agreement by calling the API directly.
revoke all on function public.submit_payment(text, text, text, text, numeric, date, text, text)
  from public, anon;
revoke all on function public.payment_status(uuid) from public, anon;
revoke all on function public.sign_agreement(uuid, text, text, text, text, date, text, text, text, text)
  from public, anon;
revoke all on function public.redeem_access_code(text, text) from public, anon;

grant execute on function public.submit_payment(text, text, text, text, numeric, date, text, text)
  to authenticated;
grant execute on function public.payment_status(uuid) to authenticated;
grant execute on function public.sign_agreement(uuid, text, text, text, text, date, text, text, text, text)
  to authenticated;
grant execute on function public.redeem_access_code(text, text) to authenticated;

-- Receipt and signature uploads also require the same signed-in session.
drop policy if exists "anyone may upload a receipt" on storage.objects;
drop policy if exists "signed-in buyers may upload a receipt" on storage.objects;
create policy "signed-in buyers may upload a receipt"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'receipts' and auth.uid() is not null);

drop policy if exists "anyone may upload a signature" on storage.objects;
drop policy if exists "signed-in buyers may upload a signature" on storage.objects;
create policy "signed-in buyers may upload a signature"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'signatures' and auth.uid() is not null);

-- the inbox shows you which account each payment came from
create or replace view public.payments_inbox
with (security_invoker = on) as
select
  p.id, p.status, p.submitted_at, p.project_id, pr.name as project_name,
  p.buyer_name, p.buyer_contact, p.method, p.reference, p.amount, p.currency,
  p.paid_on, p.receipt_path,
  p.review_note, p.reviewed_at,
  (a.id is not null) as terms_signed,
  a.accepted_at as terms_signed_at,
  p.user_email, p.user_id
from public.payments p
left join public.projects pr on pr.id = p.project_id
left join public.agreements a on a.payment_id = p.id
order by (p.status = 'pending') desc, p.submitted_at desc;

grant select on public.payments_inbox to authenticated;
