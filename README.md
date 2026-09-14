# EnviroSortPro — Automatic Waste Segregation

Browser simulation of the prototype, driven by the same control flow as the board.

```
Simulation/
├─ index.html                              the Build with JUDECH landing page — the
│                                          project catalog and the gated packages
├─ admin.html                              your dashboard: approve payments, issue
│                                          access codes, see signed agreements
├─ simulation.html                         the simulator page (served locally)
├─ css/landing.css                         landing page
├─ css/style.css                           simulator
├─ js/config.js                            the PUBLIC Supabase pair for the browser
├─ js/backend.js                           every call the pages make to Supabase
├─ js/landing.js                           projects + package gate + terms form
├─ js/admin.js                             the dashboard
├─ js/app.js                               loop() / detectionMaintenance() /
│                                          handleWasteDetection() transcribed
└─ EnviroSortPro/
   ├─ EnviroSortPro.ino                    your sketch, unchanged
   └─ _alternative_state_machine.txt       an optional non-blocking rewrite
```

## Run it with a live server

```bash
cd "/mnt/c/Users/edujk/Desktop/Simulation"
python3 -m http.server 5500
```

then open <http://localhost:5500>

Or: VS Code → right-click `index.html` → *Open with Live Server*.

The landing page opens first: the JUDECH catalog — web systems, mobile apps and PWAs,
and hardware builds, for thesis, capstone or business operations.

Everything on it comes from `js/landing.js`:

| Edit | To change |
|---|---|
| `PROJECTS` | the project cards, their packages and what each one unlocks |
| `CAPABILITIES` | the four *What I build* cards |
| `CATEGORIES` / `kind` | the filter chips above the grid (`web`, `mobile`, `embedded`, `any`) |
| `ITEM_TYPES` | the kinds of thing a package can contain — the list a buyer sees inside a project |
| `RIGHTS` | the two ownership tracks and their wording |
| `CONTACT` | your Facebook, Messenger, Instagram, Discord, email, phone and Shopee details — empty ones are never shown |
| `PAYMENT` | the QR image and how it is cropped, account name and number, the methods list, and the approval salt |

A project is either `status: 'ready'` — its package opens once the Terms & Conditions
form is signed, once per project — or `status: 'soon'`, where the card says *Coming soon*
and lists what is planned. Each project names its own `items`, so a web system offers a
live demo, a database and a deployment guide while a machine offers a simulation, a
wiring diagram and a parts list.

EnviroSortPro is the ready one. Its **Live simulation** card opens `simulation.html`.

### Supabase credentials

`.env` holds the keys, `.env.example` is the shareable copy, and `.gitignore` keeps the
real one out of any repo.

**This folder is the website root.** A plain static server hands out dotfiles — verified
locally, `GET /.env` returned HTTP 200 with the whole file. Before real keys go in:
move `.env` out of the served folder, serve only a subfolder, or deploy through a host
that blocks dotfiles (Netlify, Vercel, Cloudflare Pages).

| Key | Where it may go |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | fine in the browser — Row Level Security is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD` | server or Edge Function only. It bypasses every RLS policy |

A browser cannot read `.env`. Until there is a build step, the public pair has to be
written into a small JS config for the page to use it — and only ever the anon key.

### Supabase migrations

Schema lives in `supabase/migrations/`, applied with the CLI rather than pasted into the
SQL editor, so the database has a history you can re-run on a fresh project.

| Migration | What it adds |
|---|---|
| `…120000_init_helpers` | `pgcrypto`, `set_updated_at()`, an `admins` table and `is_admin()` |
| `…120100_projects` | the catalog table — public to read, admin to change |
| `…120200_payments` | payment submissions, `pending / approved / rejected`, admin-only RLS |
| `…120300_agreements` | signed terms: who, how they signed, which version |
| `…120400_functions` | the four RPCs buyers use, approve/reject for you, and a `payments_inbox` view |
| `…120500_storage` | private `receipts` and `signatures` buckets — upload-only for buyers |
| `…120600_seed_projects` | the nine projects as they stand today (delete if unwanted) |
| `…120700_access_grants` | access codes for buyers who paid elsewhere, and the RPCs to issue, redeem and cancel them |
| `…090000_agreement_buyer_details` | buyer type, school and location on agreements; `sign_agreement` takes them |
| `…100000_agreement_attachments` | supporting files on an agreement, and the admin-only `attachments` bucket |
| `…110000_project_content` | the rest of a project — intro, links, source files, materials, run steps — plus the public `project-files` bucket |
| `…120000_google_accounts` | `user_id` / `user_email` on payments and agreements, stamped from the session; buyers may read their own rows |
| `…130000_user_presence` | per-session sign-in, heartbeat, sign-out and last-online activity for the admin Accounts tab |
| `…140000_project_images` | optional project cover image URL, uploaded through the existing public project-assets bucket |
| `…150000_rights_default` | yours-to-use ownership default; transfer remains an explicit admin selection |
| `…160000_contact_messages` | private user messages, buyer reply history and the admin Messages inbox |
| `…190000_project_faqs` | admin-managed questions and answers shown inside each project |
| `…200000_custom_package_items` | ordered built-in or custom package cards with editable descriptions and uploaded attachments |
| `…210000_seller_legal_name` | uses Jude Michael Martinez, rather than the JUDECH brand, as the seller on agreements |

```bash
supabase init            # only if supabase/config.toml does not exist yet
supabase link --project-ref <your-ref>
supabase db push         # applies every migration above
```

To add another change later, `supabase migration new <name>` and edit the file it makes —
never edit a migration that has already been pushed.

**How the security is arranged.** Signed-out visitors may read the catalog only. Google-
authenticated buyers use server functions for payments, status, agreements, access codes
and contact messages. They have no direct write access to `payments` or `agreements`, and
row-level security prevents reading another buyer's records. A payment claim token works
only together with the Google account that owns it.
Approval is `approve_payment(id)`, which refuses anyone not in `admins`.

**After the first push**, sign up in Supabase Auth and add yourself:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'you@example.com';
```

### The message dock

The buyer's side of the conversation used to be a card buried at the bottom of the contact
section. It is now a **panel docked in the corner**: the floating **Messages** button brings
it up from the bottom-right, the chevron in its header puts it away again, and Escape does
the same. What is half-typed in it survives being put away, because the panel is only hidden,
never rebuilt.

It can be opened from three places — the floating button, the hero's *Tell me what you need*,
and **Message me right here** in the contact section — and it carries the thread history
underneath the compose box, so a reply is read in the same place it was asked for. The
floating button shows a badge for unread replies and gives a small knock when one arrives.
On a phone the panel becomes a bottom sheet that slides up the full width of the screen.

The dashboard reads the same conversation from the other end, restyled to match: the history
is the object on the page, bubbles left and right, and the composer sits beside it as one
control rather than three stacked ones.

### Getting in touch

The **Contact** band includes email, phone call, SMS, Facebook, Messenger and a copyable
Discord username. Instagram remains hidden until its profile URL is added to `CONTACT`.
Signed-in users can also send a titled private message through the site and return to the
same section to read the admin's reply.

### Signing in with Google

Browsing the catalog stays open to everyone. Clicking any project first asks the buyer to
sign in with Google; project details, payment/access-code redemption, terms and files are
then tied to that account.

The page remembers what they were about to open, sends them to Google, and when they come
back it reopens that project and carries straight on to payment. Their name and email
prefill the payment and terms forms, and the payment panel says which account it is being
recorded against. The header shows their picture, name and email, with **Sign out**.

The page sends a small presence heartbeat while it is open. The dashboard's **Accounts**
tab shows the verified account, provider, active sessions, sign-in, sign-out and last-online
times. A session is considered active when it checked in within the last two minutes, so a
closed browser becomes offline even when it could not send an explicit sign-out event.

`submit_payment`, `redeem_access_code` and `sign_agreement` require an authenticated
session and stamp `user_id` and
`user_email` **from the session on the server** — never from anything the browser sends.
Two rules follow from that: a payment made while signed in can only be signed for by that
same account, and an access code, once redeemed by an account, cannot be redeemed by a
different one. The dashboard shows the account on each payment and on each agreement.

If Supabase is not configured the page never mentions Google at all and behaves exactly as
it did before.

**Two things must be set in Supabase or the redirect fails:**

1. **Authentication → Providers → Google** — client ID and secret (done).
2. **Authentication → URL Configuration** — *Site URL* and *Redirect URLs* must include
   every address the page is served from, e.g. `http://localhost:5500` while testing and
   your real domain later. Google itself only needs the one callback you already set:
   `https://<project-ref>.supabase.co/auth/v1/callback`.

`admin.html` offers Google as well, next to email and password — either way the account
still has to be listed in `public.admins`.

### Keeping a Free-plan project awake

Supabase's rule, from [its own page on pausing](https://supabase.com/docs/guides/platform/free-project-pausing):
a Free-plan project is paused when it "does not receive sufficient user database activity over
the past week"; "a few user requests to the database each day" is enough; a paused project can
be restored from the dashboard for up to a year; and paid plans are never paused. Visitors
loading the catalog count as activity, so a site with any traffic keeps itself up — but a
quiet week must not take the shop offline.

Three layers, cheapest first, and any one of them is enough on its own:

1. **An outside ping every three days** — the thing the rule is actually written against.
   `keepalive/github-workflow.yml` is ready to drop into a GitHub repository as
   `.github/workflows/keepalive.yml`: it POSTs to `rest/v1/rpc/heartbeat` with the public anon
   key and writes one row. Free on a public repo, seconds of Actions time on a private one, and
   it has a *Run workflow* button for testing. Not on GitHub? `keepalive/ping.sh` is the same
   call for any cron or for [cron-job.org](https://cron-job.org) (POST, the two `apikey` /
   `Authorization` headers, body `{"p_source":"cron"}`).
2. **`pg_cron` inside the database**, scheduled by the migration where the extension is
   available, inserting a heartbeat daily at 11:17 Manila. Belt and braces: community reports
   say internal writes count, the doc does not promise it, so it is never the only layer.
3. **The pulse in the dashboard header** — *Database active 3h ago via github-actions · 4
   beats this week*. Green under two days, amber to five, red past five (two days from a
   pause), with a **Ping now** button that writes a beat by hand. Reading the dashboard is
   itself activity, so opening it once a week would also do.

The idea of a tab that pings "every day even if I don't open it" cannot work as stated — a
browser tab only runs while it is open. What that idea *does* get right is the log, which is
why the pulse shows where the last beat came from and how many landed this week. When the
shop is paying its way, the clean answer is the Pro plan: no pausing, no pings, and the
backups and compute a business should have anyway.

Behind it: `public.heartbeats`, `heartbeat(source)` (anon may call; it can only insert a
timestamp, and it prunes itself to sixty days) and `heartbeat_status()` for the dashboard.

### Blocking an account, and how fast anyone can write

Two defences, answering different problems.

**A block is a judgement about a person.** Users tab → **Block this account**: you are asked
for a reason (private to you) and optionally a number of hours, blank meaning until you lift
it. A blocked account cannot open a conversation, add to one, submit a payment or redeem a
code. What they already bought and signed for **stays theirs** — a block is not a refund, and
the project page still opens everything they paid for. Their side of the chat says so plainly
rather than failing silently. Admins cannot be blocked, and you cannot block yourself.

**A rate limit is arithmetic that applies to everyone**, so it is set where no honest person
will meet it:

| Limit | Why |
|---|---|
| **8 seconds** between messages | stops a double-tap and a held-down key |
| **5 new conversations** per hour | spam arrives as new subjects, not as replies |
| **25 messages** per hour, all threads | the ceiling on a flood |

