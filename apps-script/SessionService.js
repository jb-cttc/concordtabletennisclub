function listPlayers(playerRows) {
  return (playerRows || rows_('Players'))
  .filter(function (player) { return asBoolean_(player.active); })
  .map(function (player) {
    return {
      playerId: String(player.player_id),
      name: String(player.display_name),
      currentRating: Number(player.current_rating)
    };
  })
  .sort(function (left, right) { return left.name.localeCompare(right.name); });
}

function listArchivedPlayers() {
  return rows_('Players')
  .filter(function (player) { return !asBoolean_(player.active) && String(player.display_name).trim(); })
  .map(function (player) {
    return { playerId: String(player.player_id), name: String(player.display_name), currentRating: Number(player.current_rating) || 0 };
  })
  .sort(function (left, right) { return left.name.localeCompare(right.name); });
}

function activatePlayer(playerId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var player = findRow_('Players', 'player_id', String(playerId));
    if (!player) throw new Error('Unknown player');
    if (!asBoolean_(player.active)) {
      updateRow_('Players', player.__row, { active: true, updated_at: new Date() });
      appendAudit_('player_reactivated', 'player', String(playerId), { name: String(player.display_name) });
    }
    return { playerId: String(player.player_id), name: String(player.display_name), currentRating: Number(player.current_rating) || 0 };
  } finally {
    lock.releaseLock();
  }
}

// Other names a player has used (old directory records, Voice contact names).
function playerAliases_() {
  var aliases = {};
  rows_('Aliases').forEach(function (row) {
    aliases[normalizeName_(row.alias).toLowerCase()] = String(row.player_id);
  });
  return aliases;
}

function addPlayer(displayName, currentRating) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var name = normalizeName_(displayName);
    var rating = Number(currentRating);
    if (!name || name.length > 80) throw new Error('Player name must be 1 through 80 characters.');
    if (!Number.isInteger(rating) || rating < 0 || rating > 4000) throw new Error('Rating must be a whole number from 0 through 4000.');
    var duplicate = rows_('Players').some(function (player) {
      return normalizeName_(player.display_name).toLowerCase() === name.toLowerCase();
    });
    if (duplicate) throw new Error(name + ' already exists.');
    var now = new Date();
    var player = {
      player_id: 'player-' + Utilities.getUuid(),
      display_name: name,
      current_rating: rating,
      active: true,
      created_at: now,
      updated_at: now
    };
    appendObjects_('Players', [player]);
    appendAudit_('player_created', 'player', player.player_id, { name: name, rating: rating });
    return { playerId: player.player_id, name: name, currentRating: rating };
  } finally {
    lock.releaseLock();
  }
}

function createSession(sessionDate) {
  validateSessionDate_(sessionDate);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sessionId = 'session-' + sessionDate;
    if (findRow_('Sessions', 'session_id', sessionId)) throw new Error('A session already exists for ' + sessionDate + '.');
    var now = new Date();
    appendObjects_('Sessions', [{
      session_id: sessionId,
      session_date: sessionDate,
      status: 'draft',
      revision: 1,
      created_at: now,
      updated_at: now,
      finalized_at: ''
    }]);
    appendAudit_('session_created', 'session', sessionId, { date: sessionDate });
    return getSession(sessionId);
  } finally {
    lock.releaseLock();
  }
}

function getSession(sessionId) {
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (!session) return null;
  var sessionPlayers = rows_('SessionPlayers').filter(function (row) { return String(row.session_id) === sessionId; });
  var groupsByNumber = {};
  sessionPlayers.forEach(function (row) {
    var number = Number(row.group_number);
    if (!groupsByNumber[number]) groupsByNumber[number] = [];
    groupsByNumber[number].push({
      playerId: String(row.player_id),
      startingRating: Number(row.starting_rating),
      promotionFromGroup: row.promotion_from_group === '' ? null : Number(row.promotion_from_group)
    });
  });
  return {
    sessionId: String(session.session_id),
    sessionDate: displayDate_(session.session_date),
    status: String(session.status),
    revision: Number(session.revision),
    groups: Object.keys(groupsByNumber).map(Number).sort(function (a, b) { return a - b; }).map(function (number) {
      return { groupNumber: number, players: groupsByNumber[number] };
    }),
    matches: rows_('Matches').filter(function (row) { return String(row.session_id) === sessionId; }).map(function (row) {
      return {
        matchId: String(row.match_id),
        groupNumber: Number(row.group_number),
        playerOneId: String(row.player_one_id),
        playerTwoId: String(row.player_two_id),
        playerOneGames: row.player_one_games === '' ? null : Number(row.player_one_games),
        playerTwoGames: row.player_two_games === '' ? null : Number(row.player_two_games),
        forfeit: asBoolean_(row.forfeit),
        forfeitedBy: row.forfeited_by ? String(row.forfeited_by) : null,
        wonBy: row.won_by ? String(row.won_by) : null
      };
    })
  };
}

