// Zeffy play passes are tracked from Zeffy's notification emails to the club Gmail. Every Zeffy email is looked at, so a
// renamed form or a reworded subject still counts when the email is about the play pass.
var ZEFFY_QUERY_ = 'in:anywhere from:communication.mailer.zeffy.com';
var ZEFFY_PASS_ = /play\s*-?\s*pass/i;
// Raised whenever the reader learns a new email format: the next sync reads the whole mailbox again, so emails it could
// not read before are picked up. Emails already recorded are skipped.
var ZEFFY_READER_ = 'CTTC_ZEFFY_READER';
var ZEFFY_READER_VERSION_ = '2';
// The mail reader's trigger reads every minute; without it, the desk reads Zeffy mail itself at most this often.
var ZEFFY_SYNC_INTERVAL_MS_ = 10 * 60000;
// A renewal retried a few days late still continues the streak.
var ZEFFY_RENEWAL_GRACE_DAYS_ = 3;
var ZEFFY_EXPIRED_LIST_DAYS_ = 90;

function zeffyEmail_(value) {
  var match = String(value || '').match(/[^\s<>:"]+@[^\s<>:"]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

// One row per person a message covers; renewals name only the buyer. A play pass email whose buyer cannot be found is one
// 'unreadable' row with no names, so the sidebar can say so instead of leaving that person silently off the list.
function parseZeffyEmail_(from, subject, body, paidOn) {
  if (!/@communication\.mailer\.zeffy\.com>?$/i.test(String(from || '').trim())) return [];
  subject = String(subject || '').trim();
  var text = String(body || '').replace(/\s+/g, ' ');
  var cancelled = subject.match(/^The recurring donation by (.+) has been cancelled$/i);
  if (cancelled) {
    return [{ paid_on: paidOn, kind: 'cancel', payer_name: normalizeName_(cancelled[1]), payer_email: zeffyEmail_((text.match(/contact them at (\S+)/i) || [])[1]), participant_name: '' }];
  }
  if (!ZEFFY_PASS_.test(subject) && !ZEFFY_PASS_.test(text)) return [];
  var buyer = text.match(/payment received[!.:]?\s+(.+?)\s+<?((?:mailto:)?[^\s<>]+@[^\s<>]+)/i);
  if (!buyer) return [{ paid_on: paidOn, kind: 'unreadable', payer_name: '', payer_email: '', participant_name: '' }];
  var kind = /recurring payment/i.test(subject) ? 'renewal' : 'purchase';
  var payer = { paid_on: paidOn, kind: kind, payer_name: normalizeName_(buyer[1]), payer_email: zeffyEmail_(buyer[2]) };
  var participants = [];
  var pattern = /Name: (.+?) Email:/g;
  var match;
  while ((match = pattern.exec(text))) participants.push(normalizeName_(match[1]));
  if (!participants.length) participants = [kind === 'purchase' ? payer.payer_name : ''];
  return participants.map(function (name) {
    return { paid_on: payer.paid_on, kind: payer.kind, payer_name: payer.payer_name, payer_email: payer.payer_email, participant_name: name };
  });
}

// New Zeffy emails come in with the desk's one mail reader (MailReader.js). Only a new reader version reads the whole
// mailbox again, once. Gmail can take many seconds to answer, and score saves wait on the script lock, so the mailbox is
// read without the lock. The lock is taken only to add the new rows, and a message another run already recorded is
// skipped then. Never call this while holding the lock: it would keep the desk waiting on Gmail.
function syncZeffyPayments_() {
  var properties = PropertiesService.getScriptProperties();
  if (properties.getProperty(ZEFFY_READER_) === ZEFFY_READER_VERSION_) return readMailIfStale_(ZEFFY_SYNC_INTERVAL_MS_);
  // A caller already holding the lock uses the emails recorded so far; the next caller without it reads Gmail.
  var lock = LockService.getScriptLock();
  if (lock.hasLock()) return;
  // An email recorded as unreadable is read again (by a newer reader); it is recorded again only once it can be read.
  var known = {};
  var unreadable = {};
  rows_('ZeffyPayments').forEach(function (row) { (row.kind === 'unreadable' ? unreadable : known)[String(row.message_id)] = true; });
  var query = ZEFFY_QUERY_;
  var found = [];
  for (var start = 0; ; start += 100) {
    var threads = GmailApp.search(query, start, 100);
    threads.forEach(function (thread) {
      thread.getMessages().forEach(function (message) {
        var id = message.getId();
        if (known[id]) return;
        known[id] = true;
        var paidOn = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
        var rows = parseZeffyEmail_(message.getFrom(), message.getSubject(), message.getPlainBody(), paidOn);
        if (unreadable[id] && rows.length && rows[0].kind === 'unreadable') return;
        rows.forEach(function (row) {
          row.message_id = id;
          row.created_at = new Date();
          found.push(row);
        });
      });
    });
    if (threads.length < 100) break;
  }
  if (!lock.tryLock(10000)) return;
  try {
    var recorded = {};
    rows_('ZeffyPayments').forEach(function (row) { if (row.kind !== 'unreadable') recorded[String(row.message_id)] = true; });
    appendObjects_('ZeffyPayments', found.filter(function (row) { return !recorded[String(row.message_id)]; }));
    properties.setProperty(ZEFFY_READER_, ZEFFY_READER_VERSION_);
  } finally {
    lock.releaseLock();
  }
}

function zeffyPaymentRows_() {
  return rows_('ZeffyPayments').map(function (row) {
    return {
      message_id: String(row.message_id || ''),
      paid_on: displayDate_(row.paid_on).slice(0, 10),
      kind: String(row.kind || ''),
      payer_name: normalizeName_(row.payer_name),
      payer_email: String(row.payer_email || '').toLowerCase(),
      participant_name: normalizeName_(row.participant_name)
    };
  });
}

// Zeffy Name and Aliases entries resolve to one directory player, case-insensitively.
// An alias like "Daniel (Daeseop) Yi" also covers "Daeseop Yi" and "Daniel Yi", unless another player or alias has that name.
function zeffyNameResolver_(playerRows, aliases) {
  var byName = {};
  var names = {};
  playerRows.forEach(function (player) {
    var id = String(player.player_id);
    names[id] = String(player.display_name);
    var key = linkedNameKey_(player.display_name);
    byName[key] = byName[key] === undefined ? id : null;
  });
  var claim = function (name, id) {
    var key = linkedNameKey_(name);
    if (byName[key] === undefined && names[id]) byName[key] = id;
  };
  Object.keys(aliases).forEach(function (alias) { claim(alias, aliases[alias]); });
  Object.keys(aliases).forEach(function (alias) {
    var parts = alias.match(/^(.+?)\s*\((.+?)\)\s*(.+)$/);
    if (parts) [parts[2] + ' ' + parts[3], parts[1] + ' ' + parts[3]].forEach(function (name) { claim(name, aliases[alias]); });
  });
  return function (name) {
    var id = byName[linkedNameKey_(name)];
    return id ? { playerId: id, name: names[id] } : null;
  };
}

// Zeffy charges on the start date's day each month, or the month's last day when shorter.
function zeffyMonthsLater_(anchor, months) {
  var parts = anchor.split('-').map(Number);
  var total = parts[0] * 12 + parts[1] - 1 + months;
  var year = Math.floor(total / 12);
  var month = total % 12;
  var lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(parts[2], lastDay))).toISOString().slice(0, 10);
}

