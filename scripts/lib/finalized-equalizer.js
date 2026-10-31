'use strict';

// A finalized Equalizer (session-YYYY-MM-DD-equalizer) as published data, checked the way round robins are: the event
// is rebuilt from its saved draw and results with the same rules the desk ran (equalizer.js), and every rating change
// in the ledger must match the matches. Each player appears in one stand-in group, "Equalizer", in the shape round
// robin players have, so the rating history and leaderboard (buildPlayers) work unchanged; the equalizer block holds
// the event itself (format, teams, matches with head starts, places) for the pages that show it.

const E = require('../../equalizer');
const H = require('../../handicap');
const ratings = require('../../rating-engine');

function integer(value, label) {
  if (value === '' || value === null || value === undefined || !Number.isInteger(Number(value))) {
    throw new Error('Invalid ' + label + ': ' + value);
  }
  return Number(value);
}

function resultFromRow(row) {
  const one = String(row.side_one_id);
  const two = String(row.side_two_id);
  const by = String(row.forfeited_by || '');
  const games = [row.side_one_games === '' ? null : Number(row.side_one_games), row.side_two_games === '' ? null : Number(row.side_two_games)];
  const result = { winnerId: by ? (by === one ? two : one) : games[0] > games[1] ? one : two, games };
  if (row.won_by) result.wonBy = String(row.won_by);
  if (by) result.forfeitedBy = by;
  if (row.head_start_side_id) result.headStart = { sideId: String(row.head_start_side_id), points: integer(row.head_start_points, 'head start') };
  return result;
}

function projectFinalizedEqualizer(session, bracketRow, matchRows, ledger, directory) {
  const sessionId = String(session.session_id);
  const date = String(session.session_date);
  if (session.status !== 'finalized') throw new Error('Equalizer is not finalized: ' + sessionId);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || sessionId !== 'session-' + date + '-equalizer' || !session.finalized_at) {
    throw new Error('Missing finalized Equalizer identity or timestamp: ' + sessionId);
  }
  if (!bracketRow || !bracketRow.draw_json) throw new Error('Equalizer has no saved draw: ' + sessionId);
  const draw = JSON.parse(String(bracketRow.draw_json));
  const event = E.fromSnapshot(draw);
  const names = new Map(directory.map(function (player) { return [String(player.player_id), String(player.display_name)]; }));
  const nameOf = function (id) {
    if (!names.has(id)) throw new Error('Unknown Equalizer player: ' + id);
    return names.get(id);
  };
  const results = {};
  matchRows.forEach(function (row) {
    if (String(row.session_id) !== sessionId) throw new Error('Equalizer match from another session: ' + row.match_id);
    if (results[row.match_id]) throw new Error('Duplicate Equalizer match: ' + row.match_id);
    results[String(row.match_id)] = resultFromRow(row);
  });
  const view = E.resolve(event, results);
  if (!view.finished) throw new Error('Equalizer is not finished: ' + sessionId);
  Object.keys(results).forEach(function (id) {
    const match = view.byId[id];
    if (!match || match.status !== 'done') throw new Error('Equalizer result for a match that was not played: ' + id);
    const problem = E.scoreProblem(match, results[id]);
    if (problem) throw new Error('Equalizer match ' + id + ': ' + problem);
  });

  const outcome = E.playerResults(event, view);
  const ledgerById = new Map();
  ledger.forEach(function (row) {
    const id = String(row.player_id);
    if (String(row.session_id) !== sessionId || !outcome[id] || ledgerById.has(id)) throw new Error('Invalid or duplicate Equalizer ledger row: ' + id);
    ledgerById.set(id, row);
  });
  if (ledgerById.size !== Object.keys(outcome).length) throw new Error('Incomplete Equalizer rating ledger: ' + sessionId);

  const sideNames = function (sideId) { return event.sideById[sideId].members.map(nameOf); };
  const played = view.matches.filter(function (m) { return m.status === 'done'; });
  const players = Object.keys(outcome).map(function (id) {
    const row = ledgerById.get(id);
    const before = integer(row.rating_before, 'ledger starting rating');
    const after = ratings.project(before, outcome[id].raw);
    if (integer(row.adjustment, 'ledger adjustment') !== after - before || integer(row.rating_after, 'ledger final rating') !== after ||
        String(row.rule_version) !== H.RULE_VERSION) {
      throw new Error('Equalizer rating ledger disagrees with match scores for ' + id);
    }
    const sideId = outcome[id].sideId;
    let gamesWon = 0;
    let gamesLost = 0;
    const matches = played.filter(function (m) { return m.players.indexOf(sideId) >= 0; }).map(function (m) {
      const mine = m.players.indexOf(sideId);
      const result = m.result;
      const forfeit = !!result.forfeitedBy;
      const won = result.winnerId === sideId;
      const myGames = forfeit ? 0 : Number(result.games[mine]);
      const theirGames = forfeit ? 0 : Number(result.games[1 - mine]);
      gamesWon += myGames;
      gamesLost += theirGames;
      const points = H.exchange(forfeit);
      const opponents = sideNames(m.players[1 - mine]);
      const entry = { opponent: opponents.join(' & '), opponents, gamesWon: myGames, gamesLost: theirGames, adj: won ? points : -points, forfeit, equalizer: true, stage: m.bracket };
      const partners = event.sideById[sideId].members.filter(function (member) { return member !== id; }).map(nameOf);
      if (partners.length) entry.partners = partners;
      if (result.headStart) entry.headStart = { mine: result.headStart.sideId === sideId, points: result.headStart.points };
      return entry;
    });
    const place = view.places[sideId] || (view.champion === sideId ? { place: 1, to: 1 } : null);
    return {
      name: nameOf(id),
      wins: outcome[id].wins,
      losses: outcome[id].losses,
      gamesWon,
      gamesLost,
      ratingBefore: before,
      ratingAfter: after,
      ratingAdj: after - before,
      place: place ? { place: place.place, to: place.to } : null,
      matches,
      matchesUnavailable: false
    };
  }).sort(function (a, b) {
    return (a.place ? a.place.place : 999) - (b.place ? b.place.place : 999) || b.ratingBefore - a.ratingBefore || a.name.localeCompare(b.name);
  });

  return {
    date,
    sessionId,
    source: 'app',
    variant: 'equalizer',
    revision: integer(session.revision, 'revision'),
    finalizedAt: String(session.finalized_at),
    equalizer: {
      format: event.format,
      play: event.play,
      bestOf: event.bestOf,
      ruleVersion: event.ruleVersion,
      sides: event.sides.map(function (side) { return { names: side.members.map(nameOf), rating: side.rating, place: view.places[side.id] ? { place: view.places[side.id].place, to: view.places[side.id].to } : null }; }),
      sitOut: event.sitOut.map(nameOf),
      champion: sideNames(view.champion),
      matches: played.map(function (m) {
        const result = m.result;
        return {
          id: m.id,
          stage: m.bracket,
          sides: m.players.map(sideNames),
          winner: m.players.indexOf(result.winnerId),
          games: result.forfeitedBy ? null : result.games.map(Number),
          wonBy: !!result.wonBy,
          forfeit: !!result.forfeitedBy,
          headStart: result.headStart ? { side: m.players.indexOf(result.headStart.sideId), points: result.headStart.points } : null
        };
      })
    },
    groups: [{ name: 'Equalizer', players }]
  };
}

module.exports = { projectFinalizedEqualizer };
