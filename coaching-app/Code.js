// Public coaching app. Like subscribe-app/ this is its own Apps Script project: a public web app exposes every
// function in its project, so the desk's code must never live here.
//
// Nobody needs a Google account, and nobody on the club's account has to manage anything. The web app runs as the club
// owner and does all the work. Two Sheets keep the data apart:
//   - the PRIVATE Sheet (script property COACHING_DB_ID) holds names, emails, notes and the requests themselves;
//   - the PUBLIC Sheet (COACHING_PUBLIC_ID) is shared "anyone with the link can view". It shows only first names such as
//     "Coach Dominic" and "Student Sam", dates and times; never a last name, email or phone number. Internally each coach and
//     student also has a label ("Coach D", "Student A"); coaches still pick their label on the page.
// The public Sheet is a read-out, never an input: the app rebuilds it from the private records after every change and
// every hour, and never reads it back. Whatever a visitor types there cannot change, create or cancel a booking.
// Coaches are a list the owner types into the private Coaches tab (name, email, mobile); there is no self sign-up and no coach
// sign-in. Anyone can pick a coach on the page and draft times, but only a YES from that coach publishes them: a reply to the
// email sent to the address on the list, or to the text sent to the mobile number on the list. Coaches answer lesson requests
// the same way. Students need no account either: a request, a cancellation or a move only happens once the student replies YES
// to the email (or text) it sends. Texts go through the club's Google Voice number, via Gmail (see "Texts go through").
//
// Coaching is only offered on Friday 7 to 10 PM and Saturday 3 to 6 PM (Pacific), in 30 or 60 minute slots. A coach
// sets slots, a student requests one, and the lesson is confirmed when the coach accepts it.
//
// Which step a booking is at, who must reply, and where it can get stuck: docs/coaching-flow.md.
var TZ = 'America/Los_Angeles';
var WINDOWS = { 5: { start: '19:00', end: '22:00' }, 6: { start: '15:00', end: '18:00' } };
var SLOT_MINUTES = [30, 60];
var LEAD_HOURS = 24;
var HOLD_HOURS = 48;
// One reminder to whoever owes the next YES: the student this long after asking, the coach this long after the student's YES.
var REMIND_STUDENT_MS = 60 * 60 * 1000;
var REMIND_COACH_MS = 2 * 60 * 60 * 1000;
var RELEASE_BEFORE_HOURS = 12;
var HORIZON_DAYS = 28;
var MAX_OPEN_REQUESTS_PER_STUDENT = 2;
var MAX_SLOTS_PER_COACH = 60;
// The third table is only handed out once the first two are taken at that time.
var TABLES = 3;
var MAX_WAITERS_PER_SLOT = 10;
var MAX_WAITS_PER_EMAIL = 5;
var MAX_WAITLIST = 2000;
// A coach has 48 hours to answer a list of times. A reply up to 14 days after that is still answered (lateProposal_): the times
// are offered again if they are all still free, or the coach is told which were taken.
var ASK_TTL_MS = 48 * 60 * 60 * 1000;
var LATE_ASK_MS = 14 * 24 * 60 * 60 * 1000;
var PROPOSE_WAIT_MS = 10 * 60 * 1000;
var MAX_PROPOSALS_PER_DAY = 10;
var THREAD_DAYS = 90;
// Each email check reaches this far back before the last one, for mail Gmail is slow to make searchable.
var MAIL_OVERLAP_MS = 5 * 60 * 1000;
var MAX_STUDENTS = 3000;
var MAX_REQUESTS = 5000;
var MAX_PER_MINUTE = 30;
var RETRY_MAIL_DAYS = 3;
var MIN_QUOTA = 10;
// How long a new request holds its time while waiting for the student's YES.
var VERIFY_MS = 2 * 60 * 60 * 1000;
var CHANGE_WAIT_MS = 10 * 60 * 1000;
var LOG_KEEP = 500;
var LOG_SHOWN = 300;
// A step of the check that fails without a break for this long is emailed to the club. Google's services have outages
// of a few minutes that clear by themselves; those go to the Log tab, not the club inbox.
var ALERT_AFTER_MS = 30 * 60 * 1000;
// Who a club alert says to forward it to when the club cannot fix it.
var MAINTAINER = 'JB';
// The footer of every alert to the club account.
var CLUB_FOOTER = 'Sent by the CTTC coaching app to the club account.';
var MAX_LOG_READS_PER_MINUTE = 20;

var SITE_URL = 'https://concordtabletennisclub.com';
var PAGE_URL = SITE_URL + '/coaching.html';
var FROM_NAME = 'Concord Table Tennis Club';
var TEXT_NUMBER = '(925) 238-3505';
var LOCATION = 'Walnut Creek Christian Academy, 2336 Buena Vista Ave, Walnut Creek, CA 94597';
// Overridable with script properties so payment details never have to be committed.
var DEFAULT_ARRIVAL = 'Please arrive about 10 minutes early. Bring athletic shoes; the club has loaner paddles.';
var DEFAULT_PAYMENT = 'Pay the lesson fee directly to your coach. The regular session fee is paid at the front desk.';
var DEFAULT_GUIDELINES = 'Be on time, tell your coach about any injury, and treat the club, equipment and other players with respect.';
// The club's coaches: everyone on the coaching page, shown or hidden (data/coach-certifications.json lists the same names;
// npm test checks they match). The app offers only those the page shows: USATT-certified coaches and the owner's exceptions
// (showWhilePending). The desk copies the shown names from the site to the hidden CoachList tab of its Sheet every hour
// (apps-script/CoachList.js). Every sweep (hourly) adds any coach missing from the Coaches tab, marks a coach not shown, or
// no longer listed here, 'disabled', and switches a shown coach back on. To add or remove a coach, change this list and the
// table on coaching.html. The owner adds each mobile number in the Sheet.
var CLUB_COACHES = [
  ['Dominic Chan', 'dominicchan@sbcglobal.net'],
  ['Fuqun (Bill) Xing', 'xfqslw@gmail.com'],
  ['Tom (Xiaoyun) Zeng', 'xiaoyunzeng64@gmail.com'],
  ['Raymond Trinh', '']
];

var EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+'-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;
// A name starts with a letter; after that letters, spaces and the punctuation people use in names and pairs of names:
// "Mary-Jane O'Neil", "Smith, John", "Pat & Sam Parent", "Pat/Sam", "Pat (mom)". No digits, quotes or symbols.
var NAME_PATTERN = /^[\p{L}][\p{L}\p{M} .,&/()'\u2019-]{0,59}$/u;
var TIME_PATTERN = /^([01]\d|2[0-3]):(00|30)$/;
var DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Private Sheet. The label columns hold the public pseudonyms.
var TABS = {
  // The owner types name, email and mobile number (columns A to C); the rest is filled in by the app. The name must match the
  // contact name saved in Google Voice, which is how a text from a coach is recognised. ask_ref is the one question last texted
  // ('slots' or a request id), so a YES or NO always answers it; ask_slots is the submitted list of times (JSON) until answered.
  Coaches: ['name', 'email', 'phone', 'status', 'coach_id', 'label', 'created_at', 'ask_at', 'ask_slots', 'ask_ref', 'ask_made', 'registered_at'],
  // texts is 'yes' after the student texts STUDENT from the phone below, and '' after STOP; texts_at is that text's time.
  // ask_ref is the one question last texted to them ('v:' or 'c:' and a request id).
  Students: ['label', 'email', 'created_at', 'name', 'phone', 'texts', 'texts_at', 'ask_ref', 'ask_at'],
  Availability: ['avail_id', 'coach_id', 'date', 'start', 'minutes', 'confirmed', 'table'],
  Waitlist: ['wait_id', 'avail_id', 'email', 'created_at'],
  Requests: ['request_id', 'coach_id', 'date', 'start', 'minutes', 'student_label', 'student_name', 'student_email', 'guardian_name', 'note',
    'status', 'created_at', 'expires_at', 'cancelled_by', 'student_emailed', 'coach_emailed', 'updated_at', 'coach_texted', 'student_texted', 'table',
    // change is 'cancel' or 'move:' and the new slot, waiting for the student's YES since change_at.
    'verified_at', 'change', 'change_at',
    // reminded is the waiting status ('unverified' or 'pending') a reminder was sent for, so each step is reminded once.
    'reminded'],
  // One row per message sent (logSent_), reply read (logReply_) or failure (logError_), newest last; the sweep keeps the latest
  // LOG_KEEP. to is already a code, never an address or number; detail never holds one either. Shown, with ref coded too, at the
  // web app's address with ?log (see logView_).
  Log: ['at', 'channel', 'kind', 'ref', 'to', 'detail']
};
// Public Sheet. Nothing private ever goes in here.
var PUBLIC_TABS = {
  Schedule: ['date', 'day', 'start', 'end', 'coach', 'status', 'student', 'summary']
};

// The club site serves its own copy of the page (coaching-app.html, published from Index.html), which calls these with fetch
// and without cookies: Google's page host can refuse to open ("Sorry, unable to open the file at this time") in a browser
// signed in to several Google accounts, and a request with no cookies never meets that. Only these can be called this way,
// and the desk's wake.
function doPost(e) {
  var calls = { openSlots: openSlots, coachList: coachList, coachBoard: coachBoard, coachPropose: coachPropose, requestSlot: requestSlot, joinWaitlist: joinWaitlist, studentChange: studentChange };
  var result = null;
  try {
    var body = e && e.postData ? String(e.postData.contents || '') : '';
    var request = body.length <= 100000 ? JSON.parse(body || '{}') : {};
    var name = String(request && request.fn || '');
    // The desk's mail reader, when texts or an email reply came in (wake_).
    if (name === 'wake') result = wake_(request);
    else result = Object.prototype.hasOwnProperty.call(calls, name) ? calls[name].apply(null, Array.isArray(request.args) ? request.args.slice(0, 2) : []) : fail_('Unknown request.');
  } catch (error) {
    logError_('answer a request from the club site', error);
    result = fail_('Something went wrong. Please try again.');
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  if (e && e.parameter && e.parameter.log !== undefined) return logView_(String(e.parameter.log).trim().toUpperCase());
  var output = HtmlService.createTemplateFromFile('Index').evaluate();
  var initial = initialData_();
  if (initial) output.setContent(output.getContent().replace('var INITIAL = null;', 'var INITIAL = ' + scriptJson_(initial) + ';'));
  return output
    .setTitle('CTTC coaching')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The first screen's data comes with the page, saving a second trip to Google. On any problem the page fetches it itself.
function initialData_() {
  try {
    return { openSlots: openSlots(), coachList: coachList() };
  } catch (error) {
    logError_('prepare the first screen', error);
    return null;
  }
}

// JSON that is safe inside a <script> element, even when a name contains </script>.
function scriptJson_(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

// Run once from the Apps Script editor by the owner. Creates the private and public Sheets, the hourly sweep trigger,
// and asks Google for the permissions. Does nothing when called from the web page. The one manual step left is to share
// the public Sheet (Share > General access > Anyone with the link > Viewer); its address is logged and returned.
function setup() {
  if (Session.getActiveUser().getEmail() !== Session.getEffectiveUser().getEmail()) throw new Error('Only the owner can run setup.');
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty('COACHING_DB_ID')) {
    properties.setProperty('COACHING_DB_ID', SpreadsheetApp.create('CTTC Coaching (private - do not share)').getId());
  }
  if (!properties.getProperty('COACHING_PUBLIC_ID')) {
    var created = SpreadsheetApp.create('CTTC Coaching Schedule (public)');
    properties.setProperty('COACHING_PUBLIC_ID', created.getId());
    properties.setProperty('COACHING_PUBLIC_URL', created.getUrl());
  }
  Object.keys(TABS).concat(Object.keys(PUBLIC_TABS)).forEach(tab_);
  // Columns added in later versions get their header names; the data under them is written by position.
  Object.keys(TABS).forEach(function (name) { tab_(name).getRange(1, 1, 1, TABS[name].length).setNumberFormat('@').setValues([TABS[name]]).setFontWeight('bold'); });
  syncClubCoaches_();
  ensureCoachIds_(rows_('Coaches'));
  var publicBook = publicBook_();
  (publicBook.getSheetByName('About') || publicBook.insertSheet('About')).getRange(1, 1, 1, 1).setValues([[
    'This is a read-out of the coaching schedule. It shows only first names (Coach Dominic, Student Sam) and times. Changing it does not change any booking: ' +
    'the schedule is rebuilt from private records after every booking and every hour. Please use the coaching page to book or offer times.'
  ]]);
  [database_(), publicBook].forEach(function (book) {
    var blank = book.getSheetByName('Sheet1');
    if (blank && book.getSheets().length > 1) book.deleteSheet(blank);
  });
  var triggers = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
  if (triggers.indexOf('sweep') < 0) ScriptApp.newTrigger('sweep').timeBased().everyHours(1).create();
  retireCheckTimers_();
  MailApp.getRemainingDailyQuota();
  GmailApp.getInboxUnreadCount();
  sweep_();
  var result = { privateSheet: database_().getUrl(), publicSheet: publicBook.getUrl() };
  console.log('Private Sheet (never share): ' + result.privateSheet);
  console.log('Public Sheet (share as "Anyone with the link can view"): ' + result.publicSheet);
  return result;
}

// ---------- Sheet access ----------

function database_() { return book_('COACHING_DB_ID'); }

function publicBook_() { return book_('COACHING_PUBLIC_ID'); }

// Opening a Sheet is the slowest step of a request, so each one is opened once per run.
var openBooks_ = {};
var bookIds_ = {};
function book_(key) {
  var id = bookIds_[key] || (bookIds_[key] = PropertiesService.getScriptProperties().getProperty(key));
  if (!id) throw new Error('Run setup once from the Apps Script editor.');
  if (!openBooks_[id]) openBooks_[id] = SpreadsheetApp.openById(id);
  return openBooks_[id];
}

function headers_(name) { return TABS[name] || PUBLIC_TABS[name]; }

function tab_(name) {
  var book = PUBLIC_TABS[name] ? publicBook_() : database_();
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    var headers = headers_(name);
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setNumberFormat('@').setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rows_(name) {
  var headers = headers_(name);
  var values = tab_(name).getDataRange().getValues();
  return values.slice(1).map(function (row, index) {
    var entry = { _row: index + 2 };
    headers.forEach(function (key, column) { entry[key] = row[column] == null ? '' : String(row[column]); });
    return entry;
  }).filter(function (entry) { return entry[headers[0]]; });
}

function save_(name, entry) {
  var headers = headers_(name);
  var sheet = tab_(name);
  var row = entry._row || sheet.getLastRow() + 1;
  var range = sheet.getRange(row, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([headers.map(function (key) { return entry[key] == null ? '' : String(entry[key]); })]);
  entry._row = row;
}

// ---------- Small helpers ----------

// field names the form input at fault ('name', 'email', 'phone', 'guardian'), so the page can point at it.
function fail_(message, field) { return field ? { ok: false, message: message, field: field } : { ok: false, message: message }; }

function id_() { return Utilities.getUuid().replace(/-/g, '').slice(0, 16); }

function nowIso_() { return new Date(Date.now()).toISOString(); }

function tooBusy_() {
  var cache = CacheService.getScriptCache();
  var key = 'rate:' + Math.floor(Date.now() / 60000);
  var count = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(count), 120);
  return count > MAX_PER_MINUTE;
}

function cleanEmail_(value) {
  var address = String(value || '').trim().toLowerCase();
  return address.length > 254 || address.indexOf('..') >= 0 || !EMAIL_PATTERN.test(address) ? '' : address;
}

function cleanName_(value) {
  var name = String(value || '').replace(/\s+/g, ' ').trim();
  return NAME_PATTERN.test(name) ? name : '';
}

// Free text is shown to a coach and stored in a Sheet: drop control characters and anything a spreadsheet would read as a formula.
function cleanNote_(value) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/^[\s=+\-@]+/, '').trim().slice(0, 300);
}

// The 10 digit US number inside whatever the owner typed into the Sheet; '' when there is none.
function phoneDigits_(value) {
  var digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (digits.length === 11 && digits.charAt(0) === '1') digits = digits.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(digits) ? digits : '';
}

function phoneLabel_(value) {
  var digits = phoneDigits_(value);
  return digits ? '(' + digits.slice(0, 3) + ') ' + digits.slice(3, 6) + '-' + digits.slice(6) : '';
}

// "Name, email, (925) 555-0101", leaving out whatever was not given. Shared only once a lesson is confirmed.
function contactLabel_(name, email, phone) {
  return [String(name || '').trim(), cleanEmail_(email), phoneLabel_(phone)].filter(Boolean).join(', ');
}

function esc_(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function property_(key, fallback) { return PropertiesService.getScriptProperties().getProperty(key) || fallback; }

// ---------- Names and labels ----------

// "Raymond" for "Raymond Trinh", "Trinh, Raymond" or "Tom (Xiaoyun) Zeng" -> "Tom".
function firstName_(name) {
  var text = String(name || '').replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  var comma = text.match(/^[^,]+,\s*(.+)$/);
  // Only ever one word: "John/Smith", "Pat&Sam" or "John,Smith" give "John", "Pat", "John".
  return ((comma ? comma[1] : text).split(/[\s\/&,()]+/).filter(Boolean)[0] || '');
}

// What the public page and messages call a coach or a student: first name only.
function coachName_(coach) { var first = firstName_(coach.name); return first ? 'Coach ' + first : coach.label; }

function studentName_(request) { var first = firstName_(request.student_name); return first ? 'Student ' + first : request.student_label; }

// 0 -> A, 25 -> Z, 26 -> AA.
function letters_(number) {
  var text = '';
  var rest = number + 1;
  while (rest > 0) {
    text = String.fromCharCode(65 + (rest - 1) % 26) + text;
    rest = Math.floor((rest - 1) / 26);
  }
  return text;
}

// The first unused "Student A", "Student B", ... Labels are never reused.
function nextLabel_(prefix, used) {
  var taken = {};
  used.forEach(function (label) { taken[label] = true; });
  var number = 0;
  while (taken[prefix + ' ' + letters_(number)]) number += 1;
  return prefix + ' ' + letters_(number);
}

// "Coach D" for Dominic. Two coaches with the same initial become "Coach D" and "Coach D2".
function coachLabel_(name, used) {
  var initial = (nameKey_(name).match(/\p{L}/u) || [''])[0].toUpperCase();
  if (!initial) return nextLabel_('Coach', used);
  var taken = {};
  used.forEach(function (label) { taken[label] = true; });
  var label = 'Coach ' + initial;
  for (var number = 2; taken[label]; number += 1) label = 'Coach ' + initial + number;
  return label;
}

// Call while holding the lock. Returns '' when no more students can be added. Keeps the latest name and mobile number, so a
// STUDENT text from that number is recognised; a new number has to send STUDENT again.
function studentLabel_(email, name, phone) {
  var students = rows_('Students');
  var found = students.filter(function (student) { return student.email === email; })[0];
  if (found) {
    if (phone && phone !== phoneDigits_(found.phone)) {
      found.phone = phone;
      found.texts = '';
    }
    found.name = name;
    save_('Students', found);
    return found.label;
  }
  if (students.length >= MAX_STUDENTS) return '';
  var label = nextLabel_('Student', students.map(function (student) { return student.label; }));
  save_('Students', { label: label, email: email, created_at: nowIso_(), name: name, phone: phone, texts: '', texts_at: '' });
  return label;
}

// ---------- Pacific wall-clock time ----------
// Dates and start times are stored as Pacific wall-clock text ("2026-10-09", "19:00"). Only "now" needs the time zone.

function pacificNow_() {
  var parts = Utilities.formatDate(new Date(Date.now()), TZ, 'yyyy-MM-dd HH:mm').split(' ');
  return { date: parts[0], time: parts[1] };
}

function toMinutes_(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)); }

function fromMinutes_(minutes) { return ('0' + Math.floor(minutes / 60)).slice(-2) + ':' + ('0' + (minutes % 60)).slice(-2); }

function dateUtc_(date) { return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))); }

