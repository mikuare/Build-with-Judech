-- Agreements must identify the seller by legal name, not by the JUDECH brand.
alter table public.agreements
  alter column seller set default 'Jude Michael Martinez';

update public.agreements
set seller = 'Jude Michael Martinez'
where seller is null
   or btrim(seller) = ''
   or upper(btrim(seller)) = 'JUDECH';
