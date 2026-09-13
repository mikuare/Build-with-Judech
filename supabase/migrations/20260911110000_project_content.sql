-- ============================================================================
-- JUDECH — 11 · everything a project shows, editable from the dashboard
--
-- The catalog table already held the card (name, blurb, tags). This adds what
-- sits behind the card: the intro paragraph, the links each package item opens,
-- the source-file list, the parts list, the run steps. The project page reads
-- these when Supabase is configured and falls back to the built-in array in
-- js/landing.js when it is not.
-- ============================================================================

alter table public.projects
  add column if not exists icon      text,
  add column if not exists audience  text,
  add column if not exists intro     text,
  add column if not exists libraries text,
  add column if not exists planned   text[]  not null default '{}',
  add column if not exists links     jsonb   not null default '{}'::jsonb,
  add column if not exists files     jsonb   not null default '[]'::jsonb,
  add column if not exists materials jsonb   not null default '[]'::jsonb,
  add column if not exists run       jsonb   not null default '[]'::jsonb;

-- shapes, so a typo in the dashboard cannot make the project page throw
alter table public.projects drop constraint if exists projects_links_object;
alter table public.projects add constraint projects_links_object
  check (jsonb_typeof(links) = 'object');
alter table public.projects drop constraint if exists projects_files_array;
alter table public.projects add constraint projects_files_array
  check (jsonb_typeof(files) = 'array');
alter table public.projects drop constraint if exists projects_materials_array;
alter table public.projects add constraint projects_materials_array
  check (jsonb_typeof(materials) = 'array');
alter table public.projects drop constraint if exists projects_run_array;
alter table public.projects add constraint projects_run_array
  check (jsonb_typeof(run) = 'array');

grant select, insert, update, delete on public.projects to authenticated;

-- ---------------------------------------------------------------- assets
-- Diagrams, guideline PDFs, code files. Public to read — these are the same
-- files the site already serves from disk — and admin-only to change.
insert into storage.buckets (id, name, public, file_size_limit)
values ('project-files', 'project-files', true, 26214400)
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit;

drop policy if exists "admins upload project files" on storage.objects;
create policy "admins upload project files"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'project-files' and public.is_admin());

drop policy if exists "admins replace project files" on storage.objects;
create policy "admins replace project files"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'project-files' and public.is_admin())
  with check (bucket_id = 'project-files' and public.is_admin());

drop policy if exists "admins delete project files" on storage.objects;
create policy "admins delete project files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'project-files' and public.is_admin());

-- ------------------------------------------------- what is on the page today
update public.projects set icon = 'bin',   audience = 'Thesis / capstone' where id = 'envirosortpro';
update public.projects set icon = 'globe', audience = 'Business operations' where id = 'erp';
update public.projects set icon = 'box',   audience = 'Thesis / capstone · Business' where id = 'inventory';
update public.projects set icon = 'book',  audience = 'Thesis / capstone · Business' where id = 'booking';
update public.projects set icon = 'phone', audience = 'Thesis / capstone · Business' where id = 'mobileapp';
update public.projects set icon = 'rocket',audience = 'Thesis / capstone · Business' where id = 'pwa';
update public.projects set icon = 'flip',  audience = 'Thesis / capstone' where id = 'flipversion';
update public.projects set icon = 'cup',   audience = 'Thesis / capstone' where id = 'coffeevendo';
update public.projects set icon = 'more',  audience = 'Thesis, capstone or business' where id = 'more';

-- the coming-soon projects list what they will include
update public.projects set planned = items, items = '{}'
 where status = 'soon' and planned = '{}' and items <> '{}';

update public.projects set
  intro = 'Everything below is part of this package. The simulator runs the same control '
          'flow as the board, so what you see on screen is what the machine does.',
  libraries = 'Servo, Wire and LiquidCrystal_I2C.',
  links = jsonb_build_object(
    'simulation', jsonb_build_object('href', 'simulation.html', 'sameTab', true),
    'diagram',    jsonb_build_object('href', 'circuit_image%20(1)%20(2).png'),
    'docs',       jsonb_build_object('href', 'README.md')
  ),
  files = jsonb_build_array(
    jsonb_build_array('EnviroSortPro.ino',
      'The sketch as built: detection, platform servo, gate servo, LCD, buzzer, full-bin alarm.',
      'EnviroSortPro/EnviroSortPro.ino'),
    jsonb_build_array('_alternative_state_machine.txt',
      'The same behaviour rewritten without blocking delays.',
      'EnviroSortPro/_alternative_state_machine.txt')
  ),
  run = jsonb_build_array(
    jsonb_build_array('Start a local server', 'python3 -m http.server 5500'),
    jsonb_build_array('Open', 'http://localhost:5500')
  ),
  materials = jsonb_build_array(
    jsonb_build_array('Arduino Uno R3', 'Controller running the sketch', '1'),
    jsonb_build_array('16&times;2 LCD + I&sup2;C backpack', 'Status display, address 0x27', '1'),
    jsonb_build_array('270&deg; metal-gear digital servo', 'Bin platform (D5) and gate (D6)', '2'),
    jsonb_build_array('Capacitive proximity sensor', 'Non-biodegradable head, D3', '1'),
    jsonb_build_array('Inductive proximity sensor', 'Metal head, D4', '1'),
    jsonb_build_array('IR obstacle / beam sensor', 'Biodegradable, D7', '1'),
    jsonb_build_array('HC-SR04 ultrasonic sensor', 'Full-bin check, D8 / D9', '1'),
    jsonb_build_array('Active buzzer', 'Full-bin alarm, D12', '1'),
    jsonb_build_array('LEDs + resistors', 'Status, D2 / D13 / A3', '3'),
    jsonb_build_array('Push button', 'Reset &amp; acknowledge, D10', '1'),
    jsonb_build_array('7.5 V DC adapter', 'Mains supply', '1'),
    jsonb_build_array('14.8 V battery pack', 'Backup supply in the support box', '2'),
    jsonb_build_array('18 V solar panel + stand', 'Third source into the power module', '1'),
    jsonb_build_array('Power module', 'Takes every source in, one lead to the jack', '1'),
    jsonb_build_array('SPDT relay + diode + capacitor', 'Adapter/battery changeover without a reset', '1'),
    jsonb_build_array('Plywood hopper, throat and base', '&#8960;184 mm mouth, 128 mm sensing gap', '1'),
    jsonb_build_array('Triangular plate + retaining rail', 'Carries the three bins as it spins', '1'),
    jsonb_build_array('Bins', 'Bio, non-bio, metal', '3'),
    jsonb_build_array('Castors, mast, control box, ties', 'Frame and loom', '&mdash;')
  )
where id = 'envirosortpro';