function validDate_(date) {
  return DATE_PATTERN.test(date) && new Date(dateUtc_(date)).toISOString().slice(0, 10) === date;
}

function weekday_(date) { return new Date(dateUtc_(date)).getUTCDay(); }

function addDays_(date, days) { return new Date(dateUtc_(date) + days * 86400000).toISOString().slice(0, 10); }

function wallMinutes_(date, time) { return dateUtc_(date) / 60000 + toMinutes_(time); }

function nowMinutes_() { var now = pacificNow_(); return wallMinutes_(now.date, now.time); }

function time12_(time) {
  var hour = Number(time.slice(0, 2));
  return ((hour + 11) % 12 + 1) + ':' + time.slice(3, 5) + ' ' + (hour < 12 ? 'AM' : 'PM');
}

function endOf_(start, minutes) { return fromMinutes_(toMinutes_(start) + Number(minutes)); }

// A coach offers 30 or 60 minutes; the lesson is 25 or 50, leaving time to pack up before the next one.
function lessonMinutes_(minutes) { return Number(minutes) - (Number(minutes) >= 60 ? 10 : 5); }

function rangeLabel_(start, minutes) { return time12_(start) + ' to ' + time12_(endOf_(start, lessonMinutes_(minutes))); }

function dayLabel_(date) {
  return DAYS[weekday_(date)] + ', ' + MONTHS[Number(date.slice(5, 7)) - 1] + ' ' + Number(date.slice(8, 10)) + ', ' + date.slice(0, 4);
}

function whenLabel_(date, start, minutes) { return dayLabel_(date) + ', ' + rangeLabel_(start, minutes) + ' Pacific Time'; }

function momentLabel_(ms) {
  var parts = Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm').split(' ');
  return dayLabel_(parts[0]) + ', ' + time12_(parts[1]) + ' Pacific Time';
}

function overlaps_(startA, minutesA, startB, minutesB) {
  var a = toMinutes_(startA);
  var b = toMinutes_(startB);
  return a < b + Number(minutesB) && b < a + Number(minutesA);
}

// A request is held until this moment: the shorter of the hold period and the point shortly before the lesson.
function expiryFor_(date, start) {
  var minutes = Math.min(HOLD_HOURS * 60, wallMinutes_(date, start) - nowMinutes_() - RELEASE_BEFORE_HOURS * 60);
  return Date.now() + Math.max(minutes, 0) * 60000;
}

// ---------- Booking rules ----------

function effectiveStatus_(request, now) {
  var waiting = request.status === 'unverified' || request.status === 'pending' || request.status === 'proposed';
  return waiting && Number(request.expires_at) <= now ? 'expired' : request.status;
}

function holds_(request, now) {
  var status = effectiveStatus_(request, now);
  return status === 'unverified' || status === 'pending' || status === 'proposed' || status === 'confirmed';
}

// Who must reply next: 'student' (to confirm the request), 'coach' (to accept it) or '' (nobody).
function waitingOn_(request, now) {
  var status = effectiveStatus_(request, now);
  return status === 'unverified' ? 'student' : status === 'pending' ? 'coach' : '';
}

// The public wording for a held time: "Booked", or who it is waiting on.
function stepLabel_(request, coach, now) {
  var waiting = waitingOn_(request, now);
  return waiting === 'student' ? 'Waiting for ' + studentName_(request) + ' to confirm' : waiting === 'coach' ? 'Waiting for ' + coach + ' to accept' : 'Booked';
}

function active_(coach) { return String(coach.status).trim().toLowerCase() !== 'disabled'; }

// The club has TABLES tables for coaching. The table asked for (prefer) if no other coach has it during any part of this slot,
// else the lowest numbered free one, or 0 when none is free throughout.
function freeTable_(availability, coaches, coachId, date, start, minutes, prefer) {
  var live = {};
  coaches.filter(active_).forEach(function (coach) { live[coach.coach_id] = true; });
  var busy = {};
  availability.forEach(function (entry) {
    if (entry.date !== date || entry.coach_id === coachId || entry.confirmed !== 'yes' || !live[entry.coach_id]) return;
    if (overlaps_(entry.start, entry.minutes, start, minutes)) busy[entry.table] = true;
  });
  if (prefer >= 1 && prefer <= TABLES && !busy[String(prefer)]) return prefer;
  for (var table = 1; table <= TABLES; table += 1) if (!busy[String(table)]) return table;
  return 0;
}

// The request, if any, that is holding this availability slot.
function heldBy_(entry, requests, now) {
  return requests.filter(function (request) {
    return holds_(request, now) && request.coach_id === entry.coach_id && request.date === entry.date &&
      overlaps_(request.start, request.minutes, entry.start, entry.minutes);
  })[0] || null;
}

// Every bookable slot in the next four weeks that a coach offered and nobody is holding.
function openSlots_(coaches, availability, requests, now) {
  var byId = {};
  coaches.filter(active_).forEach(function (coach) { byId[coach.coach_id] = coach; });
  var today = pacificNow_().date;
  var last = addDays_(today, HORIZON_DAYS);
  var earliest = nowMinutes_() + LEAD_HOURS * 60;
  return availability.filter(function (entry) {
    return byId[entry.coach_id] && entry.confirmed === 'yes' && entry.date >= today && entry.date <= last &&
      wallMinutes_(entry.date, entry.start) >= earliest && !heldBy_(entry, requests, now);
  }).map(function (entry) {
    return {
      key: entry.avail_id, coachId: entry.coach_id, coach: coachName_(byId[entry.coach_id]), table: Number(entry.table) || 1, date: entry.date, start: entry.start, minutes: Number(entry.minutes),
      day: dayLabel_(entry.date), time: rangeLabel_(entry.start, entry.minutes), label: whenLabel_(entry.date, entry.start, entry.minutes)
    };
  }).sort(function (a, b) { return (a.date + a.start + a.coach).localeCompare(b.date + b.start + b.coach); });
}

function publicSlot_(slot) {
  return { key: slot.key, coach: slot.coach, table: slot.table, date: slot.date, start: slot.start, minutes: lessonMinutes_(slot.minutes), day: slot.day, time: slot.time, label: slot.label };
}

// Every published time in the booking window, open or not, so a student can see which table is taken and by whom (first names only).
function board_(coaches, availability, requests, now) {
  var byId = {};
  coaches.filter(active_).forEach(function (coach) { byId[coach.coach_id] = coach; });
  var today = pacificNow_().date;
  var last = addDays_(today, HORIZON_DAYS);
  var current = nowMinutes_();
  var earliest = current + LEAD_HOURS * 60;
  var entries = availability.filter(function (entry) {
    return byId[entry.coach_id] && entry.confirmed === 'yes' && entry.date >= today && entry.date <= last && wallMinutes_(entry.date, entry.start) > current;
  }).map(function (entry) {
    var holder = heldBy_(entry, requests, now);
    var soon = wallMinutes_(entry.date, entry.start) < earliest;
    return {
      key: entry.avail_id, date: entry.date, day: dayLabel_(entry.date), start: entry.start, slot: Number(entry.minutes), minutes: lessonMinutes_(entry.minutes),
      time: rangeLabel_(entry.start, entry.minutes), table: Number(entry.table) || 1, coach: coachName_(byId[entry.coach_id]), coachId: entry.coach_id,
      status: holder ? (effectiveStatus_(holder, now) === 'confirmed' ? 'booked' : 'requested') : soon ? 'closed' : 'open',
      student: holder ? studentName_(holder) : '', waitlist: !!holder && !soon, waiting: holder ? waitingOn_(holder, now) : '',
      step: holder ? stepLabel_(holder, coachName_(byId[entry.coach_id]), now) : ''
    };
  }).sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start) || a.table - b.table; });
  // No waitlist while another table is open at the same time: the student can just request that one.
  entries.forEach(function (entry) {
    if (entry.waitlist && openAtSameTime_(entries, entry)) entry.waitlist = false;
  });
  return entries;
}

function openAtSameTime_(entries, entry) {
  return entries.some(function (other) { return other.status === 'open' && other.date === entry.date && other.start === entry.start; });
}

// What the public sees: open slots, requests (and who must reply next) and booked lessons, with first names only.
function scheduleEntries_(slots, coaches, requests, now) {
  var labels = {};
  coaches.forEach(function (coach) { labels[coach.coach_id] = coachName_(coach); });
  var today = pacificNow_().date;
  var entries = slots.map(function (slot) {
    return { date: slot.date, start: slot.start, minutes: slot.minutes, coach: slot.coach, status: 'Open', student: '', summary: slot.coach + ' is available' };
  });
  requests.filter(function (request) { return holds_(request, now) && request.date >= today; }).forEach(function (request) {
    var coach = labels[request.coach_id] || 'a coach';
    var booked = effectiveStatus_(request, now) === 'confirmed';
    var step = stepLabel_(request, coach, now);
    entries.push({
      date: request.date, start: request.start, minutes: Number(request.minutes), coach: coach, status: booked ? 'Booked' : step, student: studentName_(request),
      summary: studentName_(request) + (booked ? ' has session with ' + coach : ' requested a session with ' + coach + '. ' + step)
    });
  });
  return entries.sort(function (a, b) { return (a.date + a.start + a.coach).localeCompare(b.date + b.start + b.coach); });
}

// Rebuilds the public Sheet from the private records. Anything someone typed there is wiped. A problem here never blocks a booking.
function publish_(now) {
  try {
    var coaches = rows_('Coaches');
    var requests = rows_('Requests');
    var slots = openSlots_(coaches, rows_('Availability'), requests, now);
    var values = [PUBLIC_TABS.Schedule].concat(scheduleEntries_(slots, coaches, requests, now).map(function (entry) {
      return [entry.date, DAYS[weekday_(entry.date)], time12_(entry.start), time12_(endOf_(entry.start, lessonMinutes_(entry.minutes))), entry.coach, entry.status, entry.student, entry.summary];
    }));
    var sheet = tab_('Schedule');
    // Hourly, the schedule is usually unchanged: reading it is cheaper than writing it again (timer run time is shared,
    // docs/google-limits.md). An edit made to it is still put right.
    if (JSON.stringify(sheet.getDataRange().getValues().map(function (row) { return row.map(String); })) === JSON.stringify(values)) return;
    sheet.clearContents();
    sheet.getRange(1, 1, values.length, values[0].length).setNumberFormat('@').setValues(values);
  } catch (error) {
    logError_('update the public schedule', error);
  }
}

// ---------- Public: the booking page ----------

function openSlots() {
  var coaches = rows_('Coaches');
  var requests = rows_('Requests');
  var now = Date.now();
  var availability = rows_('Availability');
  var slots = openSlots_(coaches, availability, requests, now);
  var board = board_(coaches, availability, requests, now);
  var days = [];
  board.forEach(function (entry) {
    if (days.length && days[days.length - 1].date === entry.date) return;
    var window = WINDOWS[weekday_(entry.date)];
    days.push({ date: entry.date, day: entry.day, start: window.start, end: window.end, tables: 2 });
  });
  board.forEach(function (entry) {
    days.forEach(function (day) { if (day.date === entry.date) day.tables = Math.max(day.tables, entry.table); });
  });
  return {
    ok: true,
    tables: TABLES,
    days: days,
    board: board,
    slots: slots.map(publicSlot_),
    schedule: scheduleEntries_(slots, coaches, requests, now).filter(function (entry) { return entry.status !== 'Open'; }).map(function (entry) {
      return { day: dayLabel_(entry.date), time: rangeLabel_(entry.start, entry.minutes), status: entry.status, summary: entry.summary };
    }),
    sheetUrl: property_('COACHING_PUBLIC_URL', '')
  };
}

// Columns added in a later version get their header names on the next sweep, so nobody has to run setup() again. Data is
// read and written by position, so this is only for people reading the Sheet.
function ensureHeaders_() {
  var properties = PropertiesService.getScriptProperties();
  var version = Object.keys(TABS).map(function (name) { return name + ':' + TABS[name].join(','); }).join('|');
  if (properties.getProperty('HEADERS') === version) return;
  Object.keys(TABS).forEach(function (name) {
    tab_(name).getRange(1, 1, 1, TABS[name].length).setNumberFormat('@').setValues([TABS[name]]).setFontWeight('bold');
  });
  properties.setProperty('HEADERS', version);
}

// Called by the booking form. A request holds its slot, so two people cannot take the same time. It goes to the coach only once
// the student replies YES to the email we send (or to the text, for a student who gets our texts), so nobody can book in someone
// else's name.
function requestSlot(form) {
  form = form || {};
  if (form.website) return { ok: true };
  var name = cleanName_(form.name);
  var email = cleanEmail_(form.email);
  var minor = form.minor === true;
  var guardian = minor ? cleanName_(form.guardian) : '';
  var phone = phoneDigits_(form.phone);
  var nameRule = ' Use letters; spaces and - \' . , & / ( ) are fine, numbers are not.';
  if (!name) return fail_(String(form.name || '').trim() ? 'Please check the student\'s name.' + nameRule : 'Please enter the student\'s name.', 'name');
  if (!email) return fail_('Please enter a valid email address.', 'email');
  if (String(form.phone || '').trim() && !phone) return fail_('Please enter a 10 digit US mobile number, or leave it blank.', 'phone');
  if (minor && !guardian) {
    return fail_(String(form.guardian || '').trim() ? 'Please check the parent or guardian name.' + nameRule :
      'Please enter the parent or guardian\'s name. For a student under 18, use the parent or guardian\'s email address.', 'guardian');
  }
  var created = null;
  var texted = false;
  var student = null;
  var coachLabel = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_()) return fail_('Too many requests right now. Please try again in a few minutes.');
    var now = Date.now();
    var requests = rows_('Requests');
    if (requests.length >= MAX_REQUESTS) return fail_('Requests are closed for now. Please contact the club.');
    var slot = openSlots_(rows_('Coaches'), rows_('Availability'), requests, now).filter(function (candidate) { return candidate.key === String(form.key); })[0];
    if (!slot) return fail_('That time is no longer available. Please pick another.');
    // A 25 minute lesson on a 60 minute time splits it for good into two 30 minute times; the request takes the half asked for.
    var minutes = !form.length || Number(form.length) === lessonMinutes_(slot.minutes) ? slot.minutes : Number(form.length) === 25 && slot.minutes === 60 ? 30 : 0;
    if (!minutes) return fail_('That time is a ' + lessonMinutes_(slot.minutes) + ' minute lesson. Please pick another.');
    var start = minutes === 30 && slot.minutes === 60 && String(form.start) === endOf_(slot.start, 30) ? endOf_(slot.start, 30) : slot.start;
    coachLabel = slot.coach;
    var open = requests.filter(function (request) {
      var status = effectiveStatus_(request, now);
      return request.student_email === email && (status === 'unverified' || status === 'pending' || status === 'proposed');
    }).length;
    if (open >= MAX_OPEN_REQUESTS_PER_STUDENT) return fail_('This email address already has ' + MAX_OPEN_REQUESTS_PER_STUDENT + ' requests waiting for an answer (for any student). Please wait for a reply, or cancel one.', 'email');
    var label = studentLabel_(email, guardian || name, phone);
    if (!label) return fail_('Requests are closed for now. Please contact the club.');
    if (minutes !== slot.minutes) splitSlot_(slot.key);
    created = {
      request_id: id_(), coach_id: slot.coachId, date: slot.date, start: start, minutes: minutes, student_label: label, student_name: name,
      student_email: email, guardian_name: guardian, note: cleanNote_(form.note), status: 'unverified', created_at: nowIso_(),
      expires_at: Math.min(now + VERIFY_MS, expiryFor_(slot.date, start)), cancelled_by: '', student_emailed: '', coach_emailed: '', updated_at: nowIso_(), table: slot.table
    };
    save_('Requests', created);
    logStep_(created);
    student = rows_('Students').filter(function (entry) { return entry.email === email; })[0];
    texted = !!student && student.texts === 'yes' && !!phoneDigits_(student.phone);
  } finally {
    lock.releaseLock();
  }
  // The request is saved and holds its time. Nothing after this may turn it into an error on the page: the student would try
  // again and be told the time is taken (by their own request). Whatever fails here is retried by the hourly sweep.
  try {
    if (texted) {
      askStudentText_(student, 'v:' + created.request_id, 'CTTC: Reply YES to send ' + studentName_(created) + '\'s request to ' + coachLabel + ': ' +
        lessonMinutes_(created.minutes) + ' min, ' + shortWhen_(created.date, created.start) + ', Table ' + created.table + '. Reply NO to cancel it.');
    }
    sweep_();
  } catch (error) {
    logError_('finish a saved request', error, created.request_id);
  }
  return {
    ok: true, label: studentName_(created), texts: !!phone, textNumber: TEXT_NUMBER,
    message: 'Almost done: we emailed you' + (texted ? ' and texted your mobile' : '') + '. Reply YES to ' + (texted ? 'either one' : 'that email') +
      ' within 2 hours to send your request to ' + coachLabel + '. The time is held for you until then. Nothing goes to the coach until you reply.'
  };
}

function splitSlot_(key) {
  var entry = rows_('Availability').filter(function (candidate) { return candidate.avail_id === key; })[0];
  entry.minutes = '30';
  save_('Availability', entry);
  save_('Availability', { avail_id: id_(), coach_id: entry.coach_id, date: entry.date, start: endOf_(entry.start, 30), minutes: '30', confirmed: 'yes', table: entry.table });
}

// A student who finds a time taken can ask to be emailed if it opens again (a cancellation, a decline, an expiry or a new time
// suggested by the coach). Everyone waiting is told at once and taken off the list; the first to request it gets it.
function joinWaitlist(form) {
  form = form || {};
  var done = { ok: true, message: 'You are on the waitlist. If this time opens up we will email you; the first student to request it gets it.' };
  if (form.website) return done;
  var email = cleanEmail_(form.email);
  if (!email) return fail_('Please enter a valid email address.', 'email');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_()) return fail_('Too many requests right now. Please try again in a few minutes.');
    var now = Date.now();
    var board = board_(rows_('Coaches'), rows_('Availability'), rows_('Requests'), now);
    var entry = board.filter(function (candidate) { return candidate.key === String(form.key); })[0];
    if (!entry) return fail_('That time is no longer offered. Please pick another.');
    if (entry.status === 'open') return fail_('That time is open. You can request it now.');
    if (!entry.waitlist && openAtSameTime_(board, entry)) return fail_('Another table is open at that time. You can request it now.');
    if (!entry.waitlist) return fail_('That time is too soon for a waitlist.');
    var waits = rows_('Waitlist');
    if (waits.some(function (wait) { return wait.avail_id === entry.key && wait.email === email; })) return done;
    if (waits.filter(function (wait) { return wait.avail_id === entry.key; }).length >= MAX_WAITERS_PER_SLOT) return fail_('The waitlist for that time is full.');
    if (waits.filter(function (wait) { return wait.email === email; }).length >= MAX_WAITS_PER_EMAIL) return fail_('You are already waiting for ' + MAX_WAITS_PER_EMAIL + ' times.');
    if (waits.length >= MAX_WAITLIST) return fail_('The waitlist is closed for now. Please check back later.');
    save_('Waitlist', { wait_id: id_(), avail_id: entry.key, email: email, created_at: nowIso_() });
  } finally {
    lock.releaseLock();
  }
  return done;
}

