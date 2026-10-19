// Daily cash flow (issue #50): what each club day should have brought in, worked out from the desk's own records
// (round robin rosters, Open Play, SessionPayments, Zeffy play passes and member status). The page is the Cash
// template, served by doGet for ?view=cash from the owner-only desk deployment, so only the club account can open it.
// Everything here only reads the Sheet, except the cash count the money collector enters at close, which goes in the
// private CashCounts tab and the AuditLog.
//
// Amounts come from status, never from an amount field: Junior $5, Member $10, Visitor $15, and $0 for a Zeffy monthly
// play pass holder (the subscription replaces the nightly fee). The status used is the player's status today: the
// MemberStatus tab keeps no history, so a visitor who joined later is counted as a member on earlier nights too.
var CASH_COUNT_HEADERS = ['session_date', 'counted', 'note', 'updated_at'];
var CASH_FEES = { junior: 5, member: 10, visitor: 15 };
// Methods that bring money in on the night. A Zeffy pass is paid monthly through Zeffy, so it counts as covered, not collected.
var CASH_METHODS = ['cash', 'venmo', 'zelle', 'credit'];
var CASH_KINDS = ['rr', 'open', 'other'];
var CASH_RANGE_MAX_DAYS = 93;
var CASH_NOTE_MAX = 200;
var CASH_COUNT_MAX = 100000;

function ensureCashCountTable_() {
  TABLES.CashCounts = CASH_COUNT_HEADERS;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName('CashCounts');
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet('CashCounts');
  ensureHeader_(sheet, CASH_COUNT_HEADERS);
  if (created) formatTable_(sheet, CASH_COUNT_HEADERS.length);
}

function cashPage_(event) {
  var template = HtmlService.createTemplateFromFile('Cash');
  template.deskMode = deskMode_();
  var deskUrl = '';
  try { deskUrl = String(ScriptApp.getService().getUrl() || ''); } catch (error) { deskUrl = ''; }
  template.deskUrl = deskUrl;
  return template.evaluate()
  .setTitle(template.deskMode === 'dev' ? 'DEV - CTTC Daily cash flow' : 'CTTC Daily cash flow')
  .addMetaTag('viewport', 'width=device-width, initial-scale=1')
  .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// A tab the desk has not made yet simply has no rows; reading the cash flow never adds tabs.
function cashRows_(sheetName) {
  return SpreadsheetApp.getActive().getSheetByName(sheetName) ? rows_(sheetName) : [];
}

// validateSessionDate_ checks the shape; this also turns away dates that are not on the calendar (2026-02-30).
function cashDate_(value, label) {
  validateSessionDate_(value);
  var time = Date.parse(value + 'T00:00:00Z');
  if (isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error((label || 'Date') + ' is not a real date: ' + value);
  return time;
}

function cashWeekday_(date) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(Date.parse(date + 'T00:00:00Z')).getUTCDay()];
}

function cashMoney_(value) {
  return Math.round(value * 100) / 100;
}

// Zeffy coverage for any date, from the Zeffy tabs read once. It mirrors getZeffyPlayers(playerRows, date, true) and
// getZeffyCoveredPlayerIds (which read those tabs on every call, once per day here) and never reads Gmail; the
// recorded emails are kept up to date by the desk. check-cash-flow.cjs holds the two to the same answer.
function cashZeffyCoverage_(playerRows, players, linkRows) {
  var names = {};
  playerRows.forEach(function (player) { names[String(player.player_id)] = String(player.display_name); });
  var payments = SpreadsheetApp.getActive().getSheetByName('ZeffyPayments') ? zeffyPaymentRows_() : [];
  var resolve = zeffyNameResolver_(playerRows, playerAliases_());
  var manual = [];
  var seen = {};
  cashRows_('ZeffyPasses').filter(function (pass) { return asBoolean_(pass.active); }).forEach(function (pass) {
    var playerId = String(pass.player_id);
    if (seen[playerId]) throw new Error('Duplicate Zeffy pass for ' + playerId);
    seen[playerId] = true;
    if (!names[playerId]) throw new Error('Zeffy pass for unknown player ' + playerId);
    manual.push(playerId);
  });
  var links = confirmedNameLinks_(players, linkRows).resolved;
  return function (sessionDate) {
    var covered = {};
    zeffyPassesForDate_(payments, sessionDate, resolve).forEach(function (pass) { if (pass.active && pass.playerId) covered[pass.playerId] = true; });
    manual.forEach(function (playerId) { covered[playerId] = true; });
    links.forEach(function (link) {
      if (covered[link.left.playerId] || covered[link.right.playerId]) {
        covered[link.left.playerId] = true;
        covered[link.right.playerId] = true;
      }
    });
    return covered;
  };
}

