// What one night costs each player: Junior $5, Member $10, Visitor $15, and $10 on a player's first visit
// (firstvisit.html). The desk, the cash flow page and Clover matching all take the fee from here.
//
// A first visit is worked out, not typed in: a night is a player's first visit when their directory record was created
// that day and they have no earlier night on the desk (round robin or Open Play). Players from the club's older records
// were created on another day, so none of them count. An organizer can change it for one night from the player's payment
// menu on the desk; that choice is kept in the FirstVisits tab and wins. Juniors pay $5 whatever the night, and a member
// pays $10 either way.
//
// MemberStatus keeps only the current status, so a player's status on an earlier night comes from the AuditLog's
// member_status_updated rows: the last change made by the end of that night, or, before their first change, the other one
// of member and visitor (the desk only switches between the two). From the night of the last change on, the status is
// the one MemberStatus holds now. Juniors and names linked as the same person stay as they are now.
var NIGHT_FEES = { junior: 5, member: 10, visitor: 15, intro: 10 };
var FIRST_VISIT_HEADERS = ['session_date', 'player_id', 'first_visit', 'updated_at'];

function nightFee_(status, firstVisit) {
  if (status === 'junior') return NIGHT_FEES.junior;
  if (firstVisit) return NIGHT_FEES.intro;
  return NIGHT_FEES[status] || NIGHT_FEES.visitor;
}

function ensureFirstVisitTable_() {
  TABLES.FirstVisits = FIRST_VISIT_HEADERS;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName('FirstVisits');
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet('FirstVisits');
  ensureHeader_(sheet, FIRST_VISIT_HEADERS);
  if (created) formatTable_(sheet, FIRST_VISIT_HEADERS.length);
}

// Reading never adds the tab: it is made by the first choice on the desk.
function firstVisitRows_() {
  if (!SpreadsheetApp.getActive().getSheetByName('FirstVisits')) return [];
  TABLES.FirstVisits = FIRST_VISIT_HEADERS;
  return rows_('FirstVisits');
}

// Reads the rows once (Players, SessionPlayers, OpenPlay and the FirstVisits choices, each passed in or read here) and
// returns function (date) -> { playerId: true } for every player on their first visit that night.
function firstVisitFinder_(playerRows, sessionRows, openRows, choiceRows) {
  var earliest = {};
  var night = function (playerId, date) { if (date && (!earliest[playerId] || date < earliest[playerId])) earliest[playerId] = date; };
  (sessionRows || rows_('SessionPlayers')).forEach(function (row) {
    // A round robin or an Equalizer: either is a night at the club (SessionIds.js).
    night(String(row.player_id), sessionDateOf_(row.session_id));
  });
  (openRows || cashRows_('OpenPlay')).forEach(function (row) { night(String(row.player_id), displayDate_(row.session_date).slice(0, 10)); });
  var createdOn = {};
  (playerRows || rows_('Players')).forEach(function (row) {
    var date = row.created_at ? displayDate_(row.created_at).slice(0, 10) : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) (createdOn[date] || (createdOn[date] = [])).push(String(row.player_id));
  });
  var chosen = {};
  (choiceRows || firstVisitRows_()).forEach(function (row) {
    var date = displayDate_(row.session_date).slice(0, 10);
    (chosen[date] || (chosen[date] = {}))[String(row.player_id)] = asBoolean_(row.first_visit);
  });
  return function (date) {
    var first = {};
    (createdOn[date] || []).forEach(function (playerId) { if (!(earliest[playerId] < date)) first[playerId] = true; });
    var choices = chosen[date] || {};
    Object.keys(choices).forEach(function (playerId) {
      if (choices[playerId]) first[playerId] = true;
      else delete first[playerId];
    });
    return first;
  };
}

// current: getMemberStatuses().statuses. Returns function (date) -> { playerId: status } for that night.
function memberStatusFinder_(current, players, linkRows, auditRows) {
  var fixed = {};
  confirmedNameLinks_(players, linkRows).resolved.forEach(function (link) {
    fixed[link.left.playerId] = true;
    fixed[link.right.playerId] = true;
  });
  var changes = {};
  (auditRows || cashRows_('AuditLog')).forEach(function (row) {
    if (row.action !== 'member_status_updated') return;
    var playerId = String(row.entity_id);
    if (fixed[playerId] || !current[playerId] || current[playerId] === 'junior') return;
    var time = row.event_time instanceof Date ? row.event_time.getTime() : Date.parse(row.event_time);
    if (!isFinite(time)) return;
    var details;
    try { details = JSON.parse(row.details_json || '{}'); } catch (error) { return; }
    (changes[playerId] || (changes[playerId] = [])).push({ time: time, date: displayDate_(new Date(time)), status: details.status === 'member' ? 'member' : 'visitor' });
  });
  Object.keys(changes).forEach(function (playerId) { changes[playerId].sort(function (left, right) { return left.time - right.time; }); });
  return function (date) {
    var statuses = Object.assign({}, current);
    Object.keys(changes).forEach(function (playerId) {
      var before = changes[playerId].filter(function (change) { return change.date <= date; });
      var after = changes[playerId].filter(function (change) { return change.date > date; });
      if (!after.length) return;
      statuses[playerId] = before.length ? before[before.length - 1].status : after[0].status === 'member' ? 'visitor' : 'member';
    });
    return statuses;
  };
}

// The desk's first visits for one night, as a list of player IDs.
function firstVisitIdsOn_(sessionDate, playerRows) {
  return Object.keys(firstVisitFinder_(playerRows)(sessionDate));
}

// The organizer's choice for one night: firstVisit true charges the $10 first-visit fee, false the usual fee.
function setFirstVisit(sessionDate, playerId, firstVisit) {
  validateSessionDate_(sessionDate);
  playerId = String(playerId || '');
  if (typeof firstVisit !== 'boolean') throw new Error('Valid player and first visit required');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var player = findRow_('Players', 'player_id', playerId);
    if (!player || !asBoolean_(player.active)) throw new Error('Unknown or inactive player');
    ensureFirstVisitTable_();
    var matches = rows_('FirstVisits').filter(function (row) {
      return displayDate_(row.session_date).slice(0, 10) === sessionDate && String(row.player_id) === playerId;
    });
    if (matches.length > 1) throw new Error('Duplicate first visit for ' + playerId);
    if (matches.length) updateRow_('FirstVisits', matches[0].__row, { first_visit: firstVisit, updated_at: new Date() });
    else appendObjects_('FirstVisits', [{ session_date: sessionDate, player_id: playerId, first_visit: firstVisit, updated_at: new Date() }]);
    appendAudit_('first_visit_updated', 'session', 'session-' + sessionDate, { playerId: playerId, firstVisit: firstVisit });
    return firstVisitIdsOn_(sessionDate);
  } finally {
    lock.releaseLock();
  }
}
