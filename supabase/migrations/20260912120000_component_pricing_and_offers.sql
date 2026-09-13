-- ============================================================================
-- JUDECH — 23 · buying a package one component at a time, and private offers
--
-- Two things arrive together here, because they answer the same request.
--
-- 1. A package item can carry its own price. A client who only needs the wiring
--    diagram today pays for the wiring diagram, walks the same three steps —
--    pay (or redeem a code), get approved, sign the terms — and that one item
--    opens. The code follows later as a second purchase. Buying the whole
--    package is still there, still the default, and still opens everything.
--
--    So a payment now has a scope: 'package' (everything, subject to the
--    release modes from migration 22) or 'items' (exactly the item_ids named
--    on it). An admin override in payment_item_access still beats both.
--
-- 2. A project can have private offers: a link you generate for one customer
--    that shows only the components they asked for, at the price you quoted
--    them, without touching what everyone else sees in the catalog.
-- ============================================================================

-- --------------------------------------------------------- what was bought
alter table public.payments
  add column if not exists scope    text     not null default 'package',
  add column if not exists item_ids text[]   not null default '{}';

alter table public.payments drop constraint if exists payments_scope_valid;
alter table public.payments add constraint payments_scope_valid
  check (scope in ('package', 'items'));

-- a payment for named components has to name at least one
alter table public.payments drop constraint if exists payments_scope_items;
alter table public.payments add constraint payments_scope_items
  check (scope <> 'items' or array_length(item_ids, 1) is not null);

-- ------------------------------------------- a buyer submits, now with scope
drop function if exists public.submit_payment(text, text, text, text, numeric, date, text, text);

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
  p_item_ids      text[] default null
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
    -- only ids this project actually has, so a stale page cannot buy a ghost
    select coalesce(array_agg(distinct i.item_id), '{}')
      into v_items
      from public.project_package_items(p_project_id) i
     where i.item_id = any (coalesce(p_item_ids, '{}'::text[]));
    if array_length(v_items, 1) is null then
      raise exception 'none of those components belong to %', p_project_id using errcode = '22023';
    end if;
  end if;

  return query
  insert into public.payments
    (project_id, buyer_name, buyer_contact, method, reference, amount, paid_on,
     receipt_path, scope, item_ids)
  values
    (p_project_id, btrim(p_buyer_name), nullif(btrim(coalesce(p_buyer_contact, '')), ''),
     btrim(p_method), btrim(p_reference), p_amount, p_paid_on,
     nullif(btrim(coalesce(p_receipt_path, '')), ''), v_scope, v_items)
  returning payments.id, payments.claim_token, payments.status;
end;
$$;

revoke all on function public.submit_payment(text, text, text, text, numeric, date, text, text, text, text[]) from public;
grant execute on function public.submit_payment(text, text, text, text, numeric, date, text, text, text, text[])
  to anon, authenticated;

