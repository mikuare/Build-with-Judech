/* JUDECH — client-side PDF export shared by the buyer and admin pages.

   The signed agreement always carries the full Terms & Conditions with it. The
   export lays it out as a short document: the thirteen sections balanced across
   two columns on the first page, then the signed record — parties, acknowledgment
   and signature — on a page of its own. */
(function () {
  'use strict';

  /* A4 portrait with the margins set in fromHtml() below. */
  var PAGE = { width: 210, height: 297, margin: 8 };
  /* Type sizes tried for the terms, largest first: the first one whose taller
     column still fits the first page wins. */
  var TERMS_SIZES = [8.4, 8, 7.6, 7.2, 6.8, 6.4, 6];

  function needLibrary() {
    if (!window.html2pdf) {
      throw new Error('The PDF tool did not load. Check your connection, refresh the page, and try again.');
    }
  }

  function waitForImages(root) {
    var images = Array.prototype.slice.call(root.querySelectorAll('img'));
    return Promise.all(images.map(function (img) {
      if (img.complete) return Promise.resolve();
      return new Promise(function (resolve) {
        var finish = function () { resolve(); };
        img.addEventListener('load', finish, { once: true });
        img.addEventListener('error', finish, { once: true });
        setTimeout(finish, 5000);
      });
    }));
  }

  /* html2pdf reflows the copy it prints to the page's printable width, so the sheet
     we measure is built at that same width — otherwise the columns come out taller
     in the PDF than they measured here and spill onto an extra page. */
  function sheetWidth() { return (PAGE.width - PAGE.margin * 2) + 'mm'; }

  function pageHeightPx(root) {
    var printable = PAGE.width - PAGE.margin * 2;
    return root.offsetWidth / printable * (PAGE.height - PAGE.margin * 2);
  }

  /* The terms are written as two hand-split columns. The split was chosen for the
     screen, where the modal scrolls; on a fixed page it leaves one column long and
     the other short, which forces the type smaller than it needs to be. Re-flow the
     sections across the two columns so both run to about the same depth, keeping
     each heading with the text that belongs to it. */
  function balanceTerms(root) {
    var section = root.querySelector('.agreement-terms');
    if (!section) return;
    var columns = section.querySelectorAll('.terms-col');
    if (columns.length !== 2) return;
    var left = columns[0], right = columns[1];

    var groups = [], current = null;
    Array.prototype.forEach.call(columns, function (column) {
      Array.prototype.slice.call(column.children).forEach(function (el) {
        if (!current || /^H[1-6]$/.test(el.tagName)) { current = []; groups.push(current); }
        current.push(el);
      });
    });
    if (groups.length < 2) return;

    groups.forEach(function (group) {
      group.forEach(function (el) { left.appendChild(el); });
    });

    var heights = groups.map(function (group) {
      return group.reduce(function (sum, el) {
        var style = window.getComputedStyle(el);
        return sum + el.offsetHeight + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
      }, 0);
    });
    var total = heights.reduce(function (a, b) { return a + b; }, 0);

    /* Cut where the two halves come out closest to even, but never so early that a
       column is left empty. */
    var running = 0, best = 1, bestGap = Infinity;
    for (var i = 1; i < groups.length; i++) {
      running += heights[i - 1];
      var gap = Math.abs(running - (total - running));
      if (gap < bestGap) { bestGap = gap; best = i; }
    }
    for (var j = best; j < groups.length; j++) {
      groups[j].forEach(function (el) { right.appendChild(el); });
    }
  }

  /* Shrink the terms only as far as they have to go to land on one page. */
  function fitTerms(root) {
    var section = root.querySelector('.agreement-terms');
    if (!section) return;
    var budget = pageHeightPx(root) - parseFloat(window.getComputedStyle(root).paddingBottom || 0);
    for (var i = 0; i < TERMS_SIZES.length; i++) {
      root.style.setProperty('--terms-size', TERMS_SIZES[i] + 'pt');
      balanceTerms(root);
      var used = section.getBoundingClientRect().bottom - root.getBoundingClientRect().top;
      if (used <= budget) return;
    }
  }

  /* The signed record starts its own page (pagebreak.before in fromHtml), so the
     divider that separates it from the terms on screen has nothing left to divide. */
  function dropRecordRule(root) {
    var record = root.querySelector('.agreement-record');
    if (!record) return;
    var rule = record.previousElementSibling;
    if (rule && rule.classList.contains('rule')) rule.remove();
  }

  /* "View PDF" opens its tab before the work starts, which pushes this page into the
     background — and a background tab's requestAnimationFrame is throttled to a
     standstill, so anything that waits on a frame waits forever. Take a frame when one
     arrives, but never depend on one. */
  function afterLayout() {
    return new Promise(function (resolve) {
      var settled = false;
      function finish() { if (!settled) { settled = true; resolve(); } }
      if (window.requestAnimationFrame) {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () { setTimeout(finish, 60); });
        });
      }
      setTimeout(finish, 250);
    });
  }

  function renderDocument(html) {
    var parsed = new DOMParser().parseFromString(html, 'text/html');
    var host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    /* Off-screen, not on top of the page: this sheet only exists to be measured, and
       html2pdf prints its own copy of it. Parking it at 0,0 made it flash over the
       page for as long as the export took. */
    host.style.cssText = 'position:fixed;left:-100000px;top:0;z-index:-1;width:' + sheetWidth() + ';' +
      'min-height:100vh;pointer-events:none;overflow:visible;background:#fff';
    var root = document.createElement('article');
    root.className = 'judech-pdf-export';
    root.innerHTML = parsed.body ? parsed.body.innerHTML : html;
    /* Keep positioning on the host, not the sheet passed to html2pdf. The library
       clones the source element; a fixed/absolute source becomes height zero in
       its print container and produces a blank PDF. */

    var style = document.createElement('style');
    style.dataset.pdfExportStyle = 'true';
    style.textContent =
      '.judech-pdf-export,.judech-pdf-export *{box-sizing:border-box}' +
      '.judech-pdf-export{--terms-size:8.4pt;font-family:Arial,sans-serif;' +
        'font-size:var(--terms-size);line-height:1.3;color:#111;background:#fff;padding:0;margin:0}' +
      '.judech-pdf-export h1{font-size:14pt;line-height:1.2;margin:0 0 2px;color:#111}' +
      '.judech-pdf-export h2{font-size:12pt;line-height:1.2;margin:0 0 6px;color:#111}' +
      '.judech-pdf-export h3{font-size:1.05em;line-height:1.2;' +
        'margin:6px 0 0;color:#111;break-after:avoid;page-break-after:avoid}' +
      '.judech-pdf-export .sub,.judech-pdf-export .muted{color:#111;font-size:9pt}' +
      '.judech-pdf-export .sub{margin:0 0 10px}' +
      '.judech-pdf-export .agreement-terms{display:grid;grid-template-columns:1fr 1fr;' +
        'gap:16px;align-items:start}' +
      '.judech-pdf-export .terms-col+.terms-col{border-left:1px solid #ddd;padding-left:14px}' +
      '.judech-pdf-export .agreement-terms p{margin:3px 0 0;color:#111}' +
      '.judech-pdf-export .agreement-terms ul{margin:3px 0 0;padding-left:13px;color:#111}' +
      '.judech-pdf-export .agreement-terms li{margin-top:1px}' +
      '.judech-pdf-export .agreement-record{font-size:10pt;line-height:1.4}' +
      '.judech-pdf-export table{border-collapse:collapse;width:100%;margin-top:6px}' +
      '.judech-pdf-export td,.judech-pdf-export th{padding:4px 0;border:0;' +
        'vertical-align:top;text-align:left}' +
      '.judech-pdf-export td:first-child{width:210px;color:#111;font-weight:700}' +
      '.judech-pdf-export .sig,.judech-pdf-export .sigline,.judech-pdf-export .doc-sig{' +
        'display:block;max-width:300px;max-height:90px;background:transparent;border:0;' +
        'padding:0;object-fit:contain}' +
      '.judech-pdf-export .sigline.typed,.judech-pdf-export .doc-sig.typed{' +
        'font:700 22px/1.1 Georgia,serif;border:0;padding:1px;background:transparent}' +
      '.judech-pdf-export .rule{height:1px;background:#bbb;margin:14px 0}' +
      '.judech-pdf-export table,.judech-pdf-export tr,.judech-pdf-export img,' +
        '.judech-pdf-export .agreement-fields{' +
        'break-inside:avoid;page-break-inside:avoid}' +
      '.judech-pdf-export a{color:#111;text-decoration:underline}';
    document.head.appendChild(style);
    host.appendChild(root);
    document.body.appendChild(host);
    var fonts = document.fonts && document.fonts.ready
      ? document.fonts.ready.catch(function () {})
      : Promise.resolve();
    return Promise.all([fonts, waitForImages(root)]).then(function () {
      fitTerms(root);
      dropRecordRule(root);
      return afterLayout().then(function () {
        return { host: host, root: root, style: style };
      });
    });
  }

  /* html2pdf paints the whole sheet onto one tall canvas and then cuts it into pages.
     Cut it the same way ourselves so the viewer can show the real pages as plain
     images — see openInTab for why that beats embedding the PDF. */
  function slicePages(canvas) {
    var ratio = (PAGE.height - PAGE.margin * 2) / (PAGE.width - PAGE.margin * 2);
    var pageHeight = Math.floor(canvas.width * ratio);
    var count = Math.max(1, Math.ceil(canvas.height / pageHeight));
    var pages = [];
    for (var i = 0; i < count; i++) {
      var tail = canvas.height % pageHeight;
      var height = (i === count - 1 && tail) ? tail : pageHeight;
      var sheet = document.createElement('canvas');
      sheet.width = canvas.width;
      sheet.height = height;
      var ctx = sheet.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sheet.width, height);
      ctx.drawImage(canvas, 0, i * pageHeight, sheet.width, height, 0, 0, sheet.width, height);
      pages.push(sheet.toDataURL('image/jpeg', 0.82));
    }
    return pages;
  }

  function fromHtml(html) {
    try { needLibrary(); }
    catch (e) { return Promise.reject(e); }
    return renderDocument(html).then(function (rendered) {
      var pages = [];
      /* html2pdf prints from a copy it places in a position:fixed overlay at the top
         of the viewport, and html2canvas captures that copy from a clone of the whole
         page scrolled to the page's current scroll position. The agreement modal locks
         the page with body{overflow:hidden}, and the clone cannot be scrolled while it
         is locked — so with the page scrolled down (it always is by the time someone
         has opened a project) the capture lands on the wrong region and comes back
         solid white. Pin the capture origin to the viewport origin, where the copy is. */
      return window.html2pdf().set({
        margin: [PAGE.margin, PAGE.margin, PAGE.margin, PAGE.margin],
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff',
          scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait', compress: true },
        pagebreak: { mode: ['css', 'legacy'], before: ['.agreement-record'] }
      }).from(rendered.root).toCanvas().get('canvas').then(function (canvas) {
        pages = slicePages(canvas);
      }).toPdf().outputPdf('blob')
        .then(function (blob) {
          rendered.host.remove();
          rendered.style.remove();
          return { blob: blob, pages: pages };
        }, function (error) {
          rendered.host.remove();
          rendered.style.remove();
          throw error;
        });
    });
  }

  function esc(value) {
    return String(value).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  var SHELL_CSS =
    'html,body{margin:0;min-height:100%;background:#525659;' +
      'font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    'header{position:sticky;top:0;display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;' +
      'padding:10px 14px;background:#2f3234;color:#fff}' +
    'header b{font-weight:700}header a{color:#fff}header small{color:#c9ccce}' +
    '#pages{padding:16px 12px;display:flex;flex-direction:column;align-items:center;gap:16px}' +
    '#pages figure{margin:0;width:100%;max-width:900px}' +
    '#pages figcaption{color:#c9ccce;font-size:12px;padding:0 0 4px}' +
    '#pages img{display:block;width:100%;height:auto;background:#fff;' +
      'box-shadow:0 2px 10px rgba(0,0,0,.45)}' +
    'p.wait{color:#e6e8ea;padding:24px 16px;text-align:center}';

  function writeShell(win, title, body) {
    try {
      win.document.open();
      win.document.write('<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>' + esc(title) + '</title><style>' + SHELL_CSS + '</style></head><body>' +
        body + '</body></html>');
      win.document.close();
      return true;
    } catch (e) { return false; }
  }

  /* Open the tab inside the click that asked for it — a tab opened later is a popup,
     and gets blocked — but give it something to say while the PDF is being built. */
  function openViewer() {
    var win = window.open('', '_blank');
    if (!win) return null;
    writeShell(win, 'Preparing the signed agreement…',
      '<p class="wait">Preparing the signed agreement PDF…</p>');
    return win;
  }

  /* Showing the PDF itself — as a blob: URL, in a tab or a frame — only works when the
     browser has a PDF viewer and is willing to use it there. Plenty are not: mobile
     Chrome and Safari, anything set to "download PDFs instead of opening them", and
     headless or locked-down builds all render nothing at all, which is what a blank
     page is. So show the pages we already rendered, as images, which every browser
     can draw — and keep the real PDF one click away on the Download link. */
  function openInTab(doc, filename, viewer) {
    var win = viewer || window.open('', '_blank');
    if (!win) return false;
    var url = URL.createObjectURL(doc.blob);
    var name = esc(filename);
    var pages = doc.pages || [];
    var ok = writeShell(win, filename,
      '<header><b>' + name + '</b>' +
      '<a href="' + url + '" download="' + name + '">Download PDF</a>' +
      '<small>' + pages.length + (pages.length === 1 ? ' page' : ' pages') + '</small></header>' +
      '<div id="pages"></div>');
    if (!ok) { URL.revokeObjectURL(url); return false; }
    /* Append the page images rather than inlining them in the markup above: the two
       of them together are around a megabyte of data: URL, and document.write chokes
       on that where appendChild does not. */
    try {
      var target = win.document.getElementById('pages');
      pages.forEach(function (src, i) {
        var figure = win.document.createElement('figure');
        var caption = win.document.createElement('figcaption');
        caption.textContent = 'Page ' + (i + 1) + ' of ' + pages.length;
        var img = win.document.createElement('img');
        img.src = src;
        img.alt = 'Page ' + (i + 1) + ' of the signed agreement';
        figure.appendChild(caption);
        figure.appendChild(img);
        target.appendChild(figure);
      });
      if (!pages.length) {
        target.innerHTML = '<p class="wait">Use Download PDF above to open the agreement.</p>';
      }
    } catch (e) { /* the download link still works */ }
    /* The download link in that tab keeps using the URL, so hold it well past the
       minute the old code allowed. */
    setTimeout(function () { URL.revokeObjectURL(url); }, 600000);
    return true;
  }

  function download(blob, filename) {
    var link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 3000);
  }

  window.PdfTools = {
    fromHtml: fromHtml, download: download,
    openViewer: openViewer, openInTab: openInTab
  };
})();
