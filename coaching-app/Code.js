// Public coaching app. Like subscribe-app/ this is its own Apps Script project: a public web app exposes every
// function in its project, so the desk's code must never live here.
//
// Nobody needs a Google account, and nobody on the club's account has to manage anything. The web app runs as the club
// owner and does all the work. Two Sheets keep the data apart:
//   - the PRIVATE Sheet (script property COACHING_DB_ID) holds names, emails, notes and the requests themselves;
//   - the PUBLIC Sheet (COACHING_PUBLIC_ID) is shared "anyone with the link can view". It shows only first names such as
//     "Coach Olaf" and "Student Sam", dates and times; never a last name, email or phone number. Internally each coach and
//     student also has a label ("Coach O", "Student A"); coaches still pick their label on the page.
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
var ASK_TTL_MS = 24 * 60 * 60 * 1000;
var PROPOSE_WAIT_MS = 10 * 60 * 1000;
var MAX_PROPOSALS_PER_DAY = 10;
var THREAD_DAYS = 90;
var MAX_STUDENTS = 3000;
var MAX_REQUESTS = 5000;
var MAX_PER_MINUTE = 30;
var RETRY_MAIL_DAYS = 3;
var MIN_QUOTA = 10;
// How long a new request holds its time while waiting for the student's YES.
var VERIFY_MS = 2 * 60 * 60 * 1000;
var CHANGE_WAIT_MS = 10 * 60 * 1000;

var SITE_URL = 'https://concordtabletennisclub.com';
var PAGE_URL = SITE_URL + '/coaching.html';
var FROM_NAME = 'Concord Table Tennis Club';
var TEXT_NUMBER = '(925) 238-3505';
var LOCATION = 'Walnut Creek Christian Academy, 2336 Buena Vista Ave, Walnut Creek, CA 94597';
// Overridable with script properties so payment details never have to be committed.
var DEFAULT_ARRIVAL = 'Please arrive about 10 minutes early. Bring athletic shoes; the club has loaner paddles.';
var DEFAULT_PAYMENT = 'Pay the lesson fee directly to your coach. The regular session fee is paid at the front desk.';
var DEFAULT_GUIDELINES = 'Be on time, tell your coach about any injury, and treat the club, equipment and other players with respect.';
// The coaches listed on the public coaching page. setup() adds any that are missing; the owner adds each mobile number in the Sheet.
var CLUB_COACHES = [
  ['Olaf Surmann', ''],
  ['Dominic Chan', 'dominicchan@sbcglobal.net'],
  ['Xin Huang', 'xinwjhuang@gmail.com'],
  ['Fuqun (Bill) Xing', 'xfqslw@gmail.com'],
  ['Tom (Xiaoyun) Zeng', 'xiaoyunzeng64@gmail.com'],
  ['Raymond Trinh', '']
];

var EMAIL_PATTERN = /^[a-z0-9][a-z0-9._%+'-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}$/i;
var NAME_PATTERN = /^[\p{L}][\p{L} .'\u2019-]{0,59}$/u;
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
    'reminded']
};
// Public Sheet. Nothing private ever goes in here.
var PUBLIC_TABS = {
  Schedule: ['date', 'day', 'start', 'end', 'coach', 'status', 'student', 'summary']
};