A single flat cooldown — 30 seconds on everything, say — punishes the person who remembers
one more detail right after sending, which is most people. A short gap with a generous hour
gives the same protection and is felt only by someone abusing it. All three are enforced in
`check_message_rate()` inside the send functions, **server-side**, because a limit the browser
enforces is not a limit. Refusals come back as ordinary messages in the chat ("one moment —
you can send the next message in 4 seconds"). You are never rate-limited in your own inbox.

Behind it: `public.user_blocks` (with `is_blocked()` and admin-only `set_user_block()`), and
`public.user_directory`, the view the Users tab reads — presence joined to message and payment
counts and the block state.

### Two site notices, and the one signed agreement

Three legal texts now live on the page, and they are deliberately not the same thing:

| Where | What it is | Signed? |
|---|---|---|
| **Terms** in the top bar, and the form at purchase | the **package Terms &amp; Conditions**, sections 1–13 — what you may do with the files | yes, with a signature and a date, filed under Signed agreements |
| **Privacy** in the footer | what the site records, why, who can see it, how long it is kept, what you can ask for | no — read only |
| **Terms of use** in the footer | the rules for using the *website*: no reverse engineering, no scraping, no getting round the gate, no cloning the site | no — read only |

Both footer notices are plain HTML inside `index.html` (`#privacyDoc`, `#siteTermsDoc`, in a
hidden `#siteDocs` block) and open in the info modal, so there is one copy of the wording and
it can be read, printed or searched. Each one says at the top that it is for reading and that
it does not replace the agreement signed at purchase. The privacy notice is written against
what the site actually does — Google sign-in, payment submissions, signed agreements,
messages, presence — and names Supabase and Google as the two processors that necessarily
hold the data. Update the date at the bottom of a notice whenever you change its wording.

### Proof of legitimacy

A section on the landing page for evidence, sitting between **Projects** and **Rights**:
finished builds, handovers, client messages, receipts, certificates, clips of a machine
running. It is a tile grid rather than a card grid — squarer, photo-led, and each tile is
labelled with **what the thing is** before what it is called, because evidence reads
differently from an offer.

Each tile carries a label (*Delivered build*, *Client message*, *Payment received* …), a
title, a line of description, an optional date, **a gallery of photos** and optionally a
video. A tile with nothing to show is refused, in the form and again in the database.

**The gallery.** A proof holds as many photos as it needs, in an order you set, and **each
photo carries its own caption**. The first is the cover; the tile shows a *3 photos* badge
and reads *Look through*. Opening it gives a viewer you page with the arrows, the arrow keys
or a swipe of the mouse, with that photo's caption underneath and a *2 of 5* counter.

**The video.** Either kind works. Paste a **YouTube or TikTok link** and the viewer offers a
*Watch on YouTube* button that opens it on its platform. Or **upload a clip** — up to
**64 MB**, MP4, WebM or MOV — and it plays inside the viewer as the first slide, with
ordinary player controls. Photos upload several at a time.

> The 64 MB ceiling is set on the storage bucket, but a Supabase project also has its own
> global upload limit (Dashboard → **Storage → Settings**). Whichever is lower wins, so if a
> 40 MB clip comes back as *Payload too large*, that global setting is what needs raising.

The whole section is **absent until there is something published in it** — no empty state,
no placeholder. The nav link and the alternating pane colours either side rearrange
themselves accordingly, so a page with no proof still alternates white / green cleanly.

**In the dashboard:** a **Proof** tab holding a **table** — thumbnail, what it is, title,
date, what is attached, and whether it is on the page — so a dozen entries stay scannable.
**Edit** opens that row in place, directly underneath itself; there is no modal, so the list
never moves out from under you, and **Cancel** closes it again. **Add a proof** opens a blank
editor above the table.

The editor holds the label, the tile's date, title, description, the photo list, the video
field and its uploader, position, and a *Show it on the page* tick. Saving closes the editor,
rebuilds the table, flashes the row that changed and says **Saved "…" — 3 of 4 showing on the
page**; if the entry is unpublished it says that too, since that is the thing you would most
want to know.

**Each photo has its own date** beside its caption — the day that payment landed, that build
was handed over. Visitors see it in the viewer as they page through, so a receipt is dated
evidence rather than a picture. The tile keeps its own overall date separately.
Unpublished entries stay in the list, dimmed and dashed, visible only to you. The counter at
the top says how many of them the public can actually see.

Table: `public.proofs`, readable by anyone but only where `published` (or where you are the
admin), writable only by an admin. Photos go to the same public `project-files` bucket as the
project covers.

### Light and dark

Both pages carry a switch in the top bar: a **moon** while you are in the light theme, a
**sun** while you are in the dark one — the icons rotate past each other as it flips. The
choice is kept in `localStorage` under `judech.theme`, and a four-line script in `<head>`
paints it before the first frame so the page never flashes the wrong theme on the way in.
Until someone presses it, the page simply follows the operating system.

Pressing it opens the incoming theme out of the button in a circle until it covers the
screen. Where the browser has the View Transitions API the *real* page is revealed through
that circle; everywhere else a disc of the incoming background makes the same sweep and the
page changes underneath it, so the swap is never seen. `prefers-reduced-motion` gets the
switch with no animation at all.

All of it is `js/theme.js` plus the tokens the stylesheet already had — the three states
(`no attribute` = follow the system, `data-theme="light"`, `data-theme="dark"`) were built
into every colour block from the start, so nothing else needed changing.

### Getting into the dashboard

Installed as an app there is no address bar, so there is nowhere to type
`/admin.html` — and a Dashboard link in the header would hand the door to every visitor.
So the door is the headline itself: **five taps on "Turning Ideas Into Systems That Work."**
and it opens.

The first two taps are silent, because a visitor who taps a heading twice should see nothing
happen. From the third it counts down — *2 more*, *One more* — so the person who knows the
gesture can tell it is working. The taps have to be within two and a half seconds of each
other: it is a gesture, not five taps over a lunch break.

Three things keep it private rather than merely tucked away:

* **Nothing is stored.** The gesture unlocks the door for this visit only; the next launch
  starts from five taps again. That is the point of it.
* **No admin URL is in the page source.** The link is built in JavaScript at the moment it is
  asked for, so `admin.html` appears nowhere in the delivered HTML until the gesture is made.
  `robots.txt` disallows it and the page itself is `noindex, nofollow` besides.
* **The manifest no longer carries a Dashboard shortcut.** It used to, which meant anyone
  long-pressing the app icon was offered the door — that defeats the gesture entirely.

What opens is the ordinary info panel, so it closes with Escape, the backdrop, the × or the
phone's Back button like every other view. It only *shows* the door: signing in still needs
the admin account. The gesture is in the `adminDoor()` block at the foot of `js/landing.js`;
change `NEEDED` or `WINDOW` there.

One thing to know on a phone: `admin.html` offers both email-and-password and Continue with
Google. In an installed app the Google route leaves the manifest's scope, which Android
handles in an in-app browser and returns from cleanly, but iOS may finish the sign-in in
Safari rather than back in the app. The email-and-password form works in the installed app
either way.

### When a token has gone stale

An access token lasts an hour. A phone asleep, a tab left open overnight, an installed app
resumed from the background — all three come back holding a dead one, and the first call out
is answered `401` rather than answered. On the dashboard that first call is
`rpc/is_admin`, which is why it was the one showing up in the console.

The old code treated any failure of that check as final: it printed the raw error and
dropped to the sign-in screen, throwing away a session that was one refresh away from
working. Three things changed.

**`withFreshToken()` in `js/backend.js`.** If a call comes back looking like an auth failure
— a 401, PostgREST's `PGRST301`, or a message mentioning the JWT — it asks for a new token
and puts the same call again, exactly once. `unwrap()` now keeps `status` and `code` on the
error it throws, which is what makes that judgement possible; `B.isAuthError(err)` is the
same test, exported. It wraps `is_admin` and the two calls that fire on a timer
(`record_presence`, `heartbeat`), because those are the ones that meet a token which died
while the app was in the background.

**A session that arrives *after* boot is now acted on.** `admin.js` only ever handled the
session going *away*. If `getSession()` resolved before supabase-js had finished reading the
URL hash — which is exactly what a Google redirect produces — the page sat on the sign-in
form with a perfectly good session behind it. An id check keeps a routine token refresh from
rebuilding the dashboard under the person using it.

**A failure is now clean.** If the refresh cannot save it either, the half-session is let go
of rather than left looking signed in: presence stops, `signOut()` runs, and the screen says
*"That sign-in has expired. Please sign in again."* The reason the server actually gave is
put in the console with `console.warn`, so an unexpected cause is still diagnosable. And
`load()` moved outside that check, so a table that will not load is never reported as an
expired sign-in.

One 401 in the console is still expected and correct in this situation: there is no way to
know a token is dead until the server says so. What should follow it now is a
`refreshSession` and a second, successful `is_admin` — not a trip back to the sign-in form.

The buyer side's calls are not wrapped. They run when someone opens a project or the chat
rather than on load, so supabase-js's own background refresh has normally already dealt with
it; if one ever does show the same 401, `withFreshToken` drops around it the same way.

### The way back

A project opens over the catalog. A package item opens over the project. The image attached
to that item opens over *that*. Three layers deep, the only way out used to be a small × in
the corner — and pressing the phone's Back button left the site altogether. Installed as an
app there is no browser Back at all, so that × was the only door in the building. Worse, an
image or a PDF attached to a package opened in a **new browser tab**, which on a phone means
the buyer is somewhere else entirely with nothing pointing home.

`js/backstack.js` is the fix, and both `landing.js` and `admin.js` use it. Every view that
opens over another one registers itself:

```js
JudechBack.open({ key, el, close, backLabel })
```

and gets two things back. **One history entry**, so the phone's own Back gesture — or a
swipe, or the browser button — closes that view and nothing else. And, when `backLabel`
names the view it came from, **a labelled button drawn into its header**: "‹ EnviroSortPro"
reads as a way home in a way that × never did. It sits above the heading rather than beside
the ×, because it is not another way of closing this view — it names the one underneath and
goes there.

Three rules keep the two directions honest:

* **Back pressed by the user** arrives as `popstate`: pop the top view, run its closer.
* **Close pressed in the page** — the ×, the footer button, the backdrop, Escape, the back
  button itself — goes through `dismiss()`, which runs the same closer *and* unwinds the
  matching history entry, swallowing the `popstate` that causes so the view is not closed
  twice. That closer carries the state each view has to let go of, so a swipe backwards
  cannot leave a payment poll ticking behind it.
* **The flow moving on by itself** — signed in, so here is the project; paid, so here are
  the terms — calls `retire()` instead, and the view that follows takes the departing one's
  place. One step forward on screen stays one press of Back to undo, rather than two.

A view shown over another does not close the one beneath it: `veil()` hides it, it keeps its
place in the stack, and `unveil()` brings it back. That is why the image viewer returns you
to the file list you opened it from and not to the top of the page.

And the attachments themselves: an image or a clip now opens **in the viewer, in the page**,
titled with the file's own name and with the way back to the panel it came from. Several
pictures under one item become one gallery, so *View* on the third photo opens at the third
photo and the arrows walk the rest. Anything that genuinely needs the browser's own
viewer — a PDF, a zip — still says **Open in a tab** rather than *View*, so the label tells
you it is a door out before you press it.

### Installing it, and the small screen

All three pages are one installable app. `manifest.webmanifest` names it, gives it the
`</>` mark at 192 and 512 (plus maskable copies, so Android's own shape does not crop the
glyph), and lists three shortcuts — the simulator, the projects section, the dashboard —
that a long-press on the home-screen icon opens directly.

`sw.js` is the whole offline story, and its shape follows the shape of the site:

* **Pages** are fetched from the network first and kept as they come back, because a
  catalog or a dashboard is only worth reading when it is current. A page you have opened
  before still opens with the network gone; one you have not falls back to `offline.html`,
  which is served from your own device and says so.
* **Our css, js and icons** are answered from the cache at once and refreshed behind the
  page. The `?v=` on every asset URL means a new build asks for a URL the cache has never
  seen, so there is no moment when a new page is wearing an old stylesheet.
* **Supabase is never cached.** Sign-in, payments, messages, presence — every one of those
  is somebody's live account state, and `isLiveData()` sends them straight past the worker.

Bump `VERSION` in `sw.js` (and `ASSETV`, if the `?v=` changed) to retire everything cached
under the old one. The new worker does *not* take over on its own: it waits, the page says
"a newer version is ready", and only the **Reload** button in that notice hands it control
— nobody loses a half-typed message to a refresh they did not ask for.

`js/pwa.js` carries the four things that are visible. The install offer appears once and a
"Not now" is remembered for a fortnight (`judech.pwa.snoozed`); it also waits its turn
behind the chat greeting rather than stacking on top of it, and lifts the message button
out of its way by however tall it actually is. iOS never fires `beforeinstallprompt`, so
Safari gets the only thing that works there — the two-step *Share → Add to Home Screen*
instruction, from the second visit on. A pill says when the connection has gone and when it
is back. And because the on-page theme switch changes what is painted without changing what
the system reports, the same file writes the current `--ground` into the `theme-color` tags
so the bar above the page follows the switch.

See **The way back** above for the history-aware back button that goes with all of this —
in an installed app it is the only Back there is.

`css/mobile.css` is loaded last by all three pages and only ever uses the custom properties
both design systems already define, so one rule comes out warm on the catalog and cool in
the simulator. It carries:

* the safe-area insets that `viewport-fit=cover` makes the page responsible for — gutters,
  the sticky header in an installed window, and everything pinned to the bottom edge;
* **16px on every field below 900px.** Safari zooms the layout in whenever it focuses a
  control smaller than that and never zooms back out. This is the one place `!important`
  earns its keep: the pages set field sizes from rules carrying an id;
* `min()` on the `auto-fit` grid tracks. `minmax(280px, 1fr)` is a promise a 320px screen
  cannot keep, and it was the reason a phone could scroll sideways;
* 44px touch targets under `pointer: coarse` only — a mouse does not need them, and the
  desktop layouts were drawn for the size they are;
* dialogs as bottom sheets below 640px, sized in `dvh` so the address bar sliding away does
  not cut off the last line;
* a tablet layer between 641 and 1024px, a landscape layer for phones under 520px tall, and
  `display-mode: standalone` rules that pad for the notch and drop the install button —
  an install button inside an installed app is a joke at the user's expense.

### The name on the page

The public identity is **Build with JUDECH** — that is the wordmark in the top bar, the
hero, the page title and the footer, with *JUDECH* picked out in the accent colour
(`.brand b em`). In running sentences the short name stays **JUDECH** ("Message JUDECH",
"Waiting for JUDECH to check this"), because the full wordmark reads badly mid-sentence;
`BRAND` in `js/landing.js` holds that short form and is what every generated string uses.
Change the wordmark in `index.html`, `admin.html` and the footer; change the short name in
`BRAND`.

### Payment, then terms, then files

A ready project walks three steps, shown as chips inside the project:

1. **Payment** — two ways in, side by side:
   - **Pay now with the QR** — the GCash QR, then sender name, method, reference number,
     amount, date, an optional way to reach them, and a screenshot of the receipt. The
     receipt goes to the private `receipts` bucket and the details to `submit_payment`.
     The buyer's page keeps only a *claim token* — their key to their own row.
   - **I already paid elsewhere** — for buyers who settled on Facebook, Shopee,
     Messenger or in cash. They type the **access code** you issued from the dashboard;
     `redeem_access_code` turns it into an already-approved payment. No second payment.
2. **Approval** — the page shows *Waiting for JUDECH to check this* and asks the server
   every 12 seconds while open (plus a *Check now* button). You approve or reject from
   `admin.html`; a rejection carries your note to the buyer, who can resubmit.
3. **Terms** — opens only once approved. The drawn signature goes to the `signatures`
   bucket and the record to `sign_agreement`, which refuses unless the payment is really
   approved. Then the files open.

Cancelling an access code, or rejecting a payment you had approved, locks that buyer's
page again the next time it checks in.

**No config? Local mode.** If `js/config.js` is empty (or the Supabase script fails to
load), the page falls back to the earlier device-only gate: payments stay in the buyer's
browser and you unlock them with a six-character code from `index.html#approve=<ref>`
(or `#approve=ELSEWHERE-<project-id>` for the paid-elsewhere tab). Handy for demos;
not what a live shop should run on.

### The admin dashboard

`admin.html` — sign in with your Supabase Auth email and password.

| Tab | What you do there |
|---|---|
| **Payments** | pending payments with the receipt (via a signed URL), reference, amount, contact. Approve or reject, with an optional note the buyer sees. An approved payment also carries **Package release** — release or hold each item of that project's package for that one buyer. Filters for approved / rejected / all; a badge counts what is waiting; refreshes itself every 30 s |
| **Messages** | an inbox: people on the left — one row per Google account, their threads underneath, unread counts on both — and the chosen conversation on the right as a chat, with the composer under it. Enter sends; opening a thread marks it read |
| **Accounts** | active sessions, provider, last sign-in, explicit sign-out and last-online time |
| **Users** | every account that has signed in: presence, how much they have written, how many payments, and the switch that blocks a nuisance. Filters for active / have messaged / blocked |
| **Clients** | every buyer, every project they have touched, and the state of each component in it — delivered, paid but unsigned, waiting for you, or unpaid with what it would cost them. Totals per buyer: paid, waiting, not taken yet |
| **Access codes** | issue a code for a buyer who paid elsewhere: project, name, channel, optional note and expiry, and which items of the package the code opens. Copy it, send it. Cancel it later if you must |
| **Projects** | the catalog itself — cards, package items, per-component prices and private customer links. See below |
| **Signed agreements** | who signed what, when, how, against which terms version — with the signature as drawn. **View full agreement** opens the whole thing: the record (seller, project, rights track, buyer name, type, school, location, signature, acknowledgment, timestamps, the payment it belongs to, contact, device) followed by all thirteen sections of the terms, with **Open / print** and **Download** for a self-contained file |

**First-time setup, in order:**

1. `supabase db push` (see below).
2. In the Supabase dashboard → Authentication → Users, create your own user
   (email + password).
3. Open `admin.html`, sign in. It will stop you with the exact SQL to run once —
   `insert into public.admins …` with your user id filled in. Run it, reload.

`js/config.js` holds the project URL and anon key and is loaded by both pages. Both are
public by design; the service role key never goes there.

### Supabase credentials

`.env` holds the keys, `.env.example` is the shareable copy, and `.gitignore` keeps the
real one out of any repo.

**This folder is the website root.** A plain static server hands out dotfiles — verified
locally, `GET /.env` returned HTTP 200 with the whole file. Before real keys go in:
move `.env` out of the served folder, serve only a subfolder, or deploy through a host
that blocks dotfiles (Netlify, Vercel, Cloudflare Pages).

| Key | Where it may go |
|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | fine in the browser — Row Level Security is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD` | server or Edge Function only. It bypasses every RLS policy |

A browser cannot read `.env`. Until there is a build step, the public pair has to be
written into a small JS config for the page to use it — and only ever the anon key.

### Supabase migrations

Schema lives in `supabase/migrations/`, applied with the CLI rather than pasted into the
SQL editor, so the database has a history you can re-run on a fresh project.

| Migration | What it adds |
|---|---|
| `…120000_init_helpers` | `pgcrypto`, `set_updated_at()`, an `admins` table and `is_admin()` |
| `…120100_projects` | the catalog table — public to read, admin to change |
| `…120200_payments` | payment submissions, `pending / approved / rejected`, admin-only RLS |
| `…120300_agreements` | signed terms: who, how they signed, which version |
| `…120400_functions` | the four RPCs buyers use, approve/reject for you, and a `payments_inbox` view |
| `…120500_storage` | private `receipts` and `signatures` buckets — upload-only for buyers |
| `…120600_seed_projects` | the nine projects as they stand today (delete if unwanted) |
| `…120700_access_grants` | access codes for buyers who paid elsewhere, and the RPCs to issue, redeem and cancel them |
| `…090000_agreement_buyer_details` | buyer type, school and location on agreements; `sign_agreement` takes them |
| `…100000_agreement_attachments` | supporting files on an agreement, and the admin-only `attachments` bucket |
| `…110000_project_content` | the rest of a project — intro, links, source files, materials, run steps — plus the public `project-files` bucket |
| `…120000_google_accounts` | `user_id` / `user_email` on payments and agreements, stamped from the session; buyers may read their own rows |
| `…130000_user_presence` | per-session sign-in, heartbeat, sign-out and last-online activity for the admin Accounts tab |
| `…140000_project_images` | optional project cover image URL, uploaded through the existing public project-assets bucket |
| `…150000_rights_default` | yours-to-use ownership default; transfer remains an explicit admin selection |
| `…160000_contact_messages` | private user messages, buyer reply history and the admin Messages inbox |
| `…190000_project_faqs` | admin-managed questions and answers shown inside each project |
| `…200000_custom_package_items` | ordered built-in or custom package cards with editable descriptions and uploaded attachments |
| `…210000_seller_legal_name` | uses Jude Michael Martinez, rather than the JUDECH brand, as the seller on agreements |

```bash
supabase init            # only if supabase/config.toml does not exist yet
supabase link --project-ref <your-ref>
supabase db push         # applies every migration above
```

To add another change later, `supabase migration new <name>` and edit the file it makes —
never edit a migration that has already been pushed.

**How the security is arranged.** Signed-out visitors may read the catalog only. Google-
authenticated buyers use server functions for payments, status, agreements, access codes
and contact messages. They have no direct write access to `payments` or `agreements`, and
row-level security prevents reading another buyer's records. A payment claim token works
only together with the Google account that owns it.
Approval is `approve_payment(id)`, which refuses anyone not in `admins`.

**After the first push**, sign up in Supabase Auth and add yourself:

```sql
insert into public.admins (user_id, email)
select id, email from auth.users where email = 'you@example.com';
```

### Getting in touch

The **Contact** band includes email, phone call, SMS, Facebook, Messenger and a copyable
Discord username. Instagram remains hidden until its profile URL is added to `CONTACT`.
Signed-in users can also send a titled private message through the site and return to the
same section to read the admin's reply.

### Signing in with Google

Browsing the catalog stays open to everyone. Clicking any project first asks the buyer to
sign in with Google; project details, payment/access-code redemption, terms and files are
then tied to that account.

The page remembers what they were about to open, sends them to Google, and when they come
back it reopens that project and carries straight on to payment. Their name and email
prefill the payment and terms forms, and the payment panel says which account it is being
recorded against. The header shows their picture, name and email, with **Sign out**.

The page sends a small presence heartbeat while it is open. The dashboard's **Accounts**
tab shows the verified account, provider, active sessions, sign-in, sign-out and last-online
times. A session is considered active when it checked in within the last two minutes, so a
closed browser becomes offline even when it could not send an explicit sign-out event.

`submit_payment`, `redeem_access_code` and `sign_agreement` require an authenticated
session and stamp `user_id` and
`user_email` **from the session on the server** — never from anything the browser sends.
Two rules follow from that: a payment made while signed in can only be signed for by that
same account, and an access code, once redeemed by an account, cannot be redeemed by a
different one. The dashboard shows the account on each payment and on each agreement.

If Supabase is not configured the page never mentions Google at all and behaves exactly as
it did before.

**Two things must be set in Supabase or the redirect fails:**

1. **Authentication → Providers → Google** — client ID and secret (done).
2. **Authentication → URL Configuration** — *Site URL* and *Redirect URLs* must include
   every address the page is served from, e.g. `http://localhost:5500` while testing and
   your real domain later. Google itself only needs the one callback you already set:
   `https://<project-ref>.supabase.co/auth/v1/callback`.

`admin.html` offers Google as well, next to email and password — either way the account
still has to be listed in `public.admins`.

### Payment, then terms, then files

A ready project now walks three steps, shown as chips inside the project:

1. **Payment** — the GCash QR at `images/qrgcash.jpg`, and a form: sender name, method,
   reference number, amount, date and a screenshot of the receipt. The card is a square
   crop zoomed onto the code itself (`PAYMENT.qrZoom` / `PAYMENT.qrFocus`), with a link to
   the full-size poster for anyone paying on the same phone. Swap in a plain square QR and
   set the zoom to `1` and the focus to `'50% 50%'`; clear `PAYMENT.qr` entirely and a
   labelled sample QR is drawn instead. The image is downscaled to 1000&nbsp;px and stored with
   the record; if it blows the browser's storage quota it is dropped and the buyer is told
   to send it directly.
2. **Approval** — the payment sits as *Waiting for approval*. The buyer can copy the
   details, download their receipt, or message you. You send back a six-character
   **approval code**; typing it approves the payment on their device.
3. **Terms** — only then does the signature form open, and only after that do the files.

**Working out a buyer's code:** open the page as `index.html#approve=THEIR-REFERENCE` and
it shows the code to send. The code is derived from the reference number and
`PAYMENT.salt` — change the salt and every code changes.

Be clear-eyed about what this is: the code is computed in the browser, so someone who
reads the page source could work one out. It is a courtesy gate that keeps honest buyers
in step with you, not access control. Real verification — checking a payment against your
own records before the files unlock — needs a small backend.

### Editing the catalog

The **Projects** tab is the catalog. Each row opens an editor in four parts:

- **The card** — cover image, name, tagline, audience, kind, status, rights, icon,
  position, price, blurb and tags. Upload a JPG, PNG, WebP or GIF (up to 8 MB), or paste
  an image URL.

  **Framing the cover.** The card and the top of the project details both crop to 16:9, and
  the interesting part of a photo is rarely in the middle. So the preview *is* the card:
  **drag the picture inside it** and the image moves under a fixed frame, with a
  rule-of-thirds grid while you drag; a **zoom** slider pushes it further in. Prefer nothing
  cropped at all? Switch to **Show the whole image** and it is letterboxed instead of
  filled. **Centre it again** resets. What you set is what the visitor sees — the same three
  values (`image_fit`, `image_focus`, `image_zoom`) drive the catalog card, the project
  header and the dashboard's own mini card. And the crop is only about what is *shown*:
  clicking the cover on the project page opens the whole image, uncropped, in a viewer. Rights default to **Yours to
  use — JUDECH keeps the original**. Selecting ownership transfer triggers a separate
  confirmation before the project can be saved.
- **Inside the package** — build the exact list of items, each with its type, title,
  description, icon, attachment, **price on its own** (blank means it only comes with the
  package) and **when the buyer gets it** (see *Releasing a package in stages* below), plus
  the intro paragraph. A project set to *coming soon* files those items
  under `planned`, so its card lists them as planned instead of opening them.
- **What each one opens** — a link per item: the guidelines PDF, the wiring diagram, the
  live demo, the simulation. Type an address or press **Upload** and the file goes to the
  public `project-files` bucket and fills the address in. Leave one blank and that item
  shows a short note instead of a file.
- **Lists** — source files, materials and run steps, one per line, columns separated by a
  vertical bar: `Arduino Uno R3 | Controller running the sketch | 1`.

- **Preview links — public** — a demo video on YouTube, a build clip on TikTok, a live site:
  paste the address and it appears on the project as a button that opens in a new tab. These
  sit **outside the payment**, which is the point — they are what convinces someone to buy.
  The platform is read off the address, so the button carries the right logo and names itself
  (*Watch on YouTube*) unless you type your own label; a small line underneath is optional.
  A project that has one shows a **Watch it first** chip on its catalog card. Anything that
  should stay behind the payment goes in *Inside the package* instead, where an item's
  attachment field takes a URL just as happily as a file.
- **Private links for one customer** — generate a link that shows this project to one
  person, with only the components they asked for and the price you quoted. See *Private
  links for one customer* below.

**New project** and **Delete** are there too. The id is lowercased and stripped of
punctuation on a new project, and cannot be changed afterwards — payments and agreements
point at it.

**Where the page gets its catalog.** On load, `js/landing.js` asks Supabase for the
projects table. Rows there win; if the table is empty, the fetch fails, or Supabase is not
configured, the built-in `PROJECTS` array keeps the page working exactly as before. So the
dashboard is the source of truth once you have pushed the migrations, and nothing breaks
if you have not.

The `project-files` bucket is **public to read** — the same as the diagrams and README the
site already serves from disk — and admin-only to write.

### The receipt can arrive after the reference

Someone pays on GCash, comes back with the reference number, and does not yet have the
screenshot to hand. The form used to refuse to move — so they abandoned it, or invented a
reference. Neither helps.

**The receipt is now optional at submission and attachable afterwards.** The form says so
(*"Not on this device right now? Send the reference without it — you can add the screenshot
straight after, from the same card"*), and the pending card carries the way to do it: an
amber **No receipt yet** panel with **Attach the receipt now**, or, once there is one, a
thumbnail with **Replace the receipt**. It works on a rejected payment too, since a clearer
photo is usually what was missing. The image is downscaled to 1000&nbsp;px in the browser
before it goes up, exactly as at submission.

Behind it, `attach_receipt(claim_token, path)`: the buyer already holds the token, so no new
identity is involved. It refuses an approved payment — that check is finished, and letting
the image change underneath an approval would only muddy the record.

**In the dashboard** the receipt is a button rather than a decoration: the thumbnail opens
the image full size over a dimmed screen, with **Open in a tab** and **Download**. A payment
with no receipt shows an amber dashed **No receipt — waiting for the buyer** panel instead of
going quiet, and the row's details say whether the receipt came *with the payment* or *sent
after*, with the time it landed — worth knowing when you are deciding whether to chase
someone.

### Paying for one component instead of the whole package

A package item can carry **its own price**, set next to it in the project editor. When it
has one, a buyer can pay for that component alone and walk exactly the same three steps —
pay with the QR (or redeem an access code), wait for approval, sign the terms — after
which that one component opens and the rest of the package stays shut.

The whole package is still there and still the default: one payment, one agreement,
everything opens.

**On the project page.** A price bar sits above the list (*The whole package · PHP 2,500*)
with the whole-package button, and any component that is sold separately shows its price on
its card. Tapping a component you have not bought opens the payment form with that one
component already ticked. The payment form itself asks the question plainly:

> **What are you paying for?**
> ● The whole package · PHP 2,500 — every component opens once the terms are signed
> ○ Only the components I need — with a ticklist and a running total

The amount field fills itself in from that total until you type over it.

**The payment screen names the parts.** Above the QR sits a panel that spells out what this
payment covers — each component with its price, then *Send exactly PHP 1,000 — only these
open. Anything else in the package stays locked until it is paid for.* The QR card itself
carries the same two lines (*Paying for* and *Amount to send*), and all of it follows the
ticks live, so the figure on screen is always the figure they should send. If the amount
they type does not match, the page says so before it submits — it does not block them,
since you are the one who checks what actually arrived. When a private link is driving the
view, the panel is headed *Your quote · prepared for <name>* instead.

**More than one purchase per project.** The page now keeps a list of purchases per project
per account, not a single one: the wiring diagram bought in June and the source code bought
in August are two payments, each with its own approval and its own signed agreement. Each
component's card says where it stands — *Payment being checked*, *Sign the terms to open*,
*Not released yet*, or its price. Anything bought earlier stays open throughout; older
single-purchase records saved by previous versions are carried over automatically on the
next visit.

**In the dashboard.** A payment row says whether it is for the whole package or for N
components, and **Package release** underneath lists exactly which items that payment
opened. Access codes work the same way: a code issued for two components approves a payment
scoped to those two.

Behind it: `payments.scope` is `'package'` or `'items'`, with `payments.item_ids` naming
them; `submit_payment` takes both and refuses ids that do not belong to the project;
`package_access_all(claim_tokens[])` answers for every purchase a buyer holds at once, and
an item released by any one of them counts as released.

### Private links for one customer

The same project editor generates a **private link** — one customer, one selection, your
price — without touching the public catalog:

    index.html?offer=k8mt4rp2wq

Fill in the customer's name, tick the components they asked for, optionally give each one a
different price, optionally set a price for the whole selection, add a headline and a line
addressed to them, and optionally an expiry in days. Press **Generate the link** and copy
it from the list underneath, which shows each link's state (*sent*, *opened*, *expired*,
*revoked*), how many times it was opened, and a **Cancel** button that kills it immediately.

What the customer sees when they open it: the project, with a banner addressed to them,
**only** the components you picked, at the prices you quoted. Everyone else visiting the
site normally sees the unchanged catalog — the full package at the normal price. The link
changes that one visitor's view, nothing about the project row itself.

Payments made from that view are scoped to the offer's components, so approving one opens
exactly what was quoted — including the "take the lot" button, which on a private link means
*everything in your quote*, not the whole catalog package. The quoted total is the price you
set on the link, or its components added up; the catalog's full-package price is never shown
to a customer who was only offered part of it. Cancelling a link stops it opening; it does not touch anything the
customer already paid for and signed.

Behind it: `public.project_shares` holds the token, customer, item ids, price overrides and
expiry; `create_project_share` / `revoke_project_share` are admin-only;
`project_share(token)` is what the visitor's page calls — it refuses a cancelled or expired
token and counts the visit, so the dashboard can tell you the link was opened.

### The private-link flow, end to end

1. **You generate the link.** Projects → the project → *Private links for one customer*.
   Name the customer, tick the components, set their prices (or leave the catalog's),
   optionally a price for the whole selection, a headline, a note and an expiry.
   **Generate the link** → copy `index.html?offer=<token>` and send it however you like.
2. **They open it.** The page opens that project by itself with a banner addressed to them.
   They see only the components you ticked, at your prices, and a price bar for the whole
   selection. The rest of the catalog is unchanged for everyone else.
3. **They pick.** Either the selection as a whole, or one component — the payment form asks
   which, and fills in the amount from what they ticked.
4. **They pay and send the reference.** Same as always: GCash QR, reference number, amount,
   date, receipt screenshot. Or, if they already paid you on Facebook or in cash, the
   **access code** tab — and a code you issued for two components opens exactly those two.
5. **It lands in your Payments tab** as *pending*, marked with the scope (*3 components*)
   and the link it came from. You check it against your own records and **Approve**.
6. **They sign the terms** for that purchase — each purchase gets its own signed agreement,
   filed under Signed agreements.
7. **What they paid for opens.** Only that. The rest stays visible but locked with its
   price, ready for a second purchase later — same account, no re-paying for what they
   already have.
8. **You can still hold something back** after all that: Payments → *Package release* →
   **Hold**, and release it when you are ready.

### Keeping track of a client

Two views answer *what has this client paid for, and what have they not*:

- **The Clients tab.** One card per buyer — matched on their signed-in account, or on the
  name when there is none. Underneath, a block per project with every component listed and
  where it stands: *delivered*, *paid — you are holding it*, *paid — terms not signed*,
  *payment waiting for you*, *payment not approved*, or *not paid yet* with the price it
  would cost. Each buyer's card totals what they have paid, what is waiting for your
  approval, and what they have not taken yet. There is a search box for name, email or
  project, and each row names the reference of the payment that covers it.
- **The link's own line.** In the project editor, each private link says how many payments
  came back against it, how much came in, how many are waiting, and when the last one
  arrived — so you can look at an offer and see whether it was acted on.

The buyer sees their side of the same ledger inside the project: **Your account for this
project** lists each payment they made, what it covered, its reference and its state, and
finishes with what is still unpaid and what it would cost.

### Releasing a package in stages

Not every buyer should get the whole package at once. Prototype work in particular tends
to go in order: the client wants the wiring diagram and the materials list first, builds
the board, and only then needs the sketch. Until now the package was all-or-nothing — the
moment a payment was approved and the terms were signed, every item opened.

Each package item now carries a release mode, set per project in the editor:

| Mode | What it does |
|---|---|
| **Opens with the package** | the old behaviour, and the default. The item opens as soon as the payment is approved and the terms are signed |
| **Hold — I release it per buyer** | the item stays shut after both gates, until you release it for that particular buyer |

Then, per buyer, the **Payments** tab shows **Package release** under every approved
payment: each item with its current state, a **Release** or **Hold** button, and
**Release all** / **Hold all**. An item you have not touched says *project default* and
follows the mode above; **Reset** puts it back to following the project after you have
overridden it. So an item set to *opens with the package* can still be held back for one
buyer, and a held item can be released early for another.

**Access codes carry the same staging.** Issuing a code asks which items it opens —
ticked by default for anything the project opens with the package, unticked for anything
the project holds. A code issued for "diagram and materials only" releases exactly those
two the moment it is redeemed and holds the rest, ready for you to release later from the
Payments tab.

**What the buyer sees.** The package heading counts what is open (*2 of 5 released*), a
held item sits in the grid with a dashed border and reads *Not released yet*, and tapping
it explains that this part is handed over separately, that their payment and signed terms
already cover it, and how to ask for it. Everything released stays open as normal. The
page re-checks with the server whenever the project is opened and whenever it polls the
payment, so a release you make appears on the buyer's open page without them paying,
signing or asking again.

Behind it: `projects.package_items[].release` holds the project's default;
`public.payment_item_access` holds the per-buyer overrides; `package_access(claim_token)`
is what the buyer's page asks (approved payments only, one payment per token) and
`set_package_access(payment_id, item_ids, state, note)` is what the dashboard calls —
admin-only, with `state` one of `released`, `held` or `default`.

Same honesty as the rest of the gate: files in the `project-files` bucket are public to
read, so this decides what the page offers and when, not what a determined person could
reach by keeping a URL. Anything that must stay unreachable until you release it should be
kept out of the bucket until then.

### Reading a signed agreement

The dashboard pulls the terms text from `index.html` itself, so there is one source of
truth and no copy to drift. That means the text shown is the *current* text: if an
agreement was signed against an older `terms_version`, the viewer says so at the top and
names both versions. If you ever need the exact wording frozen at signing time, the next
step would be storing a snapshot of the terms with each agreement — ask and I will add it.

The viewer needs the page served over `http://` (it fetches `index.html`); opening
`admin.html` straight off the disk shows the record but not the terms text, and says so.

### Supporting files on an agreement

Open an agreement in the dashboard and there is a **Supporting files** block: a caption
box and **Attach files**. Screenshots of the Messenger chat where they agreed, proof of a
payment sent another way, anything that backs the agreement up. Images are re-encoded to
at most 1600 px on the way in; PDFs go through untouched. Each one can be removed again,
and the agreements list shows a count badge.

They travel with the document: **Open / print** and **Download** add an *Annex —
supporting files* after the record and before the terms, with the images embedded.

**This is admin-only by construction, not by hiding a button.** `agreement_attachments`
has no policy for the anon role at all — a buyer's page cannot read, add or delete a row —
and the `attachments` bucket is the one bucket where anon cannot upload either (`receipts`
and `signatures` accept buyer uploads; this one does not). Nothing on the buyer's side
mentions attachments. Verified both ways: signed out, reading returns nothing and
uploading is refused by row-level security before anything reaches storage.

### What has and has not been verified

The pages were exercised end to end in a headless browser against an in-memory stand-in
for supabase-js that follows the same rules as the SQL (same checks, same error
messages): 27 checks on the project page in Supabase mode, 13 in local mode, 26 on the
dashboard, 19 on supporting files, 15 on the project editor, 14 on the page following it,
and 27 on Google sign-in. The SQL itself was parse-checked, not executed — there was no local Postgres
to run it on. The first `supabase db push` is the real test of the migrations; if it
complains, the message will name the file and line.

### Who the buyer is

The terms form asks three more things: whether the buyer is a **student, a business, a
personal buyer, or something they type themselves** (choose *Other* and a box appears —
whatever they type is what gets stored, not the word "Other"), their **school or
university** (required for students), and their **city/municipality and province**
(always). They go into the local record, the signed
`.html`, the `agreements` table and the dashboard's agreements tab.

Section **12 · Buyer Information and Privacy** of the terms says what is collected and
why, promises it is never sold, shared, published or otherwise disclosed except with
consent or by law, states it is kept securely and only as long as needed, and gives the
buyer the right to see, correct or delete it (the signed agreement itself may be kept as
the transaction record). It cites RA 10173, the Data Privacy Act of 2012. Agreement is
now section **13**.

### Signing

The buyer signs by hand: a canvas pad taking mouse, finger or stylus. A stray tap is
rejected — the drawing has to carry enough ink (total stroke length, and a wide enough
bounding box) before **Save signature** turns on, and the form only counts it once it is
saved. What gets attached is a trimmed PNG of the drawing, kept with the acceptance
record alongside the name, the dates and the rights track.

From the receipt inside a project, **View agreement** shows the signature as drawn and
offers three downloads:

| File | What it is |
|---|---|
| `…-signed-agreement.html` | the whole agreement — parties, rights track, the signature image and all thirteen sections. Open in any browser, print for a PDF |
| `…-signature.png` | the signature on its own |
| `…-terms-acceptance.txt` | the plain-text record |

Anyone who cannot draw can switch the field to a typed signature; the record notes which
was used (`signatureType`).

### Whose project is it

Each project carries `rights: 'catalog'` or `rights: 'custom'`. The public featured cards
do not display this legal detail; it appears inside the project and at the top of the
terms form, then goes into the signed record and downloadable acceptance copy.

- **`catalog`** — shown as **Yours to use**, and the safe default for every project,
  including work made by JUDECH for a particular buyer. They may build it, run it, test it,
  modify it and keep it; the original source, documentation, diagrams and the copyright in
  them stay with JUDECH.
- **`custom`** — shown as **Yours to own**: an ownership transfer explicitly selected by the
  admin. The finished work transfers only under the separate written agreement sections 2
  and 3 refer to; selecting or purchasing a normal project never transfers ownership
  automatically.

The public wording deliberately avoids licence language — *yours to use* and *yours to own*
rather than *licensed use* — because a EULA register reads badly to an audience that is
mostly students, and because it is what sections 2 to 5 actually mean. The signed terms
themselves are unchanged: they already say "granted permission to use", never "licence".
The word survives in one place only, where it is accurate — third-party libraries keeping
their own licences (terms, section 11).
Or: `npx serve -l 5500`.

## Using it

- Click a piece of waste in the cardboard tray. A hand picks it up and feeds it into
  the hole — presenting plastic/metal to the stage-1 sensors, dropping bio straight
  through — then withdraws. The "How it goes in" button switches technique.
- Three panelists sit behind their table in the background, papers out, watching.
- Five students &mdash; the group defending &mdash; stand at the infeed conveyor, clear
  of every control on it. You see them **from behind**, because that is where they
  stand: facing the panel and facing their own machine. Each head is turned far
  enough that the cheek, the nose, one eye and the mouth still read, so you can see
  who is speaking. They shift their weight, they blink, whoever is speaking moves
  their mouth, and they bow when they greet the panel and again when it claps.

- The Arduino Uno + I²C LCD live in a covered acrylic-front box strapped to the
  hopper post; every sensor lead runs into it through grommets, zip-tied under the
  throat. Above the box, a **power module** on the mast takes every source in and
  sends one 7.5&nbsp;V lead down to the jack. The two 14.8&nbsp;V packs sit behind the
  door of the support box; an 18&nbsp;V panel stands on the floor to the right.
- The waste rests on the closed gate (`tap_servo1` at 180) until the sketch decides.
- `tap_servo` (D5) rotates the **bin platform** so the right bin is under the hole,
  waits 1 s, then the gate opens and the waste falls in.
- The three bins sit corner to corner on a **triangular plywood plate** with a
  **retaining rail** along all three edges, so nothing tips or slides off while
  the plate spins. Their centres are on a circle of radius `2·binR/√3` — exactly
  where three equal circles touch — and the plate is the smallest triangle that
  still holds all three inside its edges, so each bin is tangent to two sides.
  Rail edges facing the viewer are drawn in front of the bins, the rest behind.
- The single HC-SR04 looks into whichever bin is parked under the hole. An empty
  bin reads 50 cm and each drop closes the gap by 7 cm, so the fourth drop still
  reads 22 cm and the fifth lands at 15 cm → `distance <= 20` → alarm,
  `operationsEnabled = false`, and everything stops until D10 is pressed.
- The **Execution trace** panel highlights the line of your sketch that is running.
- The **glass shard** trips no sensor and the **food scrap in foil** trips both the
  inductive and IR sensors — both expose real behaviour of the current code.
- Click waste stuck in the throat to take it back out.


## Walking the room

The page now opens in the **live 3D prototype overview**. The view strip above it gives five
clear starting points: **Overview**, **Input hole**, **Sensor cutaway**, **Gate & bins**, and
**Free walk**. The input-hole view is a fixed live section showing the unobstructed
184&nbsp;mm mouth, the 128&nbsp;mm stage-1 gap, the D3/D4 sensing faces, D7 beam and D6 gate.
Each sensor has its own color and a live HIGH/LOW readout.

**Free walk** hands the picture over to **a boy you drive round the laboratory**, like a
game. It is not another panel &mdash; it takes over the same picture, at the same size, in the
same place, and the same camera bar drives it. **Return to 2D scene** restores the original
illustrated defense view.

- **Everyone in the room has two arms, and the arms are doing something.** Each figure has a
  jointed shoulder, elbow and wrist, with a hand on the end: a palm with a wrist and a knuckle
  line, four fingers of four different lengths that bend at the knuckle, and a thumb on the
  correct side of it. The fingers **curl at rest, open out when somebody talks with their
  hands, and go to one straight finger with the rest folded when they point**. They are dropped
  only when they would come out under about a pixel and a half, which is far enough away to be
  noise rather than detail &mdash; and walking right up to somebody does not lose them: a limb
  that reaches past the camera's near plane is cut off at the plane instead of thrown away.
  Both arms hang outside the body, so you see two of them from the front and one from the side,
  which is what you would see. What the arms do is the point:
  - **the member with the floor presents.** They gesture while they talk, and when the section
    is about a part of the machine they **point at that part** &mdash; the same part the camera
    walks to, so the arm and the viewpoint agree. A section about the group or the panel gets
    no point at all, because pointing at nothing is worse than not pointing.
  - **the rest of the group stand and listen**, hands loosely together in front of them.
  - **the panel writes while they listen.** Seated, forearms on the table, one hand holding a
    pen that moves while a question is live and rests when it is not.
  - **and at the end they clap**, all six of them, each on their own tempo.
- **He is a person, not a floating eye.** He is drawn in the room with everyone else, in a
  blue shirt so he is nobody in the group, **his legs swing as he walks** (about one stride
  every 760 mm, so they keep up with him), his body bobs with the stride, and he has a
  shadow on the floor.
- **Hold to move; he accelerates and coasts.** <kbd>W</kbd>/<kbd>S</kbd> walk,
  <kbd>A</kbd>/<kbd>D</kbd> step sideways, <kbd>Q</kbd>/<kbd>E</kbd> turn,
  <kbd>R</kbd>/<kbd>F</kbd> fly up and down, <kbd>Shift</kbd> runs, <kbd>Space</kbd> jumps,
  <kbd>C</kbd> sits him down; the pads on the **Walk** row do the same by mouse or thumb, drag
  the picture to look, and the wheel pushes him in and out. Space is given back to whatever
  button has the keyboard focus, so the bar still works without a mouse.
- **He can fly.** **Fly** lifts him off the floor &mdash; or just hold *up* and he takes
  off. He climbs to 1850 mm, head just under the 3600 mm ceiling, and the camera rises with
  him; once the camera is above the ceiling **the ceiling stops being drawn**, so you are
  looking down into the lab. Switch Fly off and he comes back down. His **shadow shrinks as
  he climbs**, which is the only thing that tells you how high you are.
- **The furniture stops him.** The machine, the table, the desks, the conveyor, the
  cabinet, the wheelie bins, the solar stand and every person are solid: he walks round
  them, not through them. Above head height he flies over them instead.
- **You can walk every edge and corner.** The third-person boom used to be clamped inside
  the room, so standing near a wall crushed it to nothing and he vanished inside the near
  plane. Now the camera keeps its full length and is allowed **out through the wall**, and
  the wall it is behind simply is not drawn &mdash; **backface culling**, which is what a
  third-person camera does and never collapses. Checked at all four corners and against all
  four walls.
- **He can sit down, and that is how you study it.** **Sit down** on the walk row (or
  <kbd>C</kbd>) puts him on a chair in front of the machine &mdash; if he is across the room he
  walks to the seat first &mdash; drops the camera to a seated 1250&nbsp;mm and turns him to the
  mouth. A prototype 900&nbsp;mm tall is a thing you stand *over*; everything a defense is
  actually about is below chest height, which is what sitting fixes.
  - Seated, **a briefing opens for whatever he is looking at** &mdash; the input hole, the two
    proximity heads, the infrared, the gate, the platform, the full-bin check, the controller,
    the packs, the disposal bins &mdash; written from the same sketch and the same findings as
    the cards below the picture, including the findings against it.
  - **Where he is looking decides which one.** Every part of this machine stands over the same
    square metre of floor, so heading alone cannot tell the mouth from the box under it. Height
    can: tip the view up and you get the input hole, tip it down and you get the base, the
    platform or the support box. Drag to look, and the briefing follows.
  - Standing near a part shows only its name and an invitation to sit; the plan in the corner
    gives its place up to the briefing while he is seated, because a man in a chair is not
    navigating. Anything that asks him to move &mdash; a key, a pad, a viewpoint &mdash; gets
    him out of the chair.
- **Labels: on** is on the walk row too, so the callout boxes can be cleared off the picture
  from inside the room instead of only from the camera bar outside it.
- **See through his eyes** swaps to first person when you want to be at the machine rather
  than watching yourself at it.
- **The camera bar means the same five things.** *Whole room*, *The group*, *The panel*,
  *The machine* and *The bins* walk him there; **+** and **&minus;** move him in and out;
  *Follow the speaker* becomes **Face the speaker** and turns him to whoever is talking.
  Every viewpoint **eases over about a second and takes the short way round the compass**,
  and a high one puts him in the air.
- **A plan in the corner** shows the room from above with an arrow for where he is and
  which way he is facing.
- **It is the running simulation, not a model of one.** The plate turns, the gate drops,
  the bins fill, the waste falls &mdash; and whoever is speaking, in the presentation or
  answering the panel, is **ringed and named** from wherever he is standing.
- **The presentation walks with him.** With *Face the speaker* on, a section that says
  "look at the gate" walks him to the gate, the controller section round to the mast, the
  demonstrations in front of the machine. Stand him where the panel sits, press **Start the
  presentation**, and you are watching your own defense from their chair.


## The machine, view by view

**Side views** in the header opens the machine as an **engineering set**: a plan and the
four elevations, drawn off the same solids the walk-through uses, and every one of them
live &mdash; the plate angle, the gate angle, the fill of each bin, the ultrasonic beam
and the falling waste come off the running sketch every frame.

| | |
|---|---|
| **TOP** (plan) | looking straight down: the three bins spread round the plate, the triangular plate over the triangular base, the castors between them, and the **chute standing 67 mm forward of the rotation axis**, marked. It is the view that finally makes clear why the bins swing *under* the hole rather than sitting on it. |
| **FRONT** (0&deg;) | square on to the chute &mdash; the face the scene above shows you |
| **RIGHT** (90&deg;) | the sensor post nearest: the HC-SR04, its arm over the chute, and its beam into the parked bin &mdash; or straight past the plate mid-swing, which is what the sketch is measuring then |
| **BACK** (180&deg;) | from behind: the mast, and the gate swinging the other way |
| **LEFT** (270&deg;) | the mast nearest: the Uno box with the display, the three LEDs and the buzzer, all live |

- **The gate is the reason to look at an elevation.** From the front you watch the flap
  swing; from either side you watch the **floor of the throat drop away** &mdash; the
  clearest way to show a panel what finding 10 means when the machine locks out with it
  still open.
- **Turn the model** walks the whole set round together, plan included, so you can put any
  bearing you like square on.
- The plan is a third projection, not a trick: height stops moving anything and becomes the
  **sort key** instead, so the taller a part is the later it is drawn. Everything else
  &mdash; the same prisms, cones and cylinders &mdash; falls out of it unchanged.
- Both this and **Walk inside** draw the *same* set of solids through different cameras, so
  the machine is built once and seen every way.

## The prototype, element by element

**Prototype wiring** in the header opens the sheet the rest of the page implies but never
draws: one page with every element of the machine on it &mdash; where each part sits on the
plywood, the core it leaves on, the pin it lands on, and what is feeding all of it. It is a
drawing, with a frame, balloons and a title block, and it is meant to be readable standing at
a bench with the machine open in front of you.

It is in four zones, and the balloons on the drawing are the line numbers of the schedule
underneath it.

| | |
|---|---|
| **A &middot; the machine, as built** | a front elevation: the input hole &mdash; the &#216;184&nbsp;mm bucket mouth &mdash; the plywood hopper and the throat, the capacitive head through one wall and the inductive head facing it across 128&nbsp;mm of clear air, the infrared looking across the gate, the gate that *is* the floor of the hole, the plate servo under the base plate, the post with the one ultrasonic on its arm, the three bins on the triangular plate with the rail, the castors, the support box with the packs and the D10 button, and the mast carrying the power module and the control box. Every element has a short cable stub into the **loom**, zip-tied under the deck and up the mast. |
| **B &middot; inside the control box** | that box, opened out. The loom arrives through the grommet, the **eight signal cores fan onto the header** &mdash; each one on its own lane so no two cross &mdash; and the four things actually in the box hang off it: the Uno, the 16&times;2 display on I&sup2;C, the three LEDs through their 220&nbsp;&#8486; resistors, and the buzzer. The USB port and the barrel jack are both drawn and both labelled with what they are doing, which on most builds is nothing. |
| **C &middot; how it is fed** | the wall and the adapter, the panel and its charge controller, the packs through the fuse, the BMS and the buck &mdash; whichever of them this build has &mdash; and then the changeover, which is the part worth arguing about. |
| **D &middot; the rails** | the four rails every consumer hangs off: **+5&nbsp;V board**, **+5&nbsp;V servos at 3&nbsp;A**, **+14.8&nbsp;V to the heads**, and **0&nbsp;V common ground**, each with its consumers named along it. The colour legend sits beside them, and the title block carries the build, the source and the changeover. |

**The schedule under the drawing** is the same twenty-one elements as a table: what it is,
where it sits, which pin it lands on, which colour core carries it, and the one thing worth
knowing about it &mdash; that D13 also drives the Uno&rsquo;s own on-board LED, that A3 is an
analog pin used as a plain digital output on purpose, that D10 is `INPUT_PULLUP` so the button
goes to ground and takes no resistor. **A line highlights while that pin is doing something**,
so feeding a can lights the inductive row, the D13 row and the plate-servo row as it happens.

### The two changeovers

The sheet is drawn for either of the two ways a machine with both an adapter and a pack can
choose between them, and **Hand switch** / **Battery relay** on the card redraws it.

| | what it is | what it costs you |
|---|---|---|
| **Hand switch** (default) | the selector on the mast, the one already in the scene. You turn it; one source at a time, the other two stay connected as backup. | nothing hands over on its own. Pull the adapter with the knob on AC and the machine stops mid-cycle. |
| **Battery relay** | an SPDT relay whose **coil sits on the adapter**. Adapter in, coil pulled, the machine is on the adapter; adapter out, the coil drops and the contact falls back onto the pack &mdash; and the sketch never notices. | the adapter no longer feeds the USB port: both sources are brought to 5&nbsp;V first and the relay picks one into the 5&nbsp;V pin. It also needs two parts a switch does not &mdash; a **flyback diode** across the coil, and a **reservoir capacitor** across the output, because an SPDT breaks before it makes and the board would otherwise reset on every handover. |

**The relay is real, not drawn.** Choose it, then press **Pull the adapter out** on the Power
card: the coil drops out on the sheet, the armature swings to NC, the source changes to the
pack, and the plate keeps turning. Do the same with the hand switch and the machine goes dark.
On the relay rig the three source buttons act through the plug, because that is the only way a
source changes on that build.

### It says what the build has not got

The sheet follows whichever build the **Power** card is on: a build with no pack has no packs
behind the door, no module on the mast and no battery lane. It also says what that costs. On
**AC only** the head rail reads *nothing feeds this on this build* and the head supply block
turns red, because LJ12A3 proximity heads want 6&ndash;36&nbsp;V and a 5&nbsp;V adapter does not
give it &mdash; that build needs a 12&nbsp;V supply as well, or heads that run on 5&nbsp;V. It
is the kind of thing a panel finds if you do not find it first.

### It is live, like the rest of the page

The pins, the three lights, the buzzer, the gate angle, the plate angle, the ultrasonic
reading, the bin fills, the display, the pack voltage and the lit lane are all the running
sketch&rsquo;s own, read every quarter second. The **middle bin on the drawing is whichever
bin is parked under the hole**, named and coloured as the plate turns, so the sheet and the
machine can never drift apart.

**The same disclaimer as everywhere else.** It is one way of building it, drawn from what is
in `EnviroSortPro.ino` and from the parts this simulator models. It is not an approved drawing
and no panel has signed it. Check every part number and every voltage against what your group
actually bought.

## Emptying a full bin

The sketch's own D10 handler clears the lockout but never empties the bin (Finding #2), so
a full bin has to be dealt with by hand. There are two ways to do that, and they are
different machines to defend. **Bins:** in the header switches between them, and so does
the second button on the BIN FULL overlay.

| | what happens | what the sensor sees |
|---|---|---|
| **Liner bags** (default) | every bin is lined with a plastic garbage bag. The bag is lifted out by the neck, tied, carried over and dropped into the matching disposal bin whole. A fresh liner goes into the bin. **The bin never leaves the platform.** | the bin reads empty the moment the bag is out &mdash; 50&nbsp;cm |
| **No liner** | the whole bin lifts off the plate, is tipped into the matching disposal bin, and is carried back and set down again. | while the bin is off the plate the sensor reads **55&nbsp;cm &mdash; no bin**; after the tip and the trip home, 50&nbsp;cm |

The waste leaves the bin at the moment it physically leaves &mdash; with the bag on the
lift, with the tip on the carry &mdash; so the fill level drops then, not when you press
D10.

### What the alarm actually does

Straight from `EnviroSortPro.ino`, and worth knowing before a panel asks:

| | |
|---|---|
| `soundAlarm()` | `digitalWrite(buzzerPin, HIGH)` plus **all three LEDs HIGH**. The buzzer is a **steady tone, not a beep pattern** &mdash; a pattern would need `tone()` or a timer, and the sketch has neither. Three lights at once is the alarm's signature; in normal running only the class that was just detected lights. |
| `displayFullBin()` | prints **Bin Full / Detected** and leaves it there. |
| `stopAlarm()` | lowers **only the buzzer**, and it runs when the sensor reads back above 20&nbsp;cm &mdash; that is, **when you empty the bin, not when you press the button**. It does not touch the LEDs or the display. |
| the D10 press | `operationsEnabled = true` and `resetServosAndLCD()` &mdash; servos home, display back to **Automatic Waste / Segregation**, and *now* the three LEDs go out. |
| lifting the bin out and putting it back **still full** | the tone stops while the bin is off the plate (the beam misses it) and `obstacleDetected` clears &mdash; then putting it back re-arms `distance <= 20 && !obstacleDetected` and **the alarm fires again from the top**. Only actually emptying it holds. |
| the **gate** | **nothing.** The full-bin branch `return`s `true` without writing to `tap_servo1`, and the trip fires on the pass straight *after* a drop &mdash; so the gate is still at `write(0)`, **open**, and stays open for the whole alarm. `resetServosAndLCD()` on the D10 press is the only thing that closes it. Sorting stops; the hole does not. See finding 10. |

So the honest order is: **empty it and the tone stops by itself; press D10 and the display
and the lights clear.** Doing it the other way round is the trap, and the simulator plays
it out faithfully &mdash; press D10 with the bin still full and you get a running machine, a
clean display, no lights, and a buzzer that will not stop, because `obstacleDetected` is
still true and nothing has told the sketch the bin is empty. That is worth showing a panel
before they find it.

The lined bins are drawn with the bag folded over the rim, so which build you are showing
is visible in the picture rather than only in the script.

**The two parts you can touch.** The **D12 buzzer** on the back board pings rings out of
itself and shakes while the pin is high, so the alarm is visible from the back of a room
even with the sound off &mdash; and clicking the buzzer itself mutes and unmutes the tone,
the same switch as **Buzzer** in the header. Muting is a decision about the room, not about
the pin: `W.buzzer` stays exactly where the sketch left it, the scene keeps showing D12
high, and a bar across the buzzer says the tone has been *silenced* rather than *stopped*.
The **D10 button** on the support box travels when it is pushed &mdash; the cap drops, the
shadow under it deepens, a ring snaps off it and it ticks &mdash; so a press the
presentation makes on your behalf reads as somebody's thumb and not a state change.

## Presentation

**Presentation** in the header is the other half of the defense: the demo you give
*before* anybody asks you anything. Press **Start the presentation** and it runs.

- **Twenty-four sections**, in the order a defense actually runs &mdash; greeting, why you
  built it, what the machine is for, the machine part by part, **inside the input hole**,
  stage one, stage two,
  the controller, how it decides, the platform and the gate, **why the plate needs a
  270&deg; servo**, **why the gate is a servo too**, the full-bin check, how it
  is powered, three sorting demonstrations, then the whole alarm cycle &mdash; **a bin
  fills up, emptying it, why it stops with the gate open, what the display and the lights
  are saying, and back to normal** &mdash; the weaknesses you should own, and the hand-over.
- **The demonstration sections put the waste in on cue.** A section can name the point in
  its own narration where the waste goes in (`feedAt`), instead of dropping it at the
  start &mdash; the drop-and-sort takes about five seconds, so on a long section feeding it
  immediately means the machine has finished before the speaker has said what to watch.
  *A bin fills up* feeds the fifth can on the words &ldquo;I am feeding it a fifth&rdquo;,
  about a third of the way in, so the panel is looking at the plate when it turns.
- **One member takes each section**, not just the leader: the leader greets and runs the
  demonstrations, the hardware member walks the machine and the sensors, the programmer
  takes `loop()` and the decision order, the testing member takes the full-bin check, and
  the documentation member owns the limitations. Each has their own voice.
- **The script is printed under the scene** in a size you can read standing up. Read it
  aloud yourself, or leave **Read it aloud** on and let the voice carry it while you
  follow. **Speaking speed** sets both the voice and the pace it moves at when the voice
  is off, and the clock shows how long the section takes to say.
- Under every section there is a line of **stage direction** &mdash; where to stand, what
  to point at, which technique to use, what not to say. It is never spoken aloud.
- **The camera walks to whatever is being talked about**: the group for the greeting, the
  throat for the proximity pair, the gate for the infrared, the control box for the code,
  the platform for the servos, the sensor post for the full-bin check. Switch it off with
  *Walk the camera to each part*.
- **And it can move again mid-sentence, and open a detail view.** *Inside the input hole*
  takes the camera up to the mouth, and then a round **view down the hole** fades up beside
  it, joined to the real mouth by a dashed cone: the whole circle of the bore seen from
  above, with the sensors inside it. You can see that **nothing hangs in the middle** &mdash;
  the two heads come *through the wall* of the throat and face each other across the bore,
  the white capacitive face on D3 on one side, the brass inductive face on D4 opposite it at
  the same height, 128&nbsp;mm of clear air between them, the floor of the bore is the closed
  gate, and the infrared on D7 sits at the wall with its beam across that floor. The
  pointers walk around the inside of the circle as each one is named, and the detail drops
  again at the end of the section &mdash; and if you skip out of the section early, it drops
  anyway. It is the section to run when a panelist asks where the sensors physically are.
- **And it points at it.** As the section names a part, a box goes round that part with an
  arrow and a chip naming it &mdash; *INDUCTIVE &middot; D4*, *the throat*, *SERVO D5
  &middot; turns the plate*, *20 cm and it stops*. The pointers follow the narration: on
  the parts tour the box walks from the mouth to the throat to the gate to the platform to
  the sensor post to the controller as each one is spoken, and on *How it decides* the
  three sensors light up in the order the sketch tests them &mdash; 1 metal, 2 plastic,
  3 bio. Switch it off with *Point at what is being said*.

  The boxes are not typed in by hand. Each one is measured off the drawing at run time with
  `getBBox`, put back into scene coordinates, so a pointer stays on its part even if the
  art moves &mdash; and everything is scaled by how far in the camera is, so a highlight is
  the same size on screen whether you are looking at the whole room or standing on top of
  one sensor.

  The pointers name each part as it comes up, so **Labels: off** goes well with the
  presentation: the picture stays clean and only the thing being talked about is named.
- **How it is powered** is written four times over, one per build, and given by the
  hardware member with the pointers walking the parts that build actually has. It acts on
  the machine as it is spoken: on **AC only** the plug really comes out of the wall
  mid-sentence and goes back in at the end; on **Battery only** the pack really drops to
  a tenth so the panel can watch the plate slow down; on **Solar** the sun really goes out
  for the sentence about night; on the **switchable rig** the source really changes from
  adapter to pack to panel. Skip the section part-way and anything it had not got to yet
  is run anyway, so the plug always goes back in and the sun always comes back up.
- **The demonstration sections run the machine for real.** The three sorting sections put
  the bottle, the can and the banana peel on the belt themselves, narrate what the sensors
  are doing while it happens, and wait for the cycle to finish before moving on. Each one
  also **points at the LCD and at the LED** as they change &mdash; *LCD prints: Plastic
  Waste / Detected*, *D2 lights &middot; one light, not three* &mdash; and says why the
  buzzer stays silent, because one light and no tone is what a normal sort looks like. The
  plastic section also warns you that the display flickers to **Bio Waste** for an instant
  as the bottle falls past the infrared, so you can own it before a panelist asks. A
  highlights are timed off the words themselves: each box comes up as the phrase that
  names it begins, so the *CAPACITIVE &middot; D3* box is never on screen while the voice
  is naming the inductive head. A
  demonstration section will not move on until the waste is genuinely on the belt and the
  cycle has finished: if the machine is still busy with the last piece the feed is simply
  retried, and the narration finishing early &mdash; a voice the browser refused to speak,
  say &mdash; no longer races the section past before anything was fed.
- **Then the alarm cycle**, five sections that show the machine is a machine. Nothing in
  them is faked &mdash; the sensor reading, the alarm, the lockout and the D10 resume are
  the transcribed sketch's own. **The bin is emptied first, straight after the alarm**, so
  the panel hears the tone for about 35 seconds instead of two and a half minutes, and the
  three explaining sections then run in silence. That is not a cheat: emptying is what
  stops the tone in the real sketch, and it leaves the display, the LEDs, the lockout and
  the open gate exactly as they were, which is what those sections are pointing at.
  1. *A bin fills up* puts four drops in the metal bin, **switches the buzzer on for you**,
     and feeds a fifth **on the words "I am feeding it a fifth"** &mdash; about a third of
     the way through, so the panel is watching the plate when it turns. The plate parks that
     bin under the hole, the ultrasonic reads 15&nbsp;cm, `soundAlarm()` fires, the LCD says
     **Bin Full / Detected**, and the sketch locks itself out. The section will not move on
     until that actually happens.
  2. *Emptying it* lifts the waste out two seconds in, by whichever method you chose while
     explaining both, and **the tone stops by itself** &mdash; `stopAlarm()` runs off the
     sensor reading. It does **not** press D10: the display still says Bin Full, the three
     LEDs are still on, the machine is still locked and the gate is still open.
  3. *Why it stops with the gate open* traces finding 10 in the code with the gate visibly
     still at `write(0)` on screen.
  4. *What the display and the lights say* reads the state that is left: the LCD line, the
     three LEDs **all on at once** (D2 plastic, D13 metal, A3 bio &mdash; in normal running
     only one lights, so three means alarm and not a sort), and a buzzer that is **already
     silent** although nobody has pressed anything &mdash; which sets up the trap, that
     pressing the button before emptying gives you a clean display and a tone that will not
     stop.
  5. *Back to normal* presses **D10** on cue (the display clears, the lights go out and the
     gate finally shuts &mdash; all three are `resetServosAndLCD()`), then feeds one more
     bottle and waits for it to be sorted: the proof that it recovered on its own.
- **Move on by itself** off, and it waits for you to press **Next section** &mdash; which
  is how you rehearse it at your own pace. **Pause** freezes the voice, the clock and the
  machine wait together. **Back** and clicking any section in the list jump around freely.
- At the end, **Hand over to the panel** switches on the panel interview and asks the
  first question straight away, skipping the group introduction, because you have just
  given it.

The same disclaimer as everywhere else: every word is one way of saying it, written from
what is actually in `EnviroSortPro.ino`. It is not the official script, and no panel has
approved it. Keep what is true for your group and change the rest.

## Panel interview

**Panel interview** in the header turns the three panelists into a practice defense.

- The camera eases onto the panel, and the **Panel interview** card opens under the
  scene.
- One panelist at a time asks. A speech bubble opens above them with a tail
  pointing down at their head, the question is spoken aloud through the browser's
  speech synthesis, and the other two dim and take notes.
- When the question finishes, the clock starts and you answer out loud. **One
  minute** by default; the slider runs from 15 s to 5 min and can be moved while a
  question is live, and **+30 s** buys more time on the spot.
- **The room turns to your group as it answers.** The camera leaves the panel, and a
  bubble opens over the one member whose question it is &mdash; the hardware member
  takes *Design*, the programmer takes *Code*, the testing member takes *Testing*,
  the documentation member takes *Limitations*, and the leader takes everything
  else. That bubble is **deliberately empty**: it carries the member's role, the
  clock and three moving dots, and nothing to read. The words are already printed
  on the card below the scene at a size you can read standing up, so putting them
  up there too would only be a second place to look. Everyone else in the group
  stands back, and the member speaking moves their mouth while the answer runs.
- When the clock runs out a chime sounds. Roughly half the time the *same*
  panelist presses you with a follow-up instead of moving on &mdash; *"Show us the
  line." "Why did you not fix it?" "So is the project a failure?"* &mdash; on 60% of
  the answer time. **Follow-up** forces one; the *Panelists may follow up* box
  turns them off.
- Then the next panelist asks. Turn off *Auto-advance* and it waits for you to
  press **Next question** instead.
- **Pause** stops both the voice and the clock. **Repeat** re-asks whatever is on
  the floor.

### The opening

Press **Start** and your group goes first, before any question:

1. The camera moves off the panel and frames the five of them at the conveyor.
   Whoever is speaking is lit; the rest of the group stands back.
2. The group leader greets the panel &mdash; **with the greeting that matches the
   clock on the machine you opened this on**. Morning before noon, afternoon until
   six, evening after that. The group bows with the greeting.
3. She names the group. That name is yours to set: the **Your group** field in the
   options, *Group 3* out of the box, and it is what the panel calls you all
   session &mdash; in the bubble header, on the card, and in the chair's reply.
4. A second member gives the one-paragraph highlight &mdash; what EnviroSortPro is
   and what it sorts &mdash; and the leader asks permission to begin.
5. The chair answers with the same greeting, the camera eases back onto the panel,
   and question one is asked.

**Nobody says "good morning" to an afternoon defense.** The greeting is read off
your clock when you press Start, and the same reading is pushed through the whole
question bank, so the panel's own opening question greets you correctly too. The
wall clock in the room is set from that reading as well, and keeps time while the
page is open.

**Skip the introduction** on the *Next question* button jumps straight to question
one; clicking any question in the bank does the same. Turn it off for good with
*Open with the group's introduction*.

### The ending

Answer the last question in play and the panel closes the defense the way a real
one does, without you pressing anything:

1. The chair &mdash; the middle seat &mdash; stops the questioning: *"Thank you.
   That is the last of our questions. Give us a moment, please."*
2. The three of them turn to each other and **confer** for a few seconds. Nobody is
   dimmed, nobody is writing, and the card says so.
3. The chair gives the verdict: *"We have heard enough. On behalf of the panel
   &mdash; congratulations. You have successfully defended your project."*
4. They put the pen down and **clap**. The writing arm is swapped for two arms that
   swing about their own shoulders, so the palms really meet in the middle of the
   chest; the crack you hear is fired on the frame the hands touch, and each of the
   three re-rolls their own tempo every clap, because three people clapping never
   stay in step. The other two add a line over the applause &mdash; *"Well done.
   Congratulations to all of you."* &mdash; and the clapping fades after about nine
   seconds, leaving them smiling for a while longer.
5. The card keeps the verdict, the tag reads **defended**, and **Start again** puts
   you back at question one.

Every character's **voice matches the figure that is drawn**. Two of the group are in
skirts &mdash; the Testing member with the ponytail and the Leader with the long hair
&mdash; and so is the second panelist; the other three of the group and the panelists in
glasses and in the beard are men. A speech engine will not tell you a voice's sex, so it is
read off the voice's name (Zira, Hazel, Samantha, *Google UK English Female*&hellip; against
David, Mark, George, Alex, *&hellip;Male*), and each character is given a voice from the
matching side of that list, as far as possible a different one from the person next to
them. If the machine has no voice of the right sex at all, the character keeps a neutral
voice and the pitch is pushed instead, so the picture and the sound still agree. The
**Voice** dropdown labels each one *&middot; man* or *&middot; woman*, and choosing one
there overrides the lot.

That now includes the **answer read-back**, which used to be the one exception: it was
spoken by a single extra voice off the end of the browser's list, whatever sex that
happened to be. It is read by the member whose question it is instead &mdash; the
hardware member's voice on a *Design* question, the leader's on an *Opening* one
&mdash; so the girl in the skirt is never read back by Microsoft David.

The applause follows the **Buzzer** toggle in the header, like every other sound in
the page. This ending belongs to the simulator: it fires because you got through
every question that was switched on, and it is not a mark and not your school's
decision.

### The arc

48 questions, ordered the way a defense actually runs rather than by who asks
them. Unshuffled, question one is always *"why did you decide to come up with this
study?"*

| Block | | What it asks |
|---|--:|---|
| Opening | 5 | why this study, where the idea came from, the title, the 30-second intro, who built what |
| Concept | 3 | the problem, why it matters, how it differs from what exists |
| Design | 6 | two stages, the rotating platform, why both servos are 270&deg; and not SG90s, the full-bin sensor, power |
| Code | 6 | `loop()` order, the metal-before-plastic guard, `pulseIn`, `delay()`, `INPUT_PULLUP`, the LCD |
| Testing | 4 | research design, accuracy per material, variables, reliability |
| Strength | 4 | the single greatest strength, three ranked, what it beats a person at, what you are proud of |
| Limitations | 5 | scope, the single greatest weakness, three named unprompted, what it cannot do, what will fail today |
| Impact | 6 | cost, safety, the bin filling at night, scaling, maintenance, what you fix first |
| Curveball | 6 | the thrown can, the unguarded bio branch, room IR, one bin watched at rest, "what is your contribution" |
| Closing | 4 | the hardest problem, what you learned, the next step, anything else |

The six curveballs are built from the analysis below, so the machine on screen can
demonstrate the failure you are being asked to defend.

### Disclaimer

**These are possible questions and possible answers, not the official ones.**
Nothing in the bank is a question your panel will definitely ask, and no script in
it is *the* correct answer. They are questions a panel could reasonably ask about
this project, each with one way of answering it, written from what is actually in
`EnviroSortPro.ino` and from the findings listed further down this file.

Your real answer depends on your school, your group, your own data and how the
defense goes on the day. Read them, keep what is true for you, change the rest, and
**never say a figure you have not measured yourselves** &mdash; that is what the
square brackets are for. The disclaimer is repeated on the card itself so nobody
mistakes a script for a script that must be followed.

### The answer script

Every question comes with a **written answer to read aloud** &mdash; not bullets, the
actual sentences, in the first person, grounded in this sketch and these findings.
It appears under the question the moment the panelist stops speaking:

> *"We started from something we saw, not something we read. In our building the
> bins are already labelled, but at the end of the day everything goes into one
> sack&hellip;"*

- Under each script is its length: **words, and how long it takes to say** at the
  current speaking speed. If it will not fit the answer time you have set, it says
  so and turns amber. The 48 scripts average about 42 s and the longest is 56 s, so
  they fit a one-minute slot read at a normal pace.
- **Anything in square brackets is yours to fill in** &mdash; `[Name]`, `[number]`,
  `[amount]`, `[adviser]`. Those are the figures only your group has, and the script
  will not invent them for you.
- **The script is read aloud for you automatically**, in the voice of the member who
  is taking the question, so the group does not answer everything in one voice. It
  starts about half a second after the panelist stops. **Pause** stops it with the
  clock and play picks it up again. Untick *Read the answer aloud for me* if you
  would rather have silence and read it yourself; **Read it to me** then plays it on
  demand, and stops it again mid-sentence.
- Follow-ups get their own short scripts. The generic probes (*"Show us the line."
  "Give us a number."*) cannot have one, so those show **how to handle it** instead,
  in a plainer style.
- **Every question carries two versions**, and *Another way to answer* switches
  between them. Version 1 is the full answer. Version 2 is one of:
  - **Shorter** &mdash; the same answer in a third of the words, for when the panel
    wants it brief.
  - **A different angle** &mdash; the same question answered from another position
    entirely, e.g. the cost question answered from who can actually own one, or the
    greatest weakness answered as the infrared head rather than the default-to-bio
    problem.
  - **A situational version** &mdash; *in your own words, if you saw it at school*;
    *if your split was uneven, say so*; *if your trial count is small*; *if cost is
    your weak point*.

  Take whichever fits you, or take neither and use them as a shape for your own.
- Untick *Show the answer script* to practise blind.

*Show the answer outline* is separate and still there: three or four bullets on
what to say and in what order, for when you want to review the shape of an answer
rather than read it.

### The rest of the controls

- **Voice** &mdash; by default each panelist gets a different system voice and its
  own pitch; pick one from the list to force it. **Speaking speed** changes the
  rate.
- **Zoom to whoever is speaking** &mdash; off, and the whole scene stays visible, so you can
  feed waste in while a question is being asked.
- **Shuffle** randomises the order; the ten category chips switch whole blocks off,
  and only what is on gets asked.
- Click any question in the bank and that panelist asks it immediately.

## Servo values in the sketch

| | `tap_servo` (D5, platform) | `tap_servo1` (D6, gate) |
|---|---|---|
| home | 90 | 180 (closed) |
| bio | 0 | 0 (open) |
| metal | 80 | 0 |
| plastic | 165 | 0 |

These are library values. On a 270° servo the real angle is `value × 1.5`, so home
is 135°, plastic is 247°, and the gate swings a full 270° between closed and open.

**Both of them ramp.** A digital servo does not start and stop dead: it accelerates, cruises
and brakes into the stop, and on a plate carrying three filling bins the braking is the part
you actually see. The peak speed is set to pay for the ramps, so the worst move on the machine
— home to plastic, 247.5° — still finishes in about 830 ms and lands inside the sketch's own
`delay(1000)`. A sagging pack still misses it, which is the documented failure: the gate opens
on a plate that has not arrived and the waste falls into whichever bin is passing.

### Why both are 270° metal-gear digital servos, not SG90s

**D5, the platform — a travel problem.** The three bins park at 0°, 120° and 247.5°,
so the furthest is nearly 250° from zero. An SG90 stops at 180°: it would park bio and
metal and stall on its own end stop trying to reach plastic. Nor can the bins be packed
into a 180° arc — they ride 67 mm off the axis and are ~120 mm across, so at 120° apart
their centres are `2 × 67 × sin 60° = 116 mm` apart and only just clear; at 90° apart
they would be 95 mm apart and touching. Three bins that size need the full circle, and
the full circle needs ≥ 240° of sweep. Metal gears are for the *stopping* (the castors
carry the weight, but three filling bins twist the shaft back at every stop); digital is
for parking the bin square under the hole.

**D6, the gate — a torque problem.** The gate is the floor of the hole: it holds every
item dropped in on the stage-1 sensor line while the sketch reads it and while the plate
turns underneath, and opens only when the right bin has arrived. A flap only needs ~90°,
so travel is not the constraint — hold is. `torque = weight × distance from the hinge`,
so an SG90's 1.8 kg·cm is ~300 g at the tip of a 6 cm flap with nothing spare, which is
the "sluggish when it is heavy" behaviour; and every item is *dropped* onto the closed
flap, so the gearbox takes an impact rather than a steady load. Same servo, then: for the
holding torque, a gearbox that survives being landed on, and one spare part instead of
two. Design rule that follows: a longer flap needs proportionally more torque, which is
why the flap is no longer than the bore.

**Own this one:** the sketch swings the gate `write(180)` → `write(0)`, a full 270° on a
270° unit — far more than a gate needs, and time paid on every drop. `write(120)` →
`write(60)` is the same 90° opening.

## Findings

The page lists ten, by severity. The three that matter most:

1. **The bio branch has no guard.** Metal is unguarded, plastic checks
   `!metalDetected`, bio checks nothing — so anything that trips the IR sensor
   overrides an earlier decision and runs `moveServos(0, 0)` on top of it.
2. **Only the metal bin is watched between drops.** Home is `write(90)` and metal is
   `write(80)`, so at rest the ultrasonic looks into the metal bin. Bio and plastic
   are checked only in the single pass right after they receive waste.
3. **The gate is left open when a bin fills.** The full-bin branch returns `true`
   before anything writes to `tap_servo1`, and the alarm always fires on the pass
   right after a drop — so the machine locks out with the floor of the throat open.
   Waste dropped in while the buzzer is going falls straight into the bin just
   declared full. One line fixes it: `tap_servo1.write(180);` before the
   `return true;`.
