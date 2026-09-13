/* JUDECH — the browser's door to Supabase
   ---------------------------------------------------------------------------
   Loaded by index.html and admin.html after js/config.js and the supabase-js
   UMD build. If the config is empty or the library failed to load, `enabled`
   is false and the project page falls back to its local, code-based gate.

   Everything a buyer can do goes through the four RPCs created in
   supabase/migrations — never a direct table write. The admin calls need a
   signed-in user who is listed in public.admins.
   --------------------------------------------------------------------------- */
(function () {
  'use strict';

  var cfg = window.JUDECH_CONFIG || {};
  var lib = window.supabase;
  var enabled = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && lib && lib.createClient);
  var client = enabled ? lib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;

  /* ---------- small helpers ---------- */
  function unwrap(res) {
    if (!res) throw new Error('No response from the server.');
    if (res.error) throw new Error(friendly(res.error));
    return res.data;
  }
  function friendly(err) {
    var m = (err && (err.message || err.error_description || err.msg)) || String(err);
    // PostgREST wraps our raise exception messages; keep just the human part
    return m.replace(/^.*?:\s*(?=[a-z])/i, '').trim() || 'Something went wrong.';
  }
  function first(data) {
    if (Array.isArray(data)) return data[0] || null;
    return data || null;
  }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function dataUrlToBlob(dataUrl) {
    var m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) throw new Error('That is not an image.');
    var mime = m[1] || 'application/octet-stream';
    var bytes;
    if (m[2]) {
      var bin = atob(m[3]);
      bytes = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(m[3]));
    }
    return new Blob([bytes], { type: mime });
  }
  function extFor(mime) {
    return { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime] || 'bin';
  }
  function parseAmount(text) {
    var n = parseFloat(String(text || '').replace(/[^0-9.]/g, ''));
    return isNaN(n) ? null : Math.round(n * 100) / 100;
  }
  function need() {
    if (!enabled) throw new Error('Supabase is not configured on this page.');
  }

  /* ---------- storage ---------- */
  function upload(bucket, dataUrl) {
    need();
    var blob = dataUrlToBlob(dataUrl);
    var d = new Date();
    var path = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' +
      uuid() + '.' + extFor(blob.type);
    return client.storage.from(bucket).upload(path, blob, { contentType: blob.type, upsert: false })
      .then(unwrap)
      .then(function () { return path; });
  }

  function signedUrl(bucket, path, seconds) {
    need();
    if (!path) return Promise.resolve(null);
    return client.storage.from(bucket).createSignedUrl(path, seconds || 3600)
      .then(unwrap)
      .then(function (d) { return d && d.signedUrl; });
  }

  /* ---------- buyer side (anon) ---------- */
  function submitPayment(p) {
    need();
    return client.rpc('submit_payment', {
      p_project_id: p.projectId,
      p_buyer_name: p.name,
      p_method: p.method,
      p_reference: p.reference,
      p_amount: parseAmount(p.amount),
      p_paid_on: p.paidOn,
      p_receipt_path: p.receiptPath || null,
      p_buyer_contact: p.contact || null,
      p_scope: p.scope === 'items' ? 'items' : 'package',
      p_item_ids: p.scope === 'items' && p.itemIds && p.itemIds.length ? p.itemIds : null,
      p_share_token: p.shareToken || null
    }).then(unwrap).then(first);
  }

  function paymentStatus(token) {
    need();
    return client.rpc('payment_status', { p_claim_token: token }).then(unwrap).then(first);
  }

  /* Which items of the package are open for this buyer yet. Empty until the
     payment is approved — the page keeps everything shut in the meantime. */
  function packageAccess(token) {
    need();
    return client.rpc('package_access', { p_claim_token: token }).then(unwrap)
      .then(function (rows) { return rows || []; });
  }

  /* One buyer, several purchases of the same project — the diagram in June, the
     code in August. Ask about every claim token they hold at once. */
  function packageAccessAll(tokens) {
    need();
    var list = (tokens || []).filter(Boolean);
    if (!list.length) return Promise.resolve([]);
    if (list.length === 1) return packageAccess(list[0]);
    return client.rpc('package_access_all', { p_claim_tokens: list }).then(unwrap)
      .then(function (rows) { return rows || []; });
  }

  /* ---------- a private offer for one customer ---------- */
  function projectShare(token) {
    need();
    return client.rpc('project_share', { p_token: token }).then(unwrap).then(first);
  }

  /* The receipt can follow the reference number: same claim token, same payment,
     any time before it is approved. */
  function attachReceipt(token, dataUrl) {
    need();
    return upload('receipts', dataUrl).then(function (path) {
      return client.rpc('attach_receipt', {
        p_claim_token: token,
        p_receipt_path: path
      }).then(unwrap).then(first);
    });
  }

  function redeemCode(code, name) {
    need();
    return client.rpc('redeem_access_code', { p_code: code, p_buyer_name: name || null })
      .then(unwrap).then(first);
  }

  function signAgreement(a) {
    need();
    return client.rpc('sign_agreement', {
      p_claim_token: a.token,
      p_buyer_name: a.name,
      p_signature_type: a.type,
      p_signature_path: a.signaturePath || null,
      p_signature_text: a.signatureText || null,
      p_signed_on: a.signedOn,
      p_user_agent: navigator.userAgent.slice(0, 400),
      p_buyer_type: a.buyerType || null,
      p_school: a.school || null,
      p_location: a.location || null
    }).then(unwrap);
  }

  /* ---------- who is signed in ---------- */
  function signInWithGoogle(returnTo) {
    need();
    return client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: returnTo || location.href.split('#')[0],
        queryParams: { prompt: 'select_account' }
      }
    }).then(unwrap);
  }
  function user() {
    need();
    return client.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s || !s.user) return null;
      var u = s.user, m = u.user_metadata || {};
      return {
        id: u.id,
        email: u.email || m.email || '',
        name: m.full_name || m.name || (u.email || '').split('@')[0],
        avatar: m.avatar_url || m.picture || '',
        provider: (u.app_metadata && u.app_metadata.provider) || 'email'
      };
    });
  }

  /* ---------- admin side (signed in) ---------- */
  function signIn(email, password) {
    need();
    return client.auth.signInWithPassword({ email: email, password: password }).then(unwrap);
  }
  function signOut() { need(); return client.auth.signOut(); }
  function session() {
    need();
    return client.auth.getSession().then(function (r) { return r.data && r.data.session; });
  }
  function onAuth(fn) { need(); return client.auth.onAuthStateChange(function (ev, s) { fn(s); }); }
  function recordPresence(event) {
    need();
    return client.rpc('record_presence', { p_event: event || 'heartbeat' }).then(unwrap);
  }
  /* ---------- the heartbeat that keeps a free project awake ---------- */
  function heartbeat(source) {
    need();
    return client.rpc('heartbeat', { p_source: source || 'admin' }).then(unwrap);
  }
  function heartbeatStatus() {
    need();
    return client.rpc('heartbeat_status', {}).then(unwrap);
  }

  /* ---------- people, and whether they are blocked ---------- */
  function userDirectory() {
    need();
    return client.from('user_directory').select('*')
      .order('is_active', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .then(unwrap);
  }
  function setUserBlock(userId, blocked, reason, hours) {
    need();
    return client.rpc('set_user_block', {
      p_user_id: userId,
      p_blocked: !!blocked,
      p_reason: reason || null,
      p_hours: hours || null
    }).then(unwrap).then(first);
  }
  function amIBlocked() {
    need();
    return client.rpc('is_blocked', {}).then(unwrap).then(function (d) { return d === true; });
  }

  function userActivity() {
    need();
    return client.from('user_activity').select('*')
      .order('is_active', { ascending: false })
      .order('last_seen_at', { ascending: false })
      .then(unwrap);
  }
  function sendMessage(title, message) {
    need();
    return client.rpc('send_contact_message', {
      p_title: title,
      p_message: message
    }).then(unwrap);
  }
  function messageThreads() {
    need();
    return client.from('contact_messages').select('*')
      .order('updated_at', { ascending: false }).then(unwrap).then(function (threads) {
        if (!threads.length) return threads;
        return client.from('contact_message_entries').select('*')
          .in('conversation_id', threads.map(function (m) { return m.id; }))
          .order('created_at', { ascending: true }).then(unwrap).then(function (entries) {
            var grouped = {};
            entries.forEach(function (entry) {
              (grouped[entry.conversation_id] || (grouped[entry.conversation_id] = [])).push(entry);
            });
            threads.forEach(function (thread) { thread.entries = grouped[thread.id] || []; });
            return threads;
          });
      });
  }
  function myMessages() {
    return messageThreads();
  }
  function adminMessages() {
    return messageThreads();
  }
  function replyMessage(id, reply) {
    need();
    return client.rpc('reply_contact_message', { p_id: id, p_reply: reply })
      .then(unwrap).then(first);
  }
  function addMessageEntry(conversationId, message) {
    need();
    return client.rpc('send_contact_message_entry', {
      p_conversation_id: conversationId,
      p_message: message
    }).then(unwrap).then(first);
  }
  function updateMessageEntry(entryId, message) {
    need();
    return client.rpc('update_contact_message_entry', {
      p_entry_id: entryId,
      p_message: message
    }).then(unwrap).then(first);
  }
  function markMessageRead(conversationId) {
    need();
    return client.rpc('mark_contact_conversation_read', {
      p_conversation_id: conversationId
    }).then(unwrap);
  }
  function deleteMessageEntry(entryId) {
    need();
    return client.rpc('delete_contact_message_entry', { p_entry_id: entryId }).then(unwrap);
  }
  function deleteMessageConversation(conversationId) {
    need();
    return client.rpc('delete_contact_conversation', {
      p_conversation_id: conversationId
    }).then(unwrap);
  }
  function isAdmin() { need(); return client.rpc('is_admin').then(unwrap).then(function (d) { return d === true; }); }

  function inbox(status) {
    need();
    var q = client.from('payments_inbox').select('*');
    if (status && status !== 'all') q = q.eq('status', status);
    return q.then(unwrap);
  }
  function approve(id, note) {
    need();
    return client.rpc('approve_payment', { p_id: id, p_note: note || null }).then(unwrap).then(first);
  }
  function reject(id, note) {
    need();
    return client.rpc('reject_payment', { p_id: id, p_note: note || null }).then(unwrap).then(first);
  }
  /* ---------- staged package release (admin) ---------- */
  function packageAccessRows(paymentIds) {
    need();
    var q = client.from('payment_package_access').select('*');
    if (paymentIds && paymentIds.length) q = q.in('payment_id', paymentIds);
    return q.then(unwrap).then(function (rows) {
      return (rows || []).slice().sort(function (a, b) {
        return (a.item_position || 0) - (b.item_position || 0);
      });
    });
  }
  function setPackageAccess(paymentId, itemIds, state, note) {
    need();
    return client.rpc('set_package_access', {
      p_payment_id: paymentId,
      p_item_ids: itemIds,
      p_state: state,
      p_note: note || null
    }).then(unwrap);
  }
  function projectPackageItems(projectId) {
    need();
    return client.rpc('project_package_items', { p_project_id: projectId })
      .then(unwrap).then(function (rows) {
        return (rows || []).slice().sort(function (a, b) {
          return (a.item_position || 0) - (b.item_position || 0);
        });
      });
  }

  /* ---------- proof of legitimacy ---------- */
  function proofs(all) {
    need();
    var q = client.from('proofs').select('*')
      .order('position', { ascending: true })
      .order('created_at', { ascending: false });
    if (!all) q = q.eq('published', true);
    return q.then(unwrap);
  }
  function saveProof(row) {
    need();
    return client.from('proofs').upsert(row).select().then(unwrap).then(first);
  }
  function deleteProof(id) {
    need();
    return client.from('proofs').delete().eq('id', id).then(unwrap);
  }

  function projectShares(projectId) {
    need();
    var q = client.from('project_shares_list').select('*');
    if (projectId) q = q.eq('project_id', projectId);
    return q.then(unwrap);
  }
  function createProjectShare(s) {
    need();
    return client.rpc('create_project_share', {
      p_project_id: s.projectId,
      p_customer_name: s.customerName,
      p_item_ids: s.itemIds && s.itemIds.length ? s.itemIds : null,
      p_prices: s.prices || {},
      p_package_price: s.packagePrice == null ? null : Number(s.packagePrice),
      p_headline: s.headline || null,
      p_customer_note: s.note || null,
      p_expires_days: s.expiresDays || null
    }).then(unwrap).then(first);
  }
  function revokeProjectShare(id) {
    need();
    return client.rpc('revoke_project_share', { p_id: id }).then(unwrap).then(first);
  }

  function grants() { need(); return client.from('access_grants_list').select('*').then(unwrap); }
  function createGrant(g) {
    need();
    return client.rpc('create_access_grant', {
      p_project_id: g.projectId,
      p_buyer_name: g.name,
      p_channel: g.channel,
      p_note: g.note || null,
      p_expires_days: g.expiresDays || null,
      p_item_ids: g.itemIds && g.itemIds.length ? g.itemIds : null
    }).then(unwrap).then(first);
  }
  function revokeGrant(id, note) {
    need();
    return client.rpc('revoke_access_grant', { p_id: id, p_note: note || null }).then(unwrap).then(first);
  }
  /* ---------- supporting files on an agreement (admin only) ---------- */
  function attachments(agreementId) {
    need();
    return client.from('agreement_attachments').select('*')
      .eq('agreement_id', agreementId)
      .order('created_at', { ascending: true })
      .then(unwrap);
  }
  function attachmentCounts() {
    need();
    return client.from('agreement_attachments').select('agreement_id').then(unwrap)
      .then(function (rows) {
        var out = {};
        (rows || []).forEach(function (r) { out[r.agreement_id] = (out[r.agreement_id] || 0) + 1; });
        return out;
      });
  }
  function addAttachment(a) {
    need();
    return upload('attachments', a.dataUrl).then(function (path) {
      return client.from('agreement_attachments').insert({
        agreement_id: a.agreementId,
        path: path,
        mime: dataUrlToBlob(a.dataUrl).type,
        caption: a.caption || null,
        kind: a.kind || 'support',
        added_by: a.userId || null
      }).select().then(unwrap).then(first);
    });
  }
  function removeAttachment(row) {
    need();
    return client.from('agreement_attachments').delete().eq('id', row.id).then(unwrap)
      .then(function () { return client.storage.from('attachments').remove([row.path]); })
      .catch(function (e) { throw e; });
  }

  function agreements() {
    need();
    return client.from('agreements').select('*').order('accepted_at', { ascending: false }).then(unwrap);
  }
  function projects() {
    need();
    return client.from('projects').select('*').order('position', { ascending: true }).then(unwrap);
  }
  function heroSlides() {
    need();
    return client.from('hero_slides').select('*').then(unwrap);
  }
  function saveHeroSlide(row) {
    need();
    return client.from('hero_slides').upsert(row, { onConflict: 'slide_key' })
      .select().then(unwrap).then(first);
  }
  function resetHeroSlide(key) {
    need();
    return client.from('hero_slides').delete().eq('slide_key', key).then(unwrap);
  }
  function saveProject(row) {
    need();
    return client.from('projects').upsert(row, { onConflict: 'id' }).select().then(unwrap).then(first);
  }
  function deleteProject(id) {
    need();
    return client.from('projects').delete().eq('id', id).then(unwrap);
  }
  /* Project assets live in a public bucket — same as the files the site already
     serves from disk — so a buyer's browser can fetch them without a signed URL. */
  function uploadProjectFile(file, name, limit) {
    need();
    if (!file) return Promise.reject(new Error('Choose a file to upload.'));
    var cap = limit || 25 * 1024 * 1024;
    if (file.size > cap) {
      return Promise.reject(new Error('That file is ' + Math.ceil(file.size / 1048576) +
        ' MB — the limit here is ' + Math.round(cap / 1048576) + ' MB.'));
    }
    var clean = String(name || file.name || 'file')
      .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-80) || 'file';
    var path = uuid().slice(0, 8) + '-' + clean;
    return client.storage.from('project-files')
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
      .then(unwrap)
      .then(function () {
        var r = client.storage.from('project-files').getPublicUrl(path);
        return { path: path, url: (r && r.data && r.data.publicUrl) || path };
      });
  }

  function uploadProjectImage(file) {
    if (!file || !/^image\/(jpeg|png|webp|gif)$/i.test(file.type || '')) {
      return Promise.reject(new Error('Choose a JPG, PNG, WebP or GIF image.'));
    }
    if (file.size > 8 * 1024 * 1024) {
      return Promise.reject(new Error('The project image must be 8 MB or smaller.'));
    }
    return uploadProjectFile(file, 'cover-' + (file.name || 'project-image'));
  }
  /* Proof files: photos, and short clips straight off a phone. 64 MB, which is
     also what the bucket allows — the Supabase project's own upload ceiling has
     to be at least this or the request is refused before it reaches us. */
  var PROOF_MAX = 64 * 1024 * 1024;
  function uploadProofFile(file) {
    if (!file) return Promise.reject(new Error('Choose a file to upload.'));
    var type = file.type || '';
    if (!/^(image\/(jpeg|png|webp|gif)|video\/(mp4|webm|quicktime|x-m4v|ogg))$/i.test(type)) {
      return Promise.reject(new Error('Photos (JPG, PNG, WebP, GIF) and videos (MP4, WebM, MOV) only.'));
    }
    if (file.size > PROOF_MAX) {
      return Promise.reject(new Error('That file is ' + Math.ceil(file.size / 1048576) +
        ' MB — the limit is 64 MB. Compress it, or put it on YouTube and paste the link.'));
    }
    return uploadProjectFile(file, 'proof-' + (file.name || 'file'), PROOF_MAX);
  }

  function uploadHeroImage(file) {
    if (!file || !/^image\/(jpeg|png|webp|gif)$/i.test(file.type || '')) {
      return Promise.reject(new Error('Choose a JPG, PNG, WebP or GIF image.'));
    }
    if (file.size > 8 * 1024 * 1024) {
      return Promise.reject(new Error('The slideshow image must be 8 MB or smaller.'));
    }
    return uploadProjectFile(file, 'hero-' + (file.name || 'slideshow-image'));
  }

  window.Backend = {
    enabled: enabled,
    client: client,
    uuid: uuid,
    parseAmount: parseAmount,
    dataUrlToBlob: dataUrlToBlob,
    uploadReceipt: function (dataUrl) { return upload('receipts', dataUrl); },
    uploadSignature: function (dataUrl) { return upload('signatures', dataUrl); },
    signedUrl: signedUrl,
    submitPayment: submitPayment,
    paymentStatus: paymentStatus,
    packageAccess: packageAccess,
    attachReceipt: attachReceipt,
    packageAccessAll: packageAccessAll,
    projectShare: projectShare,
    redeemCode: redeemCode,
    signAgreement: signAgreement,
    signIn: signIn,
    signInWithGoogle: signInWithGoogle,
    user: user,
    signOut: signOut,
    session: session,
    onAuth: onAuth,
    recordPresence: recordPresence,
    userActivity: userActivity,
    heartbeat: heartbeat,
    heartbeatStatus: heartbeatStatus,
    userDirectory: userDirectory,
    setUserBlock: setUserBlock,
    amIBlocked: amIBlocked,
    sendMessage: sendMessage,
    myMessages: myMessages,
    adminMessages: adminMessages,
    replyMessage: replyMessage,
    addMessageEntry: addMessageEntry,
    updateMessageEntry: updateMessageEntry,
    markMessageRead: markMessageRead,
    deleteMessageEntry: deleteMessageEntry,
    deleteMessageConversation: deleteMessageConversation,
    isAdmin: isAdmin,
    inbox: inbox,
    approve: approve,
    reject: reject,
    packageAccessRows: packageAccessRows,
    proofs: proofs,
    saveProof: saveProof,
    deleteProof: deleteProof,
    projectShares: projectShares,
    createProjectShare: createProjectShare,
    revokeProjectShare: revokeProjectShare,
    setPackageAccess: setPackageAccess,
    projectPackageItems: projectPackageItems,
    grants: grants,
    createGrant: createGrant,
    revokeGrant: revokeGrant,
    agreements: agreements,
    heroSlides: heroSlides,
    saveHeroSlide: saveHeroSlide,
    resetHeroSlide: resetHeroSlide,
    projects: projects,
    saveProject: saveProject,
    deleteProject: deleteProject,
    uploadProjectFile: uploadProjectFile,
    uploadProjectImage: uploadProjectImage,
    uploadProofFile: uploadProofFile,
    uploadHeroImage: uploadHeroImage,
    attachments: attachments,
    attachmentCounts: attachmentCounts,
    addAttachment: addAttachment,
    removeAttachment: removeAttachment
  };
})();