// Call while holding the lock. Emails everyone waiting for a time that is open again, and drops entries that can no longer open.
function notifyWaitlist_(coaches, now) {
  var waits = rows_('Waitlist');
  if (!waits.length) return;
  var availability = rows_('Availability');
  var open = {};
  openSlots_(coaches, availability, rows_('Requests'), now).forEach(function (slot) { open[slot.key] = slot; });
  var offered = {};
  // Someone already waiting keeps their place even while another table is open at that time.
  var earliest = nowMinutes_() + LEAD_HOURS * 60;
  board_(coaches, availability, rows_('Requests'), now).forEach(function (entry) {
    if ((entry.status === 'booked' || entry.status === 'requested') && wallMinutes_(entry.date, entry.start) >= earliest) offered[entry.key] = true;
  });
  var drop = [];
  waits.forEach(function (wait) {
    var slot = open[wait.avail_id];
    if (!slot) {
      if (!offered[wait.avail_id]) drop.push(wait._row);
      return;
    }
    if (!mailAvailable_()) return;
    try {
      sendMail_(wait.email, 'A coaching time you wanted is open', [
        { callout: '**Good news:** a time you were waiting for just opened up. It is **first come, first served**, and everyone on the waitlist was told at the same time.', tone: 'good' },
        { rows: [['When', slot.label], ['Coach', slot.coach], ['Table', 'Table ' + slot.table], ['Request it', PAGE_URL, PAGE_URL]] }].concat(
        scheduleBlocks_('On the schedule', [{ date: slot.date, coachId: slot.coachId, start: slot.start, minutes: slot.minutes, kind: 'opened' }]), [
        'You were on the waitlist for this time and have now been taken off it.']), null, ['waitlist-open', wait.avail_id]);
    } catch (error) {
      logError_('email the waitlist', error, wait.avail_id);
      return;
    }
    drop.push(wait._row);
  });
  drop.sort(function (a, b) { return b - a; }).forEach(function (row) { tab_('Waitlist').deleteRow(row); });
}

// ---------- Public: coaches ----------

// Call while holding the lock. Gives each coach the owner has listed an id and a label such as "Coach D" the first time it is needed.
function ensureCoachIds_(coaches) {
  coaches.forEach(function (coach) {
    if (coach.coach_id || !String(coach.name).trim()) return;
    coach.coach_id = id_();
    coach.label = coachLabel_(coach.name, coaches.map(function (entry) { return entry.label; }));
    coach.created_at = nowIso_();
    save_('Coaches', coach);
  });
  return coaches;
}

function coachList() {
  var coaches = rows_('Coaches');
  if (coaches.some(function (coach) { return !coach.coach_id && String(coach.name).trim(); })) {
    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      coaches = ensureCoachIds_(rows_('Coaches'));
    } finally {
      lock.releaseLock();
    }
  }
  return {
    ok: true,
    coaches: coaches.filter(function (coach) { return coach.coach_id && active_(coach); }).map(function (coach) {
      return { id: coach.coach_id, label: coach.label, ready: ready_(coach), registered: verified_(coach) };
    })
  };
}

// The green check: the club has the coach's email and mobile, and the coach has texted the club number.
function verified_(coach) { return !!(coach.registered_at && cleanEmail_(coach.email) && phoneDigits_(coach.phone)); }

// A coach can confirm once the owner has listed an email address or a mobile number for them.
function ready_(coach) { return !!cleanEmail_(coach.email) || !!phoneDigits_(coach.phone); }

function coachById_(coachId) {
  if (!/^[a-f0-9]{16}$/.test(String(coachId || ''))) return null;
  var coach = rows_('Coaches').filter(function (entry) { return entry.coach_id === coachId; })[0];
  return coach && active_(coach) ? coach : null;
}

// The times a coach submitted and has not answered yet, or null.
// The coach's list of times while it can still be answered with a plain YES (ASK_TTL_MS), or null.
function proposalOf_(coach, now) {
  return now - Number(coach.ask_made) < ASK_TTL_MS ? proposalSlots_(coach) : null;
}

// A list whose 48 hours have passed but which is kept, for LATE_ASK_MS, so a late reply can still be answered.
function expiredProposal_(coach, now) {
  var age = now - Number(coach.ask_made);
  return age >= ASK_TTL_MS && age < ASK_TTL_MS + LATE_ASK_MS ? proposalSlots_(coach) : null;
}

function proposalSlots_(coach) {
  if (!coach.ask_slots || !(Number(coach.ask_made) > 0)) return null;
  try {
    return JSON.parse(coach.ask_slots);
  } catch (error) {
    return null;
  }
}

// When a list must be answered by, for the email ('Saturday, October 24, 2026, 6:21 PM Pacific Time') and a text ('Sat Oct 24, 6:21 PM').
function replyBy_(made) { return momentLabel_(Number(made) + ASK_TTL_MS); }

function shortMoment_(ms) {
  var parts = Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm').split(' ');
  return shortWhen_(parts[0], parts[1]);
}

// Everything on this page is public anyway (labels and times), so it needs no sign-in.
function coachBoard(coachId) {
  var coach = coachById_(coachId);
  if (!coach) return fail_('That coach was not found. Please pick again.');
  var now = Date.now();
  var today = pacificNow_().date;
  var current = nowMinutes_();
  var days = [];
  for (var offset = 0; offset <= HORIZON_DAYS; offset += 1) {
    var date = addDays_(today, offset);
    var window = WINDOWS[weekday_(date)];
    if (window && wallMinutes_(date, window.end) > current) days.push({ date: date, day: dayLabel_(date), start: window.start, end: window.end });
  }
  var pending = proposalOf_(coach, now);
  return {
    ok: true, id: coach.coach_id, label: coach.label, name: coachName_(coach), ready: ready_(coach), email: !!cleanEmail_(coach.email), text: !!phoneDigits_(coach.phone),
    tables: TABLES, days: days, textNumber: TEXT_NUMBER,
    board: board_(rows_('Coaches'), rows_('Availability'), rows_('Requests'), now).map(function (entry) {
      return { date: entry.date, start: entry.start, slot: entry.slot, table: entry.table, coach: entry.coach, mine: entry.coachId === coach.coach_id, status: entry.status, student: entry.student, waiting: entry.waiting };
    }),
    pending: pending, pendingSince: pending ? momentLabel_(Number(coach.ask_made)) : ''
  };
}

// slots is the coach's whole set of upcoming times as they want it, [{date, start, minutes, table}]. Nothing changes until the
// coach replies YES to the list we email to the address on the club's list (or text to the mobile number on it), so a stranger
// picking the coach changes nothing.
function coachPropose(coachId, slots) {
  if (!Array.isArray(slots) || slots.length > MAX_SLOTS_PER_COACH) return fail_('That is too many times. Remove some first.');
  var current = nowMinutes_();
  var last = addDays_(pacificNow_().date, HORIZON_DAYS);
  var wanted = [];
  for (var i = 0; i < slots.length; i += 1) {
    var slot = slots[i] || {};
    var date = String(slot.date || '');
    var start = String(slot.start || '');
    var minutes = Number(slot.minutes);
    var table = Number(slot.table) || 1;
    var window = validDate_(date) ? WINDOWS[weekday_(date)] : null;
    if (!window || !TIME_PATTERN.test(start) || SLOT_MINUTES.indexOf(minutes) < 0 || table !== Math.floor(table) || table < 1 || table > TABLES || date > last ||
      toMinutes_(start) < toMinutes_(window.start) || toMinutes_(start) + minutes > toMinutes_(window.end)) {
      return fail_('Coaching is on Fridays 7 to 10 PM and Saturdays 3 to 6 PM, in 30 or 60 minute times, up to four weeks ahead.');
    }
    if (wallMinutes_(date, start) > current) wanted.push({ date: date, start: start, minutes: minutes, table: table });
  }
  var lock = LockService.getScriptLock();
  var sent = { email: false, text: false };
  lock.waitLock(30000);
  try {
    if (tooBusy_()) return fail_('Too many requests right now. Please try again in a few minutes.');
    var now = Date.now();
    var coach = coachById_(coachId);
    if (!coach) return fail_('That coach was not found. Please pick again.');
    if (!ready_(coach)) return fail_(coachName_(coach) + ' is not set up yet. Please ask the club to add your email address or mobile number.');
    if (proposalOf_(coach, now) && now - Number(coach.ask_made) < PROPOSE_WAIT_MS) {
      return fail_('We sent ' + coachName_(coach) + ' a list a few minutes ago. Reply YES or NO to it first, or wait 10 minutes to send a new one.');
    }
    var cache = CacheService.getScriptCache();
    var daily = 'propose:' + coach.coach_id + ':' + pacificNow_().date;
    if (Number(cache.get(daily) || 0) >= MAX_PROPOSALS_PER_DAY) return fail_('That is the most changes for one day. Please try again tomorrow.');
    var plan = planChanges_(coach, wanted, rows_('Availability'), rows_('Coaches'), rows_('Requests'), now);
    if (typeof plan === 'string') return fail_(plan);
    if (!plan.add.length && !plan.remove.length) return fail_('Nothing changed yet. Tap times to add or remove them, then submit.');
    cache.put(daily, String(Number(cache.get(daily) || 0) + 1), 86400);
    var email = cleanEmail_(coach.email);
    if (email && mailAvailable_()) {
      try {
        sendMail_(email, 'Confirm your coaching times ' + refTag_(proposalCode_(coach.coach_id, now)), [
          { callout: '**Action needed:** reply to this email by **' + replyBy_(now) + '**. **Nothing changes until you reply.**', tone: 'action' },
          { choices: [['YES', 'Publish these changes to ' + coachName_(coach) + '\'s coaching times.'], ['NO', 'Cancel. Your coaching times stay as they are.']] },
          plan.add.length ? 'Add: ' + slotList_(plan.add) : '',
          plan.remove.length ? 'Remove: ' + slotList_(plan.remove) : '',
          phoneDigits_(coach.phone) ? 'We also texted your mobile. You can answer either one.' :
            'Want to confirm by text instead? Ask the club to add your mobile number to the coach list.',
          'If you did not ask for this, ignore this email and nothing will change.'
        ], null, ['coach-times-confirm', coach.coach_id]);
        sent.email = true;
      } catch (error) {
        logError_('email a coach to confirm times', error, coach.coach_id);
      }
    }
    if (phoneDigits_(coach.phone)) {
      try {
        sendText_(coach, proposalText_(coach, plan, now), ['coach-times-confirm', coach.coach_id]);
        sent.text = true;
      } catch (error) {
        logError_('text a coach to confirm times', error, coach.coach_id);
      }
    }
    if (!sent.email && !sent.text) {
      return fail_(phoneDigits_(coach.phone) && !email ?
        'We could not text ' + coachName_(coach) + '. From your mobile, text the word COACH to ' + TEXT_NUMBER + ', wait a minute, then submit again.' :
        'We could not reach ' + coachName_(coach) + ' right now. Please try again later.');
    }
    coach.ask_slots = JSON.stringify(plan.wanted);
    coach.ask_made = String(now);
    if (sent.text) {
      coach.ask_ref = 'slots';
      coach.ask_at = String(now);
    }
    save_('Coaches', coach);
  } finally {
    lock.releaseLock();
  }
  var where = sent.email && sent.text ? 'the email and the text we just sent' : sent.email ? 'the email we just sent' : 'the text we just sent';
  return {
    ok: true, message: 'Sent. Reply YES to ' + where + ' to publish these times, or NO to cancel. Nothing changes until you reply.' +
      (sent.email && phoneDigits_(coach.phone) && !sent.text ? ' (We could not text you: from your mobile, text COACH to ' + TEXT_NUMBER + ' once to get texts too.)' : '')
  };
}

function sameSlot_(a, b) { return a.date === b.date && a.start === b.start && Number(a.minutes) === Number(b.minutes); }

// Call while holding the lock. Compares the wanted times with the coach's published ones; a time with a request on it always
// stays. Returns a refusal, or {wanted, add, remove}.
function planChanges_(coach, wanted, availability, coaches, requests, now) {
  var current = nowMinutes_();
  var mine = availability.filter(function (entry) { return entry.coach_id === coach.coach_id && wallMinutes_(entry.date, entry.start) > current; });
  var held = mine.filter(function (entry) { return heldBy_(entry, requests, now); });
  var all = wanted.filter(function (slot) { return !held.some(function (entry) { return sameSlot_(entry, slot); }); }).concat(held.map(function (entry) {
    return { date: entry.date, start: entry.start, minutes: Number(entry.minutes), table: Number(entry.table) || 1 };
  }));
  for (var i = 0; i < all.length; i += 1) {
    for (var j = i + 1; j < all.length; j += 1) {
      if (all[i].date === all[j].date && overlaps_(all[i].start, all[i].minutes, all[j].start, all[j].minutes)) {
        return 'Two of your times overlap on ' + shortWhen_(all[j].date, all[j].start) + '. A time with a lesson request on it cannot be changed.';
      }
    }
  }
  var add = all.filter(function (slot) { return !mine.some(function (entry) { return sameSlot_(entry, slot); }); });
  for (var k = 0; k < add.length; k += 1) {
    add[k].table = freeTable_(availability, coaches, coach.coach_id, add[k].date, add[k].start, add[k].minutes, add[k].table);
    if (!add[k].table) return 'All ' + TABLES + ' coaching tables are taken by other coaches at ' + shortWhen_(add[k].date, add[k].start) + '. Please pick a different time.';
  }
  return { wanted: all, add: add, remove: mine.filter(function (entry) { return !all.some(function (slot) { return sameSlot_(entry, slot); }); }) };
}

// "Fri Oct 16 8:00-8:30 PM, 9:00-10:00 PM; Sat Oct 17 3:00-3:30 PM"
function slotList_(slots) {
  var order = [];
  var byDate = {};
  slots.slice().sort(function (a, b) { return (a.date + a.start).localeCompare(b.date + b.start); }).forEach(function (slot) {
    if (!byDate[slot.date]) {
      byDate[slot.date] = [];
      order.push(slot.date);
    }
    byDate[slot.date].push(time12_(slot.start).replace(/ [AP]M$/, '') + '-' + time12_(endOf_(slot.start, slot.minutes)));
  });
  return order.map(function (date) {
    return DAYS[weekday_(date)].slice(0, 3) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(date.slice(8, 10)) + ' ' + byDate[date].join(', ');
  }).join('; ');
}

function proposalText_(coach, plan, made) {
  return 'CTTC: Reply YES by ' + shortMoment_(Number(made) + ASK_TTL_MS) + ' to update ' + coachName_(coach) + '\'s coaching times, or NO to cancel.' +
    (plan.add.length ? ' Add: ' + slotList_(plan.add) + '.' : '') + (plan.remove.length ? ' Remove: ' + slotList_(plan.remove) + '.' : '') +
    ' Nothing changes until you reply.';
}

// Call while holding the lock, after the coach replied YES. Times another coach took in the meantime are skipped.
// Call while holding the lock. A YES or NO that came after a list's 48 hours. NO: nothing changes. YES, every time still free:
// the same list is offered again with a new 48 hours (a new reference code), so one more YES publishes it. YES, some taken by
// another coach since: the coach is told which, and to pick times again on the page. Returns what happened, for the log.
function lateProposal_(coach, answer, channel, now) {
  var wanted = expiredProposal_(coach, now) || [];
  var sent = momentLabel_(Number(coach.ask_made));
  var email = cleanEmail_(coach.email);
  var texts = !!phoneDigits_(coach.phone);
  var lateLine = 'Your reply came after the 48-hour window for the coaching times you sent on ' + sent + ', so nothing was published.';
  var send = function (subject, lines, text, kind) {
    try {
      if (email && mailAvailable_()) sendMail_(email, subject, lines, null, [kind, coach.coach_id]);
    } catch (error) {
      logError_('email a coach about a late reply', error, coach.coach_id);
    }
    try {
      if (texts && (channel === 'text' || !email)) sendText_(coach, text, [kind, coach.coach_id]);
    } catch (error) {
      logError_('text a coach about a late reply', error, coach.coach_id);
    }
  };
  coach.ask_slots = '';
  coach.ask_made = '';
  if (coach.ask_ref === 'slots') {
    coach.ask_ref = '';
    coach.ask_at = '';
  }
  if (answer !== 'yes') {
    send('Your coaching times', ['OK, nothing was changed. Your coaching times stay as they were.'],
      'CTTC: OK, nothing was changed. Your coaching times stay as they were.', 'coach-times-late');
    return 'late, no';
  }
  var availability = rows_('Availability');
  var plan = planChanges_(coach, wanted, availability, rows_('Coaches'), rows_('Requests'), now);
  var current = nowMinutes_();
  var mine = availability.filter(function (entry) { return entry.coach_id === coach.coach_id; });
  var coaches = rows_('Coaches');
  var gone = [];
  var open = [];
  wanted.forEach(function (slot) {
    if (wallMinutes_(slot.date, slot.start) <= current || mine.some(function (entry) { return sameSlot_(entry, slot); })) return;
    (freeTable_(availability, coaches, coach.coach_id, slot.date, slot.start, slot.minutes, Number(slot.table)) ? open : gone).push(slot);
  });
  if (typeof plan !== 'string' && !gone.length && (plan.add.length || plan.remove.length)) {
    coach.ask_slots = JSON.stringify(plan.wanted);
    coach.ask_made = String(now);
    send('Confirm your coaching times ' + refTag_(proposalCode_(coach.coach_id, now)), [
      { callout: lateLine, tone: 'action' },
      { callout: '**Good news: these times are all still open.** To publish them, reply **YES** to this email by **' + replyBy_(now) + '**.', tone: 'good' },
      { choices: [['YES', 'Publish these changes to ' + coachName_(coach) + '\'s coaching times.'], ['NO', 'Cancel. Your coaching times stay as they are.']] },
      plan.add.length ? 'Add: ' + slotList_(plan.add) : '',
      plan.remove.length ? 'Remove: ' + slotList_(plan.remove) : '',
      texts ? 'We also texted your mobile. You can answer either one.' : ''
    ], 'CTTC: Your reply came after the 48-hour window, so nothing was published yet. Good news: those times are all still open. ' +
      'Reply YES by ' + shortMoment_(now + ASK_TTL_MS) + ' to publish them, or NO to cancel.', 'coach-times-late');
    if (texts && channel === 'text') {
      coach.ask_ref = 'slots';
      coach.ask_at = String(now);
    }
    return 'late, offered again';
  }
  send('Your coaching times were not published', [
    { callout: lateLine, tone: 'action' },
    gone.length ? 'Since then, another coach has taken: ' + slotList_(gone) + '.' : 'Since then, the schedule has changed, so that list can no longer be published as it was.',
    { callout: '**Please pick your times again:** open ' + PAGE_URL.replace('https://', '') + ', tap **I am a coach**, choose your name and select your times. ' +
      'Then reply YES to the new email or text within 48 hours.', tone: 'action' },
    open.length ? 'Still open when we checked: ' + slotList_(open) + '.' : ''
  ], 'CTTC: Your reply came after the 48-hour window, so nothing was published, and another coach has since taken ' +
    (gone.length ? slotList_(gone) : 'some of those times') + '. Please pick your times again at ' + PAGE_URL.replace('https://', '') + '.', 'coach-times-taken');
  return 'late, taken';
}

