'use strict';

// Scraped Access reports print "F" for both players whether one player forfeited or neither played,
// so the direction is lost. data/forfeit-overrides.json records it for sessions posted before the
// desk took over: { "YYYY-MM-DD": { "Group N": [{ "players": [a, b], "forfeitedBy": name | "both" }] } }.
// The result uses the same match shape as desk-finalized sessions (forfeit, forfeitedBy).

const { sortByGroupResult, tally } = require('../../standings');

function applyForfeitOverrides(sessions, overrides) {
  Object.keys(overrides || {}).forEach(function (date) {
    const session = sessions.find(function (item) { return item.date === date; });
    if (!session) return;

    Object.keys(overrides[date]).forEach(function (groupName) {
      const group = session.groups.find(function (item) { return item.name === groupName; });
      if (!group) throw new Error('Forfeit override: ' + date + ' has no ' + groupName);

      overrides[date][groupName].forEach(function (entry) {
        const pair = entry.players.map(function (name) {
          const player = group.players.find(function (item) { return item.name === name; });
          if (!player) throw new Error('Forfeit override: ' + date + ' ' + groupName + ' has no player ' + name);
          return player;
        });
        if (pair.length !== 2 || pair[0] === pair[1]) throw new Error('Forfeit override: need two different players in ' + date + ' ' + groupName);
        if (entry.forfeitedBy !== 'both' && entry.players.indexOf(entry.forfeitedBy) < 0) {
          throw new Error('Forfeit override: forfeitedBy must be "both" or one of the two players (' + date + ' ' + groupName + ')');
        }
        pair.forEach(function (player, index) {
          const other = pair[1 - index];
          const match = player.matches.find(function (item) { return item.opponent === other.name; });
          if (!match) throw new Error('Forfeit override: ' + player.name + ' has no match against ' + other.name + ' on ' + date);
          if (match.gamesWon || match.gamesLost) throw new Error('Forfeit override: ' + player.name + ' v ' + other.name + ' on ' + date + ' was played, not forfeited');
          match.forfeit = true;
          match.forfeitedBy = entry.forfeitedBy;
        });
      });

      group.players.forEach(function (player) {
        const record = tally(player);
        player.wins = record.wins;
        player.losses = record.losses + record.forfeitLosses;
      });
      group.players = sortByGroupResult(group.players);
    });
  });
  return sessions;
}

module.exports = { applyForfeitOverrides };
