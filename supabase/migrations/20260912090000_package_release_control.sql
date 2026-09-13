-- ============================================================================
-- JUDECH — 22 · releasing a package one item at a time
--
-- Until now a package was all-or-nothing: the moment a payment was approved and
-- the terms were signed, every item in it opened. Prototype work rarely goes
-- that way. A client orders an embedded build and wants the wiring diagram and
-- the materials list first; the sketch follows once they have wired the board
-- and settled the balance.
--
-- So each package item now carries a release mode, kept inside the project's
-- package_items jsonb:
--
--   release = 'auto'    the item opens with the rest of the package (default)
--   release = 'manual'  the item stays shut until you release it for that buyer
--
-- and every buyer — one row in public.payments — can have that decision
-- overridden per item in public.payment_item_access. The effective answer is:
--
--   an override row, if there is one   ->  'released' | 'held'
--   otherwise the project's default    ->  'auto' means released, 'manual' held
--
-- Nothing here changes the two gates in front of it. A buyer still has to have
-- an approved payment and a signed agreement before any of this is consulted.
-- ============================================================================

-- ------------------------------------------------- the per-buyer overrides
create table if not exists public.payment_item_access (
  payment_id uuid not null references public.payments (id) on delete cascade,
  item_id    text not null check (char_length(btrim(item_id)) between 1 and 120),
  state      text not null check (state in ('released', 'held')),
  note       text,
  decided_at timestamptz not null default now(),
  decided_by uuid references auth.users (id),
  primary key (payment_id, item_id)
);

create index if not exists payment_item_access_payment_idx
  on public.payment_item_access (payment_id);

alter table public.payment_item_access enable row level security;

-- anon gets nothing: buyers read their own through package_access() below
drop policy if exists "admins manage package access" on public.payment_item_access;
create policy "admins manage package access"
  on public.payment_item_access for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select, insert, update, delete on public.payment_item_access to authenticated;

-- ------------------------------------------- what is inside a project today
-- One row per package item, in the order the project page shows them. Reads
-- package_items when the project has them and falls back to the older items /
-- planned arrays, exactly as js/landing.js does.
create or replace function public.project_package_items(p_project_id text)
returns table (item_id text, item_name text, release_mode text, item_position integer)
language sql
stable
set search_path = public
as $$
  with p as (
    select * from public.projects where id = p_project_id
  )
  select
    coalesce(nullif(btrim(e.value ->> 'id'), ''), 'item-' || e.ord::text),
    coalesce(nullif(btrim(e.value ->> 'name'), ''), 'Package item'),
    case when lower(coalesce(e.value ->> 'release', 'auto')) = 'manual' then 'manual' else 'auto' end,
    e.ord::integer
  from p, jsonb_array_elements(p.package_items) with ordinality e(value, ord)
  where jsonb_typeof(p.package_items) = 'array'
    and jsonb_array_length(p.package_items) > 0
  union all
  select k.key, k.key, 'auto', k.ord::integer
  from p, unnest(case when p.status = 'ready' then p.items else p.planned end)
       with ordinality k(key, ord)
  where coalesce(jsonb_array_length(
          case when jsonb_typeof(p.package_items) = 'array' then p.package_items else '[]'::jsonb end
        ), 0) = 0
  order by 4;
$$;

grant execute on function public.project_package_items(text) to anon, authenticated;

-- --------------------------------------- the effective state for one buyer
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
    coalesce(a.state, case when i.release_mode = 'manual' then 'held' else 'released' end),
    a.decided_at,
    a.note
  from public.payments pay
  join lateral public.project_package_items(pay.project_id) i on true
  left join public.payment_item_access a
         on a.payment_id = pay.id and a.item_id = i.item_id
  where pay.id = p_payment_id
  order by i.item_position;
$$;

-- ------------------------------------------- a buyer asks what is open yet
-- Same shape as payment_status(): the claim token is the only key, and it only
-- ever answers for that one payment. An unapproved payment answers with
-- nothing, so the page keeps everything shut.
create or replace function public.package_access(p_claim_token uuid)
returns table (
  item_id     text,
  item_name   text,
  state       text,
  released_at timestamptz,
  note        text
)
language sql
stable
security definer
set search_path = public
as $$
  select s.item_id, s.item_name, s.state, s.decided_at, s.note
  from public.payments p
  cross join lateral public.payment_package_state(p.id) s
  where p.claim_token = p_claim_token
    and p.status = 'approved';
$$;

revoke all on function public.payment_package_state(uuid) from public;
revoke all on function public.package_access(uuid) from public;
grant execute on function public.payment_package_state(uuid) to authenticated;
grant execute on function public.package_access(uuid) to anon, authenticated;