function applyProposal_(coach, now) {
  var wanted = proposalOf_(coach, now) || [];
  var availability = rows_('Availability');
  var coaches = rows_('Coaches');
  var requests = rows_('Requests');
  var current = nowMinutes_();
  var mine = availability.filter(function (entry) { return entry.coach_id === coach.coach_id && wallMinutes_(entry.date, entry.start) > current; });
  var drop = mine.filter(function (entry) { return !heldBy_(entry, requests, now) && !wanted.some(function (slot) { return sameSlot_(entry, slot); }); });
  var keep = mine.filter(function (entry) { return drop.indexOf(entry) < 0; });
  var result = { added: 0, removed: drop.length, skipped: 0 };
  wanted.forEach(function (slot) {
    if (wallMinutes_(slot.date, slot.start) <= current || keep.some(function (entry) { return sameSlot_(entry, slot); })) return;
    var table = freeTable_(availability, coaches, coach.coach_id, slot.date, slot.start, slot.minutes, Number(slot.table));
    if (!table || keep.some(function (entry) { return entry.date === slot.date && overlaps_(entry.start, entry.minutes, slot.start, slot.minutes); })) {
      result.skipped += 1;
      return;
    }
    var entry = { avail_id: id_(), coach_id: coach.coach_id, date: slot.date, start: slot.start, minutes: String(slot.minutes), confirmed: 'yes', table: String(table) };
    save_('Availability', entry);
    keep.push(entry);
    result.added += 1;
  });
  drop.sort(function (a, b) { return b._row - a._row; }).forEach(function (entry) { tab_('Availability').deleteRow(entry._row); });
  result.total = keep.length;
  coach.ask_slots = '';
  coach.ask_made = '';
  return result;
}

// ---------- Public: students cancel or move a lesson ----------

// form: {key: the board time, action: 'cancel' | 'move', to: an open time (for a move), contact: the email or mobile number booked
// with}. Nothing changes here: if the contact matches the request on that time, we email (and text, for a student who gets our
// texts) a question, and the change happens when they reply YES. The answer is the same either way, so the page never tells
// anyone whose lesson a time is.
function studentChange(form) {
  form = form || {};
  var done = { ok: true, message: 'If that time is yours, we just sent a message to the email address (and, if you get our texts, the mobile number) you booked with. Reply YES to it to confirm. Nothing changes until you reply.' };
  if (form.website) return done;
  var action = form.action === 'move' ? 'move' : form.action === 'cancel' ? 'cancel' : '';
  var email = cleanEmail_(form.contact);
  var phone = email ? '' : phoneDigits_(form.contact);
  if (!action) return fail_('Please choose to cancel or to move the lesson.');
  if (!email && !phone) return fail_('Please enter the email address or mobile number you booked with.', 'contact');
  var question = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (tooBusy_()) return fail_('Too many requests right now. Please try again in a few minutes.');
    var now = Date.now();
    var coaches = rows_('Coaches');
    var availability = rows_('Availability');
    var requests = rows_('Requests');
    var entry = availability.filter(function (candidate) { return candidate.avail_id === String(form.key); })[0];
    var request = entry ? heldBy_(entry, requests, now) : null;
    if (!request) return fail_('That time has no lesson on it any more. Please reload the page.');
    var target = null;
    if (action === 'move') {
      target = openSlots_(coaches, availability, requests, now).filter(function (slot) { return slot.key === String(form.to); })[0];
      if (!target) return fail_('That new time is no longer open. Please pick another.');
    }
    var students = rows_('Students');
    var student = students.filter(function (candidate) { return candidate.email === request.student_email; })[0];
    var owner = email ? email === request.student_email : !!student && phoneDigits_(student.phone) === phone;
    if (!owner || now - Number(request.change_at || 0) < CHANGE_WAIT_MS) return done;
    request.change = action === 'move' ? 'move:' + target.key : 'cancel';
    request.change_at = String(now);
    save_('Requests', request);
    var coach = coaches.filter(function (candidate) { return candidate.coach_id === request.coach_id; })[0];
    question = { request: request, student: student, coach: coach, target: target };
  } finally {
    lock.releaseLock();
  }
  if (question) askStudentChange_(question);
  return done;
}

function askStudentChange_(question) {
  var request = question.request;
  var when = whenLabel_(request.date, request.start, request.minutes);
  var coachLabel = question.coach ? coachName_(question.coach) : 'your coach';
  var move = question.target ? question.target.label + ', ' + question.target.coach + ', Table ' + question.target.table : '';
  var who = request.guardian_name ? 'Hello ' + request.guardian_name + ',' : 'Hello ' + request.student_name + ',';
  var target = question.target;
  var current = { date: request.date, coachId: request.coach_id, start: request.start, minutes: request.minutes, kind: move ? 'from' : 'cancel' };
  try {
    if (mailAvailable_()) {
      sendMail_(request.student_email, (move ? 'Confirm: move your lesson ' : 'Confirm: cancel your lesson ') + refTag_(changeCode_(request)), [who,
        { callout: '**Action needed:** you asked to ' + (move ? 'move' : 'cancel') + ' ' + studentName_(request) + '\'s lesson. **Nothing changes until you reply.**', tone: 'action' },
        { choices: move ? [['YES', 'Move the lesson to the new time. The new time goes to the coach to accept, and your current time is released.'], ['NO', 'Keep the lesson as it is.']] :
          [['YES', 'Cancel the lesson and release the time.'], ['NO', 'Keep the lesson as it is.']] },
        { heading: move ? 'The change' : 'The lesson to cancel' },
        { rows: move ? [['Now', when + ', ' + coachLabel + ', Table ' + (Number(request.table) || 1)], ['New time', move]] :
          lessonRows_(request).concat([['Coach', coachLabel]]) }].concat(
        scheduleBlocks_('On the schedule', move ? [current, { date: target.date, coachId: target.coachId, start: target.start, minutes: target.minutes, kind: 'to' }] : [current]), [
        'If you did not ask for this, ignore this email.', bookingLine_(request)]), null, ['student-change-confirm', request.request_id]);
    }
  } catch (error) {
    logError_('email a student about a change', error, request.request_id);
  }
  askStudentText_(question.student, 'c:' + request.request_id, 'CTTC: Reply YES to ' + (move ? 'move' : 'cancel') + ' ' + studentName_(request) + '\'s lesson on ' +
    shortWhen_(request.date, request.start) + (move ? ' to ' + shortWhen_(question.target.date, question.target.start) + ' (' + question.target.coach + ')' : '') + ', or NO to keep it.');
}

// Texts a student who opted in to texts a YES or NO question; the latest question is the one a bare YES or NO answers.
function askStudentText_(student, ref, body) {
  if (!student) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    textStudentQuestion_(rows_('Students').filter(function (entry) { return entry.email === student.email; })[0], ref, body);
  } finally {
    lock.releaseLock();
  }
}

// Call while holding the lock. The student's latest texted question is the one a bare YES or NO answers.
function textStudentQuestion_(student, ref, body) {
  if (!student || student.texts !== 'yes' || !phoneDigits_(student.phone)) return;
  try {
    sendText_({ name: student.name, phone: student.phone }, body, ['student-question', ref]);
  } catch (error) {
    logError_('text a student a question', error, ref);
    return;
  }
  student.ask_ref = ref;
  student.ask_at = String(Date.now());
  save_('Students', student);
}

// Applies a student's YES or NO. kind 'v' confirms a new request; 'c' a cancellation or move.
function studentAnswer_(requestId, kind, answer, channel, answeredAt) {
  var reply = '';
  var applied = true;
  var request = null;
  var student = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    var requests = rows_('Requests');
    request = requests.filter(function (entry) { return entry.request_id === requestId; })[0];
    if (!request) return;
    var before = request.status;
    var moved = null;
    student = rows_('Students').filter(function (entry) { return entry.email === request.student_email; })[0];
    if (student && student.ask_ref === kind + ':' + requestId) {
      student.ask_ref = '';
      student.ask_at = '';
      save_('Students', student);
    }
    var status = effectiveStatus_(request, now);
    if (kind === 'v') {
      // An answer sent before the deadline but read after it still counts if the time is free.
      var late = status === 'expired' && answeredAt && answeredAt < Number(request.expires_at) && lateVerify_(request, requests, rows_('Availability'), now);
      if (status !== 'unverified' && !late) {
        reply = 'That request is no longer waiting for you (it is ' + status + '), so nothing changed.';
        applied = false;
      } else if (answer === 'yes') {
        request.status = 'pending';
        request.verified_at = nowIso_();
        request.expires_at = String(expiryFor_(request.date, request.start));
        request.reminded = '';
      } else {
        request.status = 'cancelled';
        request.cancelled_by = 'student';
      }
    } else {
      var change = request.change;
      request.change = '';
      request.change_at = '';
      if (!change || !holds_(request, now)) {
        reply = 'That change is no longer waiting, so nothing changed.';
        applied = false;
      } else if (answer === 'no') {
        reply = 'OK, nothing changed. ' + studentName_(request) + '\'s lesson on ' + whenLabel_(request.date, request.start, request.minutes) + ' stays as it is.';
      } else if (change === 'cancel') {
        request.status = 'cancelled';
        request.cancelled_by = 'student';
      } else {
        var slot = openSlots_(rows_('Coaches'), rows_('Availability'), requests, now).filter(function (candidate) { return candidate.key === change.slice(5); })[0];
        if (!slot) {
          reply = 'That new time was taken before you replied, so nothing changed. Your lesson on ' + whenLabel_(request.date, request.start, request.minutes) + ' stays as it is.';
          applied = false;
        } else {
          request.status = 'cancelled';
          request.cancelled_by = 'move';
          save_('Requests', moved = {
            request_id: id_(), coach_id: slot.coachId, date: slot.date, start: slot.start, minutes: slot.minutes, student_label: request.student_label,
            student_name: request.student_name, student_email: request.student_email, guardian_name: request.guardian_name, note: request.note, status: 'pending',
            created_at: nowIso_(), expires_at: expiryFor_(slot.date, slot.start), cancelled_by: '', student_emailed: '', coach_emailed: '', updated_at: nowIso_(),
            table: slot.table, verified_at: nowIso_()
          });
        }
      }
    }
    request.updated_at = nowIso_();
    save_('Requests', request);
    if (request.status !== before) logStep_(request);
    if (moved) logStep_(moved, 'moved from ' + bookingCode_(request));
  } finally {
    lock.releaseLock();
  }
  logReply_(channel, 'student-' + kind, requestId, answer, applied, request.status);
  if (reply) {
    try {
      if (channel === 'text') sendText_({ name: student.name, phone: student.phone }, 'CTTC: ' + reply, ['student-answer-reply', requestId]);
      else if (mailAvailable_()) sendMail_(request.student_email, 'Your coaching lesson', [reply, bookingLine_(request)], null, ['student-answer-reply', requestId]);
    } catch (error) {
      logError_('answer a student', error, requestId);
    }
  }
  sweep_();
}

// ---------- Expiry, email and the public schedule ----------

// Run by the hourly trigger. Expires unanswered requests, retries any email that has not gone out, drops past slots,
// and rebuilds the public schedule (which also repairs any edits made to it). Then runs the check, which has no timer of its
// own (see "When the check runs"), even if the sweep failed.
function sweep(event) {
  timed_(event, function () {
    retireCheckTimers_();
    try {
      sweep_();
    } finally {
      checkNow_(false);
    }
  });
}

// Call while holding the lock. Makes the Coaches tab match CLUB_COACHES: a listed coach is added if missing and switched back
// on if disabled; any other coach is disabled. Rows are never deleted, so a coach's id, label and past lessons stay. An empty
// list changes nothing.
function syncClubCoaches_() {
  if (!CLUB_COACHES.length) return;
  var listed = rows_('Coaches');
  var shown = shownCoaches_();
  var matches = function (entry, coach) {
    return entry.name.trim().toLowerCase() === coach[0].toLowerCase() || (coach[1] && cleanEmail_(entry.email) === coach[1]);
  };
  listed.forEach(function (entry) {
    var club = CLUB_COACHES.filter(function (coach) { return matches(entry, coach); })[0];
    // Not knowing who the page shows (the desk has not written the list, or it cannot be read), a club coach stays as is.
    if (club && !shown) return;
    var on = !!club && !!shown[club[0].toLowerCase()];
    if (on === active_(entry)) return;
    entry.status = on ? '' : 'disabled';
    save_('Coaches', entry);
  });
  CLUB_COACHES.forEach(function (coach) {
    if (listed.some(function (entry) { return matches(entry, coach); })) return;
    save_('Coaches', { name: coach[0], email: coach[1], status: shown && !shown[coach[0].toLowerCase()] ? 'disabled' : '' });
  });
}

// The coaches the club's coaching page shows, by lower-case name, from the desk's hidden CoachList tab (a 'shown_coach'
// heading, then one name a row; apps-script/CoachList.js), or null when that is not known.
function shownCoaches_() {
  try {
    var tab = book_('DESK_SHEET_ID').getSheetByName('CoachList');
    var values = tab ? tab.getDataRange().getValues() : [];
    if (!values.length || String(values[0][0]) !== 'shown_coach') return null;
    var shown = {};
    values.slice(1).forEach(function (line) {
      var name = String(line[0] || '').trim().toLowerCase();
      if (name) shown[name] = true;
    });
    return shown;
  } catch (error) {
    return null;
  }
}