function getSessionByDate(sessionDate) {
  validateSessionDate_(sessionDate);
  return getSession('session-' + sessionDate);
}

function getAppState(sessionDate) {
  return { players: listPlayers(), session: getSessionByDate(sessionDate), ratingsSyncedThrough: ratingsSyncedThrough_(), ratingsCheckedAt: ratingsCheckedAt_() };
}

function saveSessionDraft(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Session payload is required.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sessionId = String(payload.sessionId || '');
    var session = requireEditableSession_(sessionId, payload.revision);
    var players = indexBy_(rows_('Players'), 'player_id');

    var seen = {};
    var sessionPlayers = [];
    (payload.groups || []).forEach(function (group) {
      var groupNumber = Number(group.groupNumber);
      if (!Number.isInteger(groupNumber) || groupNumber < 1) throw new Error('Group numbers must be positive whole numbers.');
      (group.playerIds || []).forEach(function (playerId) {
        playerId = String(playerId);
        var player = players[playerId];
        if (!player || !asBoolean_(player.active)) throw new Error('Unknown or inactive player: ' + playerId);
        if (seen[playerId]) throw new Error('Player appears in more than one group: ' + playerId);
        seen[playerId] = true;
        var promotedFrom = Number((payload.promotions || {})[playerId]);
        sessionPlayers.push({
          session_id: sessionId,
          player_id: playerId,
          group_number: groupNumber,
          starting_rating: Number(player.current_rating),
          promotion_from_group: Number.isInteger(promotedFrom) && promotedFrom > groupNumber ? promotedFrom : ''
        });
      });
    });
    if (!sessionPlayers.length) throw new Error('At least one player is required.');

    var pairKeys = {};
    var matches = (payload.matches || []).map(function (match) {
      var first = String(match.playerOneId);
      var second = String(match.playerTwoId);
      if (!seen[first] || !seen[second] || first === second) throw new Error('A match contains invalid players.');
      if (!validGames_(match.playerOneGames) || !validGames_(match.playerTwoGames)) throw new Error('Game scores must be blank or whole numbers from 0 through 3.');
      var pair = [first, second].sort().join('::');
      if (pairKeys[pair]) throw new Error('Duplicate match: ' + pair);
      pairKeys[pair] = true;
      var forfeitedBy = match.forfeitedBy ? String(match.forfeitedBy) : '';
      if (forfeitedBy && forfeitedBy !== 'both' && forfeitedBy !== first && forfeitedBy !== second) throw new Error('The forfeiting player is not in the match: ' + pair);
      var wonBy = match.wonBy ? String(match.wonBy) : '';
      if (wonBy) {
        if (forfeitedBy) throw new Error('A forfeited match cannot also be a best-of-3 win: ' + pair);
        if (!shortWinValid_(wonBy, first, second, match.playerOneGames, match.playerTwoGames)) throw new Error('A best-of-3 winner needs exactly 2 games and the other player at most 1: ' + pair);
      }
      return {
        match_id: sessionId + ':' + pair,
        session_id: sessionId,
        group_number: Number(match.groupNumber),
        player_one_id: first,
        player_two_id: second,
        player_one_games: match.playerOneGames === null ? '' : Number(match.playerOneGames),
        player_two_games: match.playerTwoGames === null ? '' : Number(match.playerTwoGames),
        forfeit: !!match.forfeit || !!forfeitedBy,
        updated_at: new Date(),
        forfeited_by: forfeitedBy,
        won_by: wonBy
      };
    });

    ensureMatchesColumns_();
    replaceSessionRows_('SessionPlayers', sessionId, sessionPlayers);
    replaceSessionRows_('Matches', sessionId, matches);
    updateRow_('Sessions', session.__row, {
      status: 'active',
      revision: Number(session.revision) + 1,
      updated_at: new Date()
    });
    appendAudit_('session_saved', 'session', sessionId, { revision: Number(session.revision) + 1, players: sessionPlayers.length, matches: matches.length });
    return getSession(sessionId);
  } finally {
    lock.releaseLock();
  }
}