function zeffyDaysBetween_(from, to) {
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
}

// Play pass emails from the past 90 days, up to sessionDate, that the desk still cannot read.
function zeffyUnreadableCount_(payments, sessionDate) {
  var readable = {};
  payments.forEach(function (payment) { if (payment.kind !== 'unreadable') readable[payment.message_id] = true; });
  var ids = {};
  payments.forEach(function (payment) {
    if (payment.kind !== 'unreadable' || readable[payment.message_id] || !payment.paid_on || payment.paid_on > sessionDate) return;
    if (zeffyDaysBetween_(payment.paid_on, sessionDate) <= ZEFFY_EXPIRED_LIST_DAYS_) ids[payment.message_id] = true;
  });
  return Object.keys(ids).length;
}

function zeffyPassesForDate_(payments, sessionDate, resolve) {
  payments = payments.filter(function (payment) { return payment.kind !== 'unreadable'; });
  var participantsByEmail = {};
  payments.forEach(function (payment) {
    if (payment.kind !== 'purchase' || !payment.payer_email || !payment.participant_name) return;
    var list = participantsByEmail[payment.payer_email] || (participantsByEmail[payment.payer_email] = []);
    if (list.indexOf(payment.participant_name) < 0) list.push(payment.participant_name);
  });
  var people = {};
  payments.forEach(function (payment) {
    if (!payment.paid_on || payment.paid_on > sessionDate) return;
    var covered = payment.participant_name ? [payment.participant_name] : participantsByEmail[payment.payer_email] || [payment.payer_name];
    covered.forEach(function (name) {
      var player = resolve(name);
      var key = player ? player.playerId : 'name:' + linkedNameKey_(name);
      var person = people[key] || (people[key] = { playerId: player ? player.playerId : '', name: player ? player.name : name, dates: {}, cancelledOn: '' });
      if (payment.kind === 'cancel') person.cancelledOn = payment.paid_on > person.cancelledOn ? payment.paid_on : person.cancelledOn;
      else person.dates[payment.paid_on] = true;
    });
  });
  return Object.keys(people).map(function (key) {
    var person = people[key];
    var anchor = '';
    var streak = 0;
    Object.keys(person.dates).sort().forEach(function (date) {
      if (anchor && zeffyDaysBetween_(zeffyMonthsLater_(anchor, streak), date) <= ZEFFY_RENEWAL_GRACE_DAYS_) streak += 1;
      else { anchor = date; streak = 1; }
    });
    var renewsOn = anchor ? zeffyMonthsLater_(anchor, streak) : '';
    var daysLeft = renewsOn ? zeffyDaysBetween_(sessionDate, renewsOn) : -1;
    var active = daysLeft >= 0;
    var endedOn = renewsOn || person.cancelledOn;
    if (!active && zeffyDaysBetween_(endedOn, sessionDate) > ZEFFY_EXPIRED_LIST_DAYS_) return null;
    return { playerId: person.playerId, name: person.name, active: active, daysLeft: active ? daysLeft : null, streak: streak, renewsOn: renewsOn };
  }).filter(Boolean);
}
