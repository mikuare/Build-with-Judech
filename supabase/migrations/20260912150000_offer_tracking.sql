-- ============================================================================
-- JUDECH — 24 · tying a payment back to the link it came from
--
-- A private link is a quotation. Once the customer pays through it, the payment
-- should say so, otherwise there is no way to look at an offer and answer the
-- only question that matters: has this client paid for it yet, and for which
-- parts. So a payment can now carry the share token it was made from, and the
-- offer listing carries the totals that came back.
-- ============================================================================

alter table public.payments
  add column if not exists share_token text;

create index if not exists payments_share_idx on public.payments (share_token)
  where share_token is not null;

-- --------------------------------------------- submit, now with the offer
drop function if exists public.submit_payment(text, text, text, text, numeric, date, text, text, text, text[]);

create or replace function public.submit_payment(
  p_project_id    text,
  p_buyer_name    text,
  p_method        text,
  p_reference     text,
  p_amount        numeric,
  p_paid_on       date,
  p_receipt_path  text default null,
  p_buyer_contact text default null,
  p_scope         text default 'package',
  p_item_ids      text[] default null,
  p_share_token   text default null
)
returns table (payment_id uuid, claim_token uuid, status public.payment_status)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready boolean;
  v_scope text := case when p_scope = 'items' then 'items' else 'package' end;
  v_items text[] := '{}';
  v_share public.project_shares%rowtype;
  v_token text := null;
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

  if v_scope = 'items' then
    select coalesce(array_agg(distinct i.item_id), '{}')
      into v_items
      from public.project_package_items(p_project_id) i
     where i.item_id = any (coalesce(p_item_ids, '{}'::text[]));
    if array_length(v_items, 1) is null then
      raise exception 'none of those components belong to %', p_project_id using errcode = '22023';
    end if;
  end if;

  -- a token that no longer works does not block the payment; it is just dropped
  if nullif(btrim(coalesce(p_share_token, '')), '') is not null then
    select * into v_share
      from public.project_shares s
     where s.token = lower(btrim(p_share_token));
    if found
       and v_share.project_id = p_project_id
       and v_share.revoked_at is null
       and (v_share.expires_at is null or v_share.expires_at > now()) then
      v_token := v_share.token;
    end if;
  end if;

  return query
  insert into public.payments
    (project_id, buyer_name, buyer_contact, method, reference, amount, paid_on,
     receipt_path, scope, item_ids, share_token)
  values
    (p_project_id, btrim(p_buyer_name), nullif(btrim(coalesce(p_buyer_contact, '')), ''),
     btrim(p_method), btrim(p_reference), p_amount, p_paid_on,
     nullif(btrim(coalesce(p_receipt_path, '')), ''), v_scope, v_items, v_token)
  returning payments.id, payments.claim_token, payments.status;
end;
$$;

revoke all on function public.submit_payment(text, text, text, text, numeric, date, text, text, text, text[], text) from public;
grant execute on function public.submit_payment(text, text, text, text, numeric, date, text, text, text, text[], text)
  to anon, authenticated;

-- ------------------------------------------------- the inbox shows the link
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
  p.share_token, s.customer_name as share_customer
from public.payments p
left join public.projects pr on pr.id = p.project_id
left join public.agreements a on a.payment_id = p.id
left join public.project_shares s on s.token = p.share_token
order by (p.status = 'pending') desc, p.submitted_at desc;

grant select on public.payments_inbox to authenticated;

-- ------------------------------------ what has come back from each offer
create or replace view public.project_shares_list
with (security_invoker = on) as
select
  s.id, s.token, s.project_id, pr.name as project_name,
  s.customer_name, s.customer_note, s.headline, s.item_ids, s.prices, s.package_price,
  s.created_at, s.expires_at, s.revoked_at, s.opened_at, s.open_count,
  case
    when s.revoked_at is not null then 'revoked'
    when s.expires_at is not null and s.expires_at < now() then 'expired'
    when s.opened_at is not null then 'opened'
    else 'sent'
  end as state,
  t.payment_count,
  t.approved_count,
  t.pending_count,
  t.paid_amount,
  t.last_payment_at
from public.project_shares s
left join public.projects pr on pr.id = s.project_id
left join lateral (
  select
    count(*)                                                          as payment_count,
    count(*) filter (where pay.status = 'approved')                   as approved_count,
    count(*) filter (where pay.status = 'pending')                    as pending_count,
    coalesce(sum(pay.amount) filter (where pay.status = 'approved'), 0) as paid_amount,
    max(pay.submitted_at)                                             as last_payment_at
  from public.payments pay
  where pay.share_token = s.token
) t on true
order by s.created_at desc;

grant select on public.project_shares_list to authenticated;
