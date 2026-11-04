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
  // Add to Home Screen, for two icons: CTTC (the website) and Text CTTC (text.html, which opens Messages with the join text
  // filled in). The header button asks which one; Text CTTC is added from its own page, which has its own icon and name
  // (assets/text.webmanifest). Android (Chrome, Edge, Samsung) hands each page an install prompt, so one tap shows the
  // browser's own "Install" box. iPhone and iPad have no such prompt: a page can't add itself, so the button shows the taps
  // to make in the browser's Share menu, on the page to be saved. No arrow: a page can't see where the browser's toolbar
  // is (people move it), so it never guesses. Phones and tablets only, and never inside a saved app itself.
  var btn = document.querySelector('.home-screen');
  var textPage = !!document.body && document.body.getAttribute('data-home-screen') === 'text';
  if (!btn && !textPage) return;
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var android = /Android/.test(ua);
  var saved = navigator.standalone || ['standalone', 'minimal-ui', 'fullscreen'].some(function (mode) {
    return window.matchMedia && window.matchMedia('(display-mode: ' + mode + ')').matches;
  });

  var ICONS = {
    site: { name: 'CTTC', icon: 'assets/icons/apple-touch-icon.png',
      about: 'The club&rsquo;s website: results, Tonight, the calendar.' },
    text: { name: 'Text CTTC', icon: 'assets/icons/text-apple-touch-icon.png',
      about: 'One tap texts the club &ldquo;I&rsquo;ll join CTTC&rsquo;s RR today&rdquo;.' }
  };

  // No "already on your Home Screen" mark: a page can't see the Home Screen, and on an iPhone an icon that opens as its own
  // app keeps its own storage, so the browser never hears of it. A mark would be right for one icon and wrong for the other.
  var params = window.location.search;
  var steps = /[?&]home-screen(&|$)/.test(params);
  // The markers leave the address, so the address saved on an iPhone is the plain page, except on Text CTTC, where the
  // saved address carries ?from=home-screen: an icon that opens in the browser still knows to open Messages.
  if (window.history.replaceState) {
    if (!textPage && /[?&](from=)?home-screen(&|$)/.test(params)) window.history.replaceState(null, '', window.location.pathname);
    if (textPage && steps) window.history.replaceState(null, '', window.location.pathname + '?from=home-screen');
  }
  if (!(ios || android) || saved) return;

  var prompt = null;
  var sheet = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    prompt = event;
    if (sheet && sheet.getAttribute('data-steps') === 'text') showSteps('text');
  });
  if (btn) btn.hidden = false;

  function close() { if (sheet) { sheet.remove(); sheet = null; if (btn) btn.focus(); } }
  function node(tag, className, html) { var el = document.createElement(tag); if (className) el.className = className; if (html) el.innerHTML = html; return el; }
  function button(text, className, onClick) { var el = node('button', className); el.type = 'button'; el.textContent = text; el.addEventListener('click', onClick); return el; }
  var SHARE = '<svg width="18" height="18" viewBox="0 0 24 24" aria-label="Share" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16"/><path d="M12 14V3"/><path d="M8.5 6.5 12 3l3.5 3.5"/></svg>';
  function newSheet(title, steps) {
    if (sheet) sheet.remove();
    sheet = node('div', 'home-screen-sheet');
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'home-screen-title');
    if (steps) sheet.setAttribute('data-steps', steps);
    var box = node('div', 'home-screen-box');
    var heading = node('h2');
    heading.id = 'home-screen-title';
    heading.textContent = title;
    box.appendChild(heading);
    sheet.appendChild(box);
    sheet.addEventListener('click', function (event) { if (event.target === sheet) close(); });
    sheet.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    document.body.appendChild(sheet);
    return box;
  }

  // Which icon: the website, or the one that opens the text.
  function chooser() {
    var box = newSheet('Add to your Home Screen');
    var first = null;
    ['site', 'text'].forEach(function (kind) {
      var icon = ICONS[kind];
      var option = node(kind === 'text' ? 'a' : 'button', 'home-screen-option');
      if (kind === 'text') option.href = 'text.html?home-screen';
      else { option.type = 'button'; option.addEventListener('click', function () { chooseSite(); }); }
      option.innerHTML = '<img src="' + icon.icon + '" alt=""><span><b>' + icon.name + '</b><small>' + icon.about + '</small></span>';
      box.appendChild(option);
      if (!first) first = option;
    });
    box.appendChild(button('Not now', 'plain', close));
    first.focus();
  }

  // The website's icon: Android's own prompt when there is one; an iPhone saves the page that is open, so the steps open
  // on the home page and the icon then opens it too.
  var home = /^\/(index\.html)?$/.test(window.location.pathname);
  function chooseSite() {
    if (ios && !home) { window.location.href = './?home-screen'; return; }
    if (!prompt) { showSteps('site'); return; }
    close();
    prompt.prompt();
    prompt = null;
  }

  function showSteps(kind) {
    var icon = ICONS[kind];
    var box = newSheet('Add ' + icon.name + ' to your Home Screen', kind);
    var picture = node('img');
    picture.src = icon.icon;
    picture.alt = '';
    box.insertBefore(picture, box.firstChild);
    if (kind === 'text') box.appendChild(node('p', '', 'Then one tap on the icon opens Messages with &ldquo;I&rsquo;ll join CTTC&rsquo;s RR today&rdquo; ready to send.'));
    var done = 'The ' + icon.name + ' icon is on your Home Screen.';
    var first;
    if (android && prompt) {
      // On its own page, Android's install prompt adds this icon in one tap.
      var actions = node('div', 'home-screen-actions');
      actions.appendChild(button('Not now', 'plain', close));
      actions.appendChild(first = button('Add ' + icon.name, '', function () {
        close();
        prompt.prompt();
        prompt = null;
      }));
      box.appendChild(actions);
      first.focus();
      return;
    }
    var list = node('ol');
    (ios ? [
      'Tap <b>Share</b> ' + SHARE + ' in your browser&rsquo;s toolbar (in Safari it may be under <b>&middot;&middot;&middot;</b>; in Chrome or Edge, at the top or in the menu).',
      'Scroll down and tap <b>Add to Home Screen</b>.',
      'Tap <b>Add</b>. ' + done
    ] : [
      'Open your browser&rsquo;s menu (<b>&#8942;</b> or <b>&#9776;</b>).',
      'Tap <b>Add to Home screen</b> or <b>Install app</b>.',
      'Tap <b>Add</b> or <b>Install</b>. ' + done
    ]).forEach(function (html) { list.appendChild(node('li', '', html)); });
    box.appendChild(list);
    var row = node('div', 'home-screen-actions');
    row.appendChild(first = button('Done', '', close));
    box.appendChild(row);
    first.focus();
  }

  if (steps && ios && home && !textPage) showSteps('site');
  if (steps && textPage) showSteps('text');
  if (btn) btn.addEventListener('click', function (event) { event.stopPropagation(); chooser(); });
}());
