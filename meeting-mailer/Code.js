// CTTC Meeting Mailer: sends the executive committee's DRAFT NOTES email (the meeting summary a maintainer prepares
// for the secretary to review and send on). Its own Apps Script project, so the meeting app (meeting-app/) never needs
// an email permission and cannot be held up by one. The web app opens only for the club's Google account (access
// MYSELF); nothing here is a button for people: scripts/meeting-draft-email.js calls sendDraftNotes through this page.
//
// What it will send, and nothing else: a subject that starts "[DRAFT NOTES] ", at most MAX_TO recipients (counting the
// copy to the club account, which the script adds so the club's Inbox keeps each draft: a script's email is not filed
// in Sent), an HTML body
// with a plain-text copy. It checks the club account's shared daily email allowance first (every club app shares it,
// docs/google-limits.md) and keeps MIN_QUOTA for the other apps; it refuses the same subject to the same people twice
// within REPEAT_MS unless asked to resend; and it keeps a log of each send (script property SENT_LOG, the last LOG_KEEP).
var MIN_QUOTA = 10;
var MAX_TO = 3;
var MAX_HTML = 200000;
var MAX_TEXT = 100000;
var REPEAT_MS = 30 * 60 * 1000;
var LOG_KEY = 'SENT_LOG';
var LOG_KEEP = 50;
var SUBJECT = /^\[DRAFT NOTES\] \S/;
var EMAIL = /^[^\s@<>(),;:"\[\]]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function doGet() {
  return HtmlService.createHtmlOutput('<!doctype html><title>CTTC Meeting Mailer</title><p id="ready" style="font:16px Arial,sans-serif;padding:24px">CTTC Meeting Mailer is ready. Draft notes are sent from the maintainers\' script; there is nothing to do on this page.</p>')
    .setTitle('CTTC Meeting Mailer');
}

// draft: { to: [emails], copy: [emails] (Cc), subject, html, text, meetingId, resend }. Returns { sent, to, copy,
// subject, at, quotaLeft }.
function sendDraftNotes(draft) {
  draft = draft || {};
  var clean = function (list) { return (Array.isArray(list) ? list : list ? [list] : []).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean); };
  var to = clean(draft.to);
  var copy = clean(draft.copy).filter(function (e) { return to.indexOf(e) < 0; });
  if (!to.length || to.length + copy.length > MAX_TO) throw new Error('Not sent: give 1 to ' + MAX_TO + ' recipients, counting the copy.');
  to.concat(copy).forEach(function (e) { if (!EMAIL.test(e)) throw new Error('Not sent: "' + e + '" is not an email address.'); });
  var subject = String(draft.subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!SUBJECT.test(subject) || subject.length > 200) throw new Error('Not sent: the subject must start with [DRAFT NOTES] (this mailer sends draft notes only).');
  var html = String(draft.html || '');
  var text = String(draft.text || '');
  if (!html || html.length > MAX_HTML || !text || text.length > MAX_TEXT) throw new Error('Not sent: the email needs an HTML body and a plain-text copy (at most ' + MAX_HTML + ' characters).');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Not sent: another send is in progress.');
  try {
    var log = sentLog();
    var key = to.slice().sort().join(',') + '|' + subject;
    var now = Date.now();
    var recent = log.filter(function (entry) { return entry.key === key && now - entry.at < REPEAT_MS; })[0];
    if (recent && !draft.resend) throw new Error('Not sent: the same draft went to the same people ' + Math.round((now - recent.at) / 60000) + ' minutes ago. Ask to resend if that is intended.');
    var left = MailApp.getRemainingDailyQuota();
    var count = to.length + copy.length;
    if (left - count < MIN_QUOTA) throw new Error('Not sent: only ' + left + ' email recipients are left today for every club app (keeping ' + MIN_QUOTA + '). Try again tomorrow.');
    var message = { to: to.join(','), subject: subject, htmlBody: html, body: text, name: 'CTTC Executive Committee' };
    if (copy.length) message.cc = copy.join(',');
    MailApp.sendEmail(message);
    log.push({ at: now, key: key, to: to, copy: copy, subject: subject, meetingId: String(draft.meetingId || '').slice(0, 40), size: html.length });
    PropertiesService.getScriptProperties().setProperty(LOG_KEY, JSON.stringify(log.slice(-LOG_KEEP)));
    return { sent: true, to: to, copy: copy, subject: subject, at: now, quotaLeft: left - count };
  } finally {
    lock.releaseLock();
  }
}

// The sends kept, oldest first: [{ at, to, subject, meetingId, size }].
function sentLog() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(LOG_KEY) || '[]'); } catch (error) { return []; }
}
