// The one Gmail reader for every club app (GitHub PR #95). Gmail allows a free account about 20,000 reads a day, shared
// by the desk, coaching, staffing and turnout apps, and they used to search the same Voice texts separately every minute,
// re-reading each person's whole text history (Voice keeps all of a person's texts in one thread). The allowance ran out
// on round robin nights.
//
// Now one job here reads only mail that arrived since its last read, once, and records it:
//   - forwarded Google Voice texts in the VoiceTexts tab, which every app reads instead of Gmail (the coaching, staffing
//     and turnout apps open this Sheet by DESK_SHEET_ID);
//   - Zeffy play pass emails in ZeffyPayments (ZeffyTracking.js).
// A quiet read costs one search. Gmail is otherwise opened only to send a reply, by message id.
//
// The job wakes only as often as texts matter (mailReadEvery_): every minute in the last 4 hours before a round robin's
// sign-up closes, when most signups come in, every 5 minutes otherwise by day (and from 6 AM on a round robin day, when
// the automatic answers start), every 30 minutes from 11 PM to 7 AM. Waking costs scheduled-job run time (Google allows
// 90 minutes a day across every club app, JobRuntime.js), so the job never wakes just to find nothing due: a 30-minute
// timer (readMailWatch) always runs, covers the night and restarts the chain if a run ever fails, and each run sets a
// one-off timer (readMail) for when the next read is due, if that is sooner. After a read that brought new texts, the
// job answers round robin texts (VoiceAutoReply.js), which has no timer of its own. A desk with Voice signups open still
// reads within the minute.
//
// The MailReader tab holds when it last read, so the other apps can tell when texts stopped being collected, and how many
// Gmail calls it made today. Past MAIL_SLOW_AFTER_CALLS_ in a day it reads at most every 5 minutes.
var MAIL_TEXTS_TAB = 'VoiceTexts';
var MAIL_TEXTS_HEADERS = ['message_id', 'received_at', 'from', 'subject', 'text'];
var MAIL_READER_TAB = 'MailReader';
var MAIL_READER_HEADERS = ['read_at', 'cursor', 'day', 'gmail_calls'];
var MAIL_READER_HANDLER = 'readMail';
var MAIL_WATCH_HANDLER = 'readMailWatch';
// Raised when the job's timers change: the next run removes the old ones (an every-minute readMail until October 2026,
// and the automatic answers' own timer) and sets the new ones.
var MAIL_SCHEDULE_KEY_ = 'CTTC_MAIL_SCHEDULE';
var MAIL_SCHEDULE_VERSION_ = '2';
var MAIL_LAST_TEXT_KEY_ = 'CTTC_MAIL_LAST_TEXT_AT';
var MAIL_NEXT_KEY_ = 'CTTC_MAIL_NEXT_AT';
var MAIL_QUERY_ = 'in:anywhere (from:txt.voice.google.com OR from:communication.mailer.zeffy.com)';
// Each search reaches back this far before the last read, so mail Gmail is slow to make searchable is not missed.
var MAIL_OVERLAP_MS_ = 3 * 60000;
// The first read takes the last week; texts are kept as long as the apps look back (THREAD_DAYS in coaching and staffing).
var MAIL_FIRST_DAYS_ = 7;
var MAIL_KEEP_DAYS_ = 90;
var MAIL_FRESH_MS_ = 60000;
// Every minute only for this long before sign-up closes: 3:15 to 7:15 PM on Mondays and Wednesdays, 11:15 AM to 3:15 PM
// for the Saturday pilot. Earlier in the day every 5 minutes is soon enough, and saves about 440 timer runs a round
// robin day (docs/google-limits.md).
var MAIL_BUSY_MINUTES_ = 4 * 60;
var MAIL_DAY_EVERY_MS_ = 5 * 60000;
// 11 PM to 7 AM, Pacific.
var MAIL_NIGHT_FROM_ = 23 * 60;
var MAIL_NIGHT_UNTIL_ = 7 * 60;
var MAIL_NIGHT_EVERY_MS_ = 30 * 60000;
var MAIL_SLOW_AFTER_CALLS_ = 6000;
var MAIL_SLOW_MS_ = 5 * 60000;
var MAIL_VOICE_FOOTER_ = /^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i;

