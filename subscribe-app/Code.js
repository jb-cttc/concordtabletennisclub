// Public sign-up for the results email. This is a separate Apps Script project from the owner-only desk
// on purpose: a public web app exposes every function in its project, so the desk's code must never live here.
// The only thing this project can do is add one validated address to the Subscribers tab of the club database.
// The Sheet id is the script property DATABASE_ID (set in Project Settings), never committed.
// Deliberately strict: the first character must be a letter or digit, so nothing a spreadsheet would read as a formula
// (= + - @) and no quotes, brackets, commas or spaces can get through.
var EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+'-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;
var HEADERS = ['email', 'added_at'];
var MAX_SUBSCRIBERS = 2000;
var MAX_PER_MINUTE = 20;

// Emails this app sends: a welcome message after sign-up, and the two unsubscribe messages. Nothing else.
// Unsubscribing needs a link that was emailed to the address itself, so nobody can remove someone else.
var SITE_URL = 'https://concordtabletennisclub.com';
var UNSUBSCRIBE_PAGE = SITE_URL + '/unsubscribe.html';
var LATEST_EMAIL_URL = SITE_URL + '/data/latest-session-email.json';
var FROM_NAME = 'Concord Table Tennis Club';
var TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
// Links inside results emails are read days or weeks later, so they last a year. They can only ever unsubscribe
// the one address they were made for.
var EMAIL_LINK_TTL_MS = 365 * 24 * 60 * 60 * 1000;
var LINK_COOLDOWN_SECONDS = 600;
var MIN_QUOTA_WELCOME = 30;
var MIN_QUOTA_UNSUBSCRIBE = 5;
var LINK_SENT_MESSAGE = 'If that address is on the list, we have just emailed it a confirmation link. The link works for 24 hours.';

function page_(name, title) {
  return output_(HtmlService.createTemplateFromFile(name).evaluate(), title);
}

function output_(html, title) {
  return html
    .setTitle(title)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doGet(event) {
  var parameters = (event && event.parameter) || {};
  if (parameters.page === 'unsubscribe') return page_('Unsubscribe', 'CTTC unsubscribe');
  if (parameters.page === 'confirm') {
    // Opening the link only shows a question; nothing is removed until the person presses the button,
    // so mail scanners that open links cannot unsubscribe anyone.
    var address = emailFromToken_(parameters.t);
    var template = HtmlService.createTemplateFromFile('Confirm');
    template.token = address ? String(parameters.t) : '';
    template.email = address;
    return output_(template.evaluate(), 'CTTC unsubscribe');
  }
  return page_('Index', 'CTTC results email');
}

function subscribersSheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('DATABASE_ID');
  if (!id) throw new Error('DATABASE_ID is not set.');
  var spreadsheet = SpreadsheetApp.openById(id);
  var sheet = spreadsheet.getSheetByName('Subscribers');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Subscribers');
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function tooBusy_() {
  var cache = CacheService.getScriptCache();
  var key = 'rate:' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  return count > MAX_PER_MINUTE;
}

// Called by the form. Bots fill the hidden "website" field; real visitors never see it.
function subscribe(email, website) {
  var address = String(email || '').trim().toLowerCase();
  if (website) return { ok: true };
  if (address.length > 254 || address.indexOf('..') >= 0 || !EMAIL_PATTERN.test(address)) return { ok: false, message: 'Please enter a valid email address.' };
  var added = false;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_()) return { ok: false, message: 'Too many sign-ups right now. Please try again in a few minutes.' };
    var sheet = subscribersSheet_();
    var last = sheet.getLastRow();
    var existing = last > 1 ? sheet.getRange(2, 1, last - 1, 1).getValues().map(function (row) { return String(row[0]).trim().toLowerCase(); }) : [];
    if (existing.indexOf(address) < 0) {
      if (existing.length >= MAX_SUBSCRIBERS) return { ok: false, message: 'The list is full. Please contact the club.' };
      var target = sheet.getRange(last + 1, 1, 1, HEADERS.length);
      target.setNumberFormats([['@', 'yyyy-mm-dd hh:mm:ss']]);
      target.setValues([[address, new Date()]]);
      added = true;
    }
  } finally {
    lock.releaseLock();
  }
  // Only a new address gets the welcome email, and a mail problem never undoes the sign-up.
  if (added) sendWelcome_(address);
  return { ok: true };
}