function sweep_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureHeaders_();
    syncClubCoaches_();
    var now = Date.now();
    var coaches = ensureCoachIds_(rows_('Coaches'));
    var students = rows_('Students');
    var requests = rows_('Requests');
    requests.forEach(function (request) {
      var status = effectiveStatus_(request, now);
      if (status !== request.status) {
        request.status = status;
        request.updated_at = nowIso_();
        save_('Requests', request);
        logStep_(request);
      }
      if (now - Date.parse(request.updated_at) > RETRY_MAIL_DAYS * 86400000) return;
      var coach = coaches.filter(function (entry) { return entry.coach_id === request.coach_id; })[0];
      if (!coach) return;
      var student = students.filter(function (entry) { return entry.email === request.student_email; })[0];
      deliver_(request, coach, 'student_emailed', studentMail_);
      deliver_(request, coach, 'coach_emailed', function () { return coachMail_(request, coach, student); });
      // A pending request is asked by askCoaches_, one question per coach at a time; an unverified one is not the coach's yet.
      if (request.status !== 'pending' && request.status !== 'unverified') {
        deliver_(request, coach, 'coach_texted', function () { return coachText_(request, coach, student); });
      }
      deliver_(request, coach, 'student_texted', function () { return studentText_(request, coach, student); });
    });
    askCoaches_(coaches, requests, now);
    remindWaiting_(coaches, students, requests, now);
    notifyWaitlist_(coaches, now);
    var today = pacificNow_().date;
    rows_('Availability').filter(function (entry) { return entry.date < today; }).reverse().forEach(function (entry) {
      tab_('Availability').deleteRow(entry._row);
    });
    publish_(now);
    trimLog_();
    recordRun_('sweep', []);
  } catch (error) {
    logError_('finish the sweep', error);
    recordRun_('sweep', ['finish the sweep: ' + cleanDetail_(error).slice(0, 80)]);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

// Each side is told about each status once. The status is recorded only after the mail was accepted, so a failed
// send is retried by the next sweep and a sent one is never repeated.
function deliver_(request, coach, field, compose) {
  if (request[field] === request.status) return;
  var message = compose(request, coach);
  if (message) {
    if (!message.text && !mailAvailable_()) return;
    try {
      var log = [field + ':' + request.status, request.request_id];
      if (message.text) sendText_(message.person, message.text, log);
      else sendMail_(message.to, message.subject, message.lines.concat(bookingLine_(request)), message.cc, log);
    } catch (error) {
      logError_('send ' + field + ':' + request.status, error, request.request_id);
      return;
    }
  }
  request[field] = request.status;
  save_('Requests', request);
}

// Call while holding the lock. A request still waiting on someone's YES after a while gets one reminder, saying exactly who must
// reply and to what. The reminder keeps the question's reference code, so a reply to it counts as an answer. Once the student has
// confirmed, they are also told it now waits on the coach. The coach hears nothing before the student's YES, so nobody can use the
// page to message a coach in someone else's name. Each waiting step is reminded at most once (reminded is set before sending).
function remindWaiting_(coaches, students, requests, now) {
  requests.forEach(function (request) {
    var status = effectiveStatus_(request, now);
    if ((status !== 'unverified' && status !== 'pending') || request.reminded === status) return;
    var since = status === 'unverified' ? Date.parse(request.created_at) : Date.parse(request.verified_at);
    if (!(now - since >= (status === 'unverified' ? REMIND_STUDENT_MS : REMIND_COACH_MS)) || Number(request.expires_at) - now < 2 * 60000) return;
    var coach = coaches.filter(function (entry) { return entry.coach_id === request.coach_id; })[0];
    if (!coach || !mailAvailable_()) return;
    var student = students.filter(function (entry) { return entry.email === request.student_email; })[0];
    var who = request.guardian_name ? 'Hello ' + request.guardian_name + ', this is about the lesson for ' + request.student_name + '.' : 'Hello ' + request.student_name + ',';
    var lesson = studentName_(request) + '\'s ' + lessonMinutes_(request.minutes) + ' minute lesson with ' + coachName_(coach) + ' on ' + whenLabel_(request.date, request.start, request.minutes);
    var deadline = momentLabel_(Number(request.expires_at));
    // Marked first, so a part that fails is never resent: one reminder per step at most.
    request.reminded = status;
    save_('Requests', request);
    var attempt = function (send) {
      try {
        send();
      } catch (error) {
        logError_('send part of a coaching reminder', error, request.request_id);
      }
    };
    if (status === 'unverified') {
      attempt(function () {
        var ask = studentMail_(request, coach);
        sendMail_(ask.to, 'Reminder: ' + ask.subject, [who,
          { callout: '**Still waiting for you:** ' + lesson + ' has **not** been sent to the coach yet. Reply **YES** to this email by **' + deadline +
            '** to send it. If you do not reply, the request expires and the time is released.', tone: 'action' },
          'Reply from this same email address. Replying to the earlier "Confirm your coaching request" email works too.'
        ].concat(ask.lines.slice(2), bookingLine_(request)), null, ['student-reminder', request.request_id]);
      });
      attempt(function () {
        textStudentQuestion_(student, 'v:' + request.request_id, 'CTTC: Reminder: reply YES to send ' + studentName_(request) + '\'s request to ' + coachName_(coach) + ': ' +
          lessonMinutes_(request.minutes) + ' min, ' + shortWhen_(request.date, request.start) + ', Table ' + (Number(request.table) || 1) + '. Reply NO to cancel it.');
      });
      return;
    }
    attempt(function () {
        var question = coachMail_(request, coach, student);
        if (question) sendMail_(question.to, 'Reminder: ' + question.subject, [
          { callout: '**Still waiting for you:** ' + request.student_name + ' confirmed this request and it is **waiting for your YES**. Reply **YES** (or NO) to this email by **' + deadline +
            '**, or the request expires and the club is told.', tone: 'action' },
          'Reply from this same email address.'].concat(question.lines, bookingLine_(request)), null, ['coach-reminder', request.request_id]);
    });
    attempt(function () {
        if (phoneDigits_(coach.phone) && coach.ask_ref === request.request_id) sendText_(coach, requestQuestion_(request, true), ['coach-reminder', request.request_id]);
    });
    attempt(function () {
        sendMail_(request.student_email, 'Your coaching request is waiting on ' + coachName_(coach), [who,
          { callout: lesson + ' is **waiting for ' + coachName_(coach) + ' to accept it.** You confirmed it, so **nothing more is needed from you**. It is not booked until the coach accepts.', tone: 'action' },
          'If the coach has not answered by **' + deadline + '**, the request expires, the time is released and the club follows up. We email you as soon as the coach answers.', bookingLine_(request)], null, ['student-waiting-on-coach', request.request_id]);
    });
  });
}

function lessonRows_(request) {
  return [['When', whenLabel_(request.date, request.start, request.minutes)],
    ['Where', LOCATION, 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(LOCATION)],
    ['Table', 'Table ' + (Number(request.table) || 1)]];
}

function changeSteps_(request) {
  return { steps: ['Open ' + PAGE_URL, 'Tap your time (shown as **' + studentName_(request) + '**).', 'Reply **YES** to the email we send you to confirm the change.'] };
}

// [background, border, text color, title, note shown in the cell, sentence under the day heading]
var MARKS = {
  cancel: ['#fde2e1', '3px dashed #c0392b', '#7a1f17', '&#10005; TO BE CANCELLED', 'Cancelled only if you reply YES', 'The red time is cancelled if you reply YES.'],
  from: ['#fde2e1', '3px dashed #c0392b', '#7a1f17', '&#10005; MOVING FROM', 'Released if you reply YES', 'Your current time (red) is released if you reply YES.'],
  to: ['#dcebff', '3px solid #1f4f8f', '#173a6b', '&#8594; MOVING TO', 'Not confirmed: the coach must accept', 'The new time (blue) goes to the coach to accept.'],
  opened: ['#e3f1e7', '3px solid #1f6b3a', '#1f4a2b', '&#9733; JUST OPENED', 'First come, first served', 'The green time just opened up.']
};

// The day's tables and times as the booking page shows them (first names only), with the marked times picked out.
// A mark is {date, coachId, start, minutes, kind: 'mine' | a MARKS key, status (for 'mine')}.
function dayGrid_(date, marks) {
  try {
    var window = WINDOWS[weekday_(date)];
    if (!window) return null;
    var board = board_(rows_('Coaches'), rows_('Availability'), rows_('Requests'), Date.now()).filter(function (entry) { return entry.date === date; });
    var first = toMinutes_(window.start);
    var count = (toMinutes_(window.end) - first) / 30;
    var tables = 2;
    board.forEach(function (entry) { tables = Math.max(tables, entry.table); });
    var cells = [];
    for (var row = 0; row < count; row += 1) cells.push([]);
    var found = false;
    board.forEach(function (entry) {
      var top = (toMinutes_(entry.start) - first) / 30;
      var span = entry.slot / 30;
      if (top < 0 || top + span > count) return;
      for (var r = top; r < top + span; r += 1) if (cells[r][entry.table]) return;
      var mark = marks.filter(function (candidate) { return entry.coachId === candidate.coachId && overlaps_(entry.start, entry.slot, candidate.start, candidate.minutes); })[0];
      found = found || !!mark;
      cells[top][entry.table] = { entry: entry, span: span, mark: mark };
      for (var below = top + 1; below < top + span; below += 1) cells[below][entry.table] = 'covered';
    });
    if (!found) return null;
    var box = 'border-radius:8px;text-align:center;font-size:13px;line-height:1.35;padding:6px;height:36px;';
    var html = '<table role="presentation" cellpadding="0" cellspacing="6" style="border-collapse:separate;width:100%;max-width:520px;margin:0 0 12px;font-family:Arial,sans-serif;"><tr><td></td>';
    for (var t = 1; t <= tables; t += 1) html += '<td style="width:' + Math.floor(90 / tables) + '%;text-align:center;font-size:13px;font-weight:700;color:#555;">Table ' + t + '</td>';
    html += '</tr>';
    for (var r2 = 0; r2 < count; r2 += 1) {
      html += '<tr><td style="font-size:12px;color:#555;white-space:nowrap;vertical-align:top;padding-top:4px;">' + time12_(fromMinutes_(first + r2 * 30)) + '</td>';
      for (var t2 = 1; t2 <= tables; t2 += 1) {
        var cell = cells[r2][t2];
        if (cell === 'covered') continue;
        if (!cell) { html += '<td style="' + box + 'border:2px dashed #ddd;"></td>'; continue; }
        var entry = cell.entry;
        var span = cell.span > 1 ? ' rowspan="' + cell.span + '"' : '';
        if (cell.mark && cell.mark.kind === 'mine') {
          html += '<td' + span + ' style="' + box + 'background:#fff3b0;border:3px solid #c98a00;color:#5a3d00;"><strong>&#9733; YOUR LESSON</strong><br>' +
            esc_(entry.coach + ' \u00b7 ' + entry.time) + '<br><strong>' + esc_({ unverified: 'Waiting for your YES', pending: 'Waiting for the coach', confirmed: 'Confirmed' }[cell.mark.status] || '') + '</strong></td>';
        } else if (cell.mark) {
          var look = MARKS[cell.mark.kind];
          html += '<td' + span + ' style="' + box + 'background:' + look[0] + ';border:' + look[1] + ';color:' + look[2] + ';"><strong>' + look[3] + '</strong><br>' +
            esc_(entry.coach + ' \u00b7 ' + entry.time) + '<br><strong>' + esc_(look[4]) + '</strong></td>';
        } else if (entry.status === 'booked' || entry.status === 'requested') {
          html += '<td' + span + ' style="' + box + 'background:#8a8a8a;border:2px solid #6f6f6f;color:#fff;">' + (entry.status === 'booked' ? 'Booked by ' : 'Requested by ') +
            esc_(entry.student) + '<br>' + esc_(entry.coach + ' \u00b7 ' + entry.time) + '</td>';
        } else {
          var color = entry.status === 'open' ? '#1f6b3a' : '#888';
          html += '<td' + span + ' style="' + box + 'border:2px dashed ' + (entry.status === 'open' ? '#7aa886' : '#ccc') + ';color:' + color + ';"><strong>' + esc_(entry.coach) + '</strong><br>' + esc_(entry.time) + '</td>';
        }
      }
      html += '</tr>';
    }
    return { html: html + '</table>' };
  } catch (error) {
    logError_('draw the schedule for an email', error);
    return null;
  }
}

function gridBlocks_(request) {
  return scheduleBlocks_('Your spot on the schedule', [{ date: request.date, coachId: request.coach_id, start: request.start, minutes: request.minutes, kind: 'mine', status: request.status }]);
}

// One grid per day the marks fall on, each under its date and a sentence saying what the colors mean.
function scheduleBlocks_(heading, marks) {
  var blocks = [];
  marks.map(function (mark) { return mark.date; }).filter(function (date, index, all) { return all.indexOf(date) === index; }).sort().forEach(function (date) {
    var today = marks.filter(function (mark) { return mark.date === date; });
    var grid = dayGrid_(date, today);
    if (!grid) return;
    var note = today.map(function (mark) { return mark.kind === 'mine' ? 'Your lesson is highlighted.' : MARKS[mark.kind][5]; }).join(' ');
    blocks.push({ html: '<p style="margin:0 0 4px;"><strong>' + esc_(dayLabel_(date)) + '</strong>. ' + esc_(note) + '</p>', text: blocks.length ? '' : 'See every table for the day at ' + PAGE_URL }, grid);
  });
  return blocks.length ? [{ heading: heading }].concat(blocks) : [];
}

// The student's side of a confirmed lesson: name, guardian for a minor, email and the mobile number on file.
function studentContact_(request, student) {
  return contactLabel_(request.student_name + (request.guardian_name ? ' (guardian: ' + request.guardian_name + ')' : ''),
    request.student_email, student && student.phone);
}

// The public schedule only shows first names. Once a lesson is confirmed both sides get each other's full name and contact details.
function studentMail_(request, coach) {
  var when = whenLabel_(request.date, request.start, request.minutes);
  var to = request.student_email;
  var who = request.guardian_name ? 'Hello ' + request.guardian_name + ', this is about the lesson for ' + request.student_name + '.' : 'Hello ' + request.student_name + ',';
  var expires = momentLabel_(Number(request.expires_at));
  var details = lessonRows_(request);
  var coachShown = coachName_(coach);
  if (request.status === 'unverified') {
    return { to: to, subject: 'Confirm your coaching request ' + refTag_(verifyCode_(request)), lines: [who,
      { callout: '**Action needed:** reply to this email by **' + expires + '**.', tone: 'action' },
      { choices: [['YES', 'Send my request to the coach.'], ['NO', 'Cancel my request and release the time.']] },
      { heading: 'Your request' },
      { rows: details.concat([['Coach', coachShown]]) },
      { heading: 'What happens next' },
      { steps: ['Reply **YES** by **' + expires + '**. Nothing goes to the coach until you reply, and the time is held for you until then.',
        coachShown + ' accepts or declines. We email you either way.',
        'Once accepted, you get a confirmation with your coach\'s contact details and what to bring.'] },
      'You will show on the site as "' + studentName_(request) + '", so you can find your time and its status on the schedule.'].concat(gridBlocks_(request), [
      'If you did not ask for this lesson, ignore this email and the time will be released.']) };
  }
  if (request.status === 'pending') {
    return { to: to, subject: 'Coaching request sent to ' + coachShown + ' (not confirmed yet)', lines: [who,
      { callout: 'Thanks. Your request went to ' + coachShown + '. It is **NOT confirmed until the coach accepts.**', tone: 'action' },
      { heading: 'Your request' },
      { rows: details.concat([['Coach', coachShown]]) },
      { heading: 'What happens next' },
      { steps: [coachShown + ' has until **' + expires + '** to accept. If the coach has not answered by then, the request expires and the time is released.',
        'We email you as soon as the coach answers.'] },
      { heading: 'Text updates (optional)' },
      'To subscribe to text notifications about any updates such as session cancellations, add your mobile number when you request a lesson and send a text with the word STUDENT to ' + TEXT_NUMBER + ' from that phone.',
      { heading: 'Need to cancel or move it?' },
      changeSteps_(request)].concat(gridBlocks_(request)) };
  }
  if (request.status === 'confirmed') {
    var reach = [['Email', cleanEmail_(coach.email), 'mailto:' + cleanEmail_(coach.email)], ['Phone', phoneLabel_(coach.phone), 'tel:+1' + phoneDigits_(coach.phone)]]
      .filter(function (row) { return row[1]; });
    return { to: to, subject: 'Lesson confirmed: ' + request.date + ' ' + request.start, lines: [who,
      { callout: '**Your lesson is confirmed.**', tone: 'good' },
      { heading: 'Lesson details' },
      { rows: details.concat([['Coach', String(coach.name).trim()]]) },
      { heading: 'Your coach\'s contact' },
      reach.length ? { rows: reach } : 'Find your coach at the club when you arrive.',
      'Your coach has the contact details from your request and may get in touch about details.',
      { heading: 'Before you come' },
      { rows: [['Arrival', property_('COACHING_ARRIVAL_TEXT', DEFAULT_ARRIVAL)], ['Payment', property_('COACHING_PAYMENT_TEXT', DEFAULT_PAYMENT)],
        ['Guidelines', property_('COACHING_GUIDELINES_TEXT', DEFAULT_GUIDELINES)]] },
      { heading: 'Need to cancel or move it?' },
      'Please do it at least **' + LEAD_HOURS + ' hours ahead**.',
      changeSteps_(request),
      'On the club site this lesson appears as "' + studentName_(request) + ' with ' + coachShown + '".'].concat(gridBlocks_(request)) };
  }
  if (request.status === 'declined') {
    return { to: to, subject: 'Coaching request not accepted', lines: [who,
      coachShown + ' is not able to give the lesson on ' + when + '. You are not booked. You can pick another time at ' + PAGE_URL] };
  }
  if (request.status === 'expired' && request.verified_at) {
    return { to: to, cc: adminEmail_(), subject: 'Coaching request expired: the coach did not answer', lines: [who,
      { callout: 'Sorry: ' + coachShown + ' did not answer your request in time, so it expired and the time was released. **You are not booked.**', tone: 'action' },
      { rows: details.concat([['Coach', coachShown]]) },
      'The club has been copied on this email and will follow up with the coach. You can pick another time at ' + PAGE_URL] };
  }
  if (request.status === 'expired') {
    return { to: to, subject: 'Coaching request expired: we did not get your YES', lines: [who,
      { callout: 'Your request for **' + when + '** with ' + coachShown + ' **expired** because we did not receive your **YES** reply in time. **You are not booked**, and the coach was not asked.', tone: 'action' },
      { heading: 'To book' },
      { steps: ['Request the time again at ' + PAGE_URL + ' (first come, first served).',
        'Reply **YES** to the "Confirm your coaching request" email within **2 hours**. Reply from the same email address.',
        'Cannot find that email? Check your spam or junk folder.',
        'Once you reply, the request goes to ' + coachShown + ' to accept, and we email you the answer.'] }] };
  }
  if (request.status === 'cancelled' && request.cancelled_by === 'student') {
    return { to: to, subject: 'Coaching lesson cancelled', lines: [who, 'As you asked, the lesson with ' + coachShown + ' on ' + when + ' is cancelled and the time was released.'] };
  }
  if (request.status === 'cancelled' && request.cancelled_by === 'coach') {
    return { to: to, subject: 'Lesson cancelled by your coach', lines: [who,
      coachShown + ' had to cancel the lesson on ' + when + '. You can pick another time at ' + PAGE_URL] };
  }
  return null;
}

// Coaches answer a request by replying YES or NO to this email, or to the text for a coach with a mobile number on the list.
// Until the lesson is confirmed the coach sees only the student's name, label and note; email and phone follow on confirmation.
function coachMail_(request, coach, studentRow) {
  var to = cleanEmail_(coach.email);
  if (!to) return null;
  var when = whenLabel_(request.date, request.start, request.minutes);
  if (request.status === 'pending') {
    return { to: to, subject: 'Lesson request from ' + request.student_name + ' ' + refTag_(requestCode_(request)), lines: [
      request.student_name + (request.guardian_name ? ' (under 18)' : '') + ' asked for ' + when + ' at Table ' + (Number(request.table) || 1) + (request.note ? '. Note: ' + request.note : '') + '.',
      'The student\'s email and phone number are sent to you once you confirm.',
      { callout: '**Action needed:** reply to this email by **' + momentLabel_(Number(request.expires_at)) + '**, or the request expires, the time is released and the club is told.', tone: 'action' },
      { choices: [['YES', 'Confirm the lesson.'], ['NO', 'Decline it. The student is told and the time opens again.']] },
      phoneDigits_(coach.phone) ? 'We are also texting your mobile about it. You can answer either one.' : ''] };
  }
  if (request.status === 'confirmed') {
    return { to: to, subject: 'Lesson confirmed: ' + request.date + ' ' + request.start, lines: [
      { callout: '**You confirmed this lesson.**', tone: 'good' },
      { heading: 'Lesson details' },
      { rows: [['Student', studentContact_(request, studentRow)]].concat(lessonRows_(request)) },
      'On the club site it appears as "' + studentName_(request) + ' has session with ' + coachName_(coach) + '".',
      { heading: 'Reminders' },
      { rows: [['Arrival', property_('COACHING_ARRIVAL_TEXT', DEFAULT_ARRIVAL)], ['Payment', property_('COACHING_PAYMENT_TEXT', DEFAULT_PAYMENT)],
        ['Guidelines', property_('COACHING_GUIDELINES_TEXT', DEFAULT_GUIDELINES)]] },
      'Need to cancel? Reply to this email and the club will cancel it and tell the student.'] };
  }
  if (request.status === 'expired' && request.verified_at) {
    return { to: to, cc: adminEmail_(), subject: 'Lesson request expired: no answer', lines: [
      { callout: 'The request from ' + request.student_name + ' for **' + when + '** expired without your answer, so the time was released and the student was told.', tone: 'action' },
      'The club has been copied on this email. If something went wrong, please reply and let us know.'] };
  }
  // Told only if the coach had already heard about the request.
  if (request.status === 'cancelled' && (request.cancelled_by === 'student' || request.cancelled_by === 'move') && request.verified_at) {
    return { to: to, subject: 'Lesson cancelled by ' + request.student_name, lines: [request.student_name + (request.cancelled_by === 'move' ? ' moved the lesson on ' + when + ' to another time' :
      ' cancelled the lesson on ' + when) + '. The time is open again.'] };
  }
  return null;
}

// Texts go through the club's Google Voice number, the same way the desk answers sign-up texts: Voice forwards each incoming
// text to Gmail, and a Gmail reply to that message goes back out as a text. So the app can only text a coach who has texted the
// club number first (the coach texts the word COACH once), and only from the club's own Google account.
function shortWhen_(date, start) {
  return DAYS[weekday_(date)].slice(0, 3) + ' ' + MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3) + ' ' + Number(date.slice(8, 10)) + ', ' + time12_(start);
}

// What happened to a request after the coach was asked about it. Never a link in a text.
function coachText_(request, coach, student) {
  if (!phoneDigits_(coach.phone) || !request.coach_texted) return null;
  var when = shortWhen_(request.date, request.start);
  if (request.status === 'confirmed') {
    return { person: coach, text: 'CTTC: Confirmed. ' + studentName_(request) + ', ' + lessonMinutes_(request.minutes) + ' min lesson ' + when +
      ', Table ' + (Number(request.table) || 1) + ', ' + LOCATION + '. Student: ' + studentContact_(request, student) + '.' };
  }
  if (request.status === 'declined') {
    return { person: coach, text: 'CTTC: Declined. ' + studentName_(request) + ' was told, and ' + when + ' is open again.' };
  }
  if (request.status === 'expired') {
    return { person: coach, text: 'CTTC: The request from ' + studentName_(request) + ' for ' + when + ' expired without an answer, so the time was released.' };
  }
  if (request.status === 'cancelled' && (request.cancelled_by === 'student' || request.cancelled_by === 'move')) {
    return { person: coach, text: 'CTTC: ' + studentName_(request) + (request.cancelled_by === 'move' ? ' moved the lesson on ' + when + ' to another time.' :
      ' cancelled the lesson on ' + when + '.') + ' The time is open again.' };
  }
  return null;
}