-- ------------------------------------- the effective state, now scope-aware
create or replace function public.payment_package_state(p_payment_id uuid)
returns table (
  item_id      text,
  item_name    text,
  item_position integer,
  release_mode text,
  state        text,
  decided_at   timestamptz,
  note         text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    i.item_id,
    i.item_name,
    i.item_position,
    i.release_mode,
    coalesce(
      a.state,
      case
        when pay.scope = 'items'
          then case when i.item_id = any (pay.item_ids) then 'released' else 'held' end
        else case when i.release_mode = 'manual' then 'held' else 'released' end
      end),
    a.decided_at,
    a.note
  from public.payments pay
  join lateral public.project_package_items(pay.project_id) i on true
  left join public.payment_item_access a
         on a.payment_id = pay.id and a.item_id = i.item_id
  where pay.id = p_payment_id
  order by i.item_position;
$$;

-- ------------------------------------ a buyer with more than one purchase
-- Someone who bought the diagram in June and the code in August holds two
-- claim tokens for the same project. This answers for all of them at once,
-- and an item released by any one of them counts as released.
create or replace function public.package_access_all(p_claim_tokens uuid[])
returns table (
  item_id     text,
  item_name   text,
  state       text,
  released_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.item_id,
    min(s.item_name)                                            as item_name,
    case when bool_or(s.state = 'released') then 'released' else 'held' end as state,
    max(s.decided_at)                                           as released_at
  from public.payments p
  cross join lateral public.payment_package_state(p.id) s
  where p.claim_token = any (coalesce(p_claim_tokens, '{}'::uuid[]))
    and p.status = 'approved'
  group by s.item_id;
$$;

revoke all on function public.package_access_all(uuid[]) from public;
grant execute on function public.package_access_all(uuid[]) to anon, authenticated;

-- ---------------------------------------------- the dashboard sees the scope
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
  p.scope, p.item_ids
from public.payments p
left join public.projects pr on pr.id = p.project_id
left join public.agreements a on a.payment_id = p.id
order by (p.status = 'pending') desc, p.submitted_at desc;

grant select on public.payments_inbox to authenticated;

-- the per-item admin listing follows the same rule
create or replace view public.payment_package_access
with (security_invoker = on) as
select
  pay.id         as payment_id,
  pay.project_id,
  pay.status,
  i.item_id,
  i.item_name,
  i.item_position,
  i.release_mode,
  coalesce(
    a.state,
    case
      when pay.scope = 'items'
        then case when i.item_id = any (pay.item_ids) then 'released' else 'held' end
      else case when i.release_mode = 'manual' then 'held' else 'released' end
    end) as state,
  (a.payment_id is not null) as overridden,
  a.decided_at,
  a.note
from public.payments pay
join lateral public.project_package_items(pay.project_id) i on true
left join public.payment_item_access a
       on a.payment_id = pay.id and a.item_id = i.item_id;

grant select on public.payment_package_access to authenticated;

-- ============================================================================
-- Private offers — one link, one customer, one selection of components.
-- The catalog does not change: the link only alters what that visitor sees.
-- ============================================================================
create table if not exists public.project_shares (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  project_id    text not null references public.projects (id) on update cascade on delete cascade,
  customer_name text not null check (char_length(btrim(customer_name)) between 2 and 120),
  customer_note text,
  headline      text,
  item_ids      text[] not null default '{}',         -- empty means the whole package
  prices        jsonb  not null default '{}'::jsonb,  -- {item_id: amount}
  package_price numeric(12,2) check (package_price >= 0),
  created_by    uuid references auth.users (id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  revoked_at    timestamptz,
  opened_at     timestamptz,
  open_count    integer not null default 0
);

alter table public.project_shares drop constraint if exists project_shares_prices_object;
alter table public.project_shares add constraint project_shares_prices_object
  check (jsonb_typeof(prices) = 'object');

create index if not exists project_shares_project_idx
  on public.project_shares (project_id, created_at desc);

alter table public.project_shares enable row level security;

-- anon reads one row at a time through project_share(); never the whole table
drop policy if exists "admins manage project shares" on public.project_shares;
create policy "admins manage project shares"
  on public.project_shares for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.project_shares to authenticated;

-- ---------------------------------------------------------------- the token
create or replace function public.new_share_token()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  bytes bytea;
  v_out text;
  i     int;
begin
  loop
    bytes := extensions.gen_random_bytes(10);
    v_out := '';
    for i in 0..9 loop
      v_out := v_out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.project_shares s where s.token = v_out);
  end loop;
  return v_out;
end;
$$;

-- ------------------------------------------------------- you make an offer
create or replace function public.create_project_share(
  p_project_id    text,
  p_customer_name text,
  p_item_ids      text[] default null,
  p_prices        jsonb default '{}'::jsonb,
  p_package_price numeric default null,
  p_headline      text default null,
  p_customer_note text default null,
  p_expires_days  integer default null
)
returns public.project_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row   public.project_shares%rowtype;
  v_items text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'only an admin can create a private link' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'unknown project %', p_project_id using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct i.item_id), '{}')
    into v_items
    from public.project_package_items(p_project_id) i
   where i.item_id = any (coalesce(p_item_ids, '{}'::text[]));

  insert into public.project_shares
    (token, project_id, customer_name, customer_note, headline, item_ids, prices,
     package_price, created_by, expires_at)
  values
    (public.new_share_token(), p_project_id, btrim(p_customer_name),
     nullif(btrim(coalesce(p_customer_note, '')), ''),
     nullif(btrim(coalesce(p_headline, '')), ''),
     v_items,
     case when jsonb_typeof(coalesce(p_prices, '{}'::jsonb)) = 'object'
          then coalesce(p_prices, '{}'::jsonb) else '{}'::jsonb end,
     p_package_price, auth.uid(),
     case when p_expires_days is null then null
          else now() + make_interval(days => p_expires_days) end)
  returning * into v_row;

  return v_row;
end;
$$;

create or replace function public.revoke_project_share(p_id uuid)
returns public.project_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.project_shares%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can cancel a private link' using errcode = '42501';
  end if;
  update public.project_shares set revoked_at = now() where id = p_id returning * into v_row;
  if not found then
    raise exception 'no private link with id %', p_id using errcode = '22023';
  end if;
  return v_row;
end;
$$;

-- ------------------------------------------------- the customer opens it
-- Volatile on purpose: it counts the visit so the dashboard can tell you the
-- link was actually looked at.
create or replace function public.project_share(p_token text)
returns table (
  token         text,
  project_id    text,
  customer_name text,
  customer_note text,
  headline      text,
  item_ids      text[],
  prices        jsonb,
  package_price numeric,
  expires_at    timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.project_shares%rowtype;
begin
  select * into v_row
    from public.project_shares s
   where s.token = lower(btrim(coalesce(p_token, '')));

  if not found then
    raise exception 'that link is not valid' using errcode = '22023';
  end if;
  if v_row.revoked_at is not null then
    raise exception 'that link has been cancelled' using errcode = '22023';
  end if;
  if v_row.expires_at is not null and v_row.expires_at < now() then
    raise exception 'that link has expired' using errcode = '22023';
  end if;

  update public.project_shares
     set opened_at = now(), open_count = open_count + 1
   where id = v_row.id;

  return query select v_row.token, v_row.project_id, v_row.customer_name, v_row.customer_note,
                      v_row.headline, v_row.item_ids, v_row.prices, v_row.package_price,
                      v_row.expires_at;
end;
$$;

revoke all on function public.new_share_token() from public;
revoke all on function public.create_project_share(text, text, text[], jsonb, numeric, text, text, integer) from public;
revoke all on function public.revoke_project_share(uuid) from public;
revoke all on function public.project_share(text) from public;

grant execute on function public.create_project_share(text, text, text[], jsonb, numeric, text, text, integer) to authenticated;
grant execute on function public.revoke_project_share(uuid) to authenticated;
grant execute on function public.project_share(text) to anon, authenticated;

-- --------------------------------------------------------- the admin listing
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
  end as state
from public.project_shares s
left join public.projects pr on pr.id = s.project_id
order by s.created_at desc;

grant select on public.project_shares_list to authenticated;
