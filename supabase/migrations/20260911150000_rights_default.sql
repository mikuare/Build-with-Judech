-- ============================================================================
-- JUDECH — 15 · ownership stays with the seller unless explicitly transferred
--
-- Keep the existing values for compatibility with agreements:
--   catalog = licensed use; seller retains ownership
--   custom  = admin explicitly selected ownership transfer
-- ============================================================================

alter table public.projects
  alter column rights set default 'catalog';

comment on column public.projects.rights is
  'catalog = licensed use, seller retains ownership; custom = admin explicitly selected ownership transfer';

-- The built-in request card used to imply automatic transfer. Return only that
-- recognizable seed row to the safe licensed default; admins may select transfer
-- for a particular project later in the dashboard.
update public.projects
   set rights = 'catalog'
 where id = 'more'
   and name = 'Your system'
   and tagline = 'Tell me what you need'
   and rights = 'custom';