function cashTotals_() {
  var totals = { players: 0, expected: 0, outstanding: 0, due: 0, zeffy: { count: 0 }, unpaid: { count: 0, amount: 0 }, methods: {}, kinds: {} };
  CASH_METHODS.forEach(function (method) { totals.methods[method] = { count: 0, amount: 0 }; });
  CASH_KINDS.forEach(function (kind) { totals.kinds[kind] = { players: 0, expected: 0, outstanding: 0 }; });
  return totals;
}

function addCashPlayer_(totals, player) {
  totals.players += 1;
  totals.kinds[player.kind].players += 1;
  if (player.method === 'zeffy') totals.zeffy.count += 1;
  else if (!player.method) {
    totals.unpaid.count += 1;
    totals.unpaid.amount += player.owed;
    totals.outstanding += player.owed;
    totals.kinds[player.kind].outstanding += player.owed;
  } else {
    totals.methods[player.method].count += 1;
    totals.methods[player.method].amount += player.collected;
    totals.expected += player.collected;
    totals.kinds[player.kind].expected += player.collected;
  }
  totals.due = totals.expected + totals.outstanding;
}

function addCashTotals_(totals, day) {
  totals.players += day.players;
  totals.expected += day.expected;
  totals.outstanding += day.outstanding;
  totals.due += day.due;
  totals.zeffy.count += day.zeffy.count;
  totals.unpaid.count += day.unpaid.count;
  totals.unpaid.amount += day.unpaid.amount;
  CASH_METHODS.forEach(function (method) {
    totals.methods[method].count += day.methods[method].count;
    totals.methods[method].amount += day.methods[method].amount;
  });
  CASH_KINDS.forEach(function (kind) {
    ['players', 'expected', 'outstanding'].forEach(function (key) { totals.kinds[kind][key] += day.kinds[kind][key]; });
  });
}

function cashCountView_(expected, row) {
  var counted = row && row.counted !== '' && row.counted !== null && row.counted !== undefined ? cashMoney_(Number(row.counted)) : null;
  if (counted !== null && !isFinite(counted)) counted = null;
  return {
    expected: expected,
    counted: counted,
    difference: counted === null ? null : cashMoney_(counted - expected),
    note: row ? String(row.note || '') : '',
    updatedAt: row && row.updated_at instanceof Date ? row.updated_at.toISOString() : row ? String(row.updated_at || '') : ''
  };
}

// Days from fromDate to toDate (both included, at most 93 days) that have players, payments or a cash count, newest
// first, and the totals for the range. Each tab is read once, whatever the length of the range.
function getCashFlow(fromDate, toDate) {
  var fromTime = cashDate_(fromDate, 'Start date');
  var toTime = cashDate_(toDate, 'End date');
  if (fromTime > toTime) throw new Error('The start date must be on or before the end date.');
  if ((toTime - fromTime) / 86400000 + 1 > CASH_RANGE_MAX_DAYS) throw new Error('Choose at most ' + CASH_RANGE_MAX_DAYS + ' days at a time.');
  var inRange = function (date) { return date >= fromDate && date <= toDate; };
  var dateOfSession = function (sessionId) { var match = /^session-(\d{4}-\d{2}-\d{2})$/.exec(String(sessionId)); return match ? match[1] : ''; };

  var playerRows = rows_('Players');
  var players = listPlayers(playerRows);
  var names = {};
  playerRows.forEach(function (player) { names[String(player.player_id)] = String(player.display_name); });
  // Archived players are not in the status list; they are counted as visitors.
  var statuses = getMemberStatuses().statuses;
  var coveredOn = cashZeffyCoverage_(playerRows, players, nameLinkRows_());

  var days = {};
  var dayFor = function (date) { return days[date] || (days[date] = { rr: {}, open: {}, paid: {}, count: null }); };
  rows_('SessionPlayers').forEach(function (row) {
    var date = dateOfSession(row.session_id);
    if (date && inRange(date)) dayFor(date).rr[String(row.player_id)] = true;
  });
  cashRows_('OpenPlay').forEach(function (row) {
    var date = displayDate_(row.session_date).slice(0, 10);
    if (inRange(date)) dayFor(date).open[String(row.player_id)] = true;
  });
  cashRows_('SessionPayments').forEach(function (row) {
    var date = dateOfSession(row.session_id);
    if (!date || !inRange(date)) return;
    var playerId = String(row.player_id);
    var method = String(row.method || '');
    if (method && PAYMENT_METHODS.indexOf(method) < 0) throw new Error('Unknown payment method on ' + date + ': ' + method);
    var day = dayFor(date);
    if (day.paid[playerId] !== undefined) throw new Error('Duplicate payment on ' + date + ' for ' + playerId);
    day.paid[playerId] = method;
  });
  cashRows_('CashCounts').forEach(function (row) {
    var date = displayDate_(row.session_date).slice(0, 10);
    if (!inRange(date)) return;
    var day = dayFor(date);
    if (day.count) throw new Error('Duplicate cash count for ' + date);
    day.count = row;
  });

  var totals = cashTotals_();
  totals.cash = { expected: 0, counted: 0, difference: 0, countedDays: 0 };
  var result = Object.keys(days).sort().reverse().map(function (date) {
    var source = days[date];
    var covered = coveredOn(date);
    var list = [];
    var add = function (playerId, kind) {
      var status = statuses[playerId] || 'visitor';
      var method = covered[playerId] ? 'zeffy' : source.paid[playerId] || '';
      var owed = method === 'zeffy' ? 0 : CASH_FEES[status] || CASH_FEES.visitor;
      list.push({
        name: names[playerId] || 'Unknown player',
        status: status,
        kind: kind,
        method: method,
        owed: owed,
        collected: CASH_METHODS.indexOf(method) >= 0 ? owed : 0
      });
    };
    Object.keys(source.rr).forEach(function (playerId) { add(playerId, 'rr'); });
    Object.keys(source.open).forEach(function (playerId) { if (!source.rr[playerId]) add(playerId, 'open'); });
    // A payment for someone on neither list is kept, so no money goes missing from the night.
    Object.keys(source.paid).forEach(function (playerId) {
      if (source.paid[playerId] && !source.rr[playerId] && !source.open[playerId]) add(playerId, 'other');
    });
    var order = { rr: 0, open: 1, other: 2 };
    list.sort(function (left, right) { return order[left.kind] - order[right.kind] || left.name.localeCompare(right.name); });
    var day = cashTotals_();
    list.forEach(function (player) { addCashPlayer_(day, player); });
    day.date = date;
    day.weekday = cashWeekday_(date);
    day.playerList = list;
    day.cash = cashCountView_(day.methods.cash.amount, source.count);
    addCashTotals_(totals, day);
    totals.cash.expected += day.cash.expected;
    if (day.cash.counted !== null) {
      totals.cash.counted += day.cash.counted;
      totals.cash.difference += day.cash.difference;
      totals.cash.countedDays += 1;
    }
    return day;
  }).filter(function (day) { return day.players || day.cash.counted !== null || day.cash.note; });
  totals.cash.counted = cashMoney_(totals.cash.counted);
  totals.cash.difference = cashMoney_(totals.cash.difference);
  totals.days = result.length;
  return { from: fromDate, to: toDate, fees: CASH_FEES, days: result, totals: totals };
}