function finalizeSession(sessionId, expectedRevision) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var session = requireEditableSession_(String(sessionId), expectedRevision);
    var sessionDate = displayDate_(session.session_date);
    var syncedThrough = ratingsSyncedThrough_();
    if (syncedThrough && sessionDate <= syncedThrough) {
      throw new Error('The club site already has results through ' + syncedThrough + '. Finalizing ' + sessionDate + ' here would count those matches twice.');
    }
    var sessionPlayers = rows_('SessionPlayers').filter(function (row) { return String(row.session_id) === sessionId; });
    var matches = rows_('Matches').filter(function (row) { return String(row.session_id) === sessionId; });
    validateCompleteRoundRobin_(sessionPlayers, matches);

    var players = indexBy_(rows_('Players'), 'player_id');
    var starts = {};
    var adjustments = {};
    sessionPlayers.forEach(function (entry) {
      var playerId = String(entry.player_id);
      var player = players[playerId];
      var startingRating = Number(entry.starting_rating);
      if (!player) throw new Error('Player no longer exists: ' + playerId);
      if (Number(player.current_rating) !== startingRating) throw new Error('Rating changed after this session started for ' + player.display_name + '. Save the draft again before finalizing.');
      starts[playerId] = startingRating;
      adjustments[playerId] = 0;
    });

    matches.forEach(function (match) {
      var first = String(match.player_one_id);
      var second = String(match.player_two_id);
      var by = String(match.forfeited_by || '');
      if (by === 'both') return;
      var firstWon = match.player_one_games === '' ? by === second : Number(match.player_one_games) > Number(match.player_two_games);
      var winner = firstWon ? first : second;
      var loser = firstWon ? second : first;
      var points = ratingAdjustment_(starts[winner], starts[loser], asBoolean_(match.forfeit));
      adjustments[winner] += points;
      adjustments[loser] -= points;
    });

    var existingEvents = rows_('RatingLedger').some(function (row) { return String(row.session_id) === sessionId; });
    if (existingEvents) throw new Error('Rating events already exist for this session. Finalization stopped to prevent duplicate updates.');

    var now = new Date();
    var ledger = [];
    Object.keys(adjustments).forEach(function (playerId) {
      var before = starts[playerId];
      var after = projectedRating_(before, adjustments[playerId]);
      var effectiveAdjustment = after - before;
      updateRow_('Players', players[playerId].__row, { current_rating: after, updated_at: now });
      ledger.push({
        event_id: sessionId + ':' + playerId,
        session_id: sessionId,
        player_id: playerId,
        rating_before: before,
        adjustment: effectiveAdjustment,
        rating_after: after,
        rule_version: RATING_RULE_VERSION,
        created_at: now
      });
    });
    appendObjects_('RatingLedger', ledger);
    updateRow_('Sessions', session.__row, {
      status: 'finalized',
      revision: Number(session.revision) + 1,
      updated_at: now,
      finalized_at: now
    });
    appendAudit_('session_finalized', 'session', sessionId, { revision: Number(session.revision) + 1, ratingEvents: ledger.length });
    try { schedulePublish_(sessionId, sessionDate); } catch (error) { /* finalizing already succeeded; the workflow's scheduled run still publishes it */ }
    return getSession(sessionId);
  } finally {
    lock.releaseLock();
  }
}

var PUBLIC_SESSIONS_URL = 'https://concordtabletennisclub.com/data/sessions.json';

