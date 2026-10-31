// The Equalizer at the desk (plan: GitHub issue #104). An Equalizer is a session like a round robin, with the id
// session-YYYY-MM-DD-equalizer (SessionIds.js): its roster is in SessionPlayers, the organizer's choices and the saved
// draw are one Brackets row, and each result is one BracketMatches row. Everything else (teams, groups, the bracket,
// head starts, places) is worked out from the draw and the results by the shared rules in EqualizerRules.js (generated
// from the repository's equalizer.js and friends by npm run sync:desk), the same code the desk page and the site run.
//
// The page saves through its outbox (Index.html): the setup, each result and a switch between round robin and
// Equalizer are small calls that are safe to send again. Two devices entering different results never clash; the same
// result entered two ways is refused for the second device, which then shows Google's.

var EQUALIZER_TABLES = ['Brackets', 'BracketMatches'];
var EQUALIZER_STARTED_MESSAGE = 'The Equalizer has started (a result is in), so its players and draw are fixed. Reload the page to see them.';
var EQUALIZER_RESULT_CHANGED_MESSAGE = 'This result was changed on another device or tab. The desk now shows the result Google has.';
var EQUALIZER_FINALIZED_MESSAGE = 'This Equalizer is finalized, so it cannot be changed. The lock reopens it if a correction is needed.';

function equalizerRules_() {
  return globalThis.CTTCEqualizer;
}

// The two tabs are made the first time an Equalizer is saved (a read never writes).
function ensureEqualizerTables_() {
  var book = SpreadsheetApp.getActive();
  EQUALIZER_TABLES.forEach(function (name) {
    var sheet = book.getSheetByName(name);
    if (sheet) return;
    sheet = book.insertSheet(name);
    ensureHeader_(sheet, TABLES[name]);
    formatTable_(sheet, TABLES[name].length);
  });
}

function equalizerTablesExist_() {
  var book = SpreadsheetApp.getActive();
  return EQUALIZER_TABLES.every(function (name) { return !!book.getSheetByName(name); });
}

function parseDraw_(value) {
  if (!value) return null;
  try { return JSON.parse(String(value)); } catch (error) { throw new Error('The saved Equalizer draw cannot be read. Ask the desk maintainer to check the Brackets tab.'); }
}

// A result as the page keeps it, from its BracketMatches row.
function resultFromRow_(row) {
  var one = String(row.side_one_id);
  var two = String(row.side_two_id);
  var by = String(row.forfeited_by || '');
  var games = [row.side_one_games === '' ? null : Number(row.side_one_games), row.side_two_games === '' ? null : Number(row.side_two_games)];
  var winnerId = by ? (by === one ? two : one) : games[0] > games[1] ? one : two;
  var result = { winnerId: winnerId, games: games };
  if (row.won_by) result.wonBy = String(row.won_by);
  if (by) result.forfeitedBy = by;
  if (row.head_start_side_id) result.headStart = { sideId: String(row.head_start_side_id), points: Number(row.head_start_points) || 0 };
  return result;
}

function sameResult_(left, right) {
  var plain = function (result) {
    if (!result) return '';
    return [result.winnerId, (result.games || []).join('-'), result.wonBy || '', result.forfeitedBy || ''].join('|');
  };
  return plain(left) === plain(right);
}

// Every finalized Equalizer match before this one, oldest first, for the head-start memory (handicap.js pairState):
// each with the two sides' ratings at that event's draw.
function equalizerHistory_(sessions, brackets, matchRows, exceptSessionId) {
  var E = equalizerRules_();
  var finalized = sessions.filter(function (row) {
    return isEqualizerSessionId_(row.session_id) && String(row.status) === 'finalized' && String(row.session_id) !== exceptSessionId;
  }).sort(function (a, b) { return displayDate_(a.session_date) < displayDate_(b.session_date) ? -1 : displayDate_(a.session_date) > displayDate_(b.session_date) ? 1 : 0; });
  var history = [];
  finalized.forEach(function (session) {
    var id = String(session.session_id);
    var bracket = brackets.find(function (row) { return String(row.session_id) === id; });
    var draw = bracket && parseDraw_(bracket.draw_json);
    if (!draw) return;
    var sideRatings = E.fromSnapshot(draw).sideRatings;
    matchRows.filter(function (row) { return String(row.session_id) === id; })
      .sort(function (a, b) { return new Date(a.finished_at || a.updated_at) - new Date(b.finished_at || b.updated_at); })
      .forEach(function (row, index) {
        var result = resultFromRow_(row);
        var ratings = {};
        ratings[String(row.side_one_id)] = sideRatings[String(row.side_one_id)];
        ratings[String(row.side_two_id)] = sideRatings[String(row.side_two_id)];
        history.push({ at: displayDate_(session.session_date) + '#' + ('000' + index).slice(-4), playerOneId: String(row.side_one_id), playerTwoId: String(row.side_two_id), winnerId: result.winnerId, forfeit: !!result.forfeitedBy, ratings: ratings });
      });
  });
  return history;
}

