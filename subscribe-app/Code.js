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

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('CTTC results email')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
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
    }
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}
