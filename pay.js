// Pay for tonight: who's playing, then Venmo or Zelle, and the members' monthly pass on Zeffy. Drawn into every
// [data-pay] element: the page the front desk QR code opens (pay.html) and the collapsible "Pay now" under Fees on the
// home page (index.html).
(function () {
  "use strict";
  // The members' monthly play pass: the same Zeffy page the home page and Membership page link to.
  var ZEFFY = "https://www.zeffy.com/en-US/ticketing/cttc-monthly-pre-pay-playpass-for-members-only";

  // Venmo and Zelle go to personal accounts, so their details are not readable on the public site or in the repository:
  // they are encrypted here (AES-GCM), and the key is only in the QR code at the front desk, after # in its link
  // (pay.html#k=...), so it is never sent to the web server. The page keeps the key on that phone and takes it out of the
  // address bar, so the home page shows Venmo and Zelle too on a phone that has scanned the code. Without it, both say to
  // scan the code at the desk. scripts/pay-lock.js (npm run build:pay-lock) makes LOCKED and the desk link; a new key means a
  // newly printed code, and the old one stops working.
  var LOCKED = "AiiPk-FhF4gvLhk8p_EbErJPwBO1kkxdKO4nUGaoLkFlqh0xjBQdISm7UykVH4fkjVsYNHOPIyfNdjy37tmrfTKBKD94JMlaO59SV_EbQvHksRq2zMaUXujomPNl8ERa6IrfOZEQmUNSP_Wt5YrlEoIhzvOsnCo";
  var KEY_KEY = "cttc-pay-key";
  var PAY = {};

  // The same fees and special as apps-script/NightFees.js (NIGHT_FEES, SPECIAL_NIGHTS); scripts/check-pay-page.js checks.
  var FEES = { member: 10, visitor: 15, intro: 10, junior: 5 };
  var SPECIAL_NIGHTS = [{ from: "2026-11-13", to: "2026-12-31", weekdays: [5, 6], fee: 5 }];
  var KINDS = [["member", "Member"], ["visitor", "Visitor"], ["intro", "First visit"], ["junior", "Under 18"]];
  var NOTES = { member: "member", visitor: "visitor", intro: "first visit", junior: "under 18" };
  var KIND_KEY = "cttc-pay-kind";

  // Today in Pacific time, as the desk counts nights.
  function today() {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()).slice(0, 10);
  }
  function special(date) {
    var weekday = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))).getUTCDay();
    return SPECIAL_NIGHTS.filter(function (s) { return date >= s.from && date <= s.to && s.weekdays.indexOf(weekday) >= 0; })[0] || null;
  }
  function stored() { try { return localStorage.getItem(KIND_KEY); } catch (e) { return null; } }
  function store(kind) { try { localStorage.setItem(KIND_KEY, kind); } catch (e) { /* private window: not remembered */ } }

  function bytes(base64url) {
    var text = atob(base64url.replace(/-/g, "+").replace(/_/g, "/"));
    var out = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
    return out;
  }
  // The key from the desk link (kept on this phone, then taken out of the address bar), else the one kept earlier.
  function deskKey() {
    var match = /[#&]k=([A-Za-z0-9_-]{22})(&|$)/.exec(window.location.hash);
    if (match) {
      try { localStorage.setItem(KEY_KEY, match[1]); } catch (e) { /* private window: this visit only */ }
      try { history.replaceState(null, "", window.location.pathname + window.location.search); } catch (e) {}
      return match[1];
    }
    try { return localStorage.getItem(KEY_KEY); } catch (e) { return null; }
  }
  // The Venmo and Zelle details, or null without the right key (an old key is forgotten).
  function unlock() {
    var key = deskKey();
    var subtle = window.crypto && window.crypto.subtle;
    if (!key || !LOCKED || !subtle) return Promise.resolve(null);
    var sealed = bytes(LOCKED);
    return subtle.importKey("raw", bytes(key), "AES-GCM", false, ["decrypt"])
      .then(function (aes) { return subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12) }, aes, sealed.slice(12)); })
      .then(function (plain) { return JSON.parse(new TextDecoder().decode(plain)); })
      .catch(function () {
        try { localStorage.removeItem(KEY_KEY); } catch (e) {}
        return null;
      });
  }

  var MARKUP =
    '<div class="pay-step">' +
      '<p class="pay-label">1. Who&rsquo;s playing?</p>' +
      '<div class="pay-kinds" role="radiogroup" aria-label="Who’s playing">' +
        KINDS.map(function (k) {
          return '<button type="button" role="radio" class="pay-kind" data-kind="' + k[0] + '">' + k[1] + ' <span class="pay-price">$' + FEES[k[0]] + '</span></button>';
        }).join("") +
      '</div>' +
      '<p class="pay-special" hidden><strong>$5 tonight for everyone.</strong> Fridays and Saturdays through December 31.</p>' +
    '</div>' +
    '<div class="pay-step">' +
      '<p class="pay-label">2. Pay <span class="pay-amount">$10</span><span class="pay-with" hidden> with</span></p>' +
      '<p class="pay-locked" hidden>Scan the QR code at the front desk to pay by <strong>Venmo</strong> or <strong>Zelle</strong>. Cash and card work at the desk too.</p>' +
      '<a class="pay-method pay-venmo" href="#" hidden>' +
        '<span class="pay-method-name">Venmo</span><span class="pay-method-what">Opens the app, amount filled in</span></a>' +
      '<p class="pay-note pay-venmo-note" hidden></p>' +
      '<button type="button" class="pay-method pay-zelle" aria-expanded="false" hidden>' +
        '<span class="pay-method-name">Zelle</span><span class="pay-method-what">From your bank&rsquo;s app</span></button>' +
      '<div class="pay-zelle-panel" hidden>' +
        '<p>In your bank app, choose <strong>Zelle</strong> and send <strong class="pay-amount">$10</strong> to:</p>' +
        '<p class="pay-zelle-to"><span class="pay-zelle-address"></span> <button type="button" class="pay-copy">Copy</button></p>' +
        '<p class="pay-note pay-zelle-name"></p>' +
      '</div>' +
    '</div>' +
    '<p class="pay-done" hidden>Paid? Show the desk your confirmation screen.</p>' +
    '<div class="pay-pass" hidden>' +
      '<a class="pay-method pay-zeffy" href="#" target="_blank" rel="noopener">' +
        '<span class="pay-method-name">Monthly pass on Zeffy</span>' +
        '<span class="pay-method-what">Cheaper &amp; faster for 2+ days a week</span></a>' +
      '<p class="pay-note">Members only, $65 a month. Zeffy&rsquo;s optional tip can be set to $0.</p>' +
    '</div>';

  function mount(root) {
    root.innerHTML = MARKUP;
    var one = function (selector) { return root.querySelector(selector); };
    var all = function (selector) { return Array.prototype.slice.call(root.querySelectorAll(selector)); };
    var tonight = special(today());
    var kind = FEES[stored()] ? stored() : "member";

    if (tonight) {
      one(".pay-label").textContent = "1. Tonight";
      one(".pay-kinds").hidden = true;
      one(".pay-special").hidden = false;
    }

    function render() {
      var amount = tonight ? tonight.fee : FEES[kind];
      all(".pay-kind").forEach(function (button) {
        var on = button.getAttribute("data-kind") === kind;
        button.classList.toggle("is-on", on);
        button.setAttribute("aria-checked", on ? "true" : "false");
      });
      all(".pay-amount").forEach(function (el) { el.textContent = "$" + amount; });
      if (PAY.venmo) {
        // Venmo's payment link: on a phone with Venmo it opens the app's Pay screen with the amount and note filled in.
        var note = "CTTC " + (tonight ? "night" : NOTES[kind] + " night");
        one(".pay-venmo").href = "https://venmo.com/" + encodeURIComponent(PAY.venmo) + "?txn=pay&amount=" + amount + "&note=" + encodeURIComponent(note);
      }
    }

    all(".pay-kind").forEach(function (button) {
      button.addEventListener("click", function () {
        kind = button.getAttribute("data-kind");
        store(kind);
        render();
      });
    });

    // Venmo and Zelle once the desk key has opened them; otherwise how to get them.
    accounts.then(function (found) {
      if (!found) {
        one(".pay-locked").hidden = false;
        return;
      }
      PAY = found;
      one(".pay-with").hidden = false;
      one(".pay-done").hidden = false;
      if (PAY.venmo) {
        one(".pay-venmo").hidden = false;
        one(".pay-venmo-note").hidden = false;
        one(".pay-venmo-note").textContent = "To @" + PAY.venmo + (PAY.venmoLast4 ? ". If Venmo asks for the last 4 digits of the phone number, they are " + PAY.venmoLast4 + "." : ".");
      }
      if (PAY.zelle) {
        var zelle = one(".pay-zelle");
        var panel = one(".pay-zelle-panel");
        zelle.hidden = false;
        // A 10-digit phone number reads as (###) ###-####; Copy copies the digits.
        one(".pay-zelle-address").textContent = PAY.zelle.replace(/^(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3");
        one(".pay-zelle-name").textContent = PAY.zelleName ? "Zelle shows it as " + PAY.zelleName + "." : "";
        zelle.addEventListener("click", function () {
          panel.hidden = !panel.hidden;
          zelle.setAttribute("aria-expanded", panel.hidden ? "false" : "true");
        });
        one(".pay-copy").addEventListener("click", function () {
          var button = this;
          if (!navigator.clipboard || !navigator.clipboard.writeText) return;
          navigator.clipboard.writeText(PAY.zelle).then(function () {
            button.textContent = "Copied";
            setTimeout(function () { button.textContent = "Copy"; }, 2000);
          }, function () {});
        });
      }
      render();
    });
    one(".pay-pass").hidden = false;
    one(".pay-zeffy").href = ZEFFY;
    render();
  }

  var accounts = unlock();
  // Scanned while this page was already open: only the # part changes, so start again to read the key.
  window.addEventListener("hashchange", function () {
    if (/[#&]k=/.test(window.location.hash)) window.location.reload();
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), mount);
})();
