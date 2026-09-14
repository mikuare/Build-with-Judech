/* JUDECH — the service worker
   ---------------------------------------------------------------------------
   The site is three static pages that talk to Supabase. That split is the whole
   design of this file:

     · the pages, their css, js and icons are ours and never change without a
       new ?v= on the URL, so they can be served from the cache and refreshed in
       the background;
     · anything to do with Supabase — a sign-in, a payment, a message — is the
       live state of somebody's account and must never come out of a cache, so
       it is not touched here at all;
     · a navigation that cannot reach the network falls back to whatever copy of
       that page we hold, and to offline.html when we hold none.

   Bumping VERSION is the only step needed to retire everything cached under the
   old one; the new worker waits until the page says to take over, so nobody
   loses a half-typed message to a reload they did not ask for.
   --------------------------------------------------------------------------- */
'use strict';

const VERSION = 'judech-2026-09-14d';
const SHELL   = 'shell-' + VERSION;
const RUNTIME = 'runtime-' + VERSION;
const ASSETV  = '20260914q';          /* must match the ?v= the pages ask for */

const OFFLINE_URL = '/offline.html';

/* The pages worth having before they are asked for. Each is added on its own:
   one missing file must not take the whole install down with it. */
const PRECACHE = [
  '/',
  '/index.html',
  '/simulation.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/css/landing.css?v=' + ASSETV,
  '/css/style.css?v=' + ASSETV,
  '/css/mobile.css?v=' + ASSETV,
  '/js/theme.js?v=' + ASSETV,
  '/js/config.js?v=' + ASSETV,
  '/js/pwa.js?v=' + ASSETV,
  '/js/backstack.js?v=' + ASSETV,
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
];

/* Hosts whose answers are somebody's live account state. Never stored. */
function isLiveData(url) {
  return url.hostname.endsWith('.supabase.co') ||
         url.hostname.endsWith('.supabase.in') ||
         url.pathname.startsWith('/api/');
}

/* Third parties we do lean on for the page to render: the font css, the font
   files themselves, and the Supabase browser client. All immutable URLs. */
function isCacheableThirdParty(url) {
  return url.hostname === 'fonts.googleapis.com' ||
         url.hostname === 'fonts.gstatic.com' ||
         url.hostname === 'cdn.jsdelivr.net';
}

function isOurAsset(url) {
  return /\.(?:css|js|mjs|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|json|webmanifest)$/i
    .test(url.pathname);
}

/* ---------------------------------------------------------------- install -- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(PRECACHE.map((href) =>
      cache.add(new Request(href, { cache: 'reload' })).catch(() => {})
    ));
  })());
});

/* --------------------------------------------------------------- activate -- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, RUNTIME]);
    const names = await caches.keys();
    await Promise.all(names.map((n) => (keep.has(n) ? null : caches.delete(n))));

    /* a navigation can then be answered from the cache before the network */
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

/* ------------------------------------------------------------- strategies -- */

/* Pages: the network first, because the catalogue and the dashboard are only
   worth reading when they are current. What comes back is kept, so the same
   page opens on a train. */
async function page(event) {
  const cache = await caches.open(RUNTIME);
  try {
    const preloaded = await event.preloadResponse;
    const fresh = preloaded || await fetch(event.request);
    if (fresh && fresh.ok && fresh.type === 'basic') {
      cache.put(event.request, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (e) {
    const hit = await caches.match(event.request, { ignoreSearch: true });
    if (hit) return hit;
    const shell = await caches.match(OFFLINE_URL);
    if (shell) return shell;
    return new Response('Offline.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}

/* Assets: whatever we hold goes out at once and the network refreshes it behind
   the page. A ?v= bump simply asks for a URL we have never seen, so there is no
   window in which an old stylesheet is served against a new page. */
async function asset(request) {
  const cache = await caches.open(RUNTIME);
  const hit = await cache.match(request);

  const network = fetch(request).then((res) => {
    if (res && (res.ok || res.type === 'opaque')) {
      cache.put(request, res.clone()).catch(() => {});
    }
    return res;
  }).catch(() => null);

  if (hit) return hit;

  const fresh = await network;
  if (fresh) return fresh;

  const shell = await caches.match(request, { cacheName: SHELL });
  if (shell) return shell;
  throw new Error('offline and not cached: ' + request.url);
}

/* ------------------------------------------------------------------ fetch -- */
self.addEventListener('fetch', (event) => {
  const req = event.request;

  if (req.method !== 'GET') return;                    /* a write is never ours */
  if (req.headers.has('range')) return;                /* let media stream */

  let url;
  try { url = new URL(req.url); } catch (e) { return; }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
  if (isLiveData(url)) return;                         /* Supabase: straight out */

  if (req.mode === 'navigate') { event.respondWith(page(event)); return; }

  const sameOrigin = url.origin === self.location.origin;
  if ((sameOrigin && isOurAsset(url)) || isCacheableThirdParty(url)) {
    event.respondWith(asset(req).catch(() => Response.error()));
  }
});

/* ---------------------------------------------------------------- message -- */
self.addEventListener('message', (event) => {
  const data = event.data;
  const type = typeof data === 'string' ? data : (data && data.type);
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'VERSION' && event.source) event.source.postMessage({ type: 'VERSION', version: VERSION });
});