function doGet() {
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
    console.error('Could not prepare the first screen: ' + error);
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
  var listed = rows_('Coaches');
  CLUB_COACHES.forEach(function (coach) {
    if (listed.some(function (entry) {
      return entry.name.trim().toLowerCase() === coach[0].toLowerCase() || (coach[1] && cleanEmail_(entry.email) === coach[1]);
    })) return;
    save_('Coaches', { name: coach[0], email: coach[1] });
  });
  ensureCoachIds_(rows_('Coaches'));
  var publicBook = publicBook_();
  (publicBook.getSheetByName('About') || publicBook.insertSheet('About')).getRange(1, 1, 1, 1).setValues([[
    'This is a read-out of the coaching schedule. It shows only first names (Coach Olaf, Student Sam) and times. Changing it does not change any booking: ' +
    'the schedule is rebuilt from private records after every booking and every hour. Please use the coaching page to book or offer times.'
  ]]);
  [database_(), publicBook].forEach(function (book) {
    var blank = book.getSheetByName('Sheet1');
    if (blank && book.getSheets().length > 1) book.deleteSheet(blank);
  });
  var triggers = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
  if (triggers.indexOf('sweep') < 0) ScriptApp.newTrigger('sweep').timeBased().everyHours(1).create();
  if (triggers.indexOf('checkTexts') < 0) ScriptApp.newTrigger('checkTexts').timeBased().everyMinutes(1).create();
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
function book_(key) {
  var id = PropertiesService.getScriptProperties().getProperty(key);
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

function fail_(message) { return { ok: false, message: message }; }

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
  return (comma ? comma[1] : text).split(' ')[0];
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

// "Coach O" for Olaf. Two coaches with the same initial become "Coach O" and "Coach O2".
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
    sheet.clearContents();
    sheet.getRange(1, 1, values.length, values[0].length).setNumberFormat('@').setValues(values);
  } catch (error) {
    console.error('Could not update the public schedule: ' + error);
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
  if (!name) return fail_('Please enter the student\'s name using letters only.');
  if (!email) return fail_('Please enter a valid email address.');
  if (String(form.phone || '').trim() && !phone) return fail_('Please enter a 10 digit US mobile number, or leave it blank.');
  if (minor && !guardian) return fail_('Please enter a parent or guardian name. Use the guardian\'s email address for students under 18.');
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
    if (open >= MAX_OPEN_REQUESTS_PER_STUDENT) return fail_('You already have ' + MAX_OPEN_REQUESTS_PER_STUDENT + ' requests waiting for an answer. Please wait for a reply or cancel one.');
    var label = studentLabel_(email, guardian || name, phone);
    if (!label) return fail_('Requests are closed for now. Please contact the club.');
    if (minutes !== slot.minutes) splitSlot_(slot.key);
    created = {
      request_id: id_(), coach_id: slot.coachId, date: slot.date, start: start, minutes: minutes, student_label: label, student_name: name,
      student_email: email, guardian_name: guardian, note: cleanNote_(form.note), status: 'unverified', created_at: nowIso_(),
      expires_at: Math.min(now + VERIFY_MS, expiryFor_(slot.date, start)), cancelled_by: '', student_emailed: '', coach_emailed: '', updated_at: nowIso_(), table: slot.table
    };
    save_('Requests', created);
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
    console.error('Request ' + created.request_id + ' was saved, but the follow-up failed: ' + error);
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
  if (!email) return fail_('Please enter a valid email address.');
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
        'You were on the waitlist for this time and have now been taken off it.']));
    } catch (error) {
      console.error('Could not email the waitlist: ' + error);
      return;
    }
    drop.push(wait._row);
  });
  drop.sort(function (a, b) { return b - a; }).forEach(function (row) { tab_('Waitlist').deleteRow(row); });
}

// ---------- Public: coaches ----------

