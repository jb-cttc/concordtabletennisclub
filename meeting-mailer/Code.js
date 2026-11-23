// CTTC Meeting Mailer: sends two kinds of email from the club account, and nothing else:
//   - the executive committee's DRAFT NOTES (the meeting summary a maintainer prepares for the secretary to review and
//     send on; scripts/meeting-draft-email.js), subject "[DRAFT NOTES] ...", sender name "CTTC Executive Committee";
//   - short club messages a maintainer is asked to send (a coaching update for a coach, say; scripts/club-email.js),
//     subject "[CTTC] ...", sender name "Concord Table Tennis Club".
// Its own Apps Script project, so the meeting app (meeting-app/) never needs an email permission and cannot be held up by
// one. The web app opens only for the club's Google account (access MYSELF); nothing here is a button for people: the
// scripts call sendDraftNotes and sendClubMessage through this page.
//
// Every email: at most MAX_TO recipients plus a copy (Cc) to the club account, always, so the club's Inbox keeps
// everything sent (a script's email is not filed in Sent). The scripts take the club address from the club sign-in
// itself; the mailer refuses a send with no copy, and remembers the club address from its first send (script property
// CLUB_COPY) and refuses a copy to any other address, so it can never send something the club does not see. An HTML
// body with a plain-text copy. It checks the club account's shared daily email allowance first (every club app shares
// it, docs/google-limits.md) and keeps MIN_QUOTA for the other apps; it refuses the same subject to the same people
// twice within REPEAT_MS unless asked to resend; and it keeps a log of each send (script property SENT_LOG, the last
// LOG_KEEP).
var MIN_QUOTA = 10;
var MAX_TO = 3;
var MAX_HTML = 200000;
var MAX_TEXT = 100000;
var REPEAT_MS = 30 * 60 * 1000;
var LOG_KEY = 'SENT_LOG';
var LOG_KEEP = 50;
var CLUB_KEY = 'CLUB_COPY';
var KINDS = {
  draft: { subject: /^\[DRAFT NOTES\] \S/, says: 'start with [DRAFT NOTES]', name: 'CTTC Executive Committee' },
  club: { subject: /^\[CTTC\] \S/, says: 'start with [CTTC]', name: 'Concord Table Tennis Club' }
};
var EMAIL = /^[^\s@<>(),;:"\[\]]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

function doGet() {
  return HtmlService.createHtmlOutput('<!doctype html><title>CTTC Meeting Mailer</title><p id="ready" style="font:16px Arial,sans-serif;padding:24px">CTTC Meeting Mailer is ready. Draft notes and club messages are sent from the maintainers\' scripts; there is nothing to do on this page.</p>')
    .setTitle('CTTC Meeting Mailer');
}

// draft: { to: [emails], copy: [the club account] (Cc), subject, html, text, meetingId, resend }. Returns { sent, to,
// copy, subject, at, quotaLeft }.
function sendDraftNotes(draft) { return send_('draft', draft || {}); }

// message: { to: [emails], copy: [the club account] (Cc), subject ("[CTTC] ..."), html, text, resend }. Same answer.
function sendClubMessage(message) { return send_('club', message || {}); }

function send_(kind, draft) {
  var rules = KINDS[kind];
  var clean = function (list) { return (Array.isArray(list) ? list : list ? [list] : []).map(function (e) { return String(e || '').trim().toLowerCase(); }).filter(Boolean); };
  var copy = clean(draft.copy);
  var to = clean(draft.to).filter(function (e) { return copy.indexOf(e) < 0; });
  if (!to.length || to.length > MAX_TO) throw new Error('Not sent: give 1 to ' + MAX_TO + ' recipients (the copy to the club account is added on top).');
  if (copy.length !== 1) throw new Error('Not sent: every email is copied to the club account, and only to it.');
  to.concat(copy).forEach(function (e) { if (!EMAIL.test(e)) throw new Error('Not sent: "' + e + '" is not an email address.'); });
  var subject = String(draft.subject || '').replace(/[\r\n]+/g, ' ').trim();
  if (!rules.subject.test(subject) || subject.length > 200) throw new Error('Not sent: the subject must ' + rules.says + '.');
  var html = String(draft.html || '');
  var text = String(draft.text || '');
  if (!html || html.length > MAX_HTML || !text || text.length > MAX_TEXT) throw new Error('Not sent: the email needs an HTML body and a plain-text copy (at most ' + MAX_HTML + ' characters).');
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('Not sent: another send is in progress.');
  try {
    var properties = PropertiesService.getScriptProperties();
    var club = properties.getProperty(CLUB_KEY);
    if (club && copy[0] !== club) throw new Error('Not sent: the copy must go to the club account, as every earlier email did.');
    var log = sentLog();
    var key = to.slice().sort().join(',') + '|' + subject;
    var now = Date.now();
    var recent = log.filter(function (entry) { return entry.key === key && now - entry.at < REPEAT_MS; })[0];
    if (recent && !draft.resend) throw new Error('Not sent: the same email went to the same people ' + Math.round((now - recent.at) / 60000) + ' minutes ago. Ask to resend if that is intended.');
    var left = MailApp.getRemainingDailyQuota();
    var count = to.length + copy.length;
    if (left - count < MIN_QUOTA) throw new Error('Not sent: only ' + left + ' email recipients are left today for every club app (keeping ' + MIN_QUOTA + '). Try again tomorrow.');
    MailApp.sendEmail({ to: to.join(','), cc: copy[0], subject: subject, htmlBody: html, body: text, name: rules.name });
    if (!club) properties.setProperty(CLUB_KEY, copy[0]);
    log.push({ at: now, kind: kind, key: key, to: to, copy: copy, subject: subject, meetingId: String(draft.meetingId || '').slice(0, 40), size: html.length });
    properties.setProperty(LOG_KEY, JSON.stringify(log.slice(-LOG_KEEP)));
    return { sent: true, to: to, copy: copy, subject: subject, at: now, quotaLeft: left - count };
  } finally {
    lock.releaseLock();
  }
}

// The sends kept, oldest first: [{ at, kind, to, copy, subject, meetingId, size }].
function sentLog() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty(LOG_KEY) || '[]'); } catch (error) { return []; }
}
