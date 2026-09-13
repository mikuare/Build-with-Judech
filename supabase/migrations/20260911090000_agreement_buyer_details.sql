-- ============================================================================
-- JUDECH — 09 · who the buyer is: student or not, school, where they are from
-- Collected under section 12 of the terms (Buyer Information and Privacy), for the
-- seller's own records only. Never disclosed.
-- ============================================================================

alter table public.agreements
  add column if not exists buyer_type text
    check (buyer_type is null or char_length(buyer_type) <= 40),
  add column if not exists school text
    check (school is null or char_length(school) <= 160),
  add column if not exists location text
    check (location is null or char_length(location) <= 160);

alter table public.agreements
  alter column terms_version set default '2026-09-11 · sections 1-13';

-- the signature of sign_agreement changes, so the old one goes first
drop function if exists public.sign_agreement(uuid, text, text, text, text, date, text);

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
  select * into v_payment from public.payments where claim_token = p_claim_token;
  if not found then
    raise exception 'no payment matches that token' using errcode = '22023';
  end if;
  if v_payment.status <> 'approved' then
    raise exception 'that payment has not been approved yet' using errcode = '22023';
  end if;

  select pr.rights into v_rights from public.projects pr where pr.id = v_payment.project_id;

  insert into public.agreements
    (project_id, payment_id, buyer_name, signature_type, signature_path,
     signature_text, rights, signed_on, user_agent, buyer_type, school, location)
  values
    (v_payment.project_id, v_payment.id, btrim(p_buyer_name), p_signature_type,
     nullif(btrim(coalesce(p_signature_path, '')), ''),
     nullif(btrim(coalesce(p_signature_text, '')), ''),
     coalesce(v_rights, 'catalog'), p_signed_on, left(coalesce(p_user_agent, ''), 400),
     nullif(btrim(coalesce(p_buyer_type, '')), ''),
     nullif(btrim(coalesce(p_school, '')), ''),
     nullif(btrim(coalesce(p_location, '')), ''))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.sign_agreement(uuid, text, text, text, text, date, text, text, text, text) from public;
grant execute on function public.sign_agreement(uuid, text, text, text, text, date, text, text, text, text) to anon, authenticated;