// Only for a student who texted STUDENT from the number they gave. Labels only, except the coach's contact once confirmed.
function studentText_(request, coach, student) {
  if (!student || student.texts !== 'yes' || !phoneDigits_(student.phone)) return null;
  var when = shortWhen_(request.date, request.start);
  var again = ' Pick another time at ' + PAGE_URL.replace('https://', '') + '.';
  var text = {
    confirmed: 'your lesson with ' + coachName_(coach) + ' on ' + when + ' is confirmed. Coach: ' + contactLabel_(coach.name, coach.email, coach.phone) + '.',
    declined: coachName_(coach) + ' cannot do ' + when + '. You are not booked.' + again,
    expired: 'your request for ' + when + ' expired without an answer. You are not booked.' + again
  }[request.status];
  if (request.status === 'cancelled') {
    text = request.cancelled_by === 'coach' ? coachName_(coach) + ' cancelled your lesson on ' + when + '.' + again :
      request.cancelled_by === 'move' ? null : 'your lesson on ' + when + ' is cancelled.';
  }
  return text ? { person: { name: student.name, phone: student.phone }, text: 'CTTC: ' + studentName_(request) + ', ' + text } : null;
}

// "Last, First" and "First Last" are the same person; case and spacing do not matter.
function nameKey_(value) {
  var name = String(value || '').replace(/\s+/g, ' ').trim();
  var comma = name.match(/^([^,]+),\s*(.+)$/);
  return (comma ? comma[2] + ' ' + comma[1] : name).toLowerCase();
}

// One forwarded Voice text, or null for anything else (including mail that merely claims to be one: the sender address must be Voice's).
function voiceText_(message) {
  var from = String(message.getFrom() || '');
  var address = ((from.match(/<([^>]+)>/) || [null, from])[1] || '').trim().toLowerCase();
  if (!/@txt\.voice\.google\.com$/.test(address)) return null;
  var subject = String(message.getSubject() || '').match(/^New text message from (.+)$/i);
  if (!subject) return null;
  var sender = subject[1].trim();
  var phone = sender.match(/\(?\+?[\d][\d\s().-]{6,}\d\)?$/);
  var lines = String(message.getPlainBody() || '').split(/\r?\n/).map(function (line) { return line.trim(); });
  var body = [];
  for (var i = 0; i < lines.length; i += 1) {
    if (/^(To respond to this text message|YOUR ACCOUNT|HELP CENTER|HELP FORUM|Google LLC)/i.test(lines[i])) break;
    if (!lines[i] || /^<https:\/\/voice\.google\.com[^>]*>$/.test(lines[i])) continue;
    body.push(lines[i]);
  }
  return {
    name: phone ? sender.slice(0, phone.index).trim() : sender,
    digits: phone ? phoneDigits_(phone[0]) : '',
    text: body.join('\n').slice(0, 500),
    at: message.getDate().getTime(),
    message: message
  };
}

// The same person as the coach on the list: the Google Voice contact name matches the name on the list, or the number does.
function fromCoach_(text, coach) {
  var digits = phoneDigits_(coach.phone);
  return (!!text.name && nameKey_(text.name) === nameKey_(coach.name)) || (!!digits && text.digits === digits);
}

// Recent forwarded texts from one coach or student ({name, phone}), newest first, from the texts the desk collects.
function voiceTextsFrom_(coach, days) {
  return storedTexts_(Date.now() - days * 86400000).map(voiceText_).filter(function (text) { return text && fromCoach_(text, coach); })
    .sort(function (a, b) { return b.at - a.at; });
}

// ---------- Texts, collected by the desk ----------
// Gmail allows a free account about 20,000 reads a day, shared by all the club's apps, and searching Voice texts here every
// minute used them up. The desk's one mail reader (apps-script/MailReader.js) records every forwarded text in its Sheet's
// VoiceTexts tab (within a minute during round robin sign-up, within 5 by day), and the app reads them there (script property DESK_SHEET_ID). Each row is shaped like the
// Gmail message it came from, so voiceText_ reads it unchanged; only a reply opens the real message, by id.
// The desk reads mail every 30 minutes overnight, so only a longer gap means its reader stopped.
var READER_LATE_MS = 45 * 60 * 1000;

// Texts received since the given time (ms). Throws when the desk has stopped collecting them, so the check reports it.
function storedTexts_(since) {
  if (!PropertiesService.getScriptProperties().getProperty('DESK_SHEET_ID')) throw new Error('set the script property DESK_SHEET_ID to the id of the desk Sheet, where texts are collected');
  var desk = book_('DESK_SHEET_ID');
  var reader = desk.getSheetByName('MailReader');
  var readAt = reader && reader.getLastRow() >= 2 ? Number(reader.getRange(2, 1, 1, 1).getValues()[0][0]) || 0 : 0;
  var tab = desk.getSheetByName('VoiceTexts');
  if (!tab || Date.now() - readAt > READER_LATE_MS) {
    throw new Error('the desk has not collected texts since ' + (readAt ? momentLabel_(readAt) : 'it was set up') + ': its mail reader is not running');
  }
  return tab.getDataRange().getValues().slice(1).filter(function (row) { return String(row[0]) && Number(row[1]) >= since; }).map(storedMessage_);
}

// A VoiceTexts row (message_id, received_at, from, subject, text) as the Gmail message it came from.
function storedMessage_(row) {
  var real = null;
  var gmail = function () { return real || (real = GmailApp.getMessageById(String(row[0]))); };
  return {
    getId: function () { return String(row[0]); },
    getDate: function () { return new Date(Number(row[1])); },
    getFrom: function () { return String(row[2]); },
    getSubject: function () { return String(row[3]); },
    getPlainBody: function () { return String(row[4]); },
    getReplyTo: function () { return gmail().getReplyTo(); },
    reply: function (body) { return gmail().reply(body); }
  };
}

// The same, searched in Gmail: only to reply to someone whose last text came before the desk started collecting them.
function gmailTextsFrom_(coach, days) {
  var name = String(coach.name || '').replace(/["\\()]/g, ' ').replace(/\s+/g, ' ').trim();
  var terms = name ? ['subject:"' + name + '"'] : [];
  var digits = phoneDigits_(coach.phone);
  if (digits) terms.push('"' + phoneLabel_(digits) + '"');
  var threads = GmailApp.search('in:anywhere from:txt.voice.google.com newer_than:' + days + 'd (' + terms.join(' OR ') + ')', 0, 20);
  var seen = {};
  var texts = [];
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (seen[message.getId()]) return;
      seen[message.getId()] = true;
      var text = voiceText_(message);
      if (text && fromCoach_(text, coach)) texts.push(text);
    });
  });
  return texts.sort(function (a, b) { return b.at - a.at; });
}

// Replies to the coach's latest text to the club number, which Voice turns into a text back to them. Throws if they have not texted in.
function sendText_(coach, body, log) {
  var latest = voiceTextsFrom_(coach, THREAD_DAYS)[0] || gmailTextsFrom_(coach, THREAD_DAYS)[0];
  if (!latest) throw new Error('this coach has not texted the club number yet');
  var replyTo = String(latest.message.getReplyTo() || latest.message.getFrom() || '');
  if (!/@txt\.voice\.google\.com\b/i.test(replyTo)) throw new Error('the text had no Google Voice reply address');
  latest.message.reply(body);
  if (log) logSent_('text', log[0], log[1], phoneDigits_(coach.phone) || coach.name);
}

// Mail and phone apps add invisible characters (zero-width spaces, left-to-right marks from "dir=auto" HTML, soft hyphens, byte
// order marks) and unusual spaces. Drop the first and turn the rest into plain spaces, so "YES" is just YES.
function plainText_(text) {
  return String(text || '').replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

// Invisible or unusual space characters in a reply that could not be read, as code points (never the text, and never letters in
// any language): for the status read-out.
function oddCharacters_(text) {
  var found = {};
  String(text || '').slice(0, 400).replace(/[\u00A0\u00AD\u034F\u061C\u1680\u180E\u2000-\u200F\u202A-\u202F\u205F-\u206F\u3000\uFE00-\uFE0F\uFEFF]/g, function (character) {
    found['U+' + ('000' + character.charCodeAt(0).toString(16).toUpperCase()).slice(-4)] = true;
    return '';
  });
  return Object.keys(found).slice(0, 8).join(',') || 'none';
}

// What the person wrote themselves in a reply: everything before the quoted earlier message or a signature. Our own emails
// say both "Reply YES" and "Reply NO", so the quoted part must never be read as their answer.
function ownWords_(text) {
  var lines = plainText_(text).split(/\r?\n/).map(function (line) { return line.trim(); });
  var mine = [];
  for (var i = 0; i < lines.length; i += 1) {
    var line = lines[i];
    var next = lines[i + 1] || '';
    // Some apps send only HTML, and Gmail's plain-text version can run lines together ("YESSent from my Galaxy"): a signature
    // or quote marker inside a line ends their words there too.
    var glued = line.search(/sent from my |get outlook for |-{2,}\s*(original|forwarded) message|on\b.{4,}\bwrote:|\[CTTC ref |reply (yes|no):|concord table tennis club|_{5,}/i);
    if (glued > 0) {
      mine.push(line.slice(0, glued).trim());
      break;
    }
    if (/^>/.test(line) || /^-{2,}\s*(original message|forwarded message)/i.test(line) || /^_{5,}$/.test(line) ||
      /^(sent from|get outlook for)\b/i.test(line) || /^--\s*$/.test(line) || /\[CTTC ref |^reply (yes|no)\b|concord table tennis club/i.test(line) || (/^(from|sent|to|subject|date):\s/i.test(line) && mine.length) ||
      /^on\b.{4,}\bwrote:?$/i.test(line) || (/^on\b.{4,}/i.test(line) && /\bwrote:?$/i.test(next))) break;
    mine.push(line);
  }
  return mine.join('\n').trim();
}

// 'yes', 'no' or '' for a reply by text or email: the first line of the person's own words must start with yes or no, in any
// case, after a greeting or "ok" ("Yes, see you Friday", "ok yes", "no thanks", "y"). A yes or no further in ("there is no
// parking", "I have no idea", an out-of-office note) is not an answer, and nor is a line with both ("Yes, but no").
function answerOf_(text) {
  // A greeting on its own line ("Hi John,", "Good morning,") comes before the answer.
  var line = (ownWords_(text).split('\n').filter(function (each) {
    return each && !/^(hi|hey|hello|dear|good (morning|afternoon|evening))\b(?!.*\b(y|yes|yeah|yep|yup|n|no|nope|nah)\b)[^.!?]{0,30}[,.!:]*$/i.test(each);
  })[0] || '').toLowerCase()
    .replace(/^((ok|okay|sure|great|thanks|thank you|no problem|no worries|hi|hey|hello|dear|good (morning|afternoon|evening))\b[\s,.!:-]*([a-z]+[\s,.!:-]+)?(?=(y|yes|yeah|yep|yup|n|no|nope|nah)\b))+/, '')
    .replace(/^((ok|okay|sure|great|thanks|thank you|no problem|no worries)\b[\s,.!:-]*)+/, '');
  var rest = line.replace(/\bno (problem|worries|prob|issues?|rush)\b/g, ' ');
  var yes = /^(y|yes|yeah|yep|yup|yess+)\b/.test(line);
  var no = /^(n|no|nope|nah)\b/.test(line);
  if (yes && /\b(no|nope|nah|not|can't|cannot|cant)\b/.test(rest)) return '';
  if (no && /\b(yes|yeah|yep|yup)\b/.test(rest)) return '';
  return yes ? 'yes' : no ? 'no' : '';
}

function requestQuestion_(request, again) {
  return 'CTTC: ' + (again ? 'Still waiting: ' : '') + 'Lesson request from ' + request.student_name + (request.guardian_name ? ' (under 18)' : '') + ': ' +
    lessonMinutes_(request.minutes) + ' min, ' + shortWhen_(request.date, request.start) + ', Table ' + (Number(request.table) || 1) +
    '. Reply YES to confirm or NO to decline.';
}

// Call while holding the lock. Each coach has at most one question open by text at a time (ask_ref), so a bare YES or NO always
// answers the question we texted last. A new lesson request is asked straight away (unless the open question is under 10 minutes
// old); anything still waiting is asked again once the open question is answered.
function askCoaches_(coaches, requests, now) {
  coaches.forEach(function (coach) {
    if (!coach.coach_id || !active_(coach)) return;
    var changed = false;
    if (coach.ask_slots && !proposalOf_(coach, now) && !expiredProposal_(coach, now)) {
      coach.ask_slots = '';
      coach.ask_made = '';
      changed = true;
    }
    if (!phoneDigits_(coach.phone)) {
      if (changed) save_('Coaches', coach);
      return;
    }
    var waiting = requests.filter(function (request) { return request.coach_id === coach.coach_id && request.status === 'pending'; })
      .sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
    var refs = (proposalOf_(coach, now) ? ['slots'] : []).concat(waiting.map(function (request) { return request.request_id; }));
    var fresh = waiting.filter(function (request) { return request.coach_texted !== 'pending'; })[0];
    var current = refs.indexOf(coach.ask_ref) >= 0 ? coach.ask_ref : '';
    var next = current;
    if (!current) next = fresh ? fresh.request_id : refs[0] || '';
    else if (fresh && now - Number(coach.ask_at) >= PROPOSE_WAIT_MS) next = fresh.request_id;
    if (next && next !== current) {
      var request = waiting.filter(function (entry) { return entry.request_id === next; })[0];
      try {
        sendText_(coach, request ? requestQuestion_(request, request.coach_texted === 'pending') :
          'CTTC: Still waiting: reply YES to publish the coaching times you sent ' + momentLabel_(Number(coach.ask_made)) + ', or NO to cancel.', ['coach-question', next]);
        coach.ask_ref = next;
        coach.ask_at = String(now);
        changed = true;
        if (request && request.coach_texted !== 'pending') {
          request.coach_texted = 'pending';
          save_('Requests', request);
        }
      } catch (error) {
        logError_('text a coach a question', error, coach.coach_id);
      }
    }
    if (coach.ask_ref && refs.indexOf(coach.ask_ref) < 0) {
      coach.ask_ref = '';
      coach.ask_at = '';
      changed = true;
    }
    if (changed) save_('Coaches', coach);
  });
}

// Applies a coach's YES or NO. A text answers the question texted last (ask_ref); an email answers the one its reference code names.
function answer_(coachId, ref, answer, channel) {
  var reply = '';
  var applied = true;
  var status = '';
  var coach = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    coach = coachById_(coachId);
    // A text answers the question texted last; a text with no question open can only be a late answer to an expired list.
    var lateText = !!coach && channel === 'text' && ref === 'slots' && !coach.ask_ref && !!expiredProposal_(coach, now);
    if (!coach || (channel === 'text' && coach.ask_ref !== ref && !lateText)) return;
    // A text reply from the number on the list proves the coach's thread works.
    if (channel === 'text' && !coach.registered_at) coach.registered_at = nowIso_();
    if (ref === 'slots') {
      if (answer === 'yes' && proposalOf_(coach, now)) {
        var done = applyProposal_(coach, now);
        reply = !done.added && !done.removed && done.skipped ?
          'CTTC: Nothing changed: by the time you replied, other coaches had taken every table at those times. Please pick other times on the coaching page.' :
          'CTTC: Done. ' + coachName_(coach) + ' now has ' + done.total + ' upcoming coaching time' + (done.total === 1 ? '' : 's') +
          ' (' + done.added + ' added, ' + done.removed + ' removed).' +
          (done.skipped ? ' ' + done.skipped + ' could not be added because another coach took the table or it overlapped a lesson request.' : '') +
          ' Students can request them at ' + PAGE_URL.replace('https://', '') + '.';
      } else if (expiredProposal_(coach, now)) {
        applied = false;
        status = lateProposal_(coach, answer, channel, now);
      } else {
        applied = answer !== 'yes';
        reply = answer === 'yes' ? 'CTTC: That list expired, so nothing changed. Please submit your times again.' :
          'CTTC: OK, nothing was changed. Your coaching times stay as they were.';
        coach.ask_slots = '';
        coach.ask_made = '';
      }
    } else {
      var request = rows_('Requests').filter(function (entry) { return entry.request_id === ref; })[0];
      status = request ? effectiveStatus_(request, now) : '';
      if (status === 'pending') {
        request.status = status = answer === 'yes' ? 'confirmed' : 'declined';
        request.updated_at = nowIso_();
        save_('Requests', request);
        logStep_(request);
      } else {
        reply = 'CTTC: That lesson request is no longer waiting' + (status ? ' (it is ' + status + ')' : '') + ', so nothing changed.';
        applied = false;
      }
    }
    // The question is answered, unless a late YES just asked it again (lateProposal_ set ask_ref to the new list).
    if (coach.ask_ref === ref && status !== 'late, offered again') {
      coach.ask_ref = '';
      coach.ask_at = '';
    }
    save_('Coaches', coach);
  } finally {
    lock.releaseLock();
  }
  logReply_(channel, ref === 'slots' ? 'coach-slots' : 'coach-request', ref === 'slots' ? coachId : ref, answer, applied, status);
  if (reply) {
    try {
      if (channel === 'text') sendText_(coach, reply, ['coach-answer-reply', ref]);
      else if (mailAvailable_()) sendMail_(cleanEmail_(coach.email), ref === 'slots' ? 'Your coaching times' : 'Lesson request', [reply.replace(/^CTTC: /, '')], null, ['coach-answer-reply', ref]);
    } catch (error) {
      logError_('answer a coach', error, ref);
    }
  }
  sweep_();
}

// The check (checkNow_). Looks for a YES or NO, by text or by email, from each coach or student we asked a question, and for
// STUDENT and STOP texts and coaches texting in to be verified. Never touches Gmail when nobody is waiting on an email. A
// check can outlast the gap to the next one (waiting behind the hourly sweep, a slow Gmail), so a check that starts while
// another is still going does nothing: both would read the same reply and apply it twice, and the second would email "no
// longer waiting" about an answer that just counted. Only this takes the user lock, so it never waits on the script lock
// the rest of the app uses.
//
// ---------- When the check runs ----------
// Google allows a free account 90 minutes a day of timer run time, shared by every club app's timers (the desk's
// apps-script/JobRuntime.js adds them up; docs/google-limits.md), and a run that finds nothing to do still counts. So the
// check has no timer of its own. Everything it reads (texts, and email replies to its questions) comes in through the
// desk's one mail reader, which wakes it (wake_) when a text or a reply has come in: within about 5 minutes by day, a
// minute during round robin sign-up, 30 at night. A wake is a web request, which does not count toward the 90 minutes.
// The hourly sweep runs the check too, so nothing waits more than an hour if a wake is ever missed, and a desk reader
// that stopped is noticed (storedTexts_).
var CHECK_HANDLER = 'checkTexts';
var CHECK_WATCH_HANDLER = 'checkTextsWatch';
// Raised when the timers change: the next run removes the old ones (checkTexts every minute until October 2026, then
// checkTextsWatch every 30 minutes with a one-off checkTexts until November 2026).
var CHECK_SCHEDULE_VERSION = '3';

// The check's old timers: their first run of this version removes them.
function checkTexts(event) { return runCheck_(event); }
function checkTextsWatch(event) { return runCheck_(event); }

function runCheck_(event) {
  return timed_(event, function () {
    retireCheckTimers_();
    checkNow_(false);
  });
}

// Runs the check unless one is running. wait: a wake waits its turn (up to 30 seconds) instead, since the text it brings
// may have come in after the running check read the texts. True when the check ran.
function checkNow_(wait) {
  var cache = CacheService.getScriptCache();
  if (!wait && cache.get('check-texts')) return false;
  var running = LockService.getUserLock();
  if (!running.tryLock(wait ? 30000 : 0)) {
    console.log('coaching checkTexts skipped: the previous check is still running');
    logRow_('-', 'check-skipped', '-', '-');
    return false;
  }
  try {
    cache.put('check-texts', '1', 20);
    checkTexts_();
    return true;
  } finally {
    running.releaseLock();
  }
}

// The first run of this version removes the check's old timers, and puts back the hourly sweep's timer if it is missing.
function retireCheckTimers_() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('CHECK_SCHEDULE') === CHECK_SCHEDULE_VERSION) return;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(function (trigger) {
      if (trigger.getHandlerFunction() === CHECK_HANDLER || trigger.getHandlerFunction() === CHECK_WATCH_HANDLER) ScriptApp.deleteTrigger(trigger);
    });
    if (!triggers.some(function (trigger) { return trigger.getHandlerFunction() === 'sweep'; })) ScriptApp.newTrigger('sweep').timeBased().everyHours(1).create();
    properties.setProperty('CHECK_SCHEDULE', CHECK_SCHEDULE_VERSION);
  } catch (error) {
    logError_('remove the old check timers', error);
  }
}

// ---------- Woken by the desk ----------
// The desk's mail reader (apps-script/MailReader.js) calls this through doPost when texts or an email reply to one of our
// questions came in, with what came in. It decides only whether to look: the check reads everything it acts on from the desk
// Sheet and Gmail, never from the call, so a forged call could change nothing; and one without the desk's key (the desk
// Sheet's hidden AppWake tab) does nothing at all.
function wake_(request) {
  if (!wakeKeyMatches_(String(request.key || ''))) return fail_('Unknown request.');
  if (!wakeWanted_(request)) return { ok: true, checked: false };
  // The STUDENT and STOP scan and coach verification skip a check soon after the last; a wake may be about just that text.
  var cache = CacheService.getScriptCache();
  cache.remove('student-texts');
  cache.remove('verify-coaches');
  return { ok: true, checked: checkNow_(true) };
}

function wakeKeyMatches_(key) {
  if (!key) return false;
  var cache = CacheService.getScriptCache();
  if (cache.get('wake-key') === key) return true;
  var tab = book_('DESK_SHEET_ID').getSheetByName('AppWake');
  var stored = tab && tab.getLastRow() >= 2 ? String(tab.getRange(2, 1, 1, 1).getValues()[0][0] || '') : '';
  if (!stored || stored !== key) return false;
  cache.put('wake-key', stored, 21600);
  return true;
}

// Whether what came in can matter to the check: an email reply to a question, a YES or NO, STUDENT or STOP, or any text from a
// coach waiting to be verified (WAITING_COACHES, kept by verifyCoaches_). Most texts are round robin sign-ups, which need no
// look. Unsure (more texts than the desk passed on, or no list yet): look.
function wakeWanted_(request) {
  if (request.more || Number(request.mail) > 0 || !Array.isArray(request.texts)) return true;
  var waiting = null;
  try { waiting = JSON.parse(PropertiesService.getScriptProperties().getProperty('WAITING_COACHES') || 'null'); } catch (error) { waiting = null; }
  return request.texts.some(function (row) {
    var text = row && voiceText_(storedMessage_(['', Date.now(), row.from, row.subject, row.text]));
    if (!text) return false;
    var word = (text.text.split('\n')[0] || '').trim().replace(/[.!]+$/, '').toUpperCase();
    return !!answerOf_(text.text) || word === 'STUDENT' || word === 'STOP' || !waiting || waiting.some(function (coach) { return fromCoach_(text, coach); });
  });
}

// ---------- Timer run time ----------
// Each timer run's time is added to the app's total for the day, which goes to the desk Sheet's JobRuntime tab (by
// DESK_SHEET_ID) at most every 30 minutes; the desk adds every app's rows and warns. Measured from when the code starts, so
// Google's start-up time is not included. A page call, or a wake from the desk, has no triggerUid and is not measured: it
// does not count toward the limit.
var RUNTIME_APP = 'coaching';
var RUNTIME_REPORT_MS = 30 * 60 * 1000;

function timed_(event, work) {
  if (!(event && event.triggerUid)) return work();
  var started = Date.now();
  try {
    return work();
  } finally {
    addRuntime_(Date.now() - started);
  }
}

function runtimeToday_() {
  var day = Utilities.formatDate(new Date(Date.now()), TZ, 'yyyy-MM-dd HH:mm').slice(0, 10);
  var total = null;
  try { total = JSON.parse(PropertiesService.getScriptProperties().getProperty('JOB_RUNTIME') || 'null'); } catch (error) { total = null; }
  return total && total.day === day ? total : { day: day, runs: 0, ms: 0, reportedAt: 0, previous: total };
}

function addRuntime_(ms) {
  try {
    var total = runtimeToday_();
    var previous = total.previous;
    delete total.previous;
    total.runs += 1;
    total.ms += ms;
    if (Date.now() - total.reportedAt >= RUNTIME_REPORT_MS || previous) {
      total.reportedAt = Date.now();
      var sheet = book_('DESK_SHEET_ID').getSheetByName('JobRuntime');
      if (sheet) {
        if (previous && previous.day) writeRuntime_(sheet, previous);
        writeRuntime_(sheet, total);
      }
    }
    PropertiesService.getScriptProperties().setProperty('JOB_RUNTIME', JSON.stringify(total));
  } catch (error) {
    console.error('Run time not recorded: ' + error);
  }
}

// One row per app and day (app, day, runs, seconds, updated_at), rewritten in place; the leading ' keeps the date as text.
function writeRuntime_(sheet, total) {
  var values = [RUNTIME_APP, "'" + total.day, total.runs, Math.round(total.ms / 100) / 10, new Date(Date.now()).toISOString()];
  var rows = sheet.getDataRange().getValues();
  for (var index = 1; index < rows.length; index += 1) {
    if (String(rows[index][0]) === RUNTIME_APP && String(rows[index][1]) === total.day) {
      sheet.getRange(index + 1, 1, 1, values.length).setValues([values]);
      return;
    }
  }
  sheet.appendRow(values);
}

function checkTexts_() {
  STATUS_ = { failed: [], mail: 'not run' };
  var failing = failingSteps_();
  step_(failing, 'read coach texts', 'Coaches\' YES and NO texts are not being read.', function () { checkCoachTexts_(); });
  step_(failing, 'read student texts', 'Students\' YES and NO texts are not being read.', function () { checkStudentAnswers_(); });
  step_(failing, 'read STUDENT and STOP texts', 'STUDENT and STOP texts are not being read.', checkStudentTexts_);
  step_(failing, 'read email answers', 'YES and NO email replies from coaches and students are not being read.', checkMail_);
  step_(failing, 'verify coaches', 'Coaches who text the club number are not being verified.', verifyCoaches_);
  reportStatus_();
  recordRun_('checkTexts', STATUS_.failed, STATUS_.mail);
}

// What the last check did, as counts only. reportStatus_ shows it in the NAME of a separate, empty spreadsheet
// ("CTTC Coaching status | 10-10 14:30 | mail q=1 ..."), so a maintainer can see whether the check runs and where it stops
// without opening any private data. It never holds a name, an email address or a phone number.
var STATUS_ = { failed: [], mail: 'not run' };

function reportStatus_() {
  try {
    var properties = PropertiesService.getScriptProperties();
    var id = properties.getProperty('COACHING_STATUS_ID');
    var book = null;
    try {
      book = id ? SpreadsheetApp.openById(id) : null;
    } catch (error) {
      book = null;
    }
    if (!book) {
      book = SpreadsheetApp.create('CTTC Coaching status');
      properties.setProperty('COACHING_STATUS_ID', book.getId());
    }
    var now = new Date(Math.floor(Date.now() / 600000) * 600000);
    var name = 'CTTC Coaching status | ' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm') + ' | mail ' + STATUS_.mail +
      ' | failed: ' + (STATUS_.failed.join('; ') || 'none');
    if (book.getName() !== name) book.rename(name.slice(0, 250));
  } catch (error) {
    logError_('update the status read-out', error);
  }
}

function checkCoachTexts_() {
  var now = Date.now();
  rows_('Coaches').filter(function (coach) {
    return coach.coach_id && active_(coach) && phoneDigits_(coach.phone) && (coach.ask_ref && Number(coach.ask_at) > 0 || !coach.ask_ref && expiredProposal_(coach, now));
  }).forEach(function (coach) {
    // With no question open, a YES or NO after the expired list was sent answers that list (late).
    var ref = coach.ask_ref || 'slots';
    var asked = coach.ask_ref ? Number(coach.ask_at) : Number(coach.ask_made);
    var reply = voiceTextsFrom_(coach, 2).filter(function (text) { return text.at > asked && answerOf_(text.text); })
      .sort(function (a, b) { return a.at - b.at; })[0];
    if (reply) answer_(coach.coach_id, ref, answerOf_(reply.text), 'text');
  });
}

function checkStudentAnswers_() {
  rows_('Students').filter(function (student) { return student.ask_ref && Number(student.ask_at) > 0 && phoneDigits_(student.phone); }).forEach(function (student) {
    var asked = Number(student.ask_at);
    var reply = voiceTextsFrom_({ name: student.name, phone: student.phone }, 2).filter(function (text) { return text.at > asked && answerOf_(text.text); })
      .sort(function (a, b) { return a.at - b.at; })[0];
    if (reply) studentAnswer_(student.ask_ref.slice(2), student.ask_ref.slice(0, 1), answerOf_(reply.text), 'text');
  });
}

// One failing step never stops the others (a Gmail hiccup reading texts must not stop email answers being read). A step that
// fails without a break for ALERT_AFTER_MS is emailed to the club once, and the club is emailed again when it works. A step
// that returns false skipped its work (it is throttled), which says nothing either way.
function step_(failing, name, effect, run) {
  var ran;
  try {
    ran = run();
  } catch (error) {
    logError_(name, error);
    STATUS_.failed.push(name + ': ' + cleanDetail_(error).slice(0, 80));
    try {
      stepFailed_(failing, name, effect, error);
    } catch (failure) {
      logError_('track a failing step', failure);
    }
    return;
  }
  if (ran === false || !failing[name]) return;
  try {
    stepWorked_(failing, name);
  } catch (failure) {
    logError_('track a failing step', failure);
  }
}

// The steps failing since their last success, {name: {since, alerted}}, in a script property so the state outlasts the cache.
function failingSteps_() {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('FAILING_STEPS') || '{}');
  } catch (error) {
    logError_('read the failing steps', error);
    return {};
  }
}

