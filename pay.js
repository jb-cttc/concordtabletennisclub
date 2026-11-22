// Pay for tonight: who's playing, then Venmo, Zelle or a card on Zeffy. Drawn into every [data-pay] element: the page the
// front desk QR code opens (pay.html) and the collapsible "Pay now" under Fees on the home page (index.html).
(function () {
  "use strict";
  // ---- The club's payment accounts. Leave one empty to hide that option. ----
  var PAY = {
    venmo: "",          // Venmo username, without the @
    venmoLast4: "",     // last 4 digits of the phone on that Venmo account, shown in case Venmo asks
    zelle: "",          // the email or phone number the club receives Zelle at
    zelleName: "",      // the name Zelle shows for it, so people know they have the right one
    zeffy: ""           // the Zeffy page for paying a night by card (not the monthly play pass)
  };

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
      '<p class="pay-label">2. Pay <span class="pay-amount">$10</span> with</p>' +
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
      '<a class="pay-method pay-zeffy" href="#" target="_blank" rel="noopener" hidden>' +
        '<span class="pay-method-name">Card</span><span class="pay-method-what">Apple Pay or Google Pay too, on Zeffy</span></a>' +
      '<p class="pay-note pay-zeffy-note" hidden>Zeffy suggests an optional tip to Zeffy. You can set it to $0.</p>' +
    '</div>' +
    '<p class="pay-done">Paid? Show the desk your confirmation screen.</p>';

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

    if (PAY.venmo) {
      one(".pay-venmo").hidden = false;
      one(".pay-venmo-note").hidden = false;
      one(".pay-venmo-note").textContent = "To @" + PAY.venmo + (PAY.venmoLast4 ? ". If Venmo asks for the last 4 digits of the phone number, they are " + PAY.venmoLast4 + "." : ".");
    }
    if (PAY.zelle) {
      var zelle = one(".pay-zelle");
      var panel = one(".pay-zelle-panel");
      zelle.hidden = false;
      one(".pay-zelle-address").textContent = PAY.zelle;
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
    if (PAY.zeffy) {
      one(".pay-zeffy").hidden = false;
      one(".pay-zeffy-note").hidden = false;
      one(".pay-zeffy").href = PAY.zeffy;
    }
    render();
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-pay]"), mount);
})();
