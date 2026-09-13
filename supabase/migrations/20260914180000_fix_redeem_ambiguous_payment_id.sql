-- ============================================================================
-- JUDECH — 32 · fix: "column reference payment_id is ambiguous" on redeeming
--
-- redeem_access_code() declares its result as
--
--   returns table (payment_id uuid, claim_token uuid, …)
--
-- so inside the body `payment_id` is the name of an OUT parameter. When the
-- code is scoped to particular components it writes the per-item rows with
--
--   on conflict (payment_id, item_id) do nothing
--
-- and PostgreSQL cannot tell whether that `payment_id` means the column of
-- payment_item_access or the function's own OUT parameter. It refuses, the
-- redemption fails with a 400, and the buyer sees nothing but an error.
--
-- The column list of the INSERT and the left side of a SET are never
-- ambiguous, which is why only this one line failed — and why it only failed
-- for a scoped code, since an unscoped one never reaches the statement. The
-- dashboard now always sends an explicit list of components, so in practice
-- every code was hitting it.
--
-- Naming the constraint instead of the columns removes the ambiguity outright:
-- there are no bare column references left for the parser to resolve.
-- ============================================================================

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
  if public.is_blocked() then
    raise exception 'this account cannot redeem a code — contact JUDECH' using errcode = '42501';
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

  /* redeeming twice hands back the same claim token, so a buyer who cleared
     their browser is not locked out of what they paid for */
  if v_grant.payment_id is not null then
    select * into v_pay from public.payments p where p.id = v_grant.payment_id;
    if found then
      return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
      return;
    end if;
  end if;

  insert into public.payments
    (project_id, buyer_name, method, reference, amount, paid_on, status,
     review_note, reviewed_at, reviewed_by)
  values
    (v_grant.project_id,
     coalesce(nullif(btrim(coalesce(p_buyer_name, '')), ''), v_grant.buyer_name),
     v_grant.channel, v_grant.code, null, v_grant.created_at::date, 'approved',
     'Settled via ' || v_grant.channel || ' — access code' ||
       case when v_grant.note is null then '' else ': ' || v_grant.note end,
     now(), v_grant.created_by)
  returning * into v_pay;

  /* a code that names its components releases exactly those and holds the rest */
  if array_length(v_grant.item_ids, 1) is not null then
    insert into public.payment_item_access (payment_id, item_id, state, note, decided_by)
    select v_pay.id, i.item_id,
           case when i.item_id = any (v_grant.item_ids) then 'released' else 'held' end,
           'Set by access code ' || v_grant.code,
           v_grant.created_by
      from public.project_package_items(v_grant.project_id) i
    on conflict on constraint payment_item_access_pkey do nothing;
  end if;

  update public.access_grants
     set redeemed_at = coalesce(redeemed_at, now()),
         payment_id  = v_pay.id
   where id = v_grant.id;

  return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
end;
$$;

grant execute on function public.redeem_access_code(text, text) to anon, authenticated;