// The same neutral answer is given whether or not the address is on the list, so this cannot be used to
// find out who subscribes. The link goes only to the address typed in.
function requestUnsubscribe(email, website) {
  var neutral = { ok: true, message: LINK_SENT_MESSAGE };
  if (website) return neutral;
  var address = String(email || '').trim().toLowerCase();
  if (address.length > 254 || address.indexOf('..') >= 0 || !EMAIL_PATTERN.test(address)) return { ok: false, message: 'Please enter a valid email address.' };
  var subscribed = false;
  var cooldownKey = 'link:' + hash_(address);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_()) return { ok: false, message: 'Too many requests right now. Please try again in a few minutes.' };
    subscribed = subscriberRows_(address).length > 0;
    if (subscribed) {
      var cache = CacheService.getScriptCache();
      if (cache.get(cooldownKey)) subscribed = false;
      else cache.put(cooldownKey, '1', LINK_COOLDOWN_SECONDS);
    }
  } finally {
    lock.releaseLock();
  }
  if (!subscribed) return neutral;
  if (!mailAvailable_(MIN_QUOTA_UNSUBSCRIBE)) {
    CacheService.getScriptCache().remove(cooldownKey);
    return { ok: false, message: 'We cannot send email right now. Please try again tomorrow.' };
  }
  var link = UNSUBSCRIBE_PAGE + '?t=' + makeToken_(address);
  try {
    sendMail_(address, 'Confirm: unsubscribe from CTTC results emails',
      'Someone (hopefully you) asked to stop the Concord Table Tennis Club results emails for this address.\n\n' +
      'To confirm, open this link and press the button on the page (it works for 24 hours):\n' + link + '\n\n' +
      'If you did not ask for this, ignore this email. You stay subscribed and nothing changes.',
      '<p>Someone (hopefully you) asked to stop the Concord Table Tennis Club results emails for this address.</p>' +
      '<p>To confirm, <a href="' + link + '">open this link</a> and press the button on the page. It works for 24 hours.</p>' +
      '<p style="color:#666">If you did not ask for this, ignore this email. You stay subscribed and nothing changes.</p>');
  } catch (error) {
    console.error('Could not send the unsubscribe link: ' + error);
    CacheService.getScriptCache().remove(cooldownKey);
    return { ok: false, message: 'We could not send the email. Please try again later.' };
  }
  return neutral;
}

// Called by the confirmation page. Removing the address and saying so by email only happen with a valid,
// unexpired link; using it again changes nothing and sends nothing.
function confirmUnsubscribe(token) {
  var address = emailFromToken_(token);
  if (!address) return { ok: false, message: 'This link has expired or is not valid. Please ask for a new one.' };
  var removed = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sheet = subscribersSheet_();
    subscriberRows_(address).sort(function (a, b) { return b - a; }).forEach(function (row) {
      sheet.deleteRow(row);
      removed += 1;
    });
  } finally {
    lock.releaseLock();
  }
  if (removed) {
    try {
      sendMail_(address, 'You are unsubscribed from CTTC results emails',
        'You are unsubscribed. We will not send any more Concord Table Tennis Club results emails to this address.\n\n' +
        'Changed your mind? You can join again any time with the Subscribe button at ' + SITE_URL + '/roundrobins.html',
        '<p>You are unsubscribed. We will not send any more Concord Table Tennis Club results emails to this address.</p>' +
        '<p>Changed your mind? You can join again any time with the Subscribe button on the <a href="' + SITE_URL + '/roundrobins.html">Round Robins page</a>.</p>');
    } catch (error) {
      console.error('Could not send the unsubscribed notice: ' + error);
    }
  }
  return { ok: true };
}

// Run once from the Apps Script editor after this project gains new permissions: it asks Google for the
// consent and sends nothing.
function authorizeEmail() {
  MailApp.getRemainingDailyQuota();
  UrlFetchApp.fetch(SITE_URL, { method: 'head', muteHttpExceptions: true });
}