// A session the site already lists cannot be reopened: the site refuses to change a published session.
function sessionOnSite_(sessionDate) {
  var response = UrlFetchApp.fetch(PUBLIC_SESSIONS_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Could not check whether the club site already lists this session (HTTP ' + response.getResponseCode() + '). Try again.');
  return JSON.parse(response.getContentText()).some(function (entry) { return String(entry.date) === sessionDate; });
}

// Reopens the most recent finalized session: restores each player's rating from the ledger, removes the
// ledger rows, and makes the session editable again. It must be finalized again after the correction.
function reopenSession(sessionId, expectedRevision) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    sessionId = String(sessionId);
    var session = findRow_('Sessions', 'session_id', sessionId);
    if (!session) throw new Error('Session not found: ' + sessionId);
    if (String(session.status) !== 'finalized') throw new Error('Only a finalized session can be reopened.');
    if (Number(session.revision) !== Number(expectedRevision)) throw new Error('This session changed on another device. Reload before reopening.');
    var sessionDate = displayDate_(session.session_date);
    var later = rows_('Sessions').filter(function (row) { return String(row.status) === 'finalized' && displayDate_(row.session_date) > sessionDate; });
    if (later.length) throw new Error('The ' + displayDate_(later[0].session_date) + ' session is already finalized. Reopen the most recent session first.');
    if (sessionOnSite_(sessionDate)) throw new Error('The club site already lists this session, so it can no longer be reopened here. Corrections after publication need a separate fix.');

    var ledger = rows_('RatingLedger').filter(function (row) { return String(row.session_id) === sessionId; });
    var players = indexBy_(rows_('Players'), 'player_id');
    ledger.forEach(function (row) {
      var player = players[String(row.player_id)];
      if (!player) throw new Error('Player no longer exists: ' + row.player_id);
      if (Number(player.current_rating) !== Number(row.rating_after)) {
        throw new Error('The rating of ' + player.display_name + ' changed after this session was finalized, so it cannot be reversed safely.');
      }
    });

    var now = new Date();
    ledger.forEach(function (row) {
      updateRow_('Players', players[String(row.player_id)].__row, { current_rating: Number(row.rating_before), updated_at: now });
    });
    replaceSessionRows_('RatingLedger', sessionId, []);
    updateRow_('Sessions', session.__row, { status: 'active', revision: Number(session.revision) + 1, updated_at: now, finalized_at: '' });
    appendAudit_('session_reopened', 'session', sessionId, {
      revision: Number(session.revision) + 1,
      reversed: ledger.map(function (row) { return [String(row.player_id), Number(row.rating_after), Number(row.rating_before)]; })
    });
    try { cancelPublish_(sessionId); } catch (error) { /* nothing else publishes a session that is open */ }
    return getSession(sessionId);
  } finally {
    lock.releaseLock();
  }
}

function validateCompleteRoundRobin_(sessionPlayers, matches) {
  if (!sessionPlayers.length) throw new Error('The session has no players.');
  var groupPlayers = {};
  sessionPlayers.forEach(function (entry) {
    var group = String(entry.group_number);
    if (!groupPlayers[group]) groupPlayers[group] = [];
    groupPlayers[group].push(String(entry.player_id));
  });
  var expected = {};
  Object.keys(groupPlayers).forEach(function (group) {
    var ids = groupPlayers[group];
    for (var first = 0; first < ids.length; first += 1) {
      for (var second = first + 1; second < ids.length; second += 1) expected[[ids[first], ids[second]].sort().join('::')] = group;
    }
  });
  matches.forEach(function (match) {
    var key = [String(match.player_one_id), String(match.player_two_id)].sort().join('::');
    if (!expected[key]) throw new Error('Unexpected match: ' + key);
    var firstGames = Number(match.player_one_games);
    var secondGames = Number(match.player_two_games);
    var forfeitedBy = String(match.forfeited_by || '');
    var unscored = match.player_one_games === '' && match.player_two_games === '';
    if (forfeitedBy && forfeitedBy !== 'both' && forfeitedBy !== String(match.player_one_id) && forfeitedBy !== String(match.player_two_id)) throw new Error('The forfeiting player is not in the match: ' + key);
    if (forfeitedBy && unscored) {
      delete expected[key];
      return;
    }
    var complete = (firstGames === 3 && secondGames >= 0 && secondGames <= 2) || (secondGames === 3 && firstGames >= 0 && firstGames <= 2);
    var wonBy = String(match.won_by || '');
    if (wonBy) {
      if (forfeitedBy) throw new Error('A forfeited match cannot also be a best-of-3 win: ' + key);
      if (!shortWinValid_(wonBy, String(match.player_one_id), String(match.player_two_id), match.player_one_games === '' ? null : firstGames, match.player_two_games === '' ? null : secondGames)) throw new Error('Incomplete or invalid best-of-3 match: ' + key);
      delete expected[key];
      return;
    }
    if (!complete) throw new Error('Incomplete or invalid match: ' + key);
    if (asBoolean_(match.forfeit) && !forfeitedBy) throw new Error('Choose who forfeited before finalizing: ' + key);
    if (forfeitedBy === 'both') throw new Error('A match that was not played cannot have a score: ' + key);
    if (forfeitedBy && forfeitedBy !== String(firstGames > secondGames ? match.player_two_id : match.player_one_id)) throw new Error('The forfeiting player must have lost the match: ' + key);
    delete expected[key];
  });
  var missing = Object.keys(expected);
  if (missing.length) throw new Error('Missing ' + missing.length + ' round-robin match' + (missing.length === 1 ? '' : 'es') + '.');
}