// Call while holding the lock. Gives each coach the owner has listed an id and a label such as "Coach O" the first time it is needed.
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
function proposalOf_(coach, now) {
  if (!coach.ask_slots || !(now - Number(coach.ask_made) < ASK_TTL_MS)) return null;
  try {
    return JSON.parse(coach.ask_slots);
  } catch (error) {
    return null;
  }
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
          { callout: '**Action needed:** reply to this email. **Nothing changes until you reply.**', tone: 'action' },
          { choices: [['YES', 'Publish these changes to ' + coachName_(coach) + '\'s coaching times.'], ['NO', 'Cancel. Your coaching times stay as they are.']] },
          plan.add.length ? 'Add: ' + slotList_(plan.add) : '',
          plan.remove.length ? 'Remove: ' + slotList_(plan.remove) : '',
          phoneDigits_(coach.phone) ? 'We also texted your mobile. You can answer either one.' :
            'Want to confirm by text instead? Ask the club to add your mobile number to the coach list.',
          'If you did not ask for this, ignore this email and nothing will change.'
        ]);
        sent.email = true;
      } catch (error) {
        console.error('Could not email a coach to confirm times: ' + error);
      }
    }
    if (phoneDigits_(coach.phone)) {
      try {
        sendText_(coach, proposalText_(coach, plan));
        sent.text = true;
      } catch (error) {
        console.error('Could not text a coach to confirm times: ' + error);
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

function proposalText_(coach, plan) {
  return 'CTTC: Reply YES to update ' + coachName_(coach) + '\'s coaching times, or NO to cancel.' +
    (plan.add.length ? ' Add: ' + slotList_(plan.add) + '.' : '') + (plan.remove.length ? ' Remove: ' + slotList_(plan.remove) + '.' : '') +
    ' Nothing changes until you reply.';
}

// Call while holding the lock, after the coach replied YES. Times another coach took in the meantime are skipped.
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
  if (!email && !phone) return fail_('Please enter the email address or mobile number you booked with.');
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
        'If you did not ask for this, ignore this email.']));
    }
  } catch (error) {
    console.error('Could not email a student about a change: ' + error);
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
    sendText_({ name: student.name, phone: student.phone }, body);
  } catch (error) {
    console.error('Could not text a student a question: ' + error);
    return;
  }
  student.ask_ref = ref;
  student.ask_at = String(Date.now());
  save_('Students', student);
}

// Applies a student's YES or NO. kind 'v' confirms a new request; 'c' a cancellation or move.
function studentAnswer_(requestId, kind, answer, channel, answeredAt) {
  var reply = '';
  var request = null;
  var student = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    var requests = rows_('Requests');
    request = requests.filter(function (entry) { return entry.request_id === requestId; })[0];
    if (!request) return;
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
      } else if (answer === 'no') {
        reply = 'OK, nothing changed. ' + studentName_(request) + '\'s lesson on ' + whenLabel_(request.date, request.start, request.minutes) + ' stays as it is.';
      } else if (change === 'cancel') {
        request.status = 'cancelled';
        request.cancelled_by = 'student';
      } else {
        var slot = openSlots_(rows_('Coaches'), rows_('Availability'), requests, now).filter(function (candidate) { return candidate.key === change.slice(5); })[0];
        if (!slot) {
          reply = 'That new time was taken before you replied, so nothing changed. Your lesson on ' + whenLabel_(request.date, request.start, request.minutes) + ' stays as it is.';
        } else {
          request.status = 'cancelled';
          request.cancelled_by = 'move';
          save_('Requests', {
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
  } finally {
    lock.releaseLock();
  }
  if (reply) {
    try {
      if (channel === 'text') sendText_({ name: student.name, phone: student.phone }, 'CTTC: ' + reply);
      else if (mailAvailable_()) sendMail_(request.student_email, 'Your coaching lesson', [reply]);
    } catch (error) {
      console.error('Could not answer a student: ' + error);
    }
  }
  sweep_();
}

// ---------- Expiry, email and the public schedule ----------

// Run by the hourly trigger. Expires unanswered requests, retries any email that has not gone out, drops past slots,
// and rebuilds the public schedule (which also repairs any edits made to it).
function sweep() { sweep_(); }

function sweep_() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
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
      if (message.text) sendText_(message.person, message.text);
      else sendMail_(message.to, message.subject, message.lines, message.cc);
    } catch (error) {
      console.error('Could not send a coaching ' + (message.text ? 'text' : 'email') + ': ' + error);
      return;
    }
  }
  request[field] = request.status;
  save_('Requests', request);
}

