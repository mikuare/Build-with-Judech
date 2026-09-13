-- ============================================================================
-- JUDECH — 05 · the only doors a buyer can walk through
--
-- The page calls these with the anon key. Each one is security definer, so it
-- writes past RLS — but only in the exact shape allowed here.
-- ============================================================================

-- ------------------------------------------------- a buyer submits a payment
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
    (project_id, buyer_name, buyer_contact, method, reference, amount, paid_on, receipt_path)
  values
    (p_project_id, btrim(p_buyer_name), nullif(btrim(coalesce(p_buyer_contact, '')), ''),
     btrim(p_method), btrim(p_reference), p_amount, p_paid_on,
     nullif(btrim(coalesce(p_receipt_path, '')), ''))
  returning payments.id, payments.claim_token, payments.status;
end;
$$;

-- --------------------------------------- a buyer checks on their own payment
-- Only ever returns the one row whose claim token they hold.
create or replace function public.payment_status(p_claim_token uuid)
returns table (
  status      public.payment_status,
  project_id  text,
  reference   text,
  review_note text,
  reviewed_at timestamptz,
  submitted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.status, p.project_id, p.reference, p.review_note, p.reviewed_at, p.submitted_at
  from public.payments p
  where p.claim_token = p_claim_token;
$$;

-- ------------------------------------------------ a buyer signs the terms
-- Refused unless their payment has actually been approved.
create or replace function public.sign_agreement(
  p_claim_token    uuid,
  p_buyer_name     text,
  p_signature_type text,
  p_signature_path text default null,
  p_signature_text text default null,
  p_signed_on      date default current_date,
  p_user_agent     text default null
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
  select * into v_payment from public.payments where claim_token = p_claim_token;
  if not found then
    raise exception 'no payment matches that token' using errcode = '22023';
  end if;
  if v_payment.status <> 'approved' then
    raise exception 'that payment has not been approved yet' using errcode = '22023';
  end if;

  select rights into v_rights from public.projects where id = v_payment.project_id;

  insert into public.agreements
    (project_id, payment_id, buyer_name, signature_type, signature_path,
     signature_text, rights, signed_on, user_agent)
  values
    (v_payment.project_id, v_payment.id, btrim(p_buyer_name), p_signature_type,
     nullif(btrim(coalesce(p_signature_path, '')), ''),
     nullif(btrim(coalesce(p_signature_text, '')), ''),
     coalesce(v_rights, 'catalog'), p_signed_on, left(coalesce(p_user_agent, ''), 400))
  returning id into v_id;

  return v_id;
end;
$$;

-- ------------------------------------------------------- you, approving
create or replace function public.approve_payment(p_id uuid, p_note text default null)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can approve payments' using errcode = '42501';
  end if;

  update public.payments
     set status = 'approved',
         review_note = p_note,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'no payment with id %', p_id using errcode = '22023';
  end if;
  return v_row;
end;
$$;

create or replace function public.reject_payment(p_id uuid, p_note text default null)
returns public.payments
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payments%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can reject payments' using errcode = '42501';
  end if;

  update public.payments
     set status = 'rejected',
         review_note = p_note,
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'no payment with id %', p_id using errcode = '22023';
  end if;
  return v_row;
end;
$$;

-- ------------------------------------------------------------------ grants
revoke all on function public.submit_payment(text, text, text, text, numeric, date, text, text) from public;
revoke all on function public.payment_status(uuid) from public;
revoke all on function public.sign_agreement(uuid, text, text, text, text, date, text) from public;
revoke all on function public.approve_payment(uuid, text) from public;
revoke all on function public.reject_payment(uuid, text) from public;

grant execute on function public.submit_payment(text, text, text, text, numeric, date, text, text) to anon, authenticated;
grant execute on function public.payment_status(uuid) to anon, authenticated;
grant execute on function public.sign_agreement(uuid, text, text, text, text, date, text) to anon, authenticated;
grant execute on function public.approve_payment(uuid, text) to authenticated;
grant execute on function public.reject_payment(uuid, text) to authenticated;

-- --------------------------------------------------------------- your inbox
-- security_invoker keeps the admin-only RLS of the tables underneath.
create or replace view public.payments_inbox
with (security_invoker = on) as
select
  p.id,
  p.status,
  p.submitted_at,
  p.project_id,
  pr.name as project_name,
  p.buyer_name,
  p.buyer_contact,
  p.method,
  p.reference,
  p.amount,
  p.currency,
  p.paid_on,
  p.receipt_path,
  p.review_note,
  p.reviewed_at,
  (a.id is not null) as terms_signed,
  a.accepted_at as terms_signed_at
from public.payments p
left join public.projects pr on pr.id = p.project_id
left join public.agreements a on a.payment_id = p.id
order by (p.status = 'pending') desc, p.submitted_at desc;

grant select on public.payments_inbox to authenticated;
