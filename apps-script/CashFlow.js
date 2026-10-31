// Daily cash flow (issue #50): what each club day should have brought in, worked out from the desk's own records
// (round robin rosters, Open Play, SessionPayments, Zeffy play passes and member status). The page is the Cash
// template, served by doGet for ?view=cash from the owner-only desk deployment, so only the club account can open it.
// Everything here only reads the Sheet, except the cash count the money collector enters at close (the private
// CashCounts tab) and the club's day, week and month targets (the private CashTargets tab), both also in the AuditLog.
//
// Amounts come from status, never from an amount field: Junior $5, Member $10, Visitor $15, $10 on a first visit, and $0
// for a Zeffy monthly play pass holder (the subscription replaces the nightly fee). Fees, first visits and each night's
// status come from NightFees.js: a visitor who joined later is still a visitor on the nights before.
var CASH_COUNT_HEADERS = ['session_date', 'counted', 'note', 'updated_at'];
// Methods that bring money in on the night. A Zeffy pass is paid monthly through Zeffy, so it counts as covered, not collected.
var CASH_METHODS = ['cash', 'venmo', 'zelle', 'credit'];
var CASH_KINDS = ['rr', 'open', 'other'];
var CASH_RANGE_MAX_DAYS = 400;
var CASH_TARGET_HEADERS = ['period', 'amount', 'updated_at'];
var CASH_PERIODS = ['day', 'week', 'month'];
var CASH_TARGET_MAX = 1000000;
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

