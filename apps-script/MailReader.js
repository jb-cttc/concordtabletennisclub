// The one Gmail reader for every club app (GitHub PR #95). Gmail allows a free account about 20,000 reads a day, shared
// by the desk, coaching, staffing and turnout apps, and they used to search the same Voice texts separately every minute,
// re-reading each person's whole text history (Voice keeps all of a person's texts in one thread). The allowance ran out
// on round robin nights.
//
// Now one job here reads only mail that arrived since its last read, once, and records it:
//   - forwarded Google Voice texts in the VoiceTexts tab, which every app reads instead of Gmail (the coaching, staffing
//     and turnout apps open this Sheet by DESK_SHEET_ID);
//   - Zeffy play pass emails in ZeffyPayments (ZeffyTracking.js);
//   - email replies to the coaching and staffing apps' questions are not recorded: they only wake that app (below).
// A quiet read costs one search. Gmail is otherwise opened only to send a reply, by message id.
//
// The job reads only as often as texts matter (mailReadEvery_): every minute in the last 4 hours before a round robin's
// sign-up closes, when most signups come in, every 5 minutes otherwise by day (and from 6 AM on a round robin day, when
// the automatic answers start), every 30 minutes from 11 PM to 7 AM. Each run costs scheduled-job run time (Google allows
// 90 minutes a day across every club app, JobRuntime.js), and so does changing a timer, so the job keeps one repeating
// timer (readMail) at the pace due now and replaces it only when the pace changes (setMailTimer_): a quiet run makes no
// timer calls. After a read that brought new texts, the job answers round robin texts (VoiceAutoReply.js), which has no
// timer of its own. A desk with Voice signups open still reads within the minute.
//
// The MailReader tab holds when it last read, so the other apps can tell when texts stopped being collected, and how many
// Gmail calls it made today. Past MAIL_SLOW_AFTER_CALLS_ in a day it reads at most every 5 minutes.
var MAIL_TEXTS_TAB = 'VoiceTexts';
var MAIL_TEXTS_HEADERS = ['message_id', 'received_at', 'from', 'subject', 'text'];
var MAIL_READER_TAB = 'MailReader';
var MAIL_READER_HEADERS = ['read_at', 'cursor', 'day', 'gmail_calls'];
var MAIL_READER_HANDLER = 'readMail';
// Until November 2026 a 30-minute timer ran the job alongside a one-off readMail set by every run.
var MAIL_WATCH_HANDLER = 'readMailWatch';
// The timer now set, as the schedule version and its minutes ("3:5"). Raising the version makes the next run remove the
// old timers (an every-minute readMail until October 2026 and the automatic answers' own timer; then readMailWatch and
// the one-off readMail) and set the new one.
var MAIL_TIMER_KEY_ = 'CTTC_MAIL_TIMER';
var MAIL_SCHEDULE_VERSION_ = '3';
// Google repeats a timer only every 1, 5, 10, 15 or 30 minutes.
var MAIL_TIMER_MINUTES_ = [1, 5, 10, 15, 30];
var MAIL_LAST_TEXT_KEY_ = 'CTTC_MAIL_LAST_TEXT_AT';
var MAIL_QUERY_ = 'in:anywhere (from:txt.voice.google.com OR from:communication.mailer.zeffy.com OR subject:"CTTC ref" OR subject:"CTTC shift")';
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

// The job's timer. readMailWatch is the old 30-minute one: its first run of this version removes it.
function readMail(event) { return mailJob_(event); }
function readMailWatch(event) { return mailJob_(event); }

// Sets the timer first (only if the pace changed), then reads, answers new texts and wakes the apps waiting on what came
// in. A failure (Gmail down, or its daily allowance spent) is logged at most every 10 minutes; the run still fails, so the
// execution log shows each one, and the timer keeps going. The shared slow-down is read once: settings reads count toward a
// daily limit too (docs/google-limits.md).
function mailJob_(event) {
  return timedJob_(event, function () {
    var now = new Date();
    var slow = jobsSlowed_();
    setMailTimer_(now, slow);
    var result;
    try {
      // Timers fire a little early or late, so a read due now is not put off to the next one.
      result = readMail_(mailSlowed_(mailCadence_(now), slow) - 30000);
    } catch (error) {
      var cache = CacheService.getScriptCache();
      if (!cache.get('mail-reader-failed')) {
        cache.put('mail-reader-failed', '1', 600);
        safeAudit_('mail_reader_failed', 'database', MAIL_READER_HANDLER, { message: error && error.message || String(error) });
      }
      throw error;
    }
    result.answered = answerNewTexts_(now);
    var woke = wakeApps_(now);
    if (woke) result.woke = woke;
    return result;
  });
}

