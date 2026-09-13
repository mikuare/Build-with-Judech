-- ============================================================================
-- JUDECH — 19 · per-project frequently asked questions
--
-- Each entry has a question and an answer. The public catalog can read them
-- with the rest of the project, while existing project RLS keeps editing
-- restricted to admins.
-- ============================================================================

alter table public.projects
  add column if not exists faqs jsonb not null default '[]'::jsonb;

alter table public.projects
  drop constraint if exists projects_faqs_array;
alter table public.projects
  add constraint projects_faqs_array
  check (jsonb_typeof(faqs) = 'array');