function ensureMatchesColumns_() {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Matches');
  if (!sheet) throw new Error('Missing database table: Matches');
  ensureHeader_(sheet, TABLES.Matches);
}

function requireEditableSession_(sessionId, expectedRevision) {
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (!session) throw new Error('Session not found: ' + sessionId);
  if (String(session.status) === 'finalized') throw new Error('Finalized sessions are read-only.');
  if (Number(session.revision) !== Number(expectedRevision)) throw new Error('This session changed on another device. Reload before saving.');
  return session;
}

function rows_(sheetName) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet) throw new Error('Missing database table: ' + sheetName);
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).map(function (row, index) {
    var object = { __row: index + 2 };
    headers.forEach(function (header, column) { object[header] = row[column]; });
    return object;
  }).filter(function (object, index) { return values[index + 1].some(function (value) { return value !== ''; }); });
}

function findRow_(sheetName, key, value) {
  return rows_(sheetName).find(function (row) { return String(row[key]) === String(value); }) || null;
}

function indexBy_(rows, key) {
  var index = {};
  rows.forEach(function (row) { index[String(row[key])] = row; });
  return index;
}

function appendObjects_(sheetName, objects) {
  if (!objects.length) return;
  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  var headers = TABLES[sheetName];
  var values = objects.map(function (object) { return headers.map(function (header) { return object[header] === undefined ? '' : object[header]; }); });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
}

function updateRow_(sheetName, rowNumber, changes) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  var headers = TABLES[sheetName];
  Object.keys(changes).forEach(function (header) {
    var column = headers.indexOf(header) + 1;
    if (!column) throw new Error('Unknown column ' + header + ' in ' + sheetName);
    sheet.getRange(rowNumber, column).setValue(changes[header]);
  });
}

function replaceSessionRows_(sheetName, sessionId, replacements) {
  var sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  var headers = TABLES[sheetName];
  var kept = rows_(sheetName).filter(function (row) { return String(row.session_id) !== sessionId; });
  var combined = kept.concat(replacements).map(function (object) {
    return headers.map(function (header) { return object[header] === undefined ? '' : object[header]; });
  });
  if (sheet.getMaxRows() > 1) sheet.getRange(2, 1, sheet.getMaxRows() - 1, headers.length).clearContent();
  if (combined.length) sheet.getRange(2, 1, combined.length, headers.length).setValues(combined);
}

function normalizeName_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function validateSessionDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) throw new Error('Session date must use YYYY-MM-DD.');
}

function displayDate_(value) {
  return value instanceof Date ? Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd') : String(value);
}

// A match cut short to best of 3: the winner has exactly 2 games and the other player has 0 or 1.
function shortWinValid_(wonBy, first, second, firstGames, secondGames) {
  if (firstGames === null || secondGames === null || firstGames === undefined || secondGames === undefined) return false;
  if (wonBy === first) return firstGames === 2 && secondGames <= 1;
  if (wonBy === second) return secondGames === 2 && firstGames <= 1;
  return false;
}

function validGames_(value) {
  return value === null || value === '' || (Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 3);
}

function asBoolean_(value) {
  return value === true || String(value).toLowerCase() === 'true' || Number(value) === 1;
}

