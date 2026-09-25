var OPEN_PLAY_HEADERS = ['session_date', 'player_id', 'updated_at'];

function ensureOpenPlayTable_() {
  TABLES.OpenPlay = OPEN_PLAY_HEADERS;
  var spreadsheet = SpreadsheetApp.getActive();
  var sheet = spreadsheet.getSheetByName('OpenPlay');
  var created = !sheet;
  if (created) sheet = spreadsheet.insertSheet('OpenPlay');
  ensureHeader_(sheet, OPEN_PLAY_HEADERS);
  if (created) formatTable_(sheet, OPEN_PLAY_HEADERS.length);
}

function getOpenPlayParticipants(sessionDate) {
  validateSessionDate_(sessionDate);
  ensureOpenPlayTable_();
  var seen = {};
  return rows_('OpenPlay').filter(function (row) {
    return displayDate_(row.session_date) === sessionDate;
  }).map(function (row) {
    var playerId = String(row.player_id);
    if (seen[playerId]) throw new Error('Duplicate open-play participant ' + playerId);
    seen[playerId] = true;
    return playerId;
  });
}

function setOpenPlayParticipant(sessionDate, playerId, attending) {
  validateSessionDate_(sessionDate);
  playerId = String(playerId || '');
  if (!playerId || typeof attending !== 'boolean') throw new Error('Valid player and attendance required');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    ensureOpenPlayTable_();
    var player = findRow_('Players', 'player_id', playerId);
    if (!player || !asBoolean_(player.active)) throw new Error('Unknown or inactive player');
    if (attending && rows_('SessionPlayers').some(function (row) {
      return String(row.session_id) === 'session-' + sessionDate && String(row.player_id) === playerId;
    })) throw new Error('Player is already in the saved round robin');
    var matches = rows_('OpenPlay').filter(function (row) {
      return displayDate_(row.session_date) === sessionDate && String(row.player_id) === playerId;
    });
    if (matches.length > 1) throw new Error('Duplicate open-play participant ' + playerId);
    if (attending && !matches.length) {
      appendObjects_('OpenPlay', [{ session_date: sessionDate, player_id: playerId, updated_at: new Date() }]);
    } else if (!attending && matches.length) {
      SpreadsheetApp.getActive().getSheetByName('OpenPlay').deleteRow(matches[0].__row);
    }
    appendAudit_('open_play_updated', 'session', 'session-' + sessionDate, { playerId: playerId, attending: attending });
    return attending;
  } finally {
    lock.releaseLock();
  }
}