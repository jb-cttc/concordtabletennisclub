// Email list (?view=subscribers, framed by the club site's email-list.html): the club account's read-only view of the
// Subscribers tab, the list that gets the automated round robin results emails (scripts/send-session-email.js) and the
// executive committee's occasional updates, which the club sends by hand from Gmail with these addresses in Bcc.
// Like the rest of the desk it opens only for the club's Google account. It never writes to the tab: visitors add
// themselves with the site's Subscribe button (subscribe-app/) and remove themselves with the Unsubscribe link, so the
// list is always current when it is copied.
var EMAIL_LIST_TAB_ = 'Subscribers';
var EMAIL_LIST_UNSUBSCRIBE_URL_ = 'https://concordtabletennisclub.com/unsubscribe.html';
// The club's free Gmail account sends to about 500 recipients a day, shared by the results emails (one per subscriber
// each round robin night) and anything sent by hand (docs/google-limits.md).
var EMAIL_LIST_DAILY_RECIPIENTS_ = 500;
var EMAIL_LIST_PATTERN_ = /^[^\s@,;<>"']+@[^\s@,;<>"']+\.[^\s@,;<>"']+$/;

function emailListPage_() {
  return HtmlService.createHtmlOutputFromFile('EmailListPage')
    .setTitle(deskMode_() === 'dev' ? 'DEV - CTTC Email list' : 'CTTC Email list')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The list, oldest sign-up first, with any blank, malformed or repeated row left out. One Sheet read; the desk log
// records that it was opened and how many addresses it held, never the addresses.
function getEmailList() {
  return guardDesk_('email_list', function () {
    var sheet = SpreadsheetApp.getActive().getSheetByName(EMAIL_LIST_TAB_);
    var rows = sheet && sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues() : [];
    var addresses = emailListFromRows_(rows, Session.getScriptTimeZone());
    appendAudit_('email_list_opened', 'database', EMAIL_LIST_TAB_, { count: addresses.length });
    return { ok: true, addresses: addresses, dailyLimit: EMAIL_LIST_DAILY_RECIPIENTS_, unsubscribeUrl: EMAIL_LIST_UNSUBSCRIBE_URL_ };
  });
}

function emailListFromRows_(rows, timeZone) {
  var seen = {};
  var list = [];
  rows.forEach(function (row) {
    var email = String(row[0] || '').trim().toLowerCase();
    if (!EMAIL_LIST_PATTERN_.test(email) || seen[email]) return;
    seen[email] = true;
    var added = Object.prototype.toString.call(row[1]) === '[object Date]' ? Utilities.formatDate(row[1], timeZone, 'yyyy-MM-dd') : String(row[1] || '').slice(0, 10);
    list.push({ email: email, added: added });
  });
  return list;
}