// Call while holding the lock. A request still waiting on someone's YES after a while gets one reminder, saying exactly who must
// reply and to what. The reminder keeps the question's reference code, so a reply to it counts as an answer. Once the student has
// confirmed, they are also told it now waits on the coach. The coach hears nothing before the student's YES, so nobody can use the
// page to message a coach in someone else's name. Each waiting step is reminded once (reminded); a failed send is retried later.
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
        console.error('Could not send part of a coaching reminder: ' + error);
      }
    };
    if (status === 'unverified') {
      attempt(function () {
        var ask = studentMail_(request, coach);
        sendMail_(ask.to, 'Reminder: ' + ask.subject, [who,
          { callout: '**Still waiting for you:** ' + lesson + ' has **not** been sent to the coach yet. Reply **YES** to this email by **' + deadline +
            '** to send it. If you do not reply, the request expires and the time is released.', tone: 'action' },
          'Reply from this same email address. Replying to the earlier "Confirm your coaching request" email works too.'
        ].concat(ask.lines.slice(2)));
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
          'Reply from this same email address.'].concat(question.lines));
    });
    attempt(function () {
        if (phoneDigits_(coach.phone) && coach.ask_ref === request.request_id) sendText_(coach, requestQuestion_(request, true));
    });
    attempt(function () {
        sendMail_(request.student_email, 'Your coaching request is waiting on ' + coachName_(coach), [who,
          { callout: lesson + ' is **waiting for ' + coachName_(coach) + ' to accept it.** You confirmed it, so **nothing more is needed from you**. It is not booked until the coach accepts.', tone: 'action' },
          'If the coach has not answered by **' + deadline + '**, the request expires, the time is released and the club follows up. We email you as soon as the coach answers.']);
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
    console.error('Could not draw the schedule for an email: ' + error);
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

// Recent forwarded texts from one coach or student ({name, phone}), newest first.
function voiceTextsFrom_(coach, days) {
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
function sendText_(coach, body) {
  var latest = voiceTextsFrom_(coach, THREAD_DAYS)[0];
  if (!latest) throw new Error('this coach has not texted the club number yet');
  var replyTo = String(latest.message.getReplyTo() || latest.message.getFrom() || '');
  if (!/@txt\.voice\.google\.com\b/i.test(replyTo)) throw new Error('the text had no Google Voice reply address');
  latest.message.reply(body);
}

// Mail and phone apps add invisible characters (zero-width spaces, left-to-right marks from "dir=auto" HTML, soft hyphens, byte
// order marks) and unusual spaces. Drop the first and turn the rest into plain spaces, so "YES" is just YES.
function plainText_(text) {
  return String(text || '').replace(/[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFE00-\uFE0F\uFEFF]/g, '')
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ');
}

// Characters outside plain ASCII in a reply that could not be read, as code points only (never the text): for the status read-out.
function oddCharacters_(text) {
  var found = {};
  String(text || '').slice(0, 400).replace(/[^\x09\x0A\x0D\x20-\x7E]/g, function (character) {
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
  var line = (ownWords_(text).split('\n').filter(Boolean)[0] || '').toLowerCase()
    .replace(/^((ok|okay|sure|great|thanks|thank you|no problem|no worries|hi|hello|dear [a-z]+)\b[\s,.!:-]*)+/, '');
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
    if (coach.ask_slots && !proposalOf_(coach, now)) {
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
    var refs = (coach.ask_slots ? ['slots'] : []).concat(waiting.map(function (request) { return request.request_id; }));
    var fresh = waiting.filter(function (request) { return request.coach_texted !== 'pending'; })[0];
    var current = refs.indexOf(coach.ask_ref) >= 0 ? coach.ask_ref : '';
    var next = current;
    if (!current) next = fresh ? fresh.request_id : refs[0] || '';
    else if (fresh && now - Number(coach.ask_at) >= PROPOSE_WAIT_MS) next = fresh.request_id;
    if (next && next !== current) {
      var request = waiting.filter(function (entry) { return entry.request_id === next; })[0];
      try {
        sendText_(coach, request ? requestQuestion_(request, request.coach_texted === 'pending') :
          'CTTC: Still waiting: reply YES to publish the coaching times you sent ' + momentLabel_(Number(coach.ask_made)) + ', or NO to cancel.');
        coach.ask_ref = next;
        coach.ask_at = String(now);
        changed = true;
        if (request && request.coach_texted !== 'pending') {
          request.coach_texted = 'pending';
          save_('Requests', request);
        }
      } catch (error) {
        console.error('Could not text a coach a question: ' + error);
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
  var coach = null;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var now = Date.now();
    coach = coachById_(coachId);
    if (!coach || (channel === 'text' && coach.ask_ref !== ref)) return;
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
      } else {
        reply = answer === 'yes' ? 'CTTC: That list expired, so nothing changed. Please submit your times again.' :
          'CTTC: OK, nothing was changed. Your coaching times stay as they were.';
        coach.ask_slots = '';
        coach.ask_made = '';
      }
    } else {
      var request = rows_('Requests').filter(function (entry) { return entry.request_id === ref; })[0];
      var status = request ? effectiveStatus_(request, now) : '';
      if (status === 'pending') {
        request.status = answer === 'yes' ? 'confirmed' : 'declined';
        request.updated_at = nowIso_();
        save_('Requests', request);
      } else {
        reply = 'CTTC: That lesson request is no longer waiting' + (status ? ' (it is ' + status + ')' : '') + ', so nothing changed.';
      }
    }
    if (coach.ask_ref === ref) {
      coach.ask_ref = '';
      coach.ask_at = '';
    }
    save_('Coaches', coach);
  } finally {
    lock.releaseLock();
  }
  if (reply) {
    try {
      if (channel === 'text') sendText_(coach, reply);
      else if (mailAvailable_()) sendMail_(cleanEmail_(coach.email), ref === 'slots' ? 'Your coaching times' : 'Lesson request', [reply.replace(/^CTTC: /, '')]);
    } catch (error) {
      console.error('Could not answer a coach: ' + error);
    }
  }
  sweep_();
}

// Run every minute by a trigger. Looks for a YES or NO, by text or by email, from each coach or student we asked a question.
// Does nothing, and never touches Gmail, when nobody is waiting.
function checkTexts() {
  var cache = CacheService.getScriptCache();
  if (cache.get('check-texts')) return;
  cache.put('check-texts', '1', 20);
  checkTexts_();
}

function checkTexts_() {
  step_('read coach texts', function () { checkCoachTexts_(); });
  step_('read student texts', function () { checkStudentAnswers_(); });
  step_('read STUDENT and STOP texts', checkStudentTexts_);
  step_('read email answers', checkMail_);
  step_('verify coaches', verifyCoaches_);
  reportStatus_();
}

// What the last minute check did, as counts only. reportStatus_ shows it in the NAME of a separate, empty spreadsheet
// ("CTTC Coaching status | 10-10 14:30 | mail q=1 ..."), so a maintainer can see whether the check runs and where it stops
// without opening any private data. It never holds a name, an email address or a phone number.
var STATUS_ = { failed: [], mail: 'not run' };

function reportStatus_() {
  try {
    var properties = PropertiesService.getScriptProperties();
    var id = properties.getProperty('COACHING_STATUS_ID');
    var book = id ? SpreadsheetApp.openById(id) : null;
    if (!book) {
      book = SpreadsheetApp.create('CTTC Coaching status');
      properties.setProperty('COACHING_STATUS_ID', book.getId());
    }
    var now = new Date(Math.floor(Date.now() / 600000) * 600000);
    var name = 'CTTC Coaching status | ' + Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm') + ' | mail ' + STATUS_.mail +
      ' | failed: ' + (STATUS_.failed.join('; ') || 'none');
    if (book.getName() !== name) book.rename(name.slice(0, 250));
  } catch (error) {
    console.error('Could not update the status read-out: ' + error);
  }
}

function checkCoachTexts_() {
  rows_('Coaches').filter(function (coach) { return coach.coach_id && active_(coach) && coach.ask_ref && Number(coach.ask_at) > 0; }).forEach(function (coach) {
    var asked = Number(coach.ask_at);
    var reply = voiceTextsFrom_(coach, 2).filter(function (text) { return text.at > asked && answerOf_(text.text); })
      .sort(function (a, b) { return a.at - b.at; })[0];
    if (reply) answer_(coach.coach_id, coach.ask_ref, answerOf_(reply.text), 'text');
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

// One failing step never stops the others (a Gmail hiccup reading texts must not stop email answers being read). The club is
// emailed about a failing step at most every 6 hours.
function step_(name, run) {
  try {
    run();
  } catch (error) {
    console.error('Could not ' + name + ': ' + error);
    STATUS_.failed.push(name + ': ' + String(error).replace(/\S+@\S+/g, '<address>').slice(0, 80));
    alertAdmin_('step:' + name, 'Coaching app: could not ' + name, ['The coaching app could not ' + name + '. It tries again every minute. The error was: ' + error]);
  }
}

// Emails the club about something it should know, at most once every 6 hours per key.
function alertAdmin_(key, subject, lines) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('alert:' + key) || !mailAvailable_()) return;
    cache.put('alert:' + key, '1', 21600);
    sendMail_(adminEmail_(), subject, lines);
  } catch (error) {
    console.error('Could not alert the club: ' + error);
  }
}

// A coach on the list whose number (or Voice contact name) has texted the club, COACH or anything else, can be texted back: that
// is a verified coach. Each is told once, by a reply on that thread. Gmail is searched at most every 10 minutes for this.
function verifyCoaches_() {
  var waiting = rows_('Coaches').filter(function (coach) { return coach.coach_id && active_(coach) && !coach.registered_at && phoneDigits_(coach.phone); });
  var cache = CacheService.getScriptCache();
  if (!waiting.length || cache.get('verify-coaches')) return;
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
      told.push({ message: found[coach.coach_id].message, label: coach.label, name: coachName_(coach) });
    });
  } finally {
    lock.releaseLock();
  }
  told.forEach(function (entry) {
    try {
      entry.message.reply('CTTC: Thanks, you are verified as ' + entry.name + '. To offer coaching times, open ' + PAGE_URL.replace('https://', '') +
        ', tap I am a coach and pick ' + entry.label + '. We will text you here to confirm your times and lesson requests.');
    } catch (error) {
      console.error('Could not tell a coach they are verified: ' + error);
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
    if (proposalOf_(coach, now)) {
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
  // Gmail reads count against a daily quota (about 20,000 on a free account) and this runs every minute, so only threads with a
  // message from someone else since the oldest open question are opened, never threads holding only our own sent questions.
  var since = Math.floor(Math.min.apply(null, questions.map(function (question) { return question.after; })) / 1000);
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
      if (at <= question.after || (question.before && at >= question.before) || autoReply_(message)) return;
      // Notices go out only for a recent reply to a question still open; a late YES is only looked for.
      var notify = !question.before && Date.now() - at < 5 * 3600000;
      if (!sameAddress_(address, question.email)) {
        if (us.indexOf(address) < 0 && notify) wrongSender_(message.getId(), address, question.email, String(message.getSubject() || ''));
        return;
      }
      var body = String(message.getPlainBody() || '');
      var answer = answerOf_(body);
      if (!answer) {
        seen.unreadable = (seen.unreadable || 0) + 1;
        seen.odd = oddCharacters_(ownWords_(body).split('\n')[0] || body);
        seen.length = (ownWords_(body).split('\n')[0] || '').length;
        if (notify) unreadableReply_(message.getId(), address, String(message.getSubject() || ''), ownWords_(body).split('\n')[0]);
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
// the sender is told to reply from the address the question went to, and the club is told, once per reply.
function wrongSender_(messageId, address, expected, subject) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('sender:' + messageId) || !mailAvailable_()) return;
    cache.put('sender:' + messageId, '1', 21600);
    try {
      sendMail_(address, 'Your reply did not count: please answer from the right address', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') +
        '", but it came from a different email address than the one the question was sent to, so nothing changed.',
        { callout: 'Please **reply from the email address the question was sent to**, saying **YES** or **NO**.', tone: 'action' }]);
    } catch (error) {
      console.error('Could not tell a sender to use the right address: ' + error);
    }
    alertAdmin_('sender:' + messageId, 'Coaching: a reply came from the wrong address', ['A reply to "' + subject + '" came from ' + address + ', but the question went to ' +
      expected + ', so it was not counted. The sender was asked to reply from ' + expected + '.']);
  } catch (error) {
    console.error('Could not send a reply notice: ' + error);
  }
}

// A reply to one of our questions that is not a clear YES or NO: tell the sender how to answer, and the club, once per reply.
function unreadableReply_(messageId, address, subject, line) {
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get('unread:' + messageId) || !mailAvailable_()) return;
    cache.put('unread:' + messageId, '1', 21600);
    try {
      sendMail_(address, 'We could not read your reply', ['We got your reply to "' + subject.replace(/^(re|fwd?):\s*/i, '') + '", but could not tell whether it was YES or NO.',
        { callout: 'Please **reply to that email again** saying just **YES** or **NO** (not both).', tone: 'action' }]);
    } catch (error) {
      console.error('Could not tell a sender their reply was unreadable: ' + error);
    }
    alertAdmin_('unread:' + messageId, 'Coaching: a reply could not be read', ['A reply to "' + subject + '" from ' + address + ' started with "' +
      String(line || '').slice(0, 80) + '", which is not YES or NO. They were asked to reply again.']);
  } catch (error) {
    console.error('Could not send a reply notice: ' + error);
  }
}

// A student's YES that arrived before the request expired, but was read late (or not at all, before the fixes of 2026-10-10),
// still counts while the lesson is far enough ahead and nobody else holds the time.
function lateVerify_(request, requests, availability, now) {
  var coach = coachById_(request.coach_id);
  if (!coach || effectiveStatus_(request, now) !== 'expired' || request.verified_at || request.cancelled_by) return false;
  if (now - (Date.parse(request.created_at) || 0) > 3 * 86400000 || expiryFor_(request.date, request.start) - now < 60 * 60000) return false;
  var taken = requests.some(function (other) {
    return other.request_id !== request.request_id && holds_(other, now) && other.coach_id === request.coach_id && other.date === request.date &&
      overlaps_(other.start, other.minutes, request.start, request.minutes);
  });
  var offered = availability.some(function (entry) {
    return entry.coach_id === request.coach_id && entry.confirmed === 'yes' && entry.date === request.date && overlaps_(entry.start, entry.minutes, request.start, request.minutes);
  });
  return !taken && offered;
}

// STUDENT turns on lesson texts for every student whose mobile number (or, for a saved Voice contact, name) matches; STOP turns
// them off. Gmail is only searched once some student has given a number.
function checkStudentTexts_() {
  // STUDENT and STOP only switch texts on or off, so every 5 minutes is soon enough and saves Gmail reads.
  var cache = CacheService.getScriptCache();
  if (cache.get('student-texts')) return;
  cache.put('student-texts', '1', 300);
  if (!rows_('Students').some(function (student) { return phoneDigits_(student.phone); })) return;
  var seen = {};
  var texts = [];
  GmailApp.search('in:anywhere from:txt.voice.google.com newer_than:2d (STUDENT OR STOP)', 0, 30).forEach(function (thread) {
    thread.getMessages().forEach(function (message) {
      if (seen[message.getId()]) return;
      seen[message.getId()] = true;
      var text = voiceText_(message);
      var word = text ? text.text.split('\n')[0].trim().replace(/[.!]+$/, '').toUpperCase() : '';
      if (word === 'STUDENT' || word === 'STOP') {
        text.word = word;
        texts.push(text);
      }
    });
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
      answers.push({ message: text.message, body: text.word === 'STUDENT' ?
        'CTTC: You will get texts about your coaching lessons, such as cancellations. Text STOP to stop.' :
        'CTTC: Coaching texts are off. Text STUDENT to turn them back on.' });
    });
  } finally {
    lock.releaseLock();
  }
  answers.forEach(function (answer) {
    try {
      answer.message.reply(answer.body);
    } catch (error) {
      console.error('Could not answer a student text: ' + error);
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

function sendMail_(to, subject, lines, cc) {
  var blocks = lines.filter(Boolean);
  var footer = 'This message is only about your coaching request. It does not add you to the results mailing list.';
  var body = blocks.map(blockText_).filter(Boolean).concat(footer).join('\n\n');
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#222;max-width:560px;">' + blocks.map(blockHtml_).join('') +
    '<p style="margin:20px 0 0;font-size:12px;color:#777;">' + esc_(footer) + '</p></div>';
  var message = { to: to, subject: subject, body: body, htmlBody: html, name: FROM_NAME };
  if (cc) message.cc = cc;
  MailApp.sendEmail(message);
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
