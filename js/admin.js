/* JUDECH — admin dashboard
   Sign in, see what buyers submitted, approve or reject, issue access codes for
   buyers who paid elsewhere, and look over the signed agreements. */
(function () {
  'use strict';

  /* both take an optional root, so a card can search only inside itself */
  var $ = function (s, root) { return (root || document).querySelector(s); };
  var $$ = function (s, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(s));
  };
  var B = window.Backend;

  var state = { tab: 'inbox', filter: 'pending', projects: [], timer: null,
                presenceTimer: null, user: null, terms: null, payments: {}, doc: null,
                access: {}, clients: [], proofs: [], threads: [], msgThread: null,
                users: [], userFilter: 'all' };
  var CURRENT_TERMS = '2026-09-11 · sections 1-13';
  var RIGHTS_LABEL = { catalog: 'Yours to use — JUDECH keeps the original',
                       custom: 'Yours to own — ownership transfers to the buyer' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function when(iso) { return iso ? new Date(iso).toLocaleString() : '—'; }
  function day(d) {
    if (!d) return '—';
    var p = String(d).split('-');
    if (p.length !== 3) return d;
    var m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return Number(p[2]) + ' ' + m[Number(p[1]) - 1] + ' ' + p[0];
  }
  function money(n, cur) { return n == null ? '—' : (cur || 'PHP') + ' ' + Number(n).toLocaleString(undefined, { minimumFractionDigits: 2 }); }
  function show(id, on) { var el = $(id); if (el) el.hidden = !on; }
  function say(sel, text, kind) {
    var el = $(sel); if (!el) return;
    el.textContent = text || '';
    el.dataset.err = kind === 'err' ? 'true' : 'false';
    el.dataset.ok = kind === 'ok' ? 'true' : 'false';
  }

  function stopPresence() {
    if (state.presenceTimer) {
      clearInterval(state.presenceTimer);
      state.presenceTimer = null;
    }
  }
  function pingPresence() {
    if (!state.user || !B.recordPresence || document.visibilityState === 'hidden') return;
    B.recordPresence('heartbeat').catch(function () {});
  }
  function startPresence() {
    stopPresence();
    pingPresence();
    state.presenceTimer = setInterval(pingPresence, 45000);
  }

  /* ---------- screens ---------- */
  function screen(which) {
    show('#noBackend', which === 'nobackend');
    show('#loginBox', which === 'login');
    show('#notAdmin', which === 'notadmin');
    show('#dash', which === 'dash');
    $('#signOut').hidden = !(which === 'dash' || which === 'notadmin');
    if (which === 'dash' || which === 'notadmin') $('#signOut').disabled = false;
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
    if (which === 'dash') state.timer = setInterval(function () { load(true); }, 30000);
  }

  function boot() {
    if (!B || !B.enabled) { screen('nobackend'); return; }
    B.session().then(function (s) {
      if (!s) { screen('login'); return; }
      afterSignIn(s.user);
    }).catch(function () { screen('login'); });
    B.onAuth(function (s) {
      if (!s) {
        stopPresence();
        state.user = null;
        if ($('#dash').hidden === false || $('#notAdmin').hidden === false) screen('login');
      }
    });
  }

  function afterSignIn(user) {
    state.user = user;
    startPresence();
    $('#whoami').textContent = user.email || '';
    B.isAdmin().then(function (ok) {
      if (!ok) {
        $('#adminSql').textContent =
          "insert into public.admins (user_id, email)\nvalues ('" + user.id + "', '" + (user.email || '') + "')\non conflict (user_id) do nothing;";
        screen('notadmin');
        return;
      }
      screen('dash');
      load();
    }).catch(function (e) { say('#loginMsg', e.message, 'err'); screen('login'); });
  }

  /* ---------- sign in / out ---------- */
  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#loginBtn');
    btn.disabled = true; say('#loginMsg', 'Signing in…');
    B.signIn($('#email').value.trim(), $('#password').value)
      .then(function (d) { say('#loginMsg', ''); afterSignIn(d.user); })
      .catch(function (err) { say('#loginMsg', err.message, 'err'); })
      .then(function () { btn.disabled = false; });
  });
  $('#adminGoogle').addEventListener('click', function () {
    say('#loginMsg', 'Taking you to Google…');
    B.signInWithGoogle(location.href.split('#')[0])
      .catch(function (e) { say('#loginMsg', e.message, 'err'); });
  });
  $('#signOut').addEventListener('click', function () {
    var btn = $('#signOut');
    btn.disabled = true;
    stopPresence();
    var marked = B.recordPresence
      ? B.recordPresence('signout').catch(function () {})
      : Promise.resolve();
    marked.then(function () { return B.signOut(); })
      .then(function () { state.user = null; screen('login'); })
      .catch(function () { btn.disabled = false; startPresence(); });
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') pingPresence();
  });

  /* ---------- tabs & filters ---------- */
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      state.tab = t.dataset.tab;
      $$('.tab').forEach(function (x) { x.setAttribute('aria-selected', x === t); });
      $$('.panel').forEach(function (p) { p.hidden = p.id !== 'panel-' + state.tab; });
      $('#dashTitle').textContent = state.tab === 'inbox' ? 'Payments waiting for you'
        : state.tab === 'messages' ? 'Messages from users'
        : state.tab === 'activity' ? 'Users'
        : state.tab === 'clients' ? 'Who has paid for what'
        : state.tab === 'proof' ? 'Proof of legitimacy'
        : state.tab === 'grants' ? 'Access codes for buyers who paid elsewhere'
        : state.tab === 'hero' ? 'Landing-page hero slides'
        : state.tab === 'projects' ? 'The catalog'
        : 'Signed agreements';
      load();
    });
  });
  $$('#inboxFilters .filter').forEach(function (f) {
    f.addEventListener('click', function () {
      state.filter = f.dataset.status;
      $$('#inboxFilters .filter').forEach(function (x) { x.setAttribute('aria-pressed', x === f); });
      loadInbox();
    });
  });
  $('#refreshBtn').addEventListener('click', function () { load(); });

  function load(quiet) {
    if (!quiet) $('#refreshBtn').disabled = true;
    var p = state.tab === 'inbox' ? loadInbox()
      : state.tab === 'messages' ? loadMessages()
      : state.tab === 'activity' ? loadActivity()
      : state.tab === 'clients' ? loadClients()
      : state.tab === 'proof' ? loadProofs()
      : state.tab === 'grants' ? loadGrants()
      : state.tab === 'hero' ? loadHeroSlides()
      : state.tab === 'projects' ? loadProjects()
      : loadAgreements();
    return Promise.resolve(p)
      .then(countPending)
      .then(paintPulse)
      .catch(function (e) { console.error(e); })
      .then(function () { $('#refreshBtn').disabled = false; });
  }

  /* ---------- the pulse ----------
     Supabase pauses a Free-plan project after a week without database activity.
     The strip in the header says when it last saw some, colours itself by how
     long ago that was, and lets you give it a beat by hand. */
  function paintPulse() {
    var el = $('#pulse'), text = $('#pulseText');
    if (!el || !B.heartbeatStatus) return Promise.resolve();
    return B.heartbeatStatus().then(function (st) {
      var last = st && st.last_at ? new Date(st.last_at) : null;
      var hours = last ? (Date.now() - last.getTime()) / 36e5 : Infinity;
      el.dataset.state = !last ? 'unknown' : hours < 48 ? 'fresh' : hours < 120 ? 'ageing' : 'stale';
      text.textContent = !last
        ? 'No heartbeat recorded yet'
        : 'Database active ' + ago(st.last_at) +
          (st.last_source ? ' via ' + st.last_source : '') +
          ' · ' + Number(st.last_7_days || 0) + ' beat' + (Number(st.last_7_days) === 1 ? '' : 's') + ' this week';
      el.title = 'Supabase pauses a free project after a week without activity.' +
        (last ? ' Last seen ' + when(st.last_at) + '.' : '') +
        ' Anything under 7 days is safe; this turns amber past 2 and red past 5.';
    }).catch(function (e) {
      el.dataset.state = 'unknown';
      text.textContent = 'Could not read the heartbeat: ' + e.message;
    });
  }

  function countPending() {
    return Promise.all([B.inbox('pending'), B.userActivity(), B.adminMessages()]).then(function (both) {
      var rows = both[0], accounts = both[1], messages = both[2];
      var c = $('#pendingCount');
      c.textContent = rows.length;
      c.dataset.zero = rows.length === 0 ? 'true' : 'false';
      var active = accounts.filter(function (a) { return a.is_active; }).length;
      var ac = $('#activeCount');
      ac.textContent = active;
      ac.dataset.zero = active === 0 ? 'true' : 'false';
      var waiting = messages.reduce(function (n, m) {
        return n + (m.entries || []).filter(function (e) {
          return e.sender_role === 'user' && !e.read_at;
        }).length;
      }, 0);
      var mc = $('#messageCount');
      mc.textContent = waiting;
      mc.dataset.zero = waiting === 0 ? 'true' : 'false';
    });
  }

  /* ---------- user messages ---------- */
  /* ---------- the message inbox ----------
     Conversations belong to people, so the list is people: one row each, their
     threads underneath, unread counts on both. Picking one opens it in the pane
     beside the list — the transcript, then the composer, then the one
     destructive action, in that order and nowhere else. */
  function threadUnread(m) {
    return (m.entries || []).filter(function (e) {
      return e.sender_role === 'user' && !e.read_at;
    }).length;
  }

  function lastEntry(m) {
    var entries = m.entries || [];
    return entries.length ? entries[entries.length - 1] : null;
  }

  function threadStamp(m) {
    var last = lastEntry(m);
    return (last && last.created_at) || m.updated_at || m.created_at;
  }

  function peopleFrom(rows) {
    var map = {};
    (rows || []).forEach(function (m) {
      var key = String(m.user_email || m.user_id || m.user_name || 'unknown').toLowerCase();
      var who = map[key] || (map[key] = {
        key: key,
        name: m.user_name || 'Google user',
        email: m.user_email || '',
        threads: [], unread: 0, lastAt: threadStamp(m)
      });
      who.threads.push(m);
      who.unread += threadUnread(m);
      if (new Date(threadStamp(m)) > new Date(who.lastAt)) who.lastAt = threadStamp(m);
    });
    return Object.keys(map).map(function (k) {
      map[k].threads.sort(function (a, b) {
        return new Date(threadStamp(b)) - new Date(threadStamp(a));
      });
      return map[k];
    }).sort(function (a, b) {
      if ((b.unread > 0) !== (a.unread > 0)) return b.unread - a.unread;
      return new Date(b.lastAt) - new Date(a.lastAt);
    });
  }

  function initials(name) {
    var parts = String(name || '?').trim().split(/\s+/).slice(0, 2);
    return parts.map(function (p) { return p.charAt(0).toUpperCase(); }).join('') || '?';
  }

  function preview(m) {
    var last = lastEntry(m);
    if (!last) return 'No messages yet';
    return (last.sender_role === 'admin' ? 'You: ' : '') +
      String(last.body || '').replace(/\s+/g, ' ').slice(0, 70);
  }

  function loadMessages() {
    return B.adminMessages().then(function (rows) {
      state.threads = rows || [];
      renderInbox();
      $('#messageEmpty').hidden = state.threads.length > 0;
      $('#inbox').hidden = state.threads.length === 0;
      return null;
    });
  }

  /* Reading is opening: the thread you have on screen stops being unread. */
  function markThreadRead(m) {
    if (!m || !threadUnread(m) || !B.markMessageRead) return Promise.resolve();
    return B.markMessageRead(m.id).then(function () {
      var now = new Date().toISOString();
      (m.entries || []).forEach(function (e) {
        if (e.sender_role === 'user' && !e.read_at) e.read_at = now;
      });
      renderInbox({ listOnly: true });
      return countPending();
    }).catch(function () {});
  }

  function renderInbox(opts) {
    opts = opts || {};
    var rows = state.threads || [];
    var people = peopleFrom(rows);
    var query = ($('#inboxSearch') && $('#inboxSearch').value || '').trim().toLowerCase();

    if (query) {
      people = people.filter(function (who) {
        var hay = (who.name + ' ' + who.email + ' ' +
          who.threads.map(function (m) { return m.title; }).join(' ')).toLowerCase();
        return hay.indexOf(query) > -1;
      });
    }

    /* keep the open thread if it still exists, else take the one most in need */
    var open = rows.filter(function (m) { return m.id === state.msgThread; })[0];
    if (!open) {
      var waiting = rows.filter(threadUnread)[0];
      open = waiting || (people[0] && people[0].threads[0]) || rows[0] || null;
      state.msgThread = open ? open.id : null;
    }
    var openWho = open
      ? people.filter(function (w) {
          return w.threads.some(function (m) { return m.id === open.id; });
        })[0]
      : null;

    $('#inboxPeople').innerHTML = people.length
      ? people.map(function (who) { return personRow(who, open); }).join('')
      : '<p class="inbox-none">Nobody matches that.</p>';
    bindInboxList();

    if (opts.listOnly) return;

    $('#inboxView').innerHTML = open ? conversationView(open, openWho) : emptyView();
    if (!open) return;
    bindConversation(open);
    var history = $('[data-admin-thread="' + open.id + '"]');
    if (history) history.scrollTop = history.scrollHeight;
    markThreadRead(open);
  }

  function personRow(who, open) {
    var here = open && who.threads.some(function (m) { return m.id === open.id; });
    return '<div class="person' + (here ? ' is-open' : '') + '" data-person="' + esc(who.key) + '">' +
      '<button class="person-head" type="button" data-open-thread="' + esc(who.threads[0].id) + '">' +
        '<span class="avatar' + (who.unread ? ' has-unread' : '') + '">' + esc(initials(who.name)) + '</span>' +
        '<span class="person-main">' +
          '<b>' + esc(who.name) + '</b>' +
          '<span class="person-mail">' + esc(who.email || 'no email on file') + '</span>' +
          '<span class="person-last">' + esc(preview(who.threads[0])) + '</span>' +
        '</span>' +
        '<span class="person-side">' +
          '<span class="person-when">' + esc(ago(who.lastAt)) + '</span>' +
          (who.unread ? '<b class="person-dot">' + who.unread + '</b>' : '') +
        '</span>' +
      '</button>' +
      '<div class="person-threads">' + who.threads.map(function (m) {
        var unread = threadUnread(m);
        return '<button class="person-thread' + (open && m.id === open.id ? ' is-open' : '') +
          '" type="button" data-open-thread="' + m.id + '">' +
          '<span>' + esc(m.title) + '</span>' +
          (unread ? '<b class="person-dot">' + unread + '</b>'
                  : '<span class="person-when">' + esc(ago(threadStamp(m))) + '</span>') +
        '</button>';
      }).join('') + '</div>' +
    '</div>';
  }

  function emptyView() {
    return '<div class="inbox-empty"><p>Pick someone on the left to read the conversation.</p></div>';
  }

  function conversationView(m, who) {
    var entries = m.entries || [];
    var replied = entries.some(function (e) { return e.sender_role === 'admin'; });
    var unread = threadUnread(m);
    return '<header class="conv-head">' +
        '<span class="avatar">' + esc(initials(m.user_name)) + '</span>' +
        '<div class="conv-who">' +
          '<b>' + esc(m.title) + '</b>' +
          '<span>' + esc(m.user_name || 'Google user') +
            (m.user_email ? ' &middot; ' + esc(m.user_email) : '') +
            ' &middot; started ' + when(m.created_at) + '</span>' +
        '</div>' +
        '<span class="pill-s" data-s="' + (unread ? 'pending' : replied ? 'approved' : 'open') + '">' +
          (unread ? unread + ' new' : replied ? 'replied' : 'waiting') + '</span>' +
        (who && who.threads.length > 1
          ? '<span class="conv-count">' + who.threads.length + ' threads from them</span>' : '') +
      '</header>' +
      '<div class="admin-thread" data-admin-thread="' + m.id + '" tabindex="0" aria-label="Message history">' +
        entries.map(function (e) { return adminMessageEntry(m, e); }).join('') +
      '</div>' +
      '<div class="conv-foot">' +
        '<div class="composer" data-composer="' + m.id + '">' +
          '<textarea data-admin-compose="' + m.id + '" rows="1" maxlength="4000" ' +
            'placeholder="Write a reply…" aria-label="Write a reply"></textarea>' +
          '<button class="composer-send" type="button" data-send-admin-message="' + m.id + '" ' +
            'aria-label="Send reply" title="Send">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l16-8-6 16-2.5-6.5z"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="conv-tools">' +
          '<span class="muted">Enter sends &middot; Shift+Enter starts a new line</span>' +
          '<button class="btn btn-sm btn-danger" type="button" data-delete-conversation="' + m.id + '">' +
            'Delete this conversation</button>' +
        '</div>' +
      '</div>';
  }

  function bindInboxList() {
    $$('#inboxPeople [data-open-thread]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.msgThread === btn.dataset.openThread) return;
        state.msgThread = btn.dataset.openThread;
        renderInbox();
      });
    });
  }

  function bindConversation(m) {
    var view = $('#inboxView');

    $$('[data-send-admin-message]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = $('[data-admin-compose="' + btn.dataset.sendAdminMessage + '"]', view);
        var reply = box ? box.value.trim() : '';
        if (!reply) { if (box) box.focus(); return; }
        btn.disabled = true;
        B.addMessageEntry(btn.dataset.sendAdminMessage, reply)
          .then(loadMessages).then(countPending)
          .catch(function (e) { window.alert(e.message); btn.disabled = false; });
      });
    });
    $$('[data-admin-compose]', view).forEach(function (box) {
      grow(box);
      box.addEventListener('input', function () { grow(box); });
      box.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' || e.shiftKey) return;
        e.preventDefault();
        var send = $('[data-send-admin-message="' + box.dataset.adminCompose + '"]', view);
        if (send) send.click();
      });
    });

    /* the pencil opens one bubble for editing and closes it again */
    $$('[data-admin-edit-toggle]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var line = btn.closest('.chat-line');
        line.querySelector('[data-entry-edit]').hidden = false;
        line.querySelector('[data-entry-text]').hidden = true;
        line.dataset.editing = 'true';
        var box = line.querySelector('[data-entry-edit] textarea');
        box.focus();
        box.setSelectionRange(box.value.length, box.value.length);
        grow(box);
      });
    });
    $$('[data-cancel-admin-entry]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var line = btn.closest('.chat-line');
        var editor = line.querySelector('[data-entry-edit]');
        editor.querySelector('textarea').value = line.querySelector('[data-entry-text]').textContent;
        editor.hidden = true;
        line.querySelector('[data-entry-text]').hidden = false;
        line.dataset.editing = 'false';
      });
    });
    $$('[data-save-admin-entry]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        var box = $('[data-admin-entry="' + btn.dataset.saveAdminEntry + '"]', view);
        var body = box ? box.value.trim() : '';
        if (!body) { if (box) box.focus(); return; }
        btn.disabled = true;
        B.updateMessageEntry(btn.dataset.saveAdminEntry, body)
          .then(loadMessages).then(countPending)
          .catch(function (e) { window.alert(e.message); btn.disabled = false; });
      });
    });
    $$('[data-delete-entry]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Delete this message permanently? The user cannot restore it.')) return;
        btn.disabled = true;
        B.deleteMessageEntry(btn.dataset.deleteEntry).then(loadMessages).then(countPending)
          .catch(function (e) { window.alert(e.message); btn.disabled = false; });
      });
    });
    $$('[data-delete-conversation]', view).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (!window.confirm('Delete “' + m.title + '” and every message in it permanently?')) return;
        btn.disabled = true;
        state.msgThread = null;
        B.deleteMessageConversation(btn.dataset.deleteConversation).then(loadMessages).then(countPending)
          .catch(function (e) { window.alert(e.message); btn.disabled = false; });
      });
    });
  }


  function adminMessageEntry(m, e) {
    var admin = e.sender_role === 'admin';
    var unread = !admin && !e.read_at;
    return '<div class="chat-line ' + (admin ? 'from-admin' : 'from-user') +
      (unread ? ' is-unread' : '') + '" data-entry="' + e.id + '">' +
      '<div class="chat-row">' +
        '<div class="bubble">' +
          '<p data-entry-text>' + esc(e.body) + '</p>' +
          (admin
            ? '<div class="bubble-edit" data-entry-edit hidden>' +
                '<textarea data-admin-entry="' + e.id + '" maxlength="4000" ' +
                  'aria-label="Edit this reply">' + esc(e.body) + '</textarea>' +
                '<div class="bubble-edit-tools">' +
                  '<button class="btn btn-sm btn-primary" type="button" data-save-admin-entry="' + e.id + '">Save</button>' +
                  '<button class="btn btn-sm btn-ghost" type="button" data-cancel-admin-entry="' + e.id + '">Cancel</button>' +
                '</div>' +
              '</div>'
            : '') +
        '</div>' +
        '<div class="bubble-tools">' +
          (admin
            ? '<button class="chat-icon" type="button" data-admin-edit-toggle="' + e.id + '" ' +
              'title="Edit this reply" aria-label="Edit this reply">' +
              '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l4-1 10-10a2.5 2.5 0 0 0-3.5-3.5L4.5 15.5z"/><path d="M13.5 6.5l4 4"/></svg>' +
              '</button>'
            : '') +
          '<button class="chat-icon danger" type="button" data-delete-entry="' + e.id + '" ' +
            'title="Delete this message" aria-label="Delete this message">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<span class="chat-meta">' + esc(admin ? 'You' : (m.user_name || 'Google user')) + ' · ' +
        when(e.created_at) + (e.edited_at ? ' · edited' : '') +
        (admin ? ' · ' + (e.read_at ? 'Read' : 'Not read yet') : (unread ? ' · new' : '')) +
      '</span>' +
    '</div>';
  }

  /* ---------- signed-in accounts ---------- */
  function ago(iso) {
    if (!iso) return 'never';
    var seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 10) return 'just now';
    if (seconds < 60) return seconds + ' seconds ago';
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hours / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }

  /* ---------- people ----------
     Presence, what they have written, what they have bought, and the switch
     that stops a nuisance account writing anything more. */
  function loadActivity() {
    var read = B.userDirectory ? B.userDirectory() : B.userActivity();
    return read.then(function (rows) {
      state.users = rows || [];
      paintUsers();
    });
  }

  function paintUsers() {
    var rows = state.users || [];
    var filter = state.userFilter || 'all';
    var shown = rows.filter(function (a) {
      if (filter === 'active') return a.is_active;
      if (filter === 'blocked') return a.is_blocked;
      if (filter === 'writers') return Number(a.message_count || 0) > 0;
      return true;
    });
    $('#activeTotal').textContent = rows.filter(function (r) { return r.is_active; }).length;
    $('#accountTotal').textContent = rows.length;
    var blockedTotal = $('#blockedTotal');
    if (blockedTotal) blockedTotal.textContent = rows.filter(function (r) { return r.is_blocked; }).length;
    $('#activityList').innerHTML = shown.map(activityRow).join('');
    $('#activityEmpty').hidden = shown.length > 0;
    bindUserActions();
  }

  function bindUserActions() {
    $$('#activityList [data-block]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var who = (state.users || []).filter(function (u) { return u.user_id === btn.dataset.block; })[0];
        if (!who) return;
        var name = who.display_name || who.email || 'this account';
        var reason = window.prompt('Block ' + name + '?\n\nThey will not be able to open or add ' +
          'to conversations, submit a payment or redeem a code. Anything already bought and ' +
          'signed for stays theirs.\n\nReason (they do not see this):', 'Spam');
        if (reason === null) return;
        var hours = window.prompt('For how many hours? Leave blank to block until you lift it.', '');
        if (hours === null) return;
        btn.disabled = true;
        B.setUserBlock(who.user_id, true, reason, hours.trim() ? Number(hours) : null)
          .then(loadActivity)
          .catch(function (e) { window.alert(e.message); btn.disabled = false; });
      });
    });
    $$('#activityList [data-unblock]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        btn.disabled = true;
        B.setUserBlock(btn.dataset.unblock, false)
          .then(loadActivity)
          .catch(function (e) { window.alert(e.message); btn.disabled = false; });
      });
    });
  }

  function activityRow(a) {
    var status = a.is_active ? 'active'
      : (a.last_signed_out_at && new Date(a.last_signed_out_at) >= new Date(a.last_seen_at)
          ? 'signed out' : 'offline');
    var name = a.display_name || (a.email || '').split('@')[0] || 'Account';
    var initial = name.charAt(0).toUpperCase();
    var provider = a.provider === 'google' ? 'Google' : (a.provider || 'Unknown');
    return '<div class="row presence-row" data-status="' + (a.is_active ? 'active' : 'offline') + '"' +
        (a.is_blocked ? ' data-blocked="true"' : '') + '>' +
      '<div class="thumb presence-avatar">' +
        (a.avatar_url ? '<img src="' + esc(a.avatar_url) + '" alt="">' : esc(initial)) + '</div>' +
      '<div class="row-main">' +
        '<h4>' + esc(name) + ' <span class="pill-s" data-s="' +
          (a.is_active ? 'active' : 'expired') + '">' + esc(status) + '</span>' +
          (a.is_admin ? '<span class="pill-s" data-s="approved">admin</span>' : '') +
          (a.is_blocked ? '<span class="pill-s" data-s="rejected">blocked</span>' : '') + '</h4>' +
        '<dl class="kv">' +
          '<div><dt>Account</dt><dd>' + esc(a.email || '—') + '</dd></div>' +
          '<div><dt>Provider</dt><dd>' + esc(provider) + '</dd></div>' +
          '<div><dt>Last online</dt><dd>' + esc(ago(a.last_seen_at)) + '<br><span class="muted">' + when(a.last_seen_at) + '</span></dd></div>' +
          '<div><dt>Last sign-in</dt><dd>' + when(a.last_signed_in_at) + '</dd></div>' +
          '<div><dt>Last sign-out</dt><dd>' + when(a.last_signed_out_at) + '</dd></div>' +
          '<div><dt>Active sessions</dt><dd>' + Number(a.active_sessions || 0) + ' of ' + Number(a.session_count || 0) + '</dd></div>' +
          (a.message_count != null
            ? '<div><dt>Messages</dt><dd>' + Number(a.message_count) + ' in ' +
              Number(a.thread_count || 0) + ' thread' + (Number(a.thread_count) === 1 ? '' : 's') +
              (a.last_message_at ? '<br><span class="muted">last ' + ago(a.last_message_at) + '</span>' : '') +
              '</dd></div>' : '') +
          (a.payment_count != null
            ? '<div><dt>Payments</dt><dd>' + Number(a.payment_count) + '</dd></div>' : '') +
        '</dl>' +
        (a.is_blocked
          ? '<p class="note block-note"><b>Blocked</b> ' + when(a.blocked_at) +
            (a.blocked_until ? ' until ' + when(a.blocked_until) : ' — until you lift it') +
            (a.block_reason ? ' &middot; ' + esc(a.block_reason) : '') + '</p>'
          : '') +
        '<span class="account-id">' + esc(a.user_id) + '</span>' +
      '</div>' +
      (a.is_admin ? '' :
        '<div class="row-actions">' +
          (a.is_blocked
            ? '<button class="btn btn-sm btn-primary" type="button" data-unblock="' + esc(a.user_id) + '">Lift the block</button>'
            : '<button class="btn btn-sm btn-danger" type="button" data-block="' + esc(a.user_id) + '">Block this account</button>') +
        '</div>') +
    '</div>';
  }

  /* ---------- inbox ---------- */
  function loadInbox() {
    return B.inbox(state.filter).then(function (rows) {
      var list = $('#inboxList');
      list.innerHTML = rows.map(paymentRow).join('');
      $('#inboxEmpty').hidden = rows.length > 0;
      paintPackageAccess(rows);
      rows.forEach(function (r) {
        if (!r.receipt_path) return;
        B.signedUrl('receipts', r.receipt_path, 3600).then(function (url) {
          var t = list.querySelector('[data-thumb="' + r.id + '"]');
          if (!t || !url) return;
          t.innerHTML = '<button type="button" class="thumb-open" data-shot="' + esc(url) + '" ' +
            'data-shot-name="' + esc(r.buyer_name + ' — ' + r.reference) + '" ' +
            'title="Open the receipt full size">' +
            '<img src="' + esc(url) + '" alt="Receipt from ' + esc(r.buyer_name) + '">' +
            '<span class="thumb-zoom">View</span></button>';
          t.querySelector('[data-shot]').addEventListener('click', function (e) {
            openShot(e.currentTarget.dataset.shot, e.currentTarget.dataset.shotName);
          });
        }).catch(function () {
          var t = list.querySelector('[data-thumb="' + r.id + '"]');
          if (t) t.innerHTML = '<span class="thumb-none">Receipt link expired<em>refresh the page</em></span>';
        });
      });
      $$('#inboxList [data-approve]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.dataset.approve, 'approve'); });
      });
      $$('#inboxList [data-reject]').forEach(function (b) {
        b.addEventListener('click', function () { decide(b.dataset.reject, 'reject'); });
      });
    });
  }

  function paymentRow(r) {
    var pending = r.status === 'pending';
    return '<div class="row" data-status="' + r.status + '" data-id="' + r.id + '">' +
      '<div class="thumb receipt-thumb" data-thumb="' + r.id + '" data-has="' +
        (r.receipt_path ? 'true' : 'false') + '">' +
        (r.receipt_path ? '<span class="thumb-wait">loading receipt…</span>'
                        : '<span class="thumb-none">No receipt<em>waiting for the buyer</em></span>') +
      '</div>' +
      '<div class="row-main">' +
        '<h4>' + esc(r.buyer_name) + ' <span class="pill-s" data-s="' + r.status + '">' + r.status + '</span>' +
          (r.terms_signed ? '<span class="pill-s" data-s="approved">terms signed</span>' : '') + '</h4>' +
        '<dl class="kv">' +
          '<div><dt>Project</dt><dd>' + esc(r.project_name || r.project_id) + '</dd></div>' +
          '<div><dt>Paying for</dt><dd>' + (r.scope === 'items'
            ? (r.item_ids || []).length + ' component' + ((r.item_ids || []).length === 1 ? '' : 's')
            : 'the whole package') + '</dd></div>' +
          '<div><dt>Paid through</dt><dd>' + esc(r.method) + '</dd></div>' +
          '<div><dt>Reference</dt><dd>' + esc(r.reference) + '</dd></div>' +
          '<div><dt>Receipt</dt><dd>' + (r.receipt_path
            ? (r.receipt_came_later
                ? 'sent after &mdash; ' + when(r.receipt_added_at)
                : 'with the payment')
            : '<b class="want-receipt">not attached</b>') + '</dd></div>' +
          '<div><dt>Amount</dt><dd>' + money(r.amount, r.currency) + '</dd></div>' +
          '<div><dt>Date paid</dt><dd>' + day(r.paid_on) + '</dd></div>' +
          '<div><dt>Submitted</dt><dd>' + when(r.submitted_at) + '</dd></div>' +
          (r.user_email ? '<div><dt>Account</dt><dd>' + esc(r.user_email) + '</dd></div>' : '') +
          (r.buyer_contact ? '<div><dt>Contact</dt><dd>' + esc(r.buyer_contact) + '</dd></div>' : '') +
          (r.reviewed_at ? '<div><dt>Reviewed</dt><dd>' + when(r.reviewed_at) + '</dd></div>' : '') +
        '</dl>' +
        (r.review_note ? '<p class="note">Note: ' + esc(r.review_note) + '</p>' : '') +
        '<div class="pkg-access" data-access="' + r.id + '">' +
          (r.status === 'approved'
            ? '<p class="muted">Reading what is released…</p>'
            : '<p class="muted">Package release opens once this payment is approved.</p>') +
        '</div>' +
      '</div>' +
      '<div class="row-actions">' +
        (pending
          ? '<textarea placeholder="Note to the buyer (optional)" data-note="' + r.id + '"></textarea>' +
            '<div class="pair"><button class="btn btn-sm btn-primary" data-approve="' + r.id + '">Approve</button>' +
            '<button class="btn btn-sm btn-danger" data-reject="' + r.id + '">Reject</button></div>'
          : '<span class="muted">' + (r.status === 'approved' ? 'Approved' : 'Rejected') + ' ' + when(r.reviewed_at) + '</span>') +
      '</div>' +
    '</div>';
  }

  /* ---------- staged package release ----------
     A package no longer has to open all at once. Each item carries a release
     mode on the project ("opens with the package" or "I release it myself"),
     and here you can override that per buyer — hand over the wiring diagram
     today and the source code when the balance lands. */
  function paintPackageAccess(rows) {
    var approved = (rows || []).filter(function (r) { return r.status === 'approved'; });
    if (!approved.length || !B.packageAccessRows) return;
    B.packageAccessRows(approved.map(function (r) { return r.id; })).then(function (access) {
      var byPayment = {};
      access.forEach(function (a) {
        (byPayment[a.payment_id] || (byPayment[a.payment_id] = [])).push(a);
      });
      approved.forEach(function (r) {
        var box = $('.pkg-access[data-access="' + r.id + '"]');
        if (!box) return;
        var items = byPayment[r.id] || [];
        state.access[r.id] = items;
        box.innerHTML = packageAccessHtml(r, items);
      });
      bindPackageAccess();
    }).catch(function (e) {
      approved.forEach(function (r) {
        var box = $('.pkg-access[data-access="' + r.id + '"]');
        if (box) box.innerHTML = '<p class="muted">Could not read the package release: ' +
          esc(e.message) + '</p>';
      });
    });
  }

  function packageAccessHtml(r, items) {
    if (!items.length) {
      return '<p class="muted">This project has no package items yet — add them under ' +
             'Projects and they appear here.</p>';
    }
    var open = items.filter(function (i) { return i.state === 'released'; }).length;
    return '<div class="pkg-access-head">' +
        '<b>Package release</b>' +
        '<span class="pill-s" data-s="' + (open === items.length ? 'approved' : 'pending') + '">' +
          open + ' of ' + items.length + ' released</span>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-sm btn-ghost" data-access-all="' + r.id + '" data-state="released">Release all</button>' +
        '<button class="btn btn-sm btn-ghost" data-access-all="' + r.id + '" data-state="held">Hold all</button>' +
      '</div>' +
      '<ul class="pkg-access-list">' + items.map(function (i) {
        var released = i.state === 'released';
        return '<li data-state="' + i.state + '">' +
          '<span class="pkg-access-name">' + esc(i.item_name) +
            (i.overridden ? '' : '<em> · project default</em>') + '</span>' +
          '<span class="pill-s" data-s="' + (released ? 'approved' : 'pending') + '">' +
            (released ? 'released' : 'held') + '</span>' +
          '<button class="btn btn-sm' + (released ? '' : ' btn-primary') + '" ' +
            'data-access-set="' + r.id + '" data-item="' + esc(i.item_id) + '" ' +
            'data-state="' + (released ? 'held' : 'released') + '">' +
            (released ? 'Hold' : 'Release') + '</button>' +
          (i.overridden
            ? '<button class="btn btn-sm btn-ghost" data-access-set="' + r.id + '" ' +
              'data-item="' + esc(i.item_id) + '" data-state="default" ' +
              'title="Go back to what the project itself says">Reset</button>'
            : '') +
        '</li>';
      }).join('') + '</ul>';
  }

  function bindPackageAccess() {
    $$('#inboxList [data-access-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        setAccess(b, b.dataset.accessSet, [b.dataset.item], b.dataset.state);
      });
    });
    $$('#inboxList [data-access-all]').forEach(function (b) {
      b.addEventListener('click', function () {
        var items = (state.access[b.dataset.accessAll] || []).map(function (i) { return i.item_id; });
        if (!items.length) return;
        setAccess(b, b.dataset.accessAll, items, b.dataset.state);
      });
    });
  }

  function setAccess(btn, paymentId, itemIds, mode) {
    var box = $('.pkg-access[data-access="' + paymentId + '"]');
    if (box) $$('.pkg-access[data-access="' + paymentId + '"] button').forEach(function (b) { b.disabled = true; });
    B.setPackageAccess(paymentId, itemIds, mode).then(function () {
      return loadInbox();
    }).catch(function (e) {
      window.alert(e.message);
      $$('.pkg-access[data-access="' + paymentId + '"] button').forEach(function (b) { b.disabled = false; });
    });
  }

  /* A receipt is the whole reason to trust a reference number, so it opens at
     the size it was taken rather than as a 130px thumbnail. */
  function openShot(url, name) {
    $('#shotFull').src = url;
    $('#shotFull').alt = 'Receipt — ' + (name || '');
    $('#shotTitle').textContent = name || 'Receipt';
    $('#shotOpen').href = url;
    $('#shotSave').href = url;
    $('#shotSave').setAttribute('download',
      'receipt-' + String(name || 'payment').replace(/[^A-Za-z0-9]+/g, '-').slice(0, 50) + '.jpg');
    $('#shotOverlay').dataset.open = 'true';
    document.body.classList.add('modal-open');
  }
  function closeShot() {
    $('#shotOverlay').dataset.open = 'false';
    $('#shotFull').removeAttribute('src');
    if (!$('.overlay[data-open="true"]')) document.body.classList.remove('modal-open');
  }
  $$('[data-close-shot]').forEach(function (el) { el.addEventListener('click', closeShot); });
  $('#shotOverlay').addEventListener('mousedown', function (e) {
    if (e.target === $('#shotOverlay') || e.target.id === 'shotFull') closeShot();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#shotOverlay').dataset.open === 'true') closeShot();
  });

  function decide(id, action) {
    var noteEl = $('[data-note="' + id + '"]');
    var note = noteEl ? noteEl.value.trim() : '';
    if (action === 'reject' && !note && !window.confirm('Reject without a note to the buyer?')) return;
    var btns = $$('[data-approve="' + id + '"], [data-reject="' + id + '"]');
    btns.forEach(function (b) { b.disabled = true; });
    (action === 'approve' ? B.approve(id, note) : B.reject(id, note))
      .then(function () { return load(); })
      .catch(function (e) {
        window.alert(e.message);
        btns.forEach(function (b) { b.disabled = false; });
      });
  }

  /* ---------- who has paid for what ----------
     Everything here is worked out from three things you already have: the
     payments, the per-item release state behind each of them, and the catalog's
     own prices. One row per buyer, one block per project they have touched. */
  var CLIENT_STATE = {
    delivered: ['delivered', 'approved'],
    held:      ['paid — you are holding it', 'pending'],
    terms:     ['paid — terms not signed', 'pending'],
    waiting:   ['payment waiting for you', 'pending'],
    rejected:  ['payment not approved', 'rejected'],
    unpaid:    ['not paid yet', 'none']
  };

  function clientKey(r) {
    if (r.user_id) return 'u:' + r.user_id;
    if (r.user_email) return 'e:' + String(r.user_email).toLowerCase();
    return 'n:' + String(r.buyer_name || '').trim().toLowerCase();
  }

  function projectItems(projectId) {
    var p = state.projects.filter(function (x) { return x.id === projectId; })[0];
    if (!p) return [];
    if (Array.isArray(p.package_items) && p.package_items.length) {
      return p.package_items.map(function (i, n) {
        return { id: i.id || 'item-' + (n + 1), name: i.name || 'Package item',
                 price: i.price == null || i.price === '' ? null : Number(i.price) };
      });
    }
    var keys = p.status === 'ready' ? (p.items || []) : (p.planned || []);
    return keys.map(function (k) { return { id: k, name: ITEM_LABELS[k] || k, price: null }; });
  }

  function projectCurrency(projectId) {
    var p = state.projects.filter(function (x) { return x.id === projectId; })[0];
    return (p && p.price_currency) || 'PHP';
  }

  function itemRank(pay, released) {
    if (pay.status === 'approved') return released ? (pay.terms_signed ? 5 : 3) : 4;
    if (pay.status === 'pending') return 2;
    return 1;
  }

  function loadClients() {
    var fill = state.projects.length
      ? Promise.resolve(state.projects)
      : B.projects().then(function (rows) { state.projects = rows; return rows; });
    return fill.then(function () {
      return Promise.all([B.inbox('all'), B.packageAccessRows()]);
    }).then(function (both) {
      var payments = both[0] || [], access = both[1] || [];
      var byPayment = {};
      access.forEach(function (a) {
        (byPayment[a.payment_id] || (byPayment[a.payment_id] = {}))[a.item_id] = a.state;
      });
      state.clients = buildClients(payments, byPayment);
      paintClients();
    });
  }

  function buildClients(payments, byPayment) {
    var map = {};
    payments.forEach(function (pay) {
      var key = clientKey(pay);
      var c = map[key] || (map[key] = {
        key: key, name: pay.buyer_name || 'Unnamed buyer',
        email: pay.user_email || '', contact: pay.buyer_contact || '',
        lastAt: pay.submitted_at, projects: {}, shares: {}
      });
      if (pay.user_email) c.email = pay.user_email;
      if (!c.contact && pay.buyer_contact) c.contact = pay.buyer_contact;
      if (new Date(pay.submitted_at) > new Date(c.lastAt)) c.lastAt = pay.submitted_at;
      if (pay.share_token) c.shares[pay.share_token] = pay.share_customer || pay.share_token;
      var pr = c.projects[pay.project_id] || (c.projects[pay.project_id] = {
        id: pay.project_id, name: pay.project_name || pay.project_id, payments: []
      });
      pr.payments.push(pay);
    });

    return Object.keys(map).map(function (key) {
      var c = map[key];
      c.paid = 0; c.waiting = 0; c.owed = 0;
      c.projectList = Object.keys(c.projects).map(function (pid) {
        var pr = c.projects[pid];
        pr.currency = projectCurrency(pid);
        pr.paid = 0; pr.waiting = 0; pr.owed = 0;
        pr.payments.forEach(function (pay) {
          var amount = Number(pay.amount || 0);
          if (pay.status === 'approved') pr.paid += amount;
          else if (pay.status === 'pending') pr.waiting += amount;
        });
        pr.items = projectItems(pid).map(function (item) {
          var best = null, bestRank = 0;
          pr.payments.forEach(function (pay) {
            var covered = pay.scope === 'items'
              ? (pay.item_ids || []).indexOf(item.id) > -1
              : true;
            if (!covered) return;
            var released = (byPayment[pay.id] || {})[item.id] === 'released';
            var r = itemRank(pay, released);
            if (r > bestRank) { bestRank = r; best = pay; }
          });
          var st = bestRank === 5 ? 'delivered'
            : bestRank === 4 ? 'held'
            : bestRank === 3 ? 'terms'
            : bestRank === 2 ? 'waiting'
            : bestRank === 1 ? 'rejected' : 'unpaid';
          if (st === 'unpaid' || st === 'rejected') {
            if (item.price != null) pr.owed += item.price;
          }
          return { item: item, state: st, pay: best };
        });
        c.paid += pr.paid; c.waiting += pr.waiting; c.owed += pr.owed;
        return pr;
      }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      return c;
    }).sort(function (a, b) { return new Date(b.lastAt) - new Date(a.lastAt); });
  }

  function paintClients() {
    var q = ($('#clientSearch') && $('#clientSearch').value || '').trim().toLowerCase();
    var rows = (state.clients || []).filter(function (c) {
      if (!q) return true;
      var hay = (c.name + ' ' + c.email + ' ' + c.contact + ' ' +
        c.projectList.map(function (p) { return p.name; }).join(' ')).toLowerCase();
      return hay.indexOf(q) > -1;
    });
    $('#clientList').innerHTML = rows.map(clientCard).join('');
    $('#clientEmpty').hidden = rows.length > 0;
    say('#clientMsg', (state.clients || []).length + ' buyer' +
      ((state.clients || []).length === 1 ? '' : 's') + ' on record');
  }

  function clientCard(c) {
    return '<div class="client-card">' +
      '<div class="client-head">' +
        '<div><h4>' + esc(c.name) + '</h4>' +
          '<p class="muted">' + esc(c.email || c.contact || 'no contact on file') +
          ' &middot; last activity ' + when(c.lastAt) + '</p>' +
          (Object.keys(c.shares).length
            ? '<p class="muted">Came through your private link' +
              (Object.keys(c.shares).length === 1 ? '' : 's') + ': ' +
              Object.keys(c.shares).map(function (t) { return esc(c.shares[t]); }).join(', ') + '</p>'
            : '') +
        '</div>' +
        '<div class="client-money">' +
          '<span class="cm ok"><b>' + money(c.paid) + '</b>paid</span>' +
          (c.waiting ? '<span class="cm wait"><b>' + money(c.waiting) + '</b>waiting</span>' : '') +
          (c.owed ? '<span class="cm owed"><b>' + money(c.owed) + '</b>not taken yet</span>' : '') +
        '</div>' +
      '</div>' +
      c.projectList.map(clientProjectBlock).join('') +
    '</div>';
  }

  function clientProjectBlock(pr) {
    var done = pr.items.filter(function (i) { return i.state === 'delivered'; }).length;
    return '<div class="client-project">' +
      '<div class="client-project-head"><b>' + esc(pr.name) + '</b>' +
        '<span class="pill-s" data-s="' + (done === pr.items.length && pr.items.length ? 'approved' : 'pending') + '">' +
          done + ' of ' + pr.items.length + ' delivered</span>' +
        '<span class="muted">' + pr.payments.length + ' payment' +
          (pr.payments.length === 1 ? '' : 's') + '</span>' +
      '</div>' +
      '<ul class="client-items">' + pr.items.map(function (row) {
        var meta = CLIENT_STATE[row.state];
        return '<li data-state="' + row.state + '">' +
          '<span class="ci-name">' + esc(row.item.name) + '</span>' +
          '<span class="ci-price">' + (row.item.price == null ? '&mdash;'
            : esc(money(row.item.price, pr.currency))) + '</span>' +
          '<span class="pill-s" data-s="' + meta[1] + '">' + meta[0] + '</span>' +
          (row.pay ? '<span class="ci-ref">' + esc(row.pay.reference) + '</span>' : '') +
        '</li>';
      }).join('') + '</ul>' +
    '</div>';
  }

  /* ---------- proof of legitimacy ----------
     Saved proof is a table: scan it, see at a glance what is on the page and
     what is not. Editing opens the row itself — no modal, so the list never
     moves out from under you — and a new one opens a blank editor above it. */

  /* One proof's gallery, tolerant of the older single-image shape. Each photo
     carries its own caption and its own date: a receipt was paid on a day, and
     that day is half of what makes it proof. */
  function proofImages(r) {
    var list = Array.isArray(r && r.images) ? r.images : [];
    var out = list.map(function (i) {
      if (typeof i === 'string') i = { url: i };
      return {
        url: String((i && i.url) || '').trim(),
        caption: String((i && i.caption) || ''),
        date: String((i && i.date) || '')
      };
    }).filter(function (i) { return i.url; });
    if (!out.length && r && r.image_url) {
      out.push({ url: r.image_url, caption: '', date: r.happened_on || '' });
    }
    return out;
  }
  function proofCover(r) {
    var list = proofImages(r);
    return list.length ? list[0].url : '';
  }
  function proofSay(text, kind) { say('#proofMsg', text, kind); }

  function shotRow(shot) {
    shot = shot || { url: '', caption: '', date: '' };
    return '<div class="shot-row" data-shot-row>' +
      '<span class="shot-thumb">' +
        (shot.url ? '<img src="' + esc(shot.url) + '" alt="">' : '<i>no image</i>') + '</span>' +
      '<div class="shot-fields">' +
        '<input type="text" data-shot-url value="' + esc(shot.url) + '" ' +
          'placeholder="https://… image address">' +
        '<div class="shot-pair">' +
          '<input type="text" data-shot-caption value="' + esc(shot.caption) + '" ' +
            'placeholder="What this photo shows">' +
          '<input type="date" data-shot-date value="' + esc(shot.date) + '" ' +
            'title="The day this happened — shown to visitors with the photo">' +
        '</div>' +
      '</div>' +
      '<div class="shot-tools">' +
        '<button class="btn btn-sm btn-ghost" type="button" data-shot-up aria-label="Move up">&uarr;</button>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-shot-down aria-label="Move down">&darr;</button>' +
        '<button class="btn btn-sm btn-ghost" type="button" data-shot-remove>Remove</button>' +
      '</div>' +
    '</div>';
  }

  /* ---------- the list ---------- */
  function proofAttached(r) {
    var shots = proofImages(r).length, bits = [];
    if (shots) bits.push(shots + ' photo' + (shots === 1 ? '' : 's'));
    if (r.video_url) {
      bits.push(/\.(mp4|webm|ogg|ogv|mov|m4v)(\?|#|$)/i.test(r.video_url) ? 'a clip' : 'a video link');
    }
    return bits.join(' · ') || '—';
  }

  function proofRow(r) {
    var cover = proofCover(r);
    return '<tr data-proof-row="' + esc(r.id) + '"' + (r.published ? '' : ' data-off="true"') + '>' +
      '<td class="tbl-shot">' + (cover
        ? '<span class="tbl-thumb"><img src="' + esc(cover) + '" alt=""></span>'
        : '<span class="tbl-thumb"><i>no photo</i></span>') + '</td>' +
      '<td><span class="pill-s" data-s="approved">' + esc(r.kind || 'Proof') + '</span></td>' +
      '<td class="tbl-title"><b>' + esc(r.title) + '</b>' +
        (r.description ? '<span>' + esc(r.description.slice(0, 90)) +
          (r.description.length > 90 ? '…' : '') + '</span>' : '') + '</td>' +
      '<td class="tbl-when">' + (r.happened_on ? day(r.happened_on) : '—') + '</td>' +
      '<td class="tbl-att">' + esc(proofAttached(r)) + '</td>' +
      '<td><span class="pill-s" data-s="' + (r.published ? 'approved' : 'pending') + '">' +
        (r.published ? 'on the page' : 'hidden') + '</span></td>' +
      '<td class="tbl-act">' +
        '<button class="btn btn-sm" type="button" data-proof-edit="' + esc(r.id) + '">Edit</button>' +
        '<button class="btn btn-sm btn-danger" type="button" data-proof-drop="' + esc(r.id) + '">Delete</button>' +
      '</td>' +
    '</tr>';
  }

  function proofTable(rows) {
    if (!rows.length) return '<div class="proof-new-slot" id="proofNewSlot"></div>';
    return '<div class="proof-new-slot" id="proofNewSlot"></div>' +
      '<div class="table-wrap"><table class="proof-table">' +
        '<thead><tr>' +
          '<th><span class="sr">Photo</span></th><th>What it is</th><th>Title</th>' +
          '<th>When</th><th>Attached</th><th>Status</th><th></th>' +
        '</tr></thead>' +
        '<tbody>' + rows.map(proofRow).join('') + '</tbody>' +
      '</table></div>';
  }

  function loadProofs(savedId) {
    return B.proofs(true).then(function (rows) {
      state.proofs = rows || [];
      $('#proofList').innerHTML = proofTable(state.proofs);
      $('#proofEmpty').hidden = state.proofs.length > 0;
      bindProofTable();
      var live = state.proofs.filter(function (r) { return r.published; }).length;
      var count = state.proofs.length
        ? live + ' of ' + state.proofs.length + ' showing on the page'
        : 'The section is hidden from visitors until you add one.';

      if (!savedId) { proofSay(count); return; }

      var saved = state.proofs.filter(function (r) { return r.id === savedId; })[0];
      proofSay('Saved “' + (saved ? saved.title : 'it') + '”' +
        (saved && !saved.published ? ' — still hidden from visitors. ' : '. ') + count, 'ok');
      var row = $('[data-proof-row="' + savedId + '"]');
      if (!row) return;
      row.dataset.saved = 'true';
      setTimeout(function () { if (row) row.dataset.saved = 'false'; }, 2400);
    });
  }

  function bindProofTable() {
    $$('#proofList [data-proof-edit]').forEach(function (b) {
      b.addEventListener('click', function () { editProof(b.dataset.proofEdit); });
    });
    $$('#proofList [data-proof-drop]').forEach(function (b) {
      b.addEventListener('click', function () {
        var r = state.proofs.filter(function (x) { return x.id === b.dataset.proofDrop; })[0];
        if (!window.confirm('Delete “' + (r ? r.title : 'this proof') +
            '”? It disappears from the page straight away.')) return;
        b.disabled = true;
        B.deleteProof(b.dataset.proofDrop).then(function () { return loadProofs(); })
          .then(function () { proofSay('Deleted.', 'ok'); })
          .catch(function (e) { proofSay('Could not delete: ' + e.message, 'err'); b.disabled = false; });
      });
    });
  }

  /* ---------- the editor, opened in place ---------- */
  function closeProofEditor() {
    var open = $('#proofList .proof-edit-row');
    if (open) open.remove();
    var slot = $('#proofNewSlot');
    if (slot) slot.innerHTML = '';
    $$('#proofList [data-proof-row]').forEach(function (tr) { tr.hidden = false; });
  }

  function editProof(id) {
    var r = state.proofs.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    closeProofEditor();
    var row = $('[data-proof-row="' + id + '"]');
    if (!row) return;
    row.insertAdjacentHTML('afterend',
      '<tr class="proof-edit-row"><td colspan="7">' + proofCard(r) + '</td></tr>');
    var card = $('#proofList .proof-edit-row [data-proof-card]');
    bindProofCard(card);
    card.querySelector('[data-proof-title]').focus();
  }

  function newProof() {
    closeProofEditor();
    var slot = $('#proofNewSlot');
    if (!slot) {                                   // no table yet: make the slot
      $('#proofList').innerHTML = '<div class="proof-new-slot" id="proofNewSlot"></div>';
      slot = $('#proofNewSlot');
    }
    $('#proofEmpty').hidden = true;
    slot.innerHTML = proofCard({ kind: 'Delivered build',
                                 position: (state.proofs || []).length + 1 });
    var card = slot.querySelector('[data-proof-card]');
    bindProofCard(card);
    card.querySelector('[data-proof-title]').focus();
  }

  function proofCard(r) {
    r = r || {};
    var id = r.id || '';
    var kind = r.kind || 'Delivered build';
    return '<div class="proof-card" data-proof-card="' + esc(id) + '"' +
        (r.published === false ? ' data-off="true"' : '') + '>' +
      '<div class="proof-shot" data-proof-shot>' +
        (proofCover(r)
          ? '<img src="' + esc(proofCover(r)) + '" alt="">'
          : '<span>No photo yet</span>') +
        '<span class="proof-count" data-proof-count>' +
          (proofImages(r).length > 1 ? proofImages(r).length + ' photos' : '') + '</span>' +
      '</div>' +
      '<div class="proof-fields">' +
        '<div class="proof-grid2">' +
          '<div><label class="lbl">What it is</label>' +
            '<input type="text" list="proofKinds" data-proof-kind value="' + esc(kind) + '" ' +
              'placeholder="e.g. Delivered build"></div>' +
          '<div><label class="lbl">When (optional)</label>' +
            '<input type="date" data-proof-date value="' + esc(r.happened_on || '') + '">' +
            '<span class="hint">the date for the whole tile</span></div>' +
          '<div class="wide"><label class="lbl">Title</label>' +
            '<input type="text" data-proof-title value="' + esc(r.title || '') + '" ' +
              'placeholder="What a visitor reads first"></div>' +
          '<div class="wide"><label class="lbl">Description</label>' +
            '<textarea data-proof-desc placeholder="One or two lines: what this shows, and for whom.">' +
              esc(r.description || '') + '</textarea></div>' +
          '<div class="wide"><label class="lbl">Photos &mdash; the first one is the cover</label>' +
            '<div class="shot-list" data-shot-list>' +
              proofImages(r).map(shotRow).join('') +
            '</div>' +
            '<div class="proof-row-tools">' +
              '<label class="btn btn-sm up">Add photos<input type="file" data-shot-add ' +
                'accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>' +
              '<button class="btn btn-sm btn-ghost" type="button" data-shot-blank>Paste a link instead</button>' +
            '</div>' +
            '<span class="hint">Each photo takes its own line of description and its own date ' +
              '&mdash; the day that payment landed, that build was handed over. Visitors see ' +
              'both when they page through.</span></div>' +
          '<div class="wide"><label class="lbl">Video (optional)</label>' +
            '<div class="proof-file"><input type="url" data-proof-video value="' +
              esc(r.video_url || '') + '" placeholder="https://youtube.com/… or upload a clip">' +
              '<label class="btn btn-sm up">Upload a clip<input type="file" data-proof-video-upload ' +
                'accept="video/mp4,video/webm,video/quicktime"></label></div>' +
            '<span class="hint">Up to 64 MB, and it plays inside the viewer. A YouTube or ' +
              'TikTok link works too &mdash; that one opens on its own platform.</span></div>' +
          '<div><label class="lbl">Position</label>' +
            '<input type="number" data-proof-position value="' + esc(r.position == null ? 100 : r.position) + '" ' +
              'min="1" max="999"><span class="hint">lower shows first</span></div>' +
          '<div class="proof-live"><label><input type="checkbox" data-proof-published' +
            (r.published === false ? '' : ' checked') + '> Show it on the page</label></div>' +
        '</div>' +
        '<div class="login-row">' +
          '<button class="btn btn-primary btn-sm" type="button" data-proof-save>Save</button>' +
          '<button class="btn btn-sm" type="button" data-proof-cancel>Cancel</button>' +
          '<span class="msg" data-proof-say></span>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  function bindProofCard(card) {
    if (!card) return;
    var say = function (text, kind) {
      var el = card.querySelector('[data-proof-say]');
      el.textContent = text || '';
      el.dataset.err = kind === 'err' ? 'true' : 'false';
      el.dataset.ok = kind === 'ok' ? 'true' : 'false';
    };
    var shots = function () {
      return $$('[data-shot-row]', card).map(function (row) {
        return {
          url: row.querySelector('[data-shot-url]').value.trim(),
          caption: row.querySelector('[data-shot-caption]').value.trim(),
          date: row.querySelector('[data-shot-date]').value || ''
        };
      }).filter(function (i) { return i.url; });
    };
    var repaintCover = function () {
      var list = shots();
      card.querySelector('[data-proof-shot]').innerHTML =
        (list.length
          ? '<img src="' + esc(list[0].url) + '" alt="">'
          : '<span>No photo yet</span>') +
        '<span class="proof-count" data-proof-count>' +
          (list.length > 1 ? list.length + ' photos' : '') + '</span>';
    };
    var list = card.querySelector('[data-shot-list]');
    var addShot = function (shot) {
      list.insertAdjacentHTML('beforeend', shotRow(shot));
      repaintCover();
    };

    list.addEventListener('input', function (e) {
      if (!e.target.matches('[data-shot-url]')) return;
      var thumb = e.target.closest('[data-shot-row]').querySelector('.shot-thumb');
      var url = e.target.value.trim();
      thumb.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : '<i>no image</i>';
      repaintCover();
    });
    list.addEventListener('click', function (e) {
      var row = e.target.closest('[data-shot-row]');
      if (!row) return;
      if (e.target.closest('[data-shot-remove]')) { row.remove(); repaintCover(); }
      if (e.target.closest('[data-shot-up]') && row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling); repaintCover();
      }
      if (e.target.closest('[data-shot-down]') && row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row); repaintCover();
      }
    });
    card.querySelector('[data-shot-blank]').addEventListener('click', function () {
      addShot();
      var rows = $$('[data-shot-row]', card);
      rows[rows.length - 1].querySelector('[data-shot-url]').focus();
    });
    card.querySelector('[data-shot-add]').addEventListener('change', function () {
      var files = Array.prototype.slice.call(this.files || []);
      this.value = '';
      if (!files.length) return;
      var done = 0;
      say('Uploading ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '…');
      files.reduce(function (chain, f) {
        return chain.then(function () {
          return B.uploadProofFile(f).then(function (res) {
            addShot({ url: res.url, caption: '', date: '' });
            done++;
            say('Uploaded ' + done + ' of ' + files.length + '…');
          });
        });
      }, Promise.resolve())
        .then(function () { say(done + ' uploaded — press Save to publish.', 'ok'); })
        .catch(function (e) { say(e.message, 'err'); });
    });
    card.querySelector('[data-proof-video-upload]').addEventListener('change', function () {
      var f = this.files && this.files[0];
      this.value = '';
      if (!f) return;
      say('Uploading ' + f.name + ' — a clip can take a moment…');
      B.uploadProofFile(f).then(function (res) {
        card.querySelector('[data-proof-video]').value = res.url;
        say(f.name + ' uploaded — press Save to publish.', 'ok');
      }).catch(function (e) { say(e.message, 'err'); });
    });
    card.querySelector('[data-proof-published]').addEventListener('change', function () {
      card.dataset.off = this.checked ? 'false' : 'true';
    });
    card.querySelector('[data-proof-cancel]').addEventListener('click', function () {
      closeProofEditor();
      proofSay('');
    });
    card.querySelector('[data-proof-save]').addEventListener('click', function () {
      var gallery = shots();
      var row = {
        kind: card.querySelector('[data-proof-kind]').value.trim() || 'Proof',
        title: card.querySelector('[data-proof-title]').value.trim(),
        description: card.querySelector('[data-proof-desc]').value.trim() || null,
        images: gallery,
        image_url: gallery.length ? gallery[0].url : null,   // the cover
        video_url: card.querySelector('[data-proof-video]').value.trim() || null,
        happened_on: card.querySelector('[data-proof-date]').value || null,
        position: Number(card.querySelector('[data-proof-position]').value) || 100,
        published: card.querySelector('[data-proof-published]').checked
      };
      if (row.title.length < 2) return say('Give it a title.', 'err');
      if (!gallery.length && !row.video_url) {
        return say('Add a photo or a video — a tile needs something to show.', 'err');
      }
      if (row.video_url && !/^https?:\/\//i.test(row.video_url)) {
        return say('The video link needs to start with https://', 'err');
      }
      if (card.dataset.proofCard) row.id = card.dataset.proofCard;
      this.disabled = true;
      say('Saving…');
      B.saveProof(row).then(function (saved) {
        return loadProofs(saved && saved.id);
      }).catch(function (e) {
        say('Could not save: ' + e.message, 'err');
        var btn = card.querySelector('[data-proof-save]');
        if (btn) btn.disabled = false;
      });
    });
  }

  $('#proofNew').addEventListener('click', newProof);


  /* ---------- access codes ---------- */
  function loadGrants() {
    var fill = state.projects.length ? Promise.resolve(state.projects) : B.projects().then(function (p) { state.projects = p; return p; });
    return fill.then(function (projects) {
      var sel = $('#gProject');
      if (!sel.options.length) {
        sel.innerHTML = projects.map(function (p) {
          return '<option value="' + esc(p.id) + '">' + esc(p.name) + (p.status === 'ready' ? '' : ' (coming soon)') + '</option>';
        }).join('');
        paintGrantItems();
      }
      return B.grants();
    }).then(function (rows) {
      $('#grantList').innerHTML = rows.map(grantRow).join('');
      $('#grantEmpty').hidden = rows.length > 0;
      $$('#grantList [data-revoke]').forEach(function (b) {
        b.addEventListener('click', function () {
          var note = window.prompt('Cancel this access code? Add a note if you like.', '');
          if (note === null) return;
          b.disabled = true;
          B.revokeGrant(b.dataset.revoke, note).then(loadGrants).catch(function (e) { window.alert(e.message); b.disabled = false; });
        });
      });
      $$('#grantList [data-copy]').forEach(function (b) {
        b.addEventListener('click', function () { copy(b.dataset.copy, b); });
      });
    });
  }

  /* Which items a code hands over. Ticked by default when the project says the
     item opens with the package; an item the project holds back starts unticked,
     so a code never quietly undoes a staged release. */
  function paintGrantItems() {
    var box = $('#gItems'), id = $('#gProject').value;
    if (!box) return;
    if (!id) { box.innerHTML = '<p class="muted">Pick a project first.</p>'; return; }
    box.innerHTML = '<p class="muted">Reading the package…</p>';
    state.grantScope = id;
    B.projectPackageItems(id).then(function (items) {
      if (state.grantScope !== id) return;
      if (!items.length) {
        box.innerHTML = '<p class="muted">This project has no package items yet — the code ' +
          'simply approves the payment.</p>';
        return;
      }
      box.innerHTML = items.map(function (i) {
        var on = i.release_mode !== 'manual';
        return '<label class="grant-item"><input type="checkbox" data-grant-item="' +
          esc(i.item_id) + '"' + (on ? ' checked' : '') + '> <span>' + esc(i.item_name) +
          (on ? '' : '<em> · held by default</em>') + '</span></label>';
      }).join('');
    }).catch(function (e) {
      box.innerHTML = '<p class="muted">Could not read the package: ' + esc(e.message) + '</p>';
    });
  }

  function grantItemIds() {
    return $$('#gItems [data-grant-item]')
      .filter(function (c) { return c.checked; })
      .map(function (c) { return c.dataset.grantItem; });
  }

  function grantRow(g) {
    return '<div class="row" data-status="' + g.state + '">' +
      '<div class="thumb"><span class="code-inline">' + esc(g.code) + '</span></div>' +
      '<div class="row-main">' +
        '<h4>' + esc(g.buyer_name) + ' <span class="pill-s" data-s="' + g.state + '">' + g.state + '</span></h4>' +
        '<dl class="kv">' +
          '<div><dt>Project</dt><dd>' + esc(g.project_name || g.project_id) + '</dd></div>' +
          '<div><dt>Settled through</dt><dd>' + esc(g.channel) + '</dd></div>' +
          '<div><dt>Issued</dt><dd>' + when(g.created_at) + '</dd></div>' +
          '<div><dt>Redeemed</dt><dd>' + when(g.redeemed_at) + '</dd></div>' +
          (g.expires_at ? '<div><dt>Expires</dt><dd>' + when(g.expires_at) + '</dd></div>' : '') +
          '<div><dt>Opens</dt><dd>' + (g.item_ids && g.item_ids.length
            ? esc(g.item_ids.length + ' of the package\u2019s items')
            : 'the whole package') + '</dd></div>' +
        '</dl>' +
        (g.note ? '<p class="note">' + esc(g.note) + '</p>' : '') +
      '</div>' +
      '<div class="row-actions">' +
        '<button class="btn btn-sm" data-copy="' + esc(g.code) + '">Copy code</button>' +
        (g.state === 'active' || g.state === 'redeemed'
          ? '<button class="btn btn-sm btn-danger" data-revoke="' + g.id + '">Cancel</button>' : '') +
      '</div>' +
    '</div>';
  }

  $('#grantForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#grantBtn');
    if ($$('#gItems [data-grant-item]').length && !grantItemIds().length) {
      say('#grantMsg', 'Tick at least one item — a code that opens nothing is no use.', 'err');
      return;
    }
    btn.disabled = true; say('#grantMsg', 'Creating…');
    B.createGrant({
      projectId: $('#gProject').value,
      name: $('#gName').value.trim(),
      channel: $('#gChannel').value,
      note: $('#gNote').value.trim(),
      expiresDays: $('#gExpires').value ? Number($('#gExpires').value) : null,
      itemIds: grantItemIds()
    }).then(function (g) {
      say('#grantMsg', '');
      $('#newCodeText').textContent = g.code;
      $('#newCodeFor').textContent = 'For ' + g.buyer_name + ' · ' + g.channel + ' · ' +
        (state.projects.filter(function (p) { return p.id === g.project_id; })[0] || { name: g.project_id }).name;
      $('#newCode').hidden = false;
      $('#gName').value = ''; $('#gNote').value = ''; $('#gExpires').value = '';
      paintGrantItems();
      return loadGrants();
    }).catch(function (err) { say('#grantMsg', err.message, 'err'); })
      .then(function () { btn.disabled = false; });
  });
  $('#pulse').addEventListener('click', function () {
    var el = $('#pulse');
    el.disabled = true;
    $('#pulseText').textContent = 'Pinging…';
    B.heartbeat('admin').then(paintPulse)
      .catch(function (e) { $('#pulseText').textContent = 'Ping failed: ' + e.message; })
      .then(function () { el.disabled = false; });
  });
  $$('#userFilters .filter').forEach(function (b) {
    b.addEventListener('click', function () {
      state.userFilter = b.dataset.users;
      $$('#userFilters .filter').forEach(function (o) {
        o.setAttribute('aria-pressed', o === b ? 'true' : 'false');
      });
      paintUsers();
    });
  });
  $('#inboxSearch').addEventListener('input', function () { renderInbox({ listOnly: true }); });
  $('#clientSearch').addEventListener('input', paintClients);
  $('#gProject').addEventListener('change', paintGrantItems);
  $('#copyCode').addEventListener('click', function () { copy($('#newCodeText').textContent, $('#copyCode')); });

  function copy(text, btn) {
    var done = function () { if (btn) { var t = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = t; }, 1400); } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done);
    else { window.prompt('Copy this code:', text); done(); }
  }

  /* ---------- agreements ---------- */
  function loadAgreements() {
    var projectsP = state.projects.length
      ? Promise.resolve(state.projects)
      : B.projects().then(function (p) { state.projects = p; return p; });
    return Promise.all([B.agreements(), B.inbox('all'), projectsP,
                        B.attachmentCounts().catch(function () { return {}; })]).then(function (both) {
      var rows = both[0];
      state.payments = {};
      both[1].forEach(function (p) { state.payments[p.id] = p; });
      state.attachCounts = both[3] || {};
      var list = $('#agreementList');
      list.innerHTML = rows.map(agreementRow).join('');
      $('#agreementEmpty').hidden = rows.length > 0;
      rows.forEach(function (a) {
        if (a.signature_path) {
          B.signedUrl('signatures', a.signature_path, 3600).then(function (url) {
            var t = list.querySelector('[data-sig="' + a.id + '"]');
            if (t && url) t.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener"><img src="' + url + '" alt="Signature"></a>';
          }).catch(function () {});
        }
      });
      $$('#agreementList [data-view]').forEach(function (b) {
        b.addEventListener('click', function () {
          var a = rows.filter(function (x) { return x.id === b.dataset.view; })[0];
          if (a) viewAgreement(a);
        });
      });
    });
  }

  function agreementRow(a) {
    var name = projectName(a.project_id);
    return '<div class="row" data-status="approved">' +
      '<div class="thumb sig-thumb" data-sig="' + a.id + '">' +
        (a.signature_type === 'typed' ? '<span class="code-inline">' + esc(a.signature_text) + '</span>' : 'loading signature…') + '</div>' +
      '<div class="row-main">' +
        '<h4>' + esc(a.buyer_name) + ' <span class="pill-s" data-s="approved">' + esc(a.rights) + '</span>' +
          (state.attachCounts && state.attachCounts[a.id]
            ? '<span class="pill-s" data-s="active">' + state.attachCounts[a.id] + ' file' +
              (state.attachCounts[a.id] > 1 ? 's' : '') + '</span>' : '') + '</h4>' +
        '<dl class="kv">' +
          '<div><dt>Project</dt><dd>' + esc(name) + '</dd></div>' +
          '<div><dt>Signed</dt><dd>' + day(a.signed_on) + ' · ' + esc(a.signature_type) + '</dd></div>' +
          '<div><dt>Accepted</dt><dd>' + when(a.accepted_at) + '</dd></div>' +
          '<div><dt>Terms</dt><dd>' + esc(a.terms_version) + '</dd></div>' +
          (a.buyer_type ? '<div><dt>Buyer is a</dt><dd>' + esc(a.buyer_type) + '</dd></div>' : '') +
          (a.school ? '<div><dt>School</dt><dd>' + esc(a.school) + '</dd></div>' : '') +
          (a.location ? '<div><dt>Location</dt><dd>' + esc(a.location) + '</dd></div>' : '') +
          (a.payment_id ? '<div><dt>Payment</dt><dd>' + esc(a.payment_id.slice(0, 8)) + '…</dd></div>' : '') +
        '</dl>' +
      '</div>' +
      '<div class="row-actions">' +
        '<button class="btn btn-sm btn-primary" data-view="' + a.id + '">View full agreement</button>' +
        '<span class="muted">' + esc((a.user_agent || '').slice(0, 44)) + '</span>' +
      '</div>' +
    '</div>';
  }

  /* ---------- landing-page hero slideshow ---------- */
  var HERO_DEFAULTS = [
    { slide_key: 'embedded', name: 'Embedded systems & robotics',
      default_image: 'img/hero-embedded-robot-v2.png',
      eyebrow: 'Embedded systems & robotics', headline: 'Machines that sense, decide and move',
      alt_text: 'Embedded systems prototype robot with wheels, sensors, controller board and robotic arm' },
    { slide_key: 'web', name: 'Web systems', default_image: 'img/hero-web-systems-v1.png',
      eyebrow: 'Web systems', headline: 'Dashboards, portals and workflows built around you',
      alt_text: 'Custom web system with connected dashboards, records and workflow modules' },
    { slide_key: 'inventory', name: 'Inventory & ERP', default_image: 'img/hero-inventory-erp-v1.png',
      eyebrow: 'Inventory & ERP', headline: 'Stock, purchasing, sales and operations in one place',
      alt_text: 'Inventory and ERP workstation with stock dashboard, barcode scanner and warehouse items' },
    { slide_key: 'automation', name: 'Mobile & automation', default_image: 'img/hero-mobile-automation-v1.png',
      eyebrow: 'Mobile & automation', headline: 'Connected apps and devices that work together',
      alt_text: 'Connected mobile applications, controller and smart automation sensors' }
  ];

  function loadHeroSlides() {
    return B.heroSlides().then(function (overrides) {
      var saved = {};
      overrides.forEach(function (row) { saved[row.slide_key] = row; });
      var slides = HERO_DEFAULTS.map(function (base) {
        var override = saved[base.slide_key];
        return {
          slide_key: base.slide_key, name: base.name, default_image: base.default_image,
          image_url: override && override.image_url || '',
          eyebrow: override && override.eyebrow || base.eyebrow,
          headline: override && override.headline || base.headline,
          alt_text: override && override.alt_text || base.alt_text,
          overridden: !!override
        };
      });
      $('#heroSlideList').innerHTML = slides.map(heroAdminCard).join('');
      bindHeroSlideActions();
      say('#heroListMsg', overrides.length
        ? overrides.length + ' customized slide' + (overrides.length === 1 ? '' : 's') + ' · all others use defaults.'
        : 'All four slides are using their permanent default images.', 'ok');
      return slides;
    }).catch(function (e) {
      say('#heroListMsg', 'Could not load slide settings: ' + e.message, 'err');
      throw e;
    });
  }

  function heroAdminCard(s) {
    var effectiveImage = s.image_url || s.default_image;
    return '<article class="hero-admin-card" data-hero-admin="' + s.slide_key + '">' +
      '<div class="hero-admin-preview"><img src="' + esc(effectiveImage) + '" alt=""><span>' +
        (s.overridden ? 'Custom override' : 'Permanent default') + '</span></div>' +
      '<div class="hero-admin-fields">' +
        '<div class="hero-admin-heading"><div><span class="kicker">Slide</span><h3>' + esc(s.name) + '</h3></div>' +
          '<span class="pill-s" data-s="' + (s.overridden ? 'pending' : 'approved') + '">' +
            (s.overridden ? 'customized' : 'default') + '</span></div>' +
        '<label>Image URL<input type="text" data-hero-field="image_url" value="' + esc(s.image_url) +
          '" placeholder="Leave empty to use the permanent default"></label>' +
        '<label>Small label<input type="text" data-hero-field="eyebrow" maxlength="80" value="' + esc(s.eyebrow) + '" required></label>' +
        '<label>Caption<input type="text" data-hero-field="headline" maxlength="160" value="' + esc(s.headline) + '" required></label>' +
        '<label>Image description<input type="text" data-hero-field="alt_text" maxlength="240" value="' + esc(s.alt_text) + '" required></label>' +
        '<div class="hero-admin-actions">' +
          '<label class="btn btn-sm up">Upload replacement<input type="file" data-hero-upload accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
          '<button class="btn btn-sm btn-primary" type="button" data-hero-save>Save slide</button>' +
          '<button class="btn btn-sm btn-ghost" type="button" data-hero-reset' + (s.overridden ? '' : ' disabled') + '>Restore default</button>' +
          '<span class="msg" data-hero-msg></span>' +
        '</div>' +
      '</div></article>';
  }

  function bindHeroSlideActions() {
    $$('#heroSlideList [data-hero-admin]').forEach(function (card) {
      var key = card.dataset.heroAdmin;
      var base = HERO_DEFAULTS.filter(function (s) { return s.slide_key === key; })[0];
      var imageField = card.querySelector('[data-hero-field="image_url"]');
      var preview = card.querySelector('.hero-admin-preview img');
      var msg = card.querySelector('[data-hero-msg]');
      imageField.addEventListener('input', function () { preview.src = imageField.value.trim() || base.default_image; });
      preview.addEventListener('error', function () {
        if (preview.getAttribute('src') !== base.default_image) preview.src = base.default_image;
      });
      card.querySelector('[data-hero-upload]').addEventListener('change', function (e) {
        var input = e.currentTarget, file = input.files && input.files[0];
        if (!file) return;
        msg.dataset.err = 'false'; msg.textContent = 'Uploading ' + file.name + '…';
        B.uploadHeroImage(file).then(function (result) {
          imageField.value = result.url; preview.src = result.url;
          msg.dataset.ok = 'true'; msg.textContent = 'Uploaded. Select Save slide to publish it.';
        }).catch(function (err) { msg.dataset.err = 'true'; msg.textContent = err.message; });
        input.value = '';
      });
      card.querySelector('[data-hero-save]').addEventListener('click', function (e) {
        var button = e.currentTarget;
        var row = { slide_key: key, updated_by: state.user && state.user.id };
        card.querySelectorAll('[data-hero-field]').forEach(function (field) {
          row[field.dataset.heroField] = field.value.trim() || null;
        });
        if (!row.eyebrow || !row.headline || !row.alt_text) {
          msg.dataset.err = 'true'; msg.textContent = 'Label, caption and image description are required.'; return;
        }
        button.disabled = true; msg.textContent = 'Saving…';
        B.saveHeroSlide(row).then(loadHeroSlides).catch(function (err) {
          msg.dataset.err = 'true'; msg.textContent = err.message; button.disabled = false;
        });
      });
      card.querySelector('[data-hero-reset]').addEventListener('click', function (e) {
        var button = e.currentTarget;
        if (button.disabled) return;
        button.disabled = true; msg.textContent = 'Restoring the bundled default…';
        B.resetHeroSlide(key).then(loadHeroSlides).catch(function (err) {
          msg.dataset.err = 'true'; msg.textContent = err.message; button.disabled = false;
        });
      });
    });
  }

  /* ---------- the catalog ----------
     These two lists mirror js/landing.js: ITEM_TYPES and the ICON map. Add one
     there and add it here so it can be picked in the dashboard. */
  var PACKAGE_META = {
    demo:       { name: 'Live demo', description: 'Open the running system and click around it.', icon: 'rocket' },
    simulation: { name: 'Live simulation', description: 'Try the machine in your browser before you build it.', icon: 'play' },
    code:       { name: 'Source code', description: 'The full project source, ready to run or upload.', icon: 'code' },
    schema:     { name: 'Database & ERD', description: 'Tables, relationships and the starter data.', icon: 'db' },
    diagram:    { name: 'System & wiring diagram', description: 'How the parts connect — hardware or services.', icon: 'wire' },
    materials:  { name: 'Materials & components', description: 'The full parts list, with direct Shopee links.', icon: 'list' },
    design:     { name: 'UI design files', description: 'The screens and components, ready to edit.', icon: 'pen' },
    docs:       { name: 'Guidelines & documentation', description: 'How it works, how to run it, what to say about it.', icon: 'doc' },
    manual:     { name: 'User manual', description: 'Step by step, for each kind of user.', icon: 'book' },
    deploy:     { name: 'Setup & deployment guide', description: 'Hosting, domain, builds and going live.', icon: 'box' },
    build:      { name: 'Installer / build', description: 'The APK or build you can install and try.', icon: 'phone' },
    support:    { name: 'Setup & troubleshooting', description: 'Ask when something misbehaves. A real person answers.', icon: 'help' },
    custom:     { name: 'New package item', description: '', icon: 'box' }
  };
  var ITEM_LABELS = {};
  Object.keys(PACKAGE_META).forEach(function (key) { ITEM_LABELS[key] = PACKAGE_META[key].name; });
  /* How an item leaves your hands. 'auto' is the old behaviour — everything in
     the package opens together. 'manual' keeps the item shut until you release
     it for that particular buyer, which is what staged prototype work needs. */
  var RELEASE_MODES = [
    ['auto', 'Opens with the package'],
    ['manual', 'Hold — I release it per buyer']
  ];
  var ICON_KEYS = ['bin', 'flip', 'cup', 'more', 'globe', 'phone', 'chip', 'cap', 'db',
                   'rocket', 'book', 'box', 'pen', 'play', 'code', 'wire', 'list', 'doc', 'help'];

  function loadProjects() {
    return B.projects().then(function (rows) {
      state.projects = rows;
      $('#projList').innerHTML = rows.map(projectCard).join('');
      $('#projEmpty').hidden = rows.length > 0;
      $$('#projList [data-edit]').forEach(function (b) {
        b.addEventListener('click', function () {
          openProject(rows.filter(function (r) { return r.id === b.dataset.edit; })[0]);
        });
      });
      say('#projListMsg', rows.length + ' project' + (rows.length === 1 ? '' : 's') +
        ' — the page reads these instead of its built-in list.');
    });
  }

  function projectCard(p) {
    var has = (p.status === 'ready' ? (p.items || []) : (p.planned || []));
    if (Array.isArray(p.package_items) && p.package_items.length) has = p.package_items;
    var faqCount = Array.isArray(p.faqs) ? p.faqs.length : 0;
    return '<div class="proj-card-mini">' +
      (p.image_url
        ? '<div class="proj-mini-cover"><img src="' + esc(p.image_url) + '" alt="" style="' +
          coverStyle(p) + '"></div>'
        : '') +
      '<div class="grow">' +
        '<span class="badge-kind">' + esc(p.kind) + ' · position ' + p.position + '</span>' +
        '<h4>' + esc(p.name) +
          '<span class="pill-s" data-s="' + (p.status === 'ready' ? 'approved' : 'pending') + '">' +
          (p.status === 'ready' ? 'available' : 'coming soon') + '</span>' +
          '<span class="pill-s" data-s="' + (p.rights === 'custom' ? 'pending' : 'approved') + '">' +
          (p.rights === 'custom' ? 'ownership transfers' : 'theirs to use · you keep the original') + '</span></h4>' +
        '<p>' + esc((p.blurb || '').slice(0, 150)) + ((p.blurb || '').length > 150 ? '…' : '') + '</p>' +
        '<p class="muted">' + (has.length ? has.map(function (k) {
          return esc(typeof k === 'object' ? (k.name || 'Package item') : (ITEM_LABELS[k] || k)) +
            (typeof k === 'object' && k.release === 'manual' ? ' <span class="staged-dot" title="Released per buyer">held</span>' : '');
        }).join(' · ') : 'no items listed') +
          ' · ' + faqCount + ' FAQ' + (faqCount === 1 ? '' : 's') +
          (Array.isArray(p.media) && p.media.length
            ? ' · ' + p.media.length + ' preview link' + (p.media.length === 1 ? '' : 's') : '') +
        '</p>' +
      '</div>' +
      '<div class="row-actions"><button class="btn btn-sm" data-edit="' + esc(p.id) + '">Edit</button></div>' +
    '</div>';
  }

  function lines(rows, cols) {
    return (rows || []).map(function (r) {
      return (Array.isArray(r) ? r : [r]).slice(0, cols).join(' | ');
    }).join('\n');
  }
  function parseLines(text, cols) {
    return String(text || '').split('\n')
      .map(function (l) { return l.trim(); })
      .filter(Boolean)
      .map(function (l) {
        var parts = l.split('|').map(function (x) { return x.trim(); });
        while (parts.length < cols) parts.push('');
        return parts.slice(0, cols);
      });
  }

  function legacyPackageItems(p) {
    var active = p.status === 'ready' ? (p.items || []) : (p.planned || []);
    return active.map(function (key) {
      var meta = PACKAGE_META[key] || PACKAGE_META.custom;
      var link = (p.links || {})[key] || {};
      if (typeof link === 'string') link = { href: link };
      return { id: key, type: PACKAGE_META[key] ? key : 'custom', name: meta.name,
        description: meta.description, icon: meta.icon, href: link.href || '', sameTab: !!link.sameTab };
    });
  }

  function editablePackageItems(p) {
    return Array.isArray(p.package_items) && p.package_items.length
      ? p.package_items
      : legacyPackageItems(p);
  }

  function newPackageId() {
    return 'pkg-' + (B.uuid ? B.uuid().slice(0, 8) : String(Date.now()));
  }

  /* The platform a preview link points at, read off the address — the same
     detection the public page uses to pick the logo on the button. */
  var MEDIA_NAMES = [
    [/(^|\.)(youtube\.com|youtu\.be)/i, 'YouTube'],
    [/(^|\.)tiktok\.com/i, 'TikTok'],
    [/(^|\.)(facebook\.com|fb\.watch|fb\.me)/i, 'Facebook'],
    [/(^|\.)instagram\.com/i, 'Instagram'],
    [/(^|\.)(drive|docs)\.google\.com/i, 'Google Drive']
  ];
  function mediaKindName(url) {
    var host = '';
    try { host = new URL(String(url || ''), location.href).hostname; } catch (e) { host = ''; }
    if (!host) return 'Link';
    for (var i = 0; i < MEDIA_NAMES.length; i++) {
      if (MEDIA_NAMES[i][0].test(host)) return MEDIA_NAMES[i][1];
    }
    return host.replace(/^www\./, '');
  }

  /* a one-line box that grows with what is typed into it, up to a point */
  function grow(box) {
    if (!box) return;
    box.style.height = 'auto';
    box.style.height = Math.min(box.scrollHeight, 150) + 'px';
  }

  function clamp(n) { return Math.max(0, Math.min(100, n)); }

  /* How a project's cover sits in a 16:9 frame — the same three values the
     public page reads, so the dashboard shows the crop the visitor will see. */
  function coverStyle(p) {
    var fit = p.image_fit === 'contain' ? 'contain' : 'cover';
    var focus = /^[0-9.]+% [0-9.]+%$/.test(String(p.image_focus || '')) ? p.image_focus : '50% 50%';
    var zoom = Number(p.image_zoom) > 1 ? Number(p.image_zoom) : 1;
    return 'object-fit:' + fit + ';object-position:' + focus +
      (fit === 'cover' && zoom > 1
        ? ';transform:scale(' + zoom + ');transform-origin:' + focus : '');
  }

  function parseFocus(value) {
    var m = /^\s*([0-9.]+)%\s+([0-9.]+)%\s*$/.exec(String(value || ''));
    return m ? { x: clamp(Number(m[1])), y: clamp(Number(m[2])) } : { x: 50, y: 50 };
  }

  /* what the buyer will see offered for download, named from the address */
  function attachedName(href) {
    var clean = String(href || '').split('#')[0].split('?')[0];
    if (!clean) return 'Nothing attached yet — the item will show a note instead of a file.';
    var name = decodeURIComponent(clean.split('/').pop() || '').replace(/^[0-9a-f]{8}-/i, '');
    if (!name) return 'Links to a page rather than a file.';
    return /\.[a-z0-9]{1,5}$/i.test(name) ? 'Attached: ' + name : 'Links to: ' + name;
  }

  function releaseHint(mode) {
    return mode === 'manual'
      ? 'Stays shut after the payment and the terms. You open it for each buyer from the Payments tab.'
      : 'Opens as soon as the payment is approved and the terms are signed.';
  }

  function openProject(p) {
    var isNew = !p;
    p = p || { id: '', name: '', kind: 'web', status: 'soon', rights: 'catalog',
               position: 100, price_currency: 'PHP', tags: [], items: [], planned: [],
               links: {}, files: [], materials: [], run: [], faqs: [], package_items: [], image_url: '' };
    state.editing = p;
    $('#projTitle').textContent = isNew ? 'New project' : p.name;
    $('#projSub').textContent = isNew ? 'It appears on the page as soon as you save it.'
                                      : 'id: ' + p.id;
    $('#projDelete').hidden = isNew;
    say('#projMsg', '');

    function field(id, label, value, hint, type) {
      return '<div><label class="lbl" for="' + id + '">' + label + '</label>' +
        '<input type="' + (type || 'text') + '" id="' + id + '" value="' + esc(value == null ? '' : value) + '">' +
        (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    }
    function area(id, label, value, hint, mono) {
      return '<div class="wide"><label class="lbl" for="' + id + '">' + label + '</label>' +
        '<textarea id="' + id + '"' + (mono ? ' class="mono"' : '') + '>' + esc(value || '') + '</textarea>' +
        (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    }
    function select(id, label, value, options) {
      return '<div><label class="lbl" for="' + id + '">' + label + '</label><select id="' + id + '">' +
        options.map(function (o) {
          var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o;
          return '<option value="' + esc(v) + '"' + (String(value) === v ? ' selected' : '') + '>' + esc(t) + '</option>';
        }).join('') + '</select></div>';
    }
    function faqRow(faq) {
      faq = faq || {};
      var question = Array.isArray(faq) ? faq[0] : faq.question;
      var answer = Array.isArray(faq) ? faq[1] : faq.answer;
      return '<div class="faq-edit-row" data-faq-row>' +
        '<div><label class="lbl">Question / description</label>' +
          '<textarea data-faq-question placeholder="What will users want to know?">' +
            esc(question || '') + '</textarea></div>' +
        '<div><label class="lbl">Answer</label>' +
          '<textarea data-faq-answer placeholder="Write the answer users should see.">' +
            esc(answer || '') + '</textarea></div>' +
        '<button class="btn btn-sm btn-ghost faq-remove" type="button" data-remove-faq ' +
          'aria-label="Remove this FAQ">Remove</button>' +
      '</div>';
    }
    function mediaRow(m) {
      if (typeof m === 'string') m = { url: m };
      m = m || {};
      var url = String(m.url || '');
      return '<div class="media-edit-row" data-media-row>' +
        '<span class="media-badge" data-media-badge>' + esc(mediaKindName(url)) + '</span>' +
        '<div><label class="lbl">Address</label>' +
          '<input type="url" data-media-url value="' + esc(url) + '" ' +
            'placeholder="https://www.youtube.com/watch?v=…"></div>' +
        '<div><label class="lbl">Button text</label>' +
          '<input type="text" data-media-label value="' + esc(m.label || '') + '" ' +
            'placeholder="leave blank and I will name it"></div>' +
        '<div class="wide"><label class="lbl">Small line under it (optional)</label>' +
          '<input type="text" data-media-note value="' + esc(m.note || '') + '" ' +
            'placeholder="e.g. 3-minute walkthrough of the finished machine"></div>' +
        '<button class="btn btn-sm btn-ghost media-remove" type="button" data-remove-media ' +
          'aria-label="Remove this link">Remove</button>' +
      '</div>';
    }

    function packageRow(item) {
      item = item || { id: newPackageId(), type: 'custom', name: '', description: '', icon: 'box', href: '', sameTab: false };
      var type = PACKAGE_META[item.type] ? item.type : 'custom';
      var meta = PACKAGE_META[type];
      var name = item.name || meta.name;
      var description = item.description == null ? meta.description : item.description;
      var icon = ICON_KEYS.indexOf(item.icon) > -1 ? item.icon : meta.icon;
      var href = item.href || '';
      var release = item.release === 'manual' ? 'manual' : 'auto';
      var price = item.price == null || item.price === '' ? '' : item.price;
      return '<article class="package-edit-card" data-package-row data-package-id="' + esc(item.id || newPackageId()) + '">' +
        '<div class="package-edit-head"><span class="package-order" aria-hidden="true"></span>' +
          '<strong data-package-heading>' + esc(name || 'New package item') + '</strong>' +
          '<div class="package-order-actions">' +
            '<button class="btn btn-sm btn-ghost" type="button" data-package-up aria-label="Move package item up">&uarr;</button>' +
            '<button class="btn btn-sm btn-ghost" type="button" data-package-down aria-label="Move package item down">&darr;</button>' +
            '<button class="btn btn-sm btn-ghost" type="button" data-remove-package>Remove</button>' +
          '</div></div>' +
        '<div class="package-edit-grid">' +
          '<div><label class="lbl">Package type</label><select data-package-type>' +
            Object.keys(PACKAGE_META).map(function (key) {
              return '<option value="' + key + '"' + (type === key ? ' selected' : '') + '>' + esc(ITEM_LABELS[key]) + '</option>';
            }).join('') + '</select></div>' +
          '<div><label class="lbl">Icon</label><select data-package-icon>' +
            ICON_KEYS.map(function (key) {
              return '<option value="' + key + '"' + (icon === key ? ' selected' : '') + '>' + esc(key) + '</option>';
            }).join('') + '</select></div>' +
          '<div class="wide"><label class="lbl">Title</label>' +
            '<input type="text" data-package-name value="' + esc(name) + '" placeholder="What users will receive"></div>' +
          '<div class="wide"><label class="lbl">Description</label>' +
            '<textarea data-package-description placeholder="Explain what this item contains.">' + esc(description) + '</textarea></div>' +
          '<div class="wide"><label class="lbl">Attachment or destination</label>' +
            '<div class="package-attachment-row"><input type="text" data-package-href value="' + esc(href) + '" ' +
              'placeholder="Upload a file, or paste an https:// or site URL">' +
              '<label class="btn btn-sm up">Upload attachment<input type="file" data-package-upload></label></div>' +
            '<span class="hint">PDF, Word, text, spreadsheets, slides, ZIP, images, sketches, installers ' +
              '&mdash; up to 64&nbsp;MB. A buyer who opens this item gets a <b>Download it</b> button ' +
              'for the file, not just a view of it.</span>' +
            '<p class="attach-now" data-attach-name>' + esc(attachedName(href)) + '</p></div>' +
          '<div><label class="lbl">Price on its own</label>' +
            '<input type="number" min="0" step="0.01" data-package-price value="' + esc(price) + '" ' +
              'placeholder="blank = package only">' +
            '<span class="hint">Set this and a buyer can pay for just this component.</span></div>' +
          '<div class="wide package-release" data-release="' + release + '">' +
            '<label class="lbl">When the buyer gets it</label>' +
            '<select data-package-release>' +
              RELEASE_MODES.map(function (m) {
                return '<option value="' + m[0] + '"' + (release === m[0] ? ' selected' : '') +
                  '>' + esc(m[1]) + '</option>';
              }).join('') +
            '</select>' +
            '<span class="hint" data-release-hint>' + esc(releaseHint(release)) + '</span></div>' +
          '<div class="wide package-same-tab"><label><input type="checkbox" data-package-same-tab' +
            (item.sameTab ? ' checked' : '') + '> Open in the same browser tab</label></div>' +
        '</div>' +
      '</article>';
    }

    $('#projBody').innerHTML =
      '<div class="proj-group"><h4>The card</h4>' +
        '<p class="muted">What a visitor sees before opening it.</p>' +
        '<div class="project-image-editor">' +
          '<div class="frame-stack">' +
            '<div class="project-image-preview" id="pImagePreview" data-fit="' +
              (p.image_fit === 'contain' ? 'contain' : 'cover') + '">' +
              '<span class="frame-empty">No cover image yet</span>' +
              '<img id="pImageShot" alt="" hidden>' +
              '<span class="frame-grid" aria-hidden="true"></span>' +
            '</div>' +
            '<p class="frame-hint" id="pFrameHint">Drag the picture to choose what the card shows.</p>' +
          '</div>' +
          '<div class="project-image-controls">' +
            '<label class="lbl" for="pImageUrl">Cover image</label>' +
            '<input type="text" id="pImageUrl" value="' + esc(p.image_url || '') + '" ' +
              'placeholder="Upload an image or paste an https:// image URL">' +
            '<span class="hint">The card and the top of the project details crop to 16:9. Recommended: 1600 × 900.</span>' +
            '<div class="frame-controls">' +
              '<div class="frame-fit" role="group" aria-label="How the cover fills its frame">' +
                '<label><input type="radio" name="pImageFit" value="cover"' +
                  (p.image_fit === 'contain' ? '' : ' checked') + '> Fill the frame</label>' +
                '<label><input type="radio" name="pImageFit" value="contain"' +
                  (p.image_fit === 'contain' ? ' checked' : '') + '> Show the whole image</label>' +
              '</div>' +
              '<label class="frame-zoom"><span>Zoom</span>' +
                '<input type="range" id="pImageZoom" min="1" max="3" step="0.05" value="' +
                  esc(p.image_zoom == null ? 1 : p.image_zoom) + '">' +
                '<b id="pImageZoomOut">1.00&times;</b></label>' +
            '</div>' +
            '<div class="proj-row-tools">' +
              '<label class="btn btn-sm up">Upload image<input type="file" id="pImageUpload" accept="image/jpeg,image/png,image/webp,image/gif"></label>' +
              '<button class="btn btn-sm btn-ghost" type="button" id="pFrameReset">Centre it again</button>' +
              '<button class="btn btn-sm btn-ghost" type="button" id="pImageRemove">Remove image</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="proj-grid">' +
          field('pId', 'id', p.id, isNew ? 'lowercase, no spaces — it never changes afterwards' : 'cannot be changed') +
          field('pName', 'Name', p.name) +
          field('pTagline', 'Tagline', p.tagline, 'the small line above the name') +
          field('pAudience', 'Audience', p.audience, 'e.g. Thesis / capstone · Business') +
          select('pKind', 'Kind', p.kind, [['web', 'Web system'], ['mobile', 'Mobile / PWA'],
                                           ['embedded', 'Embedded build'], ['any', 'Anything else']]) +
          select('pStatus', 'Status', p.status, [['ready', 'Available now'], ['soon', 'Coming soon']]) +
          select('pRights', 'Rights', p.rights, [
            ['catalog', 'Yours to use — JUDECH keeps the original (default)'],
            ['custom', 'Transfer ownership to buyer — explicit selection']
          ]) +
          '<div class="wide rights-choice" id="pRightsChoice"></div>' +
          select('pIcon', 'Icon', p.icon || 'more', ICON_KEYS) +
          field('pPosition', 'Position', p.position, 'lower shows first', 'number') +
          field('pPrice', 'Price', p.price_amount == null ? '' : p.price_amount, 'leave blank to hide it', 'number') +
          area('pBlurb', 'Blurb', p.blurb, 'the paragraph on the card') +
          area('pTags', 'Tags', (p.tags || []).join(', '), 'comma separated') +
        '</div>' +
      '</div>' +

      '<div class="proj-group package-editor"><h4>Inside the package</h4>' +
        '<p class="muted">Build the exact list users see. Choose a familiar type or add a custom item, ' +
          'edit its title and description, then optionally upload the attachment it opens.</p>' +
        '<div class="proj-grid intro-editor">' + area('pIntro', 'Project intro', p.intro, 'shown before the package list') + '</div>' +
        '<div class="package-edit-list" id="pPackageList">' + editablePackageItems(p).map(packageRow).join('') + '</div>' +
        '<button class="btn btn-sm" type="button" id="pPackageAdd">+ Add package item</button>' +
      '</div>' +

      '<div class="proj-group media-editor"><h4>Preview links &mdash; public</h4>' +
        '<p class="muted">A demo video on YouTube, a build clip on TikTok, a live site anyone ' +
          'can click. These sit <b>outside the payment</b>: every visitor sees them, which is ' +
          'the point &mdash; they are what convinces someone to buy. Anything that should stay ' +
          'behind the payment belongs in <em>Inside the package</em> above.</p>' +
        '<div class="media-edit-list" id="pMediaList">' +
          (Array.isArray(p.media) ? p.media : []).map(mediaRow).join('') +
        '</div>' +
        '<button class="btn btn-sm" type="button" id="pMediaAdd">+ Add a link</button>' +
      '</div>' +

      '<div class="proj-group"><h4>Lists</h4>' +
        '<p class="muted">One per line. Separate the columns with a vertical bar.</p>' +
        '<div class="proj-grid">' +
          area('pFiles', 'Source files', lines(p.files, 3), 'Name | What it is | Link', true) +
          area('pMaterials', 'Materials', lines(p.materials, 3), 'Component | What it does | Qty', true) +
          area('pRun', 'How to run it', lines(p.run, 2), 'Step | Command', true) +
          field('pLibraries', 'Libraries', p.libraries, 'named in the source-code panel') +
        '</div>' +
      '</div>' +

      '<div class="proj-group share-editor"><h4>Private links for one customer</h4>' +
        '<p class="muted">A link that shows this project to one person: only the components ' +
          'they asked for, at the price you quoted them. The public catalog is untouched — ' +
          'everyone else still sees the full package at the normal price.</p>' +
        (isNew
          ? '<p class="muted">Save the project once and this section comes to life.</p>'
          : '<div class="share-form">' +
              '<div class="proj-grid">' +
                field('pShareName', 'Customer name', '', 'who this link is for') +
                field('pShareExpiry', 'Expires in (days, optional)', '', 'blank = never', 'number') +
                field('pShareHeadline', 'Headline (optional)', '', 'e.g. Prototype — phase 1') +
                field('pSharePrice', 'Price for this selection (optional)', '',
                      'overrides the package price on this link only', 'number') +
                area('pShareNote', 'A line for them (optional)', '',
                     'shown at the top of their view') +
              '</div>' +
              '<span class="lbl">Which components this customer sees</span>' +
              '<div class="share-items" id="pShareItems"></div>' +
              '<div class="login-row">' +
                '<button class="btn btn-primary btn-sm" type="button" id="pShareAdd">Generate the link</button>' +
                '<span class="msg" id="pShareMsg"></span>' +
              '</div>' +
            '</div>' +
            '<div class="share-list" id="pShareList"></div>') +
      '</div>' +

      '<div class="proj-group"><h4>Frequently asked questions</h4>' +
        '<p class="muted">Add the questions users often ask about this project. They appear ' +
          'inside the project details, and users can open each answer.</p>' +
        '<div class="faq-edit-list" id="pFaqList">' +
          (Array.isArray(p.faqs) ? p.faqs : []).map(faqRow).join('') +
        '</div>' +
        '<button class="btn btn-sm" type="button" id="pFaqAdd">+ Add FAQ</button>' +
      '</div>';

    $('#pId').disabled = !isNew;
    function paintRightsChoice() {
      var transfer = $('#pRights').value === 'custom';
      $('#pRightsChoice').dataset.transfer = transfer ? 'true' : 'false';
      $('#pRightsChoice').innerHTML = transfer
        ? '<b>Ownership transfer selected.</b> Use this only when you intend to transfer the finished work under a separate written agreement.'
        : '<b>Safe default:</b> the project is theirs to use — build it, run it, modify it, keep it — while the original work and its copyright stay with JUDECH.';
    }
    $('#pRights').addEventListener('change', paintRightsChoice);
    paintRightsChoice();
    /* ---------- framing the cover ----------
       The preview is the card, at the card's own 16:9. Drag inside it and the
       image moves under the frame; what you let go of is the object-position
       saved with the project, so the page crops to the same point. */
    var frame = parseFocus(p.image_focus);
    frame.zoom = Number(p.image_zoom) > 0 ? Number(p.image_zoom) : 1;

    function currentFit() {
      var on = $('#projBody input[name="pImageFit"]:checked');
      return on && on.value === 'contain' ? 'contain' : 'cover';
    }
    function paintImagePreview() {
      var url = ($('#pImageUrl').value || '').trim();
      var box = $('#pImagePreview'), shot = $('#pImageShot'), fit = currentFit();
      box.dataset.fit = fit;
      box.dataset.empty = url ? 'false' : 'true';
      box.dataset.dragging = 'false';
      shot.hidden = !url;
      if (url && shot.getAttribute('src') !== url) shot.setAttribute('src', url);
      shot.alt = url ? 'Cover preview' : '';
      shot.style.objectFit = fit;
      shot.style.objectPosition = frame.x + '% ' + frame.y + '%';
      shot.style.transform = fit === 'cover' && frame.zoom > 1 ? 'scale(' + frame.zoom + ')' : '';
      shot.style.transformOrigin = frame.x + '% ' + frame.y + '%';
      $('#pImageZoom').value = frame.zoom;
      $('#pImageZoom').disabled = fit !== 'cover' || !url;
      $('#pImageZoomOut').textContent = Number(frame.zoom).toFixed(2) + '×';
      $('#pFrameHint').textContent = !url
        ? 'Upload an image or paste a link, then drag it into place.'
        : fit === 'contain'
          ? 'The whole image is shown — nothing is cropped, so there is nothing to drag.'
          : 'Drag the picture to choose what the card shows · ' +
            Math.round(frame.x) + '% ' + Math.round(frame.y) + '%';
    }

    var dragFrom = null;
    $('#pImagePreview').addEventListener('pointerdown', function (e) {
      if (currentFit() !== 'cover' || $('#pImageShot').hidden) return;
      dragFrom = { x: e.clientX, y: e.clientY, fx: frame.x, fy: frame.y,
                   w: this.clientWidth || 1, h: this.clientHeight || 1 };
      this.setPointerCapture(e.pointerId);
      this.dataset.dragging = 'true';
      e.preventDefault();
    });
    $('#pImagePreview').addEventListener('pointermove', function (e) {
      if (!dragFrom) return;
      /* drag right, see more of the left edge — so the focus point walks back */
      frame.x = clamp(dragFrom.fx - (e.clientX - dragFrom.x) / dragFrom.w * 100);
      frame.y = clamp(dragFrom.fy - (e.clientY - dragFrom.y) / dragFrom.h * 100);
      paintImagePreview();
      $('#pImagePreview').dataset.dragging = 'true';
    });
    ['pointerup', 'pointercancel'].forEach(function (evt) {
      $('#pImagePreview').addEventListener(evt, function () {
        if (!dragFrom) return;
        dragFrom = null;
        this.dataset.dragging = 'false';
        say('#projMsg', 'Framing set — save the project to keep it.', 'ok');
      });
    });
    $$('#projBody input[name="pImageFit"]').forEach(function (radio) {
      radio.addEventListener('change', paintImagePreview);
    });
    $('#pImageZoom').addEventListener('input', function () {
      frame.zoom = Number(this.value) || 1;
      paintImagePreview();
    });
    $('#pFrameReset').addEventListener('click', function () {
      frame.x = 50; frame.y = 50; frame.zoom = 1;
      paintImagePreview();
    });
    $('#pImageUrl').addEventListener('input', paintImagePreview);
    $('#pImageRemove').addEventListener('click', function () {
      $('#pImageUrl').value = '';
      frame.x = 50; frame.y = 50; frame.zoom = 1;
      paintImagePreview();
      say('#projMsg', 'Image removed — save the project to keep this change.', 'ok');
    });
    $('#pImageUpload').addEventListener('change', function () {
      var input = $('#pImageUpload'), f = input.files && input.files[0];
      if (!f) return;
      say('#projMsg', 'Uploading ' + f.name + '…');
      B.uploadProjectImage(f).then(function (res) {
        $('#pImageUrl').value = res.url;
        frame.x = 50; frame.y = 50; frame.zoom = 1;
        paintImagePreview();
        say('#projMsg', f.name + ' uploaded — drag it into place, then save.', 'ok');
      }).catch(function (e) { say('#projMsg', e.message, 'err'); });
      input.value = '';
    });
    state.frame = frame;
    paintImagePreview();
    $('#pPackageAdd').addEventListener('click', function () {
      $('#pPackageList').insertAdjacentHTML('beforeend', packageRow());
      var rows = $$('#pPackageList [data-package-row]');
      var last = rows[rows.length - 1];
      if (last) last.querySelector('[data-package-name]').focus();
      paintShareItems();
    });
    $('#pPackageList').addEventListener('input', function (e) {
      var row = e.target.closest('[data-package-row]');
      if (!row) return;
      if (e.target.matches('[data-package-name]')) {
        row.querySelector('[data-package-heading]').textContent =
          e.target.value.trim() || 'New package item';
      }
      if (e.target.matches('[data-package-href]')) {
        row.querySelector('[data-attach-name]').textContent = attachedName(e.target.value);
      }
    });
    $('#pPackageList').addEventListener('change', function (e) {
      var row = e.target.closest('[data-package-row]');
      if (!row) return;
      if (e.target.matches('[data-package-type]')) {
        var meta = PACKAGE_META[e.target.value] || PACKAGE_META.custom;   // price is left alone
        row.querySelector('[data-package-name]').value = meta.name;
        row.querySelector('[data-package-description]').value = meta.description;
        row.querySelector('[data-package-icon]').value = meta.icon;
        row.querySelector('[data-package-heading]').textContent = meta.name;
      }
      if (e.target.matches('[data-package-release]')) {
        row.querySelector('[data-package-release]').closest('.package-release')
          .dataset.release = e.target.value;
        row.querySelector('[data-release-hint]').textContent = releaseHint(e.target.value);
      }
      if (e.target.matches('[data-package-upload]')) {
        var input = e.target, f = input.files && input.files[0];
        if (!f) return;
        say('#projMsg', 'Uploading ' + f.name + '…');
        B.uploadProjectFile(f).then(function (res) {
          row.querySelector('[data-package-href]').value = res.url;
          row.querySelector('[data-attach-name]').textContent = attachedName(res.url);
          say('#projMsg', f.name + ' attached — save the project to publish it.', 'ok');
        }).catch(function (err) { say('#projMsg', err.message, 'err'); });
        input.value = '';
      }
    });
    $('#pPackageList').addEventListener('click', function (e) {
      var row = e.target.closest('[data-package-row]');
      if (!row) return;
      if (e.target.closest('[data-remove-package]')) row.remove();
      if (e.target.closest('[data-package-up]') && row.previousElementSibling) {
        row.parentNode.insertBefore(row, row.previousElementSibling);
      }
      if (e.target.closest('[data-package-down]') && row.nextElementSibling) {
        row.parentNode.insertBefore(row.nextElementSibling, row);
      }
    });
    $('#pMediaAdd').addEventListener('click', function () {
      $('#pMediaList').insertAdjacentHTML('beforeend', mediaRow());
      var rows = $$('#pMediaList [data-media-row]');
      var last = rows[rows.length - 1];
      if (last) last.querySelector('[data-media-url]').focus();
    });
    $('#pMediaList').addEventListener('input', function (e) {
      if (!e.target.matches('[data-media-url]')) return;
      var row = e.target.closest('[data-media-row]');
      row.querySelector('[data-media-badge]').textContent = mediaKindName(e.target.value);
    });
    $('#pMediaList').addEventListener('click', function (e) {
      var remove = e.target.closest('[data-remove-media]');
      if (remove) remove.closest('[data-media-row]').remove();
    });
    $('#pFaqAdd').addEventListener('click', function () {
      $('#pFaqList').insertAdjacentHTML('beforeend', faqRow());
      var rows = $$('#pFaqList [data-faq-row]');
      var last = rows[rows.length - 1];
      if (last) last.querySelector('[data-faq-question]').focus();
    });
    $('#pFaqList').addEventListener('click', function (e) {
      var remove = e.target.closest('[data-remove-faq]');
      if (remove) remove.closest('[data-faq-row]').remove();
    });

    if (!isNew) {
      paintShareItems();
      loadShares(p.id);
      $('#pShareAdd').addEventListener('click', function () { createShare(p.id); });
      $('#pPackageList').addEventListener('input', function (e) {
        if (e.target.matches('[data-package-name]')) paintShareItems();
      });
      $('#pPackageList').addEventListener('click', function () { setTimeout(paintShareItems, 0); });
    }

    $('#projOverlay').dataset.open = 'true';
    document.body.classList.add('modal-open');
  }

  /* ---------- private links ----------
     Built from the rows in the editor, so the list matches what you are looking
     at. A component added but not saved yet has no id in the database — the
     server drops it and we say so rather than handing over a link that is short
     of what you ticked. */
  function currentPackageRows() {
    return $$('#pPackageList [data-package-row]').map(function (row) {
      return {
        id: row.dataset.packageId,
        name: (row.querySelector('[data-package-name]').value || '').trim() || 'Package item',
        price: (row.querySelector('[data-package-price]').value || '').trim()
      };
    }).filter(function (r) { return r.id; });
  }

  function paintShareItems() {
    var box = $('#pShareItems');
    if (!box) return;
    var rows = currentPackageRows();
    var ticked = {};
    $$('#pShareItems [data-share-item]').forEach(function (c) { ticked[c.dataset.shareItem] = c.checked; });
    var overrides = {};
    $$('#pShareItems [data-share-price]').forEach(function (i) { overrides[i.dataset.sharePrice] = i.value; });
    box.innerHTML = rows.length
      ? rows.map(function (r) {
          return '<label class="share-item">' +
            '<input type="checkbox" data-share-item="' + esc(r.id) + '"' +
              (ticked[r.id] ? ' checked' : '') + '>' +
            '<span>' + esc(r.name) + '</span>' +
            '<input type="number" min="0" step="0.01" data-share-price="' + esc(r.id) + '" ' +
              'value="' + esc(overrides[r.id] == null ? '' : overrides[r.id]) + '" ' +
              'placeholder="' + (r.price ? esc(r.price) : 'their price') + '">' +
          '</label>';
        }).join('')
      : '<p class="muted">Add package items above first.</p>';
  }

  function shareUrl(token) {
    var base = location.href.split('#')[0].split('?')[0].replace(/[^/]*$/, '');
    return base + 'index.html?offer=' + token;
  }

  function loadShares(projectId) {
    var list = $('#pShareList');
    if (!list || !B.projectShares) return Promise.resolve();
    list.innerHTML = '<p class="muted">Reading the links…</p>';
    return B.projectShares(projectId).then(function (rows) {
      list.innerHTML = rows.length
        ? rows.map(shareRow).join('')
        : '<p class="muted">No private links for this project yet.</p>';
      $$('#pShareList [data-copy]').forEach(function (b) {
        b.addEventListener('click', function () { copy(b.dataset.copy, b); });
      });
      $$('#pShareList [data-revoke-share]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm('Cancel this link? It stops working for that customer straight away.')) return;
          b.disabled = true;
          B.revokeProjectShare(b.dataset.revokeShare)
            .then(function () { return loadShares(projectId); })
            .catch(function (e) { window.alert(e.message); b.disabled = false; });
        });
      });
    }).catch(function (e) {
      list.innerHTML = '<p class="muted">Could not read the links: ' + esc(e.message) + '</p>';
    });
  }

  function shareRow(s) {
    var url = shareUrl(s.token);
    return '<div class="share-row" data-state="' + esc(s.state) + '">' +
      '<div class="grow">' +
        '<h5>' + esc(s.customer_name) +
          '<span class="pill-s" data-s="' + (s.state === 'revoked' || s.state === 'expired' ? 'rejected' : 'approved') + '">' +
          esc(s.state) + '</span></h5>' +
        '<p class="share-link">' + esc(url) + '</p>' +
        '<p class="muted">' +
          ((s.item_ids || []).length ? (s.item_ids || []).length + ' component' +
            ((s.item_ids || []).length === 1 ? '' : 's') : 'the whole package') +
          (s.package_price == null ? '' : ' · quoted ' + money(s.package_price)) +
          ' · made ' + when(s.created_at) +
          (s.opened_at ? ' · opened ' + when(s.opened_at) + ' (' + s.open_count + ')' : ' · not opened yet') +
          (s.expires_at ? ' · expires ' + when(s.expires_at) : '') +
        '</p>' +
        '<p class="share-paid" data-paid="' + (Number(s.approved_count || 0) > 0) + '">' +
          (Number(s.payment_count || 0)
            ? Number(s.approved_count || 0) + ' payment' + (Number(s.approved_count) === 1 ? '' : 's') +
              ' approved · ' + money(s.paid_amount) + ' in' +
              (Number(s.pending_count || 0) ? ' · ' + s.pending_count + ' waiting for you' : '') +
              (s.last_payment_at ? ' · last ' + when(s.last_payment_at) : '')
            : 'Nothing paid against this link yet.') +
        '</p>' +
      '</div>' +
      '<div class="row-actions">' +
        '<button class="btn btn-sm" type="button" data-copy="' + esc(url) + '">Copy link</button>' +
        (s.state === 'revoked' ? ''
          : '<button class="btn btn-sm btn-danger" type="button" data-revoke-share="' + s.id + '">Cancel</button>') +
      '</div>' +
    '</div>';
  }

  function createShare(projectId) {
    var name = ($('#pShareName').value || '').trim();
    if (name.length < 2) { $('#pShareName').focus(); return say('#pShareMsg', 'Who is this link for?', 'err'); }
    var itemIds = [], prices = {};
    $$('#pShareItems [data-share-item]').forEach(function (c) {
      if (!c.checked) return;
      var id = c.dataset.shareItem;
      itemIds.push(id);
      var over = ($('#pShareItems [data-share-price="' + id + '"]').value || '').trim();
      if (over !== '') prices[id] = Number(over);
    });
    if (!itemIds.length) return say('#pShareMsg', 'Tick the components this customer should see.', 'err');
    var price = ($('#pSharePrice').value || '').trim();
    var days = ($('#pShareExpiry').value || '').trim();

    $('#pShareAdd').disabled = true;
    say('#pShareMsg', 'Making the link…');
    B.createProjectShare({
      projectId: projectId,
      customerName: name,
      itemIds: itemIds,
      prices: prices,
      packagePrice: price === '' ? null : Number(price),
      headline: ($('#pShareHeadline').value || '').trim(),
      note: ($('#pShareNote').value || '').trim(),
      expiresDays: days === '' ? null : Number(days)
    }).then(function (row) {
      var got = (row.item_ids || []).length;
      say('#pShareMsg', got < itemIds.length
        ? 'Link made, but only ' + got + ' of ' + itemIds.length + ' components were in the ' +
          'database — save the project, then make the link again to include the new ones.'
        : 'Link made — copy it from the list below.', got < itemIds.length ? 'err' : 'ok');
      $('#pShareName').value = ''; $('#pShareHeadline').value = '';
      $('#pShareNote').value = ''; $('#pSharePrice').value = ''; $('#pShareExpiry').value = '';
      return loadShares(projectId);
    }).catch(function (e) { say('#pShareMsg', e.message, 'err'); })
      .then(function () { $('#pShareAdd').disabled = false; });
  }

  function collectProject() {
    var p = state.editing || {};
    var isNew = !p.id;
    var id = ($('#pId').value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) throw new Error('An id is needed — lowercase, no spaces.');
    if (!$('#pName').value.trim()) throw new Error('The project needs a name.');
    var status = $('#pStatus').value;
    var links = {}, usedIds = {};
    var packageItems = $$('#pPackageList [data-package-row]').map(function (row, index) {
      var name = row.querySelector('[data-package-name]').value.trim();
      if (!name) throw new Error('Package item ' + (index + 1) + ' needs a title.');
      var id = row.dataset.packageId || newPackageId();
      if (usedIds[id]) id = newPackageId();
      usedIds[id] = true;
      var href = row.querySelector('[data-package-href]').value.trim();
      var sameTab = row.querySelector('[data-package-same-tab]').checked;
      if (href) links[id] = { href: href, sameTab: sameTab };
      return {
        id: id,
        type: row.querySelector('[data-package-type]').value,
        name: name,
        description: row.querySelector('[data-package-description]').value.trim(),
        icon: row.querySelector('[data-package-icon]').value,
        href: href,
        sameTab: sameTab,
        release: row.querySelector('[data-package-release]').value === 'manual' ? 'manual' : 'auto',
        price: (function () {
          var raw = (row.querySelector('[data-package-price]').value || '').trim();
          if (raw === '') return null;
          var n = Number(raw);
          if (isNaN(n) || n < 0) throw new Error('Package item ' + (index + 1) + ' has an odd price.');
          return n;
        }())
      };
    });
    var media = $$('#pMediaList [data-media-row]').map(function (row, index) {
      var url = row.querySelector('[data-media-url]').value.trim();
      if (!url) return null;
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('Preview link ' + (index + 1) + ' needs to start with https://');
      }
      return {
        url: url,
        label: row.querySelector('[data-media-label]').value.trim(),
        note: row.querySelector('[data-media-note]').value.trim()
      };
    }).filter(Boolean);
    var picked = packageItems.map(function (item) { return item.id; });
    var price = ($('#pPrice').value || '').trim();
    var faqs = $$('#pFaqList [data-faq-row]').map(function (row, index) {
      var question = row.querySelector('[data-faq-question]').value.trim();
      var answer = row.querySelector('[data-faq-answer]').value.trim();
      if ((question && !answer) || (!question && answer)) {
        throw new Error('FAQ ' + (index + 1) + ' needs both a question and an answer.');
      }
      return question ? { question: question, answer: answer } : null;
    }).filter(Boolean);
    return {
      id: isNew ? id : p.id,
      name: $('#pName').value.trim(),
      tagline: $('#pTagline').value.trim() || null,
      audience: $('#pAudience').value.trim() || null,
      kind: $('#pKind').value,
      status: status,
      rights: $('#pRights').value,
      icon: $('#pIcon').value,
      image_url: $('#pImageUrl').value.trim() || null,
      image_fit: ($('#projBody input[name="pImageFit"]:checked') || {}).value === 'contain'
        ? 'contain' : 'cover',
      image_focus: Math.round((state.frame ? state.frame.x : 50) * 10) / 10 + '% ' +
                   Math.round((state.frame ? state.frame.y : 50) * 10) / 10 + '%',
      image_zoom: Math.round((state.frame ? state.frame.zoom : 1) * 100) / 100,
      position: Number($('#pPosition').value) || 100,
      price_amount: price === '' ? null : Number(price),
      price_currency: p.price_currency || 'PHP',
      blurb: $('#pBlurb').value.trim() || null,
      intro: $('#pIntro').value.trim() || null,
      tags: ($('#pTags').value || '').split(',').map(function (t) { return t.trim(); }).filter(Boolean),
      items: status === 'ready' ? picked : [],
      planned: status === 'ready' ? [] : picked,
      package_items: packageItems,
      links: links,
      files: parseLines($('#pFiles').value, 3),
      materials: parseLines($('#pMaterials').value, 3),
      run: parseLines($('#pRun').value, 2),
      faqs: faqs,
      media: media,
      libraries: $('#pLibraries').value.trim() || null
    };
  }

  $('#projNew').addEventListener('click', function () { openProject(null); });
  $$('[data-close-proj]').forEach(function (el) {
    el.addEventListener('click', function () {
      $('#projOverlay').dataset.open = 'false';
      document.body.classList.remove('modal-open');
      state.editing = null;
    });
  });
  $('#projSave').addEventListener('click', function () {
    var row;
    try { row = collectProject(); }
    catch (e) { say('#projMsg', e.message, 'err'); return; }
    if (row.rights === 'custom' && (!state.editing || state.editing.rights !== 'custom') &&
        !window.confirm('Transfer ownership of this project to the buyer?\n\nOnly continue if you intend to use a separate written ownership-transfer agreement.')) {
      return;
    }
    $('#projSave').disabled = true;
    say('#projMsg', 'Saving…');
    B.saveProject(row).then(function () {
      say('#projMsg', 'Saved.', 'ok');
      state.projects = [];
      return loadProjects();
    }).then(function () {
      $('[data-close-proj]').click();
    }).catch(function (e) { say('#projMsg', e.message, 'err'); })
      .then(function () { $('#projSave').disabled = false; });
  });
  $('#projDelete').addEventListener('click', function () {
    var p = state.editing;
    if (!p || !p.id) return;
    if (!window.confirm('Delete ' + p.name + ' from the catalog? Payments and agreements ' +
                        'already recorded against it stay, but the card disappears.')) return;
    $('#projDelete').disabled = true;
    B.deleteProject(p.id).then(function () {
      state.projects = [];
      return loadProjects();
    }).then(function () { $('[data-close-proj]').click(); })
      .catch(function (e) { say('#projMsg', e.message, 'err'); })
      .then(function () { $('#projDelete').disabled = false; });
  });
  $('#projOverlay').addEventListener('mousedown', function (e) {
    if (e.target === $('#projOverlay')) $('[data-close-proj]').click();
  });

  /* ---------- the whole signed agreement ---------- */

  /* The terms text lives in index.html — one source of truth. Fetched once. */
  function loadTerms() {
    if (state.terms !== null) return Promise.resolve(state.terms);
    return fetch('index.html', { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var body = doc.querySelector('#termsBody');
        if (!body) throw new Error('no terms found in index.html');
        var hint = body.querySelector('.scroll-hint'); if (hint) hint.remove();
        var note = body.querySelector('#rightsNote'); if (note) note.remove();
        var rule = body.querySelector('.rule'); if (rule) rule.remove();
        state.terms = body.innerHTML;
        return state.terms;
      })
      .catch(function (e) {
        state.terms = '';
        console.warn('terms not loaded:', e.message);
        return '';
      });
  }

  function projectName(id) {
    return (state.projects.filter(function (p) { return p.id === id; })[0] || {}).name || id;
  }

  function detailRows(a) {
    var typed = a.signature_type === 'typed';
    return [
      ['Seller', 'Jude Michael Martinez'],
      ['Date', day(a.signed_on)],
      ['Buyer name', '<b>' + esc(a.buyer_name) + '</b>'],
      ['Position', esc(a.buyer_type || '—')],
      ['School / university', esc(a.school || '—')],
      ['City / municipality, province', esc(a.location || '—')],
      ['Project', esc(projectName(a.project_id))],
      ['Acknowledgment', '&#9745; I have read, understood, and agree to the Terms &amp; Conditions above.'],
      ['Buyer signature', typed
        ? '<span class="doc-sig typed">' + esc(a.signature_text || a.buyer_name) + '</span>'
        : '<img class="doc-sig" data-docsig="1" alt="Signature of ' + esc(a.buyer_name) + '" ' +
          'onerror="this.hidden=true;this.nextElementSibling.hidden=false">' +
          '<span class="doc-sig typed" hidden>' + esc(a.buyer_name) + '</span>']
    ];
  }

  function viewAgreement(a) {
    var pay = a.payment_id ? state.payments[a.payment_id] : null;
    state.doc = { a: a, pay: pay, sig: null };
    $('#docTitle').textContent = 'Project package — Terms & Conditions';
    $('#docSub').textContent = 'Please read before purchasing or receiving the project files.';
    $('#docMsg').textContent = '';
    $('#docBody').innerHTML = '<div class="doc-sheet"><p>Loading…</p></div>';
    $('#docOverlay').dataset.open = 'true';
    document.body.classList.add('modal-open');

    loadTerms().then(function (terms) {
      var stale = a.terms_version && a.terms_version !== CURRENT_TERMS;
      $('#docBody').innerHTML =
        (terms
          ? (stale ? '<div class="doc-warn"><span><b>Signed against ' + esc(a.terms_version) +
              '.</b> The text below is the version on the site now (' + esc(CURRENT_TERMS) +
              '). Compare before relying on it.</span></div>' : '')
          : '<div class="doc-warn"><span><b>The terms text could not be loaded.</b> ' +
            'Serve this page over http:// rather than opening the file directly, and it will ' +
            'appear here.</span></div>') +
        '<div class="doc-sheet">' +
          '<p class="doc-section-title">Project package — Terms &amp; Conditions</p>' +
          '<p>Please read before purchasing or receiving the project files.</p>' +
          (terms ? terms : '') +
          '<div class="doc-rule"></div>' +
          '<table class="doc-table">' +
            detailRows(a).map(function (r) {
              return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>';
            }).join('') +
          '</table>' +
        '</div>' +
        '<div class="doc-supporting" id="attachBlock"></div>';
      loadAttachments(a);

      if (a.signature_path) {
        B.signedUrl('signatures', a.signature_path, 3600).then(function (url) {
          var img = $('#docBody [data-docsig]');
          if (img && url) img.src = url;
          if (state.doc) state.doc.sigUrl = url;
          return toDataUrl(url);
        }).then(function (d) { if (state.doc) state.doc.sig = d; }).catch(function () {});
      }
      if (pay && pay.receipt_path) {
        B.signedUrl('receipts', pay.receipt_path, 3600).then(function (url) {
          if (url) $('#docMsg').innerHTML = '<a href="' + url + '" target="_blank" rel="noopener">Open the receipt</a>';
        }).catch(function () {});
      }
    });
  }

  /* Supporting files — admin only. The buyer's page has no way to add or see these. */
  function loadAttachments(a, keepMsg) {
    var box = $('#attachBlock');
    if (!box) return Promise.resolve();
    box.innerHTML = '<p class="doc-section-title">Supporting files</p>' +
      '<p class="muted">Only you can see or add these &mdash; screenshots of the chat where ' +
      'they agreed, proof of payment sent another way, anything that backs this up. They ' +
      'travel with the printed agreement.</p>' +
      '<div class="attach-add">' +
        '<input id="attachCaption" placeholder="What is it? e.g. Messenger chat, 10 Sep">' +
        '<label class="btn btn-sm btn-primary attach-pick">Attach files' +
          '<input type="file" id="attachFile" accept="image/*,application/pdf" multiple></label>' +
        '<span class="msg" id="attachMsg">' + (keepMsg ? esc(keepMsg) : '') + '</span>' +
      '</div>' +
      '<div class="attach-list" id="attachList"><p class="muted">Loading…</p></div>';

    $('#attachFile').addEventListener('change', function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = '';
      if (files.length) uploadAttachments(a, files);
    });

    return B.attachments(a.id).then(function (rows) {
      if (state.doc && state.doc.a.id === a.id) state.doc.attachments = rows;
      renderAttachments(a, rows);
      return rows;
    }).catch(function (err) {
      $('#attachList').innerHTML = '<p class="muted">Could not load them: ' + esc(err.message) + '</p>';
    });
  }

  function renderAttachments(a, rows) {
    var list = $('#attachList');
    if (!list) return;
    if (!rows.length) { list.innerHTML = '<p class="muted">Nothing attached yet.</p>'; return; }
    list.innerHTML = rows.map(function (r) {
      var pdf = /pdf/.test(r.mime || '');
      return '<figure class="attach" data-att="' + r.id + '">' +
        (pdf ? '<span class="attach-pdf" data-attimg="' + r.id + '">PDF</span>'
             : '<img data-attimg="' + r.id + '" alt="' + esc(r.caption || 'Supporting file') + '">') +
        '<figcaption>' +
          '<b>' + esc(r.caption || 'Supporting file') + '</b>' +
          '<span class="muted">' + when(r.created_at) + '</span>' +
          '<button class="linkish-danger" data-attdel="' + r.id + '">Remove</button>' +
        '</figcaption></figure>';
    }).join('');

    rows.forEach(function (r) {
      B.signedUrl('attachments', r.path, 3600).then(function (url) {
        r.url = url;
        var el = list.querySelector('[data-attimg="' + r.id + '"]');
        if (!el || !url) return;
        if (el.tagName === 'IMG') el.src = url;
        else el.innerHTML = '<a href="' + url + '" target="_blank" rel="noopener">Open PDF</a>';
        return toDataUrl(url).then(function (d) { r.data = d; });
      }).catch(function () {});
    });

    $$('#attachList [data-attdel]').forEach(function (b) {
      b.addEventListener('click', function () {
        var row = rows.filter(function (x) { return x.id === b.dataset.attdel; })[0];
        if (!row) return;
        if (!window.confirm('Remove this supporting file? It is deleted for good.')) return;
        b.disabled = true;
        B.removeAttachment(row)
          .then(function () { return loadAttachments(a); })
          .then(function () { return countAttachments(); })
          .catch(function (e) { window.alert(e.message); b.disabled = false; });
      });
    });
  }

  function countAttachments() {
    return B.attachmentCounts().then(function (c) { state.attachCounts = c; }).catch(function () {});
  }

  function uploadAttachments(a, files) {
    var caption = ($('#attachCaption') || {}).value || '';
    var msg = $('#attachMsg');
    var done = 0;
    msg.dataset.err = 'false';
    msg.textContent = 'Uploading 1 of ' + files.length + '…';

    return files.reduce(function (chain, f) {
      return chain.then(function () {
        return readForUpload(f).then(function (dataUrl) {
          return B.addAttachment({
            agreementId: a.id,
            dataUrl: dataUrl,
            caption: caption.trim() || f.name,
            userId: state.user && state.user.id
          });
        }).then(function () {
          done++;
          msg.textContent = done < files.length
            ? 'Uploading ' + (done + 1) + ' of ' + files.length + '…'
            : done + ' file' + (done > 1 ? 's' : '') + ' attached.';
        });
      });
    }, Promise.resolve())
      .then(function () {
        var said = msg.textContent;
        if ($('#attachCaption')) $('#attachCaption').value = '';
        return loadAttachments(a, said);
      })
      .then(countAttachments)
      .catch(function (e) {
        msg.dataset.err = 'true';
        msg.textContent = e.message;
      });
  }

  /* Images get shrunk on the way in; PDFs go through as they are. */
  function readForUpload(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onerror = function () { reject(new Error('Could not read ' + file.name)); };
      fr.onload = function () {
        if (!/^image\//.test(file.type)) { resolve(fr.result); return; }
        var img = new Image();
        img.onerror = function () { reject(new Error(file.name + ' is not a readable image')); };
        img.onload = function () {
          var max = 1600, w = img.width, h = img.height;
          if (w > max || h > max) { var k = max / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          c.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  function toDataUrl(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res) {
        var fr = new FileReader();
        fr.onload = function () { res(fr.result); };
        fr.onerror = function () { res(null); };
        fr.readAsDataURL(b);
      });
    }).catch(function () { return null; });
  }

  /* One self-contained file: the full terms followed by the signed record. */
  function agreementFile(d) {
    var a = d.a;
    var rows = detailRows(a).map(function (r) {
      var v = r[1];
      if (/data-docsig/.test(v)) {
        v = d.sig
          ? '<img class="sig" src="' + d.sig + '" alt="Signature">'
          : d.sigUrl
            ? '<img class="sig" src="' + d.sigUrl + '" alt="Signature">'
            : '<span class="doc-sig typed">' + esc(a.buyer_name) + '</span>';
      }
      return '<tr><td>' + r[0] + '</td><td>' + v + '</td></tr>';
    }).join('');
    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<title>' + esc(a.buyer_name) + ' — signed agreement</title><style>' +
      'body{font:11pt/1.45 Arial,sans-serif;color:#111;background:#fff;margin:0 auto;padding:32px;max-width:760px}' +
      'h1{font-size:18pt;margin:0 0 4px}h2{font-size:13pt;margin:0 0 4px}' +
      'h3{font-size:11pt;margin:18px 0 0}' +
      '.sub{font-size:10.5pt;margin:0 0 18px}p{margin:5px 0 0}' +
      'ul{margin:6px 0 0;padding-left:22px}' +
      'table{border-collapse:collapse;width:100%;margin-top:20px}' +
      'td{padding:5px 0;vertical-align:top}td:first-child{width:215px;font-weight:700}' +
      '.sig,.doc-sig{display:block;max-width:300px;max-height:100px;object-fit:contain;background:transparent;border:0;padding:0}' +
      '.doc-sig.typed{font:700 22px/1 Georgia,serif}' +
      '.agreement-terms{display:grid;grid-template-columns:1fr 1fr;gap:20px;align-items:start}' +
      '.rule{height:1px;background:#bbb;margin:24px 0}' +
      '@media print{body{padding:0}.rule{display:none}' +
        '.agreement-record{break-before:page;page-break-before:always}}' +
      '</style></head><body>' +
      '<h1>Project package — Terms &amp; Conditions</h1>' +
      '<p class="sub">Please read before purchasing or receiving the project files.</p>' +
      '<section class="agreement-terms">' + (state.terms || '') + '</section>' +
      '<div class="rule"></div>' +
      '<section class="agreement-record"><h2>Signed record</h2>' +
      '<table>' + rows + '</table></section>' +
      '</body></html>';
  }

  function docBlob() {
    var d = state.doc;
    if (!d) return Promise.resolve(null);
    if (d.sig || !d.a.signature_path) {
      return Promise.resolve(new Blob([agreementFile(d)], { type: 'text/html' }));
    }
    var msg = $('#docMsg'), was = msg.innerHTML;
    msg.textContent = 'Fetching the signature…';
    var sigP = !d.a.signature_path || d.sig
      ? Promise.resolve(d.sig)
      : (d.sigUrl ? Promise.resolve(d.sigUrl) : B.signedUrl('signatures', d.a.signature_path, 3600))
          .then(function (url) { d.sigUrl = url; return toDataUrl(url); });
    return sigP.then(function (signature) {
      d.sig = signature;
      msg.innerHTML = was;
      return new Blob([agreementFile(d)], { type: 'text/html' });
    }).catch(function () {
      msg.innerHTML = was;
      return new Blob([agreementFile(d)], { type: 'text/html' });
    });
  }

  $$('[data-close-doc]').forEach(function (el) {
    el.addEventListener('click', function () {
      $('#docOverlay').dataset.open = 'false';
      document.body.classList.remove('modal-open');
      state.doc = null;
    });
  });
  $('#docOverlay').addEventListener('mousedown', function (e) {
    if (e.target === $('#docOverlay')) { $('[data-close-doc]').click(); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && $('#docOverlay').dataset.open === 'true') $('[data-close-doc]').click();
  });
  function createAdminPdf(download) {
    var record = state.doc;
    if (!record) return;
    var viewer = download ? null : (window.PdfTools && window.PdfTools.openViewer());
    var openBtn = $('#docOpen'), downloadBtn = $('#docDownload');
    openBtn.disabled = true;
    downloadBtn.disabled = true;
    $('#docMsg').textContent = 'Preparing the signed agreement PDF…';
    var tool = window.PdfTools;
    var job = tool
      ? docBlob().then(function (htmlBlob) { return htmlBlob.text(); }).then(tool.fromHtml)
      : Promise.reject(new Error('The PDF tool did not load. Refresh the page and try again.'));
    job.then(function (result) {
      var buyer = (record.a.buyer_name || 'buyer').replace(/[^A-Za-z0-9]+/g, '-');
      var filename = 'JUDECH-' + buyer + '-agreement.pdf';
      if (download) {
        tool.download(result.blob, filename);
        $('#docMsg').textContent = 'PDF downloaded.';
      } else if (tool.openInTab(result, filename, viewer)) {
        $('#docMsg').textContent = 'PDF opened in a new tab.';
      } else {
        tool.download(result.blob, filename);
        $('#docMsg').textContent = 'Your browser blocked the new tab, so the PDF was downloaded.';
      }
    }).catch(function (e) {
      if (viewer) viewer.close();
      $('#docMsg').textContent = e.message || 'Could not create the PDF.';
    }).then(function () {
      openBtn.disabled = false;
      downloadBtn.disabled = false;
    });
  }
  $('#docOpen').addEventListener('click', function () { createAdminPdf(false); });
  $('#docDownload').addEventListener('click', function () { createAdminPdf(true); });

  boot();
})();