// What the page needs for one date's Equalizer: the session, roster, the organizer's choices and draw, the results,
// and the memory of earlier Equalizers.
function equalizerState_(sessionDate) {
  var empty = { sessionId: equalizerSessionId_(sessionDate), session: null, roster: [], setup: null, results: {}, history: [] };
  if (!equalizerTablesExist_()) return empty;
  var sessionId = empty.sessionId;
  var sessions = rows_('Sessions');
  var brackets = rows_('Brackets');
  var matchRows = rows_('BracketMatches');
  var session = sessions.find(function (row) { return String(row.session_id) === sessionId; });
  var state = Object.assign({}, empty, { history: equalizerHistory_(sessions, brackets, matchRows, sessionId) });
  if (!session) return state;
  state.session = { sessionId: sessionId, status: String(session.status), revision: Number(session.revision) };
  state.roster = rows_('SessionPlayers').filter(function (row) { return String(row.session_id) === sessionId; }).map(function (row) { return String(row.player_id); });
  var bracket = brackets.find(function (row) { return String(row.session_id) === sessionId; });
  if (bracket) {
    state.setup = {
      format: String(bracket.format || 'groups'),
      play: String(bracket.play || 'singles'),
      bestOf: Number(bracket.best_of) === 5 ? 5 : 3,
      oddPlayer: String(bracket.odd_player || ''),
      sitOutId: String(bracket.sit_out_id || ''),
      draw: parseDraw_(bracket.draw_json)
    };
  }
  matchRows.filter(function (row) { return String(row.session_id) === sessionId; }).forEach(function (row) {
    state.results[String(row.match_id)] = resultFromRow_(row);
  });
  return state;
}

function getEqualizerState(sessionDate) {
  validateSessionDate_(sessionDate);
  return equalizerState_(sessionDate);
}

function equalizerSessionRow_(sessionId, sessionDate) {
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (session) return session;
  var now = new Date();
  appendObjects_('Sessions', [{ session_id: sessionId, session_date: sessionDate, status: 'draft', revision: 1, created_at: now, updated_at: now, finalized_at: '' }]);
  appendAudit_('session_created', 'session', sessionId, { date: sessionDate, variant: 'equalizer' });
  return findRow_('Sessions', 'session_id', sessionId);
}

function bumpSession_(session, status) {
  var changes = { revision: Number(session.revision) + 1, updated_at: new Date() };
  if (status) changes.status = status;
  writeSessionRow_(session, changes);
  return Object.assign({}, session, changes);
}

function equalizerResultsFor_(sessionId) {
  var results = {};
  rows_('BracketMatches').filter(function (row) { return String(row.session_id) === sessionId; }).forEach(function (row) {
    results[String(row.match_id)] = resultFromRow_(row);
  });
  return results;
}

function writeEqualizerRoster_(sessionId, roster, draw) {
  var players = indexBy_(rows_('Players'), 'player_id');
  var groupOf = {};
  if (draw && draw.format === 'groups') {
    draw.groups.forEach(function (sides, index) {
      sides.forEach(function (sideId) { String(sideId).split('+').forEach(function (id) { groupOf[id] = index + 1; }); });
    });
  }
  replaceSessionRows_('SessionPlayers', sessionId, roster.map(function (playerId) {
    var player = players[playerId];
    if (!player || !asBoolean_(player.active)) throw new Error('Unknown or inactive player: ' + playerId);
    var rating = draw && draw.ratings[playerId] !== undefined ? Number(draw.ratings[playerId]) : Number(player.current_rating);
    return { session_id: sessionId, player_id: playerId, group_number: groupOf[playerId] || 1, starting_rating: rating, promotion_from_group: '' };
  }));
}

function writeBracketRow_(sessionId, setup, draw) {
  var row = {
    session_id: sessionId,
    rule_version: globalThis.CTTCHandicap.RULE_VERSION,
    format: setup.format === 'double' ? 'double' : 'groups',
    play: setup.play === 'doubles' ? 'doubles' : 'singles',
    best_of: Number(setup.bestOf) === 5 ? 5 : 3,
    odd_player: setup.oddPlayer === 'team-of-three' || setup.oddPlayer === 'sit-out' ? setup.oddPlayer : '',
    sit_out_id: setup.sitOutId ? String(setup.sitOutId) : '',
    draw_json: draw ? JSON.stringify(draw) : '',
    drawn_at: draw ? new Date() : '',
    updated_at: new Date()
  };
  replaceSessionRows_('Brackets', sessionId, [row]);
}

