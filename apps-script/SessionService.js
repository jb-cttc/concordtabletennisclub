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
  var session = getSessionByDate(sessionDate);
  return {
    players: listPlayers(),
    session: session,
    ratingsSyncedThrough: ratingsSyncedThrough_(),
    ratingsCheckedAt: ratingsCheckedAt_(),
    // Ledger rows for a session that is not finalized: a finalize or reopen stopped partway. The desk says so on load.
    interruptedFinalize: !!session && session.status !== 'finalized' && rows_('RatingLedger').some(function (row) { return String(row.session_id) === session.sessionId; })
  };
}

function saveSessionDraft(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Session payload is required.');
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (error) { throw new Error(DESK_BUSY_MESSAGE); }
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

// Finalizing writes three tables, and Google can stop partway (a timeout, a lost connection). The ledger is written
// first so an interrupted run always leaves rows that show what it did; the session is marked finalized last. A
// failure is rolled back where Google allows, and the next attempt repairs whatever a run could not roll back.
function finalizeSession(sessionId, expectedRevision) {
  sessionId = String(sessionId);
  return loggedDeskAction_('finalize', sessionId, function () {
    return withDeskLock_(function () { return finalizeLocked_(sessionId, expectedRevision); });
  });
}

function finalizeLocked_(sessionId, expectedRevision) {
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (!session) throw new Error('Session not found: ' + sessionId);
  if (String(session.status) === 'finalized') {
    // The same finalize again, after its reply was lost on the way back: report what it did.
    if (Number(session.revision) === Number(expectedRevision) + 1) return getSession(sessionId);
    throw new Error('This session is already finalized. Reload the page to see it; the lock button reopens it if a correction is needed.');
  }
  if (Number(session.revision) !== Number(expectedRevision)) throw new Error(CHANGED_ELSEWHERE_MESSAGE);
  var sessionDate = displayDate_(session.session_date);
  var syncedThrough = ratingsSyncedThrough_();
  if (syncedThrough && sessionDate <= syncedThrough) {
    throw new Error('The club site already has results through ' + syncedThrough + ', so finalizing ' + sessionDate + ' here would count those matches twice. If the results were entered another way, check the club site; nothing here needs finalizing.');
  }
  var sessionPlayers = rows_('SessionPlayers').filter(function (row) { return String(row.session_id) === sessionId; });
  var matches = rows_('Matches').filter(function (row) { return String(row.session_id) === sessionId; });
  validateCompleteRoundRobin_(sessionPlayers, matches);

  var players = indexBy_(rows_('Players'), 'player_id');
  // Ledger rows from an earlier run that did not finish. Each player is either still at rating_before or already
  // at rating_after; this run starts again from rating_before. Anything else means a rating moved since, and an
  // automatic repair could double-count, so it stops.
  var leftovers = rows_('RatingLedger').filter(function (row) { return String(row.session_id) === sessionId; });
  var restored = {};
  leftovers.forEach(function (row) {
    var playerId = String(row.player_id);
    var player = players[playerId];
    if (!player) throw new Error('Player no longer exists: ' + playerId);
    var current = Number(player.current_rating);
    if (current !== Number(row.rating_before) && current !== Number(row.rating_after)) {
      throw new Error('An earlier finalize of this session did not finish, and the rating of ' + player.display_name + ' has changed since (' + Number(row.rating_before) + ' before, ' + Number(row.rating_after) + ' after, ' + current + ' now). It cannot be repaired automatically: keep the paper sheets and ask the desk maintainer to fix the Players and RatingLedger sheets.');
    }
    restored[playerId] = Number(row.rating_before);
  });

  var starts = {};
  var adjustments = {};
  var startFixes = [];
  sessionPlayers.forEach(function (entry) {
    var playerId = String(entry.player_id);
    var player = players[playerId];
    if (!player) throw new Error('Player no longer exists: ' + playerId);
    var startingRating = Number(entry.starting_rating);
    if (restored[playerId] !== undefined) {
      // A save after the interrupted run took its new rating as the starting rating; put the real one back.
      if (startingRating !== restored[playerId]) startFixes.push({ row: entry.__row, from: startingRating, to: restored[playerId] });
      startingRating = restored[playerId];
    } else if (Number(player.current_rating) !== startingRating) {
      throw new Error(player.display_name + '\'s rating is ' + Number(player.current_rating) + ' now but was ' + startingRating + ' when this session was last saved (the club site sync or an edit in the Players sheet can change it). Click Save to Sheets to use the current rating, then finalize again.');
    }
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

  var now = new Date();
  var ledger = Object.keys(adjustments).map(function (playerId) {
    var before = starts[playerId];
    var after = projectedRating_(before, adjustments[playerId]);
    return {
      event_id: sessionId + ':' + playerId,
      session_id: sessionId,
      player_id: playerId,
      rating_before: before,
      adjustment: after - before,
      rating_after: after,
      rule_version: RATING_RULE_VERSION,
      created_at: now
    };
  });
  // Rating writes, each with the value to restore on a rollback. A player left out of the session after an
  // interrupted run goes back to their rating before it.
  var ratingWrites = ledger.map(function (row) { return { playerId: row.player_id, to: row.rating_after }; });
  Object.keys(restored).forEach(function (playerId) {
    if (adjustments[playerId] === undefined) ratingWrites.push({ playerId: playerId, to: restored[playerId] });
  });
  ratingWrites = ratingWrites.filter(function (write) {
    var player = players[write.playerId];
    write.row = player.__row;
    write.from = player.current_rating;
    write.fromUpdatedAt = player.updated_at;
    return Number(write.from) !== write.to;
  });

  safeAudit_('finalize_started', 'session', sessionId, { revision: Number(session.revision), players: ledger.length, repairing: leftovers.length });
  var step = 'rating ledger';
  var attempted = { ledger: false, starts: [], ratings: [], session: false };
  try {
    attempted.ledger = true;
    if (leftovers.length) replaceSessionRows_('RatingLedger', sessionId, ledger);
    else appendObjects_('RatingLedger', ledger);
    step = 'starting ratings';
    startFixes.forEach(function (fix) {
      attempted.starts.push(fix);
      updateRow_('SessionPlayers', fix.row, { starting_rating: fix.to });
    });
    step = 'player ratings';
    ratingWrites.forEach(function (write) {
      attempted.ratings.push(write);
      updateRow_('Players', write.row, { current_rating: write.to, updated_at: now });
    });
    flushSheets_();
    step = 'session status';
    attempted.session = true;
    writeSessionRow_(session, { status: 'finalized', revision: Number(session.revision) + 1, updated_at: now, finalized_at: now });
    flushSheets_();
  } catch (error) {
    throw rollBackFinalize_(error, step, attempted, session, sessionId, leftovers);
  }
  safeAudit_('session_finalized', 'session', sessionId, { revision: Number(session.revision) + 1, ratingEvents: ledger.length, repaired: leftovers.length });
  try { schedulePublish_(sessionId, sessionDate); } catch (error) { /* finalizing already succeeded; the workflow's scheduled run still publishes it */ }
  return getSession(sessionId);
}

// Puts back everything a failed finalize attempted and returns the error to show. Each step is tried on its own,
// but the ledger rows are removed only once every rating is back: rows left behind are what lets the next finalize
// repair a run instead of applying it twice.
function rollBackFinalize_(error, step, attempted, session, sessionId, leftovers) {
  var problems = [];
  function undo(label, work) {
    try {
      work();
      flushSheets_();
    } catch (undoError) {
      problems.push(label + ': ' + (undoError && undoError.message || String(undoError)));
    }
  }
  if (attempted.session) undo('session status', function () { writeSessionRow_(session, {}); });
  // A session row that may already say finalized keeps its ratings and ledger, or it would be finalized without them.
  // One that Google confirms is still open was never changed (it is written in one piece), so nothing is lost there.
  if (problems.length && !sessionMayBeFinalized_(sessionId)) problems = [];
  if (!problems.length) {
    undo('player ratings', function () {
      attempted.ratings.slice().reverse().forEach(function (write) {
        updateRow_('Players', write.row, { current_rating: write.from, updated_at: write.fromUpdatedAt });
      });
    });
    undo('starting ratings', function () {
      attempted.starts.forEach(function (fix) { updateRow_('SessionPlayers', fix.row, { starting_rating: fix.from }); });
    });
    var ratingsBack = !problems.some(function (problem) { return /^player ratings/.test(problem); });
    if (attempted.ledger && ratingsBack) undo('rating ledger', function () { replaceSessionRows_('RatingLedger', sessionId, leftovers); });
  } else {
    problems.push('kept the ratings and ledger because the session may already be finalized');
  }
  var reason = error && error.message || String(error);
  var rollbackError = problems.join('; ');
  var keptFinalized = /may already be finalized/.test(rollbackError);
  var wrapped = new Error(keptFinalized
    ? 'Google Sheets stopped at the last step of finalizing (' + reason + ') and could not confirm the result. Reload the page: if the session shows the lock, it is finalized; if not, click Finalize RR Results again.'
    : rollbackError
    ? 'Google Sheets stopped partway through finalizing (' + reason + '), and some changes could not be undone. Keep the paper sheets, reload the page, and click Finalize RR Results again: the next attempt repairs this one.'
    : 'Google Sheets stopped partway through finalizing (' + reason + '). Nothing was changed and the session is still open. Click Finalize RR Results to try again.');
  wrapped.details = { step: step, error: reason, rolledBack: !rollbackError, rollbackError: rollbackError };
  return wrapped;
}

// After a failed write to the Sessions row: true unless Google confirms the row still shows the session open.
function sessionMayBeFinalized_(sessionId) {
  try {
    var row = findRow_('Sessions', 'session_id', sessionId);
    return !row || String(row.status) === 'finalized';
  } catch (error) {
    return true;
  }
}

// The whole Sessions row in one write, so the status and revision can never be half updated.
function writeSessionRow_(session, changes) {
  var headers = TABLES.Sessions;
  var values = headers.map(function (header) { return changes[header] !== undefined ? changes[header] : session[header]; });
  SpreadsheetApp.getActive().getSheetByName('Sessions').getRange(session.__row, 1, 1, headers.length).setValues([values]);
}

// Google batches sheet writes; flushing inside a try block makes a failed write fail there.
function flushSheets_() {
  SpreadsheetApp.flush();
}

var DESK_BUSY_MESSAGE = 'The desk is still finishing another change (from this or another device). Wait a few seconds, then try again.';
var CHANGED_ELSEWHERE_MESSAGE = 'This session was changed on another device or tab after this page loaded it. Reload the page, check the scores, and try again.';

function withDeskLock_(work) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(30000); } catch (error) { throw new Error(DESK_BUSY_MESSAGE); }
  try {
    return work();
  } finally {
    lock.releaseLock();
  }
}

// Runs a desk action and, if it fails, records why in the AuditLog sheet. The error shown to the desk ends with a
// reference: the start of that row's event_id, so the exact cause can be found later.
function loggedDeskAction_(action, sessionId, work) {
  try {
    return work();
  } catch (error) {
    var message = error && error.message || String(error);
    var eventId = safeAudit_(action + '_failed', 'session', sessionId, Object.assign({ message: message }, error && error.details || {}));
    throw new Error(message + (eventId ? ' (Reference ' + referenceCode_(eventId) + ')' : ''));
  }
}

// Logging must never turn a success into a failure, or hide the original error.
function safeAudit_(action, entityType, entityId, details) {
  try { return appendAudit_(action, entityType, entityId, details) || ''; } catch (error) { return ''; }
}

function referenceCode_(eventId) {
  return String(eventId || '').replace(/-/g, '').slice(0, 8).toUpperCase();
}

var PUBLIC_SESSIONS_URL = 'https://concordtabletennisclub.com/data/sessions.json';

// A session the site already lists cannot be reopened: the site refuses to change a published session.
function sessionOnSite_(sessionDate) {
  var response = UrlFetchApp.fetch(PUBLIC_SESSIONS_URL + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) throw new Error('Could not check whether the club site already lists this session (HTTP ' + response.getResponseCode() + '). Try again.');
  return JSON.parse(response.getContentText()).some(function (entry) { return String(entry.date) === sessionDate; });
}

// Reopens the most recent finalized session: restores each player's rating from the ledger, makes the session
// editable again, and removes the ledger rows. It must be finalized again after the correction. If Google stops
// before the session is open, the ratings are put back; if that fails too, clicking the lock again finishes the job
// (a player already at rating_before is left as is). Ledger rows left behind by an open session are repaired by the
// next finalize.
function reopenSession(sessionId, expectedRevision) {
  sessionId = String(sessionId);
  return loggedDeskAction_('reopen', sessionId, function () {
    return withDeskLock_(function () { return reopenLocked_(sessionId, expectedRevision); });
  });
}

function reopenLocked_(sessionId, expectedRevision) {
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (!session) throw new Error('Session not found: ' + sessionId);
  if (String(session.status) !== 'finalized') {
    // The same reopen again, after its reply was lost on the way back: report what it did.
    if (Number(session.revision) === Number(expectedRevision) + 1) return getSession(sessionId);
    throw new Error('Only a finalized session can be reopened. Reload the page to see its current state.');
  }
  if (Number(session.revision) !== Number(expectedRevision)) throw new Error(CHANGED_ELSEWHERE_MESSAGE);
  var sessionDate = displayDate_(session.session_date);
  var later = rows_('Sessions').filter(function (row) { return String(row.status) === 'finalized' && displayDate_(row.session_date) > sessionDate; });
  if (later.length) throw new Error('The ' + displayDate_(later[0].session_date) + ' session is already finalized. Reopen the most recent session first.');
  if (sessionOnSite_(sessionDate)) throw new Error('The club site already lists this session, so it can no longer be reopened here. Corrections after publication need a separate fix.');

  var ledger = rows_('RatingLedger').filter(function (row) { return String(row.session_id) === sessionId; });
  var players = indexBy_(rows_('Players'), 'player_id');
  ledger.forEach(function (row) {
    var player = players[String(row.player_id)];
    if (!player) throw new Error('Player no longer exists: ' + row.player_id);
    var current = Number(player.current_rating);
    if (current !== Number(row.rating_after) && current !== Number(row.rating_before)) {
      throw new Error('The rating of ' + player.display_name + ' changed after this session was finalized (' + Number(row.rating_after) + ' then, ' + current + ' now), so it cannot be reversed safely. Ask the desk maintainer to check the Players sheet.');
    }
  });

  var now = new Date();
  var restores = [];
  var step = 'player ratings';
  try {
    ledger.forEach(function (row) {
      var player = players[String(row.player_id)];
      if (Number(player.current_rating) === Number(row.rating_before)) return;
      restores.push({ row: player.__row, from: player.current_rating, fromUpdatedAt: player.updated_at });
      updateRow_('Players', player.__row, { current_rating: Number(row.rating_before), updated_at: now });
    });
    flushSheets_();
    step = 'session status';
    writeSessionRow_(session, { status: 'active', revision: Number(session.revision) + 1, updated_at: now, finalized_at: '' });
    flushSheets_();
  } catch (error) {
    // A session that may still be finalized (and so may still publish) gets its ratings back.
    var undone = false;
    if (sessionMayBeFinalized_(sessionId)) {
      try {
        restores.forEach(function (restore) { updateRow_('Players', restore.row, { current_rating: restore.from, updated_at: restore.fromUpdatedAt }); });
        flushSheets_();
        undone = true;
      } catch (undoError) { /* clicking the lock again finishes the reopen from where it stopped */ }
    }
    var reason = error && error.message || String(error);
    var wrapped = new Error(undone
      ? 'Google Sheets stopped while reopening (' + reason + '), so the ratings were put back. Reload the page and click the lock to try again.'
      : 'Google Sheets stopped partway through reopening (' + reason + '). Reload the page; if the session still shows the lock, click it again to finish reopening.');
    wrapped.details = { step: step, error: reason, ratingsPutBack: undone };
    throw wrapped;
  }
  try { cancelPublish_(sessionId); } catch (error) { /* nothing else publishes a session that is open */ }
  try {
    replaceSessionRows_('RatingLedger', sessionId, []);
    flushSheets_();
  } catch (error) {
    // The session is open again; the next finalize repairs from these rows.
    safeAudit_('reopen_ledger_cleanup_failed', 'session', sessionId, { message: error && error.message || String(error) });
  }
  safeAudit_('session_reopened', 'session', sessionId, {
    revision: Number(session.revision) + 1,
    reversed: ledger.map(function (row) { return [String(row.player_id), Number(row.rating_after), Number(row.rating_before)]; })
  });
  return getSession(sessionId);
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
  if (String(session.status) === 'finalized') throw new Error('This session is already finalized, so it cannot be changed. Reload the page to see it; the lock button reopens it if a correction is needed.');
  if (Number(session.revision) !== Number(expectedRevision)) throw new Error(CHANGED_ELSEWHERE_MESSAGE);
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
  // One write that also blanks the rows the table no longer needs: if Google stops, the table is either as before
  // or as intended, never cleared and never holding a moved row twice.
  var oldCount = Math.max(0, sheet.getLastRow() - 1);
  while (combined.length < oldCount) combined.push(headers.map(function () { return ''; }));
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

