/* JUDECH — going back
   ---------------------------------------------------------------------------
   A project opens over the catalog, a package item opens over the project, an
   image opens over that. Three layers deep, the only way out used to be a small
   × in the corner — and pressing Back left the site altogether. Installed as an
   app there is no browser Back to press at all, so on a phone that × was the
   only door in the building.

   This file is the door. Every view that opens over another one registers here:

     JudechBack.open({ key, el, close, backLabel })

   and in return gets two things. One entry on the history stack, so the phone's
   own Back gesture closes that view and nothing else. And, when it names the
   view it came from, a labelled back button drawn into its header — "‹ Envir-
   oSortPro" reads as a way home in a way that × never did.

   The two directions are kept honest by one flag. Back pressed by the user
   arrives as popstate: pop the top view and close it. Close pressed in the page
   unwinds the history entries itself, and swallows the popstate that causes so
   the view is not closed twice.

   Loaded by index.html and admin.html before the page script that uses it.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  var stack   = [];        /* outermost first, the view you can see is last */
  var sealing = false;     /* a popstate we asked for, and must ignore */
  var seal    = null;
  var canPush = !!(window.history && window.history.pushState);

  var CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
                '<path d="M15 5l-7 7 7 7"/></svg>';

  function at(key) {
    for (var i = 0; i < stack.length; i++) if (stack[i].key === key) return i;
    return -1;
  }

  /* ------------------------------------------------------- the back button --
     Inside the heading block where there is one, so it reads as the line above
     the title rather than a second control competing with the ×; beside the ×
     on a viewer that has no heading at all. */
  function paintBack(view) {
    if (!view.el) return;
    var host = view.el.querySelector('.modal-hd > div') ||
               view.el.querySelector('.modal-hd') ||
               view.el.querySelector('.modal');
    if (!host) return;

    var btn = view.el.querySelector('.modal-back');
    if (!view.backLabel) { if (btn) btn.remove(); return; }

    if (!btn) {
      btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'modal-back';
      btn.innerHTML = CHEVRON + '<span></span>';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        api.close(view.key);
      });
      host.insertBefore(btn, host.firstChild);
    }
    btn.querySelector('span').textContent = view.backLabel;
    btn.setAttribute('aria-label', 'Back to ' + view.backLabel);
    btn.title = 'Back to ' + view.backLabel;
  }

  function unpaint(view) {
    if (!view || !view.el) return;
    var btn = view.el.querySelector('.modal-back');
    if (btn) btn.remove();
  }

  /* ------------------------------------------------------------ the sealing -- */
  function sealNext() {
    sealing = true;
    clearTimeout(seal);
    /* if the entries were not there to unwind, no popstate arrives and the flag
       would swallow the user's next real Back */
    seal = setTimeout(function () { sealing = false; }, 700);
  }

  window.addEventListener('popstate', function () {
    if (sealing) { sealing = false; clearTimeout(seal); return; }
    var view = stack.pop();
    if (!view) return;                        /* nothing of ours: leave the page */
    unpaint(view);
    try { view.close(true); } catch (e) {}
  });

  /* A page restored from the back-forward cache has a stack that no longer
     matches its history; start again rather than guess. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) stack = [];
  });

  var api = {
    open: function (view) {
      if (!view || !view.key || typeof view.close !== 'function') return;

      var i = at(view.key);
      if (i === stack.length - 1 && i > -1) {  /* already the view on top */
        stack[i].backLabel = view.backLabel;
        stack[i].el = view.el || stack[i].el;
        paintBack(stack[i]);
        return;
      }
      if (i > -1) api.close(view.key);         /* re-opened from deeper in */

      stack.push(view);
      paintBack(view);
      if (canPush) {
        try { history.pushState({ judech: stack.length }, ''); } catch (e) {}
      }
    },

    /* the page closing a view itself: run it and everything stacked over it,
       then take the matching history entries back down with them */
    close: function (key) {
      var i = at(key);
      if (i < 0) return false;
      var dropped = stack.splice(i);
      for (var n = dropped.length - 1; n >= 0; n--) {
        unpaint(dropped[n]);
        try { dropped[n].close(false); } catch (e) {}
      }
      if (canPush && dropped.length) {
        sealNext();
        history.go(-dropped.length);           /* one popstate, however many */
      }
      return true;
    },

    /* Take a view off the stack without running its closer — the page has
       already dealt with it — and unwind the matching history entries. */
    drop: function (key) {
      var i = at(key);
      if (i < 0) return false;
      var dropped = stack.splice(i);
      for (var n = 0; n < dropped.length; n++) unpaint(dropped[n]);
      if (canPush && dropped.length) {
        sealNext();
        history.go(-dropped.length);
      }
      return true;
    },

    /* One view giving way to the next in the same flow — signing in and landing
       on the project, paying and landing on the terms. That is one step forward
       for the reader, so the newcomer takes the departing view's place rather
       than stacking a second entry behind it and costing two presses of Back to
       undo one step forward. */
    swap: function (oldKey, view) {
      var i = at(oldKey);
      if (i < 0 || !view || typeof view.close !== 'function') return false;
      unpaint(stack[i]);
      stack[i] = view;
      /* anything that was stacked over the view being replaced is gone with it */
      var above = stack.splice(i + 1);
      for (var n = 0; n < above.length; n++) unpaint(above[n]);
      if (canPush && above.length) { sealNext(); history.go(-above.length); }
      paintBack(view);
      return true;
    },

    /* close whatever is on top, as the Back button would */
    back: function () {
      var top = stack[stack.length - 1];
      return top ? api.close(top.key) : false;
    },

    has:   function (key) { return at(key) > -1; },
    top:   function () { var t = stack[stack.length - 1]; return t ? t.key : null; },
    depth: function () { return stack.length; },

    /* the label can change while a view is open — the same viewer is reached
       from the project one moment and from a file list the next */
    label: function (key, text) {
      var i = at(key);
      if (i < 0) return;
      stack[i].backLabel = text;
      paintBack(stack[i]);
    }
  };

  window.JudechBack = api;
})();
