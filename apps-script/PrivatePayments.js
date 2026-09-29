var PRIVATE_PAYMENT_TABLES = {
  ZeffyPasses: ['player_id', 'player_name', 'active', 'updated_at'],
  SessionPayments: ['session_id', 'player_id', 'method', 'updated_at']
};
var PAYMENT_METHODS = ['venmo', 'zelle', 'cash', 'zeffy'];

function revenueRows_() {
  var documentId = PropertiesService.getScriptProperties().getProperty('CTTC_REVENUE_DOC_ID');
  if (!documentId) return [];
  var tables = DocumentApp.openById(documentId).getBody().getTables();
  if (!tables || tables.length !== 1) throw new Error('Revenue document must contain one table');
  var table = tables[0];
  var rows = [];
  for (var index = 0; index < table.getNumRows(); index++) {
    var row = table.getRow(index);
    if (row.getNumCells() < 4) throw new Error('Revenue document row must contain four columns');
    rows.push([row.getCell(0).getText(), row.getCell(1).getText(), row.getCell(2).getText(), row.getCell(3).getText()]);
  }
  return rows;
}

function revenuePassesForDate_(rows, playerRows, sessionDate) {
  var matches = {};
  (playerRows || rows_('Players')).forEach(function (player) {
    var name = normalizeName_(player.display_name).toLowerCase();
    if (!matches[name]) matches[name] = [];
    matches[name].push(player);
  });
  var passes = {};
  rows.forEach(function (row) {
    if (String(row[0]).trim() !== 'M/Zeffy') return;
    var expiry = String(row[3]).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
    if (!expiry) return;
    var year = Number(expiry[3]) + (expiry[3].length === 2 ? 2000 : 0);
    var month = Number(expiry[1]);
    var day = Number(expiry[2]);
    var date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return;
    if (date.toISOString().slice(0, 10) < sessionDate) return;
    var name = normalizeName_(String(row[1]) + ' ' + String(row[2])).toLowerCase();
    var players = matches[name] || [];
    if (players.length !== 1) return;
    var player = players[0];
    passes[String(player.player_id)] = { playerId: String(player.player_id), name: String(player.display_name) };
  });
  return Object.keys(passes).map(function (id) { return passes[id]; });
}

function ensurePrivatePaymentTables_() {
  var spreadsheet = SpreadsheetApp.getActive();
  Object.keys(PRIVATE_PAYMENT_TABLES).forEach(function (name) {
    var headers = PRIVATE_PAYMENT_TABLES[name];
    TABLES[name] = headers;
    var sheet = spreadsheet.getSheetByName(name);
    var created = !sheet;
    if (created) sheet = spreadsheet.insertSheet(name);
    ensureHeader_(sheet, headers);
    if (created) formatTable_(sheet, headers.length);
  });
}

// Zeffy is an optional monthly play pass; holders owe no per-session fee.
function getZeffyPlayers(playerRows, sessionDate) {
  ensurePrivatePaymentTables_();
  var names = {};
  (playerRows || rows_('Players')).forEach(function (player) { names[String(player.player_id)] = String(player.display_name); });
  var seen = {};
  var passes = rows_('ZeffyPasses').filter(function (pass) { return asBoolean_(pass.active); }).map(function (pass) {
    var playerId = String(pass.player_id);
    if (seen[playerId]) throw new Error('Duplicate Zeffy pass for ' + playerId);
    seen[playerId] = true;
    if (!names[playerId]) throw new Error('Zeffy pass for unknown player ' + playerId);
    return { playerId: playerId, name: names[playerId] };
  });
  if (sessionDate) revenuePassesForDate_(revenueRows_(), playerRows || rows_('Players'), sessionDate).forEach(function (pass) {
    if (!seen[pass.playerId]) passes.push(pass);
  });
  return passes.sort(function (left, right) { return left.name.localeCompare(right.name); });
}

