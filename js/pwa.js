/* JUDECH — the installable app
   ---------------------------------------------------------------------------
   Four small jobs, none of which the pages should have to know about:

     1. register the worker, and tell the page when a newer one is waiting
        rather than swapping it underneath a half-typed message;
     2. offer the install once, politely, and remember a "not now" for a
        fortnight — Chrome hands us the prompt, iOS never will, so iOS gets the
        one thing that actually works there: the two-step instruction;
     3. say when the connection has gone, and say when it is back;
     4. mark the document when it is running as an installed app, so the css can
        give the notch its padding and drop the install button.

   The banner, the toast and the pill are built here rather than sitting in
   three copies of the markup. Everything is keyboard reachable, everything can
   be dismissed, and nothing appears at all where it would be a lie: no banner
   in an installed window, no update toast on a first visit.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  var SW_URL      = '/sw.js';
  var SNOOZE_KEY  = 'judech.pwa.snoozed';
  var VISITS_KEY  = 'judech.pwa.visits';
  var SNOOZE_DAYS = 14;
  var root        = document.documentElement;

  /* ------------------------------------------------------------- storage -- */
  function get(k)    { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function snoozed() {
    var until = parseInt(get(SNOOZE_KEY) || '0', 10);
    return until > Date.now();
  }
  function snooze() {
    set(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 864e5));
  }
  function visit() {
    var n = (parseInt(get(VISITS_KEY) || '0', 10) || 0) + 1;
    set(VISITS_KEY, String(n));
    return n;
  }

  /* ---------------------------------------------------------- the device -- */
  function standalone() {
    return !!(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
           window.navigator.standalone === true ||
           document.referrer.indexOf('android-app://') === 0;
  }
  function iOS() {
    var ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) ||
           /* iPadOS 13+ reports itself as a Mac; the touch points give it away */
           (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function iOSSafari() {
    var ua = navigator.userAgent || '';
    return iOS() && !/CriOS|FxiOS|EdgiOS|OPiOS|Chrome/.test(ua);
  }

  if (standalone()) root.classList.add('pwa-standalone');
  root.classList.add('pwa-ready');

  /* --------------------------------------------------------------- parts -- */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function iconMark() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 32 32');
    s.setAttribute('aria-hidden', 'true');
    s.innerHTML =
      '<rect width="32" height="32" rx="7.5" fill="#0C1512"></rect>' +
      '<g fill="none" stroke="#4CD6B4" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M11.4 10.4 6.4 16l5 5.6"></path><path d="M20.6 10.4 25.6 16l-5 5.6"></path>' +
      '<path d="M18.3 9.1 13.7 22.9"></path></g>';
    return s;
  }

  /* ------------------------------------------------------------- the sw ---- */
  var reg = null;

  function watchWorker(registration) {
    reg = registration;

    if (registration.waiting && navigator.serviceWorker.controller) {
      offerUpdate(registration.waiting);
    }
    registration.addEventListener('updatefound', function () {
      var next = registration.installing;
      if (!next) return;
      next.addEventListener('statechange', function () {
        /* "installed" with a controller already in place means a newer build
           is sitting behind the one the page is running */
        if (next.state === 'installed' && navigator.serviceWorker.controller) {
          offerUpdate(next);
        }
      });
    });
  }

  /* A controller change means the page's assets and the worker answering for
     them no longer agree, and a reload is the fix. The exception is the very
     first visit: the worker activates, claims the page it just installed, and
     reloading there would throw away whatever the visitor had already started
     typing to fix precisely nothing. */
  var reloading    = false;
  var hadController = !!navigator.serviceWorker.controller;

  navigator.serviceWorker.addEventListener('controllerchange', function () {
    if (!hadController) { hadController = true; return; }   /* first install */
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', function () {
    navigator.serviceWorker.register(SW_URL, { scope: '/' })
      .then(watchWorker)
      .catch(function () { /* http, private mode, or the file is not there yet */ });

    /* look for a newer build when the app is brought back to the front */
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && reg) reg.update().catch(function () {});
    });
  });

  /* ------------------------------------------------------ update on offer -- */
  var updateBox = null;

  function offerUpdate(worker) {
    if (updateBox) return;

    updateBox = el('div', 'pwa-toast');
    updateBox.setAttribute('role', 'status');
    updateBox.innerHTML =
      '<div class="pwa-toast-txt"><b>A newer version is ready</b>' +
      '<span>Reload to pick it up. Nothing you have typed is sent anywhere first.</span></div>';

    var go = el('button', 'pwa-btn pwa-btn-go', 'Reload');
    go.type = 'button';
    go.addEventListener('click', function () {
      go.disabled = true;
      go.textContent = 'Reloading…';
      worker.postMessage({ type: 'SKIP_WAITING' });
      /* controllerchange normally does it; this is the belt for a worker that
         never takes control (Firefox private windows, mostly) */
      setTimeout(function () { if (!reloading) { reloading = true; location.reload(); } }, 1600);
    });

    var later = el('button', 'pwa-btn pwa-btn-quiet', 'Later');
    later.type = 'button';
    later.setAttribute('aria-label', 'Dismiss the update notice');
    later.addEventListener('click', function () { close(updateBox); updateBox = null; });

    var acts = el('div', 'pwa-toast-acts');
    acts.appendChild(go);
    acts.appendChild(later);
    updateBox.appendChild(acts);
    open(updateBox);
  }

  /* ------------------------------------------------------- install prompt -- */
  var deferred = null;
  var banner   = null;

  function installable() {
    return !!deferred || (iOSSafari() && !standalone());
  }

  function paintInstallButtons() {
    var on = installable();
    Array.prototype.forEach.call(document.querySelectorAll('[data-pwa-install]'), function (b) {
      b.hidden = !on;
      if (!b.dataset.pwaBound) {
        b.dataset.pwaBound = '1';
        b.addEventListener('click', function (e) { e.preventDefault(); install(); });
      }
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    paintInstallButtons();
    if (!snoozed()) setTimeout(showBanner, 3500);
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    snooze();
    if (banner) { close(banner); banner = null; }
    paintInstallButtons();
    say('Installed. You can open JUDECH from your home screen.');
  });

  function install() {
    if (deferred && typeof deferred.prompt === 'function') {
      var choice;
      try { deferred.prompt(); choice = deferred.userChoice; }
      catch (e) { deferred = null; paintInstallButtons(); return; }
      Promise.resolve(choice).then(function (answer) {
        if (answer && answer.outcome === 'accepted') deferred = null;
        else snooze();
        if (banner) { close(banner); banner = null; }
        paintInstallButtons();
      }).catch(function () {});
      return;
    }
    if (iOSSafari()) showIosSheet();
  }

  /* The catalog waves hello from the same corner for the first fifteen seconds.
     Two greetings stacked on each other is one too many, so the install offer
     waits its turn and comes up once the other has said its piece. */
  var waitingOnGreeting = false;

  function greetingUp() {
    return !!document.querySelector('.chat-tip[data-open="true"]');
  }

  function afterGreeting() {
    var tip = document.querySelector('.chat-tip');
    if (!tip || waitingOnGreeting || !window.MutationObserver) return;
    waitingOnGreeting = true;

    var give = function () {
      if (!waitingOnGreeting) return;
      waitingOnGreeting = false;
      watch.disconnect();
      clearTimeout(fuse);
      setTimeout(showBanner, 700);
    };
    var watch = new MutationObserver(function () {
      if (tip.dataset.open !== 'true') give();
    });
    watch.observe(tip, { attributes: true, attributeFilter: ['data-open'] });
    var fuse = setTimeout(give, 18000);      /* it retires at fifteen seconds */
  }

  function showBanner() {
    if (banner || standalone() || snoozed() || !deferred) return;
    if (greetingUp()) { afterGreeting(); return; }

    banner = el('aside', 'pwa-install');
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'Install this app');

    var mark = el('span', 'pwa-install-mark');
    mark.appendChild(iconMark());

    var txt = el('div', 'pwa-install-txt');
    txt.appendChild(el('b', null, 'Install Build with JUDECH'));
    txt.appendChild(el('span', null, 'Full screen, its own icon, and the pages you have opened still work offline.'));

    var go = el('button', 'pwa-btn pwa-btn-go', 'Install');
    go.type = 'button';
    go.addEventListener('click', install);

    var no = el('button', 'pwa-btn pwa-btn-quiet', 'Not now');
    no.type = 'button';
    no.addEventListener('click', function () { snooze(); close(banner); banner = null; });

    var acts = el('div', 'pwa-install-acts');
    acts.appendChild(go);
    acts.appendChild(no);

    banner.appendChild(mark);
    banner.appendChild(txt);
    banner.appendChild(acts);
    open(banner);
    document.body.classList.add('has-pwa-banner');
    /* the message button on the catalog sits in the same corner; tell the css
       how far to lift it rather than guessing at a height the text decides */
    requestAnimationFrame(function () {
      if (!banner) return;
      root.style.setProperty('--pwa-banner-h', banner.offsetHeight + 'px');
    });
  }

  /* iOS has no prompt to defer, so the honest thing is the instruction */
  function showIosSheet() {
    if (document.querySelector('.pwa-ios')) return;

    var sheet = el('div', 'pwa-ios');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-label', 'Add this app to your Home Screen');

    var card = el('div', 'pwa-ios-card');
    var mark = el('span', 'pwa-install-mark');
    mark.appendChild(iconMark());
    card.appendChild(mark);
    card.appendChild(el('b', null, 'Add JUDECH to your Home Screen'));
    card.appendChild(el('p', null, 'Safari installs apps from the Share menu — two taps and it behaves like any other app on the phone.'));

    /* each step's sentence lives in one element: the <li> is a two-column grid
       and loose text beside the number would each become a column of its own */
    var steps = el('ol', 'pwa-ios-steps');
    var one = el('li');
    one.innerHTML = '<span>Tap <span class="pwa-ios-glyph" aria-hidden="true">' +
      '<svg viewBox="0 0 24 24"><path d="M12 15.4V3.8"/><path d="M8.4 7.2 12 3.6l3.6 3.6"/>' +
      '<path d="M6 11.2H4.9v8.4h14.2v-8.4H18"/></svg></span> <b>Share</b>, ' +
      'at the bottom of Safari</span>';
    var two = el('li');
    two.innerHTML = '<span>Choose <b>Add to Home Screen</b>, then <b>Add</b></span>';
    steps.appendChild(one);
    steps.appendChild(two);
    card.appendChild(steps);

    var done = el('button', 'pwa-btn pwa-btn-go', 'Got it');
    done.type = 'button';
    card.appendChild(done);
    sheet.appendChild(card);

    function shut() {
      snooze();
      sheet.removeAttribute('data-open');
      setTimeout(function () { sheet.remove(); }, 260);
      document.removeEventListener('keydown', esc);
    }
    function esc(e) { if (e.key === 'Escape') shut(); }

    done.addEventListener('click', shut);
    sheet.addEventListener('click', function (e) { if (e.target === sheet) shut(); });
    document.addEventListener('keydown', esc);

    document.body.appendChild(sheet);
    requestAnimationFrame(function () { sheet.setAttribute('data-open', 'true'); });
    done.focus();
  }

  /* the iOS hint is not worth a first visit; by the second it is a kindness */
  if (iOSSafari() && !standalone() && !snoozed() && visit() >= 2) {
    window.addEventListener('load', function () { setTimeout(showIosSheet, 4500); });
  }
  paintInstallButtons();
  document.addEventListener('DOMContentLoaded', paintInstallButtons);

  /* ------------------------------------------------------ the browser bar --
     The two <meta name="theme-color"> tags in the head answer the system
     setting, which is the right answer until somebody uses the switch on the
     page: data-theme changes what is painted but not what the system reports,
     and the bar above the page would stay the colour of the theme just left.
     So the page's own background is read back and written to both tags. */
  function paintBrowserBar() {
    var tags = document.querySelectorAll('meta[name="theme-color"]');
    if (!tags.length) return;
    var ground = getComputedStyle(root).getPropertyValue('--ground').trim();
    if (!ground) return;
    Array.prototype.forEach.call(tags, function (m) { m.setAttribute('content', ground); });
  }

  paintBrowserBar();
  if (window.MutationObserver) {
    new MutationObserver(paintBrowserBar)
      .observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  }
  if (window.matchMedia) {
    var scheme = window.matchMedia('(prefers-color-scheme: dark)');
    var repaint = function () { setTimeout(paintBrowserBar, 0); };
    if (scheme.addEventListener) scheme.addEventListener('change', repaint);
    else if (scheme.addListener) scheme.addListener(repaint);
  }

  /* ---------------------------------------------------------- the network -- */
  var pill = null;

  function showPill(text, kind) {
    if (!pill) {
      pill = el('div', 'pwa-pill');
      pill.setAttribute('role', 'status');
      pill.setAttribute('aria-live', 'polite');
      document.body.appendChild(pill);
    }
    pill.textContent = text;
    pill.dataset.kind = kind;
    requestAnimationFrame(function () { pill.setAttribute('data-open', 'true'); });
  }
  function hidePill(after) {
    if (!pill) return;
    setTimeout(function () { if (pill) pill.removeAttribute('data-open'); }, after || 0);
  }
  function say(text) { showPill(text, 'good'); hidePill(3200); }

  window.addEventListener('offline', function () { showPill('Offline — showing the last copy', 'bad'); });
  window.addEventListener('online',  function () { showPill('Back online', 'good'); hidePill(2200); });
  if (navigator.onLine === false) showPill('Offline — showing the last copy', 'bad');

  /* -------------------------------------------------- opening and closing -- */
  function open(node) {
    document.body.appendChild(node);
    requestAnimationFrame(function () { node.setAttribute('data-open', 'true'); });
  }
  function close(node) {
    if (!node) return;
    node.removeAttribute('data-open');
    if (node.classList.contains('pwa-install')) {
      document.body.classList.remove('has-pwa-banner');
      root.style.removeProperty('--pwa-banner-h');
    }
    setTimeout(function () { if (node.parentNode) node.remove(); }, 300);
  }
})();