function subscriberRows_(address) {
  var sheet = subscribersSheet_();
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var rows = [];
  sheet.getRange(2, 1, last - 1, 1).getValues().forEach(function (row, index) {
    if (String(row[0]).trim().toLowerCase() === address) rows.push(index + 2);
  });
  return rows;
}

function hash_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)).replace(/=+$/, '');
}

function secret_() {
  var properties = PropertiesService.getScriptProperties();
  var value = properties.getProperty('TOKEN_SECRET');
  if (!value) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      value = properties.getProperty('TOKEN_SECRET');
      if (!value) {
        value = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
        properties.setProperty('TOKEN_SECRET', value);
      }
    } finally {
      lock.releaseLock();
    }
  }
  return value;
}

function encode_(text) {
  return Utilities.base64EncodeWebSafe(text).replace(/=+$/, '');
}

function sign_(payload) {
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret_())).replace(/=+$/, '');
}

function sameText_(left, right) {
  if (left.length !== right.length) return false;
  var difference = 0;
  for (var i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function makeToken_(address, ttl) {
  var payload = encode_(JSON.stringify({ e: address, p: 'unsubscribe', x: Date.now() + (ttl || TOKEN_TTL_MS) }));
  return payload + '.' + sign_(payload);
}

// Returns the address a valid, unexpired unsubscribe link was made for, or ''.
function emailFromToken_(token) {
  token = String(token || '');
  if (!/^[A-Za-z0-9_-]{10,600}\.[A-Za-z0-9_-]{20,100}$/.test(token)) return '';
  var parts = token.split('.');
  if (!sameText_(sign_(parts[0]), parts[1])) return '';
  var data;
  try {
    var padded = parts[0];
    while (padded.length % 4) padded += '=';
    data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(padded)).getDataAsString());
  } catch (error) {
    return '';
  }
  if (!data || data.p !== 'unsubscribe' || !(Number(data.x) > Date.now()) || !EMAIL_PATTERN.test(String(data.e))) return '';
  return String(data.e);
}

function mailAvailable_(reserve) {
  return MailApp.getRemainingDailyQuota() > reserve;
}

function sendMail_(to, subject, text, html) {
  MailApp.sendEmail({ to: to, subject: subject, body: text, htmlBody: html, name: FROM_NAME });
}

// The most recent results email, built by the club's data pipeline and published with the site data.
function latestResults_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('latest-results');
  if (cached) return JSON.parse(cached);
  var response = UrlFetchApp.fetch(LATEST_EMAIL_URL, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return null;
  var data = JSON.parse(response.getContentText());
  if (!data || typeof data.html !== 'string' || typeof data.text !== 'string') return null;
  var latest = { html: data.html, text: data.text };
  try { cache.put('latest-results', JSON.stringify(latest), 600); } catch (error) { /* too large to cache */ }
  return latest;
}

function sendWelcome_(address) {
  try {
    if (!mailAvailable_(MIN_QUOTA_WELCOME)) return;
    var latest = null;
    try { latest = latestResults_(); } catch (error) { console.error('Could not load the latest results: ' + error); }
    var intro = latest
      ? "You're subscribed! You'll get an email that looks similar to this after each Round Robin Session. We've included the most recent CTTC Round Robin results below."
      : "You're subscribed! You'll get an email with the results after each Round Robin Session.";
    var personal = UNSUBSCRIBE_PAGE + '?t=' + makeToken_(address, EMAIL_LINK_TTL_MS);
    var footerText = 'You are receiving this because this address was signed up for CTTC results. To stop, open ' + personal;
    var footerHtml = '<p style="font-family:Georgia,serif;font-size:0.72rem;color:#999;max-width:560px;margin:8px auto 0;">You are receiving this because this address was signed up for CTTC results. <a href="' + personal + '" style="color:#999;">Unsubscribe</a></p>';
    sendMail_(address, "You're subscribed to CTTC results",
      intro + (latest ? '\n\n' + latest.text : '') + '\n\n' + footerText,
      '<p style="font-family:Georgia,serif;max-width:560px;margin:0 auto 20px;color:#1a1a1a;"><strong>' + intro + '</strong></p>' + (latest ? latest.html : '') + footerHtml);
  } catch (error) {
    console.error('Could not send the welcome email: ' + error);
  }
}