// The organizer's choices, the roster and the draw (null until there are enough players). Refused once a result is in,
// unless nothing changed (a resend after a lost reply).
function saveEqualizerSetup(sessionDate, setup) {
  validateSessionDate_(sessionDate);
  if (!setup || !Array.isArray(setup.roster)) throw new Error('The Equalizer setup is missing its roster.');
  var sessionId = equalizerSessionId_(sessionDate);
  return loggedDeskAction_('equalizer_save', sessionId, function () {
    return withDeskLock_(function () {
      ensureEqualizerTables_();
      var roster = setup.roster.map(String);
      if (new Set(roster).size !== roster.length) throw new Error('A player is on the Equalizer roster twice.');
      var draw = setup.draw || null;
      if (draw) {
        var event = equalizerRules_().fromSnapshot(draw);
        var drawn = Object.keys(draw.ratings).sort();
        if (drawn.join('|') !== roster.slice().sort().join('|')) throw new Error('The Equalizer draw does not match its players. Reload the page and draw again.');
        if (event.sitOut.some(function (id) { return roster.indexOf(id) < 0; })) throw new Error('The player sitting out is not on the roster.');
      }
      var session = equalizerSessionRow_(sessionId, sessionDate);
      if (String(session.status) === 'finalized') throw new Error(EQUALIZER_FINALIZED_MESSAGE);
      var bracket = findRow_('Brackets', 'session_id', sessionId);
      var started = rows_('BracketMatches').some(function (row) { return String(row.session_id) === sessionId; });
      if (started) {
        if (bracket && String(bracket.draw_json) === (draw ? JSON.stringify(draw) : '')) return equalizerSaved_(session);
        throw new Error(EQUALIZER_STARTED_MESSAGE);
      }
      writeEqualizerRoster_(sessionId, roster, draw);
      writeBracketRow_(sessionId, setup, draw);
      session = bumpSession_(session, roster.length ? 'active' : String(session.status));
      appendAudit_('session_saved', 'session', sessionId, { variant: 'equalizer', revision: Number(session.revision), players: roster.length, format: setup.format, play: setup.play, bestOf: Number(setup.bestOf) === 5 ? 5 : 3, drawn: !!draw });
      return equalizerSaved_(session);
    });
  });
}

function equalizerSaved_(session) {
  return { sessionId: String(session.session_id), status: String(session.status), revision: Number(session.revision) };
}

