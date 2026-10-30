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
  // "Install" box. iPhone and iPad have no such prompt: a page can't add itself, so the button shows the two taps to make
  // in the browser's Share menu. The icon and name come from the <head> tags and assets/site.webmanifest; the saved icon
  // opens the home page. Phones and tablets only, and never inside the saved app itself.
  var btn = document.querySelector('.home-screen');
  if (!btn) return;
  var ua = navigator.userAgent;
  var ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var android = /Android/.test(ua);
  var saved = navigator.standalone || ['standalone', 'minimal-ui', 'fullscreen'].some(function (mode) {
    return window.matchMedia && window.matchMedia('(display-mode: ' + mode + ')').matches;
  });
  if (!(ios || android) || saved) return;
  var prompt = null;
  window.addEventListener('beforeinstallprompt', function (event) { event.preventDefault(); prompt = event; });
  window.addEventListener('appinstalled', function () { btn.hidden = true; close(); });
  btn.hidden = false;

  var sheet = null;
  function close() { if (sheet) { sheet.remove(); sheet = null; btn.focus(); } }
  function step(html) { var li = document.createElement('li'); li.innerHTML = html; return li; }
  function open() {
    if (sheet) return;
    sheet = document.createElement('div');
    sheet.className = 'home-screen-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    sheet.setAttribute('aria-labelledby', 'home-screen-title');
    var box = document.createElement('div');
    box.className = 'home-screen-box';
    var icon = document.createElement('img');
    icon.src = 'assets/icons/apple-touch-icon.png';
    icon.alt = '';
    var title = document.createElement('h2');
    title.id = 'home-screen-title';
    title.textContent = 'Add CTTC to your Home Screen';
    var steps = document.createElement('ol');
    var share = '<svg width="18" height="18" viewBox="0 0 24 24" aria-label="Share" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9H6.5A1.5 1.5 0 0 0 5 10.5v9A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 17.5 9H16"/><path d="M12 14V3"/><path d="M8.5 6.5 12 3l3.5 3.5"/></svg>';
    if (ios) {
      steps.appendChild(step('Tap <b>Share</b> ' + share + ' in your browser&rsquo;s toolbar (in Safari it may be under <b>&middot;&middot;&middot;</b>; in Chrome or Edge, at the top or in the menu).'));
      steps.appendChild(step('Scroll down and tap <b>Add to Home Screen</b>.'));
      steps.appendChild(step('Tap <b>Add</b>. The CTTC icon is on your Home Screen.'));
    } else {
      steps.appendChild(step('Open your browser&rsquo;s menu (<b>&#8942;</b> or <b>&#9776;</b>).'));
      steps.appendChild(step('Tap <b>Add to Home screen</b> or <b>Install app</b>.'));
      steps.appendChild(step('Tap <b>Add</b> or <b>Install</b>. The CTTC icon is on your Home Screen.'));
    }
    var done = document.createElement('button');
    done.type = 'button';
    done.textContent = 'Close';
    done.addEventListener('click', close);
    box.appendChild(icon);
    box.appendChild(title);
    box.appendChild(steps);
    box.appendChild(done);
    sheet.appendChild(box);
    sheet.addEventListener('click', function (event) { if (event.target === sheet) close(); });
    sheet.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
    document.body.appendChild(sheet);
    done.focus();
  }
  // iPhone and iPad save the page that is open, so the instructions open on the home page: the icon then opens it too. The
  // marker is taken out of the address at once, so the saved address is the plain home page.
  var home = /^\/(index\.html)?$/.test(window.location.pathname);
  if (/[?&]home-screen(&|$)/.test(window.location.search)) {
    if (window.history.replaceState) window.history.replaceState(null, '', window.location.pathname);
    if (ios && home) open();
  }
  btn.addEventListener('click', function (event) {
    event.stopPropagation();
    if (ios && !home) { window.location.href = './?home-screen'; return; }
    if (!prompt) { open(); return; }
    prompt.prompt();
    prompt.userChoice.then(function (choice) { if (choice.outcome === 'accepted') btn.hidden = true; });
    prompt = null;
  });
}());
