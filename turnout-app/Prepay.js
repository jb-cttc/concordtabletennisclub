// Pay ahead for tonight by card (docs/turnout-flow.md, section 7). The site's pay page (pay.js) sends who is paying, as
// they picked their name from the club's published player list or typed it as new, which fee they chose, and the date
// and amount the player saw. This file checks all of it, works out the price itself from the desk's fee rules, and asks
// Clover's Hosted Checkout for a checkout page; the answer is only that page's address. The player pays on Clover's own
// page, so no card number ever reaches the site or Google, and the desk's Clover reader (apps-script/CloverPayments.js)
// matches the payment to the player by the name on the checkout's one line (cloverPrepayOf_) and the amount.
//
// Script properties (set by the owner in the app's Project Settings, never in the repository): CLOVER_CHECKOUT_TOKEN, the
// Clover Ecommerce private token made for Hosted checkout, and CLOVER_MERCHANT_ID. The app also keeps one counter,
// PREPAY_COUNT_<date>, for the daily cap.
//
// Nothing here says whether a name is in the desk's directory or what a player's status is: the page is public, so a
// typed name is never looked up, and a wrong fee is left to the desk, where the payment waits for the organizer.

// The desk's fees (apps-script/NightFees.js NIGHT_FEES and SPECIAL_NIGHTS); check-turnout-app.cjs checks they match.
var PREPAY_FEES = { junior: 5, member: 10, visitor: 15, intro: 10 };
var PREPAY_SPECIAL_NIGHTS = [{ from: '2026-11-13', to: '2026-12-31', weekdays: [5, 6], fee: 5 }];
var PREPAY_KINDS = { member: 'Member', visitor: 'Visitor', intro: 'First visit', junior: 'Under 18' };
// Paying ahead closes at 8:30 PM on a round robin day (executive committee, November 2026), or when the night ends if
// that is sooner (Saturday's ends at 6 PM).
var PREPAY_CLOSES = 20 * 60 + 30;
// At most this many checkouts a day, with a warning in the log first: each one is a call to Clover from the club's
// shared Google allowance (docs/google-limits.md), and a public page can be pressed by anyone.
var PREPAY_DAILY_CAP = 150;
var PREPAY_WARN_AT = 120;
var PREPAY_COUNT_PREFIX = 'PREPAY_COUNT_';
var PREPAY_CLOVER = 'https://api.clover.com/invoicingcheckoutservice/v1/checkouts';
var PREPAY_SORRY = {
  invalid: 'Something on the page was missing. Reload the page and try again.',
  closed: 'Paying ahead works on round robin days until 8:30 PM. You can pay at the desk.',
  changed: 'This page is out of date. Reload it and try again.',
  busy: 'Paying ahead is not available right now. You can pay at the desk.',
  unavailable: 'Card payment is not available right now. You can pay at the desk.'
};

// The page's request: {prepay, name, kind, date, amount}. Answers {ok: true, href, amount} or {ok: false, reason, error}.
function prepay_(params, now) {
  var name = prepayName_(params.name);
  var kind = String(params.kind || '');
  if (!name || !PREPAY_KINDS[kind] || !/^\d{4}-\d{2}-\d{2}$/.test(String(params.date || ''))) return prepayNo_('invalid');
  var clock = {
    date: Utilities.formatDate(now, TZ, 'yyyy-MM-dd'),
    minutes: Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'))
  };
  if (String(params.date) !== clock.date) return prepayNo_('changed');
  if (!prepayOpen_(clock)) return prepayNo_('closed');
  var dollars = prepayFee_(kind, clock.date);
  if (String(params.amount) !== String(dollars)) return prepayNo_('changed', dollars);

  var properties = PropertiesService.getScriptProperties();
  var token = String(properties.getProperty('CLOVER_CHECKOUT_TOKEN') || '').trim();
  var merchant = String(properties.getProperty('CLOVER_MERCHANT_ID') || '').trim();
  if (!token || !/^[A-Za-z0-9]{6,32}$/.test(merchant)) {
    logOnce_('prepay:setup', LOG_FAILURE_SECONDS, 'error', 'prepay_not_set_up', clock.date, '', 'Set CLOVER_CHECKOUT_TOKEN and CLOVER_MERCHANT_ID in the turnout app\'s Script Properties.');
    return prepayNo_('unavailable');
  }
  var count = prepayCount_(clock.date);
  if (!count) {
    logOnce_('prepay:cap:' + clock.date, LOG_REPEAT_SECONDS, 'error', 'prepay_cap_reached', clock.date, '', 'cap=' + PREPAY_DAILY_CAP);
    return prepayNo_('busy');
  }
  if (count === PREPAY_WARN_AT) log_('warn', 'prepay_cap_near', clock.date, '', 'count=' + count + ' cap=' + PREPAY_DAILY_CAP);

  var ref = 'P' + code_(CTTCTurnout.nameKey(name));
  var response;
  try {
    response = UrlFetchApp.fetch(PREPAY_CLOVER, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token, 'X-Clover-Merchant-Id': merchant },
      payload: JSON.stringify(prepayCheckout_(name, kind, clock.date, dollars)),
      muteHttpExceptions: true
    });
  } catch (error) {
    log_('error', 'prepay_failed', clock.date, ref, clean_(error && error.message || error));
    return prepayNo_('unavailable');
  }
  var code = response.getResponseCode();
  var answer = {};
  try { answer = JSON.parse(response.getContentText()) || {}; } catch (error) { answer = {}; }
  var href = String(answer.href || '');
  if (code < 200 || code >= 300 || !/^https:\/\/([a-z0-9-]+\.)*clover\.com\//i.test(href)) {
    log_('error', 'prepay_failed', clock.date, ref, 'HTTP ' + code + ' ' + clean_(answer.message || answer.error && answer.error.message || ''));
    return prepayNo_('unavailable');
  }
  log_('step', 'prepay_started', clock.date, ref, 'kind=' + kind + ' amount=$' + dollars + ' count=' + count);
  return { ok: true, href: href, amount: dollars };
}

