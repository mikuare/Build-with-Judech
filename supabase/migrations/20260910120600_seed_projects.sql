-- ============================================================================
-- JUDECH — 07 · the catalog as it stands today
-- Safe to re-run: it updates rather than duplicates. Delete this file if you
-- would rather keep the catalog only in js/landing.js.
-- ============================================================================

insert into public.projects (id, name, tagline, kind, status, rights, blurb, tags, items, position) values
  ('envirosortpro', 'EnviroSortPro', 'Automatic waste segregation', 'embedded', 'ready', 'catalog',
   'Drop waste into one opening. Two proximity heads and an infrared beam work out what it is, a rotating platform brings the right bin underneath, and a servo gate lets it fall.',
   array['Arduino Uno R3','3 bins','Browser simulator'],
   array['simulation','code','diagram','materials','docs','support'], 10),

  ('erp', 'ERP / Operations System', 'Business operations', 'web', 'soon', 'catalog',
   'One back office for the whole operation — records, stock, sales, purchasing, users and the reports management keeps asking for.',
   array['Web system','Roles & permissions','Reports'],
   array['demo','code','schema','docs','manual','deploy','support'], 20),

  ('inventory', 'Inventory System', 'Stock in, stock out', 'web', 'soon', 'catalog',
   'Items, stock movements, low-stock warnings and printable reports — the plainest version of the thing every business needs first.',
   array['Web system','Barcode-ready','Reports'],
   array['demo','code','schema','docs','manual','deploy','support'], 30),

  ('booking', 'Booking & Reservation System', 'Slots, schedules, confirmations', 'web', 'soon', 'catalog',
   'Customers pick a slot, staff see the day at a glance, and nobody is booked twice for the same hour.',
   array['Web system','Calendar','Notifications'],
   array['demo','code','schema','docs','manual','deploy','support'], 40),

  ('mobileapp', 'Mobile Application', 'Android & iOS', 'mobile', 'soon', 'catalog',
   'A proper app on the phone — built once, installed on Android and iOS, talking to the same back end as the web side.',
   array['Android','iOS','API-connected'],
   array['build','code','design','docs','manual','deploy','support'], 50),

  ('pwa', 'Progressive Web App', 'Installable, offline-ready', 'mobile', 'soon', 'catalog',
   'Opens in a browser, installs to the home screen, and keeps working when the signal drops. No app store queue.',
   array['PWA','Offline','Installable'],
   array['demo','code','design','docs','manual','deploy','support'], 60),

  ('flipversion', 'FlipVersion Sorting', 'Sorting machine', 'embedded', 'soon', 'catalog',
   'On the workbench now. The build, the code and the write-up are being put together.',
   array['In the works'],
   array['simulation','code','diagram','materials','docs','support'], 70),

  ('coffeevendo', 'Coffee Vendo Waste Machine', 'Vending + waste handling', 'embedded', 'soon', 'catalog',
   'A coffee vendo that looks after its own waste. Being built and documented the same way as the others.',
   array['In the works'],
   array['code','diagram','materials','docs','support'], 80),

  ('more', 'Your system', 'Tell me what you need', 'any', 'soon', 'catalog',
   'Web, mobile or hardware — if your subject or your business needs something specific, ask. Ownership stays with JUDECH unless a separate transfer is selected and agreed.',
   array['Requests welcome'],
   array['code','docs','manual','deploy','support'], 90)
on conflict (id) do update set
  name     = excluded.name,
  tagline  = excluded.tagline,
  kind     = excluded.kind,
  status   = excluded.status,
  rights   = excluded.rights,
  blurb    = excluded.blurb,
  tags     = excluded.tags,
  items    = excluded.items,
  position = excluded.position;