// The one-off timer and the 30-minute timer run the same job.
function readMail(event) { return mailJob_(event); }
function readMailWatch(event) { return mailJob_(event); }

// Sets the next timer first, so a run that fails still leaves the chain going; then reads, then answers new texts. A
// failure (Gmail down, or its daily allowance spent) is logged at most every 10 minutes; the run still fails, so the
// execution log shows each one.
function mailJob_(event) {
  return timedJob_(event, function () {
    var now = new Date();
    ensureMailJob_();
    armMailJob_(now);
    var result;
    try {
      // Timers fire a little early or late, so a read due now is not put off to the next one.
      result = readMail_(mailReadEvery_(now) - 30000);
    } catch (error) {
      var cache = CacheService.getScriptCache();
      if (!cache.get('mail-reader-failed')) {
        cache.put('mail-reader-failed', '1', 600);
        safeAudit_('mail_reader_failed', 'database', MAIL_READER_HANDLER, { message: error && error.message || String(error) });
      }
      throw error;
    }
    result.answered = answerNewTexts_(now);
    return result;
  });
}

// For the desk's own reads (Voice signups, Zeffy passes): reads Gmail only when the job has not just done so, and sets
// up the job's timers the first time. If Gmail fails, the desk carries on with the mail already recorded.
function readMailIfStale_(maxAgeMs) {
  var cache = CacheService.getScriptCache();
  if (!cache.get('mail-job-checked')) {
    ensureMailJob_();
    cache.put('mail-job-checked', '1', 21600);
  }
  return readMail_(maxAgeMs, true);
}

// How often Gmail is read at this moment: every minute in the last MAIL_BUSY_MINUTES_ before a round robin's sign-up
// closes (the days and times of the desk's automatic answers, VOICE_REPLY_DAYS), every 5 minutes otherwise by day and from
// 6 AM on a round robin day, every 30 minutes from 11 PM to 7 AM. A third as often (not at night) once every app's timers together have run a lot today (JobRuntime.js).
function mailReadEvery_(now) {
  return mailSlowed_(mailCadence_(now), jobsSlowed_());
}

function mailCadence_(now) {
  var zone = Session.getScriptTimeZone();
  var date = Utilities.formatDate(now, zone, 'yyyy-MM-dd');
  var minutes = Number(Utilities.formatDate(now, zone, 'H')) * 60 + Number(Utilities.formatDate(now, zone, 'm'));
  var day = VOICE_REPLY_DAYS[new Date(date + 'T12:00:00Z').getUTCDay()];
  var signup = day && !(day.from && date < day.from) && minutes >= VOICE_REPLY_FROM && minutes < day.until;
  if (signup) return minutes >= day.until - MAIL_BUSY_MINUTES_ ? MAIL_FRESH_MS_ : MAIL_DAY_EVERY_MS_;
  return minutes >= MAIL_NIGHT_FROM_ || minutes < MAIL_NIGHT_UNTIL_ ? MAIL_NIGHT_EVERY_MS_ : MAIL_DAY_EVERY_MS_;
}

function mailSlowed_(every, slow) {
  return slow && every < MAIL_NIGHT_EVERY_MS_ ? every * 3 : every;
}

// When the next read is due: the usual gap, or sooner if a busier stretch (round robin sign-up) starts before then. The
// shared slow-down is read once: settings reads count toward a daily limit too (docs/google-limits.md).
function mailNextDelay_(now, slow) {
  var every = mailSlowed_(mailCadence_(now), slow);
  for (var ahead = 60000; ahead < every; ahead += 60000) {
    if (mailSlowed_(mailCadence_(new Date(now.getTime() + ahead)), slow) < every) return ahead;
  }
  return every;
}

// The one-off timer for the next read, replacing any earlier one. None when the next read falls at night: the 30-minute
// timer covers it.
function armMailJob_(now) {
  try {
    var slow = jobsSlowed_();
    var delay = mailNextDelay_(now, slow);
    var night = mailSlowed_(mailCadence_(new Date(now.getTime() + delay)), slow) >= MAIL_NIGHT_EVERY_MS_;
    ScriptApp.getProjectTriggers().forEach(function (trigger) {
      if (trigger.getHandlerFunction() === MAIL_READER_HANDLER) ScriptApp.deleteTrigger(trigger);
    });
    if (!night) ScriptApp.newTrigger(MAIL_READER_HANDLER).timeBased().after(delay).create();
    PropertiesService.getScriptProperties().setProperty(MAIL_NEXT_KEY_, String(now.getTime() + delay));
  } catch (error) {
    console.warn('Next mail read not set: ' + error);
  }
}

