-- ============================================================================
-- JUDECH — 08 · access codes for buyers who paid somewhere else
--
-- A buyer who already settled on Facebook, Shopee, in cash, or anywhere that is
-- not the QR does not scan and pay again. You issue them an access code from
-- the admin dashboard; they type it on the project page. Redeeming a code
-- creates an already-approved payment row, so everything downstream — terms,
-- files, your inbox — works exactly as it does for a QR payment.
-- ============================================================================

create table if not exists public.access_grants (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,                      -- 'JD-7K3P-9QX2'
  project_id  text not null references public.projects (id) on update cascade,
  buyer_name  text not null check (char_length(btrim(buyer_name)) between 2 and 120),
  channel     text not null check (char_length(btrim(channel)) between 2 and 40),
  note        text,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz,
  revoked_at  timestamptz,
  redeemed_at timestamptz,
  payment_id  uuid references public.payments (id) on delete set null
);

create index if not exists access_grants_project_idx on public.access_grants (project_id, created_at desc);

alter table public.access_grants enable row level security;

-- anon gets nothing directly; buyers redeem through the function below
drop policy if exists "admins manage access grants" on public.access_grants;
create policy "admins manage access grants"
  on public.access_grants for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ----------------------------------------------------------- code maker
-- Letters and digits that cannot be misread: no 0/O, no 1/I/L.
create or replace function public.new_access_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  v_out text := '';
  i     int;
begin
  loop
    bytes := extensions.gen_random_bytes(8);
    v_out := '';
    for i in 0..7 loop
      v_out := v_out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
      if i = 3 then v_out := v_out || '-'; end if;
    end loop;
    v_out := 'JD-' || v_out;
    exit when not exists (select 1 from public.access_grants g where g.code = v_out);
  end loop;
  return v_out;
end;
$$;

-- --------------------------------------------------- you issue a code
create or replace function public.create_access_grant(
  p_project_id   text,
  p_buyer_name   text,
  p_channel      text,
  p_note         text default null,
  p_expires_days integer default null
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
    (code, project_id, buyer_name, channel, note, created_by, expires_at)
  values
    (public.new_access_code(), p_project_id, btrim(p_buyer_name), btrim(p_channel),
     nullif(btrim(coalesce(p_note, '')), ''), auth.uid(),
     case when p_expires_days is null then null
          else now() + make_interval(days => p_expires_days) end)
  returning * into v_row;

  return v_row;
end;
$$;

-- ------------------------------------------------ a buyer redeems one
-- Redeeming twice with the same code hands back the same claim token, so a
-- buyer who cleared their browser is not locked out of what they paid for.
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

  update public.access_grants
     set redeemed_at = coalesce(redeemed_at, now()),
         payment_id  = v_pay.id
   where id = v_grant.id;

  return query select v_pay.id, v_pay.claim_token, v_pay.status, v_pay.project_id, v_grant.channel;
end;
$$;

-- ------------------------------------------------------ you cancel one
-- Cancelling also rejects the payment it created, so the project locks again
-- the next time that buyer's page checks in.
create or replace function public.revoke_access_grant(p_id uuid, p_note text default null)
returns public.access_grants
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.access_grants%rowtype;
begin
  if not public.is_admin() then
    raise exception 'only an admin can cancel access codes' using errcode = '42501';
  end if;

  update public.access_grants
     set revoked_at = now(),
         note = coalesce(p_note, note)
   where id = p_id
  returning * into v_row;

  if not found then
    raise exception 'no access code with id %', p_id using errcode = '22023';
  end if;

  if v_row.payment_id is not null then
    update public.payments
       set status = 'rejected',
           review_note = 'Access code cancelled' ||
             case when p_note is null then '' else ': ' || p_note end,
           reviewed_at = now(),
           reviewed_by = auth.uid()
     where id = v_row.payment_id;
  end if;

  return v_row;
end;
$$;

-- ------------------------------------------------------------------ grants
revoke all on function public.new_access_code() from public;
revoke all on function public.create_access_grant(text, text, text, text, integer) from public;
revoke all on function public.redeem_access_code(text, text) from public;
revoke all on function public.revoke_access_grant(uuid, text) from public;

grant execute on function public.create_access_grant(text, text, text, text, integer) to authenticated;
grant execute on function public.redeem_access_code(text, text) to anon, authenticated;
grant execute on function public.revoke_access_grant(uuid, text) to authenticated;

-- ------------------------------------------------------------ admin list
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
  end as state
from public.access_grants g
left join public.projects pr on pr.id = g.project_id
order by g.created_at desc;

grant select on public.access_grants_list to authenticated;