function saveFailingSteps_(failing) { PropertiesService.getScriptProperties().setProperty('FAILING_STEPS', JSON.stringify(failing)); }

// The state is saved before the email goes, so a save that fails never sends the same alert every minute.
function stepFailed_(failing, name, effect, error) {
  var now = Date.now();
  var state = failing[name];
  if (!state) {
    failing[name] = { since: now };
    return saveFailingSteps_(failing);
  }
  if (state.alerted || now - state.since < ALERT_AFTER_MS) return;
  state.alerted = now;
  saveFailingSteps_(failing);
  var sent = mailClub_('Action needed: the coaching app cannot ' + name, [
    { callout: 'The coaching app has failed to **' + name + '** at every attempt since ' + momentLabel_(state.since) + '. It retries at least every hour, and whenever a text or an email reply comes in.', tone: 'action' },
    effect,
    'Error: ' + error,
    { heading: 'What to do' },
    { steps: ['Check https://www.google.com/appsstatus/dashboard/ for a Google Sheets or Gmail outage. If Google lists one, no action is needed: the app resumes by itself when Google recovers.',
      'If Google lists no outage, forward this email to ' + MAINTAINER + '.'] },
    'The club gets a follow-up email when this step works again.'], 'step:' + name);
  if (sent) return;
  delete state.alerted;
  saveFailingSteps_(failing);
}

function stepWorked_(failing, name) {
  var state = failing[name];
  delete failing[name];
  saveFailingSteps_(failing);
  if (!state.alerted) return;
  var sent = mailClub_('Resolved: the coaching app can ' + name + ' again', [
    { callout: 'The coaching app can **' + name + '** again as of ' + momentLabel_(Date.now()) + '. No action is needed.', tone: 'good' },
    'It had failed at every attempt from ' + momentLabel_(state.since) + '. This resolves the email "Action needed: the coaching app cannot ' + name + '".'], 'step-resolved:' + name);
  if (sent) return;
  failing[name] = state;
  saveFailingSteps_(failing);
}

// True once the email is sent.
function mailClub_(subject, lines, key) {
  try {
    if (!mailAvailable_()) return false;
    sendMail_(adminEmail_(), subject, lines, null, ['club-alert', key], CLUB_FOOTER);
    return true;
  } catch (error) {
    logError_('alert the club', error);
    return false;
  }
}

// A coach on the list whose number (or Voice contact name) has texted the club, COACH or anything else, can be texted back: that
// is a verified coach. Each is told once, by a reply on that thread. Gmail is searched at most every 10 minutes for this.
function verifyCoaches_() {
  var waiting = rows_('Coaches').filter(function (coach) { return coach.coach_id && active_(coach) && !coach.registered_at && phoneDigits_(coach.phone); });
  // When the desk wakes the check, any text from one of these coaches is worth a look (wakeWanted_).
  var list = JSON.stringify(waiting.map(function (coach) { return { name: coach.name, phone: coach.phone }; }));
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty('WAITING_COACHES') !== list) properties.setProperty('WAITING_COACHES', list);
  var cache = CacheService.getScriptCache();
  if (!waiting.length) return;
  if (cache.get('verify-coaches')) return false;
  cache.put('verify-coaches', '1', 600);
  var found = {};
  waiting.forEach(function (coach) {
    var latest = voiceTextsFrom_(coach, THREAD_DAYS)[0];
    if (latest) found[coach.coach_id] = latest;
  });
  if (!Object.keys(found).length) return;
  var told = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    rows_('Coaches').forEach(function (coach) {
      if (!found[coach.coach_id] || coach.registered_at) return;
      coach.registered_at = nowIso_();
      save_('Coaches', coach);
      told.push({ message: found[coach.coach_id].message, label: coach.label, name: coachName_(coach), coach: coach });
    });
  } finally {
    lock.releaseLock();
  }
  told.forEach(function (entry) {
    try {
      entry.message.reply('CTTC: Thanks, you are verified as ' + entry.name + '. To offer coaching times, open ' + PAGE_URL.replace('https://', '') +
        ', tap I am a coach and pick ' + entry.label + '. We will text you here to confirm your times and lesson requests.');
      logSent_('text', 'coach-verified', entry.coach.coach_id, phoneDigits_(entry.coach.phone) || entry.coach.name);
    } catch (error) {
      logError_('tell a coach they are verified', error, entry.coach.coach_id);
    }
  });
}

// ---------- Answers by email ----------
// Every email that asks a question carries a reference code in its subject, made with the app's secret from what it asks about.
// A reply counts only if it quotes that code and comes from the address the question went to, so nobody can answer for someone else.

function code_(text) {
  return Utilities.computeHmacSha256Signature(text, secret_()).slice(0, 5).map(function (value) { return ('0' + (value & 255).toString(16)).slice(-2); }).join('').toUpperCase();
}

function refTag_(code) { return '[CTTC ref ' + code + ']'; }

function proposalCode_(coachId, made) { return code_('p:' + coachId + ':' + made); }

function requestCode_(request) { return code_('r:' + request.request_id); }

function verifyCode_(request) { return code_('v:' + request.request_id); }

function changeCode_(request) { return code_('c:' + request.request_id + ':' + request.change_at); }

// Every question still waiting for an emailed answer: {code, email, after, kind, id}.
function emailQuestions_(now) {
  var questions = [];
  var offered = null;
  var availability = function () { return offered || (offered = rows_('Availability')); };
  var coaches = rows_('Coaches').filter(function (coach) { return coach.coach_id && active_(coach) && cleanEmail_(coach.email); });
  var byId = {};
  coaches.forEach(function (coach) {
    byId[coach.coach_id] = coach;
    // An expired list is still a question, so a late reply is answered (lateProposal_) rather than ignored.
    if (proposalOf_(coach, now) || expiredProposal_(coach, now)) {
      questions.push({ code: proposalCode_(coach.coach_id, coach.ask_made), email: cleanEmail_(coach.email), after: Number(coach.ask_made), kind: 'slots', id: coach.coach_id });
    }
  });
  var requests = rows_('Requests');
  requests.forEach(function (request) {
    var status = effectiveStatus_(request, now);
    var after = Date.parse(request.created_at) || 0;
    if (status === 'unverified') questions.push({ code: verifyCode_(request), email: request.student_email, after: after, kind: 'v', id: request.request_id });
    if (status === 'expired' && lateVerify_(request, requests, availability(), now)) {
      questions.push({ code: verifyCode_(request), email: request.student_email, after: after, before: Number(request.expires_at), kind: 'v', id: request.request_id });
    }
    if (status === 'pending' && byId[request.coach_id]) {
      questions.push({ code: requestCode_(request), email: cleanEmail_(byId[request.coach_id].email), after: after, kind: 'request', id: request.request_id, coachId: request.coach_id });
    }
    if (request.change && holds_(request, now)) questions.push({ code: changeCode_(request), email: request.student_email, after: Number(request.change_at), kind: 'c', id: request.request_id });
  });
  return questions;
}

function checkMail_() {
  var now = Date.now();
  var questions = emailQuestions_(now);
  STATUS_.mail = 'q=' + questions.length + ' late=' + questions.filter(function (question) { return question.before; }).length;
  if (!questions.length) return;
  var byCode = {};
  questions.forEach(function (question) { byCode[question.code] = question; });
  var answers = {};
  var us = [Session.getEffectiveUser().getEmail(), adminEmail_()].map(function (address) { return String(address || '').toLowerCase(); });
  // Gmail reads count against a daily quota (about 20,000 on a free account, shared by all the club's apps), so only threads
  // with a message from someone else since the last check (a few minutes back, for mail Gmail is slow to make searchable) and
  // since the oldest open question are opened, never threads holding only our own sent questions.
  var properties = PropertiesService.getScriptProperties();
  var checked = Number(properties.getProperty('MAIL_CHECKED_AT')) || 0;
  var since = Math.floor(Math.max(Math.min.apply(null, questions.map(function (question) { return question.after; })), checked - MAIL_OVERLAP_MS) / 1000);
  var threads = GmailApp.search(mailQuery_(since), 0, 50);
  var seen = { messages: 0, matched: 0 };
  threads.forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      seen.messages += 1;
      var code = (String(message.getSubject() || '').match(/\[CTTC ref ([0-9A-F]{10})\]/) || [])[1];
      var question = code && byCode[code];
      if (!question) return;
      var from = String(message.getFrom() || '');
      var address = ((from.match(/<([^>]+)>/) || [null, from])[1] || '').trim().toLowerCase();
      var at = message.getDate().getTime();
      seen.matched += 1;
      if (at <= question.after || (question.before && at >= question.before)) return;
      // Notices go out only for a recent reply to a question still open; a late YES is only looked for.
      var notify = !question.before && Date.now() - at < 5 * 3600000;
      if (!sameAddress_(address, question.email)) {
        if (us.indexOf(address) < 0 && notify) wrongSender_(message.getId(), address, String(message.getSubject() || ''));
        return;
      }
      if (autoReply_(message)) return;
      var body = replyText_(message);
      var answer = answerOf_(body);
      if (!answer) {
        seen.unreadable = (seen.unreadable || 0) + 1;
        seen.odd = oddCharacters_(ownWords_(body).split('\n')[0] || body);
        seen.length = (ownWords_(body).split('\n')[0] || '').length;
        if (notify) unreadableReply_(message.getId(), address, String(message.getSubject() || ''));
        return;
      }
      if (!answers[code] || at < answers[code].at) answers[code] = { question: question, answer: answer, at: at, address: address };
    });
  });
  STATUS_.mail += ' threads=' + threads.length + ' messages=' + seen.messages + ' coded=' + seen.matched + ' answers=' + Object.keys(answers).length +
    (seen.unreadable ? ' unreadable=' + seen.unreadable + ' firstlen=' + seen.length + ' odd=' + seen.odd : '');
  Object.keys(answers).forEach(function (code) {
    var found = answers[code];
    var question = found.question;
    if (question.kind === 'slots') answer_(question.id, 'slots', found.answer, 'email');
    else if (question.kind === 'request') answer_(question.coachId, question.id, found.answer, 'email');
    else studentAnswer_(question.id, question.kind, found.answer, 'email', found.at);
  });
  properties.setProperty('MAIL_CHECKED_AT', String(now));
}