function getZeffyCoveredPlayerIds(passes, players) {
  var covered = {};
  (passes || getZeffyPlayers()).forEach(function (player) { covered[player.playerId] = true; });
  confirmedNameLinks_(players || listPlayers()).resolved.forEach(function (link) {
    if (covered[link.left.playerId] || covered[link.right.playerId]) {
      covered[link.left.playerId] = true;
      covered[link.right.playerId] = true;
    }
  });
  return Object.keys(covered);
}

function setZeffyPass(playerId, active) {
  playerId = String(playerId || '');
  if (typeof active !== 'boolean') throw new Error('Valid player and active status required');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensurePrivatePaymentTables_();
    var player = findRow_('Players', 'player_id', playerId);
    if (!player) throw new Error('Unknown player');
    var matches = rows_('ZeffyPasses').filter(function (pass) { return String(pass.player_id) === playerId; });
    if (matches.length > 1) throw new Error('Duplicate Zeffy pass for ' + playerId);
    if (matches.length) updateRow_('ZeffyPasses', matches[0].__row, { active: active, updated_at: new Date() });
    else if (active) appendObjects_('ZeffyPasses', [{ player_id: playerId, player_name: String(player.display_name), active: true, updated_at: new Date() }]);
    appendAudit_('zeffy_pass_updated', 'player', playerId, { active: active });
    return active;
  } finally {
    lock.releaseLock();
  }
}

function getPrivatePaymentState(sessionDate) {
  return getPrivatePaymentOverview(sessionDate).methods;
}

function getPrivatePaymentOverview(sessionDate) {
  validateSessionDate_(sessionDate);
  var playerRows = rows_('Players');
  var players = listPlayers(playerRows);
  var passes = getZeffyPlayers(playerRows, sessionDate);
  var coveredIds = getZeffyCoveredPlayerIds(passes, players);
  var covered = {};
  coveredIds.forEach(function (playerId) { covered[playerId] = true; });
  var sessionId = 'session-' + sessionDate;
  var paid = {};
  rows_('SessionPayments').forEach(function (row) {
    if (String(row.session_id) !== sessionId) return;
    var playerId = String(row.player_id);
    if (paid[playerId] !== undefined) throw new Error('Duplicate payment for ' + playerId);
    var method = String(row.method || '');
    if (method && PAYMENT_METHODS.indexOf(method) < 0) throw new Error('Unknown payment method: ' + method);
    paid[playerId] = method;
  });
  var byPlayer = {};
  players.forEach(function (player) {
    byPlayer[player.playerId] = covered[player.playerId] ? 'zeffy' : paid[player.playerId] || '';
  });
  return { methods: byPlayer, coveredIds: coveredIds, passes: passes };
}

function setSessionPayment(sessionDate, playerId, method) {
  validateSessionDate_(sessionDate);
  playerId = String(playerId || '');
  method = String(method || '').toLowerCase();
  if (method && PAYMENT_METHODS.indexOf(method) < 0) throw new Error('Invalid payment method');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensurePrivatePaymentTables_();
    var player = findRow_('Players', 'player_id', playerId);
    if (!player || !asBoolean_(player.active)) throw new Error('Unknown or inactive player');
    if (getZeffyCoveredPlayerIds(getZeffyPlayers(null, sessionDate)).indexOf(playerId) >= 0) throw new Error('Zeffy play pass covers this session');
    var sessionId = 'session-' + sessionDate;
    var matches = rows_('SessionPayments').filter(function (row) {
      return String(row.session_id) === sessionId && String(row.player_id) === playerId;
    });
    if (matches.length > 1) throw new Error('Duplicate payment for ' + playerId);
    if (matches.length) {
      updateRow_('SessionPayments', matches[0].__row, { method: method, updated_at: new Date() });
    } else if (method) {
      appendObjects_('SessionPayments', [{ session_id: sessionId, player_id: playerId, method: method, updated_at: new Date() }]);
    }
    appendAudit_('session_payment_updated', 'session', sessionId, { playerId: playerId, method: method || 'unpaid' });
    return method;
  } finally {
    lock.releaseLock();
  }
}
