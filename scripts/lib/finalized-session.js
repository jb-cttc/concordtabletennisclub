'use strict';

const ratings = require('../../rating-engine');
const { sortByGroupResult } = require('../../standings');

function integer(value, label) {
  if (value === '' || value === null || value === undefined || !Number.isInteger(Number(value))) {
    throw new Error('Invalid ' + label + ': ' + value);
  }
  return Number(value);
}

function projectFinalizedSession(session, participants, matches, ledger, directory) {
  if (session.status !== 'finalized') throw new Error('Session is not finalized: ' + session.session_id);
  const sessionId = String(session.session_id);
  const date = String(session.session_date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !sessionId || !session.finalized_at) {
    throw new Error('Missing finalized session identity or timestamp: ' + sessionId);
  }
  const playersById = new Map(directory.map(function (player) { return [String(player.player_id), player]; }));
  const groups = new Map();
  const entries = new Map();
  participants.forEach(function (row) {
    const id = String(row.player_id);
    const number = integer(row.group_number, 'group number');
    const before = integer(row.starting_rating, 'starting rating');
    if (String(row.session_id) !== sessionId || !id || entries.has(id) || !playersById.has(id) || number < 1 || before < 0) {
      throw new Error('Invalid or duplicate participant: ' + id);
    }
    const entry = { id, number, before, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, matches: [], adjustment: 0 };
    entries.set(id, entry);
    if (!groups.has(number)) groups.set(number, []);
    groups.get(number).push(entry);
  });
  if (!entries.size) throw new Error('Finalized session has no participants: ' + sessionId);

  const seenMatches = new Set();
  matches.forEach(function (match) {
    const first = entries.get(String(match.player_one_id));
    const second = entries.get(String(match.player_two_id));
    const number = integer(match.group_number, 'match group');
    const firstGames = integer(match.player_one_games, 'first games');
    const secondGames = integer(match.player_two_games, 'second games');
    const key = [String(match.player_one_id), String(match.player_two_id)].sort().join('::');
    const validScore = (firstGames === 3 && secondGames >= 0 && secondGames <= 2) ||
      (secondGames === 3 && firstGames >= 0 && firstGames <= 2);
    if (String(match.session_id) !== sessionId || !first || !second || first === second ||
        first.number !== number || second.number !== number || seenMatches.has(key) || !validScore) {
      throw new Error('Invalid or duplicate match: ' + key);
    }
    seenMatches.add(key);
    const winner = firstGames > secondGames ? first : second;
    const loser = winner === first ? second : first;
    const forfeit = match.forfeit === true || String(match.forfeit).toLowerCase() === 'true';
    const points = ratings.adjustment(winner.before, loser.before, forfeit);
    winner.wins += 1;
    loser.losses += 1;
    first.gamesWon += firstGames;
    first.gamesLost += secondGames;
    second.gamesWon += secondGames;
    second.gamesLost += firstGames;
    winner.adjustment += points;
    loser.adjustment -= points;
    first.matches.push({ opponent: String(playersById.get(second.id).display_name), gamesWon: firstGames, gamesLost: secondGames, adj: winner === first ? points : -points, forfeit });
    second.matches.push({ opponent: String(playersById.get(first.id).display_name), gamesWon: secondGames, gamesLost: firstGames, adj: winner === second ? points : -points, forfeit });
  });
  groups.forEach(function (members) {
    if (members.length * (members.length - 1) / 2 !== members.reduce(function (sum, member) { return sum + member.matches.length; }, 0) / 2) {
      throw new Error('Incomplete group in session ' + sessionId);
    }
  });

  const ledgerById = new Map();
  ledger.forEach(function (row) {
    const id = String(row.player_id);
    if (String(row.session_id) !== sessionId || !entries.has(id) || ledgerById.has(id)) {
      throw new Error('Invalid or duplicate ledger row: ' + id);
    }
    ledgerById.set(id, row);
  });
  if (ledgerById.size !== entries.size) throw new Error('Incomplete rating ledger: ' + sessionId);

  return {
    date,
    sessionId,
    source: 'app',
    revision: integer(session.revision, 'revision'),
    finalizedAt: String(session.finalized_at),
    groups: Array.from(groups.entries()).sort(function (left, right) { return left[0] - right[0]; }).map(function (group) {
      return {
        name: 'Group ' + group[0],
        players: sortByGroupResult(group[1].map(function (entry) {
          const row = ledgerById.get(entry.id);
          const after = ratings.project(entry.before, entry.adjustment);
          const adjustment = after - entry.before;
          if (integer(row.rating_before, 'ledger starting rating') !== entry.before ||
              integer(row.adjustment, 'ledger adjustment') !== adjustment ||
              integer(row.rating_after, 'ledger final rating') !== after ||
              String(row.rule_version) !== 'cttc-access-v1') {
            throw new Error('Rating ledger disagrees with match scores for ' + entry.id);
          }
          return {
            name: String(playersById.get(entry.id).display_name),
            wins: entry.wins,
            losses: entry.losses,
            gamesWon: entry.gamesWon,
            gamesLost: entry.gamesLost,
            ratingBefore: entry.before,
            ratingAfter: after,
            ratingAdj: adjustment,
            matches: entry.matches,
            matchesUnavailable: false
          };
        }))
      };
    })
  };
}

module.exports = { projectFinalizedSession };