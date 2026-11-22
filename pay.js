// Pay for tonight: who's playing, then a card ahead of time, Venmo or Zelle, and the members' monthly pass on Zeffy.
// Drawn into every [data-pay] element: the page the front desk QR code opens (pay.html) and the collapsible "Pay now"
// under Fees on the home page (index.html).
//
// Card, ahead of time: on a round robin day until 8:30 PM, the player picks their name from the club's published player
// list (data/player-index.json, the desk's directory) or types it if they are new, sees what they are about to pay, and
// confirms. The public turnout app (turnout-app/Prepay.js) checks the day and works out the price itself, then answers a
// Clover checkout page; Clover sends the player back here with ?paid=<date> (or ?prepay=cancelled / failed). The desk
// matches the payment to the player by that name and the amount, like any Clover payment.
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
  var NAME_KEY = "cttc-pay-name";
  // The turnout app's released address: the same as tonight.html's TURNOUT_URL (scripts/check-pay-page.js checks).
  var PREPAY_URL = "https://script.google.com/macros/s/AKfycbyhCXunOPJi54n5HQTTiRuvyTs-pSUvmirVHk7sxqS4WAlxvLmSHfdqCrI0fYimh6dXPQ/exec";
  // Paying ahead closes at 8:30 PM (turnout-app/Prepay.js PREPAY_CLOSES, which decides; this only hides the button).
  var PREPAY_CLOSES = 20 * 60 + 30;
  var TEXT_LINK = "sms:+19252383505?&body=I'll%20join%20CTTC's%20RR%20today";

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
  function storedName() { try { return localStorage.getItem(NAME_KEY) || ""; } catch (e) { return ""; } }
  function storeName(name) { try { localStorage.setItem(NAME_KEY, name); } catch (e) { /* not remembered */ } }
  function minutesNow() {
    var parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
    var get = function (type) { return Number((parts.filter(function (p) { return p.type === type; })[0] || {}).value || 0); };
    return get("hour") * 60 + get("minute");
  }
  function longDay(date) {
    return new Date(date + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
  }
  // As the desk compares names: accents and punctuation aside.
  function key(name) {
    return String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
  function esc(text) {
    return String(text).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  // Whether paying ahead is open now: a round robin day the gym is open (turnout.js and closures.json), before 8:30 PM.
  // Without turnout.js on the page, the card shows and the turnout app decides.
  var openToday = (function () {
    var T = window.CTTCTurnout;
    if (!T || !window.fetch) return Promise.resolve(true);
    return fetch("data/closures.json", { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : {}; }, function () { return {}; })
      .then(function (closures) {
        var clock = { date: today(), minutes: minutesNow() };
        var night = T.sessionNight(clock, closures);
        return !!night && night.date === clock.date && clock.minutes < PREPAY_CLOSES;
      });
  })();
  var directory = null;
  function loadDirectory() {
    if (!directory) {
      directory = fetch("data/player-index.json").then(function (r) { return r.ok ? r.json() : []; })
        .then(function (names) { return Array.isArray(names) ? names : []; }, function () { return []; });
    }
    return directory;
  }

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
      '<div class="pay-pilot">' +
      '<button type="button" class="pay-card" aria-expanded="false" hidden>' +
        '<span class="pay-pilot-tag">Pilot</span> Pay ahead by card</button>' +
      '<p class="pay-card-pilot pay-note" hidden>We&rsquo;re trying out paying online before you arrive. If anything looks off, pay at the desk as usual.</p>' +
      '<div class="pay-card-panel" hidden>' +
        '<p class="pay-card-ask"><label for="pay-card-name">Who are you? Pick your name as the desk has it.</label></p>' +
        '<input id="pay-card-name" class="pay-card-name" type="search" autocomplete="off" autocapitalize="words" spellcheck="false" maxlength="60" placeholder="Start typing your name">' +
        '<ul class="pay-card-matches" role="list"></ul>' +
        '<button type="button" class="pay-card-new" hidden></button>' +
        '<div class="pay-card-review" hidden>' +
          '<p class="pay-card-who"></p>' +
          '<button type="button" class="pay-card-go"></button>' +
          '<p class="pay-note">You pay on Clover&rsquo;s secure page, then come back here. Works on round robin days until 8:30 PM.</p>' +
        '</div>' +
        '<p class="pay-card-error" role="alert" hidden></p>' +
      '</div>' +
      '</div>' +
    '</div>' +
    '<p class="pay-done" hidden>Paid? Show the desk your confirmation screen.</p>' +
    '<div class="pay-pass" hidden>' +
      '<a class="pay-method pay-zeffy" href="#" target="_blank" rel="noopener">' +
        '<span class="pay-method-name">Monthly pass on Zeffy</span>' +
        '<span class="pay-method-what">Cheaper &amp; faster for 2+ days a week</span></a>' +
      '<p class="pay-note">Members only, $65 a month. Zeffy&rsquo;s optional tip can be set to $0.</p>' +
    '</div>';

  // Back from Clover: what happened, at the top of the options.
  function returned() {
    var search = window.location.search;
    var paid = /[?&]paid=(\d{4}-\d{2}-\d{2})(&|$)/.exec(search);
    if (paid) {
      return '<div class="pay-back pay-back-paid" role="status"><p><strong>Paid' + (paid[1] === today() ? ' for tonight' : ' for ' + longDay(paid[1])) +
        ' by card.</strong> Just check in at the desk. We&rsquo;re piloting this, so if the desk doesn&rsquo;t show you as paid, show them this page or Clover&rsquo;s receipt.</p>' +
        (paid[1] === today() ? '<p class="pay-note">Haven&rsquo;t texted yet? <a href="' + TEXT_LINK + '">Text CTTC: I&rsquo;ll join today</a> so you count on the Tonight page.</p>' : '') + '</div>';
    }
    if (/[?&]prepay=cancelled(&|$)/.test(search)) return '<div class="pay-back" role="status"><p><strong>Card payment cancelled.</strong> Nothing was charged.</p></div>';
    if (/[?&]prepay=failed(&|$)/.test(search)) return '<div class="pay-back" role="status"><p><strong>The card payment did not go through,</strong> so nothing was charged. Try again, or pay at the desk.</p></div>';
    return "";
  }

  function mount(root) {
    root.innerHTML = returned() + MARKUP;
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
      renderCard();
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

    // ---- Card, ahead of time ----
    var card = one(".pay-card");
    var panel = one(".pay-card-panel");
    var input = one(".pay-card-name");
    var matches = one(".pay-card-matches");
    var newName = one(".pay-card-new");
    var review = one(".pay-card-review");
    var go = one(".pay-card-go");
    var problem = one(".pay-card-error");
    var chosen = "";
    var sending = false;
    function amountNow() { return tonight ? tonight.fee : FEES[kind]; }
    function renderCard() {
      review.hidden = !chosen;
      if (!chosen) return;
      one(".pay-card-who").innerHTML = "<strong>" + esc(chosen) + "</strong> &middot; " + (tonight ? "Tonight&rsquo;s special" : esc(KINDS.filter(function (k) { return k[0] === kind; })[0][1])) +
        " &middot; round robin " + esc(longDay(today())) + ' <button type="button" class="pay-card-change">Change</button>';
      one(".pay-card-change").addEventListener("click", function () {
        chosen = "";
        input.value = "";
        renderCard();
        showMatches();
        input.focus();
      });
      go.disabled = sending;
      go.textContent = sending ? "Opening Clover\u2026" : "Pay $" + amountNow() + " by card";
    }
    function choose(name) {
      chosen = name;
      problem.hidden = true;
      matches.innerHTML = "";
      newName.hidden = true;
      input.value = name;
      renderCard();
      go.focus();
    }
    function showMatches() {
      var typed = key(input.value);
      if (chosen && input.value !== chosen) { chosen = ""; renderCard(); }
      loadDirectory().then(function (names) {
        if (key(input.value) !== typed) return;
        var words = typed ? typed.split(" ") : [];
        var found = !words.length ? [] : names.filter(function (name) {
          var parts = key(name).split(" ");
          return words.every(function (word) { return parts.some(function (part) { return part.indexOf(word) === 0; }); });
        }).slice(0, 6);
        matches.innerHTML = found.map(function (name) {
          return '<li><button type="button" class="pay-card-match" data-name="' + esc(name) + '">' + esc(name) + "</button></li>";
        }).join("");
        Array.prototype.forEach.call(matches.querySelectorAll(".pay-card-match"), function (button) {
          button.addEventListener("click", function () { choose(button.getAttribute("data-name")); });
        });
        var typedName = input.value.replace(/\s+/g, " ").trim();
        var exact = names.some(function (name) { return key(name) === typed; });
        // "I'm new" once a full name is typed, or when nothing in the list fits.
        newName.hidden = chosen || typedName.length < 2 || exact || (found.length && typedName.indexOf(" ") < 0);
        newName.textContent = "Not in the list? I\u2019m new: use \u201c" + typedName + "\u201d";
      });
    }
    input.addEventListener("input", showMatches);
    newName.addEventListener("click", function () { choose(input.value.replace(/\s+/g, " ").trim()); });
    function openCard() {
      panel.hidden = false;
      card.setAttribute("aria-expanded", "true");
      loadDirectory();
      if (!chosen && storedName()) choose(storedName());
    }
    card.addEventListener("click", function () {
      if (panel.hidden) openCard();
      else { panel.hidden = true; card.setAttribute("aria-expanded", "false"); }
    });
    go.addEventListener("click", function () {
      if (!chosen || sending) return;
      sending = true;
      problem.hidden = true;
      renderCard();
      var amount = amountNow();
      var query = "?prepay=1&name=" + encodeURIComponent(chosen) + "&kind=" + encodeURIComponent(kind) + "&date=" + today() + "&amount=" + amount;
      fetch(PREPAY_URL + query, { credentials: "omit", cache: "no-store" }).then(function (r) { return r.json(); }).then(function (answer) {
        if (answer && answer.ok && /^https:\/\/([a-z0-9-]+\.)*clover\.com\//i.test(String(answer.href))) {
          storeName(chosen);
          window.location.assign(answer.href);
          return;
        }
        throw new Error(answer && answer.error || "Card payment is not available right now. You can pay at the desk.");
      }).catch(function (error) {
        sending = false;
        problem.textContent = error && error.message && !/fetch|network|JSON/i.test(error.message) ? error.message : "Card payment is not available right now. You can pay at the desk.";
        problem.hidden = false;
        renderCard();
      });
    });
    openToday.then(function (open) {
      card.hidden = !open;
      one(".pay-card-pilot").hidden = !open;
      if (open && /^#card$/.test(window.location.hash) && root === document.querySelector("[data-pay]")) {
        openCard();
        if (panel.scrollIntoView) panel.scrollIntoView({ block: "start" });
      }
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
