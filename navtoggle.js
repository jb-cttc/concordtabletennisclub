(function () {
  // The header stays at the top of the screen (style.css); scroll-padding-top uses its height so a jump to a spot on the
  // page does not end under it.
  var header = document.querySelector('header');
  function measure() {
    if (header) document.documentElement.style.setProperty('--header-height', Math.ceil(header.getBoundingClientRect().height) + 'px');
  }
  measure();
  if (header && window.ResizeObserver) new ResizeObserver(measure).observe(header);
  else window.addEventListener('resize', measure);
}());

(function () {
  var btn = document.querySelector('.nav-toggle');
  if (!btn) return;
  btn.addEventListener('click', function () {
    var nav = btn.closest('nav');
    var open = nav.classList.toggle('nav-open');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.textContent = open ? '✕' : '☰';
  });
  document.addEventListener('click', function (e) {
    var nav = document.querySelector('nav');
    if (nav && nav.classList.contains('nav-open') && !nav.contains(e.target)) {
      nav.classList.remove('nav-open');
      btn.textContent = '☰';
      btn.setAttribute('aria-expanded', 'false');
    }
  });
}());

(function () {
  // Add to Home Screen. Android (Chrome, Edge, Samsung) hands the page an install prompt, so one tap shows the browser's own
  // "Install" box. iPhone and iPad have no such prompt: a page can't add itself, so the button shows the taps to make in
  // the browser's Share menu, with an arrow toward where that browser keeps it (the words stay the same in every browser).
  // The icon and name come from the <head> tags and assets/site.webmanifest; the saved icon opens the home page. Phones
  // and tablets only, and never inside the saved app itself.
  var btn = document.querySelector('.home-screen');
  if (!btn) return;
  var ua = navigator.userAgent;
  var ipad = /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var ios = ipad || /iPhone|iPod/.test(ua);
  var android = /Android/.test(ua);
  var saved = navigator.standalone || ['standalone', 'minimal-ui', 'fullscreen'].some(function (mode) {
    return window.matchMedia && window.matchMedia('(display-mode: ' + mode + ')').matches;
  });

  // Once added, a later tap shows a check instead of the steps, so nobody adds a second icon. Android says when the icon
  // is installed; an iPhone never tells the page, so it is the person's "I added it", or a visit from the icon itself
  // (the manifest's start_url carries ?from=home-screen) when the icon opens in the same browser.
  var KEY = 'cttc-home-screen';
  function added() { try { return localStorage.getItem(KEY) === 'added'; } catch (error) { return false; } }
  function markAdded(yes) { try { if (yes) localStorage.setItem(KEY, 'added'); else localStorage.removeItem(KEY); } catch (error) {} }
  var params = window.location.search;
  if (saved || /[?&]from=home-screen(&|$)/.test(params)) markAdded(true);
  if (/[?&](from=)?home-screen(&|$)/.test(params) && window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
  if (!(ios || android) || saved) return;

  // Where the browser keeps Share (iPhone) or its menu (Android), for the arrow. Safari 26 moved Share under the ... button.
  function arrowAt() {
    if (ipad) return 'top-right';
    if (ios) {
      if (/CriOS/.test(ua)) return 'top-right';
      if (/EdgiOS|FxiOS/.test(ua)) return 'bottom-right';
      var safari = /Version\/(\d+)/.exec(ua);
      if (safari && /Safari/.test(ua)) return Number(safari[1]) >= 26 ? 'bottom-right' : 'bottom-center';
      return '';
    }
    return /SamsungBrowser/.test(ua) ? 'bottom-right' : 'top-right';
  }

  var prompt = null;
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); prompt = event; });
  window.addEventListener('appinstalled', function () { markAdded(true); });
  if (android && navigator.getInstalledRelatedApps) {
    navigator.getInstalledRelatedApps().then(function (apps) { if (apps && apps.length) markAdded(true); }, function () {});
  }
  btn.hidden = false;

  var sheet = null;
  function close() { if (sheet) { sheet.remove(); sheet = null; document.body.classList.remove('home-screen-open'); btn.focus(); } }
  function node(tag, className, html) { var el = document.createElement(tag); if (className) el.className = className; if (html) el.innerHTML = html; return el; }
  function button(text, className, onClick) { var el = node('button', className); el.type = 'button'; el.textContent = text; el.addEventListener('click', onClick); return el; }
  var SHARE = '<svg width="18" height="18" viewBox="0 0 24 24" aria-label="Share" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16"/><path d="M12 14V3"/><path d="M8.5 6.5 12 3l3.5 3.5"/></svg>';
  var CHECK = '<svg width="56" height="56" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#1f6b3a"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function open(again) {
    if (sheet) close();
    sheet = node('div', 'home-screen-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'home-screen-title');
    var box = node('div', 'home-screen-box');
    var title = node('h2');
    title.id = 'home-screen-title';
    var first;
    if (added() && !again) {
      box.appendChild(node('div', 'home-screen-check', CHECK));
      title.textContent = 'CTTC is on your Home Screen';
      box.appendChild(title);
      box.appendChild(node('p', '', 'Look for the CTTC icon among your apps.'));
      box.appendChild(first = button('Close', '', close));
      box.appendChild(button('Add it again', 'home-screen-again', function () { markAdded(false); open(true); }));
    } else {
      var icon = node('img');
      icon.src = 'assets/icons/apple-touch-icon.png';
      icon.alt = '';
      box.appendChild(icon);
      title.textContent = 'Add CTTC to your Home Screen';
      box.appendChild(title);
      var steps = node('ol');
      (ios ? [
        'Tap <b>Share</b> ' + SHARE + ' in your browser&rsquo;s toolbar (in Safari it may be under <b>&middot;&middot;&middot;</b>; in Chrome or Edge, at the top or in the menu).',
        'Scroll down and tap <b>Add to Home Screen</b>.',
        'Tap <b>Add</b>. The CTTC icon is on your Home Screen.'
      ] : [
        'Open your browser&rsquo;s menu (<b>&#8942;</b> or <b>&#9776;</b>).',
        'Tap <b>Add to Home screen</b> or <b>Install app</b>.',
        'Tap <b>Add</b> or <b>Install</b>. The CTTC icon is on your Home Screen.'
      ]).forEach(function (html) { steps.appendChild(node('li', '', html)); });
      box.appendChild(steps);
      var actions = node('div', 'home-screen-actions');
      actions.appendChild(button('Not now', 'plain', close));
      actions.appendChild(first = button('I added it', '', function () { markAdded(true); close(); }));
      box.appendChild(actions);
      var at = arrowAt();
      if (at) {
        sheet.setAttribute('data-arrow', at);
        sheet.appendChild(node('div', 'home-screen-arrow', '<svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v17"/><path d="M5 13l7 7 7-7"/></svg>'));
      }
    }
    sheet.appendChild(box);
    sheet.addEventListener('click', function (event) { if (event.target === sheet) close(); });
    sheet.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    document.body.appendChild(sheet);
    document.body.classList.add('home-screen-open');
    first.focus();
  }

  // iPhone and iPad save the page that is open, so the steps open on the home page: the icon then opens it too. The marker
  // is taken out of the address (above), so the saved address is the plain home page.
  var home = /^\/(index\.html)?$/.test(window.location.pathname);
  if (/[?&]home-screen(&|$)/.test(params) && ios && home) open();
  btn.addEventListener('click', function (event) {
    event.stopPropagation();
    if (added()) { open(); return; }
    if (ios && !home) { window.location.href = './?home-screen'; return; }
    if (!prompt) { open(); return; }
    prompt.prompt();
    prompt.userChoice.then(function (choice) { if (choice.outcome === 'accepted') markAdded(true); });
    prompt = null;
  });
}());