function prepayNo_(reason, amount) {
  var answer = { ok: false, reason: reason, error: PREPAY_SORRY[reason] };
  if (amount !== undefined) {
    answer.amount = amount;
    answer.error = 'Tonight\'s price is $' + amount + '. Reload the page and try again.';
  }
  return answer;
}

// A name as the player picked or typed it: 2 to 60 characters with a letter, no digits, no @ or markup.
function prepayName_(value) {
  var name = String(value || '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 60 || /[0-9@<>{}\[\]\\\/"|=]/.test(name) || !/[A-Za-zÀ-ɏ]/.test(name)) return '';
  return name;
}

// Open on a round robin day the gym is not closed, until 8:30 PM or the night's end.
function prepayOpen_(clock) {
  var night = CTTCTurnout.sessionNight(clock, siteJson_('/data/closures.json'));
  return !!night && night.date === clock.date && clock.minutes < PREPAY_CLOSES;
}

function prepayFee_(kind, date) {
  var weekday = new Date(date + 'T12:00:00Z').getUTCDay();
  var special = PREPAY_SPECIAL_NIGHTS.filter(function (night) {
    return date >= night.from && date <= night.to && night.weekdays.indexOf(weekday) >= 0;
  })[0];
  return special ? special.fee : PREPAY_FEES[kind];
}

// What Clover is asked for: one line with the night, the fee and the name picked, which is what the desk matches on.
// No customer is sent: Clover's page locks a customer name it is given, and the name the desk knows a player by can
// differ from the name on their card, so the player fills in their own details on Clover's page.
function prepayCheckout_(name, kind, date, dollars) {
  var noon = new Date(date + 'T12:00:00Z');
  var day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][noon.getUTCDay()] + ' ' +
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][noon.getUTCMonth()] + ' ' + noon.getUTCDate();
  return {
    shoppingCart: { lineItems: [{ name: 'CTTC round robin, ' + day, price: dollars * 100, unitQty: 1, note: PREPAY_KINDS[kind] + ': ' + name }] },
    redirectUrls: { success: SITE + '/pay.html?paid=' + date, failure: SITE + '/pay.html?prepay=failed', cancel: SITE + '/pay.html?prepay=cancelled' }
  };
}

// Counts tonight's checkout and answers its number, or 0 once the cap is reached. Earlier days' counters are removed.
function prepayCount_(date) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return 0;
  try {
    var properties = PropertiesService.getScriptProperties();
    var key = PREPAY_COUNT_PREFIX + date;
    var count = Number(properties.getProperty(key) || 0) + 1;
    if (count > PREPAY_DAILY_CAP) return 0;
    properties.setProperty(key, String(count));
    Object.keys(properties.getProperties()).forEach(function (name) {
      if (name.indexOf(PREPAY_COUNT_PREFIX) === 0 && name !== key) properties.deleteProperty(name);
    });
    return count;
  } finally {
    lock.releaseLock();
  }
}
