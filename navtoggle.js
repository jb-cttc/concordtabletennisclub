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