// For the desk's own reads (Voice signups, Zeffy passes): reads Gmail only when the job has not just done so, and sets
// up the job's timer the first time. If Gmail fails, the desk carries on with the mail already recorded. What it finds
// wakes the apps at the job's next run.
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

// Minutes between the timer's runs: the pace due now, or a busier stretch's if one starts before the next run would come
// (6 AM on a round robin day, every minute from 3:15 PM), so it never starts late; rounded up to a pace Google repeats.
function mailTimerEvery_(now, slow) {
  var every = mailSlowed_(mailCadence_(now), slow);
  for (var ahead = 60000; ahead < every; ahead += 60000) every = Math.min(every, mailSlowed_(mailCadence_(new Date(now.getTime() + ahead)), slow));
  return MAIL_TIMER_MINUTES_.filter(function (minutes) { return minutes * 60000 >= every; })[0] || 30;
}

// Replaces the job's timer when its pace changes (or the schedule version does), new one first, so the job always has one.
// A run at an unchanged pace makes one settings read and no timer calls.
function setMailTimer_(now, slow) {
  var properties = PropertiesService.getScriptProperties();
  var every = mailTimerEvery_(now, slow);
  var wanted = MAIL_SCHEDULE_VERSION_ + ':' + every;
  if (properties.getProperty(MAIL_TIMER_KEY_) === wanted) return;
  try {
    var old = ScriptApp.getProjectTriggers().filter(function (trigger) {
      return [MAIL_READER_HANDLER, MAIL_WATCH_HANDLER, VOICE_AUTO_REPLY_HANDLER].indexOf(trigger.getHandlerFunction()) >= 0;
    });
    ScriptApp.newTrigger(MAIL_READER_HANDLER).timeBased().everyMinutes(every).create();
    old.forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
    properties.setProperty(MAIL_TIMER_KEY_, wanted);
    if (!old.some(function (trigger) { return trigger.getHandlerFunction() === MAIL_READER_HANDLER; })) {
      appendAudit_('mail_reader_enabled', 'database', MAIL_READER_HANDLER, { everyMinutes: every });
    }
  } catch (error) {
    console.warn('Mail timer not set: ' + error);
  }
}

// Puts the job's timer back if it is missing (the desk checks every 6 hours, and when automatic answers are switched on).
function ensureMailJob_() {
  try {
    if (ScriptApp.getProjectTriggers().some(function (trigger) { return trigger.getHandlerFunction() === MAIL_READER_HANDLER; })) return;
    PropertiesService.getScriptProperties().deleteProperty(MAIL_TIMER_KEY_);
    setMailTimer_(new Date(), jobsSlowed_());
  } catch (error) {
    console.warn('Mail job timer unavailable: ' + error);
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
    var added = { texts: 0, zeffy: 0, recorded: [] };
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
    // New texts and replies to the coaching and staffing apps' questions wake those apps at the job's next run.
    if (added.recorded.length || Object.keys(found.mail).length) noteWake_(added.recorded, found.mail);
    return { texts: added.texts, zeffy: added.zeffy, gmailCalls: found.calls };
  } finally {
    cache.remove('mail-reading');
  }
}