// Days from fromDate to toDate (both included, at most 400 days) that have players, payments or a cash count, newest
// first; the totals for the range; the club targets; the range grouped by day, week and month against those targets;
// and the insights panel. Each tab is read once, whatever the length of the range: the previous window the trend
// compares against comes from the same rows.
function getCashFlow(fromDate, toDate) {
  var fromTime = cashDate_(fromDate, 'Start date');
  var toTime = cashDate_(toDate, 'End date');
  if (fromTime > toTime) throw new Error('The start date must be on or before the end date.');
  var length = Math.round((toTime - fromTime) / 86400000) + 1;
  if (length > CASH_RANGE_MAX_DAYS) throw new Error('Choose at most ' + CASH_RANGE_MAX_DAYS + ' days at a time.');
  var previousFrom = cashIso_(fromTime - length * 86400000);
  var previousTo = cashIso_(fromTime - 86400000);
  var inRange = function (date) { return date >= fromDate && date <= toDate; };
  var inWindow = function (date) { return date >= previousFrom && date <= toDate; };
  var dateOfSession = function (sessionId) { var match = /^session-(\d{4}-\d{2}-\d{2})$/.exec(String(sessionId)); return match ? match[1] : ''; };

  var playerRows = rows_('Players');
  var players = listPlayers(playerRows);
  var names = {};
  playerRows.forEach(function (player) { names[String(player.player_id)] = String(player.display_name); });
  // Archived players are not in the status list; they are counted as visitors.
  var linkRows = nameLinkRows_();
  var statusesOn = memberStatusFinder_(getMemberStatuses().statuses, players, linkRows);
  var coveredOn = cashZeffyCoverage_(playerRows, players, linkRows);
  var sessionRows = rows_('SessionPlayers');
  var openRows = cashRows_('OpenPlay');
  var firstVisitsOn = firstVisitFinder_(playerRows, sessionRows, openRows);

  var days = {};
  // The first night each player appears anywhere in the desk's records, for "new faces".
  var firstSeen = {};
  var seen = function (playerId, date) { if (date && (!firstSeen[playerId] || date < firstSeen[playerId])) firstSeen[playerId] = date; };
  var dayFor = function (date) { return days[date] || (days[date] = { rr: {}, open: {}, paid: {}, count: null }); };
  sessionRows.forEach(function (row) {
    // The day's round robin and Equalizer rosters both count (SessionIds.js).
    var date = sessionDateOf_(row.session_id);
    seen(String(row.player_id), date);
    if (date && inWindow(date)) dayFor(date).rr[String(row.player_id)] = true;
  });
  openRows.forEach(function (row) {
    var date = displayDate_(row.session_date).slice(0, 10);
    seen(String(row.player_id), date);
    if (inWindow(date)) dayFor(date).open[String(row.player_id)] = true;
  });
  cashRows_('SessionPayments').forEach(function (row) {
    var date = dateOfSession(row.session_id);
    if (!date || !inWindow(date)) return;
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
  var targets = cashTargetsFrom_(cashRows_('CashTargets'));

  var built = Object.keys(days).sort().reverse().map(function (date) {
    var source = days[date];
    var covered = coveredOn(date);
    var statuses = statusesOn(date);
    var firstVisits = firstVisitsOn(date);
    var list = [];
    var add = function (playerId, kind) {
      var status = statuses[playerId] || 'visitor';
      var method = covered[playerId] ? 'zeffy' : source.paid[playerId] || '';
      var owed = method === 'zeffy' ? 0 : nightFee_(status, firstVisits[playerId]);
      list.push({
        playerId: playerId,
        name: names[playerId] || 'Unknown player',
        status: status,
        firstVisit: !!firstVisits[playerId] && status !== 'junior',
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
    return day;
  });
  var current = built.filter(function (day) { return inRange(day.date) && (day.players || day.cash.counted !== null || day.cash.note); });
  var previous = built.filter(function (day) { return !inRange(day.date); });

  var totals = cashTotals_();
  totals.cash = { expected: 0, counted: 0, difference: 0, countedDays: 0 };
  current.forEach(function (day) {
    addCashTotals_(totals, day);
    totals.cash.expected += day.cash.expected;
    if (day.cash.counted !== null) {
      totals.cash.counted += day.cash.counted;
      totals.cash.difference += day.cash.difference;
      totals.cash.countedDays += 1;
    }
  });
  totals.cash.counted = cashMoney_(totals.cash.counted);
  totals.cash.difference = cashMoney_(totals.cash.difference);
  totals.days = current.length;

  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var groups = {};
  CASH_PERIODS.forEach(function (grouping) { groups[grouping] = cashGroup_(grouping, current, fromDate, toDate, targets[grouping], today); });
  var insights = cashInsights_(current, previous, firstSeen, names, fromDate, toDate, previousFrom, previousTo);
  // Player ids stay on the server; the page shows names.
  current.forEach(function (day) {
    day.playerList = day.playerList.map(function (player) {
      return { name: player.name, status: player.status, firstVisit: player.firstVisit, kind: player.kind, method: player.method, owed: player.owed, collected: player.collected };
    });
  });
  return { from: fromDate, to: toDate, today: today, fees: NIGHT_FEES, targets: targets, days: current, totals: totals, groups: groups, insights: insights };
}

function cashIso_(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function cashShortDate_(date) {
  var parts = date.split('-').map(Number);
  return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parts[1] - 1] + ' ' + parts[2];
}

// The Monday that starts date's week (weeks run Monday to Sunday).
function cashMonday_(date) {
  var time = Date.parse(date + 'T00:00:00Z');
  return cashIso_(time - ((new Date(time).getUTCDay() + 6) % 7) * 86400000);
}

function cashPeriodKey_(grouping, date) {
  return grouping === 'week' ? cashMonday_(date) : grouping === 'month' ? date.slice(0, 7) : date;
}

// The range as periods (one per club day with players, or every week or month the range touches) with what each
// collected and how it stands against the target. Only finished periods wholly inside the range count towards the
// target: a week or month cut by the range edge is "partial", one that includes today is "in progress", and a week
// or month with no club nights (the club was closed) is "empty". Those are shown but never counted as met or missed.
function cashGroup_(grouping, days, fromDate, toDate, target, today) {
  var buckets = {};
  days.forEach(function (day) {
    if (!day.players) return;
    var key = cashPeriodKey_(grouping, day.date);
    var bucket = buckets[key] || (buckets[key] = { collected: 0, outstanding: 0, players: 0, nights: 0 });
    bucket.collected += day.expected;
    bucket.outstanding += day.outstanding;
    bucket.players += day.players;
    bucket.nights += 1;
  });
  var spans = [];
  if (grouping === 'day') {
    Object.keys(buckets).sort().forEach(function (date) { spans.push({ key: date, start: date, end: date }); });
  } else {
    var start = grouping === 'week' ? cashMonday_(fromDate) : fromDate.slice(0, 7) + '-01';
    while (start <= toDate) {
      var time = Date.parse(start + 'T00:00:00Z');
      var next = grouping === 'week' ? cashIso_(time + 7 * 86400000) : cashIso_(Date.UTC(new Date(time).getUTCFullYear(), new Date(time).getUTCMonth() + 1, 1));
      spans.push({ key: cashPeriodKey_(grouping, start), start: start, end: cashIso_(Date.parse(next + 'T00:00:00Z') - 86400000) });
      start = next;
    }
  }
  var periods = spans.map(function (span) {
    var bucket = buckets[span.key] || { collected: 0, outstanding: 0, players: 0, nights: 0 };
    var partial = span.start < fromDate || span.end > toDate;
    var inProgress = span.end >= today;
    var state = !bucket.nights ? 'empty' : inProgress ? 'in_progress' : partial ? 'partial' : target === null ? 'none' : bucket.collected >= target ? 'met' : 'missed';
    var year = span.start.slice(0, 4);
    return {
      key: span.key,
      start: span.start,
      end: span.end,
      label: grouping === 'day' ? cashWeekday_(span.start) + ' ' + cashShortDate_(span.start) + ', ' + year
        : grouping === 'week' ? 'Week of ' + cashShortDate_(span.start) + ', ' + year
        : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(span.start.slice(5, 7)) - 1] + ' ' + year,
      collected: cashMoney_(bucket.collected),
      outstanding: cashMoney_(bucket.outstanding),
      players: bucket.players,
      nights: bucket.nights,
      partial: partial,
      inProgress: inProgress,
      counted: !!bucket.nights && !partial && !inProgress,
      state: state,
      difference: target === null ? null : cashMoney_(bucket.collected - target)
    };
  });
  var counted = periods.filter(function (period) { return period.counted; });
  var collected = cashMoney_(counted.reduce(function (sum, period) { return sum + period.collected; }, 0));
  var met = target === null ? null : counted.filter(function (period) { return period.state === 'met'; }).length;
  var ranked = counted.slice().sort(function (left, right) { return right.collected - left.collected || (left.start < right.start ? -1 : 1); });
  var pick = function (period) { return period ? { key: period.key, label: period.label, collected: period.collected } : null; };
  return {
    grouping: grouping,
    target: target,
    periods: periods,
    stats: {
      counted: counted.length,
      collected: collected,
      targetTotal: target === null ? null : cashMoney_(target * counted.length),
      overUnder: target === null ? null : cashMoney_(collected - target * counted.length),
      met: met,
      missed: target === null ? null : counted.length - met,
      metPercent: target === null || !counted.length ? null : Math.round(met / counted.length * 1000) / 10,
      average: counted.length ? cashMoney_(collected / counted.length) : null,
      best: pick(ranked[0]),
      worst: pick(ranked.length > 1 ? ranked[ranked.length - 1] : null),
      partial: periods.filter(function (period) { return period.nights && (period.partial || period.inProgress); }).length,
      empty: periods.filter(function (period) { return !period.nights; }).length
    }
  };
}

function cashPercentChange_(now, before) {
  return before ? Math.round((now - before) / before * 1000) / 10 : null;
}

// The insights panel: payment mix, regulars, weekdays, averages, status mix, repeat unpaid, the trend against the
// window of the same length just before the range, and new faces. All from the days already worked out above.
function cashInsights_(days, previousDays, firstSeen, names, fromDate, toDate, previousFrom, previousTo) {
  var active = days.filter(function (day) { return day.players; });
  var attendance = 0;
  var collected = 0;
  var mix = {};
  ['cash', 'venmo', 'zelle', 'credit', 'zeffy', 'unpaid'].forEach(function (method) { mix[method] = { count: 0, amount: 0 }; });
  var statusMix = { junior: 0, member: 0, visitor: 0 };
  var people = {};
  var weekdays = {};
  active.forEach(function (day) {
    attendance += day.players;
    collected += day.expected;
    var weekday = weekdays[day.weekday] || (weekdays[day.weekday] = { nights: 0, players: 0, collected: 0 });
    weekday.nights += 1;
    weekday.players += day.players;
    weekday.collected += day.expected;
    day.playerList.forEach(function (player) {
      var method = player.method || 'unpaid';
      mix[method].count += 1;
      mix[method].amount += player.method ? player.collected : player.owed;
      statusMix[player.status] = (statusMix[player.status] || 0) + 1;
      var person = people[player.playerId] || (people[player.playerId] = { name: player.name, status: player.status, nights: 0, paid: 0, unpaidNights: 0, owed: 0 });
      if (player.kind !== 'other') person.nights += 1;
      person.paid += player.collected;
      if (!player.method) { person.unpaidNights += 1; person.owed += player.owed; }
    });
  });
  var share = function (part, whole) { return whole ? Math.round(part / whole * 1000) / 10 : 0; };
  var methods = Object.keys(mix).map(function (method) {
    return { method: method, count: mix[method].count, amount: cashMoney_(mix[method].amount), countShare: share(mix[method].count, attendance), amountShare: method === 'unpaid' || method === 'zeffy' ? null : share(mix[method].amount, collected) };
  });
  // Ties go to the method listed first (cash, venmo, zelle, credit, zeffy), so the answer never depends on row order.
  var leader = function (candidates, key) {
    var best = null;
    methods.forEach(function (item) { if (candidates.indexOf(item.method) >= 0 && item[key] > 0 && (!best || item[key] > best[key])) best = item; });
    return best ? best.method : null;
  };
  var everyone = Object.keys(people).map(function (playerId) { return people[playerId]; });
  var byName = function (left, right) { return left.name.localeCompare(right.name); };
  var weekdayOrder = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var weekdayList = weekdayOrder.filter(function (name) { return weekdays[name]; }).map(function (name) {
    var item = weekdays[name];
    return { weekday: name, nights: item.nights, averagePlayers: Math.round(item.players / item.nights * 10) / 10, averageCollected: cashMoney_(item.collected / item.nights) };
  });
  var busiest = null;
  weekdayList.forEach(function (item) {
    if (!busiest || item.averagePlayers > busiest.averagePlayers || (item.averagePlayers === busiest.averagePlayers && item.averageCollected > busiest.averageCollected)) busiest = item;
  });
  var previousActive = previousDays.filter(function (day) { return day.players; });
  var previousCollected = cashMoney_(previousActive.reduce(function (sum, day) { return sum + day.expected; }, 0));
  var previousAttendance = previousActive.reduce(function (sum, day) { return sum + day.players; }, 0);
  return {
    attendance: attendance,
    nights: active.length,
    methods: methods,
    topByCount: leader(['cash', 'venmo', 'zelle', 'credit', 'zeffy'], 'count'),
    topByDollars: leader(CASH_METHODS, 'amount'),
    topPlayers: everyone.filter(function (person) { return person.nights; }).sort(function (left, right) {
      return right.nights - left.nights || right.paid - left.paid || byName(left, right);
    }).slice(0, 10).map(function (person) { return { name: person.name, status: person.status, nights: person.nights, paid: cashMoney_(person.paid) }; }),
    weekdays: weekdayList,
    busiestWeekday: busiest ? busiest.weekday : null,
    averagePlayersPerNight: active.length ? Math.round(attendance / active.length * 10) / 10 : null,
    averagePerPlayer: attendance ? cashMoney_(collected / attendance) : null,
    statusMix: statusMix,
    zeffyShare: share(mix.zeffy.count, attendance),
    unpaid: {
      count: mix.unpaid.count,
      amount: cashMoney_(mix.unpaid.amount),
      repeat: everyone.filter(function (person) { return person.unpaidNights >= 2; }).sort(function (left, right) {
        return right.unpaidNights - left.unpaidNights || right.owed - left.owed || byName(left, right);
      }).map(function (person) { return { name: person.name, nights: person.unpaidNights, owed: cashMoney_(person.owed) }; })
    },
    trend: {
      previousFrom: previousFrom,
      previousTo: previousTo,
      collected: cashMoney_(collected),
      previousCollected: previousCollected,
      collectedChange: cashPercentChange_(collected, previousCollected),
      attendance: attendance,
      previousAttendance: previousAttendance,
      attendanceChange: cashPercentChange_(attendance, previousAttendance),
      nights: active.length,
      previousNights: previousActive.length
    },
    newFaces: Object.keys(firstSeen).filter(function (playerId) { return firstSeen[playerId] >= fromDate && firstSeen[playerId] <= toDate; })
    .map(function (playerId) { return { name: names[playerId] || 'Unknown player', firstDate: firstSeen[playerId] }; })
    .sort(function (left, right) { return left.firstDate < right.firstDate ? -1 : left.firstDate > right.firstDate ? 1 : byName(left, right); })
  };
}

// Club-wide targets, one row per period in the private CashTargets tab: what a club day, week or month should bring in.
function cashTargetsFrom_(rows) {
  var targets = { day: null, week: null, month: null };
  var seen = {};
  rows.forEach(function (row) {
    var period = String(row.period || '').trim();
    if (!period) return;
    if (CASH_PERIODS.indexOf(period) < 0) throw new Error('CashTargets row ' + row.__row + ' has unknown period "' + period + '"');
    if (seen[period]) throw new Error('Duplicate cash target for ' + period);
    seen[period] = true;
    var amount = row.amount === '' || row.amount === null || row.amount === undefined ? null : cashMoney_(Number(row.amount));
    targets[period] = amount !== null && isFinite(amount) && amount >= 0 ? amount : null;
  });
  return targets;
}

function getCashTargets() {
  return cashTargetsFrom_(cashRows_('CashTargets'));
}

function ensureCashTargetTable_() {
  TABLES.CashTargets = CASH_TARGET_HEADERS;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName('CashTargets');
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet('CashTargets');
  ensureHeader_(sheet, CASH_TARGET_HEADERS);
  if (created) formatTable_(sheet, CASH_TARGET_HEADERS.length);
}

// Saves the club's day, week or month target for everyone; blank clears it. Returns all three targets.
function saveCashTarget(period, amount) {
  period = String(period || '');
  if (CASH_PERIODS.indexOf(period) < 0) throw new Error('Target period must be day, week or month.');
  var value = cashAmount_(amount, CASH_TARGET_MAX, 'The target must be an amount like 450 or 450.50.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureCashTargetTable_();
    var matches = rows_('CashTargets').filter(function (row) { return String(row.period).trim() === period; });
    if (matches.length > 1) throw new Error('Duplicate cash target for ' + period);
    if (value === null) {
      if (matches.length) SpreadsheetApp.getActive().getSheetByName('CashTargets').deleteRow(matches[0].__row);
    } else if (matches.length) {
      updateRow_('CashTargets', matches[0].__row, { amount: value, updated_at: new Date() });
    } else {
      appendObjects_('CashTargets', [{ period: period, amount: value, updated_at: new Date() }]);
    }
    // As text, like the cash count: numbers are copied to the public desk log.
    appendAudit_('cash_target_updated', 'database', 'cash-target-' + period, { period: period, amount: value === null ? 'cleared' : value.toFixed(2) });
    return getCashTargets();
  } finally {
    lock.releaseLock();
  }
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

// Blank clears; otherwise a non-negative amount with at most two decimals ($ and commas allowed), up to max.
function cashAmount_(value, max, message) {
  if (value === null || value === undefined) return null;
  var text = String(value).trim().replace(/^\$/, '').replace(/,/g, '');
  if (text === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(text) || Number(text) > max) throw new Error(message);
  return cashMoney_(Number(text));
}

// One row per date in CashCounts. A count and a note can be saved on their own; clearing both removes the row.
function saveCashCount(sessionDate, counted, note) {
  cashDate_(sessionDate, 'Session date');
  var amount = cashAmount_(counted, CASH_COUNT_MAX, 'Counted cash must be an amount like 45 or 45.50.');
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