// The reply as the person sees it. Gmail's plain-text version of an HTML-only email can run lines together ("YESSent from my
// Galaxy"), so when there is HTML its line breaks are used, with the quoted earlier message marked as a quote.
function replyText_(message) {
  var plain = String(message.getPlainBody() || '');
  var html = '';
  try {
    html = typeof message.getBody === 'function' ? String(message.getBody() || '') : '';
  } catch (error) {
    html = '';
  }
  if (!/<(div|p|br|blockquote)\b/i.test(html)) return plain;
  var text = html.replace(/<(style|script|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<(blockquote|div[^>]*(gmail_quote|divRplyFwdMsg|appendonsend|yahoo_quoted|moz-cite-prefix))\b[^>]*>/gi, '\n> ')
    .replace(/<br\s*\/?>|<\/(div|p|li|tr|h[1-6]|table)>|<(div|p|li|tr|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, function (match, code) { return String.fromCharCode(Number(code)); }).replace(/&amp;/gi, '&');
  return answerOf_(text) ? text : plain;
}

// Out-of-office and other automatic replies are never answers.
function autoReply_(message) {
  if (/^(automatic reply|auto(-| )?reply|out of (the )?office|autoreply|away)/i.test(String(message.getSubject() || '').replace(/^(re|fwd?):\s*/i, ''))) return true;
  try {
    var header = String(message.getHeader ? message.getHeader('Auto-Submitted') || '' : '').toLowerCase();
    return !!header && header !== 'no';
  } catch (error) {
    return false;
  }
}

function mailQuery_(since) { return 'newer_than:3d subject:"CTTC ref" -from:me after:' + since; }

// The same mailbox: case never matters, and for Gmail neither do dots or a +tag in the name.
function sameAddress_(a, b) {
  var key = function (address) {
    var parts = String(address || '').trim().toLowerCase().split('@');
    if (parts.length !== 2) return parts.join('@');
    if (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com') return parts[0].split('+')[0].replace(/\./g, '') + '@gmail.com';
    return parts.join('@');
  };
  return key(a) === key(b);
}

// A reply quoting our code from another address does not count (nobody may answer for someone else), but it is never silent:
// the sender is told to reply from the address the question went to, once per reply. The club is not emailed: the sender has
// what they need to fix it.
function wrongSender_(messageId, address, subject) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sender:' + messageId) || !mailAvailable_()) return;
    cache.put('sender:' + messageId, '1', 21600);
    try {
      sendMail_(address, 'Your reply did not count: please answer from the right address', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') +
        '", but it came from a different email address than the one the question was sent to, so nothing changed.',
        { callout: 'Please **reply from the email address the question was sent to**, saying **YES** or **NO**.', tone: 'action' }], null, ['wrong-sender', messageId]);
    } catch (error) {
      logError_('tell a sender to use the right address', error, messageId);
    }
  } catch (error) {
    logError_('send a reply notice', error);
  }
}

// A reply to one of our questions that is not a clear YES or NO: tell the sender how to answer, once per reply. The club is not
// emailed: the sender has what they need to fix it.
function unreadableReply_(messageId, address, subject) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('unread:' + messageId) || !mailAvailable_()) return;
    cache.put('unread:' + messageId, '1', 21600);
    try {
      sendMail_(address, 'We could not read your reply', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') + '", but could not tell whether it was YES or NO.',
        { callout: 'Please **reply to that email again** saying just **YES** or **NO** (not both).', tone: 'action' }], null, ['unreadable-reply', messageId]);
    } catch (error) {
      logError_('tell a sender their reply was unreadable', error, messageId);
    }
  } catch (error) {
    logError_('send a reply notice', error);
  }
}

// A student's YES that arrived before the request expired, but was read late (or not at all, before the fixes of 2026-10-10),
// still counts while the lesson is far enough ahead and nobody else holds the time.
function lateVerify_(request, requests, availability, now) {
  if (effectiveStatus_(request, now) !== 'expired' || request.verified_at || request.cancelled_by) return false;
  if (now - (Date.parse(request.created_at) || 0) > 3 * 86400000 || expiryFor_(request.date, request.start) - now < 60 * 60000) return false;
  var taken = requests.some(function (other) {
    return other.request_id !== request.request_id && holds_(other, now) && other.coach_id === request.coach_id && other.date === request.date &&
      overlaps_(other.start, other.minutes, request.start, request.minutes);
  });
  var offered = availability.some(function (entry) {
    return entry.coach_id === request.coach_id && entry.confirmed === 'yes' && entry.date === request.date && overlaps_(entry.start, entry.minutes, request.start, request.minutes);
  });
  return !taken && offered && !!coachById_(request.coach_id);
}

// STUDENT turns on lesson texts for every student whose mobile number (or, for a saved Voice contact, name) matches; STOP turns
// them off. Gmail is only searched once some student has given a number.
function checkStudentTexts_() {
  // STUDENT and STOP only switch texts on or off, so every 5 minutes is soon enough.
  var cache = CacheService.getScriptCache();
  if (cache.get('student-texts')) return false;
  cache.put('student-texts', '1', 300);
  if (!rows_('Students').some(function (student) { return phoneDigits_(student.phone); })) return;
  var texts = [];
  storedTexts_(Date.now() - 2 * 86400000).forEach(function (message) {
    var text = voiceText_(message);
    var word = text ? text.text.split('\n')[0].trim().replace(/[.!]+$/, '').toUpperCase() : '';
    if (word === 'STUDENT' || word === 'STOP') {
      text.word = word;
      texts.push(text);
    }
  });
  texts.sort(function (a, b) { return a.at - b.at; });
  var answers = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var students = rows_('Students').filter(function (student) { return phoneDigits_(student.phone); });
    texts.forEach(function (text) {
      var matched = students.filter(function (student) {
        return text.digits ? text.digits === phoneDigits_(student.phone) : !!text.name && nameKey_(text.name) === nameKey_(student.name);
      }).filter(function (student) { return text.at > Number(student.texts_at || 0); });
      if (!matched.length) return;
      matched.forEach(function (student) {
        student.texts = text.word === 'STUDENT' ? 'yes' : '';
        student.texts_at = String(text.at);
        save_('Students', student);
      });
      answers.push({ message: text.message, word: text.word.toLowerCase(), digits: text.digits || text.name, body: text.word === 'STUDENT' ?
        'CTTC: You will get texts about your coaching lessons, such as cancellations. Text STOP to stop.' :
        'CTTC: Coaching texts are off. Text STUDENT to turn them back on.' });
    });
  } finally {
    lock.releaseLock();
  }
  answers.forEach(function (answer) {
    try {
      answer.message.reply(answer.body);
      logSent_('text', 'student-texts-' + answer.word, answer.message.getId(), answer.digits);
    } catch (error) {
      logError_('answer a student text', error);
    }
  });
}

function adminEmail_() { return property_('ADMIN_EMAIL', Session.getEffectiveUser().getEmail()); }

function mailAvailable_() { return MailApp.getRemainingDailyQuota() > MIN_QUOTA; }

// **text** is bold in HTML and plain in text; links become clickable.
function mailHtml_(text) {
  return esc_(text).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(https:\/\/[A-Za-z0-9_.\/?=&;%-]+)/g, '<a href="$1">$1</a>');
}

function mailText_(text) { return String(text).replace(/\*\*/g, ''); }

// A block is a paragraph string, or { heading }, { callout, tone }, { rows: [[label, value, link]] }, { steps }, { choices: [[reply, meaning]] }
// or { html, text } (text is the plain-text stand-in).
function blockText_(block) {
  if (typeof block === 'string') return mailText_(block);
  if (block.choices) return block.choices.map(function (choice) { return 'Reply ' + choice[0] + ': ' + mailText_(choice[1]); }).join('\n');
  if (block.heading) return block.heading.toUpperCase();
  if (block.callout) return mailText_(block.callout);
  if (block.rows) return block.rows.map(function (row) { return row[0] + ': ' + mailText_(row[1]); }).join('\n');
  if (block.steps) return block.steps.map(function (step, index) { return (index + 1) + '. ' + mailText_(step); }).join('\n');
  return block.text || '';
}

function blockHtml_(block) {
  if (typeof block === 'string') return '<p style="margin:0 0 12px;">' + mailHtml_(block) + '</p>';
  if (block.heading) return '<h3 style="margin:22px 0 8px;padding-bottom:4px;border-bottom:1px solid #ddd;font-size:16px;color:#1f4f8f;">' + esc_(block.heading) + '</h3>';
  if (block.callout) {
    var tone = block.tone === 'good' ? 'background:#e3f1e7;border-left:5px solid #1f6b3a;' : 'background:#fff4d6;border-left:5px solid #c98a00;';
    return '<div style="' + tone + 'padding:10px 14px;margin:0 0 14px;border-radius:4px;font-size:16px;">' + mailHtml_(block.callout) + '</div>';
  }
  if (block.rows) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 12px;font-size:15px;">' + block.rows.map(function (row) {
      return '<tr><td style="padding:3px 16px 3px 0;vertical-align:top;font-weight:700;white-space:nowrap;">' + esc_(row[0]) + '</td><td style="padding:3px 0;vertical-align:top;">' +
        (row[2] ? '<a href="' + esc_(row[2]) + '">' + esc_(row[1]) + '</a>' : mailHtml_(row[1])) + '</td></tr>';
    }).join('') + '</table>';
  }
  if (block.choices) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 14px;font-size:15px;">' + block.choices.map(function (choice) {
      return '<tr><td style="padding:4px 12px 4px 0;vertical-align:top;white-space:nowrap;"><span style="display:inline-block;min-width:88px;text-align:center;padding:3px 8px;border-radius:4px;font-weight:700;color:#fff;background:' +
        (choice[0] === 'YES' ? '#1f6b3a' : '#a3332a') + ';">Reply ' + esc_(choice[0]) + '</span></td><td style="padding:6px 0;vertical-align:top;">' + mailHtml_(choice[1]) + '</td></tr>';
    }).join('') + '</table>';
  }
  if (block.steps) return '<ol style="margin:0 0 12px;padding-left:22px;">' + block.steps.map(function (step) { return '<li style="margin:0 0 6px;">' + mailHtml_(step) + '</li>'; }).join('') + '</ol>';
  return block.html || '';
}

function sendMail_(to, subject, lines, cc, log, footer) {
  var blocks = lines.filter(Boolean);
  footer = footer || 'This message is only about your coaching request. It does not add you to the results mailing list.';
  var body = blocks.map(blockText_).filter(Boolean).concat(footer).join('\n\n');
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px;">' + blocks.map(blockHtml_).join('') +
    '<p style="margin:20px 0 0;font-size:12px;color:#777;">' + esc_(footer) + '</p></div>';
  var message = { to: to, subject: subject, body: body, htmlBody: html, name: FROM_NAME };
  if (cc) message.cc = cc;
  MailApp.sendEmail(message);
  if (log) logSent_('email', log[0], log[1], cleanEmail_(to) || to);
}

// One log line per message sent, so a maintainer can count exactly what went to whom, and when, in the execution logs. It names
// the kind of message and the request (or coach, wait, reply) it is about, and the recipient only as a short code made with the
// app's secret: the same person always gets the same code, but no name, address or number is ever written to the logs.
// The line also goes to the private Log tab, which ?log shows (logView_). appendRow adds a whole row in one step, so two sends at
// once never overwrite each other's row, and the leading ' keeps every value as plain text.
function logSent_(channel, kind, ref, to) {
  try {
    var code = code_('to:' + String(to || '').trim().toLowerCase()).slice(0, 6);
    console.log('coaching sent ' + channel + ' ' + kind + ' ref=' + (ref || '-') + ' to=' + code);
    logRow_(channel, kind, ref || '-', code);
  } catch (error) {
    console.error('Could not log a sent message: ' + error);
  }
}

function logRow_(channel, kind, ref, to, detail) {
  try {
    tab_('Log').appendRow([nowIso_(), channel, kind, ref, to, detail || ''].map(function (value) { return "'" + value; }));
  } catch (error) {
    console.error('Could not write to the Log tab: ' + error);
  }
}

// The code a booking goes by in the log and in every email about it: the same six characters in both, so a student, a coach or the
// club can quote it and a maintainer can find the booking's whole story at ?log=<code>. Made with the app's secret from the
// request id, so it says nothing about the person. A move starts a new request, with a new code.
function refCode_(ref) { return code_('ref:' + ref).slice(0, 6); }

function bookingCode_(request) { return refCode_(request.request_id); }

function bookingLine_(request) { return 'Booking code: ' + bookingCode_(request) + '. Quote it if you contact the club about this lesson.'; }

// A request moved to a new step (channel 'step'): the status, who must act next and by when, or who cancelled it.
function logStep_(request, extra) {
  var waiting = waitingOn_(request, Date.now());
  var detail = waiting ? 'waiting on ' + waiting + ' until ' + momentLabel_(Number(request.expires_at)) :
    request.status === 'cancelled' && request.cancelled_by ? 'by ' + request.cancelled_by : '';
  logRow_('step', 'step:' + request.status, request.request_id, '-', [detail, extra].filter(Boolean).join(', '));
}

// Something went wrong: the console gets the full error, the Log tab a row (channel 'error') with what failed, what it was about,
// and the error with every address, number, quoted text and long id taken out. The same failure is logged at most every 10
// minutes, so one that repeats at every check does not push everything else out of the log.
function logError_(what, error, ref) {
  console.error('Could not ' + what + ': ' + error);
  try {
    var kind = String(what).toLowerCase().replace(/[^a-z0-9_:]+/g, '-');
    var cache = CacheService.getScriptCache();
    var key = 'logged:' + kind + ':' + (ref || '-');
    if (cache.get(key)) return;
    cache.put(key, '1', 600);
    logRow_('error', kind, ref || '-', '-', cleanDetail_(error));
  } catch (failure) {
    console.error('Could not log a failure: ' + failure);
  }
}

// An error message with nothing personal left in it: addresses, numbers, quoted text and long ids are replaced.
function cleanDetail_(error) {
  return String(error).replace(/\S+@\S+/g, '<address>').replace(/\+?\d[\d\s().-]{5,}\d/g, '<number>').replace(/"[^"]*"/g, '"…"')
    .replace(/'[^']*'/g, "'…'").replace(/[A-Za-z0-9_-]{20,}/g, '<id>').slice(0, 120);
}

// A YES or NO that was read and acted on (channel 'email' or 'text'), and whether it changed anything.
function logReply_(channel, who, ref, answer, applied, status) {
  logRow_(channel, 'reply:' + who + ':' + answer, ref, '-', (applied ? 'applied' : 'not applied') + (status ? ', now ' + status : ''));
}

// The last run of the check and of the sweep, shown at ?log: when, which steps failed and, for the check, the same
// mail counts as the status read-out (reportStatus_). Kept in script properties,
// not the Log tab, so frequent checks do not fill the log.
function recordRun_(name, failed, mail) {
  try {
    var run = { at: nowIso_(), ok: !failed.length, failed: failed };
    if (mail) run.mail = mail;
    PropertiesService.getScriptProperties().setProperty('RUN_' + name, JSON.stringify(run));
  } catch (error) {
    console.error('Could not record a run: ' + error);
  }
}

function lastRun_(name) {
  try {
    return JSON.parse(PropertiesService.getScriptProperties().getProperty('RUN_' + name) || 'null');
  } catch (error) {
    return null;
  }
}

// What ?log=<code> says about one booking: its lesson time, step and deadline, as the public schedule shows them. null when no
// booking from the last 60 days has that code.
function bookingSummary_(code) {
  var now = Date.now();
  var request = rows_('Requests').filter(function (entry) {
    return now - (Date.parse(entry.created_at) || 0) < 60 * 86400000 && bookingCode_(entry) === code;
  })[0];
  if (!request) return null;
  var status = effectiveStatus_(request, now);
  var waiting = waitingOn_(request, now);
  return { code: code, date: request.date, start: request.start, status: status, waitingOn: waiting,
    deadline: waiting ? new Date(Number(request.expires_at)).toISOString() : '' };
}

// Call while holding the lock. Keeps the Log tab to its latest LOG_KEEP rows.
function trimLog_() {
  var sheet = tab_('Log');
  var extra = sheet.getLastRow() - 1 - LOG_KEEP;
  if (extra > 0) sheet.deleteRows(2, extra);
}

// The web app's address with ?log: the latest messages sent, as JSON, for a maintainer checking that nobody got the same message
// twice. Anyone can open it, so it holds only the time, the channel, the kind of message, and codes made with the app's secret
// for what it was about and who got it: never a name, address, number or id from the private Sheet. Read at most
// MAX_LOG_READS_PER_MINUTE times a minute.
function logView_(code) {
  var cache = CacheService.getScriptCache();
  var key = 'log-reads:' + Math.floor(Date.now() / 60000);
  var reads = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(reads), 120);
  var body = reads > MAX_LOG_READS_PER_MINUTE ? { ok: false, message: 'Too many reads. Try again in a minute.' } : {
    ok: true,
    runs: { checkTexts: lastRun_('checkTexts'), sweep: lastRun_('sweep') },
    booking: /^[0-9A-F]{6}$/.test(code) ? bookingSummary_(code) : undefined,
    lines: rows_('Log').map(function (entry) {
      return { at: entry.at, channel: entry.channel, kind: entry.kind, ref: entry.ref === '-' ? '-' : refCode_(entry.ref), to: entry.to, detail: entry.detail };
    }).filter(function (line) { return !/^[0-9A-F]{6}$/.test(code) || line.ref === code; }).slice(-LOG_SHOWN)
  };
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- The app's secret ----------

function secret_() {
  var properties = PropertiesService.getScriptProperties();
  var value = properties.getProperty('TOKEN_SECRET');
  if (!value) {
    value = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    properties.setProperty('TOKEN_SECRET', value);
  }
  return value;
}