// Note text is kept plain: no control characters, and no leading = + - @ so the Sheet never reads it as a formula.
function cashNote_(note) {
  return String(note === null || note === undefined ? '' : note)
  .replace(/[\u0000-\u001f\u007f]+/g, ' ')
  .replace(/\s+/g, ' ')
  .replace(/^[\s=+\-@]+/, '')
  .trim()
  .slice(0, CASH_NOTE_MAX);
}

// Blank clears the count; otherwise a non-negative amount with at most two decimals ($ and commas allowed).
function cashCounted_(counted) {
  if (counted === null || counted === undefined) return null;
  var text = String(counted).trim().replace(/^\$/, '').replace(/,/g, '');
  if (text === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > CASH_COUNT_MAX) throw new Error('Counted cash must be an amount like 45 or 45.50.');
  return cashMoney_(Number(text));
}

// One row per date in CashCounts. A count and a note can be saved on their own; clearing both removes the row.
function saveCashCount(sessionDate, counted, note) {
  cashDate_(sessionDate, 'Session date');
  var amount = cashCounted_(counted);
  var text = cashNote_(note);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureCashCountTable_();
    var matches = rows_('CashCounts').filter(function (row) { return displayDate_(row.session_date).slice(0, 10) === sessionDate; });
    if (matches.length > 1) throw new Error('Duplicate cash count for ' + sessionDate);
    var now = new Date();
    if (amount === null && !text) {
      if (matches.length) SpreadsheetApp.getActive().getSheetByName('CashCounts').deleteRow(matches[0].__row);
    } else if (matches.length) {
      updateRow_('CashCounts', matches[0].__row, { counted: amount === null ? '' : amount, note: text, updated_at: now });
    } else {
      appendObjects_('CashCounts', [{ session_date: sessionDate, counted: amount === null ? '' : amount, note: text, updated_at: now }]);
    }
    // The amount is written as text: numbers are copied to the CTTC Desk Logs tab, whose GitHub run logs are public.
    appendAudit_('cash_count_updated', 'session', 'session-' + sessionDate, { counted: amount === null ? 'cleared' : amount.toFixed(2), hasNote: !!text });
    return { date: sessionDate, counted: amount, note: text, updatedAt: amount === null && !text ? '' : now.toISOString() };
  } finally {
    lock.releaseLock();
  }
}
