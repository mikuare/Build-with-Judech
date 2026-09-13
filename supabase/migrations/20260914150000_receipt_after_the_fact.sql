-- ============================================================================
-- JUDECH — 31 · the receipt can arrive after the reference
--
-- Someone pays on GCash, comes back with the reference number, and finds the
-- form will not move without a screenshot they have not taken yet. So they
-- abandon it, or they invent a reference. Neither helps.
--
-- The receipt is now something a buyer can attach afterwards, against the same
-- claim token they already hold — while the payment is still waiting, or after
-- it was rejected for want of proof. An approved payment is left alone: the
-- check is done, and letting the image change under an approval would only
-- muddy the record.
-- ============================================================================

alter table public.payments
  add column if not exists receipt_added_at timestamptz;

-- backfill: a payment that already came with one got it at submission time
update public.payments
   set receipt_added_at = submitted_at
 where receipt_path is not null and receipt_added_at is null;

create or replace function public.attach_receipt(
  p_claim_token  uuid,
  p_receipt_path text
)
returns table (receipt_path text, receipt_added_at timestamptz, status public.payment_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pay  public.payments%rowtype;
  v_path text := nullif(btrim(coalesce(p_receipt_path, '')), '');
begin
  if v_path is null then
    raise exception 'no receipt was uploaded' using errcode = '22023';
  end if;

  select * into v_pay from public.payments where claim_token = p_claim_token;
  if not found then
    raise exception 'no payment matches that receipt' using errcode = '22023';
  end if;
  if v_pay.status = 'approved' then
    raise exception 'that payment is already approved — no receipt is needed now'
      using errcode = '22023';
  end if;

  update public.payments
     set receipt_path = v_path,
         receipt_added_at = now(),
         updated_at = now()
   where id = v_pay.id;

  return query
    select v_path, now()::timestamptz, v_pay.status;
end;
$$;

revoke all on function public.attach_receipt(uuid, text) from public;
grant execute on function public.attach_receipt(uuid, text) to anon, authenticated;

-- the inbox says whether the receipt came with the payment or followed it
create or replace view public.payments_inbox
with (security_invoker = on) as
select
  p.id, p.status, p.submitted_at, p.project_id, pr.name as project_name,
  p.buyer_name, p.buyer_contact, p.method, p.reference, p.amount, p.currency,
  p.paid_on, p.receipt_path,
  p.review_note, p.reviewed_at,
  (a.id is not null) as terms_signed,
  a.accepted_at as terms_signed_at,
  p.user_email, p.user_id,
  p.scope, p.item_ids,
  p.share_token, s.customer_name as share_customer,
  p.receipt_added_at,
  (p.receipt_added_at is not null and p.receipt_added_at > p.submitted_at + interval '1 minute')
    as receipt_came_later
from public.payments p
left join public.projects pr on pr.id = p.project_id
left join public.agreements a on a.payment_id = p.id
left join public.project_shares s on s.token = p.share_token
order by (p.status = 'pending') desc, p.submitted_at desc;

grant select on public.payments_inbox to authenticated;