-- ----------------------------------------------- you release or hold items
-- p_state 'released' opens the items, 'held' shuts them again, and 'default'
-- drops the override so the project's own setting decides.
create or replace function public.set_package_access(
  p_payment_id uuid,
  p_item_ids   text[],
  p_state      text,
  p_note       text default null
)
returns setof public.payment_item_access
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then
    raise exception 'only an admin can change package access' using errcode = '42501';
  end if;
  if coalesce(p_state, '') not in ('released', 'held', 'default') then
    raise exception 'unknown release state %', p_state using errcode = '22023';
  end if;
  if not exists (select 1 from public.payments where id = p_payment_id) then
    raise exception 'no payment with id %', p_payment_id using errcode = '22023';
  end if;
  if p_item_ids is null or array_length(p_item_ids, 1) is null then
    raise exception 'pick at least one package item' using errcode = '22023';
  end if;

  if p_state = 'default' then
    delete from public.payment_item_access
     where payment_id = p_payment_id and item_id = any (p_item_ids);
    return;
  end if;

  return query
  insert into public.payment_item_access (payment_id, item_id, state, note, decided_by)
  select distinct p_payment_id, btrim(id), p_state, v_note, auth.uid()
    from unnest(p_item_ids) as id
   where btrim(id) <> ''
  on conflict (payment_id, item_id) do update
     set state      = excluded.state,
         note       = excluded.note,
         decided_at = now(),
         decided_by = excluded.decided_by
  returning *;
end;
$$;

revoke all on function public.set_package_access(uuid, text[], text, text) from public;
grant execute on function public.set_package_access(uuid, text[], text, text) to authenticated;

-- -------------------------------------------------- the dashboard's listing
-- security_invoker keeps the admin-only RLS of payments and the override table.
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
  coalesce(a.state, case when i.release_mode = 'manual' then 'held' else 'released' end) as state,
  (a.payment_id is not null) as overridden,
  a.decided_at,
  a.note
from public.payments pay
join lateral public.project_package_items(pay.project_id) i on true
left join public.payment_item_access a
       on a.payment_id = pay.id and a.item_id = i.item_id;

grant select on public.payment_package_access to authenticated;

-- ============================================================================
-- Access codes can carry the same staging: a code issued for "diagram only"
-- opens that item and holds the rest the moment it is redeemed.
-- ============================================================================
alter table public.access_grants
  add column if not exists item_ids text[] not null default '{}';

drop function if exists public.create_access_grant(text, text, text, text, integer);

create or replace function public.create_access_grant(
  p_project_id   text,
  p_buyer_name   text,
  p_channel      text,
  p_note         text default null,
  p_expires_days integer default null,
  p_item_ids     text[] default null
)
returns public.access_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_grants%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can issue access codes' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'unknown project %', p_project_id using errcode = '22023';
  end if;

  insert into public.access_grants
    (code, project_id, buyer_name, channel, note, created_by, expires_at, item_ids)
  values
    (public.new_access_code(), p_project_id, btrim(p_buyer_name), btrim(p_channel),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
     case when p_expires_days is null then null
          else now() + make_interval(days => p_expires_days) end,
     coalesce(p_item_ids, '{}'))
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.create_access_grant(text, text, text, text, integer, text[]) from public;
grant execute on function public.create_access_grant(text, text, text, text, integer, text[]) to authenticated;

-- redeeming a scoped code writes the overrides straight away
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

  -- a code that names its items releases exactly those and holds the others
  if array_length(v_grant.item_ids, 1) is not null then
    insert into public.payment_item_access (payment_id, item_id, state, note, decided_by)
    select v_pay.id, i.item_id,
           case when i.item_id = any (v_grant.item_ids) then 'released' else 'held' end,
           'Set by access code ' || v_grant.code,
           v_grant.created_by
      from public.project_package_items(v_grant.project_id) i
    on conflict (payment_id, item_id) do nothing;
  end if;

  update public.access_grants
     set redeemed_at = coalesce(redeemed_at, now()),
         payment_id  = v_pay.id
   where id = v_grant.id;

  return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
end;
$$;

revoke all on function public.redeem_access_code(text, text) from public;
grant execute on function public.redeem_access_code(text, text) to anon, authenticated;

-- the admin listing gains the item scope
create or replace view public.access_grants_list
with (security_invoker = on) as
select
  g.id, g.code, g.project_id, pr.name as project_name,
  g.buyer_name, g.channel, g.note, g.created_at, g.expires_at,
  g.revoked_at, g.redeemed_at, g.payment_id,
  case
    when g.revoked_at is not null then 'revoked'
    when g.expires_at is not null and g.expires_at < now() then 'expired'
    when g.redeemed_at is not null then 'redeemed'
    else 'active'
  end as state,
  g.item_ids
from public.access_grants g
left join public.projects pr on pr.id = g.project_id
order by g.created_at desc;

grant select on public.access_grants_list to authenticated;
