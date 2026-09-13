/* JUDECH — project catalog + package gate
   ---------------------------------------------------------------------------
   TO ADD OR EDIT A PROJECT: change the PROJECTS array below. Everything on the
   page (the cards, the package lists, the terms form) is built from it.
     status: 'ready' -> the package opens once the terms are signed
     status: 'soon'  -> the card shows "Coming soon" and lists what is planned
   Put your page or chat link in CONTACT and a "Message JUDECH" button appears
   wherever it is useful.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  var BRAND = 'JUDECH';
  var SELLER = 'Jude Michael Martinez';
  var KEY = 'judech.terms.v1:';         // one signature per project
  var PAY_KEY = 'judech.pay.v1:';       // the older single payment record per project
  var BUYS_KEY = 'judech.buys.v2:';     // every purchase of a project, oldest first

  /* ---------- FILL THESE IN ----------------------------------------------
     Anything left empty is simply not shown, so the page never advertises a
     channel you do not have. */
  var CONTACT = {
    facebook:  'https://www.facebook.com/judeTech28',
    messenger: 'https://m.me/judeTech28',
    instagram: '',      // add your Instagram profile URL when ready
    tiktok:    'https://www.tiktok.com/@judech28',
    discord:   '@buildwithjudech',
    email:     'edujkie.123@gmail.com',
    phone:     '',      // kept off the public page on purpose — put it back and
                        // add a row in renderContact() if you ever want it shown
    shopee:    '',      // 'https://shopee.ph/yourshop'
    hours:     'Messages are usually answered within a day.'
  };

  var PAYMENT = {
    qr:            'images/qrgcash.jpg',   // the QR buyers scan
    qrZoom:        2.1,                // magnify the card so the code is big enough to scan
    qrFocus:       '50% 38%',          // which part of the image to centre on
                                       //   swapping in a plain square QR? use 1 and '50% 50%'
    accountName:   '',                 // optional — the QR image already shows it
    accountNumber: '',                 // optional — the QR image already shows it
    wallet:        'Scan with GCash',  // what the QR is for
    methods: ['GCash', 'Maya', 'Bank transfer', 'Shopee', 'Cash / in person'],
    note: 'Send the amount you agreed on, then upload the receipt below.',
    salt: 'judech-2026'                // change this and every approval code changes
  };
  /* ----------------------------------------------------------------------- */

  function contactLink() {
    return CONTACT.messenger || CONTACT.facebook ||
      (CONTACT.email ? 'mailto:' + CONTACT.email : '') ||
      (CONTACT.phone ? 'tel:' + CONTACT.phone.replace(/[^0-9+]/g, '') : '') ||
      CONTACT.shopee || '';
  }
  function contactButton(label) {
    var href = contactLink();
    return href
      ? '<a class="btn btn-sm btn-primary" href="' + href + '" target="_blank" rel="noopener">' +
        (label || ('Message ' + BRAND)) + '</a>'
      : '';
  }

  var BRAND_LOGO = {
    facebook:  'https://cdn.simpleicons.org/facebook/1877F2',
    messenger: 'https://cdn.simpleicons.org/messenger/00B2FF',
    instagram: 'https://cdn.simpleicons.org/instagram/E4405F',
    youtube:   'https://cdn.simpleicons.org/youtube/FF0000',
    tiktok:    "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><defs><linearGradient id='tk' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%2325F4EE'/><stop offset='.55' stop-color='%23FE2C55'/><stop offset='1' stop-color='%23FF4D67'/></linearGradient></defs><path fill='url(%23tk)' d='M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z'/></svg>",
    discord:   'https://cdn.simpleicons.org/discord/5865F2',
    email:     'https://cdn.simpleicons.org/gmail/EA4335',
    shopee:    'https://cdn.simpleicons.org/shopee/EE4D2D'
  };

  /* ---------- little svg helpers ---------- */
  var ICON = {
    bin:   '<path d="M4 7h16M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>',
    flip:  '<path d="M4 8h11a5 5 0 0 1 0 10H9"/><path d="M12 15l-3 3 3 3"/><path d="M20 5V2M20 5l3-2M20 5l-3-2"/>',
    cup:   '<path d="M5 8h12l-1 11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M17 11h2a3 3 0 0 1 0 6h-1"/><path d="M9 5c-1-1 1-2 0-3M13 5c-1-1 1-2 0-3"/>',
    more:  '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    play:  '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 21h6M12 17v4"/><path d="M10 9l3 2-3 2z"/>',
    code:  '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    wire:  '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><path d="M8 6h8M6 8v6a2 2 0 0 0 2 2h2M18 8v6a2 2 0 0 1-2 2h-2"/>',
    list:  '<path d="M8 6h12M8 12h12M8 18h12"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/>',
    doc:   '<path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/>',
    help:  '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.2-1.2.9-1.2 1.6v.5"/><path d="M11.5 17.5h.5"/>',
    tick:  '<path d="M20 6 9 17l-5-5"/>',
    globe: '<rect x="3" y="4" width="18" height="15" rx="2"/><path d="M3 9h18M7 21h10"/><path d="M7 13h4M7 16h7"/>',
    phone: '<rect x="7" y="2" width="10" height="20" rx="3"/><path d="M10.5 5.5h3M11 18.5h2"/>',
    chip:  '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"/>',
    cap:   '<path d="M3 8l9-4 9 4-9 4z"/><path d="M7 10.5V15c0 1.7 2.2 3 5 3s5-1.3 5-3v-4.5"/><path d="M21 8v6"/>',
    db:    '<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6"/><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>',
    rocket:'<path d="M12 3c3.5 2.2 5.5 6 5.5 10l-3 2h-5l-3-2C6.5 9 8.5 5.2 12 3z"/><circle cx="12" cy="10" r="1.8"/><path d="M9 17c-1.5 1-2 2.5-2 4 1.5 0 3-.5 4-2M15 17c1.5 1 2 2.5 2 4-1.5 0-3-.5-4-2"/>',
    book:  '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M8 7h7M8 11h7"/>',
    box:   '<path d="M3 8l9-5 9 5-9 5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
    pen:   '<path d="M4 20l4-1 10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5z"/><path d="M13.5 6.5l4 4"/>',
    chat:  '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.2A8 8 0 1 1 21 12z"/>',
    mail:  '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3.5 6.5 12 13l8.5-6.5"/>',
    call:  '<path d="M6 3h3l2 5-2.5 1.5a12 12 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2.2 2A17 17 0 0 1 4 5.2 2 2 0 0 1 6 3z"/>',
    bag:   '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    card:  '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6 15h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>',
    zoom:  '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/><path d="M8.5 11h5M11 8.5v5"/>',
    down:  '<path d="M12 5v11"/><path d="M8 12l4 4 4-4"/><path d="M4 19h16"/>',
    up:    '<path d="M12 16V5"/><path d="M8 9l4-4 4 4"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'
  };
  /* the power mark: one arc, one stroke, and it still reads at 16px where a
     door frame with an arrow through it turns to mush */
  var SIGN_OUT = '<path d="M12 3.6v8.6"/><path d="M7.5 6.7a7.3 7.3 0 1 0 9 0"/>';

  function svg(d, cls) {
    return '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" ' +
      'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" class="' + (cls || '') + '">' +
      d + '</svg>';
  }

  /* ---------- what I build ---------- */
  var CAPABILITIES = [
    { icon: ICON.globe, title: 'Web systems',
      copy: 'The back office a business or a study actually runs on — records in, reports out, and a dashboard that tells you the truth.',
      tags: ['ERP', 'Inventory', 'Booking', 'POS', 'Dashboards'] },
    { icon: ICON.phone, title: 'Mobile apps &amp; PWA',
      copy: 'Android and iOS apps, and installable progressive web apps that keep working when the signal does not.',
      tags: ['Android', 'iOS', 'PWA', 'Offline-ready'] },
    { icon: ICON.chip, title: 'Embedded &amp; robotics',
      copy: 'Arduino and ESP builds that move, sense and decide — with the wiring diagram and the parts list, not just the sketch.',
      tags: ['Arduino', 'ESP32', 'Sensors', 'Motors', 'Prototypes'] },
    { icon: ICON.cap, title: 'For school or for work',
      copy: 'A thesis or capstone with the paperwork a panel expects — or an operations system your staff can be trained on in an afternoon.',
      tags: ['Thesis', 'Capstone', 'Business operations'] }
  ];

  var CATEGORIES = [
    { id: 'all',      label: 'All projects' },
    { id: 'web',      label: 'Web systems' },
    { id: 'mobile',   label: 'Mobile &amp; PWA' },
    { id: 'embedded', label: 'Embedded &amp; IoT' }
  ];
  var KIND_LABEL = { web: 'Web system', mobile: 'Mobile / PWA', embedded: 'Embedded build', any: 'Anything else' };

  /* ---------- who owns what ----------
     'catalog' = the buyer gets the project to use; JUDECH keeps the original.
                 This is always the default.
     'custom'  = ownership transfer; used only when the admin explicitly selects it.

     Said as “yours to use” and “yours to own” rather than in licence language,
     which reads like a software EULA and puts people off a page that is mostly
     students. The substance is unchanged — sections 2 to 5 of the terms are
     what actually bind. */
  var RIGHTS = {
    catalog: {
      label: 'Yours to use &mdash; JUDECH keeps the original',
      short: 'Yours to use &mdash; ownership stays with JUDECH',
      badge: 'Yours to use',
      icon: '<path d="M4 8h16v12H4z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
      summary: 'You are buying the finished project to use &mdash; not the ownership of it. ' +
               'Whether it is a package from this page or something built for you, the ' +
               'original work stays with JUDECH unless an ownership transfer is explicitly ' +
               'selected and written down.',
      yes: ['Use it for your own learning and study',
            'Build it, run it and test it',
            'Modify it for your own requirements',
            'Submit or demonstrate it, subject to your school or company rules',
            'Keep it &mdash; there is no expiry and nothing to renew'],
      no:  ['The original source, documentation and diagrams stay mine',
            'It is not exclusive &mdash; other buyers may have the same package',
            'No reselling, redistributing or uploading it publicly'],
      fine: 'This is what sections 2 to 5 of the terms say, in fewer words.'
    },
    custom: {
      label: 'Yours to own &mdash; ownership transfers to you',
      short: 'Yours to own &mdash; ownership transfers to you',
      badge: 'Yours to own',
      icon: '<path d="M12 3l2.6 5.6 6.4.8-4.7 4.3 1.2 6.3L12 17l-5.5 3 1.2-6.3L3 9.4l6.4-.8z"/>',
      summary: 'JUDECH explicitly selected an ownership transfer for this project. The ' +
               'finished work transfers only under the separate written agreement for ' +
               'that sale; selecting or purchasing a normal project never does this.',
      yes: ['The rights to the finished work are transferred to you',
            'You get the source, the documentation and the diagrams',
            'It stays yours alone &mdash; I do not resell it or list it here',
            'You may keep developing it, or have someone else keep developing it'],
      no:  ['Third-party libraries keep their own licences',
            'General-purpose parts I already owned before your build stay mine to reuse',
            'The transfer is written into your own agreement &mdash; this online form does not replace it'],
      fine: 'This is the “separate written agreement” that sections 2 and 3 of the terms refer to.'
    }
  };

  /* ---------- what a package can contain ---------- */
  var ITEM_TYPES = {
    demo:       { name: 'Live demo',                    icon: ICON.rocket, copy: 'Open the running system and click around it.' },
    simulation: { name: 'Live simulation',              icon: ICON.play,   copy: 'Try the machine in your browser before you build it.' },
    code:       { name: 'Source code',                  icon: ICON.code,   copy: 'The full project source, ready to run or upload.' },
    schema:     { name: 'Database & ERD',               icon: ICON.db,     copy: 'Tables, relationships and the starter data.' },
    diagram:    { name: 'System & wiring diagram',      icon: ICON.wire,   copy: 'How the parts connect — hardware or services.' },
    materials:  { name: 'Materials & components',       icon: ICON.list,   copy: 'The full parts list, with direct Shopee links.' },
    design:     { name: 'UI design files',              icon: ICON.pen,    copy: 'The screens and components, ready to edit.' },
    docs:       { name: 'Guidelines & documentation',  icon: ICON.doc,    copy: 'How it works, how to run it, what to say about it.' },
    manual:     { name: 'User manual',                  icon: ICON.book,   copy: 'Step by step, for each kind of user.' },
    deploy:     { name: 'Setup & deployment guide',     icon: ICON.box,    copy: 'Hosting, domain, builds and going live.' },
    build:      { name: 'Installer / build',            icon: ICON.phone,  copy: 'The APK or build you can install and try.' },
    support:    { name: 'Setup & troubleshooting',      icon: ICON.help,   copy: 'Ask when something misbehaves. A real person answers.' },
    custom:     { name: 'Package item',                 icon: ICON.box,    copy: 'An additional file or resource included with this project.' }
  };

  /* ---------- the projects ---------- */
  var PROJECTS = [
    {
      id: 'envirosortpro',
      rights: 'catalog',
      name: 'EnviroSortPro',
      tagline: 'Automatic waste segregation',
      kind: 'embedded',
      audience: 'Thesis / capstone',
      icon: ICON.bin,
      status: 'ready',
      blurb: 'Drop waste into one opening. Two proximity heads and an infrared beam work ' +
             'out what it is, a rotating platform brings the right bin underneath, and a ' +
             'servo gate lets it fall.',
      tags: ['Arduino Uno R3', '3 bins', 'Browser simulator'],
      intro: 'Everything below is part of this package. The simulator runs the same control ' +
             'flow as the board, so what you see on screen is what the machine does.',
      items: ['simulation', 'code', 'diagram', 'materials', 'docs', 'support'],
      links: {
        simulation: { href: 'simulation.html', sameTab: true },
        diagram:    { href: 'circuit_image%20(1)%20(2).png' },
        docs:       { href: 'README.md' }
      },
      files: [
        ['EnviroSortPro.ino', 'The sketch as built: detection, platform servo, gate servo, LCD, buzzer, full-bin alarm.', 'EnviroSortPro/EnviroSortPro.ino'],
        ['_alternative_state_machine.txt', 'The same behaviour rewritten without blocking delays.', 'EnviroSortPro/_alternative_state_machine.txt']
      ],
      libraries: 'Servo, Wire and LiquidCrystal_I2C.',
      materials: [
        ['Arduino Uno R3', 'Controller running the sketch', '1'],
        ['16&times;2 LCD + I&sup2;C backpack', 'Status display, address 0x27', '1'],
        ['270&deg; metal-gear digital servo', 'Bin platform (D5) and gate (D6)', '2'],
        ['Capacitive proximity sensor', 'Non-biodegradable head, D3', '1'],
        ['Inductive proximity sensor', 'Metal head, D4', '1'],
        ['IR obstacle / beam sensor', 'Biodegradable, D7', '1'],
        ['HC-SR04 ultrasonic sensor', 'Full-bin check, D8 / D9', '1'],
        ['Active buzzer', 'Full-bin alarm, D12', '1'],
        ['LEDs + resistors', 'Status, D2 / D13 / A3', '3'],
        ['Push button', 'Reset &amp; acknowledge, D10', '1'],
        ['7.5 V DC adapter', 'Mains supply', '1'],
        ['14.8 V battery pack', 'Backup supply in the support box', '2'],
        ['18 V solar panel + stand', 'Third source into the power module', '1'],
        ['Power module', 'Takes every source in, one lead to the jack', '1'],
        ['SPDT relay + diode + capacitor', 'Adapter/battery changeover without a reset', '1'],
        ['Plywood hopper, throat and base', '&#8960;184 mm mouth, 128 mm sensing gap', '1'],
        ['Triangular plate + retaining rail', 'Carries the three bins as it spins', '1'],
        ['Bins', 'Bio, non-bio, metal', '3'],
        ['Castors, mast, control box, ties', 'Frame and loom', '&mdash;']
      ],
      run: [['Start a local server', 'python3 -m http.server 5500'], ['Open', 'http://localhost:5500']]
    },

    {
      id: 'erp',
      rights: 'catalog',
      name: 'ERP / Operations System',
      tagline: 'Business operations',
      kind: 'web',
      audience: 'Business operations',
      icon: ICON.globe,
      status: 'soon',
      blurb: 'One back office for the whole operation — records, stock, sales, purchasing, ' +
             'users and the reports management keeps asking for.',
      tags: ['Web system', 'Roles &amp; permissions', 'Reports'],
      planned: ['demo', 'code', 'schema', 'docs', 'manual', 'deploy', 'support']
    },

    {
      id: 'inventory',
      rights: 'catalog',
      name: 'Inventory System',
      tagline: 'Stock in, stock out',
      kind: 'web',
      audience: 'Thesis / capstone &middot; Business',
      icon: ICON.box,
      status: 'soon',
      blurb: 'Items, stock movements, low-stock warnings and printable reports — the ' +
             'plainest version of the thing every business needs first.',
      tags: ['Web system', 'Barcode-ready', 'Reports'],
      planned: ['demo', 'code', 'schema', 'docs', 'manual', 'deploy', 'support']
    },

    {
      id: 'booking',
      rights: 'catalog',
      name: 'Booking &amp; Reservation System',
      tagline: 'Slots, schedules, confirmations',
      kind: 'web',
      audience: 'Thesis / capstone &middot; Business',
      icon: ICON.book,
      status: 'soon',
      blurb: 'Customers pick a slot, staff see the day at a glance, and nobody is booked ' +
             'twice for the same hour.',
      tags: ['Web system', 'Calendar', 'Notifications'],
      planned: ['demo', 'code', 'schema', 'docs', 'manual', 'deploy', 'support']
    },

    {
      id: 'mobileapp',
      rights: 'catalog',
      name: 'Mobile Application',
      tagline: 'Android &amp; iOS',
      kind: 'mobile',
      audience: 'Thesis / capstone &middot; Business',
      icon: ICON.phone,
      status: 'soon',
      blurb: 'A proper app on the phone — built once, installed on Android and iOS, ' +
             'talking to the same back end as the web side.',
      tags: ['Android', 'iOS', 'API-connected'],
      planned: ['build', 'code', 'design', 'docs', 'manual', 'deploy', 'support']
    },

    {
      id: 'pwa',
      rights: 'catalog',
      name: 'Progressive Web App',
      tagline: 'Installable, offline-ready',
      kind: 'mobile',
      audience: 'Thesis / capstone &middot; Business',
      icon: ICON.rocket,
      status: 'soon',
      blurb: 'Opens in a browser, installs to the home screen, and keeps working when the ' +
             'signal drops. No app store queue.',
      tags: ['PWA', 'Offline', 'Installable'],
      planned: ['demo', 'code', 'design', 'docs', 'manual', 'deploy', 'support']
    },

    {
      id: 'flipversion',
      rights: 'catalog',
      name: 'FlipVersion Sorting',
      tagline: 'Sorting machine',
      kind: 'embedded',
      audience: 'Thesis / capstone',
      icon: ICON.flip,
      status: 'soon',
      blurb: 'On the workbench now. The build, the code and the write-up are being put ' +
             'together — say hello if you want it early.',
      tags: ['In the works'],
      planned: ['simulation', 'code', 'diagram', 'materials', 'docs', 'support']
    },

    {
      id: 'coffeevendo',
      rights: 'catalog',
      name: 'Coffee Vendo Waste Machine',
      tagline: 'Vending + waste handling',
      kind: 'embedded',
      audience: 'Thesis / capstone',
      icon: ICON.cup,
      status: 'soon',
      blurb: 'A coffee vendo that looks after its own waste. Being built and documented ' +
             'the same way as the others.',
      tags: ['In the works'],
      planned: ['code', 'diagram', 'materials', 'docs', 'support']
    },

    {
      id: 'more',
      rights: 'catalog',
      name: 'Your system',
      tagline: 'Tell me what you need',
      kind: 'any',
      audience: 'Thesis, capstone or business',
      icon: ICON.more,
      status: 'soon',
      blurb: 'Web, mobile or hardware — if your subject or your business needs something ' +
             'specific, ask. Ownership stays with JUDECH unless a transfer is selected and agreed.',
      tags: ['Requests welcome'],
      planned: ['code', 'docs', 'manual', 'deploy', 'support'],
      custom: true
    }
  ];

  /* ---------- the catalog, when the dashboard is driving it ----------
     Supabase is the source of truth once it has rows; the array above stays as
     the fallback for local mode, an empty table, or a server that will not answer. */
  var ICON_BY_KEY = ICON;

  function fromRow(r) {
    var price = r.price_amount != null && r.price_amount !== ''
      ? (r.price_currency || 'PHP') + ' ' + Number(r.price_amount).toLocaleString()
      : '';
    var links = {};
    Object.keys(r.links || {}).forEach(function (k) {
      var v = r.links[k];
      if (!v) return;
      links[k] = typeof v === 'string' ? { href: v } : v;
    });
    return {
      id: r.id,
      name: r.name || r.id,
      tagline: r.tagline || '',
      kind: r.kind || 'any',
      audience: r.audience || '',
      icon: ICON_BY_KEY[r.icon] || ICON_BY_KEY.more,
      imageUrl: r.image_url || '',
      media: Array.isArray(r.media) ? r.media : [],
      imageFit: r.image_fit === 'contain' ? 'contain' : 'cover',
      imageFocus: /^[0-9.]+% [0-9.]+%$/.test(String(r.image_focus || '')) ? r.image_focus : '50% 50%',
      imageZoom: Number(r.image_zoom) > 1 ? Number(r.image_zoom) : 1,
      status: r.status === 'ready' ? 'ready' : 'soon',
      rights: r.rights === 'custom' ? 'custom' : 'catalog',
      blurb: r.blurb || '',
      tags: r.tags || [],
      intro: r.intro || '',
      items: r.items || [],
      planned: r.planned || [],
      links: links,
      files: r.files || [],
      materials: r.materials || [],
      run: r.run || [],
      packageItems: Array.isArray(r.package_items) ? r.package_items : [],
      faqs: Array.isArray(r.faqs) ? r.faqs.map(function (faq) {
        return Array.isArray(faq)
          ? { question: faq[0] || '', answer: faq[1] || '' }
          : { question: faq && faq.question || '', answer: faq && faq.answer || '' };
      }).filter(function (faq) { return faq.question && faq.answer; }) : [],
      libraries: r.libraries || '',
      price: price,
      priceAmount: r.price_amount == null || r.price_amount === '' ? null : Number(r.price_amount),
      currency: r.price_currency || 'PHP',
      custom: r.id === 'more' || r.rights === 'custom'
    };
  }

  /* ---------- public preview links ----------
     A demo video is what convinces someone to buy, so these sit outside the
     gate: anyone can click them, signed in or not, paid or not. The platform is
     read off the address so the button carries the right logo and a sensible
     label when none was typed. */
  var MEDIA_KINDS = [
    { id: 'youtube',  test: /(^|\.)(youtube\.com|youtu\.be)/i,        name: 'YouTube',   verb: 'Watch on YouTube' },
    { id: 'tiktok',   test: /(^|\.)tiktok\.com/i,                     name: 'TikTok',    verb: 'Watch on TikTok' },
    { id: 'facebook', test: /(^|\.)(facebook\.com|fb\.watch|fb\.me)/i, name: 'Facebook',  verb: 'Watch on Facebook' },
    { id: 'instagram',test: /(^|\.)instagram\.com/i,                  name: 'Instagram', verb: 'See it on Instagram' },
    { id: 'drive',    test: /(^|\.)(drive|docs)\.google\.com/i,        name: 'Google Drive', verb: 'Open in Google Drive' }
  ];

  function mediaKind(url) {
    var host = '';
    try { host = new URL(url, location.href).hostname; } catch (e) { host = String(url || ''); }
    for (var i = 0; i < MEDIA_KINDS.length; i++) {
      if (MEDIA_KINDS[i].test.test(host)) return MEDIA_KINDS[i];
    }
    return { id: 'link', name: 'Link', verb: 'Open the link' };
  }

  function mediaFor(p) {
    return (Array.isArray(p.media) ? p.media : []).map(function (m) {
      if (typeof m === 'string') m = { url: m };
      m = m || {};
      var url = String(m.url || '').trim();
      if (!url) return null;
      var kind = mediaKind(url);
      return {
        url: url,
        kind: kind.id,
        label: String(m.label || '').trim() || kind.verb,
        note: String(m.note || '').trim()
      };
    }).filter(Boolean);
  }

  function mediaButtons(p) {
    var list = mediaFor(p);
    if (!list.length) return '';
    return '<div class="media-row">' + list.map(function (m) {
      var logo = BRAND_LOGO[m.kind]
        ? '<img src="' + BRAND_LOGO[m.kind] + '" alt="" loading="lazy">'
        : svg(m.kind === 'link' ? ICON.globe : ICON.play);
      return '<a class="media-link" data-kind="' + esc(m.kind) + '" href="' + esc(m.url) + '" ' +
        'target="_blank" rel="noopener">' +
        '<span class="media-logo">' + logo + '</span>' +
        '<span><b>' + esc(m.label) + '</b>' +
          (m.note ? '<em>' + esc(m.note) + '</em>' : '') + '</span>' +
        svg('<path d="M7 17 17 7M9 7h8v8"/>', 'media-go') +
      '</a>';
    }).join('') + '</div>';
  }

  /* How a cover sits in its frame — set by dragging it in the dashboard. */
  function coverStyle(p) {
    var fit = p.imageFit === 'contain' ? 'contain' : 'cover';
    var focus = p.imageFocus || '50% 50%';
    var zoom = Number(p.imageZoom) > 1 ? Number(p.imageZoom) : 1;
    return 'object-fit:' + fit + ';object-position:' + focus +
      (fit === 'cover' && zoom > 1
        ? ';transform:scale(' + zoom + ');transform-origin:' + focus : '');
  }

  function packageItemsFor(p) {
    var raw = Array.isArray(p.packageItems) && p.packageItems.length
      ? p.packageItems
      : (p.status === 'ready' ? (p.items || []) : (p.planned || [])).map(function (key) {
          return { id: key, type: ITEM_TYPES[key] ? key : 'custom' };
        });
    return raw.map(function (item, index) {
      if (typeof item === 'string') item = { id: item, type: item };
      item = item || {};
      var type = ITEM_TYPES[item.type] ? item.type : (ITEM_TYPES[item.id] ? item.id : 'custom');
      var meta = ITEM_TYPES[type] || ITEM_TYPES.custom;
      var id = String(item.id || type + '-' + index);
      var oldLink = (p.links || {})[id] || (p.links || {})[type] || {};
      if (typeof oldLink === 'string') oldLink = { href: oldLink };
      return {
        id: id,
        type: type,
        name: String(item.name || meta.name),
        description: String(item.description == null ? meta.copy : item.description),
        icon: ICON_BY_KEY[item.icon] || meta.icon,
        href: String(item.href || oldLink.href || ''),
        sameTab: item.sameTab == null ? !!oldLink.sameTab : !!item.sameTab,
        release: item.release === 'manual' ? 'manual' : 'auto',
        price: item.price == null || item.price === '' ? null : Number(item.price)
      };
    });
  }

  /* ---------- a private offer ----------
     index.html?offer=<token> shows one customer their own view of a project:
     only the components they asked for, at the price quoted to them. Nothing
     about the public catalog changes — the offer lives in this variable and is
     applied on the way to the screen. */
  var offer = null;

  function offerFor(p) { return offer && p && offer.projectId === p.id ? offer : null; }

  function copyItem(item, price) {
    var out = {};
    for (var k in item) if (Object.prototype.hasOwnProperty.call(item, k)) out[k] = item[k];
    out.price = price;
    return out;
  }

  /* What this visitor should see in the package — the whole thing, or the
     slice a private link put in front of them. */
  function itemsForView(p) {
    var list = packageItemsFor(p), o = offerFor(p);
    if (!o) return list;
    if (o.itemIds && o.itemIds.length) {
      list = list.filter(function (i) { return o.itemIds.indexOf(i.id) > -1; });
    }
    return list.map(function (i) {
      var over = o.prices && o.prices[i.id];
      return over == null || over === '' ? i : copyItem(i, Number(over));
    });
  }

  /* “Everything here” costs what? On a private link that is the quoted price,
     or the components it lists added up — never the catalog's full-package
     price, which covers parts the customer was not offered. */
  function packagePrice(p) {
    var o = offerFor(p);
    if (o && o.packagePrice != null) return Number(o.packagePrice);
    if (o && o.itemIds && o.itemIds.length) {
      var sum = 0, known = false;
      itemsForView(p).forEach(function (i) {
        var price = itemPrice(p, i);
        if (price != null) { sum += price; known = true; }
      });
      return known ? sum : null;
    }
    return p.priceAmount == null ? null : Number(p.priceAmount);
  }

  function fmtMoney(n, cur) {
    if (n == null || isNaN(n)) return '';
    return (cur || 'PHP') + ' ' + Number(n).toLocaleString(undefined,
      { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  function itemPrice(p, item) {
    return item.price == null || isNaN(item.price) ? null : Number(item.price);
  }

  function sellableItems(p) {
    return itemsForView(p).filter(function (i) { return itemPrice(p, i) != null; });
  }

  /* ---------- staged release ----------
     An item marked 'manual' on the project stays shut after the payment and the
     terms until the seller releases it for this buyer. The server has the last
     word: package_access() answers per claim token, and what it says overrides
     the project's own default in both directions. */
  var accessMemory = {};

  function accessMap(id) { return accessMemory[accountSlot(id)] || null; }

  function itemReleased(p, item) {
    var map = accessMap(p.id);
    if (map && Object.prototype.hasOwnProperty.call(map, item.id)) {
      return map[item.id] === 'released';
    }
    return item.release !== 'manual';
  }

  function refreshAccess(id) {
    if (!B.enabled || !B.packageAccessAll) return Promise.resolve(null);
    var tokens = purchases(id).filter(function (b) {
      return b.status === 'approved' && b.token;
    }).map(function (b) { return b.token; });
    if (!tokens.length) return Promise.resolve(null);
    return B.packageAccessAll(tokens).then(function (rows) {
      var map = {};
      (rows || []).forEach(function (r) { map[r.item_id] = r.state; });
      var slot = accountSlot(id);
      var changed = JSON.stringify(accessMemory[slot] || null) !== JSON.stringify(map);
      accessMemory[slot] = map;
      if (changed && openProjectId === id) paintProject();
      return map;
    }).catch(function () { return null; });
  }

  /* ---------- proof of legitimacy ----------
     Evidence, not sales copy: each tile says what it is, what it shows and when.
     The whole section stays out of the page until there is something in it. */
  var PROOFS = [];

  function hydrateProofs() {
    if (!B.enabled || !B.proofs) return Promise.resolve([]);
    return B.proofs().then(function (rows) {
      PROOFS = rows || [];
      renderProof();
      return PROOFS;
    }).catch(function (e) {
      console.warn('proof section stayed empty:', e.message);
      return [];
    });
  }

  function proofWhen(d) {
    if (!d) return '';
    var parts = String(d).split('-');
    if (parts.length !== 3) return d;
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return Number(parts[2]) + ' ' + m[Number(parts[1]) - 1] + ' ' + parts[0];
  }

  function proofTile(r) {
    var video = String(r.video_url || '').trim();
    var image = proofCover(r);
    var shots = proofItems(r).length;
    var kind = video ? mediaKind(video) : null;
    return '<button type="button" class="proof-tile" data-proof="' + esc(r.id) + '">' +
      '<span class="proof-shot">' +
        (image
          ? '<img src="' + esc(image) + '" alt="" loading="lazy">'
          : '<span class="proof-noshot">' + svg(ICON.play) + '</span>') +
        '<span class="proof-kind">' + esc(r.kind || 'Proof') + '</span>' +
        (video ? '<span class="proof-play">' + svg(ICON.play) +
                 (isVideoFile(video) ? 'Clip'
                   : kind && kind.id !== 'link' ? esc(kind.name) : 'Watch') + '</span>' : '') +
        (shots > 1 ? '<span class="proof-shots">' + shots + ' photos</span>' : '') +
      '</span>' +
      '<span class="proof-body">' +
        '<b>' + esc(r.title) + '</b>' +
        (r.description ? '<p>' + esc(r.description) + '</p>' : '') +
        '<span class="proof-foot">' +
          (r.happened_on ? '<em>' + esc(proofWhen(r.happened_on)) + '</em>' : '<em></em>') +
          '<span class="proof-go">' + (shots > 1 ? 'Look through' : video ? 'Watch it' : 'See it whole') +
            svg('<path d="M5 12h13M13 6l6 6-6 6"/>') + '</span>' +
        '</span>' +
      '</span>' +
    '</button>';
  }

  function renderProof() {
    var section = $('#proof'), grid = $('#proofGrid'), link = $('#navProof');
    if (!section || !grid) return;
    var rows = PROOFS.filter(function (r) {
      return r.image_url || r.video_url || (Array.isArray(r.images) && r.images.length);
    });

    section.hidden = !rows.length;
    if (link) link.hidden = !rows.length;
    /* the bands either side shuffle so the page keeps alternating */
    $('#rights').className = 'band ' + (rows.length ? 'pane-b' : 'pane-a');
    $('#contact').className = 'band ' + (rows.length ? 'pane-a' : 'pane-b');
    if (!rows.length) return;

    grid.innerHTML = rows.map(proofTile).join('');
    $$('#proofGrid .proof-tile').forEach(function (el) {
      el.addEventListener('click', function () { openProof(el.dataset.proof); });
    });
    spyOn('proof');
  }

  function proofItems(r) {
    var list = (Array.isArray(r.images) ? r.images : []).map(function (i) {
      if (typeof i === 'string') i = { url: i };
      return {
        url: String((i && i.url) || '').trim(),
        caption: String((i && i.caption) || ''),
        date: String((i && i.date) || '')
      };
    }).filter(function (i) { return i.url; });
    if (!list.length && r.image_url) {
      list.push({ url: r.image_url, caption: r.description || '', date: r.happened_on || '' });
    }
    return list;
  }

  function proofCover(r) {
    var list = proofItems(r);
    return list.length ? list[0].url : '';
  }

  function openProof(id) {
    var r = PROOFS.filter(function (row) { return String(row.id) === String(id); })[0];
    if (!r) return;
    var items = proofItems(r);
    var video = String(r.video_url || '').trim();
    var out = null;
    if (video && isVideoFile(video)) {
      items.unshift({ url: video, caption: r.description || '', date: r.happened_on || '' });
    }
    else if (video) {
      var kind = mediaKind(video);
      out = { url: video, label: kind.id === 'link' ? 'Open the video' : 'Watch on ' + kind.name };
    }
    if (!items.length && out) { window.open(out.url, '_blank', 'noopener'); return; }
    openGallery(items, r.title, out);
  }

  function hydrateProjects() {
    if (!B.enabled || !B.projects) return Promise.resolve(null);
    return B.projects().then(function (rows) {
      if (!rows || !rows.length) return;                 // empty table: keep the built-in list
      PROJECTS = rows.map(fromRow);
      renderFilters();
      renderProjects();
      if (openProjectId && byId(openProjectId)) paintProject();
    }).catch(function (e) {
      console.warn('catalog stayed local:', e.message);   // the page still works
    });
  }

  /* ---------- a private link ----------
     index.html?offer=<token>. It never changes the catalog for anyone else:
     the row is read once, kept in `offer`, and applied on the way to the
     screen by itemsForView() and packagePrice(). */
  function loadOffer() {
    var m = /[?&#]offer=([A-Za-z0-9]+)/.exec(String(location.search) + String(location.hash));
    if (!m || !B.enabled || !B.projectShare) return Promise.resolve(null);
    return B.projectShare(m[1]).then(function (row) {
      if (!row) return null;
      offer = {
        token: row.token,
        projectId: row.project_id,
        customerName: row.customer_name || 'you',
        note: row.customer_note || '',
        headline: row.headline || '',
        itemIds: row.item_ids || [],
        prices: row.prices || {},
        packagePrice: row.package_price == null ? null : Number(row.package_price)
      };
      if (!byId(offer.projectId)) { offer = null; return null; }
      renderProjects();
      openProject(offer.projectId);
      return offer;
    }).catch(function (e) {
      openInfo({
        title: 'That link did not open',
        sub: 'Private project link',
        html: '<p>' + esc(e.message) + '</p><p style="margin-top:12px">Ask me for a new one — ' +
          'links can be cancelled or given an expiry date.</p>' +
          (contactLink() ? '<p style="margin-top:14px">' + contactButton() + '</p>' : ''),
        msg: 'The rest of the page works as normal.'
      });
      return null;
    });
  }

  /* ---------- elements ---------- */
  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };

  var projectOverlay = $('#projectOverlay'), termsOverlay = $('#termsOverlay'), infoOverlay = $('#infoOverlay');
  var termsBody = $('#termsBody'), termsScroll = $('#termsScroll');
  var ackWrap = $('#ackWrap'), ack = $('#fAck');
  var buyer = $('#fBuyer'), sign = $('#fSign'), buyerDate = $('#fBuyerDate');
  var buyerType = $('#fType'), school = $('#fSchool'), locationF = $('#fLocation');
  var typeOther = $('#fTypeOther'), typeOtherWrap = $('#fTypeOtherWrap');
  var KNOWN_TYPES = ['Student'];

  /* what goes on the record: the typed answer when they picked Other */
  function buyerTypeValue() {
    return buyerType.value === 'Other' ? typeOther.value.trim() : buyerType.value;
  }
  function syncType() {
    var other = buyerType.value === 'Other';
    typeOtherWrap.hidden = !other;
    school.placeholder = buyerType.value === 'Student' ? 'Name of your school' : 'Optional';
  }
  var sellerDate = $('#fSellerDate'), projField = $('#fProject');
  var agreeBtn = $('#agreeBtn'), formMsg = $('#formMsg');

  var openProjectId = null;   // project shown in the project modal
  var termsFor = null;        // project the terms form is being signed for
  var pendingItem = null;     // item to open once the terms are signed
  var termsBuy = '';          // which purchase the terms form is signing for
  var focusStack = [];

  /* ---------- storage ---------- */
  var memory = {};            // fallback if localStorage is unavailable
  function accountSlot(id) {
    return B && B.enabled && me ? me.id + ':' + id : id;
  }
  function accountStorageKey(prefix, id) {
    return prefix + accountSlot(id);
  }
  function byId(id) {
    for (var i = 0; i < PROJECTS.length; i++) if (PROJECTS[i].id === id) return PROJECTS[i];
    return null;
  }
  /* The signed agreement belongs to a purchase, not to a project: someone who
     buys the diagram in June and the code in August signs twice. `saved` hands
     back the signature on the purchase the page is working with, falling back
     to the most recent one so “View agreement” always has something to show. */
  function saved(id) {
    var cur = getPay(id);
    if (cur && cur.signed) return cur.signed;
    var list = purchases(id);
    for (var i = list.length - 1; i >= 0; i--) if (list[i].signed) return list[i].signed;
    return null;
  }
  function save(id, rec, key) {
    if (B && B.enabled && me) rec.accountId = me.id;
    var want = key || buyKey(getPay(id));
    var list = readBuys(id).slice(), found = false;
    list.forEach(function (b) {
      if (!found && buyKey(b) === want) { b.signed = rec; found = true; }
    });
    if (!found) {
      list.push({ projectId: id, status: 'none', scope: 'package', itemIds: [],
                  signed: rec, accountId: me ? me.id : null });
    }
    writeBuys(id, list);
  }
  /* “Reset” on the project page: every purchase of it needs signing again. */
  function forget(id) {
    var list = readBuys(id).slice();
    list.forEach(function (b) { delete b.signed; });
    writeBuys(id, list);
  }
  function today() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }
  function pretty(iso) {
    if (!iso) return '';
    var p = String(iso).split('-');
    if (p.length !== 3) return iso;
    var m = ['January','February','March','April','May','June','July',
             'August','September','October','November','December'];
    return Number(p[2]) + ' ' + m[Number(p[1]) - 1] + ' ' + p[0];
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- the catalog ---------- */
  var filterId = 'all';

  function inFilter(p) { return filterId === 'all' || p.kind === filterId || p.kind === 'any'; }

  function renderCapabilities() {
    $('#capGrid').innerHTML = CAPABILITIES.map(function (c) {
      return '<div class="cap"><span class="cap-icon">' + svg(c.icon) + '</span>' +
        '<h3>' + c.title + '</h3><p>' + c.copy + '</p><ul>' +
        c.tags.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
    }).join('');
  }

  function renderFilters() {
    $('#filterRow').innerHTML = CATEGORIES.map(function (c) {
      var n = PROJECTS.filter(function (p) {
        return c.id === 'all' || p.kind === c.id || p.kind === 'any';
      }).length;
      return '<button class="filter" data-filter="' + c.id + '" aria-pressed="' +
        (c.id === filterId) + '">' + c.label + '<span class="count">' + n + '</span></button>';
    }).join('');
    $$('#filterRow .filter').forEach(function (el) {
      el.addEventListener('click', function () {
        filterId = el.dataset.filter;
        renderFilters();
        renderProjects();
      });
    });
  }

  function renderProjects() {
    var shown = PROJECTS.filter(inFilter);
    $('#projectGrid').innerHTML = shown.map(function (p) {
      var ready = p.status === 'ready';
      return '<button class="project" data-project="' + p.id + '" data-status="' + p.status + '"' +
        (offerFor(p) ? ' data-offer="true"' : '') + '>' +
        '<span class="pill ' + (ready ? 'pill-ready' : 'pill-soon') + '">' +
          (ready ? 'Available now' : 'Coming soon') + '</span>' +
        (offerFor(p) ? '<span class="pill pill-offer">Prepared for you</span>' : '') +
        (mediaFor(p).length
          ? '<span class="card-media">' + svg(ICON.play) + 'Watch it first</span>' : '') +
        (p.imageUrl
          ? '<span class="project-cover"><img src="' + esc(p.imageUrl) + '" alt="' +
              esc(p.name) + ' project preview" loading="lazy" style="' + coverStyle(p) + '"></span>'
          : '<span class="project-icon">' + svg(p.icon) + '</span>') +
        '<span class="kind">' + (KIND_LABEL[p.kind] || '') + '</span>' +
        '<span class="tagline">' + p.tagline + '</span>' +
        '<h3>' + p.name + '</h3>' +
        '<p class="blurb">' + p.blurb + '</p>' +
        '<span class="tags">' + p.tags.map(function (t) {
          return '<span class="tag">' + t + '</span>';
        }).join('') + '</span>' +
        '<span class="go">' + (ready ? 'Open the package' : 'See what is planned') +
          svg('<path d="M5 12h13M13 6l6 6-6 6"/>') + '</span>' +
      '</button>';
    }).join('');
    $('#emptyNote').hidden = shown.length > 0;
    $$('.project').forEach(function (el) {
      el.addEventListener('click', function () { openProject(el.dataset.project); });
    });
  }

  function renderRights() {
    $('#rightsGrid').innerHTML = ['catalog', 'custom'].map(function (t) {
      var r = RIGHTS[t];
      return '<div class="rights-card" data-track="' + t + '">' +
        '<span class="badge">' + svg(r.icon) + r.badge + '</span>' +
        '<h3>' + r.label + '</h3><p>' + r.summary + '</p>' +
        '<h4>What you may do</h4><ul>' +
          r.yes.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>' +
        '<h4>' + (t === 'custom' ? 'Worth knowing' : 'What stays with me') + '</h4><ul>' +
          r.no.map(function (x) { return '<li class="no">' + x + '</li>'; }).join('') + '</ul>' +
        '<p class="fine">' + r.fine + '</p></div>';
    }).join('');
  }

  function rightsNote(track, projectName) {
    var r = RIGHTS[track] || RIGHTS.catalog;
    var body = track === 'custom'
      ? '<p>' + (projectName ? '<b>' + projectName + '</b> has been explicitly marked by ' +
          'JUDECH for an ownership transfer. ' : '') + 'The finished work transfers only ' +
          'under the separate written agreement that sections 2 and 3 below refer to. ' +
          'This standard package form does not itself transfer ownership.</p>'
      : '<p>' + (projectName ? '<b>' + projectName + '</b> is yours to use. '
          : 'Projects are yours to use by default. ') +
          'Signing below confirms that under sections 1–13 — you may build it, run it, ' +
          'modify it and keep it, while the original source, documentation and diagrams ' +
          'stay mine and copyright in them is not transferred (sections 2 and 3).</p>';
    return '<div class="rights-note" data-track="' + track + '">' +
      '<span class="head">' + svg(r.icon) + r.label + '</span>' + body + '</div>';
  }

  /* ---------- contact ---------- */
  function renderContact() {
    var emailHref = CONTACT.email ? 'https://mail.google.com/mail/?view=cm&fs=1' +
      '&to=' + encodeURIComponent(CONTACT.email) +
      '&su=' + encodeURIComponent('Project inquiry for JUDECH') +
      '&body=' + encodeURIComponent('Hi JUDECH,\n\nI would like to ask about a project.\n\nProject or system needed:\nDeadline:\nBudget range:\n') : '';
    var rows = [
      ['facebook',  'Facebook page', ICON.chat,  CONTACT.facebook,  CONTACT.facebook,  'Open page'],
      ['messenger', 'Messenger',     ICON.chat,  CONTACT.messenger, CONTACT.messenger, 'Message'],
      ['email',     'Gmail',         ICON.mail,  CONTACT.email,     emailHref,         'Open Gmail'],
      ['instagram', 'Instagram',     ICON.chat,  CONTACT.instagram, CONTACT.instagram, 'Open Instagram'],
      ['tiktok',    'TikTok',        ICON.play,  CONTACT.tiktok,    CONTACT.tiktok,    'Watch builds'],
      ['discord',   'Discord',       ICON.chat,  CONTACT.discord,   '',                'Copy', 'copy'],
      ['shopee',    'Shopee shop',   ICON.bag,   CONTACT.shopee,    CONTACT.shopee,    'Open shop']
    ].filter(function (r) { return r[3]; });

    $('#channelList').innerHTML = rows.length
      ? rows.map(function (r) {
          var shown = r[3].replace(/^https?:\/\//, '').replace(/\/$/, '');
          var logo = BRAND_LOGO[r[0]]
            ? '<img src="' + BRAND_LOGO[r[0]] + '" alt="" loading="lazy">'
            : svg(r[2]);
          if (r[6] === 'copy') {
            return '<button class="channel" type="button" data-copy-contact="' + esc(r[3]) + '">' +
              '<span class="channel-icon">' + logo + '</span>' +
              '<span><b>' + r[1] + '</b><span>' + esc(shown) + '</span></span>' +
              '<span class="go">' + r[5] + '</span></button>';
          }
          var website = /^https?:/i.test(r[4]);
          return '<a class="channel" href="' + esc(r[4]) + '"' +
            (website ? ' target="_blank" rel="noopener noreferrer"' : '') +
            ' aria-label="' + esc(r[5] + ' using ' + r[1]) + '">' +
            '<span class="channel-icon">' + logo + '</span>' +
            '<span><b>' + r[1] + '</b><span>' + esc(shown) + '</span></span>' +
            '<span class="go">' + r[5] + ' &rsaquo;</span></a>';
        }).join('')
      : '<div class="setup-hint">' + svg(ICON.chat) +
        '<span><b>No contact channels set yet.</b> Open <code>js/landing.js</code> and fill in the ' +
        '<code>CONTACT</code> block near the top — Facebook, Messenger, email, phone or Shopee. ' +
        'Whatever you fill in appears here, and this note disappears.</span></div>';
    $$('[data-copy-contact]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var value = btn.dataset.copyContact;
        var done = function () { btn.querySelector('.go').textContent = 'Copied'; };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function () { window.prompt('Copy Discord username:', value); });
        } else window.prompt('Copy Discord username:', value);
      });
    });
    $('#contactHours').textContent = CONTACT.hours || '';
  }

  /* ---------- messages sent through this site ---------- */
  var CONTACT_DRAFT = 'judech.contact-draft';
  var CONTACT_RESUME = 'judech.after-signin-contact';
  var contactThreads = [];

  function contactWhen(iso) {
    return iso ? new Date(iso).toLocaleString() : '';
  }

  var iAmBlocked = false;

  function paintBlocked() {
    var note = $('#chatBlocked'), form = $('#contactForm');
    if (!note) return;
    note.hidden = !iAmBlocked;
    if (form && iAmBlocked) form.hidden = true;
    $$('#myMessageList .composer').forEach(function (c) { c.hidden = iAmBlocked; });
  }

  function checkBlocked() {
    if (!B.enabled || !B.amIBlocked || !me) { iAmBlocked = false; paintBlocked(); return; }
    B.amIBlocked().then(function (blocked) {
      iAmBlocked = !!blocked;
      paintBlocked();
    }).catch(function () {});
  }

  function paintContactAccount() {
    var identity = $('#contactIdentity'), btn = $('#sendContact'), refresh = $('#refreshMessages');
    if (!identity || !btn) return;
    if (me) {
      /* getting this far already means signed in — saying so is noise */
      identity.hidden = true;
      identity.textContent = '';
      btn.textContent = 'Send message';
      refresh.hidden = false;
      $('#myMessages').hidden = false;
    } else {
      identity.hidden = false;
      identity.textContent = 'Sign in with Google to start the chat and read the replies here.';
      btn.textContent = 'Sign in with Google to send';
      refresh.hidden = true;
      $('#myMessages').hidden = true;
      /* signed out there are no conversations to switch between, so the panel
         goes back to being one compose box */
      contactThreads = [];
      activeThread = 'new';
      var tabs = $('#msgTabs');
      if (tabs) { tabs.hidden = true; tabs.innerHTML = ''; }
      var form = $('#contactForm');
      if (form) form.hidden = false;
      $('#myMessageList').innerHTML = '';
    }
  }

  function unreadAdminEntries(m) {
    return (m.entries || []).filter(function (e) { return e.sender_role === 'admin' && !e.read_at; });
  }

  function setBuyerUnreadCount(rows) {
    var count = rows.reduce(function (n, m) { return n + unreadAdminEntries(m).length; }, 0);
    var badge = $('#messageFabBadge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count === 0;
    $('.message-fab').classList.toggle('has-unread', count > 0);
  }

  /* A message is a bubble. Yours carries a pencil that only shows when you
     reach for it — the editor is the exception, not the resting state. */
  function buyerEntryRow(e) {
    var mine = e.sender_role === 'user';
    var unread = !mine && !e.read_at;
    return '<div class="chat-line ' + (mine ? 'from-buyer' : 'from-admin') +
      (unread ? ' is-unread' : '') + '" data-entry="' + e.id + '">' +
      '<div class="chat-row">' +
        '<div class="bubble">' +
          '<p data-entry-text>' + esc(e.body) + '</p>' +
          (mine
            ? '<div class="bubble-edit" data-entry-edit hidden>' +
                '<textarea data-edit-entry="' + e.id + '" maxlength="4000" ' +
                  'aria-label="Edit your message">' + esc(e.body) + '</textarea>' +
                '<div class="bubble-edit-tools">' +
                  '<button class="btn btn-sm btn-primary" type="button" data-save-entry="' + e.id + '">Save</button>' +
                  '<button class="btn btn-sm btn-ghost" type="button" data-cancel-entry="' + e.id + '">Cancel</button>' +
                '</div>' +
              '</div>'
            : '') +
        '</div>' +
        (mine
          ? '<div class="bubble-tools">' +
              '<button class="chat-icon" type="button" data-edit-toggle="' + e.id + '" ' +
                'title="Edit this message" aria-label="Edit this message">' +
                svg('<path d="M4 20l4-1 10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5z"/><path d="M13.5 6.5l4 4"/>') +
              '</button>' +
            '</div>'
          : '') +
      '</div>' +
      '<span class="chat-meta">' +
        (unread ? '<b class="unread-indicator">New reply</b> · ' : '') +
        esc(contactWhen(e.created_at)) +
        (e.edited_at ? ' · edited' : '') +
        (mine ? ' · ' + (e.read_at ? 'Read' : 'Sent') : '') +
        '<span class="msg" data-entry-msg="' + e.id + '"></span>' +
      '</span>' +
    '</div>';
  }

  /* Conversations are titles, not a column to scroll: each one is a tab under
     the panel header, carrying its own unread count so a reply is noticed here
     and not only on the floating button. */
  var activeThread = null;

  function threadTab(m) {
    var unread = unreadAdminEntries(m).length;
    return '<button class="msg-tab" type="button" role="tab" data-thread-tab="' + m.id + '"' +
      (m.id === activeThread ? ' aria-selected="true"' : ' aria-selected="false"') +
      (unread ? ' data-unread="true"' : '') + '>' +
      '<span>' + esc(m.title) + '</span>' +
      (unread ? '<b class="msg-tab-dot">' + unread + '</b>' : '') +
    '</button>';
  }

  function activeCompose() {
    var box = $('#myMessageList [data-thread-compose]');
    return box ? box.value.trim() : '';
  }

  function renderThreads(opts) {
    opts = opts || {};
    var tabs = $('#msgTabs'), list = $('#myMessageList');
    if (!tabs || !list) return;
    var rows = contactThreads || [];

    if (!rows.length) activeThread = 'new';
    else if (activeThread !== 'new') {
      var here = rows.filter(function (m) { return m.id === activeThread; })[0];
      if (!here) {
        var waiting = rows.filter(function (m) { return unreadAdminEntries(m).length; })[0];
        activeThread = (waiting || rows[0]).id;
      }
    }

    tabs.hidden = !rows.length;
    tabs.innerHTML = rows.map(threadTab).join('') +
      '<button class="msg-tab msg-tab-new" type="button" role="tab" data-thread-tab="new"' +
        (activeThread === 'new' ? ' aria-selected="true"' : ' aria-selected="false"') +
        ' title="Start another conversation">' +
        svg('<path d="M12 5v14M5 12h14"/>') + '<span>New</span></button>';
    $$('#msgTabs [data-thread-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (activeThread === b.dataset.threadTab) return;
        activeThread = b.dataset.threadTab;
        renderThreads();
        if (activeThread === 'new') { var t = $('#contactTitle'); if (t) t.focus(); }
      });
    });

    var form = $('#contactForm');
    if (form) form.hidden = activeThread !== 'new' || iAmBlocked;
    $('#myMessageEmpty').hidden = true;

    if (opts.tabsOnly) return;

    var open = rows.filter(function (m) { return m.id === activeThread; })[0];
    list.innerHTML = open ? buyerMessageRow(open) : '';
    if (!open) return;

    bindBuyerMessageActions();
    paintBlocked();
    var history = $('[data-buyer-thread="' + open.id + '"]');
    if (history) history.scrollTop = history.scrollHeight;
    var article = $('#myMessageList [data-conversation]');
    if (article && unreadAdminEntries(open).length) markBuyerThreadRead(open.id, article);
  }

  function buyerMessageRow(m) {
    var unread = unreadAdminEntries(m).length;
    return '<article class="buyer-message' + (unread ? ' has-unread' : '') + '" data-conversation="' + m.id +
      '" data-unread="' + unread + '">' +
      '<div class="thread-toolbar">' +
        '<span>' + (m.entries || []).length +
          ((m.entries || []).length === 1 ? ' message' : ' messages') +
          ' &middot; started ' + esc(contactWhen(m.created_at)) + '</span>' +
        '<button class="thread-latest" type="button" data-scroll-buyer-thread="' + m.id +
          '" aria-label="Scroll to the latest message">Latest &darr;</button></div>' +
      '<div class="thread-entries" data-buyer-thread="' + m.id + '" tabindex="0" aria-label="Message history">' +
        (m.entries || []).map(buyerEntryRow).join('') +
        (!m.entries || !m.entries.some(function (e) { return e.sender_role === 'admin'; })
          ? '<p class="message-waiting">Waiting for a reply — usually within a day.</p>' : '') +
      '</div>' +
      '<div class="composer" data-composer="' + m.id + '">' +
        '<textarea data-thread-compose="' + m.id + '" rows="1" maxlength="4000" ' +
          'placeholder="Write a message…" aria-label="Write a message"></textarea>' +
        '<button class="composer-send" type="button" data-send-entry="' + m.id + '" ' +
          'aria-label="Send message" title="Send">' +
          svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>') + '</button>' +
      '</div>' +
      '<span class="msg composer-msg" data-thread-msg="' + m.id + '"></span>' +
    '</article>';
  }

  function markBuyerThreadRead(id, article) {
    if (!B.markMessageRead || article.dataset.reading === 'true' || Number(article.dataset.unread) < 1) return;
    article.dataset.reading = 'true';
    B.markMessageRead(id).then(function () {
      var now = new Date().toISOString();
      contactThreads.forEach(function (m) {
        if (m.id !== id) return;
        (m.entries || []).forEach(function (e) {
          if (e.sender_role === 'admin' && !e.read_at) e.read_at = now;
        });
      });
      article.dataset.unread = '0';
      article.classList.remove('has-unread');
      article.querySelectorAll('.unread-indicator').forEach(function (el) { el.remove(); });
      article.querySelectorAll('.thread-entry.is-unread').forEach(function (el) { el.classList.remove('is-unread'); });
      var state = article.querySelector('.message-state');
      if (state) { state.dataset.state = 'replied'; state.textContent = 'Replied'; }
      setBuyerUnreadCount(contactThreads);
    }).catch(function () { article.dataset.reading = 'false'; });
  }

  function bindBuyerMessageActions() {
    $$('#myMessageList [data-scroll-buyer-thread]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var history = $('[data-buyer-thread="' + btn.dataset.scrollBuyerThread + '"]');
        if (history) history.scrollTo({ top: history.scrollHeight, behavior: 'smooth' });
      });
    });
    $$('#myMessageList [data-send-entry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.sendEntry;
        var box = $('[data-thread-compose="' + id + '"]');
        var msg = $('[data-thread-msg="' + id + '"]');
        var body = box.value.trim();
        if (!body) { box.focus(); return; }
        btn.disabled = true; msg.textContent = 'Sending…';
        B.addMessageEntry(id, body).then(loadContactMessages).catch(function (e) {
          msg.dataset.err = 'true'; msg.textContent = e.message; btn.disabled = false;
        });
      });
    });
    /* the pencil turns one bubble into an editor and back */
    $$('#myMessageList [data-edit-toggle]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var line = btn.closest('.chat-line');
        var editor = line.querySelector('[data-entry-edit]');
        var text = line.querySelector('[data-entry-text]');
        editor.hidden = false;
        text.hidden = true;
        line.dataset.editing = 'true';
        var box = editor.querySelector('textarea');
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
        grow(box);
      });
    });
    $$('#myMessageList [data-cancel-entry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var line = btn.closest('.chat-line');
        var editor = line.querySelector('[data-entry-edit]');
        var text = line.querySelector('[data-entry-text]');
        editor.querySelector('textarea').value = text.textContent;
        editor.hidden = true;
        text.hidden = false;
        line.dataset.editing = 'false';
      });
    });
    $$('#myMessageList [data-save-entry]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.dataset.saveEntry;
        var box = $('[data-edit-entry="' + id + '"]');
        var msg = $('[data-entry-msg="' + id + '"]');
        var body = box.value.trim();
        if (!body) { box.focus(); return; }
        btn.disabled = true; msg.textContent = 'Saving…';
        B.updateMessageEntry(id, body).then(loadContactMessages).catch(function (e) {
          msg.dataset.err = 'true'; msg.textContent = e.message; btn.disabled = false;
        });
      });
    });

    /* the composer: Enter sends, Shift+Enter breaks the line */
    $$('#myMessageList [data-thread-compose]').forEach(function (box) {
      grow(box);
      box.addEventListener('input', function () { grow(box); });
      box.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        var send = $('[data-send-entry="' + box.dataset.threadCompose + '"]');
        if (send) send.click();
      });
    });
  }

  /* a one-line box that grows with what is typed into it, up to a point */
  function grow(box) {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 132) + 'px';
  }

  function loadContactMessages() {
    paintContactAccount();
    if (!me || !B.enabled || !B.myMessages) return Promise.resolve([]);
    return B.myMessages().then(function (rows) {
      contactThreads = rows;
      setBuyerUnreadCount(rows);
      renderThreads();
      return rows;
    }).catch(function (e) {
      $('#contactMsg').dataset.err = 'true';
      $('#contactMsg').textContent = 'Could not load replies: ' + e.message;
      return [];
    });
  }

  /* ---------- the message dock ----------
     One thread panel, opened from the floating button or from anywhere else
     that offers to take a message. It slides up, it puts itself away, and what
     is half-typed in it survives being put away. */
  /* Three states, not two. 'min' keeps the panel on screen as its own header
     bar — the conversation is put aside, not put away — and only the × hands it
     back to the floating button. */
  var msgDock = $('#msgDock');

  function messageState() { return (msgDock && msgDock.dataset.state) || 'closed'; }
  function messagesShowing() { return messageState() !== 'closed'; }

  function setMessageState(state, focus) {
    if (!msgDock) return;
    if (state !== 'closed') { hideTip(); markTipSeen(); }
    msgDock.dataset.state = state;
    var fab = $('#messageFab');
    if (fab) fab.setAttribute('aria-expanded', state === 'closed' ? 'false' : 'true');
    var min = $('#msgDockMin');
    if (min) {
      var open = state === 'open';
      min.setAttribute('aria-expanded', open ? 'true' : 'false');
      min.setAttribute('aria-label', open ? 'Collapse the chat' : 'Open the chat');
      min.title = open ? 'Collapse' : 'Open';
    }
    if (state === 'open' && B.enabled && me && B.myMessages) loadContactMessages();
    if (state === 'open' && focus !== false) {
      var target = $('#contactTitle');
      if (target && !target.disabled) setTimeout(function () { target.focus(); }, 280);
    }
    if (state === 'closed' && focus !== false && fab) fab.focus();
  }

  function openMessages(focus) { setMessageState('open', focus); }
  function minMessages() { setMessageState('min', false); }
  function closeMessages(back) { setMessageState('closed', back); }
  function toggleMessages() { messagesShowing() ? closeMessages() : openMessages(); }

  function resumeContactAfterSignIn() {
    var resume = false, draft = null;
    try {
      resume = localStorage.getItem(CONTACT_RESUME) === 'true';
      localStorage.removeItem(CONTACT_RESUME);
      draft = JSON.parse(localStorage.getItem(CONTACT_DRAFT) || 'null');
      localStorage.removeItem(CONTACT_DRAFT);
    } catch (e) {}
    if (draft) {
      $('#contactTitle').value = draft.title || '';
      $('#contactMessage').value = draft.message || '';
    }
    if (resume || draft) openMessages();
  }

  /* ---------- the chat nudge ----------
     People expect a reply by email. This says, once, where it actually lands.
     On by default; switched off for good from the tip itself or from the
     checkbox at the foot of the chat, which is where someone would look for it. */
  var TIP_OFF = 'judech.chat-tip.off';
  var tipTimer = null, tipDone = false;   /* once per page view, not once per tab */

  function tipAllowed() {
    try { return localStorage.getItem(TIP_OFF) !== 'true'; } catch (e) { return true; }
  }
  function markTipSeen() { tipDone = true; }

  function hideTip() {
    var tip = $('#chatTip');
    if (tip) tip.dataset.open = 'false';
    if (tipTimer) { clearTimeout(tipTimer); tipTimer = null; }
  }

  function showTip() {
    var tip = $('#chatTip');
    if (!tip || tipDone || !tipAllowed() || messagesShowing()) return;
    tip.dataset.open = 'true';
    tipDone = true;
    tipTimer = setTimeout(hideTip, 15000);          /* says its piece and goes */
  }

  function setTipAllowed(on) {
    try {
      if (on) localStorage.removeItem(TIP_OFF);
      else localStorage.setItem(TIP_OFF, 'true');
    } catch (e) {}
    var pref = $('#chatTipPref');
    if (pref) pref.checked = !!on;
    if (!on) hideTip();
  }

  function bindChatTip() {
    var tip = $('#chatTip');
    if (!tip) return;
    var pref = $('#chatTipPref'), shut = $('#chatTipClose'), never = $('#chatTipNever');
    if (pref) {
      pref.checked = tipAllowed();
      pref.addEventListener('change', function () { setTipAllowed(pref.checked); });
    }
    if (shut) shut.addEventListener('click', hideTip);
    if (never) never.addEventListener('click', function () { setTipAllowed(false); });
    /* the tip is a way in as well as a notice */
    tip.addEventListener('click', function (e) {
      if (e.target.closest('#chatTipClose') || e.target.closest('#chatTipNever')) return;
      hideTip();
      openMessages();
    });
    setTimeout(showTip, 2600);
    /* a way to prove it is live from the console: JUDECH.tip() */
    window.JUDECH = window.JUDECH || {};
    window.JUDECH.tip = function () { tipDone = false; showTip(); };
  }

  function bindMessageDock() {
    $$('[data-open-messages]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        if (el.id === 'messageFab') toggleMessages();
        else openMessages();
      });
    });
    var min = $('#msgDockMin');
    if (min) min.addEventListener('click', function (e) {
      e.stopPropagation();
      messageState() === 'open' ? minMessages() : openMessages(false);
    });
    var shut = $('#msgDockClose');
    if (shut) shut.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMessages();
    });
    /* collapsed, the header bar is the way back in */
    var head = $('#msgDockHead');
    if (head) head.addEventListener('click', function () {
      if (messageState() === 'min') openMessages(false);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !messagesShowing()) return;
      if ($('.overlay[data-open="true"]')) return;      // a modal has first claim on Escape
      closeMessages();
    });
  }

  function sendContactMessage() {
    var title = $('#contactTitle').value.trim();
    var message = $('#contactMessage').value.trim();
    var msg = $('#contactMsg'), btn = $('#sendContact');
    msg.dataset.err = 'false';
    if (title.length < 3) { $('#contactTitle').focus(); msg.dataset.err = 'true'; msg.textContent = 'Add a short title.'; return; }
    if (message.length < 10) { $('#contactMessage').focus(); msg.dataset.err = 'true'; msg.textContent = 'Please tell me a little more about what you need.'; return; }
    if (!signedIn()) {
      try {
        localStorage.setItem(CONTACT_DRAFT, JSON.stringify({ title: title, message: message }));
        localStorage.setItem(CONTACT_RESUME, 'true');
      } catch (e) {}
      askSignIn(null, null);
      $('#authSub').textContent = 'Sign in with Google to send this message and read the reply.';
      return;
    }
    btn.disabled = true;
    msg.textContent = 'Sending…';
    B.sendMessage(title, message).then(function () {
      $('#contactTitle').value = '';
      $('#contactMessage').value = '';
      msg.dataset.err = 'false';
      msg.textContent = 'Message sent. Please wait for my response — I usually reply within a day.';
      activeThread = null;                       // the newest one becomes the open tab
      return loadContactMessages();
    }).catch(function (e) {
      msg.dataset.err = 'true';
      msg.textContent = e.message;
    }).then(function () { btn.disabled = false; });
  }

  /* ---------- payment ----------
     A buyer pays, uploads the receipt, and the package stays shut until the seller
     approves it. Supabase enforces the account boundary when configured; local mode
     keeps the older device-only approval-code flow described in the README. */
  var payMemory = {};                  // slot -> the list of purchases
  var activeBuy = {};                  // slot -> the purchase the overlay is on
  var NEW_BUY = '\u0000new';            // …or a fresh one that does not exist yet

  function buyKey(rec) { return String((rec && (rec.token || rec.reference)) || ''); }

  /* Anything bought before the page understood components: one payment and one
     signature per project, kept under the old keys. Read once, carried across. */
  function carriedOver(id) {
    var pay = null, terms = null, out = [];
    try { pay = JSON.parse(localStorage.getItem(accountStorageKey(PAY_KEY, id)) || 'null'); } catch (e) {}
    try { terms = JSON.parse(localStorage.getItem(accountStorageKey(KEY, id)) || 'null'); } catch (e) {}
    if (pay) {
      pay.scope = pay.scope || 'package';
      pay.itemIds = pay.itemIds || [];
      if (terms) pay.signed = terms;
      out.push(pay);
    } else if (terms) {
      out.push({ projectId: id, status: 'none', scope: 'package', itemIds: [], signed: terms,
                 accountId: terms.accountId || null });
    }
    return out;
  }

  function readBuys(id) {
    var slot = accountSlot(id);
    if (payMemory[slot]) return payMemory[slot];
    var list = null;
    try { list = JSON.parse(localStorage.getItem(accountStorageKey(BUYS_KEY, id)) || 'null'); }
    catch (e) { list = null; }
    if (!Array.isArray(list)) list = carriedOver(id);
    payMemory[slot] = list;
    return list;
  }

  function writeBuys(id, list) {
    var slot = accountSlot(id);
    payMemory[slot] = list;
    try { localStorage.setItem(accountStorageKey(BUYS_KEY, id), JSON.stringify(list)); }
    catch (e) {                                   // usually a screenshot blew the quota
      var slim = list.map(function (rec) {
        var c = {};
        for (var k in rec) if (k !== 'proof') c[k] = rec[k];
        if (rec.proof) c.proofDropped = true;
        return c;
      });
      payMemory[slot] = slim;
      try { localStorage.setItem(accountStorageKey(BUYS_KEY, id), JSON.stringify(slim)); } catch (e2) {}
    }
  }

  /* Every purchase of this project that belongs to whoever is looking. */
  function purchases(id) {
    var list = readBuys(id);
    if (B && B.enabled) {
      if (!me) return [];
      return list.filter(function (b) { return !b.accountId || b.accountId === me.id; });
    }
    return list;
  }

  function findBuy(id, key) {
    var list = purchases(id);
    for (var i = 0; i < list.length; i++) if (buyKey(list[i]) === key) return list[i];
    return null;
  }

  /* The purchase the payment overlay is working on: the one explicitly picked,
     otherwise whichever still needs attention, otherwise the newest. */
  function getPay(id) {
    var want = activeBuy[accountSlot(id)];
    if (want === NEW_BUY) return null;
    var list = purchases(id);
    if (!list.length) return null;
    if (want) {
      var picked = findBuy(id, want);
      if (picked) return picked;
    }
    for (var i = list.length - 1; i >= 0; i--) {
      if (list[i].status === 'pending' || list[i].status === 'rejected') return list[i];
    }
    return list[list.length - 1];
  }

  function setPay(id, rec) {
    if (B && B.enabled && me) rec.accountId = me.id;
    var list = readBuys(id).slice(), key = buyKey(rec), at = -1;
    for (var i = 0; i < list.length; i++) if (buyKey(list[i]) === key) at = i;
    if (at > -1) {
      if (rec.signed == null && list[at].signed) rec.signed = list[at].signed;
      list[at] = rec;
    } else list.push(rec);
    activeBuy[accountSlot(id)] = key;
    writeBuys(id, list);
  }

  function useBuy(id, rec) { activeBuy[accountSlot(id)] = rec ? buyKey(rec) : NEW_BUY; }

  function forgetPay(id) {
    var cur = getPay(id);
    if (!cur) return;
    var key = buyKey(cur);
    writeBuys(id, readBuys(id).filter(function (b) { return buyKey(b) !== key; }));
    delete activeBuy[accountSlot(id)];
  }

  function payApproved(id) {
    return purchases(id).some(function (b) { return b.status === 'approved'; });
  }

  /* ---------- who is entitled to what ---------- */
  function coversItem(buy, item) {
    if (!buy || !item) return false;
    if (buy.scope !== 'items') return true;             // the whole package
    return (buy.itemIds || []).indexOf(item.id) > -1;
  }

  function buyRank(buy) {
    if (buy.status === 'approved') return buy.signed ? 4 : 3;
    if (buy.status === 'pending') return 2;
    if (buy.status === 'rejected') return 1;
    return 0;
  }

  /* The purchase that got this buyer furthest towards this one item. */
  function buyFor(p, item) {
    var best = null;
    purchases(p.id).forEach(function (b) {
      if (!coversItem(b, item)) return;
      if (!best || buyRank(b) > buyRank(best)) best = b;
    });
    return best;
  }

  function itemOpen(p, item) {
    var b = buyFor(p, item);
    return !!b && b.status === 'approved' && !!b.signed && itemReleased(p, item);
  }

  function approvalCode(reference) {
    var str = PAYMENT.salt + '|' + String(reference || '').trim().toUpperCase().replace(/\s+/g, '');
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
    var out = h.toString(36).toUpperCase();
    while (out.length < 6) out = '0' + out;
    return out.slice(0, 6);
  }

  /* a decorative stand-in until a real QR image is set */
  function sampleQr() {
    var cells = 21, size = 210, u = size / cells, m = '', h = 7;
    function on(x, y) {                                    // stable pseudo-pattern
      h = ((h << 5) + h + x * 31 + y * 17) >>> 0;
      return (h % 100) > 52;
    }
    function finder(ox, oy) {
      return '<rect x="' + (ox * u) + '" y="' + (oy * u) + '" width="' + (7 * u) + '" height="' + (7 * u) + '" rx="' + u + '"/>' +
        '<rect x="' + ((ox + 1) * u) + '" y="' + ((oy + 1) * u) + '" width="' + (5 * u) + '" height="' + (5 * u) + '" rx="' + (u * .7) + '" fill="#fff"/>' +
        '<rect x="' + ((ox + 2) * u) + '" y="' + ((oy + 2) * u) + '" width="' + (3 * u) + '" height="' + (3 * u) + '" rx="' + (u * .4) + '"/>';
    }
    for (var y = 0; y < cells; y++) {
      for (var x = 0; x < cells; x++) {
        var inFinder = (x < 8 && y < 8) || (x > cells - 9 && y < 8) || (x < 8 && y > cells - 9);
        if (inFinder || !on(x, y)) continue;
        m += '<rect x="' + (x * u) + '" y="' + (y * u) + '" width="' + u + '" height="' + u + '" rx="' + (u * .22) + '"/>';
      }
    }
    return '<svg class="qr" viewBox="0 0 ' + size + ' ' + size + '" role="img" aria-label="Sample QR code">' +
      '<rect width="' + size + '" height="' + size + '" fill="#fff"/>' +
      '<g fill="#16211E">' + finder(0, 0) + finder(cells - 7, 0) + finder(0, cells - 7) + m + '</g>' +
      '<rect x="' + (size / 2 - 46) + '" y="' + (size / 2 - 13) + '" width="92" height="26" rx="13" fill="#fff" opacity=".92"/>' +
      '<text x="' + (size / 2) + '" y="' + (size / 2 + 4.5) + '" text-anchor="middle" ' +
      'font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#8B968F">SAMPLE QR</text></svg>';
  }

  /* ---------- the payment modal ---------- */
  var payOverlay = $('#payOverlay');
  var payFor = null;            // project the payment modal is showing
  var proofData = null;         // the receipt image being uploaded, as a data URL
  var proofName = '';

  function money(v) { return v ? esc(v) : '—'; }

  var B = window.Backend || { enabled: false };

  /* ---------- the signed-in buyer ----------
     Browsing stays open to everyone. Signing in is asked for at the moment
     someone opens a package, so their payment, their signed terms and their
     files all hang off one account. */
  var me = null;                                   // {id,email,name,avatar} or null
  var RESUME = 'judech.after-signin';

  function signedIn() { return !!(B.enabled && me); }

  /* The account sits in the bar as one chip — face and first name — and opens a
     small card holding the full address and the way out. A bare icon in a circle
     asked people to guess; a row that says “Sign out” does not. */
  function firstName(name) { return String(name || '').trim().split(/\s+/)[0] || 'Account'; }

  function faceFor(person) {
    return person.avatar
      ? '<img class="account-face" src="' + esc(person.avatar) + '" alt="">'
      : '<span class="account-face account-initials">' +
          esc(firstName(person.name).charAt(0).toUpperCase()) + '</span>';
  }

  function paintAuth() {
    var slot = $('#authSlot');
    if (!slot) return;
    if (!B.enabled) { slot.hidden = true; return; }
    slot.hidden = false;
    slot.innerHTML = me
      ? '<div class="account" data-open="false">' +
          '<button class="account-btn" id="accountBtn" type="button" aria-haspopup="menu" ' +
            'aria-expanded="false" aria-controls="accountMenu">' +
            faceFor(me) +
            '<span class="account-name">' + esc(firstName(me.name)) + '</span>' +
            svg('<path d="M6 9.5l6 6 6-6"/>', 'account-chev') +
          '</button>' +
          '<div class="account-menu" id="accountMenu" role="menu" hidden>' +
            '<div class="account-card">' + faceFor(me) +
              '<span><b>' + esc(me.name) + '</b><em>' + esc(me.email) + '</em></span>' +
            '</div>' +
            '<button class="account-item" id="signOutBtn" type="button" role="menuitem">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true">' + SIGN_OUT + '</svg>' +
              'Sign out' +
            '</button>' +
          '</div>' +
        '</div>'
      : '<button class="btn btn-sm btn-primary" id="signInBtn">Sign in</button>';

    var wrap = slot.querySelector('.account');
    var open = $('#accountBtn'), menu = $('#accountMenu');
    var shut = function () {
      if (!wrap) return;
      wrap.dataset.open = 'false';
      menu.hidden = true;
      open.setAttribute('aria-expanded', 'false');
    };
    if (open) {
      open.addEventListener('click', function (e) {
        e.stopPropagation();
        var showing = wrap.dataset.open === 'true';
        wrap.dataset.open = showing ? 'false' : 'true';
        menu.hidden = showing;
        open.setAttribute('aria-expanded', showing ? 'false' : 'true');
        if (!showing) $('#signOutBtn').focus();
      });
      document.addEventListener('click', function (e) {
        if (wrap && !wrap.contains(e.target)) shut();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && wrap && wrap.dataset.open === 'true') { shut(); open.focus(); }
      });
    }

    var out = $('#signOutBtn'), inn = $('#signInBtn');
    if (out) out.addEventListener('click', function () {
      out.disabled = true;
      out.textContent = 'Signing out…';
      stopPresence();
      var marked = B.recordPresence
        ? B.recordPresence('signout').catch(function () {})
        : Promise.resolve();
      marked.then(function () { return B.signOut(); })
        .then(function () { window.location.reload(); })
        .catch(function () { out.disabled = false; startPresence(); paintAuth(); });
    });
    if (inn) inn.addEventListener('click', function () { askSignIn(null, null); });
  }

  function askSignIn(projectId, item, action) {
    if (projectId) {
      try {
        localStorage.setItem(RESUME, JSON.stringify({
          p: projectId,
          i: item || null,
          a: action || (item ? 'item' : 'project')
        }));
      }
      catch (e) {}
    }
    var p = projectId && byId(projectId);
    $('#authSub').textContent = p
      ? 'Sign in with Google before viewing or availing ' + p.name + '.'
      : 'Use your Google account before viewing or availing a project.';
    $('#authMsg').textContent = '';
    $('#authMsg').dataset.err = 'false';
    openOverlay($('#authOverlay'));
  }

  function startGoogle() {
    var btn = $('#googleBtn');
    btn.disabled = true;
    $('#authMsg').dataset.err = 'false';
    $('#authMsg').textContent = 'Taking you to Google…';
    B.signInWithGoogle().catch(function (e) {
      btn.disabled = false;
      $('#authMsg').dataset.err = 'true';
      $('#authMsg').textContent = e.message;
    });
  }

  /* Came back from Google? Pick up where they left off. */
  function resumeAfterSignIn() {
    var raw;
    try { raw = localStorage.getItem(RESUME); localStorage.removeItem(RESUME); } catch (e) {}
    if (!raw) return;
    var want;
    try { want = JSON.parse(raw); } catch (e) { return; }
    if (!want || !want.p || !byId(want.p)) return;
    closeOverlay($('#authOverlay'));
    openProject(want.p);
    if (want.a === 'payment') setTimeout(function () { openPayment(want.p); }, 250);
    else if (want.i) setTimeout(function () { requestItem(want.i); }, 250);
  }

  var presenceTimer = null;
  function stopPresence() {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
  }
  function pingPresence() {
    if (!B.enabled || !me || !B.recordPresence || document.visibilityState === 'hidden') return;
    B.recordPresence('heartbeat').catch(function () {});
  }
  function startPresence() {
    stopPresence();
    pingPresence();
    presenceTimer = setInterval(pingPresence, 45000);
  }

  function loadMe() {
    if (!B.enabled || !B.user) { paintAuth(); paintContactAccount(); return Promise.resolve(null); }
    return B.user().then(function (u) {
      me = u;
      paintAuth();
      paintContactAccount();
      if (u) {
        startPresence();
        checkBlocked();
        resumeAfterSignIn();
        resumeContactAfterSignIn();
        loadContactMessages();
      } else stopPresence();
      return u;
    }).catch(function () { paintAuth(); paintContactAccount(); return null; });
  }

  var payTab = 'qr';            // 'qr' = scan and pay, 'code' = paid elsewhere, has a code
  var payPoll = null;           // timer that asks the server whether an approval landed

  function stopPoll() { if (payPoll) { clearInterval(payPoll); payPoll = null; } }

  /* What this payment is for. 'package' is the default and buys everything;
     'items' buys exactly the components ticked. */
  var payPick = { mode: 'package', items: {} };

  function pickItems() {
    return Object.keys(payPick.items).filter(function (k) { return payPick.items[k]; });
  }

  /* What this payment covers, decided in one place so the panel, the QR card,
     the amount box and what is actually sent to the server can never disagree.

     “The whole package” only means the whole package when the visitor is on the
     public page. On a private link it means the components in that quote — so
     the payment is recorded against exactly those and nothing else opens. */
  function payCoverage(p) {
    var shown = itemsForView(p), o = offerFor(p);

    if (payPick.mode === 'items') {
      var picked = pickItems();
      var rows = shown.filter(function (i) { return picked.indexOf(i.id) > -1; });
      var sum = 0, known = false;
      rows.forEach(function (i) {
        var price = itemPrice(p, i);
        if (price != null) { sum += price; known = true; }
      });
      return { scope: 'items', whole: false, rows: rows,
               ids: rows.map(function (i) { return i.id; }),
               total: known ? sum : null };
    }

    var quoted = !!(o && o.itemIds && o.itemIds.length);
    return {
      scope: quoted ? 'items' : 'package',
      whole: !quoted,
      rows: shown,
      ids: quoted ? shown.map(function (i) { return i.id; }) : [],
      total: packagePrice(p)
    };
  }

  function payTotal(p) { return payCoverage(p).total; }

  function openPayment(id, opts) {
    if (B.enabled && !signedIn()) { askSignIn(id, null, 'payment'); return; }
    opts = opts || {};
    var switched = payFor !== id;
    payFor = id;
    var p = byId(id);
    if (switched && !opts.items) payPick = { mode: 'package', items: {} };
    if (opts.buy) {
      useBuy(id, opts.buy);
    } else if (opts.items || opts.scope) {
      useBuy(id, null);                                  // start a fresh purchase
      payPick = { mode: opts.items ? 'items' : 'package', items: {} };
      (opts.items || []).forEach(function (k) { payPick.items[k] = true; });
      payTab = 'qr';
    } else {
      delete activeBuy[accountSlot(id)];                 // whatever still needs attention
    }
    $('#payTitle').innerHTML = 'Payment &mdash; ' + p.name;
    proofData = null; proofName = '';
    paintPayment();
    openOverlay(payOverlay);
    refreshStatus(id, true);
  }

  /* ---------- choosing what to buy ---------- */
  function scopePicker(p) {
    var items = itemsForView(p);
    var sellable = items.filter(function (i) { return itemPrice(p, i) != null; });
    if (!sellable.length) return '';        // nothing is priced on its own here
    var o = offerFor(p);
    var quoted = !!(o && o.itemIds && o.itemIds.length);
    var total = packagePrice(p);
    return '<div class="scope-picker">' +
      '<span class="scope-lbl">What are you paying for?</span>' +
      '<label class="scope-opt" data-on="' + (payPick.mode !== 'items') + '">' +
        '<input type="radio" name="payScope" value="package"' +
          (payPick.mode !== 'items' ? ' checked' : '') + '>' +
        '<span><b>' + (quoted ? 'Everything in your quote' : 'The whole package') +
          (total == null ? '' : ' &middot; ' + esc(fmtMoney(total, p.currency))) + '</b>' +
        '<em>' + (quoted
          ? 'The ' + items.length + ' component' + (items.length === 1 ? '' : 's') +
            ' listed below open once the terms are signed.'
          : 'Every component opens once the terms are signed.') + '</em></span></label>' +
      '<label class="scope-opt" data-on="' + (payPick.mode === 'items') + '">' +
        '<input type="radio" name="payScope" value="items"' +
          (payPick.mode === 'items' ? ' checked' : '') + '>' +
        '<span><b>Only the components I need</b>' +
        '<em>Pay for one part now and come back for the rest — same account, no second agreement fee.</em></span></label>' +
      '<div class="scope-items" id="scopeItems"' + (payPick.mode === 'items' ? '' : ' hidden') + '>' +
        items.map(function (i) {
          var price = itemPrice(p, i), owned = itemOpen(p, i);
          if (owned || price == null) delete payPick.items[i.id];   // cannot be bought again
          return '<label class="scope-item" data-owned="' + owned + '">' +
            '<input type="checkbox" data-buy-item="' + esc(i.id) + '"' +
              (payPick.items[i.id] && !owned ? ' checked' : '') +
              (owned || price == null ? ' disabled' : '') + '>' +
            '<span>' + esc(i.name) +
              (owned ? ' <em>already yours</em>'
                     : price == null ? ' <em>comes with the package</em>' : '') + '</span>' +
            '<b>' + (price == null ? '&mdash;' : esc(fmtMoney(price, p.currency))) + '</b></label>';
        }).join('') +
        '<div class="scope-total"><span>Total</span><b id="scopeTotal"></b></div>' +
      '</div>' +
    '</div>';
  }

  /* The exact thing being paid for, ready to print in three places: the panel
     above the form, the QR card, and the amount box. */
  /* The one-line answer to “paying for what?”, for the QR card. */
  function coverageLine(p) {
    var due = payCoverage(p);
    if (due.whole) {
      return 'the whole package — all ' + due.rows.length + ' component' +
        (due.rows.length === 1 ? '' : 's');
    }
    if (!due.rows.length) return 'nothing ticked yet';
    return due.rows.map(function (i) { return i.name; }).join(', ');
  }

  function dueHtml(p) {
    var due = payCoverage(p), o = offerFor(p);
    var amount = due.total == null ? null : fmtMoney(due.total, p.currency);
    var body;

    if (!due.rows.length) {
      body = '<p class="due-empty">Tick the components you are paying for below and the ' +
        'amount will work itself out.</p>';
    } else if (due.whole) {
      body = '<ul class="due-list"><li><span>The whole package &mdash; all ' + due.rows.length +
        ' component' + (due.rows.length === 1 ? '' : 's') + '</span><b>' +
        (amount || '&mdash;') + '</b></li></ul>';
    } else {
      body = '<ul class="due-list">' + due.rows.map(function (i) {
        var price = itemPrice(p, i);
        return '<li><span>' + esc(i.name) + '</span><b>' +
          (price == null ? '&mdash;' : esc(fmtMoney(price, p.currency))) + '</b></li>';
      }).join('') +
      (due.rows.length > 1 && amount
        ? '<li class="due-sum"><span>Together</span><b>' + esc(amount) + '</b></li>' : '') +
      '</ul>';
    }

    return '<span class="due-kicker">' +
        (o ? 'Your quote &middot; prepared for ' + esc(o.customerName) : 'You are paying for') +
      '</span>' + body +
      (amount
        ? '<p class="due-total">Send exactly <b>' + esc(amount) + '</b>' +
          (due.whole
            ? ' — every component opens once the terms are signed.'
            : ' — only ' + (due.rows.length === 1 ? 'this one opens' : 'these open') +
              '. Anything else in the package stays locked until it is paid for.') + '</p>'
        : '<p class="due-total">No price is set for this yet — message me and I will tell you ' +
          'the amount before you send anything.</p>');
  }

  function syncScope() {
    var p = byId(payFor);
    if (!p) return;
    var box = $('#scopeItems');
    if (box) box.hidden = payPick.mode !== 'items';
    $$('#payBody .scope-opt').forEach(function (l) {
      var input = l.querySelector('input');
      l.dataset.on = input ? String(input.checked) : 'false';
    });
    var total = payTotal(p);
    var totalEl = $('#scopeTotal');
    if (totalEl) totalEl.textContent = total == null ? '—' : fmtMoney(total, p.currency);
    var amount = $('#payAmount');
    if (amount && amount.dataset.touched !== 'true') {
      amount.value = total == null ? '' : fmtMoney(total, p.currency);
    }
    var dueBox = $('#payDue');
    if (dueBox) dueBox.innerHTML = dueHtml(p);
    var qrFor = $('#qrFor');
    if (qrFor) qrFor.textContent = coverageLine(p);
    var qrAmount = $('#qrAmount');
    if (qrAmount) qrAmount.textContent = total == null ? '—' : fmtMoney(total, p.currency);
  }

  function wireScope() {
    $$('#payBody input[name="payScope"]').forEach(function (el) {
      el.addEventListener('change', function () {
        payPick.mode = el.value === 'items' ? 'items' : 'package';
        syncScope();
      });
    });
    $$('#payBody [data-buy-item]').forEach(function (el) {
      el.addEventListener('change', function () {
        payPick.items[el.dataset.buyItem] = el.checked;
        syncScope();
      });
    });
    var amount = $('#payAmount');
    if (amount) amount.addEventListener('input', function () { amount.dataset.touched = 'true'; });
    syncScope();
  }

  /* Ask the server how a submitted payment is doing. Cheap, safe to call often. */
  function refreshStatus(id, quiet) {
    var rec = getPay(id);
    if (!B.enabled || !rec || !rec.token) return Promise.resolve(rec);   // approved ones too: a cancellation must reach the buyer
    return B.paymentStatus(rec.token).then(function (row) {
      if (!row) return rec;
      var changed = row.status !== rec.status || (row.review_note || null) !== (rec.note || null);
      rec.status = row.status;
      rec.note = row.review_note || null;
      if (row.status === 'approved') rec.approvedAt = row.reviewed_at || new Date().toISOString();
      if (row.status === 'rejected') rec.rejectedAt = row.reviewed_at || new Date().toISOString();
      setPay(id, rec);
      if (row.status === 'approved') refreshAccess(id);
      if (changed) {
        if (payFor === id && payOverlay.dataset.open === 'true') paintPayment();
        if (openProjectId === id) paintProject();
      } else if (!quiet && payFor === id) {
        $('#payMsg').dataset.err = 'false';
        $('#payMsg').textContent = 'Still waiting — I have not checked it yet. Checked ' +
          new Date().toLocaleTimeString() + '.';
      }
      return rec;
    }).catch(function (e) {
      if (!quiet) payFail('Could not check just now: ' + e.message);
      return rec;
    });
  }

  function qrCard(p) {
    return '<div class="qr-card">' +
      (PAYMENT.qr
        ? '<a class="qr-link" href="' + PAYMENT.qr + '" target="_blank" rel="noopener" ' +
          'title="Open the QR full size">' +
          '<span class="qr-shot"><img class="qr" src="' + PAYMENT.qr + '" ' +
          'alt="GCash QR code for ' + BRAND + '" style="object-position:' +
          (PAYMENT.qrFocus || '50% 50%') + ';transform:scale(' + (PAYMENT.qrZoom || 1) +
          ');transform-origin:' + (PAYMENT.qrFocus || '50% 50%') + '"></span></a>'
        : sampleQr()) +
      '<h4>' + esc(PAYMENT.wallet || 'Scan to pay') + '</h4>' +
      '<dl>' +
        (PAYMENT.accountName ? '<div><dt>Account</dt><dd>' + esc(PAYMENT.accountName) + '</dd></div>' : '') +
        (PAYMENT.accountNumber ? '<div><dt>Number</dt><dd>' + esc(PAYMENT.accountNumber) + '</dd></div>' : '') +
        '<div><dt>Project</dt><dd>' + p.name + '</dd></div>' +
        '<div><dt>Paying for</dt><dd id="qrFor">' + esc(coverageLine(p)) + '</dd></div>' +
        '<div class="qr-amount"><dt>Amount to send</dt><dd id="qrAmount">' +
          esc(fmtMoney(packagePrice(p), p.currency) || '—') + '</dd></div>' +
      '</dl>' +
      (PAYMENT.qr
        ? '<p class="qr-note">Paying on this phone? <a href="' + PAYMENT.qr + '" target="_blank" ' +
          'rel="noopener">Open the QR full size</a> to save or scan it.</p>'
        : '<p class="qr-note">Sample QR — replace it with your own in <code>PAYMENT.qr</code>.</p>') +
    '</div>';
  }

  function payForm() {
    return '<div class="pay-form">' +
      '<div class="row">' +
        '<div class="field"><label for="payName">Sender name</label>' +
          '<input id="payName" placeholder="Name on the receipt" value="' +
            (me ? esc(me.name) : '') + '"></div>' +
        '<div class="field"><label for="payMethod">Paid through</label><select id="payMethod">' +
          PAYMENT.methods.map(function (m) { return '<option>' + esc(m) + '</option>'; }).join('') +
        '</select></div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="payRef">Reference number</label>' +
          '<input id="payRef" placeholder="e.g. 1234 567 890123"></div>' +
        '<div class="field"><label for="payAmount">Amount sent</label>' +
          '<input id="payAmount" placeholder="₱0.00"></div>' +
      '</div>' +
      '<div class="row">' +
        '<div class="field"><label for="payDate">Date paid</label>' +
          '<input id="payDate" type="date" value="' + today() + '"></div>' +
        '<div class="field"><label for="payContact">How I can reach you (optional)</label>' +
          '<input id="payContact" placeholder="Messenger name, email or number" value="' +
            (me ? esc(me.email) : '') + '"></div>' +
      '</div>' +
      '<div class="field"><label>Screenshot of the receipt</label>' +
        '<label class="drop" id="payDrop">' +
          '<input type="file" id="payFile" accept="image/*">' + svg(ICON.up) +
          '<b>Attach the receipt</b><span>PNG or JPG — tap to choose, or drop it here</span>' +
        '</label>' +
        '<div id="proofBox"></div>' +
        '<span class="drop-note">Not on this device right now? Send the reference without it ' +
          '&mdash; you can add the screenshot straight after, from the same card.</span>' +
      '</div>' +
    '</div>';
  }

  function codeForm(p) {
    return '<div class="status-card" data-state="info">' +
        '<span class="ico">' + svg(ICON.chat) + '</span>' +
        '<span><b>Already paid on Facebook, Shopee, Messenger or in cash?</b>' +
        '<p>Then do not pay again. Send me your proof there and I will reply with an ' +
        '<b>access code</b> for ' + p.name + '. Type it below and it opens straight away — ' +
        'a code made for certain parts of the package opens exactly those, and the rest stays ' +
        'here at its own price.</p></span>' +
      '</div>' +
      '<div class="pay-form" style="margin-top:14px">' +
        '<div class="row">' +
          '<div class="field"><label for="payElseName">Your name</label>' +
            '<input id="payElseName" placeholder="As you gave it to me" value="' +
            (me ? esc(me.name) : '') + '"></div>' +
          '<div class="field"><label for="payElseCode">Access code</label>' +
            '<input id="payElseCode" class="code-input" placeholder="JD-XXXX-XXXX" ' +
            'autocomplete="off" spellcheck="false"></div>' +
        '</div>' +
      '</div>' +
      (contactLink() ? '<div class="pay-actions">' + contactButton('Message ' + BRAND + ' for a code') + '</div>' : '');
  }

  function paintPayment() {
    var p = byId(payFor), rec = getPay(payFor), body = '', mode;
    stopPoll();

    if (!rec || rec.status === 'none') {
      mode = 'form';
      body =
        (me ? '<div class="signed-hint">' +
              (me.avatar ? '<img src="' + esc(me.avatar) + '" alt="">' : '') +
              '<span>Signed in as <b>' + esc(me.name) + '</b> &middot; ' + esc(me.email) +
              '. This payment is recorded against that account.</span></div>' : '') +
        '<div class="pay-switch" role="tablist">' +
          '<button type="button" class="pay-tab" data-pay="qr" aria-pressed="' + (payTab === 'qr') + '">' +
            svg(ICON.card) + 'Pay now with the QR</button>' +
          '<button type="button" class="pay-tab" data-pay="code" aria-pressed="' + (payTab === 'code') + '">' +
            svg(ICON.tick) + 'I already paid elsewhere</button>' +
        '</div>' +
        (payTab === 'qr'
          ? '<p class="intro">' + esc(PAYMENT.note) + ' Once I have checked it, this page unlocks — ' +
            'the terms first, then the files.</p>' +
            '<div class="pay-due" id="payDue">' + dueHtml(p) + '</div>' +
            scopePicker(p) +
            '<div class="pay-grid">' + qrCard(p) + payForm() + '</div>'
          : codeForm(p));
    } else if (rec.status === 'pending') {
      mode = 'pending';
      body =
        '<div class="status-card" data-state="pending">' +
          '<span class="ico">' + svg(ICON.clock) + '</span>' +
          '<span><b>Waiting for ' + BRAND + ' to check this</b>' +
          (B.enabled
            ? '<p>I have your reference' + (rec.proof || rec.receiptPath ? ' and your receipt' : '') +
              '. I look at these myself; the moment I approve it this page unlocks — it checks ' +
              'by itself while it is open.</p>'
            : '<p>Your payment details are saved on this device. Send them to me and I will ' +
              'reply with your approval code — then the terms and the files open.</p>') +
          '</span>' +
        '</div>' +
        paySummary(rec) +
        receiptBox(rec) +
        '<div class="pay-actions">' + contactButton('Send it to ' + BRAND) +
          '<button class="btn btn-sm" id="payCopy">Copy the details</button>' +
          (rec.proof ? '<button class="btn btn-sm btn-ghost" id="payProofDl">Download the receipt</button>' : '') +
          (B.enabled ? '' : '<button class="btn btn-sm btn-ghost" id="payRedo">Fix the details</button>') +
        '</div>' +
        (B.enabled ? '' :
          '<div class="unlock">' +
            '<h4>Got your approval code?</h4>' +
            '<p>Type the six characters I sent you.</p>' +
            '<div class="unlock-row"><input id="unlockCode" maxlength="6" placeholder="XXXXXX" ' +
              'autocomplete="off" spellcheck="false"></div>' +
          '</div>');
    } else if (rec.status === 'rejected') {
      mode = 'rejected';
      body =
        '<div class="status-card" data-state="rejected">' +
          '<span class="ico">' + svg(ICON.help) + '</span>' +
          '<span><b>I could not approve this one</b>' +
          '<p>' + (rec.note ? esc(rec.note) : 'The reference or the receipt did not match a payment I received.') +
          ' Check the details and send it again, or message me and we will sort it out.</p></span>' +
        '</div>' +
        paySummary(rec) +
        receiptBox(rec) +
        '<div class="pay-actions">' + contactButton('Message ' + BRAND) + '</div>';
    } else {
      mode = 'approved';
      body =
        '<div class="status-card" data-state="approved">' +
          '<span class="ico">' + svg(ICON.tick) + '</span>' +
          '<span><b>' + (rec.settled ? 'Settled via ' + esc(rec.method) : 'Payment approved') + '</b><p>' +
          (rec.settled ? 'Your access code was accepted' : 'Approved') + ' ' +
          new Date(rec.approvedAt).toLocaleString() + '. You can read the terms and open the ' +
          'package now — this stays unlocked on this device.</p></span>' +
        '</div>' + paySummary(rec);
    }

    $('#payBody').innerHTML = body;
    payOverlay.dataset.mode = mode;
    $('#paySub').innerHTML = mode === 'form'
      ? (payTab === 'qr' ? 'Step 1 of 3 &middot; pay, then send me the receipt'
                         : 'Step 1 of 3 &middot; unlock with the code I gave you')
      : mode === 'pending' ? 'Step 1 of 3 &middot; waiting for approval'
      : mode === 'rejected' ? 'Step 1 of 3 &middot; not approved'
      : 'Step 1 of 3 &middot; done — the terms are next';
    var act = $('#payAction');
    act.disabled = false;
    act.textContent = mode === 'form' ? (payTab === 'qr' ? 'Submit for approval' : 'Unlock with my code')
      : mode === 'pending' ? (B.enabled ? 'Check now' : 'Unlock with code')
      : mode === 'rejected' ? 'Send it again'
      : 'Continue to the terms';
    act.hidden = false;
    $('#payMsg').dataset.err = 'false';
    $('#payMsg').textContent = mode === 'form'
      ? (payTab === 'qr' ? 'Nothing opens until the payment is checked.' : 'Codes come from me after I see your proof.')
      : mode === 'pending' ? (B.enabled ? 'Usually within the day.' : 'I will send the code as soon as I see the payment.')
      : mode === 'rejected' ? 'Nothing was charged by this page — only what you sent.'
      : 'Payment done — the terms are next.';

    if (mode === 'form') {
      $$('#payBody .pay-tab').forEach(function (t) {
        t.addEventListener('click', function () { payTab = t.dataset.pay; paintPayment(); });
      });
      if (payTab === 'qr') { wirePayForm(); wireScope(); }
      else $('#payElseCode').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); payActionClick(); }
      });
    }
    if (mode === 'pending' || mode === 'rejected') wireReceiptBox(rec);
    if (mode === 'pending') {
      wirePending(rec);
      if (B.enabled) payPoll = setInterval(function () { refreshStatus(payFor, true); }, 12000);
    }
  }

  function buyCoverage(rec) {
    if (!rec || rec.scope !== 'items') return 'The whole package';
    var p = byId(rec.projectId), names = [];
    (rec.itemIds || []).forEach(function (id) {
      var hit = p ? packageItemsFor(p).filter(function (i) { return i.id === id; })[0] : null;
      names.push(hit ? hit.name : id);
    });
    return names.length ? names.join(', ') : 'Selected components';
  }

  /* Attaching the receipt after the fact. The same card the buyer is already
     looking at, so there is nowhere else to go and nothing to remember. */
  function receiptBox(rec) {
    if (!B.enabled) return '';
    var has = !!(rec.proof || rec.receiptPath);
    return '<div class="receipt-box" data-has="' + has + '" id="receiptBox">' +
      (has
        ? '<div class="receipt-have">' + svg(ICON.tick) +
            '<span><b>Receipt attached</b>' +
            (rec.receiptAt ? '<em>added ' + esc(new Date(rec.receiptAt).toLocaleString()) + '</em>' : '') +
            '</span>' +
            (rec.proof ? '<img src="' + rec.proof + '" alt="Your receipt">' : '') +
          '</div>'
        : '<div class="receipt-none">' + svg(ICON.up) +
            '<span><b>No receipt yet</b>' +
            '<em>I can check a payment faster with the screenshot. Add it whenever you have it ' +
            '&mdash; this card is waiting.</em></span>' +
          '</div>') +
      '<label class="btn btn-sm ' + (has ? 'btn-ghost' : 'btn-primary') + ' receipt-pick">' +
        (has ? 'Replace the receipt' : 'Attach the receipt now') +
        '<input type="file" id="receiptFile" accept="image/*">' +
      '</label>' +
      '<span class="msg" id="receiptMsg"></span>' +
    '</div>';
  }

  function wireReceiptBox(rec) {
    var input = $('#receiptFile');
    if (!input) return;
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      input.value = '';
      if (!f) return;
      var msg = $('#receiptMsg');
      msg.dataset.err = 'false';
      if (!/^image\//.test(f.type || '')) { msg.dataset.err = 'true'; msg.textContent = 'That is not an image.'; return; }
      msg.textContent = 'Reading the image…';
      shrinkImage(f, function (dataUrl, err) {
        if (err) { msg.dataset.err = 'true'; msg.textContent = err; return; }
        if (!rec.token) {                       /* local mode: keep it on the device */
          rec.proof = dataUrl;
          rec.receiptAt = new Date().toISOString();
          setPay(payFor, rec);
          paintPayment();
          return;
        }
        msg.textContent = 'Sending it to ' + BRAND + '…';
        B.attachReceipt(rec.token, dataUrl).then(function (row) {
          rec.proof = dataUrl;
          rec.receiptPath = row && row.receipt_path;
          rec.receiptAt = (row && row.receipt_added_at) || new Date().toISOString();
          setPay(payFor, rec);
          paintPayment();
          $('#payMsg').dataset.err = 'false';
          $('#payMsg').textContent = 'Receipt attached — I will see it with your reference.';
        }).catch(function (e) {
          msg.dataset.err = 'true';
          msg.textContent = e.message;
        });
      });
    });
  }

  /* one downscale-and-encode used by both the form and the after-the-fact box */
  function shrinkImage(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 1000 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = function () { done(null, 'That image could not be read.'); };
      img.src = reader.result;
    };
    reader.onerror = function () { done(null, 'That file could not be read.'); };
    reader.readAsDataURL(file);
  }

  function paySummary(rec) {
    return '<div class="pay-summary">' +
      '<div><dt>Project</dt><dd>' + esc(rec.project) + '</dd></div>' +
      '<div><dt>Paying for</dt><dd>' + esc(buyCoverage(rec)) + '</dd></div>' +
      '<div><dt>' + (rec.settled ? 'Name' : 'Sender') + '</dt><dd>' + esc(rec.name) + '</dd></div>' +
      '<div><dt>' + (rec.settled ? 'Settled through' : 'Paid through') + '</dt><dd>' + esc(rec.method) + '</dd></div>' +
      '<div><dt>' + (rec.settled ? 'Access code' : 'Reference') + '</dt><dd>' + esc(rec.reference) + '</dd></div>' +
      (rec.settled ? '' : '<div><dt>Amount</dt><dd>' + money(rec.amount) + '</dd></div>') +
      (rec.settled ? '' : '<div><dt>Date paid</dt><dd>' + pretty(rec.date) + '</dd></div>') +
      '<div><dt>' + (rec.settled ? 'Unlocked' : 'Submitted') + '</dt><dd>' + new Date(rec.submittedAt).toLocaleString() + '</dd></div>' +
      (rec.proof
        ? '<div><dt>Receipt</dt><dd><img src="' + rec.proof + '" alt="Receipt"></dd></div>'
        : rec.proofDropped
          ? '<div><dt>Receipt</dt><dd>too large to keep here — send it to me directly</dd></div>'
          : rec.receiptPath
            ? '<div><dt>Receipt</dt><dd>attached and sent</dd></div>'
            : '<div><dt>Receipt</dt><dd>not attached yet</dd></div>') +
      '</div>';
  }

  function wirePayForm() {
    var drop = $('#payDrop'), file = $('#payFile');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.dataset.over = 'true'; });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function () { drop.dataset.over = 'false'; });
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) takeProof(e.dataTransfer.files[0]);
    });
    file.addEventListener('change', function () { if (file.files[0]) takeProof(file.files[0]); });
    if (proofData) showProof();
  }

  function takeProof(f) {
    if (!/^image\//.test(f.type)) { payFail('That file is not an image.'); return; }
    proofName = f.name;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1000, w = img.width, h = img.height;
        if (w > max || h > max) { var k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        proofData = c.toDataURL('image/jpeg', 0.72);
        showProof();
        $('#payMsg').dataset.err = 'false';
        $('#payMsg').textContent = 'Receipt attached. Check the details, then submit.';
      };
      img.onerror = function () { payFail('That image could not be read.'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }

  function showProof() {
    $('#proofBox').innerHTML = '<div class="proof"><img src="' + proofData + '" alt="Receipt preview">' +
      '<div class="drop-name">' + esc(proofName || 'receipt') +
      '<button type="button" id="proofRemove">remove</button></div></div>';
    $('#payDrop').hidden = true;
    $('#proofRemove').addEventListener('click', function () {
      proofData = null; proofName = '';
      $('#proofBox').innerHTML = '';
      $('#payDrop').hidden = false;
    });
  }

  function wirePending(rec) {
    $('#payCopy').addEventListener('click', function () {
      var text = [
        'JUDECH — payment for ' + rec.project,
        'Sender: ' + rec.name,
        'Paid through: ' + rec.method,
        'Reference: ' + rec.reference,
        'Amount: ' + (rec.amount || '—'),
        'Date paid: ' + pretty(rec.date),
        'Submitted: ' + new Date(rec.submittedAt).toLocaleString()
      ].join('\n');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          $('#payMsg').textContent = 'Details copied — paste them to me with the receipt.';
        });
      } else {
        window.prompt('Copy these details:', text);
      }
    });
    $('#payProofDl').addEventListener('click', function () {
      if (!rec.proof) { payFail('No receipt is stored here — send yours directly.'); return; }
      var a = document.createElement('a');
      a.href = rec.proof;
      a.download = 'JUDECH-' + rec.projectId + '-receipt.jpg';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    });
    var redo = $('#payRedo');
    if (redo) redo.addEventListener('click', function () {
      forgetPay(payFor);
      proofData = rec.proof || null; proofName = 'receipt';
      paintPayment();
    });
    var code = $('#unlockCode');
    if (code) code.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); payActionClick(); }
    });
  }

  function payFail(msg) {
    $('#payMsg').dataset.err = 'true';
    $('#payMsg').textContent = msg;
  }

  function busy(on, text) {
    var act = $('#payAction');
    act.disabled = !!on;
    if (text) { $('#payMsg').dataset.err = 'false'; $('#payMsg').textContent = text; }
  }

  /* ---- scan-and-pay: the buyer submits the receipt ---- */
  function submitPayment() {
    var p = byId(payFor);
    var name = $('#payName').value.trim();
    var ref = $('#payRef').value.trim();
    var amount = $('#payAmount').value.trim();
    var date = $('#payDate').value;
    var method = $('#payMethod').value;
    var contact = $('#payContact').value.trim();
    if (name.length < 2) { $('#payName').focus(); return payFail('Whose name is on the receipt?'); }
    if (ref.length < 4) { $('#payRef').focus(); return payFail('The reference number is too short.'); }
    if (!amount) { $('#payAmount').focus(); return payFail('How much did you send?'); }
    if (!date) { $('#payDate').focus(); return payFail('When did you pay?'); }
    /* the receipt is not compulsory here — someone who has paid but has no
       screenshot to hand can send the reference now and add the image after,
       from the very same card. A payment with no proof at all just waits
       longer, and the pending card says so. */

    var cover = payCoverage(p);
    var scope = cover.scope, itemIds = cover.ids;
    if (scope === 'items' && !itemIds.length) {
      return payFail('Tick the components this payment is for, or choose the whole package.');
    }

    var due = payTotal(p);
    var sent = parseFloat(String(amount).replace(/[^0-9.]/g, ''));
    if (due != null && !isNaN(sent) && Math.abs(sent - due) > 0.5) {
      if (!window.confirm('You typed ' + fmtMoney(sent, p.currency) + ', but what you ticked ' +
          'comes to ' + fmtMoney(due, p.currency) + '.\n\nSend it anyway? I check every payment ' +
          'against what actually arrived, so a short one will come back to you.')) return;
    }

    var base = {
      projectId: p.id, project: p.name,
      name: name, reference: ref, amount: amount, date: date, method: method, contact: contact,
      proof: proofData, status: 'pending', submittedAt: new Date().toISOString(),
      scope: scope, itemIds: itemIds,
      shareToken: offerFor(p) ? offer.token : null      // which quote this answers
    };

    if (!B.enabled) {                       // local mode: kept on this device only
      setPay(payFor, base);
      proofData = null; proofName = '';
      paintPayment();
      if (openProjectId === p.id) paintProject();
      return;
    }

    var shot = proofData;                    /* may be nothing: the receipt can follow */
    busy(true, shot ? 'Uploading the receipt…' : 'Sending it to ' + BRAND + '…');
    (shot ? B.uploadReceipt(shot) : Promise.resolve(null)).then(function (path) {
      busy(true, 'Sending it to ' + BRAND + '…');
      base.receiptPath = path;
      if (path) base.receiptAt = new Date().toISOString();
      return B.submitPayment({
        projectId: p.id, name: name, method: method, reference: ref,
        amount: amount, paidOn: date, receiptPath: path, contact: contact,
        scope: scope, itemIds: itemIds, shareToken: base.shareToken
      });
    }).then(function (row) {
      if (!row || !row.claim_token) throw new Error('The server did not return a receipt for this submission.');
      base.token = row.claim_token;
      base.paymentId = row.payment_id;
      base.status = row.status || 'pending';
      setPay(payFor, base);
      proofData = null; proofName = '';
      paintPayment();
      if (openProjectId === p.id) paintProject();
    }).catch(function (e) {
      busy(false);
      var m = e.message || '';
      if (/duplicate key|payments_reference_unique/i.test(m)) m = 'That reference number was already submitted for this project. If it was you, message me and I will check it.';
      payFail(m);
    });
  }

  /* ---- paid elsewhere: the buyer redeems an access code ---- */
  function redeemCode() {
    var p = byId(payFor);
    var name = $('#payElseName').value.trim();
    var code = $('#payElseCode').value.trim();
    if (name.length < 2) { $('#payElseName').focus(); return payFail('Your name, please.'); }
    if (code.replace(/[^A-Za-z0-9]/g, '').length < 6) { $('#payElseCode').focus(); return payFail('That does not look like an access code.'); }

    var now = new Date().toISOString();
    var base = {
      projectId: p.id, project: p.name, name: name, reference: code.toUpperCase(),
      settled: true, date: today(), submittedAt: now, approvedAt: now, status: 'approved',
      scope: 'package', itemIds: []            // the code itself decides; the server answers
    };

    if (!B.enabled) {                       // local mode: one shared code per project
      if (code.toUpperCase() !== approvalCode('ELSEWHERE-' + p.id)) {
        $('#payElseCode').focus();
        return payFail('That code does not match. Ask me for the right one.');
      }
      base.method = 'Settled elsewhere';
      setPay(payFor, base);
      refreshAccess(p.id);
      paintPayment();
      if (openProjectId === p.id) paintProject();
      return;
    }

    busy(true, 'Checking the code…');
    B.redeemCode(code, name).then(function (row) {
      if (!row || !row.claim_token) throw new Error('The server did not accept that code.');
      base.token = row.claim_token;
      base.paymentId = row.payment_id;
      base.status = row.status || 'approved';
      base.method = row.channel || 'Settled elsewhere';
      setPay(payFor, base);
      paintPayment();
      if (openProjectId === p.id) paintProject();
    }).catch(function (e) {
      busy(false);
      $('#payElseCode').focus();
      payFail(e.message);
    });
  }

  /* ---- local mode only: the six-character approval code ---- */
  function tryUnlock() {
    var rec = getPay(payFor);
    var given = ($('#unlockCode').value || '').trim().toUpperCase();
    if (!given) { $('#unlockCode').focus(); return payFail('Type the code I sent you.'); }
    if (given !== approvalCode(rec.reference)) {
      $('#unlockCode').focus();
      return payFail('That code does not match this reference number.');
    }
    rec.status = 'approved';
    rec.approvedAt = new Date().toISOString();
    setPay(payFor, rec);
    paintPayment();
    if (openProjectId === payFor) paintProject();
  }

  function payActionClick() {
    if (B.enabled && !signedIn()) {
      stopPoll();
      closeOverlay(payOverlay);
      askSignIn(payFor, null, 'payment');
      return;
    }
    var mode = payOverlay.dataset.mode;
    if (mode === 'form') return payTab === 'code' ? redeemCode() : submitPayment();
    if (mode === 'pending') {
      if (!B.enabled) return tryUnlock();
      busy(true, 'Checking…');
      return refreshStatus(payFor, false).then(function () { busy(false); });
    }
    if (mode === 'rejected') {
      var old = getPay(payFor);
      forgetPay(payFor);
      useBuy(payFor, null);                    // a clean form, not an older purchase
      if (old && old.scope === 'items') {
        payPick = { mode: 'items', items: {} };
        (old.itemIds || []).forEach(function (k) { payPick.items[k] = true; });
      }
      proofData = old && old.proof ? old.proof : null; proofName = 'receipt';
      payTab = 'qr';
      paintPayment();
      return;
    }
    var id = payFor;
    stopPoll();
    closeOverlay(payOverlay);
    var cur = getPay(id);
    if (cur && !cur.signed) { openTerms(id, false, buyKey(cur)); return; }
    var next = pendingItem; pendingItem = null;
    if (next) openPackageItem(byId(id), next);
  }

  /* ---------- the project modal ---------- */
  function openProject(id) {
    var p = byId(id);
    if (!p) return;
    if (B.enabled && !signedIn()) { askSignIn(id, null, 'project'); return; }
    openProjectId = id;
    refreshStatus(id, true);
    refreshAccess(id);
    $('#projTitle').innerHTML = p.name;
    var bits = [p.tagline, p.audience, KIND_LABEL[p.kind]].filter(function (b, i, all) {
      return b && all.indexOf(b) === i;      // drop blanks and repeats
    });
    $('#projTagline').innerHTML = bits.join(' &middot; ');
    paintProject();
    openOverlay(projectOverlay);
  }

  function steps(payState, signed, pay) {
    var rows = [
      ['1', 'Payment', payState === 'approved' ? (pay && pay.settled ? 'Settled via ' + esc(pay.method) : 'Approved')
        : payState === 'pending' ? 'Waiting for approval'
        : payState === 'rejected' ? 'Not approved — tap to see why' : 'Not sent yet',
        payState === 'approved' ? 'done' : 'now'],
      ['2', 'Terms', signed ? 'Signed' : 'Not signed yet',
        signed ? 'done' : (payState === 'approved' ? 'now' : 'todo')],
      ['3', 'The files', payState === 'approved' && signed ? 'Open' : 'Locked',
        payState === 'approved' && signed ? 'done' : 'todo']
    ];
    return '<div class="steps-row">' + rows.map(function (r) {
      return '<div class="step-chip" data-state="' + r[3] + '">' +
        '<span class="n">' + r[0] + '</span>' +
        '<span><b>' + r[1] + '</b><span>' + r[2] + '</span></span></div>';
    }).join('') + '</div>';
  }

  function projectFaqs(p) {
    var faqs = Array.isArray(p.faqs) ? p.faqs.filter(function (faq) {
      return faq && (faq.question || faq[0]) && (faq.answer || faq[1]);
    }) : [];
    if (!faqs.length) return '';
    return '<section class="project-faq" aria-labelledby="projectFaqTitle">' +
      '<div class="pkg-title"><h3 id="projectFaqTitle">Frequently asked questions</h3></div>' +
      '<div class="project-faq-list">' + faqs.map(function (faq) {
        var question = Array.isArray(faq) ? faq[0] : faq.question;
        var answer = Array.isArray(faq) ? faq[1] : faq.answer;
        return '<details class="project-faq-item"><summary>' + esc(question) +
          '</summary><p>' + esc(answer) + '</p></details>';
      }).join('') + '</div></section>';
  }

  /* Where one item stands for this buyer, in the order the page cares about. */
  var ITEM_STATE_TEXT = {
    open:    'Open it &rarr;',
    held:    'Not released yet',
    sign:    'Sign the terms to open',
    pending: 'Payment being checked',
    buy:     'Locked'
  };

  function itemState(p, item) {
    if (itemOpen(p, item)) return 'open';
    var b = buyFor(p, item);
    if (b && b.status === 'approved' && b.signed) return 'held';
    if (b && b.status === 'approved') return 'sign';
    if (b && b.status === 'pending') return 'pending';
    return 'buy';
  }

  function itemStateText(p, item, state) {
    if (state !== 'buy') return ITEM_STATE_TEXT[state];
    var price = itemPrice(p, item);
    return price == null ? ITEM_STATE_TEXT.buy
      : esc(fmtMoney(price, p.currency)) + ' &middot; get this one';
  }

  /* The line a private link puts at the top of the project. */
  function offerBanner(p) {
    var o = offerFor(p);
    if (!o) return '';
    return '<div class="offer-banner">' + svg(ICON.tick) +
      '<span><b>' + esc(o.headline || 'Prepared for ' + o.customerName) + '</b>' +
      '<p>' + (o.note ? esc(o.note) + ' ' : '') +
      'This view was put together for you: the components below, at the prices quoted. ' +
      'The rest of the catalog is unchanged.</p></span></div>';
  }

  /* What it costs to take the lot — the offer's price when there is one. */
  function buyBar(p, items, openCount) {
    if (!items.length || openCount === items.length) return '';
    var o = offerFor(p);
    var total = packagePrice(p);
    var sellable = items.filter(function (i) { return itemPrice(p, i) != null; }).length;
    var label = o && o.itemIds && o.itemIds.length ? 'Take the whole selection' : 'Buy the whole package';
    return '<div class="buy-bar">' +
      '<div class="buy-bar-main">' +
        '<span class="kicker">' + (o ? 'Your quote' : 'The whole package') + '</span>' +
        '<b>' + (total == null ? 'Ask me for a price' : esc(fmtMoney(total, p.currency))) + '</b>' +
        '<p>Everything listed below opens once the payment is approved and the terms are signed.</p>' +
      '</div>' +
      '<button class="btn btn-primary" data-buy-package>' + label + '</button>' +
      (sellable
        ? '<p class="buy-bar-note">Only need one part right now? Tap that component below and ' +
          'pay for it on its own — the rest stays here for whenever you want it.</p>'
        : '') +
    '</div>';
  }

  /* A buyer's own running account for this project: what each payment covered,
     where it stands, and what is still unpaid. */
  function purchaseLedger(p, items) {
    var list = purchases(p.id).filter(function (b) { return b.status && b.status !== 'none'; });
    var owed = items.filter(function (i) {
      return itemState(p, i) === 'buy' && itemPrice(p, i) != null;
    });
    if (!list.length && !owed.length) return '';

    var rows = list.slice().reverse().map(function (b) {
      var state = b.status === 'approved' ? (b.signed ? 'done' : 'sign') : b.status;
      var label = b.status === 'approved'
        ? (b.signed ? 'Paid &amp; signed' : 'Paid — terms not signed yet')
        : b.status === 'pending' ? 'Waiting for approval'
        : 'Not approved';
      return '<li data-state="' + state + '">' +
        '<span class="led-what"><b>' + esc(buyCoverage(b)) + '</b>' +
          '<em>' + esc(b.settled ? 'Access code ' + b.reference : 'Ref ' + b.reference) +
          ' &middot; ' + new Date(b.submittedAt).toLocaleDateString() + '</em></span>' +
        '<span class="led-amt">' + (b.amount ? esc(String(b.amount)) : '&mdash;') + '</span>' +
        '<span class="led-state">' + label + '</span>' +
      '</li>';
    });

    var owedTotal = 0;
    owed.forEach(function (i) { owedTotal += itemPrice(p, i); });

    return '<div class="ledger">' +
      '<div class="ledger-head"><b>Your account for this project</b>' +
        '<span class="muted">' + rows.length + ' payment' + (rows.length === 1 ? '' : 's') + '</span></div>' +
      (rows.length ? '<ul class="ledger-list">' + rows.join('') + '</ul>' : '') +
      (owed.length
        ? '<p class="ledger-owed">Still unpaid: ' +
            owed.map(function (i) { return esc(i.name); }).join(', ') +
            ' &mdash; <b>' + esc(fmtMoney(owedTotal, p.currency)) + '</b> if you take them all.</p>'
        : '<p class="ledger-owed" data-clear="true">Everything listed here is paid for.</p>') +
    '</div>';
  }

  function paintProject() {
    var p = byId(openProjectId);
    if (!p) return;
    var html = '';
    var packageItems = itemsForView(p);

    if (p.imageUrl) {
      html += '<button type="button" class="project-detail-cover" data-view-cover ' +
        'aria-label="View the whole ' + esc(p.name) + ' image">' +
        '<img src="' + esc(p.imageUrl) + '" alt="' + esc(p.name) + ' project preview" style="' +
          coverStyle(p) + '">' +
        '<span class="cover-zoom">' + svg(ICON.zoom) + 'See the whole image</span>' +
      '</button>';
    }
    html += offerBanner(p);
    html += '<p class="intro">' + (p.intro || p.blurb) + '</p>';
    html += mediaButtons(p);
    html += rightsNote(p.rights, p.name);

    var pay = getPay(p.id);
    var rec = saved(p.id), unlocked = !!(pay && pay.signed);

    if (p.status === 'ready') {
      if (rec) {
        html += '<div class="receipt" data-shown="true">' +
          svg(ICON.tick) +
          '<span>Terms signed by <b>' + esc(rec.buyer) + '</b> &middot; ' + pretty(rec.buyerDate) + '</span>' +
          '<span class="spacer"></span>' +
          '<button class="btn btn-sm btn-ghost" data-view-agreement>View agreement</button>' +
          '<button class="btn btn-sm btn-ghost" data-reset-agreement>Reset</button>' +
          '</div>';
      }
      var payState = pay ? pay.status : 'none';
      var states = packageItems.map(function (item) { return itemState(p, item); });
      var openCount = states.filter(function (st) { return st === 'open'; }).length;
      var allOpen = packageItems.length > 0 && openCount === packageItems.length;
      html += steps(payState, unlocked, pay);
      html += buyBar(p, packageItems, openCount);
      html += purchaseLedger(p, packageItems);
      html += '<div class="pkg-title"><h3>What is in this package</h3>' +
        '<span class="lock-chip" data-state="' +
          (allOpen ? 'unlocked' : openCount ? 'partial' : 'locked') + '">' +
        (allOpen ? 'Unlocked'
          : openCount ? openCount + ' of ' + packageItems.length + ' open'
          : payState === 'approved' && !unlocked ? 'Opens after the terms form'
          : 'Opens once the payment is approved') + '</span></div>';
      html += '<div class="pkg-grid">' + packageItems.map(function (item, i) {
        var st = states[i], price = itemPrice(p, item);
        return '<button class="pkg-item" data-item="' + esc(item.id) + '" data-unlocked="' +
          (st === 'open') + '" data-held="' + (st === 'held') + '" data-state="' + st + '">' +
          '<span class="pkg-icon">' + svg(item.icon) + '</span>' +
          '<span><b>' + esc(item.name) +
            (st !== 'open' && price != null
              ? '<span class="pkg-price">' + esc(fmtMoney(price, p.currency)) + '</span>' : '') +
          '</b><p>' + esc(item.description) + '</p>' +
          '<span class="state">' + itemStateText(p, item, st) + '</span></span>' +
        '</button>';
      }).join('') + '</div>';
      $('#projMsg').textContent = allOpen
        ? 'Everything here is open. Enjoy, and keep it to yourself.'
        : openCount
          ? 'What you have paid for is open. The rest is one tap away whenever you want it.'
          : payState === 'none' ? 'Take the whole package, or pay for a single component. Already paid me elsewhere? There is a code for that.'
          : payState === 'pending' ? 'Waiting for me to check your payment.'
          : payState === 'rejected' ? 'I could not approve that payment — open step 1 to see why.'
          : 'Pick anything — the terms form comes up first.';
    } else {
      html += '<div class="soon-box"><h3>Still being built</h3>' +
        '<p>When it is ready, the package will come with:</p><ul>' +
        packageItems.map(function (item) {
          return '<li>' + esc(item.name) + '</li>';
        }).join('') + '</ul>' +
        (p.custom
          ? '<p style="margin-top:12px">Got a different project in mind? Tell me the subject and the ' +
            'requirements and I will tell you honestly whether I can build it in time.</p>'
          : '<p style="margin-top:12px">Want it early, or want to be told the moment it is ready? Just ask.</p>') +
        (contactLink() ? '<p style="margin-top:12px">' + contactButton() + '</p>' : '') +
        '</div>';
      $('#projMsg').textContent = 'No files yet — nothing to sign for this one.';
    }

    html += projectFaqs(p);

    $('#projBody').innerHTML = html;

    $$('#projBody .pkg-item').forEach(function (el) {
      el.addEventListener('click', function () { requestItem(el.dataset.item); });
    });
    var cover = $('#projBody [data-view-cover]');
    if (cover) cover.addEventListener('click', function () {
      openImage(p.imageUrl, p.name, p.tagline || '');
    });
    var buyAll = $('#projBody [data-buy-package]');
    if (buyAll) buyAll.addEventListener('click', function () {
      var o = offerFor(p);
      openPayment(p.id, o && o.itemIds && o.itemIds.length ? { items: o.itemIds } : { scope: 'package' });
    });
    var pv = $('#projBody .steps-row .step-chip');
    if (pv) pv.style.cursor = 'pointer';
    if (pv) pv.addEventListener('click', function () { openPayment(openProjectId); });
    var v = $('#projBody [data-view-agreement]'), r = $('#projBody [data-reset-agreement]');
    if (v) v.addEventListener('click', function () { showAgreement(openProjectId); });
    if (r) r.addEventListener('click', function () {
      if (!window.confirm('Reset the agreement for ' + byId(openProjectId).name +
                          '? The package locks again until it is signed.')) return;
      forget(openProjectId);
      paintProject();
    });
  }

  /* ---------- the gate ---------- */
  function requestItem(key) {
    var p = byId(openProjectId);
    if (!p) return;
    if (B.enabled && !signedIn()) { pendingItem = key; askSignIn(p.id, key, 'item'); return; }

    var item = packageItemsFor(p).filter(function (i) { return i.id === key; })[0];
    if (!item) return;
    var buy = buyFor(p, item);

    /* nothing covering this one yet — go and buy it, just this one if it has
       its own price, otherwise the package it belongs to */
    if (!buy || buy.status === 'none' || buy.status === 'rejected') {
      pendingItem = key;
      openPayment(p.id, itemPrice(p, item) != null ? { items: [item.id] } : { scope: 'package' });
      return;
    }
    if (buy.status === 'pending') { pendingItem = key; openPayment(p.id, { buy: buy }); return; }
    if (!buy.signed) { pendingItem = key; openTerms(p.id, false, buyKey(buy)); return; }
    openPackageItem(p, key);
  }

  /* Everything that opens an item goes through here, so a held one cannot slip
     out through the payment or terms flow finishing. */
  function openPackageItem(p, key) {
    var item = packageItemsFor(p).filter(function (candidate) { return candidate.id === key; })[0];
    if (item && !itemReleased(p, item)) {
      refreshAccess(p.id);                       // it may have been released since
      if (!itemReleased(p, item)) { heldNotice(p, item); return; }
    }
    runItem(p, key);
  }

  /* Held, not missing — a part of the package the seller hands over later. */
  function heldNotice(p, item) {
    openInfo({
      title: esc(item.name),
      sub: p.name + ' — not released yet',
      html: '<p>This part of the package is released separately. ' + esc(p.name) +
        ' is set up in stages, so you get each piece as we reach it rather than all at once.</p>' +
        '<p style="margin-top:12px">Everything else in the package that is already released ' +
        'stays open. When you are ready for this one, tell me and I will release it to this ' +
        'same account — it appears here without paying again.</p>' +
        (contactLink() ? '<p style="margin-top:14px">' + contactButton() + '</p>' : ''),
      msg: 'Your payment and signed terms already cover it — only the handover is staged.'
    });
  }

  /* ---------- attachments ----------
     A package item that points at a file should hand the file over, not put it
     on screen and leave the buyer to work out how to keep it. Supabase serves
     a public object inline unless the URL asks otherwise, so ?download=<name>
     is appended: that is what sets Content-Disposition on their side. */
  var FILE_KIND = {
    pdf:"PDF document", txt:"Text file", md:"Markdown", rtf:"Rich text",
    doc:"Word document", docx:"Word document", odt:"Text document",
    xls:"Spreadsheet", xlsx:"Spreadsheet", csv:"Spreadsheet", ods:"Spreadsheet",
    ppt:"Slides", pptx:"Slides", odp:"Slides",
    zip:"Zip archive", rar:"RAR archive", "7z":"7-Zip archive", tar:"Tar archive", gz:"Compressed",
    ino:"Arduino sketch", cpp:"C++ source", c:"C source", h:"Header file", py:"Python source",
    js:"JavaScript", json:"JSON data", sql:"SQL script", sh:"Shell script",
    png:"Image", jpg:"Image", jpeg:"Image", webp:"Image", gif:"Image", svg:"Vector image",
    mp4:"Video", webm:"Video", mov:"Video", apk:"Android installer", exe:"Windows installer",
    fig:"Figma file", psd:"Photoshop file", ai:"Illustrator file", dwg:"CAD drawing"
  };
  var PAGE_EXT = { html:1, htm:1, php:1, aspx:1 };

  function fileInfo(href) {
    var clean = String(href || '').split('#')[0].split('?')[0];
    var name = decodeURIComponent(clean.split('/').pop() || '');
    var ext = (name.split('.').pop() || '').toLowerCase();
    var storage = /\/storage\/v1\/object\/public\//.test(clean);
    /* the uploader prefixes a short id — the buyer does not need to see it */
    var pretty = name.replace(/^[0-9a-f]{8}-/i, '');
    return {
      name: pretty || 'file',
      ext: ext,
      kind: FILE_KIND[ext] || (ext ? ext.toUpperCase() + ' file' : 'File'),
      storage: storage,
      isFile: !!ext && !PAGE_EXT[ext] && (storage || !!FILE_KIND[ext])
    };
  }

  /* the same address, but asking for it as a download */
  function downloadHref(href, name) {
    if (!/\/storage\/v1\/object\/public\//.test(String(href || ''))) return href;
    return href + (href.indexOf('?') > -1 ? '&' : '?') + 'download=' + encodeURIComponent(name || '');
  }

  function openFile(p, item, link) {
    var f = fileInfo(link.href);
    openInfo({
      title: esc(item ? item.name : f.name),
      sub: p.name + ' &mdash; ' + esc(f.kind),
      html: '<div class="file-card">' +
          '<span class="file-ext">' + esc(f.ext ? f.ext.toUpperCase() : 'FILE') + '</span>' +
          '<span class="file-what"><b>' + esc(f.name) + '</b>' +
            '<em>' + esc(f.kind) + '</em></span>' +
        '</div>' +
        (item && item.description ? '<p style="margin-top:14px">' + esc(item.description) + '</p>' : '') +
        '<p style="margin-top:16px; display:flex; gap:9px; flex-wrap:wrap">' +
          '<a class="btn btn-sm btn-primary" id="fileGet" href="' + esc(downloadHref(link.href, f.name)) +
            '" download="' + esc(f.name) + '">' + svg(ICON.down) + 'Download it</a>' +
          '<a class="btn btn-sm" id="fileSee" href="' + esc(link.href) + '" target="_blank" rel="noopener">' +
            'Open in a tab</a>' +
        '</p>',
      msg: 'Yours to keep — save it somewhere you will find it again.'
    });
  }

  function runItem(p, key) {
    var item = packageItemsFor(p).filter(function (candidate) { return candidate.id === key; })[0];
    var type = item ? item.type : key;
    var meta = ITEM_TYPES[type] || ITEM_TYPES.custom;
    var link = item && item.href ? { href: item.href, sameTab: item.sameTab } : (p.links || {})[key];
    if (!link && type !== key) link = (p.links || {})[type];
    if (typeof link === 'string') link = { href: link };
    if (link) {
      /* a page or a live demo still just opens; a file is handed over */
      if (!link.sameTab && fileInfo(link.href).isFile) { openFile(p, item, link); return; }
      if (link.sameTab) window.location.href = link.href;
      else window.open(link.href, '_blank', 'noopener');
      return;
    }
    if (type === 'code') {
      openInfo({
        title: p.name + ' &mdash; source code',
        sub: 'Open a file to read it, or right-click &rarr; Save link as&hellip; to keep a copy.',
        html: table(['File', 'What it is', ''], (p.files || []).map(function (f) {
          var info = fileInfo(f[2]);
          return [f[0], f[1],
            '<a href="' + esc(downloadHref(f[2], info.name)) + '" download="' + esc(info.name) +
              '">download</a> &middot; ' +
            '<a href="' + esc(f[2]) + '" target="_blank" rel="noopener">open</a>'];
        })) + (p.libraries
          ? '<h3>Libraries</h3><p>' + p.libraries + ' Their own licences stay in effect (terms, section 11).</p>'
          : ''),
        msg: 'For your own learning, building, testing and modifying.'
      });
      return;
    }
    if (type === 'materials') {
      openInfo({
        title: p.name + ' &mdash; materials &amp; components',
        sub: 'Quantities are for one machine. Direct Shopee links come with the delivered sheet.',
        html: table(['Component', 'What it does', 'Qty'], p.materials || []) +
          '<p style="margin-top:14px">Brands and specifications may differ from what is listed here — ' +
          'differences in wiring, power supply or hardware version can affect performance ' +
          '(terms, section 8).</p>',
        msg: 'Buying the physical parts is on you, unless agreed otherwise.'
      });
      return;
    }
    if (type === 'support') {
      openInfo({
        title: p.name + ' &mdash; setup &amp; troubleshooting',
        sub: 'Within the scope agreed at the time of purchase.',
        html: '<h3>What I can help with</h3><ul>' +
          '<li>Code implementation</li><li>Circuit connections</li><li>Component identification</li>' +
          '<li>Setup and testing</li><li>Troubleshooting</li><li>Basic project modifications</li></ul>' +
          '<h3>What I cannot promise</h3>' +
          '<p>That the project will satisfy every requirement your school, instructor or client ' +
          'imposes (terms, section 7).</p>' +
          (p.run ? '<h3>Running it on your computer</h3>' + table(['Step', 'Command'], p.run) : '') +
          (contactLink() ? '<p style="margin-top:14px">' + contactButton() + '</p>' : ''),
        msg: 'Tell me straight away if a file is missing or wrong.'
      });
      return;
    }
    openInfo({
      title: esc(item ? item.name : meta.name),
      sub: p.name,
      html: '<p>' + esc(item ? item.description : meta.copy) + '</p>' +
        '<p style="margin-top:12px">This item is part of the package but has no attachment on this ' +
        'page yet — ask and I will send it over.</p>' +
        (contactLink() ? '<p style="margin-top:14px">' + contactButton() + '</p>' : ''),
      msg: ''
    });
  }

  function table(head, rows) {
    return '<div class="tbl-wrap"><table class="tbl"><tr>' +
      head.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr>' +
      rows.map(function (r) {
        return '<tr>' + r.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
      }).join('') + '</table></div>';
  }

  /* ---------- overlays ---------- */
  function openOverlay(el) {
    focusStack.push(document.activeElement);
    el.dataset.open = 'true';
    document.body.classList.add('modal-open');
    var f = el === termsOverlay
      ? (termsBody.dataset.read === 'true' ? buyer : termsScroll)
      : el.querySelector('.modal');
    if (f && f.focus) f.focus({ preventScroll: true });
  }
  function closeOverlay(el) {
    el.dataset.open = 'false';
    if (!$('.overlay[data-open="true"]')) document.body.classList.remove('modal-open');
    var back = focusStack.pop();
    if (back && back.focus && document.contains(back)) back.focus({ preventScroll: true });
  }

  /* ---------- the site's own notices ----------
     Read-only, and deliberately kept apart from the package Terms & Conditions:
     that one is signed at purchase, these two only explain how the website
     behaves. The text lives in index.html so there is one copy of it. */
  function openSiteDoc(which) {
    var source = document.getElementById(which === 'privacy' ? 'privacyDoc' : 'siteTermsDoc');
    if (!source) return;
    openInfo({
      title: which === 'privacy' ? 'Privacy notice' : 'Terms of use',
      sub: which === 'privacy'
        ? 'What this site records about you, and who can see it'
        : 'The rules for using this website',
      html: '<div class="site-doc">' + source.innerHTML + '</div>',
      msg: which === 'privacy'
        ? 'For reading only — nothing here needs your signature.'
        : 'For reading only — the agreement you sign is the package Terms & Conditions.'
    });
  }

  /* The cover, whole and uncropped — the framing only decides what the card
     shows, never what the buyer is allowed to look at. */
  var imageOverlay = $('#imageOverlay');
  var imageReturn = null;            // the project modal to bring back afterwards

  var gallery = { items: [], at: 0, title: '', out: null };

  function isVideoFile(url) { return /\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(String(url || '')); }

  /* One viewer for everything: a single project cover, or a proof with a dozen
     photos and a clip, paged through with the arrows or the arrow keys. */
  function openGallery(items, title, out) {
    items = (items || []).filter(function (i) { return i && i.url; });
    if (!items.length && !out) return;
    gallery = { items: items, at: 0, title: title || '', out: out || null };
    imageReturn = projectOverlay.dataset.open === 'true' ? openProjectId : null;
    if (imageReturn) closeOverlay(projectOverlay);
    paintGallery();
    openOverlay(imageOverlay);
  }

  function openImage(url, title, note) {
    openGallery([{ url: url, caption: note || '' }], title);
  }

  function paintGallery() {
    var shot = $('#imageFull'), clip = $('#videoFull');
    var many = gallery.items.length > 1;
    var item = gallery.items[gallery.at] || null;

    clip.pause();
    if (item && isVideoFile(item.url)) {
      clip.src = item.url;
      clip.hidden = false;
      shot.hidden = true;
      shot.removeAttribute('src');
    } else if (item) {
      clip.removeAttribute('src');
      clip.hidden = true;
      shot.hidden = false;
      shot.src = item.url;
      shot.alt = (gallery.title || 'Image') + ' — full size';
    } else {
      clip.hidden = true; shot.hidden = true;
    }

    $('#imageCaption').textContent = gallery.title;
    var note = item && item.caption ? item.caption : '';
    $('#imageNote').textContent = note;
    $('#imageNote').hidden = !note;
    /* the day the thing in this photo actually happened */
    var when = item && item.date ? pretty(item.date) : '';
    $('#imageWhen').textContent = when;
    $('#imageWhen').hidden = !when;
    $('#imageCount').textContent = many ? (gallery.at + 1) + ' of ' + gallery.items.length : '';
    $('#imageCount').hidden = !many;

    var out = $('#imageOut');
    out.hidden = !gallery.out;
    if (gallery.out) { out.href = gallery.out.url; out.textContent = gallery.out.label; }

    $$('#imageOverlay [data-lb-step]').forEach(function (b) { b.hidden = !many; });
  }

  function stepGallery(by) {
    if (gallery.items.length < 2) return;
    gallery.at = (gallery.at + by + gallery.items.length) % gallery.items.length;
    paintGallery();
  }

  function closeImage() {
    closeOverlay(imageOverlay);
    var clip = $('#videoFull');
    clip.pause();
    clip.removeAttribute('src');
    $('#imageFull').removeAttribute('src');
    if (imageReturn && byId(imageReturn)) {
      openProjectId = imageReturn;
      openOverlay(projectOverlay);
    }
    imageReturn = null;
  }

  function openInfo(cfg) {
    $('#infoTitle').innerHTML = cfg.title;
    $('#infoSub').innerHTML = cfg.sub || '';
    $('#infoBody').innerHTML = cfg.html;
    $('#infoMsg').textContent = cfg.msg || '';
    openOverlay(infoOverlay);
  }

  /* ---------- the signature pad ----------
     The buyer draws their signature; it is only accepted once there is enough ink to be
     a signature rather than a slip, and only once they press Save. What gets attached to
     the form is a trimmed PNG of what they drew. */
  var sig = (function () {
    var pad = $('#sigPad'), canvas = $('#sigCanvas'), ctx = canvas.getContext('2d');
    var savedImg = $('#sigSaved'), badge = $('#sigBadge'), msg = $('#sigMsg');
    var btnSave = $('#sigSave'), btnClear = $('#sigClear'), btnRedo = $('#sigRedo');
    var typedWrap = $('#sigTypedWrap'), typed = $('#fSignTyped'), toggle = $('#sigToggle');

    var INK = '#16211E', LINE = 2.4;
    var MIN_INK = 140, MIN_W = 55, MIN_H = 10;   // what counts as a signature

    var strokes = [], drawing = null, state = 'empty', mode = 'draw', enabled = true;

    function fit() {
      var r = canvas.getBoundingClientRect();
      if (!r.width) return;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint();
    }

    function paint() {
      var r = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, r.width, r.height);
      ctx.strokeStyle = INK; ctx.lineWidth = LINE;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      strokes.forEach(function (st) { line(ctx, st); });
    }

    function line(c, st) {
      if (st.length === 1) {                       // a dot still deserves a mark
        c.beginPath(); c.arc(st[0].x, st[0].y, LINE / 2, 0, Math.PI * 2);
        c.fillStyle = INK; c.fill(); return;
      }
      c.beginPath(); c.moveTo(st[0].x, st[0].y);
      for (var i = 1; i < st.length; i++) c.lineTo(st[i].x, st[i].y);
      c.stroke();
    }

    function at(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    function metrics() {
      var ink = 0, minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, n = 0;
      strokes.forEach(function (st) {
        st.forEach(function (p, i) {
          n++;
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
          if (i) ink += Math.hypot(p.x - st[i - 1].x, p.y - st[i - 1].y);
        });
      });
      if (!n) return null;
      return { ink: ink, n: n, x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    function looksLikeSignature(m) {
      return !!m && m.ink >= MIN_INK && m.w >= MIN_W && m.h >= MIN_H;
    }

    function say(text, err) {
      msg.textContent = text;
      msg.dataset.err = err ? 'true' : 'false';
    }

    function setState(next) {
      state = next;
      pad.dataset.state = next;
      savedImg.hidden = next !== 'saved';
      badge.hidden = next !== 'saved';
      btnSave.hidden = next === 'saved';
      btnClear.hidden = next === 'saved';
      btnRedo.hidden = next !== 'saved';
      btnSave.disabled = next !== 'drawn';
    }

    function png() {
      var m = metrics(), pad2 = 14, scale = 2;
      var w = Math.max(m.w + pad2 * 2, 40), h = Math.max(m.h + pad2 * 2, 30);
      var out = document.createElement('canvas');
      out.width = Math.round(w * scale); out.height = Math.round(h * scale);
      var c = out.getContext('2d');
      c.setTransform(scale, 0, 0, scale, 0, 0);
      c.translate(-m.x + pad2, -m.y + pad2);
      c.strokeStyle = INK; c.lineWidth = LINE;
      c.lineCap = 'round'; c.lineJoin = 'round';
      strokes.forEach(function (st) { line(c, st); });
      return out.toDataURL('image/png');
    }

    /* --- drawing --- */
    canvas.addEventListener('pointerdown', function (e) {
      if (!enabled || state === 'saved' || mode !== 'draw') return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      drawing = [at(e)];
      strokes.push(drawing);
      paint();
    });
    canvas.addEventListener('pointermove', function (e) {
      if (!drawing) return;
      var p = at(e), last = drawing[drawing.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.1) return;
      drawing.push(p);
      ctx.strokeStyle = INK; ctx.lineWidth = LINE; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    });
    function endStroke() {
      if (!drawing) return;
      drawing = null;
      var m = metrics();
      if (looksLikeSignature(m)) {
        setState('drawn');
        say('Looks good — press Save signature to attach it.');
      } else {
        setState('empty');
        pad.dataset.state = 'drawn';        // keep the hint hidden while there is ink
        say('Keep going — that is too little to be a signature yet.');
      }
    }
    canvas.addEventListener('pointerup', endStroke);
    canvas.addEventListener('pointercancel', endStroke);
    canvas.addEventListener('pointerleave', endStroke);

    /* --- buttons --- */
    btnSave.addEventListener('click', function () {
      var m = metrics();
      if (!looksLikeSignature(m)) {
        say('That is too small to be a signature — try again across the line.', true);
        return;
      }
      savedImg.src = png();
      sign.value = savedImg.src;
      sign.dataset.type = 'drawn';
      setState('saved');
      say('Signature saved and attached to this form.');
      if (typeof validate === 'function') validate();
    });

    btnClear.addEventListener('click', function () {
      strokes = []; drawing = null;
      sign.value = ''; sign.dataset.type = 'drawn';
      setState('empty');
      paint();
      say('Draw your signature, then save it to attach it to this form.');
      if (typeof validate === 'function') validate();
    });

    btnRedo.addEventListener('click', function () {
      strokes = []; drawing = null;
      sign.value = ''; savedImg.removeAttribute('src');
      setState('empty');
      paint();
      say('Draw your signature, then save it to attach it to this form.');
      if (typeof validate === 'function') validate();
      canvas.focus({ preventScroll: true });
    });

    /* --- typed fallback, for anyone who cannot draw --- */
    function setMode(next) {
      mode = next;
      typedWrap.hidden = next !== 'typed';
      pad.hidden = next === 'typed';
      $('.sig-actions').hidden = next === 'typed';
      toggle.textContent = next === 'typed'
        ? 'Rather draw it? Sign by hand instead'
        : 'Can’t draw it? Type it instead';
      sign.dataset.type = next;
      sign.value = next === 'typed' ? typed.value.trim() : (state === 'saved' ? savedImg.src : '');
      if (typeof validate === 'function') validate();
      if (next === 'typed') typed.focus({ preventScroll: true });
    }
    toggle.addEventListener('click', function () { setMode(mode === 'typed' ? 'draw' : 'typed'); });
    typed.addEventListener('input', function () {
      sign.value = typed.value.trim();
      if (typeof validate === 'function') validate();
    });

    window.addEventListener('resize', function () { if (mode === 'draw') fit(); });

    return {
      ready: function () { fit(); },
      mode: function () { return mode; },
      state: function () { return state; },
      hasInk: function () { return strokes.length > 0; },
      focus: function () {
        if (mode === 'typed') typed.focus({ preventScroll: true });
        else canvas.focus({ preventScroll: true });
      },
      enable: function (on) {
        enabled = on;
        btnSave.disabled = !on || state !== 'drawn';
        btnClear.disabled = !on;
        btnRedo.disabled = !on;
        typed.disabled = !on;
        toggle.disabled = !on;
      },
      reset: function () {
        strokes = []; drawing = null;
        savedImg.removeAttribute('src');
        typed.value = '';
        sign.value = ''; sign.dataset.type = 'drawn';
        if (mode === 'typed') setMode('draw');
        setState('empty');
        paint();
        say('Draw your signature, then save it to attach it to this form.');
      },
      restore: function (value, type) {
        strokes = []; drawing = null;
        if (type === 'typed') {
          typed.value = value;
          sign.value = value;
          setMode('typed');
          setState('empty');
        } else {
          if (mode === 'typed') setMode('draw');
          savedImg.src = value;
          sign.value = value;
          sign.dataset.type = 'drawn';
          setState('saved');
          say('Signature on file for this project.');
        }
      }
    };
  })();

  /* ---------- terms ---------- */
  function openTerms(projectId, readOnly, buyKeyWanted) {
    termsFor = projectId || null;
    termsBuy = buyKeyWanted || (termsFor ? buyKey(getPay(termsFor)) : '');
    var p = termsFor ? byId(termsFor) : null;
    var buy = termsFor && termsBuy ? findBuy(termsFor, termsBuy) : null;
    /* an unsigned purchase signs afresh; anything else shows what was signed */
    var rec = buy ? buy.signed : (termsFor ? saved(termsFor) : null);
    var prefill = rec || (termsFor ? saved(termsFor) : null);

    projField.value = p
      ? p.name + (buy && buy.scope === 'items' ? ' — ' + buyCoverage(buy) : '')
      : 'Any JUDECH project';
    sellerDate.value = today();

    if (prefill) {
      buyer.value = prefill.buyer; buyerDate.value = rec ? prefill.buyerDate : today();
      if (prefill.buyerType && KNOWN_TYPES.indexOf(prefill.buyerType) === -1) {
        buyerType.value = 'Other'; typeOther.value = prefill.buyerType;
      } else {
        buyerType.value = prefill.buyerType || 'Student'; typeOther.value = '';
      }
      school.value = prefill.school || ''; locationF.value = prefill.location || '';
      syncType();
      sig.restore(prefill.signature, prefill.signatureType || 'drawn');
      termsBody.dataset.read = 'true';
      ack.checked = !!rec; ack.disabled = false; ackWrap.dataset.locked = 'false';
    } else {
      sig.reset();
      if (!readOnly) {
        buyerDate.value = buyerDate.value || today();
        if (me && !buyer.value) buyer.value = me.name;
      }
    }

    [buyer, buyerDate, buyerType, school, locationF, typeOther].forEach(function (el) { el.disabled = !p; });
    sig.enable(!!p);
    formMsg.dataset.err = 'false';
    validate();
    if (!p) {
      agreeBtn.disabled = true;
      formMsg.textContent = 'This is the agreement you sign when you open a project package.';
    } else if (rec) {
      formMsg.textContent = 'Signed ' + pretty(rec.buyerDate) + '. Editing the fields signs it again.';
    }
    openOverlay(termsOverlay);
    sig.ready();                       // the canvas can only be sized once it is on screen
    termsScroll.scrollTop = rec ? termsScroll.scrollHeight : 0;
    checkRead();
  }

  function checkRead() {
    // the terms and the form share one scroller: the terms count as read once the
    // bottom of the terms block has been scrolled into view.
    var past = termsBody.getBoundingClientRect().bottom <= termsScroll.getBoundingClientRect().bottom + 8;
    var noScroll = termsScroll.scrollHeight <= termsScroll.clientHeight + 4;
    if (past || noScroll) {
      termsBody.dataset.read = 'true';
      if (ack.disabled) { ack.disabled = false; ackWrap.dataset.locked = 'false'; }
      validate();
    }
  }

  function validate() {
    var ok = !!termsFor &&
             termsBody.dataset.read === 'true' &&
             ack.checked &&
             buyer.value.trim().length >= 2 &&
             locationF.value.trim().length >= 2 &&
             (buyerType.value !== 'Student' || school.value.trim().length >= 2) &&
             (buyerType.value !== 'Other' || typeOther.value.trim().length >= 2) &&
             sign.value.trim().length >= 2 &&
             !!buyerDate.value;
    agreeBtn.disabled = !ok;
    if (termsFor && formMsg.dataset.err !== 'true') {
      if (termsBody.dataset.read !== 'true') formMsg.textContent = 'Read to the end of the terms to tick the box.';
      else if (!ok) formMsg.textContent = 'Add your name, signature and date, then tick the box.';
      else formMsg.textContent = 'All set — the package opens when you agree.';
    }
    return ok;
  }

  function fail(msg) { formMsg.dataset.err = 'true'; formMsg.textContent = msg; }

  function accept() {
    if (B.enabled && !signedIn()) {
      closeOverlay(termsOverlay);
      askSignIn(termsFor, pendingItem, pendingItem ? 'item' : 'project');
      return;
    }
    formMsg.dataset.err = 'false';
    if (!validate()) {
      if (!termsFor) return;
      if (termsBody.dataset.read !== 'true') return fail('Please scroll through the terms first.');
      if (buyer.value.trim().length < 2) { buyer.focus(); return fail('Your name, please.'); }
      if (buyerType.value === 'Other' && typeOther.value.trim().length < 2) { typeOther.focus(); return fail('Type what you are in the box.'); }
      if (buyerType.value === 'Student' && school.value.trim().length < 2) { school.focus(); return fail('Which school or university?'); }
      if (locationF.value.trim().length < 2) { locationF.focus(); return fail('Where are you from? City and province, please.'); }
      if (sign.value.trim().length < 2) {
        sig.focus();
        if (sig.mode() === 'typed') return fail('Type your name in the signature box.');
        return fail(sig.hasInk()
          ? 'Press “Save signature” to attach the one you drew.'
          : 'Please sign in the box — draw it with your mouse, finger or stylus.');
      }
      if (!buyerDate.value) { buyerDate.focus(); return fail('Please give the date.'); }
      if (!ack.checked) return fail('Please tick the box to continue.');
      return;
    }
    var p = byId(termsFor);
    var rec = {
      seller: SELLER,
      projectId: p.id,
      project: p.name,
      sellerDate: sellerDate.value,
      buyer: buyer.value.trim(),
      buyerType: buyerTypeValue(),
      school: school.value.trim(),
      location: locationF.value.trim(),
      signature: sign.value.trim(),
      signatureType: sign.dataset.type || 'drawn',
      buyerDate: buyerDate.value,
      acceptedAt: new Date().toISOString(),
      rights: p.rights,
      terms: 'Project package — Terms & Conditions (sections 1–13)'
    };

    function finish() {
      save(termsFor, rec, termsBuy);
      closeOverlay(termsOverlay);
      if (openProjectId === p.id) paintProject();
      var next = pendingItem; pendingItem = null;
      if (next) setTimeout(function () { openPackageItem(p, next); }, 120);
    }

    if (!B.enabled) { finish(); return; }

    var pay = (termsBuy && findBuy(p.id, termsBuy)) || getPay(p.id);
    if (!pay || !pay.token) { return fail('I cannot find your approved payment on this device — open step 1 first.'); }
    rec.scope = pay.scope || 'package';
    rec.coverage = buyCoverage(pay);

    agreeBtn.disabled = true;
    formMsg.dataset.err = 'false';
    formMsg.textContent = rec.signatureType === 'drawn' ? 'Attaching your signature…' : 'Recording your agreement…';
    (rec.signatureType === 'drawn' ? B.uploadSignature(rec.signature) : Promise.resolve(null))
      .then(function (path) {
        formMsg.textContent = 'Recording your agreement…';
        return B.signAgreement({
          token: pay.token, name: rec.buyer, type: rec.signatureType,
          buyerType: rec.buyerType, school: rec.school, location: rec.location,
          signaturePath: path, signatureText: rec.signatureType === 'typed' ? rec.signature : null,
          signedOn: rec.buyerDate
        });
      })
      .then(function (id) { rec.agreementId = id; finish(); })
      .catch(function (e) {
        agreeBtn.disabled = false;
        fail('Could not record the agreement: ' + e.message);
      });
  }

  /* ---------- signed copy ---------- */
  function agreementTermsHtml() {
    var terms = termsBody.cloneNode(true);
    var hint = terms.querySelector('.scroll-hint'); if (hint) hint.remove();
    var rule = terms.querySelector('.rule'); if (rule) rule.remove();
    terms.removeAttribute('id');
    terms.removeAttribute('data-read');
    return terms.innerHTML;
  }

  function agreementRecordHtml(rec) {
    var signatureBlock = rec.signatureType === 'typed'
      ? '<span class="sigline typed">' + esc(rec.signature || rec.buyer) + '</span>'
      : (rec.signature
          ? '<img class="sigline" src="' + rec.signature + '" alt="Signature of ' + esc(rec.buyer) + '">'
          : '<span class="sigline typed">' + esc(rec.buyer) + '</span>');
    return '<section class="agreement-record">' +
      '<h2>Signed record</h2>' +
      '<table class="agreement-fields">' +
      '<tr><td>Seller</td><td>' + esc(SELLER) + '</td></tr>' +
      '<tr><td>Date</td><td>' + pretty(rec.buyerDate || rec.sellerDate) + '</td></tr>' +
      '<tr><td>Buyer name</td><td>' + esc(rec.buyer) + '</td></tr>' +
      '<tr><td>Position</td><td>' + esc(rec.buyerType || '—') + '</td></tr>' +
      '<tr><td>School / university</td><td>' + esc(rec.school || '—') + '</td></tr>' +
      '<tr><td>City / municipality, province</td><td>' + esc(rec.location || '—') + '</td></tr>' +
      '<tr><td>Project</td><td>' + esc(rec.project) + '</td></tr>' +
      '<tr><td>Acknowledgment</td><td>&#9745; I have read, understood, and agree to the ' +
        'Terms &amp; Conditions above.</td></tr>' +
      '<tr><td>Buyer signature</td><td>' + signatureBlock + '</td></tr>' +
      '</table>' +
    '</section>';
  }

  function agreementText(rec) {
    var terms = document.createElement('div');
    terms.innerHTML = agreementTermsHtml();
    return [
      'PROJECT PACKAGE — TERMS & CONDITIONS',
      'Please read before purchasing or receiving the project files.',
      '',
      terms.textContent.trim(),
      '',
      'Seller:            ' + SELLER,
      'Date:              ' + pretty(rec.buyerDate || rec.sellerDate),
      'Buyer name:        ' + rec.buyer,
      'Position:          ' + (rec.buyerType || '—'),
      'School/University: ' + (rec.school || '—'),
      'City/Municipality, Province: ' + (rec.location || '—'),
      'Project:           ' + rec.project,
      '[x] I have read, understood, and agree to the Terms & Conditions above.',
      'Buyer signature:   ' + (rec.signatureType === 'typed'
        ? rec.signature
        : '[handwritten signature included in the PDF copy]')
    ].join('\n');
  }

  function saveBlob(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* The whole agreement as one file: the parties, the signature as drawn, and the terms
     exactly as they were shown on screen. It is also the source for the PDF export. */
  function signedAgreementHtml(rec) {
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>' + esc(rec.project) + ' — signed agreement</title><style>' +
      'body{font:11pt/1.45 Arial,sans-serif;color:#111;background:#fff;margin:0 auto;padding:32px;max-width:760px}' +
      'h1{font-size:18pt;margin:0 0 4px}h2{font-size:13pt;margin:0 0 4px}' +
      'h3{font-size:11pt;margin:18px 0 0}' +
      '.sub{font-size:10.5pt;margin:0 0 18px}p{margin:5px 0 0}ul{margin:6px 0 0;padding-left:22px}' +
      'table{border-collapse:collapse;width:100%;margin-top:20px}' +
      'td{padding:5px 0;vertical-align:top}td:first-child{width:215px;font-weight:700}' +
      '.sigline{display:block;max-width:300px;max-height:100px;object-fit:contain;background:transparent}' +
      '.sigline.typed{font:700 22px/1 Georgia,serif}' +
      '.agreement-terms{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}' +
      '.rule{height:1px;background:#bbb;margin:24px 0}' +
      '@media print{body{padding:0}.rule{display:none}' +
        '.agreement-record{break-before:page;page-break-before:always}}' +
      '</style></head><body>' +
      '<h1>Project package — Terms &amp; Conditions</h1>' +
      '<p class="sub">Please read before purchasing or receiving the project files.</p>' +
      '<section class="agreement-terms">' + agreementTermsHtml() + '</section>' +
      '<div class="rule"></div>' + agreementRecordHtml(rec) +
      '</body></html>';
  }

  function showAgreement(id) {
    var rec = saved(id);
    if (!rec) { openTerms(id, false); return; }
    openInfo({
      title: 'Project package — Terms & Conditions',
      sub: 'Please read before purchasing or receiving the project files.',
      html: '<div class="agreement-simple">' + agreementTermsHtml() +
        '<div class="rule"></div>' + agreementRecordHtml(rec) + '</div>' +
      '<p style="margin-top:16px; display:flex; gap:8px; flex-wrap:wrap">' +
        '<button class="btn btn-sm btn-primary" id="viewSignedPdf">View PDF</button> ' +
        '<button class="btn btn-sm" id="dlSignedPdf">Download PDF</button></p>',
      msg: 'Personal signed copy'
    });
    function makePdf(download) {
      var viewer = download ? null : (window.PdfTools && window.PdfTools.openViewer());
      var buttons = [$('#viewSignedPdf'), $('#dlSignedPdf')];
      buttons.forEach(function (button) { if (button) button.disabled = true; });
      $('#infoMsg').textContent = 'Preparing the signed agreement PDF…';
      var tool = window.PdfTools;
      var job = tool ? tool.fromHtml(signedAgreementHtml(rec))
        : Promise.reject(new Error('The PDF tool did not load. Refresh the page and try again.'));
      job.then(function (result) {
        var filename = 'JUDECH-' + rec.projectId + '-signed-agreement.pdf';
        if (download) {
          tool.download(result.blob, filename);
          $('#infoMsg').textContent = 'PDF downloaded.';
        } else if (tool.openInTab(result, filename, viewer)) {
          $('#infoMsg').textContent = 'PDF opened in a new tab.';
        } else {
          /* the tab was blocked — save it instead rather than leave nothing */
          tool.download(result.blob, filename);
          $('#infoMsg').textContent = 'Your browser blocked the new tab, so the PDF was downloaded.';
        }
      }).catch(function (e) {
        if (viewer) viewer.close();
        $('#infoMsg').textContent = e.message || 'Could not create the PDF.';
      }).then(function () {
        buttons.forEach(function (button) { if (button) button.disabled = false; });
      });
    }
    $('#viewSignedPdf').addEventListener('click', function () { makePdf(false); });
    $('#dlSignedPdf').addEventListener('click', function () { makePdf(true); });
  }

  /* ---------- hero services slideshow ---------- */
  function initHeroSlider() {
    var root = $('[data-hero-slider]');
    if (!root) return;
    var slides = Array.prototype.slice.call(root.querySelectorAll('[data-hero-slide]'));
    var dots = Array.prototype.slice.call(root.querySelectorAll('[data-hero-dot]'));
    var toggle = root.querySelector('[data-hero-toggle]');
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var current = 0, timer = null, manuallyPaused = false;

    function show(next) {
      current = (next + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        var active = i === current;
        slide.classList.toggle('is-active', active);
        slide.setAttribute('aria-hidden', active ? 'false' : 'true');
      });
      dots.forEach(function (dot, i) {
        var active = i === current;
        dot.classList.toggle('is-active', active);
        dot.setAttribute('aria-current', active ? 'true' : 'false');
      });
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    function start() {
      stop();
      if (manuallyPaused || (reduced && reduced.matches)) return;
      if ((root.matches && root.matches(':hover')) || root.contains(document.activeElement)) return;
      timer = setInterval(function () { show(current + 1); }, 5500);
    }
    function choose(next) { show(next); start(); }

    root.querySelector('[data-hero-prev]').addEventListener('click', function () { choose(current - 1); });
    root.querySelector('[data-hero-next]').addEventListener('click', function () { choose(current + 1); });
    dots.forEach(function (dot) {
      dot.addEventListener('click', function () { choose(Number(dot.dataset.heroDot)); });
    });
    toggle.addEventListener('click', function () {
      manuallyPaused = !manuallyPaused;
      toggle.setAttribute('aria-pressed', manuallyPaused ? 'true' : 'false');
      toggle.setAttribute('aria-label', manuallyPaused ? 'Play slideshow' : 'Pause slideshow');
      if (manuallyPaused) stop(); else start();
    });
    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) start(); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); choose(current - 1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); choose(current + 1); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') stop(); else start();
    });
    if (reduced && reduced.addEventListener) {
      reduced.addEventListener('change', function () {
        toggle.hidden = reduced.matches;
        if (reduced.matches) stop(); else start();
      });
    }
    if (reduced) toggle.hidden = reduced.matches;
    show(0);
    start();
  }

  function hydrateHeroSlides() {
    var slideEls = Array.prototype.slice.call(document.querySelectorAll('[data-hero-slide]'));
    slideEls.forEach(function (slide) {
      var image = slide.querySelector('[data-hero-image]');
      image.dataset.defaultSrc = image.getAttribute('src');
      image.addEventListener('error', function () {
        if (image.getAttribute('src') !== image.dataset.defaultSrc) image.setAttribute('src', image.dataset.defaultSrc);
      });
    });
    if (!B.enabled || !B.heroSlides) return Promise.resolve([]);
    return B.heroSlides().then(function (rows) {
      rows.forEach(function (row) {
        var slide = document.querySelector('[data-hero-slide="' + row.slide_key + '"]');
        if (!slide) return;
        var image = slide.querySelector('[data-hero-image]');
        if (row.image_url) image.setAttribute('src', row.image_url);
        if (row.alt_text) image.setAttribute('alt', row.alt_text);
        if (row.eyebrow) slide.querySelector('[data-hero-eyebrow]').textContent = row.eyebrow;
        if (row.headline) slide.querySelector('[data-hero-headline]').textContent = row.headline;
      });
      return rows;
    }).catch(function () { return []; });
  }

  /* ---------- the page's own small manners ----------
     The top bar only draws its line once you have scrolled, the nav marks where
     you are, and blocks fade up as they arrive. All three are added by script,
     so with JavaScript off the page simply renders flat and complete. */
  var navLinks = {}, spy = null;

  /* sections that arrive after the page has settled join the scrollspy here */
  function spyOn(id) {
    if (!spy) return;
    var section = document.getElementById(id);
    if (section) spy.observe(section);
  }

  function polish() {
    var bar = document.querySelector('.site-topbar');
    if (bar) {
      /* one scroll handler for the three things that care: the bar's own state,
         the reading line along its bottom edge, and the cue in the hero that
         retires the moment it has been obeyed */
      var line = $('#readBar'), cue = $('#scrollCue');
      var mark = function () {
        var y = window.scrollY || document.documentElement.scrollTop || 0;
        var room = document.documentElement.scrollHeight - window.innerHeight;
        var through = room > 40 ? Math.min(1, Math.max(0, y / room)) : 1;
        bar.dataset.scrolled = y > 8 ? 'true' : 'false';
        if (line) {
          line.style.transform = 'scaleX(' + through + ')';
          line.dataset.done = through > .995 ? 'true' : 'false';
        }
        if (cue) cue.dataset.gone = y > 130 ? 'true' : 'false';
      };
      mark();
      window.addEventListener('scroll', mark, { passive: true });
      window.addEventListener('resize', mark);

      /* the bar's real height, so a section jumped to lands below it and not
         behind it — it grows when the nav wraps, so it is measured, not guessed */
      var measure = function () {
        document.documentElement.style.setProperty('--header-h',
          Math.round(bar.getBoundingClientRect().height) + 'px');
      };
      measure();
      window.addEventListener('resize', measure);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    }

    if (!('IntersectionObserver' in window)) return;

    $$('.topnav a[href^="#"]').forEach(function (a) { navLinks[a.getAttribute('href').slice(1)] = a; });
    spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        var link = navLinks[e.target.id];
        if (!link) return;
        if (e.isIntersecting) {
          Object.keys(navLinks).forEach(function (k) { navLinks[k].removeAttribute('aria-current'); });
          link.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(navLinks).forEach(spyOn);

    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var reveal = new IntersectionObserver(function (entries, self) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('is-in');
        self.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    $$('.sec-hd, .how-card, .contact-card, .hero-proof li').forEach(function (el, i) {
      el.setAttribute('data-reveal', '');
      el.style.transitionDelay = (Math.min(i % 4, 3) * 60) + 'ms';
      reveal.observe(el);
    });
  }

  /* ---------- wiring ---------- */
  bindMessageDock();
  bindChatTip();
  polish();
  initHeroSlider();
  hydrateHeroSlides();
  renderCapabilities();
  renderRights();
  renderContact();
  paintContactAccount();
  renderFilters();
  renderProjects();
  hydrateProjects().then(loadOffer);
  hydrateProofs();
  loadMe();

  setInterval(function () {
    if (!me || !B.enabled || !B.myMessages || document.visibilityState === 'hidden') return;
    B.myMessages().then(function (rows) {
      contactThreads = rows;
      setBuyerUnreadCount(rows);
      if (!messagesShowing()) return;
      /* redrawing the open thread would throw away a half-typed reply, so while
         there is one the tabs update on their own and the thread waits */
      renderThreads({ tabsOnly: !!activeCompose() });
    }).catch(function () {});
  }, 30000);

  if (B.enabled && B.onAuth) {
    B.onAuth(function (session) {
      if (!session && me) {
        stopPresence();
        me = null;
        window.location.reload();
      }
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      pingPresence();
      if (me) loadContactMessages();
    }
  });
  $('#contactForm').addEventListener('submit', function (e) {
    e.preventDefault();
    sendContactMessage();
  });
  $('#refreshMessages').addEventListener('click', loadContactMessages);
  $('.message-fab').addEventListener('click', function () { loadContactMessages(); });

  $$('[data-open-terms]').forEach(function (el) {
    el.addEventListener('click', function (e) {
      e.preventDefault();
      openTerms(openProjectId && projectOverlay.dataset.open === 'true' ? openProjectId : null, true);
    });
  });
  $$('[data-open-project]').forEach(function (el) {
    el.addEventListener('click', function () { openProject(el.dataset.openProject); });
  });
  $('#googleBtn').addEventListener('click', startGoogle);
  $$('[data-close-auth]').forEach(function (el) {
    el.addEventListener('click', function () {
      pendingItem = null;
      try {
        localStorage.removeItem(RESUME);
        localStorage.removeItem(CONTACT_RESUME);
        localStorage.removeItem(CONTACT_DRAFT);
      } catch (e) {}
      closeOverlay($('#authOverlay'));
    });
  });
  $$('[data-close-pay]').forEach(function (el) {
    el.addEventListener('click', function () { pendingItem = null; stopPoll(); closeOverlay(payOverlay); });
  });
  $('#payAction').addEventListener('click', payActionClick);
  $$('[data-close-project]').forEach(function (el) {
    el.addEventListener('click', function () { openProjectId = null; closeOverlay(projectOverlay); });
  });
  $$('[data-close-terms]').forEach(function (el) {
    el.addEventListener('click', function () { pendingItem = null; closeOverlay(termsOverlay); });
  });
  $$('[data-close-info]').forEach(function (el) {
    el.addEventListener('click', function () { closeOverlay(infoOverlay); });
  });
  [projectOverlay, $('#authOverlay'), payOverlay, termsOverlay, infoOverlay].forEach(function (ov) {
    ov.addEventListener('mousedown', function (e) {
      if (e.target !== ov) return;
      if (ov === termsOverlay || ov === payOverlay || ov === $('#authOverlay')) pendingItem = null;
      if (ov === payOverlay) stopPoll();
      if (ov === projectOverlay) openProjectId = null;
      closeOverlay(ov);
    });
  });
  $$('[data-open-privacy]').forEach(function (el) {
    el.addEventListener('click', function () { openSiteDoc('privacy'); });
  });
  $$('[data-open-siteterms]').forEach(function (el) {
    el.addEventListener('click', function () { openSiteDoc('terms'); });
  });

  $$('[data-close-image]').forEach(function (el) {
    el.addEventListener('click', closeImage);
  });
  imageOverlay.addEventListener('mousedown', function (e) {
    if (e.target === imageOverlay || e.target.id === 'imageFull' ||
        e.target.id === 'imageCaption') closeImage();
  });
  $$('#imageOverlay [data-lb-step]').forEach(function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      stepGallery(Number(b.dataset.lbStep));
    });
  });
  document.addEventListener('keydown', function (e) {
    if (imageOverlay.dataset.open !== 'true') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); stepGallery(-1); }
    if (e.key === 'ArrowRight') { e.preventDefault(); stepGallery(1); }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = $$('.overlay[data-open="true"]').pop();
    if (!open) return;
    if (open === imageOverlay) { closeImage(); return; }
    if (open === termsOverlay || open === payOverlay || open === $('#authOverlay')) pendingItem = null;
    if (open === payOverlay) stopPoll();
    if (open === projectOverlay) openProjectId = null;
    closeOverlay(open);
  });

  termsScroll.addEventListener('scroll', checkRead);
  window.addEventListener('resize', function () {
    if (termsOverlay.dataset.open === 'true') checkRead();
  });
  [buyer, sign, buyerDate, school, locationF, typeOther].forEach(function (el) {
    el.addEventListener('input', function () {
      if (el === buyerDate) sellerDate.value = buyerDate.value;
      formMsg.dataset.err = 'false'; validate();
    });
  });
  buyerType.addEventListener('change', function () {
    syncType();
    if (buyerType.value === 'Other') typeOther.focus();
    formMsg.dataset.err = 'false'; validate();
  });
  ack.addEventListener('change', function () { formMsg.dataset.err = 'false'; validate(); });
  agreeBtn.addEventListener('click', accept);
  $('#agreeForm').addEventListener('submit', function (e) { e.preventDefault(); accept(); });

  /* Seller helper: open the page with #approve=<reference> to see the code to send. */
  function approveHelper() {
    var m = /^#approve=(.+)$/.exec(decodeURIComponent(location.hash || ''));
    if (!m) return;
    var ref = m[1].trim();
    openInfo({
      title: 'Approval code',
      sub: 'For reference <b>' + esc(ref) + '</b>',
      html: '<p>Send this code to the buyer. Typing it on their device approves the payment ' +
        'and opens the terms.</p>' +
        '<p style="font-size:34px;font-weight:800;letter-spacing:.16em;margin-top:14px">' +
        approvalCode(ref) + '</p>' +
        '<p style="margin-top:14px">It is worked out from the reference number and the salt in ' +
        '<code>PAYMENT.salt</code>. Change the salt and every code changes.</p>',
      msg: 'Only you should have this link.'
    });
  }
  if (!B.enabled) {
    window.addEventListener('hashchange', approveHelper);
    approveHelper();
  }

  sellerDate.value = today();
  buyerDate.value = today();
})();
