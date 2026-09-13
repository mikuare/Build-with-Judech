/* JUDECH — light and dark, with the switch drawn on screen
   ---------------------------------------------------------------------------
   The stylesheet already speaks three states: no attribute means “follow the
   system”, data-theme="light" and data-theme="dark" override it. This file only
   decides which of the three is on, remembers it, and makes the change visible:
   the incoming theme opens out of the button in a circle until it has taken the
   whole screen.

   Where the browser supports view transitions the real page is revealed through
   that circle. Where it does not, a disc of the incoming background does the
   same sweep and the page is swapped underneath it. Reduced motion gets the
   switch with no theatre at all.

   Loaded by index.html and admin.html, after the tiny inline script in <head>
   that paints the stored choice before the first frame.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  var KEY = 'judech.theme';
  var root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(theme) {
    try { localStorage.setItem(KEY, theme); } catch (e) {}
  }
  function systemDark() {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function current() {
    var set = root.getAttribute('data-theme');
    if (set === 'light' || set === 'dark') return set;
    return systemDark() ? 'dark' : 'light';
  }
  function calm() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  /* The background the incoming theme will paint, read by wearing that theme
     for the length of one style calculation — no frame is drawn in between. */
  function groundOf(theme) {
    var was = root.getAttribute('data-theme');
    root.setAttribute('data-theme', theme);
    var style = getComputedStyle(root);
    var colour = (style.getPropertyValue('--band-a') || style.getPropertyValue('--ground') || '').trim();
    if (was === null) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', was);
    return colour || (theme === 'dark' ? '#19211D' : '#FFFFFF');
  }

  function paintButtons(theme) {
    var next = theme === 'dark' ? 'light' : 'dark';
    Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (btn) {
      btn.dataset.theme = theme;
      btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
      btn.setAttribute('aria-label', 'Switch to the ' + next + ' theme');
      btn.setAttribute('title', 'Switch to the ' + next + ' theme');
    });
  }

  function apply(theme) {
    root.setAttribute('data-theme', theme);
    remember(theme);
    paintButtons(theme);
  }

  /* how far the circle has to travel to swallow the furthest corner */
  function reach(x, y) {
    var w = window.innerWidth, h = window.innerHeight;
    return Math.ceil(Math.max(
      Math.hypot(x, y), Math.hypot(w - x, y),
      Math.hypot(x, h - y), Math.hypot(w - x, h - y)
    ));
  }

  function sweep(theme, x, y) {
    var r = reach(x, y);
    var from = 'circle(0px at ' + x + 'px ' + y + 'px)';
    var to = 'circle(' + r + 'px at ' + x + 'px ' + y + 'px)';
    var timing = { duration: 620, easing: 'cubic-bezier(.35,0,.2,1)' };

    /* the real page, revealed through the opening circle */
    if (document.startViewTransition) {
      var run = document.startViewTransition(function () { apply(theme); });
      run.ready.then(function () {
        root.animate({ clipPath: [from, to] },
          { duration: timing.duration, easing: timing.easing,
            pseudoElement: '::view-transition-new(root)' });
      }).catch(function () {});          /* transition skipped: the theme is on anyway */
      return;
    }

    /* elsewhere: a disc of the incoming background does the same sweep and the
       page changes underneath it, so the swap itself is never seen */
    var disc = document.createElement('div');
    disc.className = 'theme-sweep';
    disc.style.background = groundOf(theme);
    disc.style.clipPath = from;
    document.body.appendChild(disc);

    var done = function () {
      apply(theme);
      requestAnimationFrame(function () { disc.remove(); });
    };
    if (!disc.animate) { done(); return; }
    var anim = disc.animate({ clipPath: [from, to] }, timing);
    anim.addEventListener('finish', done);
    anim.addEventListener('cancel', done);
  }

  function toggle(e) {
    var theme = current() === 'dark' ? 'light' : 'dark';
    if (calm()) { apply(theme); return; }
    var btn = e.currentTarget;
    var box = btn.getBoundingClientRect();
    sweep(theme, Math.round(box.left + box.width / 2), Math.round(box.top + box.height / 2));
  }

  Array.prototype.forEach.call(document.querySelectorAll('[data-theme-toggle]'), function (btn) {
    btn.addEventListener('click', toggle);
  });
  paintButtons(current());

  /* nothing chosen yet? then keep following the system as it changes */
  if (window.matchMedia) {
    var watch = window.matchMedia('(prefers-color-scheme: dark)');
    var follow = function () { if (!stored()) paintButtons(current()); };
    if (watch.addEventListener) watch.addEventListener('change', follow);
    else if (watch.addListener) watch.addListener(follow);
  }
})();