// The 30-minute timer, installed once; the first run of a new schedule removes the old timers.
function ensureMailJob_() {
  var properties = PropertiesService.getScriptProperties();
  try {
    var triggers = ScriptApp.getProjectTriggers();
    if (properties.getProperty(MAIL_SCHEDULE_KEY_) !== MAIL_SCHEDULE_VERSION_) {
      triggers.forEach(function (trigger) {
        var handler = trigger.getHandlerFunction();
        if (handler === MAIL_READER_HANDLER || handler === VOICE_AUTO_REPLY_HANDLER) ScriptApp.deleteTrigger(trigger);
      });
      properties.setProperty(MAIL_SCHEDULE_KEY_, MAIL_SCHEDULE_VERSION_);
      triggers = ScriptApp.getProjectTriggers();
    }
    if (!triggers.some(function (trigger) { return trigger.getHandlerFunction() === MAIL_WATCH_HANDLER; })) {
      ScriptApp.newTrigger(MAIL_WATCH_HANDLER).timeBased().everyMinutes(30).create();
      appendAudit_('mail_reader_enabled', 'database', MAIL_WATCH_HANDLER, { everyMinutes: 30 });
      armMailJob_(new Date());
    }
  } catch (error) {
    console.warn('Mail job timers unavailable: ' + error);
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
    var added = { texts: 0, zeffy: 0 };
    try {
      if (found.texts.length || found.zeffy.length) added = recordMail_(sheets.texts, found);
      if (state.day && state.day !== day) pruneMailTexts_(sheets.texts, now);
      writeMailReaderState_(sheets.state, [now, now, day, calls + found.calls]);
    } finally {
      lock.releaseLock();
    }
    if (state.day && state.day !== day) deskLog_('step', 'mail_reader_day', state.day, '', 'gmail_calls=' + state.calls);
    if (calls < MAIL_SLOW_AFTER_CALLS_ && calls + found.calls >= MAIL_SLOW_AFTER_CALLS_) {
      deskLog_('warn', 'gmail_reads_high', day, '', 'gmail_calls=' + (calls + found.calls) + ' reading every 5 minutes for the rest of the day');
    }
    // The automatic answers look at the texts only when one came in since they last did.
    if (added.texts) {
      var newest = Math.max.apply(null, found.texts.map(function (text) { return text.received_at; }));
      PropertiesService.getScriptProperties().setProperty(MAIL_LAST_TEXT_KEY_, String(Math.max(newest, Number(PropertiesService.getScriptProperties().getProperty(MAIL_LAST_TEXT_KEY_)) || 0)));
    }
    return { texts: added.texts, zeffy: added.zeffy, gmailCalls: found.calls };
  } finally {
    cache.remove('mail-reading');
  }
}

// New Voice texts and Zeffy rows since the given time (ms). Each thread is read newest first and left at the first message
// already recorded or older than that, so a long text history costs nothing.
function mailSince_(since, textsSheet) {
  // What is already recorded is read only when Gmail has something, so a quiet read is one search.
  var known = null;
  var unreadable = {};
  var loadKnown = function () {
    known = {};
    mailTextRows_(textsSheet).forEach(function (row) { known[row.message_id] = true; });
    ensurePrivatePaymentTables_();
    rows_('ZeffyPayments').forEach(function (row) { (row.kind === 'unreadable' ? unreadable : known)[String(row.message_id)] = true; });
  };
  var found = { texts: [], zeffy: [], calls: 0 };
  var zone = Session.getScriptTimeZone();
  for (var start = 0; ; start += 100) {
    var threads = GmailApp.search(MAIL_QUERY_ + ' after:' + Math.floor(since / 1000), start, 100);
    found.calls += 1;
    if (threads.length) {
      if (!known) loadKnown();
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