// One result (or null to clear it). base is the result this page last saw for the match: if Google holds something else
// by now (another device), the change is refused rather than overwriting it. Sending the same result again is fine.
function saveEqualizerResult(sessionDate, matchId, result, base) {
  validateSessionDate_(sessionDate);
  var sessionId = equalizerSessionId_(sessionDate);
  matchId = String(matchId || '');
  return loggedDeskAction_('equalizer_result', sessionId, function () {
    return withDeskLock_(function () {
      ensureEqualizerTables_();
      var session = findRow_('Sessions', 'session_id', sessionId);
      if (!session) throw new Error('There is no Equalizer for ' + sessionDate + '. Reload the page.');
      if (String(session.status) === 'finalized') throw new Error(EQUALIZER_FINALIZED_MESSAGE);
      var bracket = findRow_('Brackets', 'session_id', sessionId);
      var draw = bracket && parseDraw_(bracket.draw_json);
      if (!draw) throw new Error('The Equalizer has not been drawn yet. Reload the page.');
      var E = equalizerRules_();
      var event = E.fromSnapshot(draw);
      var results = equalizerResultsFor_(sessionId);
      var current = results[matchId] || null;
      if (sameResult_(current, result)) return equalizerSaved_(session);
      if (!sameResult_(current, base)) throw new Error(EQUALIZER_RESULT_CHANGED_MESSAGE);
      var others = Object.assign({}, results);
      delete others[matchId];
      var view = E.resolve(event, others);
      // A change (or clearing) is refused while a later match that depends on this one has a result.
      var changed = Object.assign({}, others);
      if (result) changed[matchId] = result;
      var after = E.resolve(event, changed);
      var blocked = Object.keys(others).filter(function (id) {
        return !after.byId[id] || after.byId[id].status !== 'done' || after.byId[id].players.join('|') !== view.byId[id].players.join('|');
      });
      if (blocked.length) throw new Error('Match ' + blocked[0] + ' already has a result that depends on this one. Clear that one first.');
      if (result) {
        var match = view.byId[matchId];
        if (!match || match.status !== 'ready') throw new Error('Match ' + matchId + ' is not ready to play yet. Reload the page.');
        var problem = E.scoreProblem(match, result);
        if (problem) throw new Error(problem);
        var headStart = result.headStart && match.players.indexOf(String(result.headStart.sideId)) >= 0 ? result.headStart : null;
        var side = match.players.indexOf(String(result.winnerId));
        var now = new Date();
        var rows = rows_('BracketMatches').filter(function (row) { return String(row.session_id) === sessionId && String(row.match_id) !== matchId; });
        rows.push({
          match_id: matchId,
          session_id: sessionId,
          stage: match.bracket,
          side_one_id: match.players[0],
          side_two_id: match.players[1],
          head_start_side_id: headStart ? String(headStart.sideId) : '',
          head_start_points: headStart ? Math.max(0, Math.min(8, Number(headStart.points) || 0)) : '',
          best_of: match.bestOf,
          side_one_games: result.forfeitedBy ? '' : Number(result.games[0]),
          side_two_games: result.forfeitedBy ? '' : Number(result.games[1]),
          won_by: result.wonBy && side >= 0 ? String(result.wonBy) : '',
          forfeited_by: result.forfeitedBy ? String(result.forfeitedBy) : '',
          table_number: '',
          called_at: '',
          finished_at: now,
          updated_at: now
        });
        replaceSessionRows_('BracketMatches', sessionId, rows);
      } else {
        replaceSessionRows_('BracketMatches', sessionId, rows_('BracketMatches').filter(function (row) { return String(row.session_id) === sessionId && String(row.match_id) !== matchId; }));
      }
      session = bumpSession_(session, 'active');
      appendAudit_('session_saved', 'session', sessionId, { variant: 'equalizer', revision: Number(session.revision), match: matchId, cleared: !result });
      return equalizerSaved_(session);
    });
  });
}

// Moves the day's roster between the round robin and the Equalizer while the one it leaves has no results: the
// organizer changed their mind about the day's event. The one left keeps its row (and the Equalizer its choices) but
// no players.
function switchDayEvent(sessionDate, to, roster) {
  validateSessionDate_(sessionDate);
  if (to !== 'equalizer' && to !== 'rr') throw new Error('Unknown event: ' + to);
  var rrId = 'session-' + sessionDate;
  var eqId = equalizerSessionId_(sessionDate);
  return loggedDeskAction_('event_switch', to === 'equalizer' ? eqId : rrId, function () {
    return withDeskLock_(function () {
      ensureEqualizerTables_();
      roster = (roster || []).map(String);
      var rr = findRow_('Sessions', 'session_id', rrId);
      var eq = findRow_('Sessions', 'session_id', eqId);
      if (to === 'equalizer') {
        if (rr) {
          if (String(rr.status) === 'finalized') throw new Error('The round robin for ' + sessionDate + ' is finalized, so its players stay there. Its lock reopens it if needed.');
          var scored = rows_('Matches').some(function (row) { return String(row.session_id) === rrId && (row.player_one_games !== '' || row.player_two_games !== '' || String(row.forfeited_by || '')); });
          if (scored) throw new Error('The round robin for ' + sessionDate + ' already has results, so its players stay there.');
          replaceSessionRows_('SessionPlayers', rrId, []);
          replaceSessionRows_('Matches', rrId, []);
          rr = bumpSession_(rr, 'draft');
        }
        var session = equalizerSessionRow_(eqId, sessionDate);
        if (String(session.status) === 'finalized') throw new Error(EQUALIZER_FINALIZED_MESSAGE);
        if (rows_('BracketMatches').some(function (row) { return String(row.session_id) === eqId; })) throw new Error(EQUALIZER_STARTED_MESSAGE);
        writeEqualizerRoster_(eqId, roster, null);
        if (!findRow_('Brackets', 'session_id', eqId)) writeBracketRow_(eqId, equalizerRules_().DEFAULT_SETUP, null);
        bumpSession_(session, roster.length ? 'active' : 'draft');
      } else if (eq) {
        if (String(eq.status) === 'finalized') throw new Error(EQUALIZER_FINALIZED_MESSAGE);
        if (rows_('BracketMatches').some(function (row) { return String(row.session_id) === eqId; })) throw new Error(EQUALIZER_STARTED_MESSAGE);
        replaceSessionRows_('SessionPlayers', eqId, []);
        var bracket = findRow_('Brackets', 'session_id', eqId);
        if (bracket) updateRow_('Brackets', bracket.__row, { draw_json: '', drawn_at: '', updated_at: new Date() });
        bumpSession_(eq, 'draft');
      }
      appendAudit_('event_switched', 'session', to === 'equalizer' ? eqId : rrId, { to: to, players: roster.length });
      return { rrSession: findRow_('Sessions', 'session_id', rrId) ? getSession(rrId) : null, equalizer: equalizerState_(sessionDate) };
    });
  });
}

