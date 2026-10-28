// The one Gmail reader for every club app (GitHub PR #95). Gmail allows a free account about 20,000 reads a day, shared
// by the desk, coaching, staffing and turnout apps, and they used to search the same Voice texts separately every minute,
// re-reading each person's whole text history (Voice keeps all of a person's texts in one thread). The allowance ran out
// on round robin nights.
//
// Now a minute trigger here reads only mail that arrived since its last run, once, and records it:
//   - forwarded Google Voice texts in the VoiceTexts tab, which every app reads instead of Gmail (the coaching, staffing
//     and turnout apps open this Sheet by DESK_SHEET_ID);
//   - Zeffy play pass emails in ZeffyPayments (ZeffyTracking.js).
// A quiet minute costs one search. Gmail is otherwise opened only to send a reply, by message id.
//
// The MailReader tab holds when it last read, so the other apps can tell when texts stopped being collected, and how many
// Gmail calls it made today. Past MAIL_SLOW_AFTER_CALLS_ in a day it reads every 5 minutes instead of every minute.
var MAIL_TEXTS_TAB = 'VoiceTexts';
var MAIL_TEXTS_HEADERS = ['message_id', 'received_at', 'from', 'subject', 'text'];
var MAIL_READER_TAB = 'MailReader';
var MAIL_READER_HEADERS = ['read_at', 'cursor', 'day', 'gmail_calls'];
var MAIL_READER_HANDLER = 'readMail';
var MAIL_QUERY_ = 'in:anywhere (from:txt.voice.google.com OR from:communication.mailer.zeffy.com)';
// Each search reaches back this far before the last read, so mail Gmail is slow to make searchable is not missed.
var MAIL_OVERLAP_MS_ = 3 * 60000;
// The first read takes the last week; texts are kept as long as the apps look back (THREAD_DAYS in coaching and staffing).
var MAIL_FIRST_DAYS_ = 7;
var MAIL_KEEP_DAYS_ = 90;
var MAIL_FRESH_MS_ = 60000;
var MAIL_SLOW_AFTER_CALLS_ = 6000;
var MAIL_SLOW_MS_ = 5 * 60000;
var MAIL_VOICE_FOOTER_ = /^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i;

// The minute trigger. A failure (Gmail down, or its daily allowance spent) is logged at most every 10 minutes, not every
// minute; the run still fails, so the execution log shows each one.
function readMail() {
  try {
    return readMail_(30000);
  } catch (error) {
    var cache = CacheService.getScriptCache();
    if (!cache.get('mail-reader-failed')) {
      cache.put('mail-reader-failed', '1', 600);
      safeAudit_('mail_reader_failed', 'database', MAIL_READER_HANDLER, { message: error && error.message || String(error) });
    }
    throw error;
  }
}

// For the desk's own reads (Voice signups, Zeffy passes): reads Gmail only when the trigger has not just done so, and
// installs the trigger the first time. If Gmail fails, the desk carries on with the mail already recorded.
function readMailIfStale_(maxAgeMs) {
  ensureMailReaderTrigger_();
  return readMail_(maxAgeMs, true);
}

function ensureMailReaderTrigger_() {
  var cache = CacheService.getScriptCache();
  if (cache.get('mail-reader-trigger')) return;
  try {
    var installed = ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === MAIL_READER_HANDLER; });
    if (!installed) {
      ScriptApp.newTrigger(MAIL_READER_HANDLER).timeBased().everyMinutes(1).create();
      appendAudit_('mail_reader_enabled', 'database', MAIL_READER_HANDLER, { everyMinutes: 1 });
    }
    cache.put('mail-reader-trigger', '1', 21600);
  } catch (error) {
    console.warn('Mail reader trigger unavailable: ' + error);
  }
}

