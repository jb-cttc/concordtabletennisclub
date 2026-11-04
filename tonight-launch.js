// The "See who's playing tonight" button on the home and Round Robins pages, and the way back to it. Tapping it notes
// where the button sat on the screen; coming back (Back to Home on the Tonight page, or the browser's Back) puts the button
// in the same place again. Without this the home page opens somewhere else: it is built as it loads (results, calendar),
// so the browser's own guess at the old position lands far below the button. A page the browser kept whole needs nothing.
(function () {
  "use strict";
  var KEY = "cttc-tonight-return";
  var SETTLE_MS = 3000;
  var button = document.querySelector(".tonight-launch");
  if (!button) return;
  var page = window.location.pathname;

  function read() {
    try { return JSON.parse(window.sessionStorage.getItem(KEY) || "null"); } catch (error) { return null; }
  }
  function forget() {
    try { window.sessionStorage.removeItem(KEY); } catch (error) { /* nothing kept */ }
  }

  button.addEventListener("click", function () {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ page: page, top: button.getBoundingClientRect().top }));
      window.history.scrollRestoration = "manual";
    } catch (error) { /* the browser's own guess, as before */ }
  });

  // Put the button back where it was, and keep it there while the page finishes loading, until the visitor scrolls.
  function restore(top) {
    var done = false;
    var observer = null;
    function place() {
      if (!done) window.scrollBy(0, button.getBoundingClientRect().top - top);
    }
    function stop() {
      if (done) return;
      done = true;
      if (observer) observer.disconnect();
      try { window.history.scrollRestoration = "auto"; } catch (error) { /* already auto */ }
    }
    ["wheel", "touchstart", "keydown", "mousedown"].forEach(function (type) {
      window.addEventListener(type, stop, { once: true, passive: true });
    });
    place();
    if (window.ResizeObserver) {
      observer = new ResizeObserver(place);
      observer.observe(document.body);
    }
    window.addEventListener("load", place);
    setTimeout(function () { place(); stop(); }, SETTLE_MS);
  }

  var saved = read();
  var entry = window.performance && performance.getEntriesByType ? performance.getEntriesByType("navigation")[0] : null;
  forget();
  if (saved && saved.page === page && entry && entry.type === "back_forward" && isFinite(saved.top)) restore(saved.top);
  else {
    try { window.history.scrollRestoration = "auto"; } catch (error) { /* already auto */ }
  }

  // A page the browser kept whole comes back exactly as it was left: nothing to put back.
  window.addEventListener("pageshow", function (event) {
    if (!event.persisted) return;
    forget();
    try { window.history.scrollRestoration = "auto"; } catch (error) { /* already auto */ }
  });
})();