// Finalizing: every player (both partners, or all three of a team of three) gains or gives the points of each match on
// top of the rating they have now, through the same ledger, rating writes and rollback as round robins
// (commitFinalize_). On a day with a round robin as well, the round robin is finalized first.
function finalizeEqualizer(sessionDate, expectedRevision) {
  validateSessionDate_(sessionDate);
  var sessionId = equalizerSessionId_(sessionDate);
  return loggedDeskAction_('finalize', sessionId, function () {
    return withDeskLock_(function () { return finalizeEqualizerLocked_(sessionDate, sessionId, expectedRevision); });
  });
}

function finalizeEqualizerLocked_(sessionDate, sessionId, expectedRevision) {
  var session = findRow_('Sessions', 'session_id', sessionId);
  if (!session) throw new Error('There is no Equalizer for ' + sessionDate + '.');
  if (String(session.status) === 'finalized') {
    if (Number(session.revision) === Number(expectedRevision) + 1) return equalizerState_(sessionDate);
    throw new Error('This Equalizer is already finalized. Reload the page to see it; the lock button reopens it if a correction is needed.');
  }
  if (Number(session.revision) !== Number(expectedRevision)) throw new Error(CHANGED_ELSEWHERE_MESSAGE);
  var syncedThrough = ratingsSyncedThrough_();
  if (syncedThrough && sessionDate <= syncedThrough) {
    throw new Error('The club site already has results through ' + syncedThrough + ', so finalizing ' + sessionDate + ' here would count those matches twice.');
  }
  var rr = findRow_('Sessions', 'session_id', 'session-' + sessionDate);
  if (rr && String(rr.status) !== 'finalized' && rows_('SessionPlayers').some(function (row) { return String(row.session_id) === String(rr.session_id); })) {
    throw new Error('The round robin for ' + sessionDate + ' is still open. Finalize it first: events on one day are finalized in the order they started.');
  }
  var bracket = findRow_('Brackets', 'session_id', sessionId);
  var draw = bracket && parseDraw_(bracket.draw_json);
  if (!draw) throw new Error('The Equalizer has not been drawn yet.');
  var E = equalizerRules_();
  var event = E.fromSnapshot(draw);
  var results = equalizerResultsFor_(sessionId);
  var view = E.resolve(event, results);
  if (!view.finished) {
    var left = view.matches.filter(function (m) { return m.status === 'ready' || m.status === 'waiting'; }).length;
    throw new Error('The Equalizer is not finished: ' + left + ' match' + (left === 1 ? '' : 'es') + ' still to play.');
  }
  view.matches.forEach(function (m) {
    if (m.status !== 'done') return;
    var problem = E.scoreProblem(m, m.result);
    if (problem) throw new Error('Match ' + m.id + ': ' + problem);
  });

  var players = indexBy_(rows_('Players'), 'player_id');
  var earlier = finalizeLeftovers_(sessionId, players);
  var outcome = E.playerResults(event, view);
  var adjustments = {};
  var now = new Date();
  var ledger = Object.keys(outcome).map(function (playerId) {
    var player = players[playerId];
    if (!player) throw new Error('Player no longer exists: ' + playerId);
    var before = earlier.restored[playerId] !== undefined ? earlier.restored[playerId] : Number(player.current_rating);
    var after = projectedRating_(before, outcome[playerId].raw);
    adjustments[playerId] = outcome[playerId].raw;
    return {
      event_id: sessionId + ':' + playerId,
      session_id: sessionId,
      player_id: playerId,
      rating_before: before,
      adjustment: after - before,
      rating_after: after,
      rule_version: event.ruleVersion,
      created_at: now
    };
  });
  commitFinalize_(session, sessionId, sessionDate, ledger, finalizeRatingWrites_(ledger, earlier.restored, adjustments, players), [], earlier.leftovers, now);
  return equalizerState_(sessionDate);
}

function reopenEqualizer(sessionDate, expectedRevision) {
  validateSessionDate_(sessionDate);
  reopenSession(equalizerSessionId_(sessionDate), expectedRevision);
  return equalizerState_(sessionDate);
}