// New Voice texts and Zeffy rows since the given time (ms), and how many replies to each app's questions came in (mail, by
// app). Each thread is read newest first and left at the first message already recorded or older than that, so a long text
// history costs nothing.
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
  var found = { texts: [], zeffy: [], mail: {}, calls: 0 };
  var zone = Session.getScriptTimeZone();
  var cache = CacheService.getScriptCache();
  var self = null;
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
          } else if (wakeAppFor_(subject)) {
            // A reply to an app's question. Our own questions are not (a reply the club sends from this account starts "Re:"),
            // and one seen by the last read, within the overlap, has already woken the app.
            if (self === null) self = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
            if ((address === self && !/^re\s*:/i.test(subject)) || cache.get('wake-mail-' + id)) continue;
            cache.put('wake-mail-' + id, '1', 3600);
            found.mail[wakeAppFor_(subject)] = (found.mail[wakeAppFor_(subject)] || 0) + 1;
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
  return { texts: texts.length, zeffy: zeffy.length, recorded: texts };
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

// ---------- Waking the coaching and staffing apps ----------
// The coaching and staffing apps wait for YES and NO answers by text and by email. They used to look every few minutes on
// timers of their own, which spent most of the 90 minutes of timer run time a day every club app shares (JobRuntime.js).
// Now they keep only an hourly timer, and this job tells them when something they may be waiting for came in: a new text,
// or an email reply to one of their questions (its subject carries the app's tag). The call goes to the app's web address:
// the app's work then counts as a web request, not as timer time, and this run waits only for it. The call carries what
// came in, so an app waiting on none of it answers at once without opening a Sheet; the app still reads everything it acts
// on from this Sheet and Gmail, never from the call. The desk's key (the hidden AppWake tab, which both apps can open)
// makes sure nobody else can set the apps running.
var WAKE_APPS_ = {
  coaching: { url: 'https://script.google.com/macros/s/AKfycbywI5OV0aaitPbzchxfyJUK4Q6_uLbFpF39O_cq8fLikbSO5Sy_NW3B3R-NlPtTS2YdTw/exec', tag: '[CTTC ref ' },
  staffing: { url: 'https://script.google.com/macros/s/AKfycbx_ApmyAF8Yk6DCuzeD_3JR9HOo_QCbI5hGLyBLWMl8feuoTI969BYAWba268Er4_1h3g/exec', tag: '[CTTC shift ' }
};
// What came in for an app since it was last woken, one script property per app: { texts, mail, more, tries }. Each text is
// cut to its start, which is all the app needs to tell whether it can matter, and at most WAKE_MAX_TEXTS_ are kept (more:
// the app looks anyway), so a busy sign-up stays well inside a property's 9 KB.
var WAKE_DUE_KEY_ = 'CTTC_WAKE_';
var WAKE_MAX_TEXTS_ = 10;
var WAKE_TEXT_CHARS_ = 120;
// A failed call is tried again at the next few runs; after that the app's hourly check picks up what came in.
var WAKE_TRIES_ = 3;
var WAKE_TAB_ = 'AppWake';
// Today's calls, for the desk log's app_wakes_day line.
var WAKE_COUNT_KEY_ = 'CTTC_WAKES';

function wakeAppFor_(subject) {
  return Object.keys(WAKE_APPS_).filter(function (app) { return subject.indexOf(WAKE_APPS_[app].tag) >= 0; })[0] || '';
}

// texts: VoiceTexts rows just recorded; mail: replies found, by app.
function noteWake_(texts, mail) {
  var properties = PropertiesService.getScriptProperties();
  Object.keys(WAKE_APPS_).forEach(function (app) {
    if (!texts.length && !mail[app]) return;
    var due = null;
    try { due = JSON.parse(properties.getProperty(WAKE_DUE_KEY_ + app) || 'null'); } catch (error) { due = null; }
    due = due || { texts: [], mail: 0, more: false, tries: 0 };
    texts.forEach(function (text) {
      if (due.texts.length >= WAKE_MAX_TEXTS_) due.more = true;
      else due.texts.push({ from: String(text.from), subject: String(text.subject), text: String(text.text).slice(0, WAKE_TEXT_CHARS_) });
    });
    due.mail += mail[app] || 0;
    try {
      properties.setProperty(WAKE_DUE_KEY_ + app, JSON.stringify(due));
    } catch (error) {
      properties.setProperty(WAKE_DUE_KEY_ + app, JSON.stringify({ texts: [], mail: due.mail, more: true, tries: 0 }));
    }
  });
}

// Calls every app something came in for, together. A quiet run makes two settings reads and nothing else. Returns null, or
// what each app said ('checked', 'nothing to check', or 'failed').
function wakeApps_(now) {
  var properties = PropertiesService.getScriptProperties();
  var due = {};
  var sent = {};
  Object.keys(WAKE_APPS_).forEach(function (app) {
    var value = properties.getProperty(WAKE_DUE_KEY_ + app);
    if (!value) return;
    sent[app] = value;
    try { due[app] = JSON.parse(value); } catch (error) { due[app] = { texts: [], mail: 0, more: true, tries: 0 }; }
  });
  var apps = Object.keys(due);
  if (!apps.length) return null;
  var said = {};
  var responses = [];
  try {
    var key = wakeKey_();
    responses = UrlFetchApp.fetchAll(apps.map(function (app) {
      return { url: WAKE_APPS_[app].url, method: 'post', contentType: 'application/json', muteHttpExceptions: true, followRedirects: true,
        payload: JSON.stringify({ fn: 'wake', key: key, texts: due[app].texts, mail: due[app].mail, more: due[app].more }) };
    }));
  } catch (error) {
    console.warn('Apps not woken: ' + error);
  }
  var failed = [];
  apps.forEach(function (app, index) {
    var answer = null;
    try { answer = responses[index] && responses[index].getResponseCode() === 200 ? JSON.parse(responses[index].getContentText()) : null; } catch (error) { answer = null; }
    if (answer && answer.ok) {
      said[app] = answer.checked ? 'checked' : 'nothing to check';
      // A desk page's read may have added texts meanwhile: those wake the app at the next run.
      if (properties.getProperty(WAKE_DUE_KEY_ + app) === sent[app]) properties.deleteProperty(WAKE_DUE_KEY_ + app);
      return;
    }
    said[app] = 'failed';
    due[app].tries = (Number(due[app].tries) || 0) + 1;
    if (due[app].tries < WAKE_TRIES_) properties.setProperty(WAKE_DUE_KEY_ + app, JSON.stringify(due[app]));
    else {
      properties.deleteProperty(WAKE_DUE_KEY_ + app);
      failed.push(app);
    }
  });
  countWakes_(now, said);
  // At most once an hour: the apps' hourly checks still pick up what came in, so this is a slowdown, not a loss.
  var cache = CacheService.getScriptCache();
  if (failed.length && !cache.get('wake-failed')) {
    cache.put('wake-failed', '1', 3600);
    deskLog_('warn', 'app_wake_failed', '', '', failed.join(' ') + ' not woken after ' + WAKE_TRIES_ + ' tries; its hourly check will pick up what came in');
  }
  return said;
}

// Counts the day's calls by app, and logs yesterday's when a new day starts. Only runs that called an app pay for this.
function countWakes_(now, said) {
  var properties = PropertiesService.getScriptProperties();
  var day = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var count = null;
  try { count = JSON.parse(properties.getProperty(WAKE_COUNT_KEY_) || 'null'); } catch (error) { count = null; }
  if (count && count.day !== day) {
    deskLog_('step', 'app_wakes_day', count.day, '', Object.keys(count).filter(function (name) { return name !== 'day'; }).map(function (name) { return name + '=' + count[name]; }).join(' '));
  }
  if (!count || count.day !== day) count = { day: day };
  Object.keys(said).forEach(function (app) {
    var name = said[app] === 'failed' ? app + '_failed' : app;
    count[name] = (count[name] || 0) + 1;
  });
  properties.setProperty(WAKE_COUNT_KEY_, JSON.stringify(count));
}

// The desk's key for waking the apps, made the first time it is needed and kept in a hidden tab of this Sheet, which the
// coaching and staffing apps open by DESK_SHEET_ID.
function wakeKey_() {
  var cache = CacheService.getScriptCache();
  var key = cache.get('wake-key');
  if (key) return key;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName(WAKE_TAB_);
  key = sheet && sheet.getLastRow() >= 2 ? String(sheet.getRange(2, 1, 1, 1).getValues()[0][0] || '') : '';
  if (!key) {
    if (!sheet) {
      sheet = spreadsheet.insertSheet(WAKE_TAB_);
      sheet.hideSheet();
    }
    key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    sheet.getRange(1, 1, 2, 1).setNumberFormat('@').setValues([['key'], [key]]);
  }
  cache.put('wake-key', key, 21600);
  return key;
}
