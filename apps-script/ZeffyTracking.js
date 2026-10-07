// Zeffy play passes are tracked from Zeffy's notification emails to the club Gmail.
var ZEFFY_QUERY_ = 'in:anywhere from:communication.mailer.zeffy.com (subject:"Pre-pay Playpass" OR subject:"has been cancelled")';
var ZEFFY_SYNCED_AT_ = 'CTTC_ZEFFY_SYNCED_AT';
var ZEFFY_SYNC_INTERVAL_MS_ = 10 * 60000;
// A renewal retried a few days late still continues the streak.
var ZEFFY_RENEWAL_GRACE_DAYS_ = 3;
var ZEFFY_EXPIRED_LIST_DAYS_ = 90;

function zeffyEmail_(value) {
  var match = String(value || '').match(/[^\s<>:"]+@[^\s<>:"]+\.[a-z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

// One row per person a message covers; renewals name only the buyer.
function parseZeffyEmail_(from, subject, body, paidOn) {
  if (!/@communication\.mailer\.zeffy\.com>?$/i.test(String(from || '').trim())) return [];
  subject = String(subject || '').trim();
  var text = String(body || '').replace(/\s+/g, ' ');
  var cancelled = subject.match(/^The recurring donation by (.+) has been cancelled$/i);
  if (cancelled) {
    return [{ paid_on: paidOn, kind: 'cancel', payer_name: normalizeName_(cancelled[1]), payer_email: zeffyEmail_((text.match(/contact them at (\S+)/i) || [])[1]), participant_name: '' }];
  }
  if (!/Pre-pay Playpass/i.test(subject)) return [];
  var buyer = text.match(/payment received! (.+?) <?((?:mailto:)?[^\s<>]+@[^\s<>]+)/i);
  if (!buyer) return [];
  var kind = /\(recurring payment\)\s*$/i.test(subject) ? 'renewal' : 'purchase';
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

function syncZeffyPayments_() {
  var properties = PropertiesService.getScriptProperties();
  var last = Number(properties.getProperty(ZEFFY_SYNCED_AT_)) || 0;
  var now = Date.now();
  if (now - last < ZEFFY_SYNC_INTERVAL_MS_) return;
  var lock = LockService.getScriptLock();
  var held = lock.hasLock();
  if (!held && !lock.tryLock(10000)) return;
  try {
    var known = {};
    rows_('ZeffyPayments').forEach(function (row) { known[String(row.message_id)] = true; });
    var query = ZEFFY_QUERY_ + (last ? ' newer_than:' + (Math.ceil((now - last) / 86400000) + 2) + 'd' : '');
    var added = [];
    for (var start = 0; ; start += 100) {
      var threads = GmailApp.search(query, start, 100);
      threads.forEach(function (thread) {
        thread.getMessages().forEach(function (message) {
          var id = message.getId();
          if (known[id]) return;
          known[id] = true;
          var paidOn = Utilities.formatDate(message.getDate(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
          parseZeffyEmail_(message.getFrom(), message.getSubject(), message.getPlainBody(), paidOn).forEach(function (row) {
            row.message_id = id;
            row.created_at = new Date();
            added.push(row);
          });
        });
      });
      if (threads.length < 100) break;
    }
    appendObjects_('ZeffyPayments', added);
    properties.setProperty(ZEFFY_SYNCED_AT_, String(now));
  } finally {
    if (!held) lock.releaseLock();
  }
}

function zeffyPaymentRows_() {
  return rows_('ZeffyPayments').map(function (row) {
    return {
      paid_on: displayDate_(row.paid_on).slice(0, 10),
      kind: String(row.kind || ''),
      payer_name: normalizeName_(row.payer_name),
      payer_email: String(row.payer_email || '').toLowerCase(),
      participant_name: normalizeName_(row.participant_name)
    };
  });
}

// Zeffy Name and Aliases entries resolve to one directory player, case-insensitively.
function zeffyNameResolver_(playerRows, aliases) {
  var byName = {};
  var names = {};
  playerRows.forEach(function (player) {
    var id = String(player.player_id);
    names[id] = String(player.display_name);
    var key = linkedNameKey_(player.display_name);
    byName[key] = byName[key] === undefined ? id : null;
  });
  Object.keys(aliases).forEach(function (alias) {
    var key = linkedNameKey_(alias);
    if (byName[key] === undefined && names[aliases[alias]]) byName[key] = aliases[alias];
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

function zeffyPassesForDate_(payments, sessionDate, resolve) {
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