// Gmail can take seconds to answer and score saves wait on the script lock, so Gmail is read without it; the lock is held
// only to record what was found. Never call this while holding the lock. quiet: a Gmail failure is returned, not thrown.
function readMail_(maxAgeMs, quiet) {
  var lock = LockService.getScriptLock();
  if (lock.hasLock()) return { skipped: 'locked' };
  var sheets = mailReaderSheets_();
  var state = mailReaderState_(sheets.state);
  var now = Date.now();
  var day = Utilities.formatDate(new Date(now), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var calls = state.day === day ? state.calls : 0;
  if (now - state.readAt < maxAgeMs) return { skipped: 'fresh' };
  if (calls >= MAIL_SLOW_AFTER_CALLS_ && now - state.readAt < MAIL_SLOW_MS_) return { skipped: 'slowed' };
  var cache = CacheService.getScriptCache();
  if (cache.get('mail-reading')) return { skipped: 'running' };
  cache.put('mail-reading', '1', 120);
  try {
    var found;
    try {
      found = mailSince_(state.cursor ? state.cursor - MAIL_OVERLAP_MS_ : now - MAIL_FIRST_DAYS_ * 86400000, sheets.texts);
    } catch (error) {
      if (!quiet) throw error;
      console.warn('Mail not read: ' + error);
      return { skipped: 'failed' };
    }
    if (!lock.tryLock(10000)) return { skipped: 'busy' };
    var added;
    try {
      added = recordMail_(sheets.texts, found);
      if (state.day && state.day !== day) pruneMailTexts_(sheets.texts, now);
      writeMailReaderState_(sheets.state, [now, now, day, calls + found.calls]);
    } finally {
      lock.releaseLock();
    }
    if (state.day && state.day !== day) deskLog_('step', 'mail_reader_day', state.day, '', 'gmail_calls=' + state.calls);
    if (calls < MAIL_SLOW_AFTER_CALLS_ && calls + found.calls >= MAIL_SLOW_AFTER_CALLS_) {
      deskLog_('warn', 'gmail_reads_high', day, '', 'gmail_calls=' + (calls + found.calls) + ' reading every 5 minutes for the rest of the day');
    }
    return { texts: added.texts, zeffy: added.zeffy, gmailCalls: found.calls };
  } finally {
    cache.remove('mail-reading');
  }
}

// New Voice texts and Zeffy rows since the given time (ms). Each thread is read newest first and left at the first message
// already recorded or older than that, so a long text history costs nothing.
function mailSince_(since, textsSheet) {
  var known = {};
  mailTextRows_(textsSheet).forEach(function (row) { known[row.message_id] = true; });
  ensurePrivatePaymentTables_();
  var unreadable = {};
  rows_('ZeffyPayments').forEach(function (row) { (row.kind === 'unreadable' ? unreadable : known)[String(row.message_id)] = true; });
  var found = { texts: [], zeffy: [], calls: 0 };
  var zone = Session.getScriptTimeZone();
  for (var start = 0; ; start += 100) {
    var threads = GmailApp.search(MAIL_QUERY_ + ' after:' + Math.floor(since / 1000), start, 100);
    found.calls += 1;
    if (threads.length) {
      found.calls += 1;
      GmailApp.getMessagesForThreads(threads).forEach(function (messages) {
        for (var i = messages.length - 1; i >= 0; i -= 1) {
          var message = messages[i];
          var id = String(message.getId());
          var at = message.getDate().getTime();
          found.calls += 2;
          if (known[id] || at < since) break;
          known[id] = true;
          var from = String(message.getFrom() || '');
          var subject = String(message.getSubject() || '');
          found.calls += 3;
          var address = ((from.match(/<([^>]+)>/) || [null, from])[1] || '').trim().toLowerCase();
          if (/@txt\.voice\.google\.com$/.test(address)) {
            if (/^New (?:group )?text message from /i.test(subject)) {
              found.texts.push({ message_id: id, received_at: at, from: from, subject: subject, text: voiceBodyText_(message.getPlainBody()) });
            }
          } else {
            var rows = parseZeffyEmail_(from, subject, message.getPlainBody(), Utilities.formatDate(new Date(at), zone, 'yyyy-MM-dd'));
            if (unreadable[id] && rows.length && rows[0].kind === 'unreadable') continue;
            rows.forEach(function (row) {
              row.message_id = id;
              row.created_at = new Date();
              found.zeffy.push(row);
            });
          }
        }
      });
    }
    if (threads.length < 100) break;
  }
  return found;
}

// What the person wrote: Voice's links and footer taken out.
function voiceBodyText_(plain) {
  var lines = String(plain || '').split(/\r?\n/).map(function (line) { return line.trim(); });
  var body = [];
  for (var i = 0; i < lines.length; i += 1) {
    if (MAIL_VOICE_FOOTER_.test(lines[i])) break;
    if (!lines[i] || /^<https:\/\/voice\.google\.com[^>]*>$/.test(lines[i])) continue;
    body.push(lines[i]);
  }
  return body.join('\n').slice(0, 2000);
}

// Called with the lock held. Another run may have recorded the same mail meanwhile, so both tabs are checked again.
function recordMail_(textsSheet, found) {
  var stored = {};
  mailTextRows_(textsSheet).forEach(function (row) { stored[row.message_id] = true; });
  var texts = found.texts.filter(function (text) { return !stored[text.message_id] && (stored[text.message_id] = true); })
  .sort(function (left, right) { return left.received_at - right.received_at; });
  appendTextRows_(textsSheet, texts.map(function (text) { return MAIL_TEXTS_HEADERS.map(function (header) { return String(text[header]); }); }));
  var recorded = {};
  rows_('ZeffyPayments').forEach(function (row) { if (row.kind !== 'unreadable') recorded[String(row.message_id)] = true; });
  var zeffy = found.zeffy.filter(function (row) { return !recorded[row.message_id]; });
  appendObjects_('ZeffyPayments', zeffy);
  return { texts: texts.length, zeffy: zeffy.length };
}

// Texts are recorded oldest run first, so the old ones are the first rows.
function pruneMailTexts_(textsSheet, now) {
  var cutoff = now - MAIL_KEEP_DAYS_ * 86400000;
  var rows = mailTextRows_(textsSheet);
  var old = 0;
  while (old < rows.length && rows[old].received_at < cutoff) old += 1;
  if (old) textsSheet.deleteRows(2, old);
}

// Forwarded Voice texts received from fromMs up to toMs, oldest first, shaped like the Gmail messages they came from, so the
// code that reads them is unchanged. Only replying opens the real message.
function storedVoiceMessages_(fromMs, toMs) {
  return mailTextRows_(mailReaderSheets_().texts).filter(function (row) { return row.received_at >= fromMs && row.received_at < toMs; })
  .sort(function (left, right) { return left.received_at - right.received_at; }).map(storedVoiceMessage_);
}

function storedVoiceMessage_(row) {
  var real = null;
  var gmail = function () { return real || (real = GmailApp.getMessageById(row.message_id)); };
  return {
    getId: function () { return row.message_id; },
    getFrom: function () { return row.from; },
    getSubject: function () { return row.subject; },
    getPlainBody: function () { return row.text; },
    getDate: function () { return new Date(row.received_at); },
    getReplyTo: function () { return gmail().getReplyTo(); },
    getThread: function () { return gmail().getThread(); },
    reply: function (body) { return gmail().reply(body); }
  };
}

function mailTextRows_(textsSheet) {
  var values = textsSheet.getDataRange().getValues();
  return values.slice(1).filter(function (row) { return String(row[0]); }).map(function (row) {
    return { message_id: String(row[0]), received_at: Number(row[1]), from: String(row[2]), subject: String(row[3]), text: String(row[4]) };
  });
}

function mailReaderSheets_() {
  return { texts: mailSheet_(MAIL_TEXTS_TAB, MAIL_TEXTS_HEADERS), state: mailSheet_(MAIL_READER_TAB, MAIL_READER_HEADERS) };
}

function mailSheet_(name, headers) {
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    ensureHeader_(sheet, headers);
    formatTable_(sheet, headers.length);
  }
  return sheet;
}

function mailReaderState_(stateSheet) {
  var row = stateSheet.getLastRow() >= 2 ? stateSheet.getRange(2, 1, 1, MAIL_READER_HEADERS.length).getValues()[0] : [];
  return { readAt: Number(row[0]) || 0, cursor: Number(row[1]) || 0, day: String(row[2] || ''), calls: Number(row[3]) || 0 };
}

function writeMailReaderState_(stateSheet, values) {
  stateSheet.getRange(2, 1, 1, values.length).setNumberFormat('@').setValues([values.map(String)]);
}

// Plain text cells, so an id or a number is never turned into a date or a rounded number.
function appendTextRows_(sheet, values) {
  if (!values.length) return;
  var first = sheet.getLastRow() + 1;
  var missing = first + values.length - 1 - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
  sheet.getRange(first, 1, values.length, values[0].length).setNumberFormat('@').setValues(values);
}
